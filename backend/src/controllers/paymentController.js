import crypto from 'node:crypto';
import SSLCommerzPayment from 'sslcommerz-lts';
import { config, isSslcommerzConfigured } from '../config/env.js';
import Order from '../models/Order.js';
import { HttpError } from '../middleware/errorHandler.js';
import {
  ORDER_STATUS,
  PAYMENT_CHANNEL_MULTI_CARD,
  PAYMENT_METHODS,
  PAYMENT_PROVIDER,
  PAYMENT_STATUS,
  TRANSACTION_PREFIX,
} from '../utils/constants.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { assertOrderOwner, loadOrderFor } from './orderController.js';

// ---------------------------------------------------------------------------
// SSLCommerz sandbox integration.
//
// Adaptation note: the brief this was built from describes a standalone `Order`
// schema created inside POST /api/payment/init. This app already HAS an order -
// created by POST /api/orders, with the basket priced server-side, a store
// derived from the products and a full delivery lifecycle attached. So `init`
// takes an EXISTING orderId rather than raw orderData, and charges
// `order.total`.
//
// That is not a cosmetic difference. If the gateway amount came from the
// request body, a client could POST { total_amount: 1 } and the server would
// dutifully open a one-taka session for a five-hundred-taka basket. The order is
// the price, and the gateway is asked to charge exactly that.
// ---------------------------------------------------------------------------

/**
 * The library, built from config. Created per call rather than cached at module
 * load, so flipping the sandbox flag in .env does not leave a stale instance
 * behind, and so a missing password fails here - with our own sentence - rather
 * than deep inside the library.
 */
function gateway() {
  if (!isSslcommerzConfigured()) {
    throw new HttpError(
      503,
      'Online payment is not configured on this server. Add SSLCOMMERZ_STORE_ID and ' +
        'SSLCOMMERZ_STORE_PASSWORD to backend/.env, or choose cash on delivery.',
    );
  }

  // Third constructor argument is `live`, the inverse of `isSandbox`.
  return new SSLCommerzPayment(
    config.sslcommerz.storeId,
    config.sslcommerz.storePassword,
    !config.sslcommerz.isSandbox,
  );
}

/** The banker's browser and SSLCommerz must both be able to reach these. */
const callbackUrls = (tranId) => {
  const { backendUrl } = config.sslcommerz;
  return {
    success_url: `${backendUrl}/api/payment/success?tran_id=${tranId}`,
    fail_url: `${backendUrl}/api/payment/fail?tran_id=${tranId}`,
    cancel_url: `${backendUrl}/api/payment/cancel?tran_id=${tranId}`,
    ipn_url: `${backendUrl}/api/payment/ipn`,
  };
};

/** Where the shopper lands afterwards. Always this app, never the gateway. */
const clientRedirect = (path, tranId) => {
  const url = new URL(`${config.sslcommerz.clientUrl}${path}`);
  if (tranId) url.searchParams.set('tran_id', tranId);
  return url.toString();
};

/** A transaction id that is unique per attempt and readable in a database dump. */
const makeTransactionId = (order) => {
  const prefix = order.customer
    ? TRANSACTION_PREFIX.CUSTOMER
    : TRANSACTION_PREFIX.GUEST;

  // The random suffix is not decoration. `Date.now()` alone is a millisecond
  // counter, and two shoppers clicking "Pay online" in the same millisecond
  // would produce the same id - which the unique index would then (correctly)
  // reject as a duplicate, turning a busy demo into a failed payment.
  return `${prefix}${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
};

/** Money to 2dp - never trust a float that arrived as a string. */
const toAmount = (value) =>
  Math.round((Number(value) + Number.EPSILON) * 100) / 100;

/**
 * Every value sent to the gateway is single-line text.
 *
 * Not cosmetic. The library hands these to `form-data`, which builds a
 * multipart body by concatenating the raw bytes of each field - so a newline
 * smuggled in from user input (an address typed as two lines, a note written
 * over two) gets written into the body verbatim. That corrupts the request
 * before it leaves the machine, and SSLCommerz answers with an EMPTY body that
 * the library then cannot parse - which surfaces as a baffling "invalid json
 * response body" rather than anything about the field that caused it.
 *
 * The same normalisation keeps the em dash out of the request as well; the
 * gateway is not reliably UTF-8, and a mangled "Joe's Pizza — Kitchen" is not
 * worth a failed payment.
 */
const line = (value) =>
  String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[^\x20-\x7E]/g, '')
    .trim();

/**
 * A field the gateway insists on, guaranteed non-empty.
 *
 * This exists because of a genuinely nasty gateway behaviour. `city` is
 * OPTIONAL in this app's checkout form (and on the Store model), but SSLCommerz
 * treats `cus_city` / `ship_city` as required - and when one arrives blank it
 * does NOT answer with a readable `failedreason`. It answers with an EMPTY body,
 * which the library cannot parse, so the whole failure surfaces as "invalid json
 * response body" and the shopper is told the gateway is unreachable.
 *
 * A shopper who leaves the city out of an order must not be unable to pay for
 * it, so: the address value, else the store's own city, else a default.
 */
const FALLBACK_CITY = 'Dhaka';

const required = (value, fallback) => line(value) || fallback;

/** The name to show the gateway for whoever is paying. */
const payerName = (order) =>
  required(order.customer?.name || order.guest?.name, 'Customer');

/** A guest may not have given an email; the gateway is told rather than sent ''. */
const payerEmail = (order) =>
  required(order.customer?.email || order.guest?.email, 'no-reply@example.com');

/** The delivery city, falling back through address -> store -> a default. */
const payerCity = (order) =>
  required(
    order.address?.city || order.store?.address?.city,
    FALLBACK_CITY,
  );

/**
 * The init payload. The library's `payment-init-data-process` flattens whatever
 * this returns and POSTs it as form data, so the key names here are the
 * gateway's, not ours.
 */
const buildInitData = (order) => ({
  total_amount: toAmount(order.total),
  currency: config.sslcommerz.currency,
  tran_id: order.payment.transactionId,

  // Required by the gateway. The basket is summarised rather than itemised
  // because it is one purchase, and a very long product name gets truncated on
  // their side anyway.
  product_name: `Order from ${required(order.store?.name, 'the store')}`,
  product_category: 'Delivery',
  product_profile: 'general',

  // Who is paying. Every value goes through `line()`/`required()` - see the
  // notes there: nothing the gateway marks required may ever be sent blank.
  cus_name: payerName(order),
  cus_email: payerEmail(order),
  cus_add1: required(order.address?.line1, 'Not provided'),
  cus_add2: required(order.address?.notes, payerCity(order)),
  cus_city: payerCity(order),
  cus_postcode: '1207',
  cus_country: 'Bangladesh',
  cus_phone: required(order.address?.phone, '01700000000'),

  shipping_method: 'Delivery',
  num_of_item: (order.items || []).length,
  ship_name: payerName(order),
  ship_add1: required(order.address?.line1, 'Not provided'),
  ship_add2: required(order.address?.notes, payerCity(order)),
  ship_city: payerCity(order),
  ship_postcode: '1207',
  ship_country: 'Bangladesh',

  // Echoed back untouched on every callback. This is how an IPN arriving with
  // no session context still knows which order it is about.
  value_a: String(order._id),
  value_b: order.store?.slug || '',

  // The buyer's chosen channel, as the gateway's card-brand filter. `card`
  // maps to a real documented value that genuinely narrows the page to
  // Visa/Mastercard; the mobile channels are sent as themselves, which the
  // gateway accepts (verified against the sandbox). See
  // PAYMENT_CHANNEL_MULTI_CARD for what this does and does not achieve.
  multi_card_name:
    PAYMENT_CHANNEL_MULTI_CARD[order.payment.channel] ||
    PAYMENT_CHANNEL_MULTI_CARD.card,

  ...callbackUrls(order.payment.transactionId),
});

/**
 * POST /api/payment/init
 * body: { orderId, paymentMethod }   (guests also send { guestToken })
 *
 * Opens a sandbox session and hands back the gateway page to send the shopper
 * to. The order must already exist and must belong to the caller - a guest
 * proves it with their checkout token, exactly as everywhere else in this app.
 */
export const initPayment = asyncHandler(async (req, res) => {
  const { orderId } = req.body || {};
  const guestToken = req.body?.guestToken || null;

  if (!orderId) {
    throw new HttpError(400, 'An orderId is required to start a payment.');
  }

  const order = await loadOrderFor(orderId, req.user, guestToken);

  // Seeing the order is not owning it. `loadOrderFor` has just let the ASSIGNED
  // RIDER and the store staff through, because they legitimately need to watch
  // the order they are working on - and neither of them may charge the customer
  // for it. Only the buyer (session or guest token) may open a payment.
  assertOrderOwner(order, req.user);

  if (order.status === ORDER_STATUS.CANCELLED) {
    throw new HttpError(400, 'This order was cancelled.');
  }

  // Already paid: never open a second session against the same money.
  if (order.payment.status === PAYMENT_STATUS.PAID) {
    throw new HttpError(400, 'This order has already been paid.');
  }

  // The channel the buyer picked on the checkout form (bkash / nagad / rocket /
  // card). Validated against the same list the Order model enforces, so a
  // hand-made request cannot invent a channel; `cod` is not accepted here
  // because it never involves the gateway at all.
  const channel = String(req.body?.paymentMethod || '').trim().toLowerCase();
  if (!PAYMENT_METHODS.includes(channel) || channel === 'cod') {
    throw new HttpError(
      400,
      'Pick how you want to pay online: card, bKash, Nagad or Rocket.',
    );
  }

  const client = gateway();

  // Flip the order to "pay online, pending" and stamp a fresh transaction id.
  // A retry after a failed or cancelled attempt reuses the order but gets a new
  // id, so the two attempts never collide in the unique index or in the
  // gateway's own records.
  order.paymentMethod = channel;
  order.payment.provider = PAYMENT_PROVIDER.SSLCOMMERZ;
  order.payment.channel = channel;
  order.payment.status = PAYMENT_STATUS.PENDING;
  order.payment.transactionId = makeTransactionId(order);
  order.payment.amount = toAmount(order.total);
  order.payment.currency = config.sslcommerz.currency;
  order.payment.message = '';
  await order.save();


  let response;
  try {
    response = await client.init(buildInitData(order));
  } catch (err) {
    // The gateway is third-party and may be down or misconfigured. Do NOT leave
    // the order sitting on a transaction id that was never opened, or the next
    // attempt would trip over it - put it back to a clean state and say what
    // happened.
    order.payment.status = PAYMENT_STATUS.FAILED;
    order.payment.message = `Could not reach the payment gateway: ${err.message}`;
    order.payment.transactionId = null;
    await order.save();

    throw new HttpError(
      502,
      'The payment gateway could not be reached. Please try again, or pay cash on delivery.',
    );
  }

  // The library RESOLVES with the Error object instead of rejecting - its
  // httpCall ends in `.catch(err => err)`. So a network error or an unparseable
  // body arrives here looking exactly like a gateway response with no
  // GatewayPageURL, and the two are told apart by asking what the thing IS.
  // Getting this wrong is how a real failure gets reported as a vague one.
  const gatewayErrored = response instanceof Error;
  if (gatewayErrored) {
    console.warn(
      `[payment][init] gateway call failed for ${order.payment.transactionId}:`,
      response.message,
    );
  }

  if (gatewayErrored || !response?.GatewayPageURL) {
    // Logged verbatim: SSLCommerz answers a rejected session with a
    // `failedreason` naming the exact field it wanted, and that sentence is
    // useless anywhere except a server log - the shopper needs to be told what
    // to do next, not what our JSON was missing.
    console.warn(
      `[payment][init] gateway refused ${order.payment.transactionId}:`,
      response?.failedreason || JSON.stringify(response),
    );

    order.payment.status = PAYMENT_STATUS.FAILED;
    order.payment.message = gatewayErrored
      ? 'The payment gateway could not be reached. Please try again, or pay cash on delivery.'
      : response?.failedreason || 'The gateway did not return a payment page.';
    order.payment.transactionId = null;
    await order.save();

    throw new HttpError(
      502,
      order.payment.message || 'The payment gateway refused to start this payment.',
    );
  }

  res.json({
    // `url` is the name the brief asked for; `GatewayPageURL` is returned too,
    // so a caller written against either name works.
    url: response.GatewayPageURL,
    GatewayPageURL: response.GatewayPageURL,
    tran_id: order.payment.transactionId,
    amount: order.payment.amount,
    currency: order.payment.currency,
    // Echoed so the caller can show "paying by bKash…" while the gateway loads.
    channel: order.payment.channel,
    // What was actually sent to the gateway, which is NOT always the channel
    // verbatim - see PAYMENT_CHANNEL_MULTI_CARD.
    multi_card_name: PAYMENT_CHANNEL_MULTI_CARD[order.payment.channel],
  });
});

/**
 * The one place a payment is allowed to become Paid.
 *
 * `val_id` is the gateway's handle, and it is verified against SSLCommerz every
 * single time before any money is believed. A callback arriving with a made-up
 * val_id - or for an order whose amount does not match what the gateway says it
 * charged - is rejected here rather than honoured.
 */
async function settlePayment({ tranId, valId }) {
  const order = await Order.findOne({ 'payment.transactionId': tranId });
  if (!order) {
    throw new HttpError(404, 'No order matches that transaction.');
  }

  const client = gateway();
  const validation = await client.validate({ val_id: valId });

  // The gateway answers in-band. Anything but VALIDATED means the money did not
  // move, whatever the browser was told on the way here.
  if (validation?.status !== 'VALIDATED') {
    order.payment.status = PAYMENT_STATUS.FAILED;
    order.payment.val_id = valId;
    order.payment.message =
      validation?.failedreason || 'The payment was not validated.';
    await order.save();

    return { order, validation, ok: false };
  }

  // What the gateway says it charged must match what we asked for. A mismatch
  // means the session was tampered with, or the order was edited mid-flight;
  // either way this is not a payment for this basket.
  const charged = Number(validation.amount);
  if (Number.isFinite(charged) && Math.abs(charged - order.payment.amount) > 0.01) {
    order.payment.status = PAYMENT_STATUS.FAILED;
    order.payment.val_id = valId;
    order.payment.message =
      `Amount mismatch: the gateway charged ${charged}, this order is for ` +
      `${order.payment.amount}.`;
    await order.save();

    return { order, validation, ok: false };
  }

  order.payment.status = PAYMENT_STATUS.PAID;
  order.payment.val_id = valId;
  order.payment.paidAt = new Date();
  order.payment.amount = Number.isFinite(charged)
    ? charged
    : order.payment.amount;
  order.payment.message = '';
  await order.save();

  return { order, validation, ok: true };
}


/**
 * POST /api/payment/success?tran_id=…
 *
 * SSLCommerz POSTs here after the shopper completes a payment. The order is
 * verified and marked paid, then the BROWSER is redirected into the app - this
 * endpoint answers with a 302, not JSON, because it is a browser navigation.
 */
export const paymentSuccess = asyncHandler(async (req, res) => {
  const tranId = String(req.body?.tran_id || req.query.tran_id || '');
  const valId = String(req.body?.val_id || req.query.val_id || '');

  if (!tranId || !valId) {
    return res.redirect(clientRedirect('/payment-failed', tranId));
  }

  try {
    const { order, ok } = await settlePayment({ tranId, valId });

    if (!ok) {
      return res.redirect(
        clientRedirect(
          `/payment-failed?reason=${encodeURIComponent(order.payment.message)}`,
          tranId,
        ),
      );
    }
  } catch (err) {
    // A validation call that could not be made at all is indistinguishable,
    // from the shopper's side, from a payment that did not go through - so they
    // are sent to the same page. The order stays Pending and the IPN can still
    // settle it if the gateway retries.
    return res.redirect(
      clientRedirect(
        `/payment-failed?reason=${encodeURIComponent(err.message)}`,
        tranId,
      ),
    );
  }

  return res.redirect(clientRedirect('/payment-success', tranId));
});

/** POST /api/payment/fail?tran_id=… - the shopper's payment did not go through. */
export const paymentFail = asyncHandler(async (req, res) => {
  const tranId = String(req.body?.tran_id || req.query.tran_id || '');

  if (tranId) {
    const order = await Order.findOne({ 'payment.transactionId': tranId });
    // Never downgrade a payment that already settled - a late `fail` callback
    // must not undo a `success` that arrived first.
    if (order && order.payment.status !== PAYMENT_STATUS.PAID) {
      order.payment.status = PAYMENT_STATUS.FAILED;
      order.payment.val_id = req.body?.val_id || order.payment.val_id;
      order.payment.message =
        req.body?.error || req.body?.failedreason || 'The payment failed.';
      await order.save();
    }
  }

  return res.redirect(
    clientRedirect(
      `/payment-failed?reason=${encodeURIComponent(
        req.body?.error || 'The payment failed.',
      )}`,
      tranId,
    ),
  );
});

/** POST /api/payment/cancel?tran_id=… - the shopper backed out of the gateway. */
export const paymentCancel = asyncHandler(async (req, res) => {
  const tranId = String(req.body?.tran_id || req.query.tran_id || '');

  if (tranId) {
    const order = await Order.findOne({ 'payment.transactionId': tranId });
    if (order && order.payment.status !== PAYMENT_STATUS.PAID) {
      order.payment.status = PAYMENT_STATUS.CANCELLED;
      order.payment.message = 'You cancelled the payment.';
      await order.save();
    }
  }

  return res.redirect(
    clientRedirect('/payment-failed?reason=cancelled', tranId),
  );
});

/**
 * POST /api/payment/ipn
 *
 * SSLCommerz's asynchronous notification - the webhook that makes this
 * trustworthy rather than hopeful. The browser redirect can be blocked, closed
 * or forged, but the IPN is the gateway telling the server directly, and it
 * runs for payments the shopper never came back from.
 */
export const paymentIpn = asyncHandler(async (req, res) => {
  const tranId = String(req.body?.tran_id || '');
  const valId = String(req.body?.val_id || '');

  // SSLCommerz stops retrying on a 200. A malformed payload is logged and
  // acknowledged rather than answered with an error that would make the gateway
  // keep hammering this endpoint.
  if (!tranId || !valId) {
    console.warn('[payment][ipn] ignored: missing tran_id/val_id');
    return res.status(200).json({ received: true, settled: false });
  }

  try {
    const { order, ok } = await settlePayment({ tranId, valId });
    console.log(
      `[payment][ipn] ${tranId} -> ${order.payment.status} (order ${order._id})`,
    );
    return res.status(200).json({ received: true, settled: ok });
  } catch (err) {
    console.error('[payment][ipn]', err.message);
    return res.status(200).json({ received: true, settled: false });
  }
});


/**
 * GET /api/payment/:tranId
 *
 * What the success page needs. The redirect hands the browser a transaction id
 * and nothing else, and a guest is not signed in, so the page asks the server
 * what actually happened rather than trusting the URL it arrived on.
 */
export const getPayment = asyncHandler(async (req, res) => {
  const { tranId } = req.params;
  const guestToken = req.query.guestToken || null;

  const found = await Order.findOne({
    'payment.transactionId': String(tranId || ''),
  });
  if (!found) {
    throw new HttpError(404, 'No order matches that transaction.');
  }

  // Authorise against the real order, with the same rules as everything else -
  // so a transaction id alone is not enough to read somebody else's receipt.
  const order = await loadOrderFor(found._id, req.user, guestToken);

  res.json({
    tran_id: order.payment.transactionId,
    status: order.payment.status,
    channel: order.payment.channel,
    amount: order.payment.amount,
    currency: order.payment.currency,
    message: order.payment.message,
    paidAt: order.payment.paidAt,
    method: order.paymentMethod,
    order: {
      id: order._id,
      total: order.total,
      store: order.store
        ? { name: order.store.name, slug: order.store.slug }
        : null,
      items: (order.items || []).map((line) => ({
        name: line.name,
        quantity: line.quantity,
        price: line.price,
      })),
    },
  });
});

export default {
  initPayment,
  paymentSuccess,
  paymentFail,
  paymentCancel,
  paymentIpn,
  getPayment,
};


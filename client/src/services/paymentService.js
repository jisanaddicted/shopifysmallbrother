import api from './api';
import {
  getGuestToken,
  getGuestTokenForTran,
  linkGuestTokenToTran,
} from '../utils/constants';

/**
 * POST /payment/init
 * body: { orderId, paymentMethod }   (guests also send { guestToken })
 *
 * Asks the server to open an SSLCommerz sandbox session for an order that
 * ALREADY EXISTS, and resolves to
 * `{ url, tran_id, amount, currency, channel, multi_card_name }` - `url` being
 * the gateway page the shopper must be sent to.
 *
 * `paymentMethod` is the channel the buyer picked on the checkout form (card,
 * bkash, nagad, rocket). It is sent as-is; the server validates it against the
 * same list the Order model enforces, and decides what to do with it.
 *
 * Note what is NOT here: no amount, no items, no total. The order was priced
 * server-side when it was created, and the gateway is charged that figure, so
 * there is nothing in this call a tampered client could change.
 */
export const initPayment = async (orderId, paymentMethod) => {
  const token = getGuestToken(orderId) || null;
  const data = await api
    .post('/payment/init', {
      orderId,
      paymentMethod,
      ...(token ? { guestToken: token } : {}),
    })
    .then((res) => res.data || {});

  // The gateway will hand the browser back a transaction id and nothing else,
  // so a guest's token has to be findable under THAT key before we leave.
  linkGuestTokenToTran(data?.tran_id, orderId);

  return data;
};

/**
 * GET /payment/:tranId - what actually happened to a payment.
 *
 * Used by the success page, which arrives from the gateway holding only
 * ?tran_id=… and nothing else. A guest is not signed in, so their token is
 * looked up via the transaction link written above - the order-keyed token is
 * useless here because the order id did not survive the redirect.
 */
export const getPayment = (tranId, { guestToken } = {}) => {
  const token =
    guestToken || getGuestTokenForTran(tranId) || getGuestToken(tranId) || null;
  return api
    .get(`/payment/${tranId}`, { params: token ? { guestToken: token } : {} })
    .then((res) => res.data || null);
};

export default {
  initPayment,
  getPayment,
};
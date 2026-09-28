import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import DeliveryMap from '../../components/maps/DeliveryMap';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import ReviewDialog from '../../components/store/ReviewDialog';
import { useSocket } from '../../context/SocketContext';
import { useAuth } from '../../context/AuthContext';
import orderService from '../../services/orderService';
import {
  ADMIN_STATUS_STEPS,
  ORDER_STATUS,
  ORDER_STATUS_TONE,
  ROUTES,
  TRACKER_FLOW,
  customerPath,
  getGuestToken,
  shopPath,
} from '../../utils/constants';
import {
  formatCurrency,
  formatDateTime,
  formatDurationMs,
  formatStatus,
  formatTime,
} from '../../utils/formatters';
import { deliveryLegs, elapsedMs, statusSteps } from '../../utils/timings';
import { findVariant } from '../../utils/variants';

/**
 * The read-only view of a single order: live map, progress timeline, items,
 * rider and drop-off address.
 *
 * variant="customer" (default) - what a buyer or a guest watches, reached at
 *   /track/:orderId. Wide padding, and a way back to the shop.
 * variant="admin" - the very same details opened from the admin panel's order
 *   board at /admin/orders/:orderId. It renders *inside* <DashboardLayout>, so
 *   the side rail stays put; only the padding, the wording and the "back"
 *   target differ. Nothing is duplicated for the back office.
 * variant="rider" - the same, opened from the rider's own pages at
 *   /rider/orders/:orderId, for the same reason: it stays inside the rider
 *   shell instead of dropping the rider onto the public navbar.
 *
 * `backTo`/`backLabel` let the caller send "back" where the user actually came
 * from - the rider tracker's order view returns to the tracker, not to the
 * orders board - instead of every shell-mounted view assuming its own board.
 */
export default function OrderTracker({
  variant = 'customer',
  backTo: backToProp,
  backLabel: backLabelProp,
}) {
  const isAdmin = variant === 'admin';
  const isStaffView = isAdmin || variant === 'rider';
  const { orderId } = useParams();
  const { joinOrder, leaveOrder, getRiderLocation, statusUpdates, connected } =
    useSocket();
  const { user } = useAuth();

  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [advancing, setAdvancing] = useState(false);
  const [advanceError, setAdvanceError] = useState('');
  const [receiving, setReceiving] = useState(false);
  const [receiveError, setReceiveError] = useState('');
  // The rating popup. Opens by itself the instant a receipt is confirmed (the
  // one moment the customer definitely has the parcel in front of them), and can
  // be reopened later from the panel.
  const [reviewOpen, setReviewOpen] = useState(false);
  // Did this customer already leave a review? Drives the wording of the
  // "what next" panel below, so a finished order can nudge them to order again
  // instead of looking like a dead end.
  const [hasReview, setHasReview] = useState(false);

  const loadOrder = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const data = await orderService.getOrderById(orderId);
      setOrder(data);
    } catch (err) {
      setError(err.message || 'Could not load this order.');
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    loadOrder();
  }, [loadOrder]);

  // Subscribe to live updates for exactly this order, then clean up.
  useEffect(() => {
    if (!orderId) return undefined;

    joinOrder(orderId);
    return () => leaveOrder(orderId);
  }, [orderId, joinOrder, leaveOrder]);

  // A socket status beats the value we fetched over REST.
  const status = statusUpdates[orderId]?.status || order?.status;

  // The single status an admin may set this order to, or null when there is
  // nothing for them to do (pending, already ready, on the road, done, or
  // cancelled). Reading the same table the API enforces means the button can
  // never offer a move the server would refuse.
  const adminNextStatus = isAdmin ? ADMIN_STATUS_STEPS[status] || null : null;

  const advanceAsAdmin = async () => {
    if (!adminNextStatus || advancing) return;

    setAdvancing(true);
    setAdvanceError('');

    try {
      const updated = await orderService.updateOrderStatus(
        orderId,
        adminNextStatus,
        'Kitchen update by an admin',
      );
      // Adopt the response straight away: the button moves on to the next step
      // without waiting for a Refresh or for the socket to catch up.
      setOrder(updated);
    } catch (err) {
      setAdvanceError(err.message || 'Could not update the status.');
    } finally {
      setAdvancing(false);
    }
  };

  // --- Customer: close the loop --------------------------------------------
  // The rider's "Mark delivered" says they left the parcel; this says it arrived.
  // Adopting the response straight away (like the admin's advance above) means
  // the button swaps to the review form without waiting for a refresh or for the
  // socket to catch up.
  const confirmReceived = async () => {
    if (receiving) return;

    setReceiving(true);
    setReceiveError('');

    try {
      const updated = await orderService.confirmOrderReceived(orderId);
      setOrder(updated);
      // The ask: now that the parcel is confirmed, ask for the stars and the
      // note while they still have it in hand. It is dismissible, and the panel
      // below stays on the page afterwards for anyone who says "maybe later".
      setReviewOpen(true);
    } catch (err) {
      setReceiveError(err.message || 'Could not confirm the delivery.');
    } finally {
      setReceiving(false);
    }
  };

  const customerLocation = order?.location || order?.address?.location || null;
  const riderLocation =
    getRiderLocation(orderId) ||
    order?.riderLocation ||
    order?.rider?.location ||
    null;

  // The customer's timeline runs to the one step the rider's cannot: "Delivery
  // received" only lights up once they have confirmed it themselves, which is
  // exactly the moment the review form appears below.
  const timeline = useMemo(() => {
    const currentIndex = TRACKER_FLOW.indexOf(status);

    return TRACKER_FLOW.map((step, index) => ({
      step,
      done: currentIndex >= index && currentIndex !== -1,
      current: index === currentIndex,
    }));
  }, [status]);

  // Picker's list for the back office: what to collect, in the order to walk
  // the shop. The rack/shelf comes from the *live* product that the API
  // populates onto each line (`items.product`), so a product re-shelved after
  // checkout still points at its new home. Lines whose product has since been
  // deleted come back without it - they sort last and are called out, because
  // a shelf that does not exist is worse than no shelf at all.
  const pickList = useMemo(() => {
    const rows = (order?.items || []).map((item) => ({
      name: item.name,
      // The variant label, as it was AT THE TIME OF THE ORDER - the line's own
      // copy, never re-derived from the live product. A rider collecting "2x
      // Large / Blue" must not be told "2x Small / Red" because the merchant
      // has since renamed the options.
      variantTitle: item.variantTitle || '',
      quantity: Number(item.quantity) || 0,
      category: item.product?.category || '',
      // The thumbnail prefers the variant's own photo, then the product's, so a
      // shelf of six colours can be picked from the picture alone. It comes from
      // the live product, so it is dropped along with the location if the product
      // is deleted - the receipt line stands.
      image: findVariant(item.product, item.variant)?.image || item.product?.image || '',
      rack: String(item.product?.rack ?? '').trim(),
      shelf: String(item.product?.shelf ?? '').trim(),
      known: Boolean(item.product),
    }));

    return rows.sort((a, b) => {
      if (!a.rack && b.rack) return 1;
      if (a.rack && !b.rack) return -1;
      if (!a.rack) return a.name.localeCompare(b.name);

      // A1 before A2 before A10 - plain string compare would put A10 second.
      const rackOrder = a.rack.localeCompare(b.rack, undefined, { numeric: true });
      if (rackOrder !== 0) return rackOrder;

      const shelfOrder = a.shelf.localeCompare(b.shelf, undefined, {
        numeric: true,
      });
      if (shelfOrder !== 0) return shelfOrder;

      return a.name.localeCompare(b.name);
    });
  }, [order]);

  // Anything a picker cannot walk to: no rack, or a product that is gone.
  const unlocated = pickList.filter((row) => !row.rack && !row.shelf);

  // How long this delivery is taking, measured off the order's own audit trail
  // rather than a counter: "38 minutes from order to doorstep" once it is done,
  // or the elapsed time so far while it is still running.
  const timings = useMemo(() => deliveryLegs(order), [order]);
  const runningMs = useMemo(() => elapsedMs(order), [order]);
  const steps = useMemo(() => statusSteps(order), [order]);

  // Units across every line, so the header answers "how much am I picking?"
  // without the reader having to add the column up themselves.
  const totalUnits = pickList.reduce((sum, row) => sum + row.quantity, 0);

  if (loading) {
    return (
      <LoadingSpinner
        fullPage
        label={
        isStaffView
          ? 'Loading the order…'
          : 'Loading your order…'
      }
      />
    );
  }

  // Where "back" goes: each back-office view returns to the board it was opened
  // from (overridable, so the rider tracker's order view goes back to the
  // tracker); a customer goes back to the shop they ordered from.
  const backTo =
    backToProp ||
    (isAdmin
      ? ROUTES.ADMIN_DASHBOARD
      : variant === 'rider'
        ? ROUTES.RIDER_CONSOLE
        : ROUTES.STORE);
  const backLabel =
    backLabelProp ||
    (isAdmin
      ? 'Back to orders'
      : variant === 'rider'
        ? 'Back to deliveries'
        : 'Back to store');
  // The customer tracker is full-bleed (it has the navbar above it); every
  // shell-mounted view uses the standard back-office page padding.
  const pageClass = isStaffView ? 'page' : 'page page--customer';

  // --- The customer's end of the order -------------------------------------
  // Everything below is for the shopper only - the admin and rider variants of
  // this page are back-office views and must not offer to "confirm" or "review"
  // somebody else's delivery on their behalf.
  //
  // The gate is WHO placed the order, not the role. Two ways to be that person:
  // a signed-in account matching the order's customer, or a guest holding the
  // guestToken this device was given at checkout (the same proof /cancel uses).
  // Comparing the ids also keeps a signed-in rider or admin from being offered
  // the button on an order they can merely view.
  const isOrderOwner = Boolean(
    order?.customer?._id && String(order.customer._id) === String(user?._id),
  );
  // A guest order: no account on it at all. The stored token is what proves this
  // device placed it, so a guest gets the confirm button too - they still
  // received the parcel, so they still get the last word on it.
  const isGuestOrder = !order?.customer;
  const hasGuestToken = Boolean(getGuestToken(orderId));
  // May press "Confirm delivery received" - a signed-in owner, or a guest with
  // the token. Reviews stay account-only (see the popup's guest variant).
  const canConfirmReceived = isOrderOwner || (isGuestOrder && hasGuestToken);
  const isCancelled = status === ORDER_STATUS.CANCELLED;
  // "Start a new order" only makes sense once this one is done being tracked -
  // i.e. after the review step - and it goes back to the storefront this order
  // came from, falling back to the store picker for a legacy order with no
  // merchant attached.
  const startNewOrderPath = order?.store?.slug
    ? shopPath(order.store.slug)
    : ROUTES.STORE;
  // A customer signs in at their own store's page, which is also where the slug
  // comes from - so the "sign in to finish this order" link lands them exactly
  // where a review can be attributed to an account afterwards.
  const storeSignInPath = order?.store?.slug
    ? customerPath(order.store.slug, 'login')
    : ROUTES.LOGIN;

  // The closing sequence, shown from the moment the order is placed rather than
  // only once it is delivered. Hiding the panel until the last step meant a
  // shopper watching a fresh order had no idea the step existed, and a guest saw
  // nothing at all with no explanation. Both are now explicit states of the same
  // panel: the button is always the same button, just armed or not.
  const deliveredIndex = TRACKER_FLOW.indexOf(ORDER_STATUS.DELIVERED);
  const receivedIndex = TRACKER_FLOW.indexOf(ORDER_STATUS.RECEIVED);
  const flowIndex = TRACKER_FLOW.indexOf(status);
  const riderHasDelivered = flowIndex >= deliveredIndex;
  const customerHasReceived = flowIndex >= receivedIndex;

  // The three checkpoints, so the panel reads as "where am I in this?" rather
  // than as an unexplained form. Exactly one is `current` - the first one not
  // done yet - which is the whole point: it names the step the customer is
  // actually waiting on. Derived from the same status the server enforces, never
  // from local state.
  const closingSteps = [
    { key: 'delivered', label: 'Delivered by the rider', done: riderHasDelivered },
    {
      key: 'received',
      label: 'You confirm you received it',
      done: customerHasReceived,
    },
    { key: 'review', label: 'Rate the delivery', done: false },
  ];
  const currentStepKey = (closingSteps.find((step) => !step.done) || {}).key;

  if (error) {
    return (
      <div className={pageClass}>
        <p className="alert alert--danger">{error}</p>
        <div className="button-row">
          <button type="button" className="btn btn-outline" onClick={loadOrder}>
            Try again
          </button>
          <Link className="btn btn-ghost" to={backTo}>
            {backLabel}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={pageClass}>
      <header className="page__header">
        <div>
          <h1>Order #{String(orderId).slice(-6).toUpperCase()}</h1>
          <p className="muted">
            Placed {formatDateTime(order?.createdAt)} ·{' '}
            <span
              className={`badge badge--${ORDER_STATUS_TONE[status] || 'info'}`}
            >
              {formatStatus(status)}
            </span>
          </p>
        </div>

        <div className="button-row">
          {/* The admin reads this inside the side rail, so it needs a way back
              to the board; a customer already has the navbar above them. The
              rider's shell-mounted view needs one for the same reason. */}
          {isStaffView ? (
            <Link className="btn btn-outline btn-sm" to={backTo}>
              ← {backLabel}
            </Link>
          ) : null}

          {/* Admin-only, and only while the order is actually sitting at a
              status the admin may move. No button appears for a pending order,
              one already ready, one on the road, or a finished/cancelled one -
              so there is no dead control to click and no dropdown to guess at. */}
          {adminNextStatus ? (
            <button
              type="button"
              className="btn btn-sm"
              onClick={advanceAsAdmin}
              disabled={advancing}
            >
              {advancing
                ? 'Saving…'
                : `Mark as ${formatStatus(adminNextStatus).toLowerCase()}`}
            </button>
          ) : null}

          <span className={`live-dot ${connected ? 'live-dot--on' : ''}`}>
            {connected ? 'Live' : 'Offline'}
          </span>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={loadOrder}
          >
            Refresh
          </button>
        </div>
      </header>

      {advanceError ? (
        <p className="alert alert--danger">{advanceError}</p>
      ) : null}

      <DeliveryMap
        customerLocation={customerLocation}
        riderLocation={riderLocation}
        riderLabel={
          order?.rider?.name ||
          (isAdmin ? 'Rider' : variant === 'rider' ? 'You' : 'Your rider')
        }
      />

      {/* The rating popup. Mounted at the top level (not inside the panel) so it
          is a genuine overlay rather than something the page layout can push
          around, and so it is a sibling of everything the customer can see
          behind it. Opened automatically by confirmReceived(). */}
      <ReviewDialog
        orderId={orderId}
        open={reviewOpen}
        canReview={isOrderOwner}
        storeName={order?.store?.name}
        signInPath={storeSignInPath}
        startNewOrderPath={startNewOrderPath}
        onClose={() => setReviewOpen(false)}
        onSaved={(saved) => setHasReview(Boolean(saved))}
      />

      {isAdmin ? (
        <section className="panel picklist">
          <div className="panel__header">
            <h2 className="panel__title">Pick list</h2>
            <span className="muted small">
              {pickList.length} line{pickList.length === 1 ? '' : 's'} ·{' '}
              {totalUnits} item{totalUnits === 1 ? '' : 's'} to collect · walk
              the racks in this order
            </span>
          </div>

          {pickList.length === 0 ? (
            <p className="muted">This order has no items to collect.</p>
          ) : (
            <ol className="picklist__rows">
              {pickList.map((row) => {
                const located = Boolean(row.rack || row.shelf);

                return (
                  <li
                    key={`${row.name}-${row.rack}-${row.shelf}`}
                    className={`picklist__row ${located ? '' : 'picklist__row--unlocated'}`}
                  >
                    {/* The photo, so the picker recognises the item and not just
                        its name. Falls back to the same bag glyph the catalogue
                        card uses when a product has no image. */}
                    {row.image ? (
                      <img
                        className="picklist__img"
                        src={row.image}
                        alt=""
                        loading="lazy"
                      />
                    ) : (
                      <span
                        className="picklist__img picklist__img--empty"
                        aria-hidden="true"
                      >
                        🛍️
                      </span>
                    )}

                    <span className="picklist__name">
                      <strong>{row.name}</strong>
                      {/* Which option to grab. Its own line because "Large / Blue"
                          is the difference between picking the right thing off the
                          shelf and putting the wrong one in the bag. */}
                      {row.variantTitle ? (
                        <em className="picklist__variant">{row.variantTitle}</em>
                      ) : null}
                      {row.category ? (
                        <em className="muted small"> {row.category}</em>
                      ) : null}
                      {!row.known ? (
                        <em className="muted small"> — removed from the catalogue</em>
                      ) : null}
                    </span>

                    {/* How many to put in the bag. Stated in words as well as a
                        number so a glance is never ambiguous. */}
                    <span
                      className="picklist__qty"
                      title={`${row.quantity} ordered`}
                    >
                      <strong>{row.quantity}</strong>
                      <em>ordered</em>
                    </span>

                    {located ? (
                      <span className="picklist__where">
                        {row.rack ? <span className="chip">Rack {row.rack}</span> : null}
                        {row.shelf ? (
                          <span className="chip">Shelf {row.shelf}</span>
                        ) : null}
                      </span>
                    ) : (
                      <span className="chip chip--danger">No location</span>
                    )}
                  </li>
                );
              })}
            </ol>
          )}

          {unlocated.length > 0 ? (
            <p className="alert alert--warn">
              {unlocated.length} line{unlocated.length === 1 ? '' : 's'} without a
              rack — set one in the product catalogue to speed up picking.
            </p>
          ) : null}
        </section>
      ) : null}

      <div className="tracker-grid">
        <section className="panel">
          <h2 className="panel__title">Progress</h2>

          {status === ORDER_STATUS.CANCELLED ? (
            <p className="alert alert--danger">This order was cancelled.</p>
          ) : (
            <ol className="timeline">
              {timeline.map((entry) => (
                <li
                  key={entry.step}
                  className={`timeline__item ${entry.done ? 'is-done' : ''} ${
                    entry.current ? 'is-current' : ''
                  }`}
                >
                  <span className="timeline__dot" aria-hidden="true" />
                  {formatStatus(entry.step)}
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* The customer's closing sequence, present from the moment the order is
            placed - not just once it is delivered. A shopper watching a fresh
            order can see that confirming receipt is coming, and a guest is told
            why they cannot do it yet instead of being shown nothing. The admin
            and rider variants of this page never get it: they must not close or
            review somebody else's delivery on the customer's behalf. */}
        {!isStaffView && !isCancelled ? (
          <section className="panel receive">
            <h2 className="panel__title">Confirm your delivery</h2>
            <p className="panel__subtitle">
              {customerHasReceived
                ? 'Thanks for confirming. Tell the store how it went.'
                : riderHasDelivered
                  ? 'Your rider has delivered this order. Confirm it once it is in your hands, then rate the delivery.'
                  : 'When your rider delivers this order, the button below turns on so you can confirm it reached you.'}
            </p>

            {/* Where the order is in the hand-off, so the button is never a
                mystery. Mirrors the Progress timeline above in words. */}
            <ol className="close-steps">
              {closingSteps.map((step) => (
                <li
                  key={step.key}
                  className={`close-steps__item${step.done ? ' is-done' : ''}${
                    step.key === currentStepKey ? ' is-current' : ''
                  }`}
                >
                  <span className="close-steps__dot" aria-hidden="true" />
                  {step.label}
                </li>
              ))}
            </ol>

            {receiveError ? (
              <p className="alert alert--danger">{receiveError}</p>
            ) : null}

            {/* The one button the user asked for. It is always in the same
                place; only its label and enabled state change. */}
            {customerHasReceived ? (
              isOrderOwner ? (
                /* The form itself lives in the popup, not inline, so the review is
                   fetched and rendered in exactly one place. This button is how
                   you open it - now or later. */
                <div className="button-row">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setReviewOpen(true)}
                  >
                    {hasReview ? 'Edit your review' : 'Rate this delivery'}
                  </button>
                  <Link className="btn btn-outline" to={startNewOrderPath}>
                    Start a new order
                  </Link>
                  <span className="muted small">
                    {hasReview
                      ? 'Thanks for reviewing.'
                      : 'You can review any time — this page keeps your order.'}
                  </span>
                </div>
              ) : (
                /* A guest confirmed their own delivery - the button above did
                   that for them, token and all - but a rating has to belong to an
                   account, so this is the one step they cannot finish here.
                   Offered without blocking anything: they can order again now. */
                <div className="button-row">
                  <Link className="btn btn-outline" to={startNewOrderPath}>
                    Start a new order
                  </Link>
                  <span className="muted small">
                    <Link to={storeSignInPath}>Sign in</Link> to rate this
                    delivery.
                  </span>
                </div>
              )
            ) : riderHasDelivered ? (
              canConfirmReceived ? (
                <div className="button-row">
                  <button
                    type="button"
                    className="btn"
                    onClick={confirmReceived}
                    disabled={receiving}
                  >
                    {receiving
                      ? 'Confirming…'
                      : 'Confirm delivery received'}
                  </button>
                </div>
              ) : (
                <p className="alert alert--warn">
                  This order has been delivered.{' '}
                  <Link to={storeSignInPath}>Sign in</Link> to confirm you
                  received it and leave a review.
                </p>
              )
            ) : (
              <div className="button-row">
                <button type="button" className="btn" disabled>
                  Confirm delivery received
                </button>
                <span className="muted small">
                  Waiting for your rider to deliver.
                </span>
              </div>
            )}
          </section>
        ) : null}

        {/*
          Back office only. A customer watching their own delivery sees the
          Progress timeline, not the kitchen's timings - "store prep 12 min /
          wait 3 min / ride 40s" is the store's and the rider's evidence, and
          the audit-trail notes (who accepted it, who moved it on) are internal.
          Gated on isStaffView, so the admin and rider variants keep it.
        */}
        {isStaffView ? (
          <section className="panel">
            <h2 className="panel__title">Timing</h2>

            {steps.length === 0 ? (
              <p className="muted">
                No timing recorded yet - the times appear as the order progresses.
              </p>
            ) : (
              <>
                <p className="timing__headline">
                  {timings.isDelivered ? (
                    <>
                      <strong>{formatDurationMs(timings.totalMs)}</strong> from
                      order to doorstep
                    </>
                  ) : timings.isCancelled ? (
                    <>
                      <strong>—</strong> cancelled before it was delivered
                    </>
                  ) : (
                    <>
                      <strong>{formatDurationMs(runningMs)}</strong> so far
                    </>
                  )}
                </p>

                {/* The three legs, so "it took 50 minutes" can be attributed to
                    the kitchen or the rider rather than just stated. */}
                <ul className="legs">
                  {[
                    { key: 'prepMs', label: 'Store prep', hint: 'placed → ready' },
                    { key: 'waitMs', label: 'Waited', hint: 'ready → picked up' },
                    { key: 'rideMs', label: 'Ride', hint: 'picked up → delivered' },
                  ].map((leg) => (
                    <li key={leg.key} className="leg leg--plain">
                      <span className="leg__label">
                        {leg.label}
                        <span className="muted small block">{leg.hint}</span>
                      </span>
                      <strong className="leg__value">
                        {formatDurationMs(timings[leg.key])}
                      </strong>
                    </li>
                  ))}
                </ul>

                {/* Every progress update, when it happened and how long the step
                    before it lasted - the full audit trail. */}
                <ol className="steps">
                  {steps.map((step, index) => (
                    <li
                      key={`${step.status}-${step.at.getTime()}-${index}`}
                      className="steps__row"
                    >
                      <span className="steps__label">
                        <strong>{formatStatus(step.status)}</strong>
                        {step.note ? (
                          <span className="muted small block">{step.note}</span>
                        ) : null}
                      </span>

                      <span className="steps__time muted small">
                        {formatTime(step.at)}
                      </span>

                      <span className="steps__since">
                        {index === 0 ? (
                          <span className="muted small">start</span>
                        ) : (
                          <span className="muted small">
                            {formatDurationMs(step.sinceMs)} earlier
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </section>
        ) : null}

        <section className="panel">
          <h2 className="panel__title">Items</h2>

          <ul className="summary__lines">
            {(order?.items || []).map((item, index) => (
              <li key={`${item.name}-${index}`}>
                <span className="summary__line-name">
                  {item.name}
                  {/* The shopper's own words from checkout, so a receipt months
                      later still says which option they bought. */}
                  {item.variantTitle ? (
                    <em className="summary__line-variant"> {item.variantTitle}</em>
                  ) : null}
                  <em>× {item.quantity}</em>
                </span>
                <span>{formatCurrency(item.price * item.quantity)}</span>
              </li>
            ))}
          </ul>

          <dl className="summary__totals">
            <div>
              <dt>Subtotal</dt>
              <dd>{formatCurrency(order?.subtotal)}</dd>
            </div>
            <div>
              <dt>Delivery</dt>
              <dd>
                {order?.deliveryFee ? formatCurrency(order.deliveryFee) : 'Free'}
              </dd>
            </div>
            <div className="summary__grand">
              <dt>Total</dt>
              <dd>{formatCurrency(order?.total)}</dd>
            </div>
          </dl>
        </section>

        <section className="panel">
          <h2 className="panel__title">Rider</h2>

          {order?.rider ? (
            <>
              <p>
                <strong>{order.rider.name}</strong>
              </p>
              {order.rider.phone ? (
                <p className="muted">☎ {order.rider.phone}</p>
              ) : null}
              {riderLocation ? (
                <p className="muted small">
                  Last ping: {riderLocation.lat?.toFixed?.(5)},{' '}
                  {riderLocation.lng?.toFixed?.(5)}
                </p>
              ) : (
                <p className="muted">Waiting for a GPS ping…</p>
              )}
            </>
          ) : (
            <p className="muted">
              No rider assigned yet. They will appear here as soon as the store
              assigns one.
            </p>
          )}

          <h3 className="panel__subtitle">Delivery address</h3>
          <p>{order?.address?.line1}</p>
          {order?.address?.city ? <p>{order.address.city}</p> : null}
          {order?.address?.phone ? (
            <p className="muted">☎ {order.address.phone}</p>
          ) : null}
        </section>
      </div>
    </div>
  );
}

import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import OrderReview from './OrderReview';

/**
 * "How was it?" - the star rating + note popup.
 *
 * Opens by itself the moment a customer confirms they received a delivery,
 * because that is the one moment they definitely have the parcel in front of
 * them and the rating is worth the most. It is dismissible, though: nobody
 * should be trapped in a review they do not want to write, and the form stays
 * reachable from the order page afterwards.
 *
 * Two variants:
 *   canReview - the signed-in customer who placed the order gets the real form.
 *   otherwise - a guest confirmed their own parcel (the guestToken lets them,
 *     see PATCH /orders/:id/receive) but cannot RATE it, because a review has
 *     to be attributable to an account. They get the thank-you and a way to
 *     sign in, rather than a form that would only fail.
 *
 * Escape closes it, the scrim closes it, and the page behind is scroll-locked -
 * all copied from CustomerAccountSheet so the two overlays behave identically.
 */
export default function ReviewDialog({
  orderId,
  open,
  canReview,
  storeName,
  signInPath,
  startNewOrderPath,
  onClose,
  onSaved,
}) {
  // Where to put the caret when the popup opens, so Escape and Tab have
  // somewhere sensible to go. The panel itself is the fallback.
  const panelRef = useRef(null);
  // The parent passes an inline arrow for onClose, so its identity changes on
  // every render of the page. Holding it in a ref keeps this effect keyed on
  // `open` alone - otherwise every parent render would tear down and re-apply
  // the body scroll-lock and the Escape listener.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKey = (event) => {
      if (event.key === 'Escape') onCloseRef.current?.();
    };
    window.addEventListener('keydown', handleKey);

    // Move focus in so a keyboard/screen-reader user is inside the dialog
    // rather than still on the page behind it.
    panelRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="review-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="review-dialog-title"
    >
      <button
        type="button"
        className="review-dialog__scrim"
        aria-label="Close"
        onClick={onClose}
      />

      <div
        className="review-dialog__panel"
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="review-dialog__head">
          <strong id="review-dialog-title">
            {canReview ? 'How was your delivery?' : 'Delivery received'}
          </strong>
          <button
            type="button"
            className="review-dialog__close"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {canReview ? (
          <>
            <p className="muted small review-dialog__lede">
              Give {storeName ? storeName : 'the store'} a rating out of five and
              tell them how it went. It takes a moment, and it helps the next
              shopper.
            </p>

            {/* The same form the order page uses, so "rate it now" and "rate it
                later" are literally the same component with the same state. */}
            <OrderReview orderId={orderId} onSaved={onSaved} />
          </>
        ) : (
          <>
            <p className="muted small review-dialog__lede">
              Thanks for confirming. You ordered without an account, and a
              rating has to belong to one - so sign in and you can leave your
              stars and a note for the store.
            </p>

            <div className="button-row">
              <Link className="btn btn-sm" to={signInPath} onClick={onClose}>
                Sign in to review
              </Link>
              <Link
                className="btn btn-ghost btn-sm"
                to={startNewOrderPath}
                onClick={onClose}
              >
                Start a new order
              </Link>
            </div>
          </>
        )}

        {canReview ? (
          <div className="button-row review-dialog__skip">
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
              Maybe later
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
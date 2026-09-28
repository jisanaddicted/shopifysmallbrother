import { useEffect, useRef, useState } from 'react';
import orderService from '../../services/orderService';
import { formatDateTime } from '../../utils/formatters';

const MAX_COMMENT = 500;

/** The stars, as a plain number so the buttons stay simple. */
const STARS = [1, 2, 3, 4, 5];

const RATING_WORDS = {
  1: 'Bad',
  2: 'Not great',
  3: 'Okay',
  4: 'Good',
  5: 'Excellent',
};

/**
 * "How was it?" - the customer's star rating plus an optional note, on the
 * order they have confirmed receipt of.
 *
 * Opens empty the first time and pre-filled when a review already exists, so
 * this one component is both "write a review" and "edit my review"; the button
 * says which. There is one review per order (the API overwrites rather than
 * stacking), which is why a second submit is an edit and not a second opinion.
 *
 * The rating is whole stars only. Half stars are not offered because the
 * server rejects them, and a control that can produce an error the user cannot
 * see the cause of is worse than a simpler one.
 */
export default function OrderReview({ orderId, onSaved }) {
  const [review, setReview] = useState(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [hovered, setHovered] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // The parent hands down a fresh inline callback on every render, so it is held
  // in a ref rather than listed as an effect dependency - otherwise telling the
  // parent "here is the review I just loaded" would re-trigger the load, which
  // calls back again, forever.
  const onSavedRef = useRef(onSaved);
  useEffect(() => {
    onSavedRef.current = onSaved;
  });

  useEffect(() => {
    let cancelled = false;

    orderService
      .getOrderReview(orderId)
      .then((found) => {
        if (cancelled) return;
        setReview(found);
        setRating(found?.rating || 0);
        setComment(found?.comment || '');
        // Report an existing review on load too, so the page around this form
        // knows straight away that this order has already been reviewed (its
        // "thanks for reviewing" wording) rather than waiting for an edit.
        if (found) onSavedRef.current?.(found);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message || 'Could not load your review.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [orderId]);

  const submit = async (event) => {
    event.preventDefault();
    if (!rating || saving) return;

    setSaving(true);
    setError('');
    setNotice('');

    try {
      const saved = await orderService.submitOrderReview(orderId, {
        rating,
        comment,
      });
      setReview(saved);
      setNotice('Thank you - your review has been saved.');
      onSaved?.(saved);
    } catch (err) {
      setError(err.message || 'Could not save your review.');
    } finally {
      setSaving(false);
    }
  };

  const withdraw = async () => {
    if (busy) return;

    setBusy(true);
    setError('');
    setNotice('');

    try {
      await orderService.deleteOrderReview(orderId);
      setReview(null);
      setRating(0);
      setComment('');
      setNotice('Your review has been removed.');
      onSaved?.(null);
    } catch (err) {
      setError(err.message || 'Could not remove your review.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <p className="muted small">Loading your review…</p>;
  }

  const shown = hovered || rating;

  return (
    <form className="review" onSubmit={submit}>
      <div className="panel__header">
        <div>
          <h2 className="panel__title">How was it?</h2>
          <p className="panel__subtitle">
            {review
              ? 'Your review of this delivery. Change it any time.'
              : 'Rate this delivery and leave a note for the store.'}
          </p>
        </div>
      </div>

      {error ? <p className="alert alert--danger">{error}</p> : null}
      {notice ? <p className="alert alert--ok">{notice}</p> : null}

      {/* Stars. A radiogroup, so arrow keys and screen readers behave. */}
      <div
        className="stars"
        role="radiogroup"
        aria-label="Your rating out of five"
        onMouseLeave={() => setHovered(0)}
      >
        {STARS.map((star) => (
          <button
            key={star}
            type="button"
            role="radio"
            aria-checked={rating === star}
            aria-label={`${star} star${star === 1 ? '' : 's'} - ${RATING_WORDS[star]}`}
            className={`stars__star${star <= shown ? ' is-on' : ''}`}
            onMouseEnter={() => setHovered(star)}
            onFocus={() => setHovered(star)}
            onBlur={() => setHovered(0)}
            onClick={() => setRating(star)}
          >
            ★
          </button>
        ))}

        <span className="stars__word" aria-live="polite">
          {shown ? RATING_WORDS[shown] : 'Tap a star'}
        </span>
      </div>

      <label className="field">
        <span>Your note (optional)</span>
        <textarea
          rows={3}
          maxLength={MAX_COMMENT}
          value={comment}
          placeholder="What went well, or what could be better?"
          onChange={(event) => setComment(event.target.value)}
        />
        <span className="muted small">
          {comment.length}/{MAX_COMMENT}
        </span>
      </label>

      <div className="button-row">
        <button
          type="submit"
          className="btn btn-sm"
          disabled={!rating || saving}
        >
          {saving ? 'Saving…' : review ? 'Update review' : 'Send review'}
        </button>

        {review ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={withdraw}
            disabled={busy}
          >
            Remove
          </button>
        ) : null}

        {review?.createdAt ? (
          <span className="muted small">
            Saved {formatDateTime(review.createdAt)}
          </span>
        ) : null}
      </div>
    </form>
  );
}

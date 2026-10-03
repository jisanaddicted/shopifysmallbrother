import { useState } from 'react';
import storeService from '../../services/storeService';
import {
  PAYMENT_LOGO_CHANNELS,
  PAYMENT_METHOD_COLORS,
  PAYMENT_METHOD_LABELS,
} from '../../utils/constants';

/**
 * The Theme tab's payment-brand panel: one upload slot per online payment
 * channel, whose logo then appears on the checkout method picker.
 *
 * WHY OPTIONAL, PER CHANNEL. The default for every channel is already a coloured
 * chip carrying its initial, drawn from PAYMENT_METHOD_COLORS - which is why
 * this app looks finished before a merchant has uploaded anything. This control
 * is an upgrade to the real wordmark, so it must never be able to make the page
 * look WORSE: a channel with no upload simply keeps its chip, and there is no
 * state in which a payment option appears without something recognisable in it.
 *
 * WHY THE SLOT SHOWS THE FALLBACK, NOT AN EMPTY BOX. The preview is deliberately
 * the coloured chip, byte for byte what checkout draws today. A merchant choosing
 * between four brand marks has to judge them against what shoppers actually see
 * - on a white tile at the same size - not against an empty dashed rectangle.
 *
 * ONE REQUEST PER CHANNEL. `setPaymentLogo` sends a single-key object and the
 * server merges it (see storeService and updateMyStore), so uploading bKash can
 * never delete the other three. That is a server-side promise this component
 * relies on rather than re-implementing.
 *
 * Cash on delivery is absent on purpose - it is not a brand with artwork, and it
 * keeps its banknote glyph. The list comes from PAYMENT_LOGO_CHANNELS, which is
 * derived, so adding a channel to the backend adds a slot here automatically
 * rather than leaving a channel that can never be branded.
 */
export default function PaymentLogoPicker({ store, onChanged }) {
  const storeId = store?._id || store?.id;

  /* The channel whose upload is in flight, or null. A single value rather than a
     set, because saving one logo rewrites the whole `paymentLogos` map and two
     in-flight writes would race to be the last one standing. One at a time is
     the honest UI for that. */
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');

  const logos = store?.paymentLogos || {};

  const save = async (channel, file) => {
    setBusy(channel);
    setError('');
    try {
      const updated = await storeService.setPaymentLogo(
        channel,
        file,
        storeId,
      );
      onChanged?.(updated);
    } catch (err) {
      setError(
        err.message ||
          `Could not save the ${PAYMENT_METHOD_LABELS[channel]} logo.`,
      );
    } finally {
      setBusy(null);
    }
  };

  const onPick = (channel) => (event) => {
    const file = event.target.files?.[0];
    /* Clear the input's value so picking the SAME file twice still fires a
       change event. Without this a merchant who uploads the wrong picture,
       notices, and picks the same file again gets silence - which reads as a
       broken control rather than a stale input. */
    event.target.value = '';
    if (!file) return;
    save(channel, file);
  };

  return (
    <div className="pay-logos">
      {PAYMENT_LOGO_CHANNELS.map((channel) => {
        const uploaded = String(logos[channel] || '');
        const label = PAYMENT_METHOD_LABELS[channel] || channel;
        const isBusy = busy === channel;

        return (
          <div key={channel} className="pay-logo">
            {/* The preview: the uploaded mark, else exactly the chip checkout
                falls back to. Deliberately the same markup as the checkout's
                `.pay-method__logo` so what is approved here is what ships. */}
            <span
              className={`pay-logo__mark${uploaded ? ' has-image' : ''}`}
              style={
                uploaded
                  ? undefined
                  : { background: PAYMENT_METHOD_COLORS[channel] }
              }
            >
              {uploaded ? (
                <img src={uploaded} alt={`${label} logo`} />
              ) : (
                /* The letter is the visible mark, so it is hidden from assistive
                   tech and the sentence below carries the meaning - the same
                   pairing StoreHeader uses for a store with no logo. A screen
                   reader must not just hear the letter "B". */
                <>
                  <span aria-hidden="true">{(label[0] || '').toUpperCase()}</span>
                  <span className="sr-only">
                    {`No ${label} logo uploaded yet`}
                  </span>
                </>
              )}
            </span>

            <div className="pay-logo__body">
              <strong>{label}</strong>
              <span className="muted small">
                {uploaded ? 'Showing your logo at checkout.' : 'Using the default coloured chip.'}
              </span>
            </div>

            <div className="pay-logo__actions">
              <label
                className={`btn btn-outline btn-sm${isBusy ? ' is-disabled' : ''}`}
              >
                {isBusy ? 'Saving…' : uploaded ? 'Change' : 'Upload'}
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  disabled={isBusy}
                  aria-label={`Upload a ${label} logo`}
                  onChange={onPick(channel)}
                />
              </label>

              {uploaded ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm btn-danger"
                  onClick={() => save(channel, '')}
                  disabled={isBusy}
                >
                  Remove
                </button>
              ) : null}
            </div>
          </div>
        );
      })}

      {error ? (
        <div className="alert alert--danger pay-logos__error">
          {error}
        </div>
      ) : null}
    </div>
  );
}
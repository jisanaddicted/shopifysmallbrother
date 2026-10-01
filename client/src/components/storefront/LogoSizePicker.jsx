import { useEffect, useRef, useState } from 'react';
import storeService from '../../services/storeService';
import {
  LOGO_SIZE_MAX,
  LOGO_SIZE_MIN,
  LOGO_SIZE_STEP,
  logoSizePx,
} from '../../utils/constants';

/* How long the drag has to pause before the size is written.
 *
 * DEBOUNCED, and this is the whole difference between this control and the four
 * named sizes it replaced. Those were discrete: one click, one write. A slider
 * emits a change on every pixel of travel, and this project's database is a
 * network round trip measured in seconds - so saving per event would queue a
 * hundred four-second writes behind one drag, each refetching the store. The
 * preview moves instantly because it reads local state; the write happens once,
 * when the merchant stops. */
const SAVE_DELAY_MS = 700;

/**
 * The Theme tab's logo size control: a slider and a number box showing the same
 * size in PIXELS, under the logo uploader.
 *
 * A number, not a menu of named sizes, because the question being answered is
 * "how big do I want it" and a list of four can only offer four answers. The
 * slider explores; the number box lands on an exact value, which is the half a
 * slider alone cannot do - a drag can only ever reach the steps it has.
 *
 * The number is the DESKTOP size, and the control says so: a phone renders it at
 * roughly two thirds, capped at a third of the screen (see the media query on
 * `.store-header__logo`). Without that sentence a merchant who set 180 and then
 * checked their own phone would conclude the control does nothing - the one
 * impression this control must never give.
 *
 * OPTIMISTIC, for the reason ThemePicker is: the preview and the number move on
 * the drag, a save the server refuses puts both back with the reason, and the
 * store is never left showing a size it is not showing.
 */
export default function LogoSizePicker({ store, onChanged, onPreview }) {
  /* What the store has actually saved. A store with no `logoSize` is every store
     that predates this feature, so the fallback is the default, not a blank box. */
  const saved = logoSizePx(store?.logoSize);
  const storeId = store?._id || store?.id;

  /* The size on screen. This is the OPTIMISTIC value: it takes over from `saved`
     the moment the merchant touches anything, and is dropped when the write lands
     or fails. */
  const [size, setSize] = useState(saved);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  /* The pending write and the timer that will fire it, in refs because nothing
     renders from either - and a re-render between the drag and the write must not
     be able to drop the write. */
  const timerRef = useRef(null);
  const saveRef = useRef(null);

  const save = async (next) => {
    setSaving(true);
    setError('');
    try {
      const updated = await storeService.updateMyStore(
        { logoSize: next },
        storeId,
      );
      onChanged?.(updated);
    } catch (err) {
      // Back to the saved size, and say why. A refused size that leaves the
      // preview showing a logo the storefront is not drawing is worse than one
      // that visibly bounces back.
      setSize(saved);
      onPreview?.(saved);
      setError(err.message || 'Could not change the logo size.');
    } finally {
      setSaving(false);
    }
  };
  saveRef.current = save;

  /* Move immediately, write later. The preview and the number follow the drag
     because they read `size`; the write is what waits. */
  const change = (raw) => {
    const next = logoSizePx(raw);
    setSize(next);
    onPreview?.(next);

    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      saveRef.current?.(next);
    }, SAVE_DELAY_MS);
  };

  /* A drag left mid-air - the merchant clicked away, or closed the tab - would
     otherwise leave a timer holding a size that was never written. Releasing the
     slider commits it immediately instead of losing it. */
  const commitNow = () => {
    if (!timerRef.current) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
    saveRef.current?.(size);
  };

  // Unmount drops a pending write - the control is leaving the page with it.
  useEffect(() => () => clearTimeout(timerRef.current), []);

/* Follow the store when it changes underneath us - a different storefront, or
   the value coming back from the server. Deliberately NOT on every render:
   a re-render mid-drag must not yank the slider out from under the merchant. */
  useEffect(() => {
    setSize(saved);
  }, [saved, storeId]);

  /* The typed box is allowed to hold mid-typing nonsense - "1" on the way to
     "150" - which must not be clamped under the cursor. Its own string state,
     handed to `change` only once it is a usable number. */
  const [typed, setTyped] = useState('');

  const onType = (event) => {
    const raw = event.target.value;
    setTyped(raw);
    if (raw.trim() !== '' && Number.isFinite(Number(raw))) {
      change(Number(raw));
    }
  };

  /* Leaving the box puts the display back in step with reality: clamped, or back
     to the saved size if what was typed was not a number at all. Also commits
     immediately, for the same reason releasing the slider does. */
  const settleTyped = () => {
    setTyped('');
    if (storeId && size !== saved) saveRef.current?.(size);
  };

  return (
    <div className={`logo-size${saving ? ' is-saving' : ''}`}>
      <div className="logo-size__head">
        <label className="logo-size__label" htmlFor="logo-size-slider">
          Logo size
        </label>
        <span className="muted small">
          {/* One expression, not wrapped prose: JSX would render the line break
              as a space anyway, and this way the sentence stays greppable. */}
          {`${size}px tall on a desktop · about ${Math.round(
            size * 0.66,
          )}px on a phone`}
        </span>
      </div>

      <div className="logo-size__row">
        <input
          id="logo-size-slider"
          className="logo-size__slider"
          type="range"
          min={LOGO_SIZE_MIN}
          max={LOGO_SIZE_MAX}
          step={LOGO_SIZE_STEP}
          value={size}
          onChange={(event) => change(Number(event.target.value))}
          onBlur={commitNow}
          aria-label={`Storefront logo size, ${size} pixels`}
        />

        <input
          className="logo-size__number"
          type="number"
          inputMode="numeric"
          min={LOGO_SIZE_MIN}
          max={LOGO_SIZE_MAX}
          step={LOGO_SIZE_STEP}
          /* Whatever is being typed wins while there is any, so a half-typed
             number is never rewritten under the cursor. */
          value={typed !== '' ? typed : size}
          onChange={onType}
          onBlur={settleTyped}
          aria-label="Logo size in pixels"
        />
        <span className="logo-size__unit" aria-hidden="true">
          px
        </span>
      </div>

      {/* Named in words while the write is in flight. A dimmed row is not
         enough on its own, and four seconds of silence reads as a dead
         control. */}
      <span className="muted small" role="status">
        {saving
          ? 'Saving…'
          : `Between ${LOGO_SIZE_MIN}px and ${LOGO_SIZE_MAX}px. Your storefront header logo is ${size}px tall.`}
      </span>

      {error ? <div className="alert alert--danger">{error}</div> : null}
    </div>
  );
}

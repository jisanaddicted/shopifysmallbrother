import { useState } from 'react';
import storeService from '../../services/storeService';
import { THEME_OPTIONS, themeLabel } from '../../utils/constants';

/**
 * The Theme tab's theme switch: Theme 1 or Theme 2, one active.
 *
 * RADIOS, not a <select>. There are exactly two, they are the most important
 * choice on the page, and both need to be visible at once with their
 * descriptions - a dropdown hides the alternative until it is opened, which is
 * the opposite of what "pick a layout" is asking for.
 *
 * OPTIMISTIC, and that is the whole answer to it feeling unselectable.
 *
 * Switching writes one field on one document, and measured against this
 * project's remote database that is a four-second round trip. The first version
 * waited for it with the radios greyed out and nothing said, so clicking Theme 2
 * looked like it had done nothing at all - and clicking again did nothing
 * either, because the control was already busy. It read as an unselectable
 * radio rather than a slow save.
 *
 * So the radio moves the instant it is clicked, the option being applied says
 * "Switching…", and a save the server refuses puts it back where it was with the
 * reason. The store on screen is never left claiming a layout it is not showing.
 *
 * Switching does NOT move data. Theme 1 reads each product's `category` string
 * and Theme 2 reads its `categoryId`, and they are populated independently, so a
 * store can go back and forth as often as it likes and lose nothing. This panel
 * says so, because "will this lose my categories" is the question every merchant
 * asks first and silence on it reads as a warning.
 */
export default function ThemePicker({ store, onChanged }) {
  // The theme being applied, or null when nothing is in flight. This is the
  // OPTIMISTIC value: it takes over from the store the moment a radio is
  // clicked, and is dropped when the save lands or fails.
  const [pending, setPending] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  /* What the store has actually saved. A store whose `theme` is missing is
     every store that predates this feature, so the fallback is Theme 1 and not
     an empty picker. */
  const saved = store?.theme || THEME_OPTIONS[0].value;
  const storeId = store?._id || store?.id;

  // What the picker shows. The pending choice wins while a save is in flight.
  const current = pending || saved;

  const pick = async (theme) => {
    // `pending` rather than a boolean: a second click while a save is running
    // is ignored outright, which is why the first version felt like a dead
    // control rather than a busy one.
    if (theme === current || pending || !storeId) return;

    setPending(theme);
    setError('');
    setNotice('');

    try {
      const updated = await storeService.updateMyStore({ theme }, storeId);
      onChanged?.(updated);
      setNotice(`Now showing ${themeLabel(theme)}.`);
    } catch (err) {
      // Back to the saved value, and say why - a refused switch that leaves the
      // radio on the wrong theme is worse than one that visibly bounced back.
      setError(err.message || 'Could not change the theme.');
    } finally {
      setPending(null);
    }
  };

  return (
    <section className="panel theme-picker">
      <div className="theme-picker__head">
        <h2 className="panel__title">Storefront theme</h2>
        <p className="muted small">
          How your shop is laid out. You can switch between them whenever you
          like - your categories and products are kept for both, so nothing is
          lost by trying one out.
        </p>
      </div>

      {error ? <div className="alert alert--danger">{error}</div> : null}
      {notice ? <div className="alert alert--ok">{notice}</div> : null}

      <div className="theme-picker__options" role="radiogroup" aria-label="Storefront theme">
        {THEME_OPTIONS.map((option) => {
          const active = option.value === current;
          const saving = option.value === pending;

          return (
            <label
              key={option.value}
              className={`theme-option${active ? ' is-active' : ''}${saving ? ' is-saving' : ''}`}
            >
              <input
                type="radio"
                name="store-theme"
                value={option.value}
                checked={active}
                /* Deliberately NOT disabled while saving. A greyed-out radio
                   looks broken, and this is the control the merchant is trying
                   to use; `pick` already ignores a second click, and the
                   "Switching…" line below is what tells them the first one
                   landed. */
                onChange={() => pick(option.value)}
              />
              <span className="theme-option__body">
                <strong>{option.label}</strong>
                <span className="muted small">{option.summary}</span>
                {saving ? (
                  /* Visible proof the click registered. Without it, the only
                     feedback is a four-second silence. */
                  <span className="theme-option__saving" role="status">
                    Switching…
                  </span>
                ) : null}
              </span>
            </label>
          );
        })}
      </div>
    </section>
  );
}

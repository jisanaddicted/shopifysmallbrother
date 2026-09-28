import { useMemo, useState } from 'react';
import { PRODUCT_STATUS_LABELS, PRODUCT_STATUS_VALUES } from '../../utils/constants';

/**
 * The bulk edit panel.
 *
 * Every control is opt-in: a field left blank or on "Leave unchanged" sends
 * nothing for that field, and the server treats an absent key as "do not
 * touch". That is the whole contract between this form and PATCH
 * /products/bulk, and it is why the panel can offer eight changes at once
 * without the merchant having to think about which of them they actually
 * meant - filling in two boxes changes two things and leaves the rest alone.
 *
 * A separate component rather than more markup in ProductManager because it is
 * a self-contained form with its own open/closed state: it has to exist in the
 * DOM to keep what was typed while the merchant ticks something else off, and
 * the list re-renders on every selection change.
 */

// The options behind the two select+number pairs. "Leave unchanged" is first
// so a freshly opened panel changes nothing until the merchant chooses.
const PRICE_MODES = [
  { value: '', label: 'Leave price unchanged' },
  { value: 'set', label: 'Set price to' },
  { value: 'increase_percent', label: 'Increase price by (%)' },
  { value: 'decrease_percent', label: 'Decrease price by (%)' },
];

const STOCK_MODES = [
  { value: '', label: 'Leave stock unchanged' },
  { value: 'set', label: 'Set stock to' },
  { value: 'increase', label: 'Add to stock' },
  { value: 'decrease', label: 'Remove from stock' },
];

const TRACK_OPTIONS = [
  { value: '', label: 'Leave unchanged' },
  { value: 'true', label: 'Track inventory' },
  { value: 'false', label: 'Do not track inventory' },
];

/** The panel's form, and the only place that decides what a blank means. */
const EMPTY_FORM = {
  status: '',
  productType: '',
  vendor: '',
  category: '',
  trackInventory: '',
  priceMode: '',
  price: '',
  stockMode: '',
  stock: '',
  collections: '',
};

/**
 * Turn the form into the request body.
 *
 * Returns `{}` when the merchant has not actually chosen anything, which is
 * what lets the Apply button be disabled rather than firing a request the
 * server would answer with a 400.
 *
 * The number fields are only sent when a MODE is chosen as well. That pairing
 * is the point: a stray "10" typed into a box whose mode still says "leave
 * unchanged" must not silently become "set every price to 10".
 */
function toChanges(form) {
  const changes = {};

  if (form.status) changes.status = form.status;
  if (form.productType) changes.productType = form.productType;
  if (form.vendor) changes.vendor = form.vendor;
  if (form.category) changes.category = form.category;
  if (form.trackInventory !== '') changes.trackInventory = form.trackInventory === 'true';

  if (form.priceMode && form.price !== '') {
    changes.priceMode = form.priceMode;
    changes.price = Number(form.price);
  }

  if (form.stockMode && form.stock !== '') {
    changes.stockMode = form.stockMode;
    changes.stock = Number(form.stock);
  }

  // Comma separated, because "Best sellers, New in" is how a merchant would
  // say it out loud and typing three separate one-line inputs for it would be
  // friction for no gain.
  const collections = form.collections
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (collections.length) changes.addCollections = collections;

  return changes;
}

/** Human summary of what the form will do, shown before anything is applied. */
function describe(changes) {
  const parts = [];
  if (changes.status) parts.push(`status → ${PRODUCT_STATUS_LABELS[changes.status]}`);
  if (changes.category) parts.push(`category → “${changes.category}”`);
  if (changes.productType) parts.push(`type → “${changes.productType}”`);
  if (changes.vendor) parts.push(`vendor → “${changes.vendor}”`);
  if (changes.trackInventory !== undefined) {
    parts.push(changes.trackInventory ? 'track inventory' : 'stop tracking inventory');
  }
  if (changes.price !== undefined) {
    const { priceMode, price } = changes;
    if (priceMode === 'set') parts.push(`price → ${price}`);
    else parts.push(`price ${priceMode === 'increase_percent' ? '+' : '−'}${price}%`);
  }
  if (changes.stock !== undefined) {
    const { stockMode, stock } = changes;
    if (stockMode === 'set') parts.push(`stock → ${stock}`);
    else parts.push(`stock ${stockMode === 'increase' ? '+' : '−'}${stock}`);
  }
  if (changes.addCollections) {
    parts.push(`add ${changes.addCollections.length} collection(s)`);
  }

  return parts;
}

export default function BulkEditPanel({ count, onApply, onDelete, busy }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');

  const set = (key) => (event) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const changes = useMemo(() => toChanges(form), [form]);
  const plan = useMemo(() => describe(changes), [changes]);
  const canApply = plan.length > 0;

  const apply = () => {
    if (!canApply) {
      setError('Choose at least one change first.');
      return;
    }
    setError('');
    onApply(changes);
  };

  const reset = () => {
    setForm(EMPTY_FORM);
    setError('');
  };

  return (
    <div className="bulkedit">
      <div className="bulkedit__head">
        <div>
          <h3>Bulk edit {count} product{count === 1 ? '' : 's'}</h3>
          <p className="muted small">
            Only the fields you fill in are changed. Anything left blank keeps
            its current value.
          </p>
        </div>

        <button type="button" className="btn btn-ghost btn-sm" onClick={reset}>
          Reset
        </button>
      </div>

      {error ? <p className="alert alert--danger bulkedit__error">{error}</p> : null}

      <div className="bulkedit__grid">
        <label className="field">
          <span>Status</span>
          <select value={form.status} onChange={set('status')}>
            <option value="">Leave unchanged</option>
            {PRODUCT_STATUS_VALUES.map((status) => (
              <option key={status} value={status}>
                {PRODUCT_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Category</span>
          <input
            type="text"
            value={form.category}
            onChange={set('category')}
            placeholder="Leave unchanged"
          />
        </label>

        <label className="field">
          <span>Type</span>
          <input
            type="text"
            value={form.productType}
            onChange={set('productType')}
            placeholder="Leave unchanged"
          />
        </label>

        <label className="field">
          <span>Vendor</span>
          <input
            type="text"
            value={form.vendor}
            onChange={set('vendor')}
            placeholder="Leave unchanged"
          />
        </label>

        <label className="field">
          <span>Inventory</span>
          <select value={form.trackInventory} onChange={set('trackInventory')}>
            {TRACK_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Collections to add</span>
          <input
            type="text"
            value={form.collections}
            onChange={set('collections')}
            placeholder="Leave unchanged — or “Summer, New in”"
          />
        </label>

        <label className="field">
          <span>Price</span>
          <select value={form.priceMode} onChange={set('priceMode')}>
            {PRICE_MODES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Price value</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={form.price}
            onChange={set('price')}
            disabled={!form.priceMode}
            placeholder={form.priceMode ? '0' : 'Choose an action first'}
          />
        </label>

        <label className="field">
          <span>Stock</span>
          <select value={form.stockMode} onChange={set('stockMode')}>
            {STOCK_MODES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Stock value</span>
          <input
            type="number"
            min="0"
            step="1"
            value={form.stock}
            onChange={set('stock')}
            disabled={!form.stockMode}
            placeholder={form.stockMode ? '0' : 'Choose an action first'}
          />
        </label>
      </div>

      {/* The plan, in words, before it happens. A bulk edit touches every
          selected product at once, so the merchant gets to read back exactly
          what is about to be written rather than discovering it afterwards. */}
      <p className="bulkedit__plan">
        {canApply ? (
          <>
            <strong>This will change:</strong> {plan.join(' · ')}
          </>
        ) : (
          <span className="muted">Nothing selected to change yet.</span>
        )}
      </p>

      <div className="button-row">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={apply}
          disabled={!canApply || busy}
        >
          {busy ? 'Applying…' : `Apply to ${count}`}
        </button>

        <button
          type="button"
          className="btn btn-ghost btn-sm btn-danger"
          onClick={onDelete}
          disabled={busy}
        >
          Delete {count}
        </button>
      </div>
    </div>
  );
}

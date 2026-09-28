import { useCallback, useMemo } from 'react';

/**
 * The variant matrix editor: the part of the product form where a merchant
 * defines "Size: S, M, L", "Colour: Red, Blue" and then fills in the resulting
 * 2x3 grid of price, stock, SKU and photo.
 *
 * This is deliberately its own component rather than more markup inside
 * ProductManager. The matrix is a self-contained, stateful sub-problem with its
 * own rules, and folding it into the page would interleave its generated state
 * with the page's form state in one place, re-rendering the whole inventory
 * table on every keystroke.
 *
 * The one rule worth knowing: the matrix is DERIVED from the options, never held
 * as an independent list of rows. Rows come from the cartesian product of the
 * option values, and each row carries its own data keyed by its combination. A
 * merchant who types "Red" and then deletes it gets that row's data back if they
 * retype it, and a row whose combination no longer exists is simply not shown -
 * which is what the server does with it too, rather than destroying it.
 */

const MAX_OPTIONS = 3;

// A short default so a merchant who has just clicked "Add an option" has
// something to type over rather than one empty box.
const STARTER_VALUES = ['Small', 'Medium', 'Large'];

/** The cartesian product of the options, as `{ Size: 'S', Colour: 'Red' }` rows. */
function buildCombinations(options) {
  const usable = options
    .map((option) => ({
      name: option.name.trim(),
      values: (option.values || []).map((value) => value.trim()).filter(Boolean),
    }))
    .filter((option) => option.name && option.values.length);

  if (!usable.length) return [];

  return usable.reduce(
    (rows, option) =>
      rows.flatMap((row) =>
        option.values.map((value) => ({ ...row, [option.name]: value })),
      ),
    [{}],
  );
}

/**
 * A stable key for a combination.
 *
 * Sorted by option name so the key does not change just because the merchant
 * reordered the options - otherwise every row would look "new" on a reorder and
 * lose its data.
 */
const comboKey = (combination) =>
  Object.entries(combination)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `${name}:${value}`)
    .join('|');

/** The blank row a brand-new combination starts from. */
const blankRow = (combination) => ({
  optionValues: combination,
  price: '',
  compareAtPrice: '',
  sku: '',
  stock: '',
  image: '',
  enabled: true,
});

export default function VariantMatrix({ options, setOptions, variants, setVariants }) {
  // Every declared combination becomes a row. One that already has saved data
  // keeps it; a brand-new one starts blank, because guessing a price for a
  // merchant is worse than asking.
  const rows = useMemo(() => {
    const combinations = buildCombinations(options);
    const byCombo = new Map(variants.map((v) => [comboKey(v.optionValues || {}), v]));

    return combinations.map((combination) => {
      const key = comboKey(combination);
      return byCombo.get(key) || blankRow(combination);
    });
  }, [options, variants]);

  const setOption = (index, patch) =>
    setOptions((prev) =>
      prev.map((option, i) => (i === index ? { ...option, ...patch } : option)),
    );

  const addOption = () =>
    setOptions((prev) => [...prev, { name: '', values: STARTER_VALUES.slice() }]);

  const removeOption = (index) =>
    setOptions((prev) => prev.filter((_, i) => i !== index));

  const setValue = (optionIndex, valueIndex, value) =>
    setOption(optionIndex, {
      values: options[optionIndex].values.map((v, i) => (i === valueIndex ? value : v)),
    });

  const addValue = (optionIndex) =>
    setOption(optionIndex, { values: [...options[optionIndex].values, ''] });

  const removeValue = (optionIndex, valueIndex) =>
    setOption(optionIndex, {
      values: options[optionIndex].values.filter((_, i) => i !== valueIndex),
    });

  const setRow = (rowKey, patch) =>
    setVariants(rows.map((row) => (comboKey(row.optionValues) === rowKey ? { ...row, ...patch } : row)));

  /**
   * Apply one value to every row at once.
   *
   * Filling twelve prices by hand is the part of this form that makes people
   * give up, and almost every catalogue wants them identical anyway. A prompt()
   * rather than another field: it is a one-off action with no lasting state of
   * its own, so a modal with a form would be ceremony for a single number.
   */
  const applyToAll = (field) => {
    const label = field === 'price' ? 'price' : 'stock';
    const input = window.prompt(`Set this ${label} for every option. Leave blank to clear.`);
    if (input === null) return;

    const value = input.trim() === '' ? '' : Number(input);
    setVariants(rows.map((row) => ({ ...row, [field]: value })));
  };

  const headerNames = options.map((option) => option.name.trim()).filter(Boolean);

  return (
    <section className="vm">
      <header className="vm__head">
        <div>
          <h3 className="panel__title">Options</h3>
          <p className="panel__subtitle">
            Up to {MAX_OPTIONS} options, then fill in each combination below. Leave this
            empty for a simple product with one price and one stock level.
          </p>
        </div>

        {options.length < MAX_OPTIONS ? (
          <button type="button" className="btn btn-outline btn-sm" onClick={addOption}>
            + Add option
          </button>
        ) : null}
      </header>

      {options.map((option, index) => (
        <div className="vm__option" key={index}>
          <label className="field vm__option-name">
            <span>Name</span>
            <input
              value={option.name}
              maxLength={40}
              placeholder="Size"
              onChange={(event) => setOption(index, { name: event.target.value })}
            />
          </label>

          <div className="field vm__option-values">
            <span>Values</span>
            <div className="vm__chips">
              {option.values.map((value, valueIndex) => (
                <span className="vm__chip" key={valueIndex}>
                  <input
                    value={value}
                    maxLength={60}
                    placeholder="M"
                    aria-label={`${option.name || 'Option'} value ${valueIndex + 1}`}
                    onChange={(event) => setValue(index, valueIndex, event.target.value)}
                  />
                  <button
                    type="button"
                    aria-label={`Remove ${value || 'value'}`}
                    onClick={() => removeValue(index, valueIndex)}
                  >
                    ×
                  </button>
                </span>
              ))}

              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => addValue(index)}
              >
                + value
              </button>
            </div>
          </div>

          <button
            type="button"
            className="btn btn-ghost btn-sm vm__remove"
            onClick={() => removeOption(index)}
            aria-label={`Remove ${option.name || 'option'}`}
          >
            Remove
          </button>
        </div>
      ))}

      {rows.length ? (
        <div className="vm__matrix">
          <div className="vm__matrix-head">
            <h4>
              {rows.length} combination{rows.length === 1 ? '' : 's'}
            </h4>
            <div className="button-row">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => applyToAll('price')}>
                Set all prices
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => applyToAll('stock')}>
                Set all stock
              </button>
            </div>
          </div>

          <div className="table-wrap">
            <table className="table vm__table">
              <thead>
                <tr>
                  {headerNames.map((name) => (
                    <th key={name}>{name}</th>
                  ))}
                  <th>Price</th>
                  <th>Was</th>
                  <th>Stock</th>
                  <th>SKU</th>
                  <th>Photo URL</th>
                  <th />
                </tr>
              </thead>

              <tbody>
                {rows.map((row) => {
                  const key = comboKey(row.optionValues);
                  return (
                    <tr key={key}>
                      {Object.entries(row.optionValues).map(([name, value]) => (
                        <td key={name}>
                          <strong className="small">{value}</strong>
                        </td>
                      ))}

                      <td>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          className="vm__input"
                          value={row.price}
                          aria-label="Price"
                          onChange={(event) => setRow(key, { price: event.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          className="vm__input"
                          placeholder="—"
                          value={row.compareAtPrice}
                          aria-label="Compare-at price"
                          onChange={(event) => setRow(key, { compareAtPrice: event.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          className="vm__input"
                          value={row.stock}
                          aria-label="Stock"
                          onChange={(event) => setRow(key, { stock: event.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          className="vm__input"
                          maxLength={60}
                          value={row.sku}
                          aria-label="SKU"
                          onChange={(event) => setRow(key, { sku: event.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          className="vm__input"
                          value={row.image}
                          placeholder="Optional"
                          aria-label="Photo URL"
                          onChange={(event) => setRow(key, { image: event.target.value })}
                        />
                      </td>
                      <td>
                        {/* "Live" rather than a delete button on the row: a variant
                            that has already been ordered must not vanish from the
                            order history it is referenced by. */}
                        <label
                          className="vm__toggle"
                          title="Hide this option from the shop without deleting it"
                        >
                          <input
                            type="checkbox"
                            checked={row.enabled !== false}
                            aria-label="Available"
                            onChange={(event) => setRow(key, { enabled: event.target.checked })}
                          />
                          <span>Live</span>
                        </label>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}


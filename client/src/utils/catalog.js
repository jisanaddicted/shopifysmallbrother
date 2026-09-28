/**
 * Catalog helpers shared by the products table and the product editor.
 *
 * They exist so those two screens cannot disagree about what a product IS. The
 * table Status column and the editor status picker both read `statusOf`, so a
 * product can never be listed as Draft in one and Active in the other, and the
 * wording of the table Inventory column comes from the same place that decides
 * whether the editor offers a stock field at all.
 *
 * Like utils/variants.js, everything here is pure and takes the plain JSON the
 * API returns - no database, no fetch - so it is all safe to call while
 * rendering.
 */
import { PRODUCT_STATUS, PRODUCT_STATUS_LABELS, PRODUCT_STATUS_TONE } from './constants';
import { formatCurrency } from './formatters';

/**
 * The status a product is really in.
 *
 * Falls back to Active when the field is absent, which is what a product
 * created before statuses existed looks like. The server applies the same
 * default (see the schema and `resolveLineTarget`), so both sides agree on
 * what an unlabelled product is rather than the UI inventing a draft.
 */
export function statusOf(product) {
  return String(product?.status || '').trim() || PRODUCT_STATUS.ACTIVE;
}

export function statusLabel(product) {
  return PRODUCT_STATUS_LABELS[statusOf(product)] || PRODUCT_STATUS_LABELS[PRODUCT_STATUS.ACTIVE];
}

/** The badge class for a status - the shared tones, not a colour picked here. */
export function statusTone(product) {
  return PRODUCT_STATUS_TONE[statusOf(product)] || PRODUCT_STATUS_TONE[PRODUCT_STATUS.ACTIVE];
}

/** Is this product on the shelf? Mirrors the server isPublished virtual. */
export function isPublished(product) {
  return statusOf(product) === PRODUCT_STATUS.ACTIVE;
}

/** Does this product count stock at all? A made-to-order item does not. */
export function tracksInventory(product) {
  return product?.trackInventory !== false;
}

/** Units on hand, summed across the matrix when the product has variants. */
export function stockOnHand(product) {
  return Number(product?.totalStock ?? product?.stock ?? 0) || 0;
}

/** True when the row should print its stock figure in red. */
export function isOutOfStock(product) {
  return tracksInventory(product) && stockOnHand(product) <= 0;
}

/**
 * The Inventory column, in the shop own words.
 *
 * Three genuinely different situations, which is why this is a function and
 * not a single template expression:
 *
 *   - "Inventory not tracked" - a made-to-order item with no number to count.
 *     Printing "0" would be a lie, and printing any number would imply one
 *     exists.
 *   - "N in stock for M variants" - a matrix. The figure is the sum across the
 *     rows because a shopper can buy every one of them, and naming the row
 *     count stops anybody comparing the total against a single row.
 *   - "N in stock" - everything else.
 */
export function inventoryLabel(product) {
  if (!tracksInventory(product)) return 'Inventory not tracked';

  const total = stockOnHand(product);
  const rows = Number(product?.variants?.length ?? 0);

  if (rows > 1) return `${total} in stock for ${rows} variants`;

  return `${total} in stock`;
}

/**
 * The catalogue totals for whatever the merchant is currently looking at.
 *
 * Computed from the rows on screen rather than from a separate stats endpoint,
 * because after a filter the numbers that matter are the ones for the filtered
 * list. `inventoryValue` is the server own figure (cheapest price x total
 * stock), so it can never disagree with what a shopper would be charged.
 */
export function summarise(products = []) {
  const list = Array.isArray(products) ? products : [];
  const withStatus = (status) =>
    list.filter((product) => statusOf(product) === status).length;

  return {
    total: list.length,
    active: withStatus(PRODUCT_STATUS.ACTIVE),
    draft: withStatus(PRODUCT_STATUS.DRAFT),
    archived: withStatus(PRODUCT_STATUS.ARCHIVED),
    outOfStock: list.filter(isOutOfStock).length,
    withVariants: list.filter((product) => Number(product?.variants?.length ?? 0) > 0).length,
    inventoryValue: list.reduce(
      (sum, product) => sum + (Number(product?.inventoryValue) || 0),
      0,
    ),
  };
}

export function formatInventoryValue(value) {
  return formatCurrency(value);
}

export default {
  statusOf,
  statusLabel,
  statusTone,
  isPublished,
  tracksInventory,
  stockOnHand,
  isOutOfStock,
  inventoryLabel,
  summarise,
  formatInventoryValue,
};

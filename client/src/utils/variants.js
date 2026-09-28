/**
 * Client-side mirror of the server's `backend/src/utils/variants.js`.
 *
 * The two MUST agree. The server is the authority on price and stock - it
 * re-reads them and refuses any line it cannot resolve - but the storefront has
 * to decide which buttons to enable and what to print as the price before a
 * request is made. If the two disagreed, the shopper would be offered a dead
 * end and only discover it at checkout, which is the most annoying way this can
 * go wrong. The reasoning lives on the server copy; this one exists to match it.
 *
 * Everything here takes the plain JSON the API returns and never touches a
 * database, so it is all safe to call while rendering.
 */
import { formatCurrency } from './formatters';

const asNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Every value in this file is trimmed through here - the API may not have. */
const clean = (value) => String(value ?? '').trim();

/** Does this product offer a real choice? */
export function hasVariants(product) {
  return Array.isArray(product?.variants) && product.variants.length > 0;
}

/** The variants a shopper may see and buy. */
export function sellableVariants(product) {
  if (!hasVariants(product)) return [];
  return product.variants.filter((variant) => variant.enabled !== false);
}

/** The variant with this id, or null. Tolerates a string or a whole object. */
export function findVariant(product, variantId) {
  if (!hasVariants(product)) return null;
  const wanted = clean(variantId?._id || variantId?.id || variantId);
  if (!wanted) return null;

  return (
    product.variants.find((variant) => clean(variant._id || variant.id) === wanted) ||
    null
  );
}

/**
 * "L / Blue" - the label shown in the cart, on the receipt and in the pick list.
 */
export function variantTitle(variant) {
  if (!variant) return '';

  const joined = Object.values(variant.optionValues || {})
    .map(clean)
    .filter(Boolean)
    .join(' / ');

  return joined || clean(variant.title);
}

/** Every purchasable value of each option, keyed by option name. */
export function availableOptionValues(product) {
  const map = {};

  for (const option of product?.options || []) {
    const name = clean(option?.name);
    if (!name) continue;

    const values = new Set();
    for (const variant of sellableVariants(product)) {
      const value = clean(variant.optionValues?.[name]);
      if (value) values.add(value);
    }
    map[name] = [...values];
  }

  return map;
}

/**
 * Would this choice lead to something real?
 *
 * Drives the greyed-out buttons: pick "XL", and a colour that is not made in XL
 * shows as unavailable rather than letting the shopper hit a dead end later.
 */
export function hasCombination(product, selection) {
  const wanted = Object.entries(selection || {}).filter(([, value]) => clean(value));
  if (!wanted.length) return false;

  return sellableVariants(product).some((variant) => {
    const values = variant.optionValues || {};
    return wanted.every(([name, value]) => clean(values[name]) === clean(value));
  });
}

/**
 * Is this one value still reachable given what is ALREADY chosen?
 *
 * Deliberately looser than hasCombination: a value counts as reachable if some
 * variant carries it with the other options as currently set, ignoring the
 * option being tested. That is what makes a button come back to life the moment
 * the shopper changes their mind about another option, instead of only ever
 * narrowing toward nothing.
 */
export function isValueAvailable(product, optionName, value, selection) {
  const others = Object.entries(selection || {}).filter(
    ([name]) => name !== optionName,
  );

  return sellableVariants(product).some((variant) => {
    const values = variant.optionValues || {};
    if (clean(values[optionName]) !== clean(value)) return false;
    return others.every(([name, other]) => clean(values[name]) === clean(other));
  });
}

/** The variant a complete selection points at, or null. */
export function variantForSelection(product, selection) {
  const options = product?.options || [];
  if (!options.length) return null;

  const chosen = selection || {};
  const complete = options.every((option) => {
    const name = clean(option?.name);
    return name && clean(chosen[name]);
  });
  if (!complete) return null;

  return (
    sellableVariants(product).find((variant) => {
      const values = variant.optionValues || {};
      return options.every((option) => {
        const name = clean(option?.name);
        return clean(values[name]) === clean(chosen[name]);
      });
    }) || null
  );
}

/**
 * Open on a real choice rather than an empty picker the shopper must fill in
 * before they can do anything.
 */
export function defaultSelection(product) {
  const first = sellableVariants(product)[0];
  if (!first) return {};

  const selection = {};
  for (const option of product?.options || []) {
    const name = clean(option?.name);
    const value = clean(first.optionValues?.[name]);
    if (name && value) selection[name] = value;
  }
  return selection;
}

/**
 * What to print as the price on a card or in the product list.
 *
 * The rule is that nothing changes unless it must. A product with one price, or
 * a matrix where every row happens to cost the same, prints as a single number
 * exactly as it always did - a merchant who set six sizes all at the same price
 * should not suddenly see "From ৳500". Only a genuine spread earns the prefix.
 *
 * Reads `priceRange` from the API, which the server computes across the sellable
 * variants and collapses to the product's own price when there are none.
 */
export function formatProductPrice(product, format = formatCurrency) {
  if (!product?.hasVariants) return format(product?.price);

  const min = Number(product.priceRange?.min) || 0;
  const max = Number(product.priceRange?.max) || min;
  if (min === max) return format(min);

  return `From ${format(min)}`;
}

export default {
  hasVariants,
  sellableVariants,
  findVariant,
  variantTitle,
  availableOptionValues,
  hasCombination,
  isValueAvailable,
  variantForSelection,
  defaultSelection,
  formatProductPrice,
};


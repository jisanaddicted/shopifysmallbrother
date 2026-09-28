// ---------------------------------------------------------------------------
// Variant resolution - the ONE place that answers "which version of this
// product does this basket line mean?".
//
// This exists as a single shared function because that question gets asked in
// three separate places - the cart, the storefront and the order controller -
// and the moment two of them answer it differently you get a class of bug that
// is very hard to see: the cart says an item is in stock, the shop says it is
// not, and the checkout quietly prices it at the wrong number. One function,
// three callers, one answer.
//
// Everything here is PURE: plain objects in, plain result out, never throws.
// Deciding what a rejection means in HTTP terms is the controller's job, which
// keeps this testable and free of a request.
// ---------------------------------------------------------------------------

/** Does this product offer a real choice right now? */
export function hasVariants(product) {
  return Array.isArray(product?.variants) && product.variants.length > 0;
}

/** The variants a shopper is allowed to see and buy. */
export function sellableVariants(product) {
  if (!hasVariants(product)) return [];
  return product.variants.filter((variant) => variant.enabled !== false);
}

/**
 * Find a variant by its id, tolerating the several shapes an id arrives in.
 *
 * A cart line round-trips through `localStorage` as a plain string, and a freshly
 * posted line may still carry a whole sub-document, so both are accepted.
 * Returns null rather than throwing, because "no such variant" is a normal
 * answer here - an old cart referencing a deleted row - not an exception.
 */
export function findVariant(product, variantId) {
  if (!hasVariants(product)) return null;

  const wanted = String(
    variantId?._id || variantId?.id || variantId?.variantId || variantId || '',
  ).trim();
  if (!wanted) return null;

  return (
    product.variants.find((variant) => String(variant._id || variant.id) === wanted) ||
    null
  );
}

/**
 * Build the label for a variant row - "L / Blue".
 *
 * Derived from the option values the merchant actually set, falling back to the
 * stored `title` when those are absent (an imported product, say). Never returns
 * an empty string for a variant that exists, because a cart line with a blank
 * description is the one thing a shopper cannot interpret.
 */
export function variantTitle(variant) {
  if (!variant) return '';

  const values = variant.optionValues || {};
  const joined = Object.values(values)
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .join(' / ');

  if (joined) return joined;
  return String(variant.title || '').trim();
}


/**
 * The heart of it: turn a requested product + variant id into the concrete
 * price, stock and label the order line should be built from.
 *
 * Returns a result object rather than a bare value, because there are four
 * distinct outcomes and the caller must treat three of them as errors:
 *
 *   { ok: true,  variant, variantId, title, price, stock, image, sku }
 *   { ok: false, reason: 'no-variant' }       - the shopper must choose first
 *   { ok: false, reason: 'unknown-variant' }  - stale cart, variant deleted
 *   { ok: false, reason: 'disabled' }         - merchant switched it off
 *
 * The plain-product case (no variants at all) resolves to the product's own
 * price/stock with a null variant, which is what every product created before
 * this feature existed takes.
 */
export function resolveLineTarget(product, variantId) {
  if (!product) return { ok: false, reason: 'no-variant' };

  if (!hasVariants(product)) {
    return {
      ok: true,
      variant: null,
      variantId: null,
      title: '',
      price: Number(product.price) || 0,
      stock: Number(product.stock) || 0,
      image: String(product.image || '').trim(),
      sku: '',
    };
  }

  const variant = findVariant(product, variantId);

  // A variant product with NO variant id is the "add to cart" button firing
  // before the shopper picked a size. The storefront never allows it, so
  // reaching here means a crafted request - refused rather than quietly priced
  // at the base price, which would be a way to buy an XL shirt for the price of
  // a small one.
  if (!variant) {
    const wanted = String(
      variantId?._id || variantId?.id || variantId?.variantId || variantId || '',
    ).trim();
    return { ok: false, reason: wanted ? 'unknown-variant' : 'no-variant' };
  }

  if (variant.enabled === false) return { ok: false, reason: 'disabled' };

  return {
    ok: true,
    variant,
    variantId: String(variant._id || variant.id),
    title: variantTitle(variant),
    price: Number(variant.price) || 0,
    stock: Number(variant.stock) || 0,
    image: String(variant.image || '').trim() || String(product.image || '').trim(),
    sku: String(variant.sku || '').trim(),
  };
}

/**
 * The message a shopper should see for a failed resolution.
 *
 * `productName` is interpolated here rather than passed in by each caller so the
 * three reasons cannot drift apart in wording - they are all the same complaint,
 * about the same product, phrased for however the shopper got there.
 */
export function resolveErrorMessage(reason, productName = 'this product') {
  if (reason === 'disabled') {
    return `“${productName}” is no longer available in that option. Please choose another.`;
  }
  if (reason === 'unknown-variant') {
    return `That option of “${productName}” is no longer available. Please review your cart.`;
  }
  return `Please choose an option for “${productName}”.`;
}


/**
 * Every option value that is actually purchasable, keyed by option name.
 *
 * The storefront uses this to strike through combinations that do not exist,
 * which is the difference between a shopper choosing deliberately and choosing
 * a dead end. Blank values are dropped, so a half-finished option cannot
 * produce a button labelled "undefined".
 */
export function availableOptionValues(product) {
  const map = {};

  for (const option of product?.options || []) {
    const name = String(option?.name || '').trim();
    if (!name) continue;

    const values = new Set();
    for (const variant of sellableVariants(product)) {
      const value = String(variant.optionValues?.[name] ?? '').trim();
      if (value) values.add(value);
    }
    map[name] = [...values];
  }

  return map;
}

/**
 * Is this exact combination actually on sale?
 *
 * Used to disable one button within a matrix of choice buttons: after picking a
 * size, a colour that exists but not in that size shows as unavailable rather
 * than being left to fail at checkout.
 */
export function hasCombination(product, selection) {
  const wanted = Object.entries(selection || {}).filter(([, value]) =>
    String(value ?? '').trim(),
  );
  if (!wanted.length) return false;

  return sellableVariants(product).some((variant) => {
    const values = variant.optionValues || {};
    return wanted.every(
      ([name, value]) =>
        String(values[name] ?? '').trim() === String(value).trim(),
    );
  });
}

/**
 * Find the variant matching a complete selection, or null.
 *
 * Every option the product declares must be present in the selection - a
 * partial one must not resolve, or "add to cart" would fire on an incomplete
 * choice and the server would then reject it.
 */
export function variantForSelection(product, selection) {
  const wanted = product?.options || [];
  if (!wanted.length) return null;

  const chosen = selection || {};
  const complete = wanted.every((option) => {
    const name = String(option?.name || '').trim();
    return name && String(chosen[name] ?? '').trim();
  });
  if (!complete) return null;

  return (
    sellableVariants(product).find((variant) => {
      const values = variant.optionValues || {};
      return wanted.every((option) => {
        const name = String(option?.name || '').trim();
        return String(values[name] ?? '').trim() === String(chosen[name]).trim();
      });
    }) || null
  );
}

/**
 * Pick a sensible default selection - the first sellable variant's values.
 *
 * So the storefront opens with a size and colour already chosen rather than an
 * empty picker the shopper must click through before they can add anything, and
 * so a quick-add button always has a real variant to point at.
 */
export function defaultSelection(product) {
  const first = sellableVariants(product)[0];
  if (!first) return {};

  const selection = {};
  for (const option of product?.options || []) {
    const name = String(option?.name || '').trim();
    if (!name) continue;
    const value = String(first.optionValues?.[name] ?? '').trim();
    if (value) selection[name] = value;
  }
  return selection;
}

export default {
  hasVariants,
  sellableVariants,
  findVariant,
  variantTitle,
  resolveLineTarget,
  resolveErrorMessage,
  availableOptionValues,
  hasCombination,
  variantForSelection,
  defaultSelection,
};

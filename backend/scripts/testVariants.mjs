// Standalone check for the variant resolver. Run: node scripts/testVariants.mjs
import {
  hasVariants,
  resolveLineTarget,
  variantForSelection,
  hasCombination,
  availableOptionValues,
  defaultSelection,
} from '../src/utils/variants.js';

let pass = 0;
let fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass += 1;
  else {
    fail += 1;
    console.log(`  FAIL ${name}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`);
  }
};

// --- The legacy case: a product with no variants at all -------------------
const plain = { name: 'Mango', price: 120, stock: 7, image: 'm.jpg' };
check('plain product: hasVariants false', hasVariants(plain), false);
check('plain product: resolves to own price/stock', resolveLineTarget(plain, undefined), {
  ok: true, variant: null, variantId: null, title: '', price: 120, stock: 7, image: 'm.jpg', sku: '',
});
// A stale cart that still carries a variantId for a product that has none must
// not explode - it is simply ignored.
check('plain product ignores stray variantId', resolveLineTarget(plain, 'v-xyz'), {
  ok: true, variant: null, variantId: null, title: '', price: 120, stock: 7, image: 'm.jpg', sku: '',
});

// --- A real variant product ----------------------------------------------
const shirt = {
  name: 'Tee',
  options: [
    { name: 'Size', values: ['S', 'L'] },
    { name: 'Colour', values: ['Red', 'Blue'] },
  ],
  variants: [
    { _id: 'v1', title: '', price: 500, stock: 4, optionValues: { Size: 'S', Colour: 'Red' } },
    { _id: 'v2', title: '', price: 700, stock: 0, optionValues: { Size: 'L', Colour: 'Blue' } },
    { _id: 'v3', title: '', price: 600, stock: 9, optionValues: { Size: 'L', Colour: 'Red' }, enabled: false },
  ],
};
check('variant product: hasVariants true', hasVariants(shirt), true);
check('resolve by id -> correct price/stock/label', resolveLineTarget(shirt, 'v1'), {
  ok: true, variant: shirt.variants[0], variantId: 'v1', title: 'S / Red', price: 500, stock: 4, image: '', sku: '',
});
check('resolve accepts an object id', resolveLineTarget(shirt, { _id: 'v1' }).variantId, 'v1');
check('disabled variant refused', resolveLineTarget(shirt, 'v3').reason, 'disabled');
check('unknown id -> unknown-variant', resolveLineTarget(shirt, 'nope').reason, 'unknown-variant');
check('missing id -> no-variant', resolveLineTarget(shirt, undefined).reason, 'no-variant');
check('out-of-stock variant still resolves ok (stock 0)', resolveLineTarget(shirt, 'v2').stock, 0);
check('disabled variant excluded from option values', availableOptionValues(shirt), {
  Size: ['S', 'L'], Colour: ['Red', 'Blue'],
});
check('full selection resolves', variantForSelection(shirt, { Size: 'S', Colour: 'Red' })?._id, 'v1');
check('partial selection does NOT resolve', variantForSelection(shirt, { Size: 'S' }), null);
check('selection of a disabled combo does NOT resolve', variantForSelection(shirt, { Size: 'L', Colour: 'Red' }), null);
check('combination exists', hasCombination(shirt, { Size: 'S', Colour: 'Red' }), true);
check('combination is only disabled-vs-red', hasCombination(shirt, { Size: 'S', Colour: 'Red' }), true);
check('default selection skips disabled row', defaultSelection(shirt), { Size: 'S', Colour: 'Red' });

// --- The bug this whole design exists to prevent --------------------------
// A crafted order naming a variant product but no variant must NOT be priced
// at the product's base price.
const tamper = { name: 'Tee', price: 1, stock: 99, options: shirt.options, variants: shirt.variants };
check('TAMPER: variant product with no variant is refused', resolveLineTarget(tamper, null).ok, false);

console.log(`\nvariants: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

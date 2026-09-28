// Checks the Product model actually produces the shape the rest of the app
// reads: the virtuals, the generated sub-document ids, and the plain-product
// fallback. Run: node scripts/testProductModel.mjs
import Product from '../src/models/Product.js';

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

// A brand new product with nothing set: the "no variants" case every existing
// product in the database is in.
const plain = new Product({ name: 'Mango', price: 120, stock: 7 });
const plainJson = plain.toJSON();
check('plain: hasVariants false', plainJson.hasVariants, false);
check('plain: options default to []', plainJson.options, []);
check('plain: variants default to []', plainJson.variants, []);
check('plain: priceRange collapses to own price', plainJson.priceRange, { min: 120, max: 120 });
check('plain: totalStock is own stock', plainJson.totalStock, 7);

// A product with a real matrix.
const tee = new Product({
  name: 'Tee',
  price: 500,
  stock: 99,
  options: [
    { name: 'Size', values: ['S', 'L'] },
    { name: 'Colour', values: ['Red', 'Blue'] },
  ],
  variants: [
    { optionValues: { Size: 'S', Colour: 'Red' }, price: 500, stock: 3 },
    { optionValues: { Size: 'L', Colour: 'Red' }, price: 700, stock: 5, compareAtPrice: 900 },
    { optionValues: { Size: 'L', Colour: 'Blue' }, price: 700, stock: 0, enabled: false },
  ],
});
const teeJson = tee.toJSON();
check('variant: hasVariants true', teeJson.hasVariants, true);
check('variant: every row got an _id', teeJson.variants.every((v) => v._id), true);
check('variant: optionValues survived', teeJson.variants[0].optionValues, { Size: 'S', Colour: 'Red' });
check('variant: compareAtPrice kept', teeJson.variants[1].compareAtPrice, 900);
check('variant: compareAtPrice defaults to null', teeJson.variants[0].compareAtPrice, null);
check('variant: enabled defaults true', teeJson.variants[0].enabled, true);
// A disabled row must not drag the displayed range down, and must not count
// towards stock either.
check('variant: priceRange ignores disabled', teeJson.priceRange, { min: 500, max: 700 });
check('variant: totalStock ignores disabled', teeJson.totalStock, 8);
check('variant: imageCount counts only rows with a photo', teeJson.imageCount, 0);

// A negative stock or price must be rejected by the schema, not silently stored.
let rejected = 0;
const bad = new Product({ name: 'X', price: 1, stock: 0, variants: [{ optionValues: { A: '1' }, price: -5, stock: 0 }] });
const err = bad.validateSync();
if (err) rejected = 1;
check('negative variant price is rejected', rejected, 1);

// --- Publishing + organisation ---------------------------------------------
// A product created the way every product was created before these fields
// existed: active, counting stock, no vendor. Nothing here may change.
check('default: status is active', plainJson.status, 'active');
check('default: isPublished', plainJson.isPublished, true);
check('default: one channel', plainJson.channelCount, 1);
check('default: tracks inventory', plainJson.trackInventory, true);
check('default: no productType', plainJson.productType, '');
check('default: no vendor', plainJson.vendor, '');
check('default: no collections', plainJson.collections, []);
check('default: inventory value is price x stock', plainJson.inventoryValue, 840);

// A draft is invisible and unbuyable, and an archived one is the same - the
// difference is only ever what the merchant intends to do with it next.
for (const status of ['draft', 'archived']) {
  const off = new Product({ name: 'Hidden', price: 100, stock: 4, status }).toJSON();
  check(`${status}: not published`, off.isPublished, false);
  check(`${status}: on no channel`, off.channelCount, 0);
  // Still has a real price and stock - it is hidden, not deleted, and an order
  // that already points at it must still be able to resolve it.
  check(`${status}: price still readable`, off.priceRange, { min: 100, max: 100 });
}

// A status outside the enum is rejected rather than silently stored, which
// would otherwise put a typo'd product on the shelf.
let badStatus = 0;
if (new Product({ name: 'Typo', price: 1, status: 'publshed' }).validateSync()) badStatus = 1;
check('an unknown status is rejected', badStatus, 1);

// "I don't count these" - a made-to-order item. It must not be blocked at
// zero, and it must not be valued as though it had stock.
const untracked = new Product({
  name: 'Custom cake',
  price: 40,
  stock: 0,
  trackInventory: false,
}).toJSON();
check('untracked: is still published', untracked.isPublished, true);
check('untracked: is worth nothing', untracked.inventoryValue, 0);

// A variant product's value reads the matrix, not the seed price, so the
// figure cannot disagree with what a shopper is charged.
const valued = new Product({
  name: 'Tee',
  price: 500,
  stock: 99,
  options: [{ name: 'Size', values: ['S', 'L'] }],
  variants: [
    { optionValues: { Size: 'S' }, price: 500, stock: 3 },
    { optionValues: { Size: 'L' }, price: 700, stock: 5 },
  ],
}).toJSON();
check('matrix: value uses the cheapest price x total stock', valued.inventoryValue, 4000);

console.log(`\nproduct model: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

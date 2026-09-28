// End-to-end test for the variant system against a REAL MongoDB.
//
//   node scripts/testVariantIntegration.mjs
//
// The unit tests (testVariants, testProductModel, testVariantParity) prove the
// helpers agree with each other. They cannot prove that the DATABASE actually
// stores a matrix, that an `$inc` on a sub-document array really decrements one
// row rather than the product, or that a real order line round-trips its
// variant. Those are exactly the things that only go wrong against a real
// database, and this is the test that catches them.
//
// Everything it creates is namespaced with a timestamp and deleted in a finally
// block, so it is safe to run against the development database.
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';
import Product from '../src/models/Product.js';
import Order from '../src/models/Order.js';
import Store from '../src/models/Store.js';
import { resolveLineTarget } from '../src/utils/variants.js';
import { priceOrder } from '../src/utils/pricing.js';

const TAG = `vartest-${Date.now()}`;

let pass = 0;
let fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) {
    pass += 1;
    console.log(`  ok   ${name}`);
  } else {
    fail += 1;
    console.log(
      `  FAIL ${name}\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`,
    );
  }
};

const store = new Store({
  name: `Variant Test Store ${TAG}`,
  slug: TAG,
  owner: new mongoose.Types.ObjectId(),
});

/**
 * The exact stock-deduction shape the order controller uses, so this exercises
 * the real query rather than an idealised version of it.
 */
const deductStock = async (productId, variantId, quantity) =>
  variantId
    ? Product.updateOne(
        { _id: productId, 'variants._id': variantId },
        { $inc: { 'variants.$.stock': -quantity } },
      )
    : Product.updateOne({ _id: productId }, { $inc: { stock: -quantity } });

async function main() {
  await connectDB();
  console.log(`\nVariant integration test (${TAG})\n`);

  try {
    await store.save();

    // --- A product that predates this feature ----------------------------
    const legacy = await Product.create({
      name: `Legacy Mango ${TAG}`,
      price: 120,
      stock: 7,
      store: store._id,
    });
    check(
      'legacy product stores no variants',
      (await Product.findById(legacy._id)).variants.length,
      0,
    );
    check('legacy hasVariants is false', legacy.toJSON().hasVariants, false);
    check(
      'legacy resolves to its own price',
      resolveLineTarget(legacy.toObject(), null).price,
      120,
    );

    // --- A product with a real matrix -------------------------------------
    const tee = await Product.create({
      name: `Cotton Tee ${TAG}`,
      price: 500, // the seed; the real prices live on the rows
      stock: 0, // deliberately zero: the product total must come from the matrix
      store: store._id,
      options: [
        { name: 'Size', values: ['S', 'L'] },
        { name: 'Colour', values: ['Red', 'Blue'] },
      ],
      variants: [
        { sku: `${TAG}-SR`, price: 500, stock: 4, optionValues: { Size: 'S', Colour: 'Red' } },
        { sku: `${TAG}-LR`, price: 700, stock: 6, compareAtPrice: 900, optionValues: { Size: 'L', Colour: 'Red' } },
        { sku: `${TAG}-LB`, price: 700, stock: 0, optionValues: { Size: 'L', Colour: 'Blue' } },
        { sku: `${TAG}-SB`, price: 500, stock: 3, optionValues: { Size: 'S', Colour: 'Blue' }, enabled: false },
      ],
    });

    const asJson = (await Product.findById(tee._id)).toJSON();

    check('all four rows persisted', asJson.variants.length, 4);
    check(
      'every row got a real ObjectId',
      asJson.variants.every((v) => v._id instanceof mongoose.Types.ObjectId),
      true,
    );
    check('optionValues survived the round trip', asJson.variants[0].optionValues, {
      Size: 'S',
      Colour: 'Red',
    });
    check('compareAtPrice survived', asJson.variants[1].compareAtPrice, 900);
    check('enabled:false survived', asJson.variants[3].enabled, false);
    check('hasVariants virtual', asJson.hasVariants, true);
    check('priceRange ignores the disabled row', asJson.priceRange, { min: 500, max: 700 });
    check('totalStock ignores the disabled row', asJson.totalStock, 10);

    const bySku = (sku) => asJson.variants.find((v) => v.sku === sku);
    const smallRed = bySku(`${TAG}-SR`);
    const largeRed = bySku(`${TAG}-LR`);
    const largeBlue = bySku(`${TAG}-LB`);

    // --- The resolver, against real persisted ids -------------------------
    check('resolve small red', resolveLineTarget(asJson, smallRed._id).price, 500);
    check('resolve names the variant', resolveLineTarget(asJson, smallRed._id).title, 'S / Red');
    check(
      'an out-of-stock variant is still a valid target',
      resolveLineTarget(asJson, largeBlue._id).ok,
      true,
    );
    check(
      'out-of-stock reports zero',
      resolveLineTarget(asJson, largeBlue._id).stock,
      0,
    );
    check(
      'a disabled variant is refused',
      resolveLineTarget(asJson, asJson.variants[3]._id).reason,
      'disabled',
    );
    check(
      'a missing id is refused',
      resolveLineTarget(asJson, undefined).reason,
      'no-variant',
    );
    check(
      'an unknown id is refused',
      resolveLineTarget(asJson, new mongoose.Types.ObjectId()).reason,
      'unknown-variant',
    );

    // --- THE key one: does $inc hit ONE row, not the whole product? -------
    await deductStock(tee._id, smallRed._id, 2);
    const afterDecrement = (await Product.findById(tee._id)).toJSON();

    check(
      'the ordered row lost 2',
      afterDecrement.variants.find((v) => v.sku === `${TAG}-SR`).stock,
      2,
    );
    check(
      'a sibling row is untouched',
      afterDecrement.variants.find((v) => v.sku === `${TAG}-LR`).stock,
      6,
    );
    check('the product total followed the matrix', afterDecrement.totalStock, 8);
    check(
      'the product seed stock was NOT decremented',
      afterDecrement.stock,
      0,
    );

    // A plain product still decrements exactly the way it always did.
    await deductStock(legacy._id, null, 3);
    check(
      'legacy product still decrements its own stock',
      (await Product.findById(legacy._id)).stock,
      4,
    );

    // --- An order line round-trips its variant ---------------------------
    const target = resolveLineTarget(asJson, largeRed._id);
    const order = await Order.create({
      store: store._id,
      items: [
        {
          product: tee._id,
          variant: target.variantId,
          variantTitle: target.title,
          compareAtPrice: target.variant.compareAtPrice,
          sku: target.sku,
          name: `Cotton Tee ${TAG}`,
          price: target.price,
          quantity: 2,
        },
      ],
      ...priceOrder([{ price: target.price, quantity: 2 }]),
      status: 'pending',
      statusHistory: [{ status: 'pending', note: 'variant test' }],
    });

    const rereadOrder = await Order.findById(order._id);
    const line = rereadOrder.items[0];
    check('order line kept the variant id', String(line.variant), String(largeRed._id));
    check('order line kept the label', line.variantTitle, 'L / Red');
    check('order line kept the SKU', line.sku, `${TAG}-LR`);
    check('order line kept the compare-at', line.compareAtPrice, 900);
    check('order line priced from the DB', line.price, 700);
    check('subtotal is server-priced', rereadOrder.subtotal, 1400);
    check('total is server-priced', rereadOrder.total, 1400);

    // A legacy order line must still load with every new field empty, not
    // undefined - this is what an order placed before the feature looks like.
    const legacyOrder = await Order.create({
      store: store._id,
      items: [
        { product: legacy._id, name: legacy.name, price: 120, quantity: 1 },
      ],
      ...priceOrder([{ price: 120, quantity: 1 }]),
      status: 'pending',
      statusHistory: [{ status: 'pending', note: 'legacy test' }],
    });
    const legacyLine = (await Order.findById(legacyOrder._id)).items[0];
    check('legacy order line has no variant', legacyLine.variant, null);
    check('legacy order line has an empty label', legacyLine.variantTitle, '');
    check('legacy order line still totals right', legacyOrder.total, 120);
  } finally {
    // Clean up everything this run created, so repeated runs stay honest.
    await Order.deleteMany({ store: store._id });
    await Product.deleteMany({ store: store._id });
    await Store.deleteOne({ _id: store._id });
    await disconnectDB();
  }

  console.log(`\nvariant integration: ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error('\nvariant integration CRASHED:', err.message);
  process.exit(1);
});


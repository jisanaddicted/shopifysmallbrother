// Creates a demo product WITH a variant matrix, so the storefront picker and the
// merchant's matrix editor can be eyeballed in a browser with something real to
// look at. Safe to re-run: it deletes any previous "Demo ..." product first.
//
//   node scripts/seedVariantDemo.mjs
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';
import Product from '../src/models/Product.js';
import Store from '../src/models/Store.js';

async function main() {
  await connectDB();

  const store = await Store.findOne({ slug: 'joes-pizza' }) || await Store.findOne();
  if (!store) {
    console.error('No store found. Run `npm run seed` first.');
    process.exit(1);
  }

  await Product.deleteMany({ name: /^Demo /, store: store._id });

  const tee = await Product.create({
    name: 'Demo Cotton Tee',
    price: 500,
    stock: 0,
    category: 'Apparel',
    rack: 'A7',
    shelf: '2',
    image: '',
    description: 'A soft cotton tee, sold in three sizes and two colours.',
    store: store._id,
    options: [
      { name: 'Size', values: ['S', 'M', 'L'] },
      { name: 'Colour', values: ['Red', 'Blue'] },
    ],
    variants: [
      { sku: 'DEMO-S-RED', price: 500, stock: 4, optionValues: { Size: 'S', Colour: 'Red' } },
      { sku: 'DEMO-M-RED', price: 500, stock: 8, optionValues: { Size: 'M', Colour: 'Red' } },
      { sku: 'DEMO-L-RED', price: 500, stock: 2, compareAtPrice: 700, optionValues: { Size: 'L', Colour: 'Red' } },
      { sku: 'DEMO-S-BLU', price: 520, stock: 5, optionValues: { Size: 'S', Colour: 'Blue' } },
      { sku: 'DEMO-M-BLU', price: 520, stock: 6, optionValues: { Size: 'M', Colour: 'Blue' } },
      // Deliberately no "L / Blue" and no "S / Blue" is disabled - both are
      // missing from the matrix, so the storefront must show Blue as
      // unavailable once S or M is chosen. That is the interesting case.
      { sku: 'DEMO-L-BLU', price: 540, stock: 3, optionValues: { Size: 'L', Colour: 'Blue' }, enabled: false },
    ],
  });

  // A plain product alongside it, to prove the unchanged path still renders.
  await Product.create({
    name: 'Demo Plain Mango',
    price: 120,
    stock: 12,
    category: 'Fruit',
    description: 'No options at all - this is the path that already existed.',
    store: store._id,
  });

  console.log(`Seeded into "${store.name}":`);
  console.log(`  ${tee.name} - ${tee.variants.length} variants`);
  console.log(`  Demo Plain Mango - no variants`);
  await disconnectDB();
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});

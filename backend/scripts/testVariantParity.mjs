// Checks the CLIENT copy of the variant helpers agrees with the SERVER copy on
// the same inputs, and that a legacy product renders exactly as it did before
// variants existed.
//
// The two implementations are written separately on purpose - one runs in the
// browser, one next to the database - so the thing that can silently rot is the
// pair agreeing. A disagreement here is a shopper who is shown a price the
// server will not honour. Run: node scripts/testVariantParity.mjs
import * as server from '../src/utils/variants.js';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Load the REAL client file, with its two local imports removed.
 *
 * This deliberately does not re-implement the client helpers: a test that copies
 * the logic proves nothing about the logic that actually ships. The only edit is
 * stripping `import { formatCurrency } from './formatters'` and the constants
 * import, because those pull in the app's bundler-resolved modules and this runs
 * in plain Node. `formatCurrency` is only a default argument, and every check
 * below passes its own formatter instead, so removing it changes nothing about
 * what is being verified.
 */
async function loadClientModule() {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(
    join(here, '..', '..', 'client', 'src', 'utils', 'variants.js'),
    'utf8',
  );

  // Only the import lines go. `formatCurrency` is left in place: it is just the
  // default value of an optional parameter, and every check below passes its own
  // formatter, so it is never actually called here.
  const stripped = source.replace(/^\s*import[^;]+;\s*$/gm, '');

  const dir = mkdtempSync(join(tmpdir(), 'varcheck-'));
  const file = join(dir, 'variants.mjs');
  writeFileSync(file, stripped, 'utf8');

  return import(pathToFileURL(file).href);
}

const client = await loadClientModule();

let pass = 0;
let fail = 0;
const same = (name, a, b) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (ok) pass += 1;
  else {
    fail += 1;
    console.log(`  DIVERGED ${name}\n    client ${JSON.stringify(a)}\n    server ${JSON.stringify(b)}`);
  }
};
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass += 1;
  else {
    fail += 1;
    console.log(`  FAIL ${name}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`);
  }
};

const plain = { name: 'Mango', price: 120, stock: 7, hasVariants: false, priceRange: { min: 120, max: 120 } };
const tee = {
  name: 'Tee',
  hasVariants: true,
  priceRange: { min: 500, max: 700 },
  options: [
    { name: 'Size', values: ['S', 'L'] },
    { name: 'Colour', values: ['Red', 'Blue'] },
  ],
  variants: [
    { _id: 'v1', price: 500, stock: 4, optionValues: { Size: 'S', Colour: 'Red' } },
    { _id: 'v2', price: 700, stock: 0, optionValues: { Size: 'L', Colour: 'Blue' } },
    { _id: 'v3', price: 600, stock: 9, optionValues: { Size: 'L', Colour: 'Red' }, enabled: false },
  ],
};

// --- Parity ----------------------------------------------------------------
same('hasVariants(plain)', client.hasVariants(plain), server.hasVariants(plain));
same('hasVariants(tee)', client.hasVariants(tee), server.hasVariants(tee));
same('sellableVariants length', client.sellableVariants(tee).map((v) => v._id), server.sellableVariants(tee).map((v) => v._id));
same('availableOptionValues', client.availableOptionValues(tee), server.availableOptionValues(tee));
same('defaultSelection', client.defaultSelection(tee), server.defaultSelection(tee));
same('hasCombination hit', client.hasCombination(tee, { Size: 'S', Colour: 'Red' }), server.hasCombination(tee, { Size: 'S', Colour: 'Red' }));
same('hasCombination miss', client.hasCombination(tee, { Size: 'S', Colour: 'Blue' }), server.hasCombination(tee, { Size: 'S', Colour: 'Blue' }));
same('variantForSelection full', client.variantForSelection(tee, { Size: 'S', Colour: 'Red' })?._id, server.variantForSelection(tee, { Size: 'S', Colour: 'Red' })?._id);
same('variantForSelection partial', client.variantForSelection(tee, { Size: 'S' }), server.variantForSelection(tee, { Size: 'S' }));
same('variantTitle', client.variantTitle(tee.variants[0]), server.variantTitle(tee.variants[0]));

// The server's resolver and the client's selection resolver must agree on WHICH
// row a shopper means - this is the join between the two halves.
for (const sel of [{ Size: 'S', Colour: 'Red' }, { Size: 'L', Colour: 'Blue' }]) {
  const viaSelection = client.variantForSelection(tee, sel);
  const viaId = server.resolveLineTarget(tee, viaSelection?._id);
  same(`selection->price ${JSON.stringify(sel)}`, viaSelection?.price, viaId.price);
  same(`selection->title ${JSON.stringify(sel)}`, client.variantTitle(viaSelection), viaId.title);
}

// --- Legacy display --------------------------------------------------------
// A product with no variants must render EXACTLY as it did before this feature.
check('legacy: plain price has no "From"', client.formatProductPrice(plain, (n) => `#${n}`), '#120');
check('legacy: single price, no variants', client.formatProductPrice({ ...plain, hasVariants: true, priceRange: { min: 300, max: 300 } }, (n) => `#${n}`), '#300');
check('variants: real spread gets "From"', client.formatProductPrice(tee, (n) => `#${n}`), 'From #500');

// isValueAvailable is client-only (the server has no use for it), so it is
// checked against expectations rather than parity.
check('reachable: same size', client.isValueAvailable(tee, 'Size', 'S', { Colour: 'Red' }), true);
check('unreachable: blue not made in S', client.isValueAvailable(tee, 'Colour', 'Blue', { Size: 'S' }), false);
check('reachable again after changing mind', client.isValueAvailable(tee, 'Colour', 'Blue', { Size: 'L' }), true);
check('disabled-only combo is not reachable', client.isValueAvailable(tee, 'Size', 'L', { Colour: 'Red' }), false);

console.log(`\nvariant parity: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

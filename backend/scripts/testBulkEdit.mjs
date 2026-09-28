// Bulk editing: PATCH /products/bulk and POST /products/bulk/delete.
//
// This is the only test that runs against a LIVE server, because every rule
// worth checking here is a rule about what the endpoint does to real documents
// in a real store - the partial-update contract, the per-product store check,
// the variant rows, and the fact that one failure must not abandon the rest.
// None of that can be observed from a detached object.
//
//   npm --prefix backend run test:bulk
//
// It creates its own products and deletes them again, so it is safe to run
// against the development database. It refuses to run without a base URL:
//
//   BULK_API=https://xxx.trycloudflare.com/api node scripts/testBulkEdit.mjs
//
// (defaults to the backend's own .env BACKEND_URL + /api, which is what makes
// it work through the tunnel with no extra setup).
﻿// Read the base URL the same way the rest of the backend does, so the
// test follows BACKEND_URL in .env rather than a URL frozen into a test.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(resolve(here, '../.env'), 'utf8');
const fromEnv = (env.match(/^BACKEND_URL=(.*)$/m)?.[1] || '').trim();
const API = (process.env.BULK_API || (fromEnv ? fromEnv + '/api' : 'http://localhost:5000/api')).replace(/\/+$/, '');
console.log('testing', API, '\n');
let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else { fail++; console.log(`  FAIL ${name}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); }
};

// Every option other than `token` becomes part of the request body, so a call
// reads as the endpoint signature does: ids and the change fields are siblings.
const call = async (m, p, opts = {}) => {
  const { token, ...body } = opts;
  const r = await fetch(API + p, {
    method: m,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    // A GET/HEAD must not carry a body; fetch throws if it does.
    body: ['GET', 'HEAD'].includes(m) ? undefined : JSON.stringify(body),
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
const get = async (id) => (await call('GET', '/products?status=all&limit=100', {})).data.products.find((p) => p.id === id);

const s = await call('POST', '/auth/login', { email: 'store@example.com', password: 'password123' });
const token = s.data.token;

const mk = async (name, extra = {}) =>
  (await call('POST', '/products', { token, name, price: 100, category: 'Old', stock: 10, ...extra })).data.product;

const a = await mk('Bulk Alpha', { vendor: 'OldVendor', collections: ['Keep'] });
const b = await mk('Bulk Beta', { price: 55.55, collections: ['Keep'] });

// --- 1. Partial update: only the NAMED field changes ----------------------
let r = await call('PATCH', '/products/bulk', { token, ids: [a.id, b.id], vendor: 'NewVendor' });
check('bulk vendor: 200', r.status, 200);
check('bulk vendor: both updated', r.data.updated.length, 2);
check('alpha vendor changed', (await get(a.id)).vendor, 'NewVendor');
check('beta vendor changed', (await get(b.id)).vendor, 'NewVendor');
check('CATEGORY left alone (alpha)', (await get(a.id)).category, 'Old');
check('CATEGORY left alone (beta)', (await get(b.id)).category, 'Old');
check('collections left alone', (await get(a.id)).collections, ['Keep']);
check('stock left alone', (await get(a.id)).stock, 10);

// --- 2. Percentage price, and the variant row ----------------------------
r = await call('PATCH', '/products/bulk', { token, ids: [b.id], priceMode: 'decrease_percent', price: 10 });
check('percent decrease on 55.55 -> 50', (await get(b.id)).price, 50);

const tee = (await call('POST', '/products', {
  token, name: 'Bulk Tee', price: 200,
  options: [{ name: 'Size', values: ['S', 'L'] }],
  variants: [
    { optionValues: { Size: 'S' }, price: 200, stock: 5 },
    { optionValues: { Size: 'L' }, price: 300, stock: 5 },
  ],
})).data.product;
await call('PATCH', '/products/bulk', { token, ids: [tee.id], priceMode: 'increase_percent', price: 10 });
check('matrix: EVERY row went up 10%', (await get(tee.id)).variants.map((v) => v.price), [220, 330]);

// --- 3. Stock: set, clamp at zero, add -----------------------------------
await call('PATCH', '/products/bulk', { token, ids: [a.id], stockMode: 'set', stock: 3 });
check('stock set to 3', (await get(a.id)).stock, 3);
await call('PATCH', '/products/bulk', { token, ids: [a.id], stockMode: 'decrease', stock: 99 });
check('stock clamps at 0, never negative', (await get(a.id)).stock, 0);
await call('PATCH', '/products/bulk', { token, ids: [a.id], stockMode: 'increase', stock: 7 });
check('stock add', (await get(a.id)).stock, 7);

// --- 4. Collections are ADDED, not replaced ------------------------------
await call('PATCH', '/products/bulk', { token, ids: [a.id], addCollections: ['Summer', 'summer', '  '] });
check('added + deduped, existing kept', (await get(a.id)).collections, ['Keep', 'Summer']);

// --- 5. A product that does not track stock ignores a stock edit ----------
const cake = await mk('Bulk Cake', { stock: 0, trackInventory: false });
await call('PATCH', '/products/bulk', { token, ids: [cake.id], stockMode: 'set', stock: 50 });
check('untracked product ignores a stock edit', (await get(cake.id)).stock, 0);

// --- 6. Publishing status hides them from the shelf ----------------------
r = await call('PATCH', '/products/bulk', { token, ids: [a.id, b.id], status: 'draft' });
check('bulk draft: both updated', r.data.updated.length, 2);
const pub = (await call('GET', '/products?limit=100')).data.products;
check('drafts gone from the public shelf', pub.filter((p) => [a.id, b.id].includes(p.id)).length, 0);
check('draft by id is 404', (await call('GET', `/products/${a.id}`)).status, 404);

// --- 7. Validation -------------------------------------------------------
check('no ids -> 400', (await call('PATCH', '/products/bulk', { token, ids: [] })).status, 400);
check('no changes -> 400', (await call('PATCH', '/products/bulk', { token, ids: [a.id] })).status, 400);
check('bad status -> 400', (await call('PATCH', '/products/bulk', { token, ids: [a.id], status: 'nope' })).status, 400);
check('bad price mode -> 400', (await call('PATCH', '/products/bulk', { token, ids: [a.id], priceMode: 'double', price: 1 })).status, 400);
check('0% change -> 400', (await call('PATCH', '/products/bulk', { token, ids: [a.id], priceMode: 'increase_percent', price: 0 })).status, 400);
check('negative stock -> 400', (await call('PATCH', '/products/bulk', { token, ids: [a.id], stockMode: 'set', stock: -1 })).status, 400);
check('over the 200 cap -> 400', (await call('PATCH', '/products/bulk', { token, ids: Array.from({ length: 201 }, () => a.id) })).status, 400);

// --- 8. One bad id does not abandon the rest -----------------------------
r = await call('PATCH', '/products/bulk', { token, ids: [a.id, '507f1f77bcf86cd799439011'], status: 'active' });
check('partial run: 1 updated', r.data.updated.length, 1);
check('partial run: 1 skipped', r.data.skipped.length, 1);
check('partial run: 0 failed', r.data.failed.length, 0);
check('the skip names a reason', typeof r.data.skipped[0].reason, 'string');

// --- 9. Unauthenticated -------------------------------------------------
check('no token -> 401', (await call('PATCH', '/products/bulk', { ids: [a.id], status: 'draft' })).status, 401);

// --- 10. Bulk delete ---------------------------------------------------
r = await call('POST', '/products/bulk/delete', { token, ids: [tee.id, cake.id] });
check('bulk delete: 2 removed', r.data.deleted, 2);
check('bulk delete: none skipped', r.data.skipped.length, 0);
check('bulk delete no ids -> 400', (await call('POST', '/products/bulk/delete', { token, ids: [] })).status, 400);

await call('DELETE', `/products/${a.id}`, { token });
await call('DELETE', `/products/${b.id}`, { token });

console.log(`\nbulk edit: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

// Exercises the new category endpoints end-to-end, as the store owner.
// It creates and deletes one category, and puts the product it touches back
// exactly as it found it.
const BASE = process.env.BASE || 'http://localhost:5000/api';

const call = async (method, path, { token, body } = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
};

const check = (label, ok, detail = '') =>
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);

const login = await call('POST', '/auth/login', {
  body: { email: 'store@example.com', password: 'password123' },
});
check('store owner logs in', login.status === 200, `${login.status}`);
const token = login.data.token;

const store = (await call('GET', '/stores/mine', { token })).data?.store;
const storeId = store?._id || store?.id;
check('store resolves', Boolean(storeId), String(storeId));

// --- 1. The panel sees categories that came from products alone ----------
const before = await call('GET', `/menu/edit/${storeId}`, { token });
const beforeCats = before.data?.categories || [];
check(
  'GET edit returns [{ name, count }] objects',
  beforeCats.every((c) => typeof c.name === 'string' && typeof c.count === 'number'),
  JSON.stringify(beforeCats.slice(0, 3)),
);
check(
  'product-derived categories appear even before any is curated',
  beforeCats.length > 0,
  `${beforeCats.length} categories`,
);

// --- 2. Create one, with no products filed under it yet -------------------
/* A name that cannot collide with anything already in the store.
   Deliberately NOT "Drinks": the seed data already files products under that
   name, and a test that assumed an empty category would then be measuring the
   seed rather than its own work - and its cleanup would delete a category a
   real product belongs to. Stamped, so repeat runs stay independent. */
const CAT = `Test Section ${Date.now().toString(36)}`;

const created = await call('POST', `/menu/edit/${storeId}/categories`, {
  token,
  body: { name: CAT },
});
check('POST creates the category', created.status === 201, `${created.status}`);

const mine = (created.data?.categories || []).find((c) => c.name === CAT);
check('the new category is in the returned list', Boolean(mine));
check(
  'it reports 0 products until one is filed',
  mine?.count === 0,
  `count=${mine?.count}`,
);

// --- 3. Duplicates rejected, blanks rejected -----------------------------
const dupe = await call('POST', `/menu/edit/${storeId}/categories`, {
  token,
  body: { name: CAT.toLowerCase() },
});
check('a duplicate in another case is rejected', dupe.status === 409, `${dupe.status}`);

const blank = await call('POST', `/menu/edit/${storeId}/categories`, {
  token,
  body: { name: '   ' },
});
check('a blank name is rejected', blank.status === 400, `${blank.status}`);

// --- 4. The count is live: file a product under it -----------------------
/* Pick a product that is NOT already sitting in a leftover test category.

   This matters more than it looks. A previous run that was killed before its
   cleanup left test categories behind, and choosing a product from one of those
   means `originalCategory` is itself a test category - so this run's cleanup
   deletes the category the product is filed under and "restores" it into a
   category that no longer exists. The assertions then pass while the store
   drifts further from its real data every run.

   A product whose category is either empty or a real one (not stamped by this
   script) keeps the test self-contained. */
const CLEAN = /^(?!Test Section )/i;
const all = (await call('GET', '/products?status=all&limit=100', { token })).data
  ?.products || [];
const pizza =
  all.find((p) => !String(p.category || '').trim()) ||
  all.find((p) => CLEAN.test(String(p.category || '').trim())) ||
  all[0];

if (!pizza) {
  console.log('FAIL  this store has no products to test with');
  process.exit(1);
}
const originalCategory = String(pizza.category || '').trim();

/* If the chosen product is already filed somewhere real, that category is
   ours to restore later, but we must never DELETE it. Refuse rather than risk
   touching seeded data. */
if (originalCategory && !CLEAN.test(originalCategory)) {
  console.log(`FAIL  every product sits in a leftover test category (${originalCategory})`);
  console.log('      clean those up before re-running this test');
  process.exit(1);
}

/* PUT the product with everything it already had, changing only the
   category. The endpoint is a full replace, not a patch, so omitting a field
   would blank it - which is why the original is captured and put back at the
   end rather than being reconstructed from memory. */
const refile = (category) =>
  call('PUT', `/products/${pizza.id}`, {
    token,
    body: {
      name: pizza.name,
      price: pizza.price,
      stock: pizza.stock,
      rack: pizza.rack,
      shelf: pizza.shelf,
      description: pizza.description,
      image: pizza.image,
      status: pizza.status,
      options: pizza.options || [],
      variants: pizza.variants || [],
      category,
    },
  });

const filed = await refile(CAT);
check('a product can be filed under the new category', filed.status === 200, `${filed.status}`);

const afterFile = await call('GET', `/menu/edit/${storeId}`, { token });
const filled = (afterFile.data?.categories || []).find((c) => c.name === CAT);
check('the count went up with no re-linking', filled?.count === 1, `count=${filled?.count}`);

// --- 5. Case-insensitive merge, curated spelling wins --------------------
const MERGE = `${CAT} Merge`;
await call('POST', `/menu/edit/${storeId}/categories`, { token, body: { name: MERGE } });
await refile(MERGE.toUpperCase());
const merged = await call('GET', `/menu/edit/${storeId}`, { token });
const mergeRows = (merged.data?.categories || []).filter(
  (c) => c.name.toLowerCase() === MERGE.toLowerCase(),
);
check(
  `a product filed as "${MERGE.toUpperCase()}" merges into the curated "${MERGE}"`,
  mergeRows.length === 1 && mergeRows[0].name === MERGE && mergeRows[0].count === 1,
  mergeRows.map((c) => `${c.name}:${c.count}`).join(' | '),
);

// --- 6. Delete unfiles products but never destroys them ------------------
/* The product is filed under CAT at this point, so this delete has exactly one
   product to unfile and `clearedProducts` is an exact figure, not a lower
   bound. */
// --- 6. Delete unfiles products but never destroys them ------------------
/* Re-file under CAT first. Step 5 moved the product into MERGE to test the
   case-insensitive merge, so without this there would be nothing under CAT and
   `clearedProducts` would be a correct 0 rather than the 1 this is asserting. */
await refile(CAT);
const removed = await call(
  'DELETE',
  `/menu/edit/${storeId}/categories/${encodeURIComponent(CAT)}`,
  { token },
);
check('DELETE removes the category', removed.status === 200, `${removed.status}`);
check(
  'it reports how many products were unfiled',
  removed.data?.clearedProducts === 1,
  `cleared=${removed.data?.clearedProducts}`,
);

const survivor = await call('GET', `/products/${pizza.id}`, { token });
check('the product itself still exists', survivor.status === 200, `${survivor.status}`);
check(
  'its category is cleared, not the product removed',
  !String(survivor.data?.product?.category || '').trim(),
  `category="${survivor.data?.product?.category}"`,
);

// --- 7. A name that is not curated is a 404 -----------------------------
const ghost = await call(
  'DELETE',
  `/menu/edit/${storeId}/categories/${encodeURIComponent('No Such Category')}`,
  { token },
);
check('deleting an unknown category is a 404', ghost.status === 404, `${ghost.status}`);

/* --- 7b. THE REGRESSION: deleting a category that exists ONLY on products.

   The panel lists curated AND product-derived categories, and gives both a
   delete button. The guard for "does this exist?" used to consult only the
   curated list, so every product-derived category - which is nearly all of
   them, since most shops never curate one - returned 404 and the button did
   nothing at all.

   Caught in manual testing, not by the other checks, because CAT was always
   created through the API first and so was always curated. This block
   deliberately skips that step and relies on the product's own category. */
const derivedOnly = `${CAT} Derived`;
const refiled = await refile(derivedOnly);

const asListed = (await call('GET', `/menu/edit/${storeId}`, { token })).data
  ?.categories || [];
check(
  'a product-only category is listed by the panel',
  asListed.some((c) => c.name === derivedOnly && c.count === 1),
  refiled.status === 200 ? 'listed with count 1' : `refile failed ${refiled.status}`,
);

const delDerived = await call(
  'DELETE',
  `/menu/edit/${storeId}/categories/${encodeURIComponent(derivedOnly)}`,
  { token },
);
check(
  'deleting a product-only category succeeds (the regression)',
  delDerived.status === 200,
  `${delDerived.status} ${delDerived.data?.message || ''}`,
);
check(
  'and it unfiles that product',
  delDerived.data?.clearedProducts === 1,
  `cleared=${delDerived.data?.clearedProducts}`,
);
const afterDerived = (await call('GET', `/menu/edit/${storeId}`, { token })).data
  ?.categories || [];
check(
  'and it disappears from the panel list',
  !afterDerived.some((c) => c.name === derivedOnly),
);

// --- 8. Authorisation ---------------------------------------------------
const noAuth = await call('POST', `/menu/edit/${storeId}/categories`, {
  body: { name: 'Sneaky' },
});
check('creating a category without a token is refused', noAuth.status === 401, `${noAuth.status}`);

const rider = await call('POST', '/auth/login', {
  body: { email: 'rider@example.com', password: 'password123' },
});
const asRider = await call('POST', `/menu/edit/${storeId}/categories`, {
  token: rider.data.token,
  body: { name: 'Not Mine' },
});
check("a rider cannot touch this store's categories", asRider.status === 403, `${asRider.status}`);

// --- 9. Put everything back the way it was found -------------------------
await refile(originalCategory);
await call('DELETE', `/menu/edit/${storeId}/categories/${encodeURIComponent(MERGE)}`, {
  token,
});

/* --- 10. Category pictures --------------------------------------------
   The upload is a base64 data URL, so the checks that matter are: a valid
   image round-trips and comes back on the category, a bogus payload is
   refused, and clearing removes it. Runs after the delete tests so the
   category it uses is one this file created. */
const PIC = `${CAT} Picture`;
await call('POST', `/menu/edit/${storeId}/categories`, { token, body: { name: PIC } });
await refile(PIC);

// A real 1x1 PNG, so this is a genuine image payload and not a fake header.
const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const withImage = await call(
  'PUT',
  `/menu/edit/${storeId}/categories/${encodeURIComponent(PIC)}/image`,
  { token, body: { image: PNG_1PX } },
);
check('a valid image is accepted', withImage.status === 200, `${withImage.status}`);
const picRow = (withImage.data?.categories || []).find((c) => c.name === PIC);
check(
  'it comes back attached to that category',
  picRow?.image === PNG_1PX,
  `image length ${picRow?.image?.length ?? 0}`,
);

/* The picture must be readable by the STOREFRONT, which is the whole point.
   Checked against the PUBLIC /stores/:slug response - the exact payload
   ShopPage loads - rather than the edit endpoint that returned it, because
   those are two different serialisations and only one of them is the one a
   shopper ever sees.

   Deliberately NOT /stores/mine: that endpoint runs a deliberate field
   projection (see SESSION_STORE_FIELDS in utils/storeAccess.js) which omits
   heavy image fields, so it would report an empty map even for a picture that
   is stored and served perfectly. */
const slug = store?.slug;
const publicStore = await fetch(`${BASE}/stores/${slug}`).then((r) => r.json());
const picKey = PIC.toLowerCase();
check(
  'it is persisted and served to the public storefront',
  publicStore?.store?.categoryImages?.[picKey] === PNG_1PX,
  `public keys: ${Object.keys(publicStore?.store?.categoryImages || {}).join(', ') || '(none)'}`,
);

/* Case-insensitive, like everything else about categories: a product filed as
   a different spelling of the same name is still the same section, so it must
   still find the picture. */
const wrongCase = (withImage.data?.categories || []).filter(
  (c) => c.name.toLowerCase() === PIC.toLowerCase(),
);
check(
  'a differently-cased product still finds the picture',
  wrongCase.length === 1 && wrongCase[0].image === PNG_1PX,
);

/* --- Rejections ------------------------------------------------------ */
const badUrl = await call(
  'PUT',
  `/menu/edit/${storeId}/categories/${encodeURIComponent(PIC)}/image`,
  { token, body: { image: 'https://evil.example/beacon.png' } },
);
check(
  'a remote http(s) URL is refused',
  badUrl.status === 400,
  `${badUrl.status}`,
);

const scriptUrl = await call(
  'PUT',
  `/menu/edit/${storeId}/categories/${encodeURIComponent(PIC)}/image`,
  { token, body: { image: 'javascript:alert(1)' } },
);
check('a javascript: URL is refused', scriptUrl.status === 400, `${scriptUrl.status}`);

const wrongType = await call(
  'PUT',
  `/menu/edit/${storeId}/categories/${encodeURIComponent(PIC)}/image`,
  { token, body: { image: 'data:text/html;base64,PHNjcmlwdD4=' } },
);
check('a non-image data URL is refused', wrongType.status === 400, `${wrongType.status}`);

const unknownCat = await call(
  'PUT',
  `/menu/edit/${storeId}/categories/${encodeURIComponent('No Such Cat At All')}/image`,
  { token, body: { image: PNG_1PX } },
);
check(
  'a picture for a category that does not exist is a 404',
  unknownCat.status === 404,
  `${unknownCat.status}`,
);

const noAuthImg = await call(
  'PUT',
  `/menu/edit/${storeId}/categories/${encodeURIComponent(PIC)}/image`,
  { body: { image: PNG_1PX } },
);
check('uploading without a token is refused', noAuthImg.status === 401, `${noAuthImg.status}`);

const riderImg = await call(
  'PUT',
  `/menu/edit/${storeId}/categories/${encodeURIComponent(PIC)}/image`,
  { token: rider.data.token, body: { image: PNG_1PX } },
);
check("a rider cannot upload to this store's categories", riderImg.status === 403, `${riderImg.status}`);

/* The picture must have survived all of those rejections. */
const survived = (await call('GET', `/menu/edit/${storeId}`, { token })).data
  ?.categories || [];
check(
  'the picture survived the rejected uploads',
  survived.find((c) => c.name === PIC)?.image === PNG_1PX,
);

/* --- Clearing -------------------------------------------------------- */
const clearedImg = await call(
  'PUT',
  `/menu/edit/${storeId}/categories/${encodeURIComponent(PIC)}/image`,
  { token, body: { image: '' } },
);
check('an empty image clears the picture', clearedImg.status === 200, `${clearedImg.status}`);
check(
  'and it is gone from the category',
  !(clearedImg.data?.categories || []).find((c) => c.name === PIC)?.image,
);

/* --- Clean up -------------------------------------------------------- */
await refile(originalCategory);
await call('DELETE', `/menu/edit/${storeId}/categories/${encodeURIComponent(PIC)}`, {
  token,
});

const finalCats = (await call('GET', `/menu/edit/${storeId}`, { token })).data?.categories || [];
check(
  'cleanup removed every category this test created',
  !finalCats.some((c) => c.name === CAT || c.name === MERGE || c.name === PIC),
  finalCats.map((c) => c.name).join(', '),
);
const restored = (await call('GET', `/products/${pizza.id}`, { token })).data?.product;
check(
  'the product is back in its original category',
  (restored?.category || '') === (originalCategory || ''),
  `"${restored?.category}"`,
);

console.log('\nfinal categories:', JSON.stringify(finalCats));

/* Re-fetch for the final picture check. `publicStore` was captured part-way
   through this file, BEFORE the cleanup ran, so reading it again here would
   report the store as it looked mid-test - which is how an earlier version of
   this file "found" an orphan that the API had in fact already removed. */
const finalStore = await fetch(`${BASE}/stores/${slug}`).then((r) => r.json());
const finalImageKeys = Object.keys(finalStore?.store?.categoryImages || {});
check(
  'no category picture is left orphaned on the store',
  !finalImageKeys.some((k) => k.startsWith('test section')),
  JSON.stringify(finalImageKeys),
);
console.log('pictures on the public store:', JSON.stringify(finalImageKeys));



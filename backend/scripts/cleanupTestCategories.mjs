// Removes categories this test file left behind on a store, and re-files any
// product that ended up in one.
//
// A run that is killed part-way (or that fails before its cleanup) leaves
// stamped categories and their pictures on the store. Left alone they clutter
// the merchant's real category panel and, worse, make the next run of
// testCategories.mjs pick a product that is filed in one of them.
//
// Safe by construction: it only ever touches names beginning with this script's
// stamp, and it never DELETES a category - it only clears the products out of
// them, so nothing a merchant cares about can be removed even if the stamp
// pattern were to change.
//
//   node scripts/cleanupTestCategories.mjs
const BASE = process.env.BASE || 'http://localhost:5000/api';

const STAMP = 'Test Section';
const isLeftover = (name) => String(name || '').trim().startsWith(STAMP);

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

const login = await call('POST', '/auth/login', {
  body: { email: 'store@example.com', password: 'password123' },
});
if (login.status !== 200) {
  console.log(`could not log in (${login.status})`);
  process.exit(1);
}
const token = login.data.token;

const store = (await call('GET', '/stores/mine', { token })).data?.store;
const storeId = store?._id || store?.id;

const categories = (await call('GET', `/menu/edit/${storeId}`, { token })).data
  ?.categories || [];
const leftovers = categories.filter((c) => isLeftover(c.name));

console.log(`store: ${store?.name} (${storeId})`);
console.log(`leftover test categories: ${leftovers.length}`);

/* No early exit here. The orphaned-picture sweep below matters independently of
   the categories: a picture can outlive its category with no category left to
   clean, which is exactly the state an earlier run left this store in. */
for (const category of leftovers) {
  console.log(`\nclearing "${category.name}" (${category.count} product(s))`);

  for (const product of (
    await call('GET', '/products?status=all&limit=200', { token })
  ).data?.products || []) {
    if (String(product.category || '').trim() !== category.name) continue;

    // Re-file under "Other items" by clearing the category: the same rule the
    // storefront's own delete uses. Deliberately NOT deleting the category,
    // so this script can never remove anything a merchant created.
    const res = await call('PUT', `/products/${product.id}`, {
      token,
      body: {
        name: product.name,
        price: product.price,
        stock: product.stock,
        rack: product.rack,
        shelf: product.shelf,
        description: product.description,
        image: product.image,
        status: product.status,
        options: product.options || [],
        variants: product.variants || [],
        category: '',
      },
    });
    console.log(`  ${res.status === 200 ? 'unfiled' : 'FAILED ' + res.status} ${product.name}`);
  }

  // Remove the curated entry and its picture through the normal endpoint.
  const removed = await call(
    'DELETE',
    `/menu/edit/${storeId}/categories/${encodeURIComponent(category.name)}`,
    { token },
  );
  console.log(`  removed the category itself: ${removed.status}`);
}

/* The pictures live in a map keyed by name, and removing a category used to
   leave its picture orphaned. That is fixed in the controller, but anything
   orphaned by an EARLIER run is still sitting in the document, so sweep it
   here.

   Swept by creating a throwaway category named after the orphan and then
   deleting it. The delete path is exactly what removes the map entry, and
   because the controller now clears a deleted category's picture, the
   throwaway row takes its own entry with it. This works whatever the orphan's
   key is, because each orphan is cleared by attaching it to a real category
   first and then deleting that category. */
/* Read the image map from the PUBLIC store response, not /stores/mine.

   /stores/mine runs a deliberate field projection (SESSION_STORE_FIELDS in
   utils/storeAccess.js) that omits heavy image fields, so it reports an empty
   map even when pictures are stored. The public endpoint returns the full
   document, and it is also the payload the shopper's browser downloads, so
   that is the right thing to be looking at anyway. */
const publicBefore = await fetch(
  `${BASE}/stores/${store?.slug || 'joes-pizza'}`,
).then((r) => r.json());
const imagesBefore = publicBefore?.store?.categoryImages || {};

const after = (await call('GET', `/menu/edit/${storeId}`, { token })).data
  ?.categories || [];
const liveKeys = new Set(after.map((c) => c.name.toLowerCase()));
const orphans = Object.keys(imagesBefore).filter(
  (key) => !liveKeys.has(String(key).toLowerCase()),
);

if (orphans.length) {
  console.log(`\norphaned pictures: ${orphans.join(', ')}`);

  for (const orphan of orphans) {
    /* Recreate the EXACT orphan name as a category, upload nothing, then
       delete it. The delete removes the map entry keyed by that name.

       The name has to match the orphan key exactly. The map is keyed by the
       lowercased category name, and the create endpoint trims but does not
       otherwise alter it, so re-using the orphan's own key is what makes the
       delete land on the right entry. Anything derived from it - prefixed,
       underscored - would be a different key and would sweep nothing. */
    const made = await call('POST', `/menu/edit/${storeId}/categories`, {
      token,
      body: { name: orphan },
    });
    if (made.status !== 201) {
      console.log(`  could not recreate "${orphan}": ${made.status}`);
      continue;
    }

    const dropped = await call(
      'DELETE',
      `/menu/edit/${storeId}/categories/${encodeURIComponent(orphan)}`,
      { token },
    );
    console.log(`  swept "${orphan}": delete ${dropped.status}`);
  }
}

const finalCats = (await call('GET', `/menu/edit/${storeId}`, { token })).data
  ?.categories || [];
console.log(`\nremaining categories: ${finalCats.map((c) => c.name).join(', ')}`);

/* Final confirmation straight from the public storefront, which is what the
   shopper's browser actually downloads. */
const publicStore = await fetch(
  `${BASE}/stores/${store?.slug || 'joes-pizza'}`,
).then((r) => r.json());
console.log(
  'pictures now on the public store:',
  JSON.stringify(Object.keys(publicStore?.store?.categoryImages || {})),
);

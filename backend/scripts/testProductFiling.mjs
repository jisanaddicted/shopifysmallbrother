// Walks a product through the Theme 2 filing flow, as the store owner, and
// checks both halves: the API accepting a tree node, and the storefront seeing
// the product filed there.
//
//   node scripts/testProductFiling.mjs
//
// Puts the product back on its original category and node afterwards, and
// leaves the store's theme alone, so a run leaves the shop exactly as found.
const B = 'http://localhost:5000/api';

const call = async (m, p, o = {}) => {
  const r = await fetch(B + p, {
    method: m,
    headers: { 'Content-Type': 'application/json', ...(o.token ? { Authorization: 'Bearer ' + o.token } : {}) },
    body: o.body ? JSON.stringify(o.body) : undefined,
  });
  return { s: r.status, d: await r.json().catch(() => null) };
};

const ok = (label, pass, detail = '') =>
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  (' + detail + ')' : ''}`);

const l = await call('POST', '/auth/login', { body: { email: 'store@example.com', password: 'password123' } });
const t = l.d.token;
const mine = (await call('GET', '/stores/mine', { token: t })).d;
const id = mine.store._id;
const slug = mine.store.slug;

// --- The categories endpoint tells the form which picker to render --------
// One call, not two: on Theme 1 this is the ONLY call the product form makes.
const cats = await call('GET', `/menu/edit/${id}/categories`, { token: t });
ok('the categories endpoint reports the theme', typeof cats.d?.theme === 'string', cats.d?.theme);
ok('and still sends the flat list', Array.isArray(cats.d?.categories));

// --- A branch to file into -----------------------------------------------
const S = 'Filing ' + Date.now().toString(36);
const root = await call('POST', `/menu/edit/${id}/tree`, { token: t, body: { name: S } });
const rootId = root.d?.node?.id;
const kid = await call('POST', `/menu/edit/${id}/tree`, {
  token: t,
  body: { name: S + ' child', parent: rootId },
});
const kidId = kid.d?.node?.id;
ok('a branch to file into exists', Boolean(rootId && kidId));

// --- File a real product on a node ----------------------------------------
const all = (await call('GET', '/products?status=all&limit=100', { token: t })).d?.products || [];
const p = all[0];
if (!p) {
  console.log('FAIL  no products to test with');
  process.exit(1);
}
const pid = p._id || p.id;
const originalCategory = String(p.category || '').trim();
const originalNode = p.categoryId || null;

const refile = (body) =>
  call('PUT', `/products/${pid}`, {
    token: t,
    body: {
      /* Every field the endpoint always writes has to be echoed back: it is a
         full replace, so omitting one blanks it. The real product form does
         exactly this - it states every field it manages on every save. */
      name: p.name,
      price: p.price,
      stock: p.stock,
      rack: p.rack,
      shelf: p.shelf,
      description: p.description,
      image: p.image,
      status: p.status,
      category: originalCategory,
      options: p.options || [],
      variants: p.variants || [],
      ...body,
    },
  });

const filed = await refile({ categoryId: kidId });
ok('a product can be filed on a tree node', filed.s === 200, `${filed.s}`);
ok(
  'and reads back with that node',
  String(filed.d?.product?.categoryId) === kidId,
  String(filed.d?.product?.categoryId).slice(-6),
);

/* The Theme 1 string is untouched - the whole point of the two fields living
   side by side rather than one replacing the other. */
ok(
  'filing on a node does NOT disturb the Theme 1 category',
  String(filed.d?.product?.category || '').trim() === originalCategory,
  `"${filed.d?.product?.category}"`,
);

const tree = (await call('GET', `/stores/${slug}/tree`)).d?.tree || [];
ok(
  'the storefront counts the product on that node',
  tree.find((n) => n.id === kidId)?.productCount === 1,
  `count=${tree.find((n) => n.id === kidId)?.productCount}`,
);

// --- Unfiling --------------------------------------------------------------
const cleared = await refile({ categoryId: null });
ok('a product can be unfiled by sending null', cleared.s === 200, `${cleared.s}`);
ok('and the node is cleared', !String(cleared.d?.product?.categoryId || '').trim());


// --- An ABSENT key must leave it alone ------------------------------------
/* The rule that stops a price edit from unfiling a product. If this regressed,
   saving a price on a Theme 2 store would silently strip every product off the
   merchant's tree - which is why the form always sends the key, and why
   `fileProductOnNode` treats `undefined` as "leave it alone". */
const refiled = await refile({ categoryId: kidId });
ok('re-filed before the absent-key check', refiled.s === 200 && String(refiled.d?.product?.categoryId) === kidId, `${refiled.s} node=${String(refiled.d?.product?.categoryId).slice(-6)}`);

const untouched = await refile({ price: Number(p.price) + 1 });
ok(
  'saving WITHOUT the key leaves the node alone',
  untouched.s === 200 && String(untouched.d?.product?.categoryId) === kidId,
  `status=${untouched.s} node=${String(untouched.d?.product?.categoryId).slice(-6)} msg=${untouched.d?.message || ''}`,
);

// --- Rejections -----------------------------------------------------------
const bad = await refile({ categoryId: 'not-an-id' });
ok('a malformed node id is refused', bad.s === 400, `${bad.s}`);

const ghost = await refile({ categoryId: '000000000000000000000000' });
ok('a node that does not exist is refused', ghost.s === 404, `${ghost.s}`);

// --- CREATE validates too -------------------------------------------------
/* The hole this found: `create` originally wrote `categoryId` straight from the
   request body, so a crafted POST could file a product into another merchant's
   tree. The update path was checked; create was not, and leaving it that way
   would have made it a way straight around the check. */
const created = await call('POST', '/products', {
  token: t,
  body: {
    name: 'Filing probe ' + Date.now(),
    price: 10,
    stock: 1,
    categoryId: '000000000000000000000000',
  },
});
ok('a product cannot be CREATED on a non-existent node', created.s === 400 || created.s === 404, `${created.s}`);

if (created.d?.product?._id) {
  await call('DELETE', `/products/${created.d.product._id}`, { token: t });
}

// --- Put everything back --------------------------------------------------
await refile({ categoryId: originalNode, category: originalCategory });
await call('DELETE', `/menu/edit/${id}/tree/${rootId}`, { token: t });

const back = (await call('GET', `/products/${pid}`, { token: t })).d?.product;
ok('the product is back on its original category', String(back?.category || '').trim() === originalCategory, `"${back?.category}"`);
ok('and its original node', String(back?.categoryId || '') === String(originalNode || ''));

const left = ((await call('GET', `/menu/edit/${id}/tree`, { token: t })).d?.tree || []).filter((n) =>
  String(n.name).startsWith(S),
);
ok('no test category left behind', left.length === 0, left.map((n) => n.name).join(', '));

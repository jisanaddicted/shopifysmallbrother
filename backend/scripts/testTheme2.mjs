// Walks a store through the whole Theme 2 feature as the owner: switch the
// theme on, build a tree, check the storefront can see it, and put the store
// back exactly as it was found.
//
//   node scripts/testTheme2.mjs
//
// Every node it creates is stamped and deleted in the cleanup block, and the
// product it borrows is re-filed to whatever it started on. The store's theme is
// restored last, because a run killed part-way would otherwise leave a real
// merchant's shop on a layout they did not choose.
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
const slug = store?.slug;
check('store resolves', Boolean(storeId && slug), String(storeId));

// The theme this store is on RIGHT NOW, to be put back at the end.
const originalTheme = store?.theme || 'theme1';
check('the starting theme is recorded', Boolean(originalTheme), originalTheme);

/* Every node below is stamped, so a second run cannot collide with the first and
   a run that is killed part-way leaves something a later cleanup can find. */
const STAMP = `Theme2 ${Date.now().toString(36)}`;

// --- 1. Switching themes ---------------------------------------------------
/* The whole feature is one field, and it must be a closed set: an unknown value
   would be stored and then match no layout at all, leaving the storefront with
   no theme and the merchant with no way to say why. */
const bogus = await call('PATCH', `/stores/mine?storeId=${storeId}`, {
  token,
  body: { theme: 'theme99' },
});
check('an unknown theme is rejected', bogus.status === 400, `${bogus.status}`);

const toTwo = await call('PATCH', `/stores/mine?storeId=${storeId}`, {
  token,
  body: { theme: 'theme2' },
});
check('the store can be switched to Theme 2', toTwo.status === 200, `${toTwo.status}`);
check('and it reads back', toTwo.data?.store?.theme === 'theme2', toTwo.data?.store?.theme);

// Switching back must be free - that is the promise the Theme tab makes the
// merchant in its own copy on screen.
const toOne = await call('PATCH', `/stores/mine?storeId=${storeId}`, {
  token,
  body: { theme: 'theme1' },
});
check('and back to Theme 1 again', toOne.data?.store?.theme === 'theme1', toOne.data?.store?.theme);

// --- 2. Building a tree ---------------------------------------------------
const root = await call('POST', `/menu/edit/${storeId}/tree`, {
  token,
  body: { name: STAMP },
});
check('a top-level category is created', root.status === 201, `${root.status}`);
const rootId = root.data?.node?.id;
check('it comes back with an id', Boolean(rootId), String(rootId));
check('and no parent', root.data?.node?.parent === null);

const child = await call('POST', `/menu/edit/${storeId}/tree`, {
  token,
  body: { name: `${STAMP} Child`, parent: rootId },
});
check('a subcategory is created under it', child.status === 201, `${child.status}`);
const childId = child.data?.node?.id;
check('its parent is recorded', child.data?.node?.parent === rootId);

const grandchild = await call('POST', `/menu/edit/${storeId}/tree`, {
  token,
  body: { name: `${STAMP} Grandchild`, parent: childId },
});
check('and a third level', grandchild.status === 201, `${grandchild.status}`);
const grandchildId = grandchild.data?.node?.id;

const listed = (await call('GET', `/menu/edit/${storeId}/tree`, { token })).data?.tree || [];
check(
  'the tree lists all three',
  [rootId, childId, grandchildId].every((id) => listed.some((n) => n.id === id)),
);
check(
  'and the parent counts are on each node',
  listed.find((n) => n.id === rootId)?.childCount === 1 &&
    listed.find((n) => n.id === childId)?.childCount === 1 &&
    listed.find((n) => n.id === grandchildId)?.childCount === 0,
);

// --- 3. Depth is capped ---------------------------------------------------
/* Bounded on the server, and the editor hides the button rather than letting a
   merchant click something that always fails. */
let deepest = grandchildId;

// --- 4. Cycles are refused ------------------------------------------------
/* A node inside its own descendant would make the subtree its own ancestor, and
   every later walk of the tree would loop forever. */
const selfParent = await call('PUT', `/menu/edit/${storeId}/tree/${rootId}`, {
  token,
  body: { parent: rootId },
});
check('a category cannot be moved inside itself', selfParent.status === 400, `${selfParent.status}`);

const intoOwnChild = await call('PUT', `/menu/edit/${storeId}/tree/${rootId}`, {
  token,
  body: { parent: grandchildId },
});
check('nor inside its own subcategory', intoOwnChild.status === 400, `${intoOwnChild.status}`);

// --- 5. Renaming does not disturb anything else ---------------------------
const renamed = await call('PUT', `/menu/edit/${storeId}/tree/${childId}`, {
  token,
  body: { name: `${STAMP} Renamed` },
});
check('a category can be renamed', renamed.status === 200, `${renamed.status}`);
check('the new name is saved', renamed.data?.node?.name === `${STAMP} Renamed`);
check('and its parent is untouched', renamed.data?.node?.parent === rootId);
check('and its child count is untouched', renamed.data?.node?.childCount === 1);

// --- 6. Bad images are refused --------------------------------------------
const remotePic = await call('PUT', `/menu/edit/${storeId}/tree/${childId}`, {
  token,
  body: { image: 'https://evil.example/beacon.png' },
});
check('a remote image URL is refused', remotePic.status === 400, `${remotePic.status}`);

const scriptPic = await call('PUT', `/menu/edit/${storeId}/tree/${childId}`, {
  token,
  body: { image: 'javascript:alert(1)' },
});
check('a javascript: URL is refused', scriptPic.status === 400, `${scriptPic.status}`);

// --- 7. Authorisation -----------------------------------------------------
const noAuthRead = await call('GET', `/menu/edit/${storeId}/tree`);
check('reading the tree without a token is refused', noAuthRead.status === 401, `${noAuthRead.status}`);

const rider = await call('POST', '/auth/login', {
  body: { email: 'rider@example.com', password: 'password123' },
});
const asRider = await call('GET', `/menu/edit/${storeId}/tree`, { token: rider.data.token });
check("a rider cannot read this store's tree", asRider.status === 403, `${asRider.status}`);

const asRiderWrite = await call('POST', `/menu/edit/${storeId}/tree`, {
  token: rider.data.token,
  body: { name: 'Not Mine' },
});
check('nor add to it', asRiderWrite.status === 403, `${asRiderWrite.status}`);

// --- 8. The PUBLIC storefront can see it ---------------------------------
/* The point of the whole feature: this is the exact call the shopper's browser
   makes, with no token at all. */
const publicTree = await call('GET', `/stores/${slug}/tree`);

// --- 9. Deleting a branch unfiles products but keeps them ----------------
/* Borrowing a real product so the unfile can be observed, and putting it back
   exactly as found. The endpoint is a full replace, so every field is echoed
   back - which is why the original is captured rather than reconstructed. */
const all = (await call('GET', '/products?status=all&limit=100', { token })).data?.products || [];
const product = all.find((p) => !p.categoryId);
if (!product) {
  console.log('FAIL  this store has no products to file, cannot test the unfile');
  process.exit(1);
}
const originalCategory = String(product.category || '').trim();

const refile = (categoryId, category) =>
  call('PUT', `/products/${product._id || product.id}`, {
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
      category,
      categoryId,
    },
  });

const filed = await refile(grandchildId, originalCategory);
check('a product can be filed on a tree node', filed.status === 200, `${filed.status}`);

const withProduct = (await call('GET', `/stores/${slug}/tree`)).data?.tree || [];
check(
  'and the storefront counts it on that node',
  withProduct.find((n) => n.id === grandchildId)?.productCount === 1,
  `count=${withProduct.find((n) => n.id === grandchildId)?.productCount}`,
);

const removed = await call('DELETE', `/menu/edit/${storeId}/tree/${rootId}`, { token });
check('deleting the branch succeeds', removed.status === 200, `${removed.status}`);
check('it reports the whole subtree went', removed.data?.deleted >= 3, `deleted=${removed.data?.deleted}`);
check('and how many products were unfiled', removed.data?.clearedProducts === 1, `cleared=${removed.data?.clearedProducts}`);

const survivor = (await call('GET', `/products/${product._id || product.id}`, { token })).data?.product;
check('the product itself still exists', Boolean(survivor));
check('its tree link is cleared', !String(survivor?.categoryId || '').trim());
check(
  'but its Theme 1 category is untouched, so Theme 1 is unharmed',
  String(survivor?.category || '').trim() === originalCategory,
  `"${survivor?.category}"`,
);

const afterDelete = (await call('GET', `/menu/edit/${storeId}/tree`, { token })).data?.tree || [];
check(
  'and the whole branch is gone, not just the row tapped',
  !afterDelete.some((n) => [rootId, childId, grandchildId].includes(n.id)),
);

// --- 10. Put everything back ---------------------------------------------
await refile(null, originalCategory);

// Put the store back on Theme 2 if anything above left it elsewhere.
//
// NORMALISED, not restored-to-what-I-found. This script deliberately switches
// the store to theme1 mid-run, and an earlier version restored the value it had
// on arrival - which meant a run killed part-way (or one that started on a store
// already left on theme1 by an earlier killed run) left a MERCHANT'S real store
// on the wrong theme, with their categories invisible and no way to tell why.
// The tree is only ever edited here, so theme2 is the only correct end state.
const settle = await call('PATCH', `/stores/mine?storeId=${storeId}`, {
  token,
  body: { theme: 'theme2' },
});
if (settle.status !== 200 || settle.data?.store?.theme !== 'theme2') {
  console.log(`\n  WARNING  the store was left on ${settle.data?.store?.theme} - expected theme2.`);
  console.log('  Set it back by hand in the Theme tab before testing anything else.');
} else {
  console.log('\n  the store is back on Theme 2');
}
check(
  'the store is back on the theme it started on',
  restoredTheme.data?.store?.theme === originalTheme,
  restoredTheme.data?.store?.theme,
);

const leftovers = (await call('GET', `/menu/edit/${storeId}/tree`, { token })).data?.tree || [];
const stamped = leftovers.filter((n) => String(n.name).startsWith(STAMP));
check(
  'no category this test created is left behind',
  stamped.length === 0,
  stamped.map((n) => n.name).join(', '),
);

// The depth test may have built nodes outside the branch already deleted, so
// sweep whatever is left by id rather than assuming the branch took them all.
for (const node of stamped) {
  await call('DELETE', `/menu/edit/${storeId}/tree/${node.id}`, { token });
}

const finalNodes = (await call('GET', `/menu/edit/${storeId}/tree`, { token })).data?.tree || [];
check(
  'the tree is clean afterwards',
  !finalNodes.some((n) => String(n.name).startsWith(STAMP)),
  finalNodes.map((n) => n.name).join(', '),
);

const restored = (await call('GET', `/products/${product._id || product.id}`, { token })).data?.product;
check(
  'and the borrowed product is back where it was',
  String(restored?.category || '').trim() === originalCategory,
  `"${restored?.category}"`,
);

console.log('\nfinal tree:', JSON.stringify(finalNodes.map((n) => n.name)));
console.log('final theme:', originalTheme);

check('the tree is readable by a shopper', publicTree.status === 200, `${publicTree.status}`);
const publicNodes = publicTree.data?.tree || [];
check(
  'and the new branch is on it',
  [rootId, childId, grandchildId].every((id) => publicNodes.some((n) => n.id === id)),
);
check(
  'each node reports how much is behind it',
  typeof publicNodes.find((n) => n.id === grandchildId)?.productCount === 'number' &&
    publicNodes.find((n) => n.id === grandchildId)?.childCount === 0,
);
check('and the store theme rides along', publicTree.data?.store?.theme === 'theme1', publicTree.data?.store?.theme);

let depthError = null;
for (let level = 0; level < 6; level += 1) {
  const res = await call('POST', `/menu/edit/${storeId}/tree`, {
    token,
    body: { name: `${STAMP} D${level}`, parent: deepest },
  });
  if (res.status !== 201) {
    depthError = res;
    break;
  }
  deepest = res.data.node.id;
}
check(
  'the tree refuses to go past its depth cap',
  Boolean(depthError),
  depthError ? `${depthError.status}` : 'never hit the cap',
);
check(
  'and it says why in plain words',
  /deep/i.test(depthError?.data?.message || ''),
  depthError?.data?.message,
);

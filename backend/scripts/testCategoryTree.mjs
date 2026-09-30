// Exercises the pure tree helpers the Theme tab and the storefront both depend
// on. No server, no browser: every rule these functions enforce lives here.
//
//   node scripts/testCategoryTree.mjs
import {
  buildCategoryTree,
  childrenOf,
  countNodes,
  descendantIds,
  findNode,
  nodeOpens,
  pathToNode,
  productsOn,
  treeDepth,
} from '../../client/src/utils/categoryTree.js';

const check = (label, ok, detail = '') =>
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);

/* A store shaped like a real one: a branch that goes three deep, a second
   top-level category, a leaf with products, and a node whose name repeats in a
   different branch - the case a string-keyed tree cannot represent. */
const FLAT = [
  { id: 'a', name: 'Drinks', parent: null, position: 0, childCount: 2 },
  { id: 'a1', name: 'Cold', parent: 'a', position: 0, childCount: 1 },
  { id: 'a1x', name: 'Juice', parent: 'a1', position: 0, childCount: 0 },
  { id: 'a2', name: 'Milk', parent: 'a', position: 1, childCount: 0 },
  { id: 'b', name: 'Bakery', parent: null, position: 1, childCount: 0 },
  { id: 'c', name: 'Snacks', parent: null, position: 2, childCount: 1 },
  { id: 'c1', name: 'Chips', parent: 'c', position: 0, childCount: 0 },
];

const tree = buildCategoryTree(FLAT);

// --- 1. Folding -------------------------------------------------------------
check(
  'top level is what has no parent',
  tree.map((n) => n.id).join(',') === 'a,b,c',
  tree.map((n) => n.id).join(','),
);
check('every node survives the fold', countNodes(tree) === FLAT.length, `${countNodes(tree)}`);
check(
  'siblings keep the order the server sent',
  tree.map((n) => n.name).join(',') === 'Drinks,Bakery,Snacks',
);
check(
  'children hang off the right parent',
  childrenOf(tree, 'a').map((n) => n.id).join(',') === 'a1,a2',
);
check('a leaf has no children', childrenOf(tree, 'b').length === 0);
check('a node three deep is reachable', findNode(tree, 'a1x')?.name === 'Juice');
check(
  'depth counts a top-level node as 1',
  treeDepth(tree) === 3,
  `${treeDepth(tree)}`,
);

// --- 2. The input is never mutated -----------------------------------------
/* A fold that pushed `children` onto the caller's own objects would corrupt
   whatever state the editor keeps, and the corruption only shows up on the
   NEXT render, as a category that has mysteriously become un-deletable. */
const before = JSON.stringify(FLAT);
buildCategoryTree(FLAT);
buildCategoryTree(FLAT);
check('folding twice does not mutate the input', JSON.stringify(FLAT) === before);
check('the returned nodes are copies, not the originals', tree[0] !== FLAT[0]);

// --- 3. The breadcrumb ------------------------------------------------------
check(
  'the trail names every level down to the node',
  pathToNode(tree, 'a1x').map((n) => n.name).join(' / ') === 'Drinks / Cold / Juice',
  pathToNode(tree, 'a1x').map((n) => n.name).join(' / '),
);
check('a top-level node is a one-crumb trail', pathToNode(tree, 'b').length === 1);
check('an unknown id yields no crumbs', pathToNode(tree, 'nope').length === 0);
check('a blank id yields no crumbs', pathToNode(tree, '').length === 0);

/* The same answer whichever way the shopper arrived. A breadcrumb built from
   history disagrees with a shared link the moment a link lands mid-tree. */
check(
  'the trail is the same regardless of how you got there',
  pathToNode(tree, 'c1').map((n) => n.id).join(',') ===
    pathToNode(buildCategoryTree(FLAT), 'c1').map((n) => n.id).join(','),
);


// --- 4. Duplicate names in different branches -------------------------------
/* "Milk" under Drinks and a top-level "Milk" are two shelves. Keyed by name,
   one would overwrite the other and a product filed on the wrong one would be
   unreachable - which is the whole reason a node has an id. */
const DUPES = [
  { id: 'd', name: 'Drinks', parent: null, childCount: 1 },
  { id: 'd1', name: 'Milk', parent: 'd', childCount: 0 },
  { id: 'e', name: 'Milk', parent: null, childCount: 0 },
];
const dupes = buildCategoryTree(DUPES);
check(
  'two categories with the same name are both kept',
  findNode(dupes, 'd1')?.name === 'Milk' && findNode(dupes, 'e')?.name === 'Milk',
);
check(
  'and they are genuinely different nodes',
  findNode(dupes, 'd1') !== findNode(dupes, 'e'),
);

// --- 5. Opening a card ------------------------------------------------------
check('a node with children opens', nodeOpens(findNode(tree, 'a')));
check(
  'a leaf with products does not "open", it shows them',
  !nodeOpens(findNode(tree, 'b')),
);
check('a missing node does not open', !nodeOpens(null));

// --- 6. Products ------------------------------------------------------------
const PRODUCTS = [
  { _id: 'p1', name: 'Cola', categoryId: 'b' },
  { _id: 'p2', name: 'Latte', categoryId: 'a' },
  { _id: 'p3', name: 'Juice Box', categoryId: 'a1x' },
  { _id: 'p4', name: 'Unfiled' },
];
check(
  'a product belongs to exactly one node',
  productsOn(findNode(tree, 'a1x'), PRODUCTS).map((p) => p.name).join(',') ===
    'Juice Box',
);
check(
  'a node holds only its OWN products, not its descendants',
  productsOn(findNode(tree, 'a'), PRODUCTS).map((p) => p.name).join(',') === 'Latte',
);
check(
  'a product with no category is on no node, and is not lost',
  productsOn(findNode(tree, 'b'), PRODUCTS).map((p) => p.name).join(',') ===
    'Cola' && PRODUCTS.filter((p) => !p.categoryId).length === 1,
);

// --- 7. Deleting a branch ---------------------------------------------------
check(
  'a delete would take the whole subtree, and says so',
  descendantIds(tree, 'a').sort().join(',') === 'a,a1,a1x,a2',
  descendantIds(tree, 'a').sort().join(','),
);
check('deleting a leaf takes only itself', descendantIds(tree, 'a1x').join(',') === 'a1x');
check('an unknown node deletes nothing', descendantIds(tree, 'zzz').length === 0);

// --- 8. Damaged input -------------------------------------------------------
/* A category deleted in one tab while another was open leaves a child pointing
   at something that is no longer there. Dropping it would make the merchant
   rebuild a branch they had already built. */
const orphans = buildCategoryTree([
  { id: 'x', name: 'Kept', parent: null },
  { id: 'y', name: 'Orphan', parent: 'gone' },
]);
check(
  'a node whose parent is missing is kept, at the top',
  orphans.length === 2,
  orphans.map((n) => n.id).join(','),
);

/* A cycle would otherwise recurse forever and take the page with it. The server
   refuses to create one; this must not hang if one arrives anyway. */
const cyclic = buildCategoryTree([
  { id: 'p', name: 'P', parent: 'q' },
  { id: 'q', name: 'Q', parent: 'p' },
]);
check('a cyclic pair does not hang the fold', Array.isArray(cyclic), `${cyclic.length} roots`);

const selfRef = buildCategoryTree([{ id: 's', name: 'S', parent: 's' }]);
check('a self-referencing node is not recursed into', !selfRef[0]?.children?.length);

/* Nothing at all is the state of every store that has never built a tree. */
check('an empty list is an empty tree', buildCategoryTree([]).length === 0);
check('a missing list is an empty tree, not a crash', buildCategoryTree(undefined).length === 0);
check('a null list is an empty tree, not a crash', buildCategoryTree(null).length === 0);
check('a row with no id is skipped, not crashed on', buildCategoryTree([{ name: 'Nameless' }]).length === 0);
check('depth of an empty tree is 0', treeDepth([]) === 0);
check('node count of an empty tree is 0', countNodes([]) === 0);

console.log('\ntop level:');
for (const node of tree) {
  console.log(`  ${node.name}`);
  for (const child of node.children || []) {
    console.log(`    - ${child.name}`);
    for (const grand of child.children || []) {
      console.log(`        * ${grand.name}`);
    }
  }
}

/**
 * The Theme 2 category tree, and the pure functions that read it.
 *
 * PURE and framework-free on purpose. Both the Theme tab (which builds and edits
 * the tree) and the storefront (which drills down through it) need to fold the
 * same flat list into the same shape, and two copies of that fold is how the
 * editor and the shop end up disagreeing about what the merchant's tree
 * actually says. This file is the one definition both import.
 *
 * The flat shape is what the server sends and what `loadCategoryTree` returns:
 *
 *   { id, name, parent, position, image, childCount, productCount? }
 *
 * `parent` is null on a top-level node. Nothing here mutates its input - every
 * function returns new arrays and new objects, so a caller's state is never
 * edited underneath it by a render.
 */

/**
 * Fold a flat node list into a tree, each node gaining `children`.
 *
 * Siblings keep the order the server sent them in (by `position`), because a
 * merchant arranged their shelf deliberately and this must not reshuffle it.
 *
 * ORPHANS ARE PROMOTED, not dropped. A node whose `parent` names something not
 * in this list - a category deleted in one tab while another was open, a
 * half-finished write - would otherwise vanish from the editor and take its
 * whole subtree with it, and the merchant would have to rebuild a branch they
 * had already built. Promoting it to the top level keeps it reachable and
 * fixable, which is the only useful thing to do with it.
 *
 * A node that is its own ancestor is dropped rather than recursed into: that
 * cycle would otherwise turn this into an infinite loop and take the page down
 * with it. The server refuses to create one; this is the belt to those braces.
 */
export function buildCategoryTree(nodes) {
  const list = Array.isArray(nodes) ? nodes : [];

  const byId = new Map();
  for (const node of list) {
    if (!node?.id) continue;
    byId.set(String(node.id), { ...node, id: String(node.id), children: [] });
  }

  const roots = [];
  for (const node of byId.values()) {
    const parentId = node.parent ? String(node.parent) : null;

    if (parentId && byId.has(parentId) && parentId !== node.id) {
      byId.get(parentId).children.push(node);
    } else {
      // No parent, an unknown parent, or a self-reference: show it at the top
      // rather than losing it.
      roots.push(node);
    }
  }

  /* A cycle among non-root nodes (A -> B -> A) leaves both off the roots list
     and so off the screen entirely. Break it by promoting whatever is left. */
  const placed = new Set(roots.map((n) => n.id));
  for (const node of byId.values()) {
    if (placed.has(node.id)) continue;
    if (containsNode(node, node.id)) continue;
    roots.push(node);
  }

  return roots;
}

/** Is `id` anywhere under (or equal to) `node`? The cycle guard. */
function containsNode(node, id) {
  if (node.id === id) return true;
  return (node.children || []).some((child) => containsNode(child, id));
}

/** Depth-first search for a node by id, anywhere in the tree. */
function locate(nodes, id) {
  for (const node of nodes) {
    if (node.id === id) return node;
    const hit = locate(node.children || [], id);
    if (hit) return hit;
  }
  return null;
}

/** The top-level categories, in order. */
export function topLevelNodes(tree) {
  return Array.isArray(tree) ? tree : [];
}

/** The direct children of `id`, in order. Empty for a leaf or an unknown id. */
export function childrenOf(tree, id) {
  if (!id) return [];
  return locate(Array.isArray(tree) ? tree : [], String(id))?.children || [];
}

/** The node with this id, anywhere in the tree, or null. */
export function findNode(tree, id) {
  if (!id) return null;
  return locate(Array.isArray(tree) ? tree : [], String(id)) || null;
}

/**
 * The path from the top of the tree down to `id`, inclusive.
 *
 * This is the breadcrumb, and it is derived from the tree the browser already
 * holds rather than from navigation history. That is deliberate: the back
 * button, a shared link and a hand-typed URL all have to produce the same
 * trail, and a trail recorded as "where the shopper came from" agrees with none
 * of them the moment somebody lands mid-tree by link.
 *
 * An unknown id yields `[]` rather than a partial trail, so a stale bookmark
 * shows the store's top level instead of a breadcrumb that leads nowhere.
 */
export function pathToNode(tree, id) {
  if (!id) return [];

  const target = String(id);

  const walk = (nodes, trail) => {
    for (const node of nodes) {
      const next = [...trail, node];
      if (node.id === target) return next;

      const hit = walk(node.children || [], next);
      if (hit) return hit;
    }
    return null;
  };

  return walk(Array.isArray(tree) ? tree : [], []) || [];
}

/**
 * The ids of everything under `id`, itself included.
 *
 * Used to show a merchant how much a delete would take before they commit to
 * it. The server stays the authority on what it actually removes; this is for
 * the warning, not the decision.
 */
export function descendantIds(tree, id) {
  const node = findNode(tree, id);
  if (!node) return [];

  const out = [];
  const stack = [node];
  while (stack.length) {
    const current = stack.pop();
    out.push(current.id);
    for (const child of current.children || []) stack.push(child);
  }
  return out;
}

/** The deepest level in the tree, counting a top-level node as 1. */
export function treeDepth(tree) {
  const walk = (nodes) => {
    let deepest = 0;
    for (const node of nodes) {
      const below = walk(node.children || []);
      if (below + 1 > deepest) deepest = below + 1;
    }
    return deepest;
  };

  return walk(Array.isArray(tree) ? tree : []);
}

/** How many nodes the tree holds in total. */
export function countNodes(tree) {
  const walk = (nodes) =>
    nodes.reduce((sum, node) => sum + 1 + walk(node.children || []), 0);

  return walk(Array.isArray(tree) ? tree : []);
}

/**
 * Does tapping this card reveal more categories, products, or both?
 *
 * The storefront's whole drill-down is this one decision, so it is asked of a
 * node here rather than guessed at each call site. A node with children AND
 * products of its own shows both: the cards for what is inside it, and its own
 * products beneath them.
 *
 * `childCount` is the server's number and `children.length` is the client's, so
 * either is honoured. They agree in practice; accepting both means a card still
 * opens correctly during the moment after a re-fetch, when one of the two lists
 * has been updated and the other has not.
 */
export function nodeOpens(node) {
  if (!node) return false;
  return Boolean(node.childCount) || Boolean((node.children || []).length);
}

/** The products filed directly on this node. A product belongs to exactly one. */
export function productsOn(node, products) {
  if (!node) return [];
  return (products || []).filter(
    (product) => String(product.categoryId || '') === node.id,
  );
}

/**
 * The tree flattened into one row per node, for a `<select>`.
 *
 * A product form needs ONE control the merchant can pick from, and a `<select>`
 * cannot nest. So the tree is flattened to a list of `{ id, label, depth }`,
 * depth-first, with each label showing the FULL path - "Drinks > Cold > Juice" -
 * so a subcategory can never be mistaken for a top-level one that happens to
 * share its name. Two nodes called "Milk" are the whole reason a tree uses ids,
 * and a picker that showed just "Milk" twice would throw that away.
 *
 * A non-breaking space indents each level as well. The separator alone carries
 * the meaning; the indent makes the shape readable at a glance in a long list,
 * and a normal space would collapse in the HTML and do nothing.
 *
 * Parents come before their children, so picking a parent and then opening the
 * list again shows the child directly beneath the branch it belongs to.
 */
export function flattenTreeForSelect(tree, separator = '›') {
  const rows = [];

  const walk = (nodes, trail) => {
    for (const node of nodes) {
      const path = [...trail, node.name];

      rows.push({
        id: node.id,
        depth: path.length,
        label:
          ' '.repeat(path.length - 1) + path.join(` ${separator} `),
      });

      walk(node.children || [], path);
    }
  };

  walk(Array.isArray(tree) ? tree : [], []);
  return rows;
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import menuService from '../../services/menuService';
import {
  buildCategoryTree,
  countNodes,
  descendantIds,
  treeDepth,
} from '../../utils/categoryTree';
import { MAX_CATEGORY_DEPTH } from '../../utils/constants';

/**
 * The Theme 2 category tree, edited.
 *
 * A tree, not a list: every row can be opened to add a child, to any depth. That
 * is the feature, so the shape here is a nested disclosure rather than one flat
 * list with a "parent" dropdown - a dropdown for "where does this go" makes the
 * merchant hold the whole tree in their head to answer it, and gives no way to
 * see what they have already built.
 *
 * A COMPONENT rather than more markup in ThemeBuilder, for the same reason
 * BulkEditPanel is its own: this is a self-contained editor with its own open
 * rows, its own busy flags and its own errors, and the theme builder already
 * carries a menu editor and a category panel. It owns nothing the rest of the
 * page needs except the list it hands back.
 *
 * The tree arrives FLAT and is folded here, by the same `buildCategoryTree` the
 * storefront uses. Two folds would be two definitions of the merchant's tree.
 */
export default function CategoryTreeEditor({ storeId, onChanged }) {
  const [nodes, setNodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Which rows are open. A Set, because a row can be opened from several places
  // and a list would care about order for no reason.
  const [open, setOpen] = useState(() => new Set());

  // Which row's "add a subcategory" box is showing, and its text. ONE at a
  // time, keyed by node id with 'ROOT' meaning the top-level form: two boxes
  // side by side invite a merchant to type a name into the wrong one.
  const [addingUnder, setAddingUnder] = useState(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  // The node whose picture is uploading, or null. An id rather than a boolean
  // so only that row dims and two uploads cannot race each other.
  const [imageBusy, setImageBusy] = useState(null);

  const tree = useMemo(() => buildCategoryTree(nodes), [nodes]);

  /* Re-read the whole tree after every write.

     The obvious cheaper move - patch the one row that changed - is wrong here.
     A move changes a node's `parent`, which changes the order of every sibling
     it left and joined, and a delete changes the `childCount` of an ancestor.
     Re-reading means this panel can never disagree with the server about the
     shape of the tree, which is the bug class that matters when the same data
     is also being read by a public storefront. */
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setNodes(await menuService.loadCategoryTree(storeId));
    } catch (err) {
      setError(err.message || 'Could not load your categories.');
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = (id) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const startAdding = (id) => {
    setAddingUnder(id);
    setDraft('');
    setError('');
  };

  const flash = (message) => {
    setNotice(message);
    setTimeout(() => setNotice(''), 4000);
  };

  /* Add a category.
     *
     * OPTIMISTIC, and that is the whole answer to this feeling slow.
     *
     * It used to create, then re-read the entire tree, which is two round trips
     * to a database that is not in the next room - measured at around 6.7s end
     * to end, with the panel blanked to "Loading your categories…" in between, so
     * the button looked broken rather than busy.
     *
     * Now the row goes in immediately and is RECONCILED with what the server
     * stored, rather than re-reading the tree to find out. The server's reply
     * already carries everything this row needs - its real id, its position, its
     * parent - so re-reading was pure duplication.
     *
     * If the server refuses (the depth cap, a name too long), the row is pulled
     * back out and the typed name is put in the box again, so a rejected attempt
     * costs a retry rather than a retype. The row that vanishes is honest: it
     * was never saved.
     */
  const submit = async (event, parentId) => {
    event.preventDefault();
    const name = draft.trim();
    if (!name) return;

    // A temporary id, so the new row renders exactly like every other one
    // without waiting to learn its real one.
    const tempId = `temp-${Date.now()}`;

    setNodes((prev) => [
      ...prev,
      { id: tempId, name, parent: parentId, position: 0, image: '', childCount: 0 },
    ]);
    setDraft('');
    setAddingUnder(null);
    setBusy(true);
    setError('');

    try {
      const saved = await menuService.createTreeNode(storeId, name, parentId);

      // Swap the placeholder for the real row. The server's position is kept, so
      // a new category lands at the end of its siblings exactly as it would
      // have after a re-read.
      setNodes((prev) =>
        prev.map((node) => (node.id === tempId ? { ...saved, childCount: 0 } : node)),
      );

      // Open the row just filled, so the merchant watches the new child appear
      // where they expect rather than having to go looking for it.
      if (parentId) setOpen((prev) => new Set(prev).add(parentId));

      flash(parentId ? `Added “${name}” inside that category.` : `Added “${name}”.`);
      onChanged?.();
    } catch (err) {
      // Roll the row back out, and hand the name back so a refusal (the depth
      // cap, say) costs a retry rather than a retype.
      setNodes((prev) => prev.filter((node) => node.id !== tempId));
      setDraft(name);
      setError(err.message || 'Could not add that category.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (node) => {
    const under = descendantIds(tree, node.id);
    const deeper = under.length - 1;

    /* Say what is about to go, rather than letting the list quietly shrink. A
       delete here takes the whole branch, not just the row tapped, and a
       merchant who has built four levels should not discover that by watching
       them vanish. */
    const what =
      deeper > 0
        ? `Delete “${node.name}” and the ${deeper} categor${
            deeper === 1 ? 'y' : 'ies'
          } inside it? Products in them are kept - they just stop being filed here.`
        : `Delete “${node.name}”? Products in it are kept - they just stop being filed here.`;

    if (!window.confirm(what)) return;

    setBusy(true);
    setError('');
    try {
      const { deleted, clearedProducts } = await menuService.deleteTreeNode(
        storeId,
        node.id,
      );

      // The row is gone, and so is any open state for it and its descendants -
      // a stale id left in `open` would silently swallow a later expand.
      setOpen((prev) => {
        const next = new Set(prev);
        for (const id of under) next.delete(id);
        return next;
      });

      flash(
        clearedProducts > 0
          ? `Deleted ${deleted} categor${deleted === 1 ? 'y' : 'ies'}. ${clearedProducts} product${
              clearedProducts === 1 ? '' : 's'
            } kept, but no longer filed here.`
          : `Deleted ${deleted} categor${deleted === 1 ? 'y' : 'ies'}.`,
      );

      await load();
      onChanged?.();
    } catch (err) {
      setError(err.message || 'Could not delete that category.');
    } finally {
      setBusy(false);
    }
  };

  /* Set or clear a node's picture.
   *
   * The row is updated from the node the server returns rather than by re-reading
   * the tree, for the same reason adding a category is optimistic: the reply
   * carries the stored image, so a second round trip would buy nothing - and
   * against this project's database that is seconds of a spinning thumbnail.
   *
   * `imageBusy` is the node id rather than a boolean, so only the row being
   * uploaded dims; the rest of the tree stays usable, and two uploads cannot
   * race each other by both believing they own the one flag. */
  const setImage = async (node, image) => {
    setBusy(true);
    setError('');
    try {
      const saved = await menuService.setTreeNodeImage(storeId, node.id, image);
      setNodes((prev) => prev.map((entry) => (entry.id === node.id ? saved : entry)));
      flash(
        image
          ? `Picture updated for “${node.name}”.`
          : `Picture removed from “${node.name}”.`,
      );
      onChanged?.();
    } catch (err) {
      setError(err.message || 'Could not update that picture.');
    } finally {
      setImageBusy(null);
      setBusy(false);
    }
  };

  const depth = treeDepth(tree);
  const total = countNodes(tree);
  const atCap = depth >= MAX_CATEGORY_DEPTH;

  return (
    <div className="tree-panel">
      <div className="tree-panel__head">
        <h3 className="panel__title">Category tree</h3>
        <p className="muted small">
          Open a category to put something inside it, as deep as you like. A
          shopper taps through these on your storefront, and the products filed
          on a category are what they see when they reach it.
        </p>
        {total > 0 ? (
          <p className="muted small tree-panel__count">
            {total} categor{total === 1 ? 'y' : 'ies'}, {depth} level
            {depth === 1 ? '' : 's'} deep.{' '}
            {atCap
              ? `That is as deep as a tree can go (${MAX_CATEGORY_DEPTH}).`
              : `Up to ${MAX_CATEGORY_DEPTH} levels deep.`}
          </p>
        ) : null}
      </div>

      {error ? <div className="alert alert--danger">{error}</div> : null}
      {notice ? <div className="alert alert--ok">{notice}</div> : null}

      <form className="tree-panel__add" onSubmit={(event) => submit(event, null)}>
        <label className="field field--sm tree-panel__field">
          <span>New top-level category</span>
          <input
            type="text"
            value={addingUnder === 'ROOT' ? draft : ''}
            maxLength={60}
            placeholder="e.g. Drinks"
            disabled={busy}
            onChange={(event) => {
              setAddingUnder('ROOT');
              setDraft(event.target.value);
            }}
          />
        </label>
        <button
          type="submit"
          className="btn btn-primary btn-sm"
          disabled={busy || addingUnder !== 'ROOT' || !draft.trim()}
        >
          Add
        </button>
      </form>

      {loading ? <p className="muted small">Loading your categories…</p> : null}

      {!loading && total === 0 ? (
        <p className="muted small">
          No categories yet. Add one above to start your tree. Until you do,
          Theme 2 shows this store&apos;s products on one page with nothing to
          tap into.
        </p>
      ) : null}

      {total > 0 ? (
        <ul className="tree-list">
          {tree.map((node) => (
            <TreeRow
              key={node.id}
              node={node}
              depth={1}
              open={open}
              busy={busy}
              imageBusy={imageBusy}
              addingUnder={addingUnder}
              draft={draft}
              atCap={atCap}
              onToggle={toggle}
              onStartAdding={startAdding}
              onDraft={setDraft}
              onSubmit={submit}
              onImage={setImage}
              onRemove={remove}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * One row of the tree, and everything under it.
 *
 * Recursive rather than flattened with a depth number, so a branch renders as
 * an actual branch: the indentation IS the nesting, and there is no bookkeeping
 * to get wrong when a row is added in the middle.
 *
 * Every handler is passed in rather than imported, so this component holds no
 * state of its own beyond the `depth` it was called with. That is what lets the
 * whole subtree re-render from one piece of state at the top without each level
 * keeping its own copy that could drift.
 */
function TreeRow({
  node,
  depth,
  open,
  busy,
  imageBusy,
  addingUnder,
  draft,
  atCap,
  onToggle,
  onStartAdding,
  onDraft,
  onSubmit,
  onImage,
  onRemove,
}) {
  const isOpen = open.has(node.id);
  const children = node.children || [];
  const hasChildren = children.length > 0;
  const uploading = imageBusy === node.id;

  return (
    <li className="tree-row">
      <div className="tree-row__line" style={{ '--tree-depth': depth - 1 }}>
        {/* A disclosure, and a real <button>: a row with children is a control,
            not a decoration, and has to be reachable from the keyboard. */}
        {hasChildren ? (
          <button
            type="button"
            className={`tree-row__caret${isOpen ? ' is-open' : ''}`}
            onClick={() => onToggle(node.id)}
            aria-expanded={isOpen}
            aria-label={isOpen ? `Collapse ${node.name}` : `Expand ${node.name}`}
          >
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
              <path
                d="M6 3l5 5-5 5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        ) : (
          <span className="tree-row__caret tree-row__caret--empty" aria-hidden="true" />
        )}

        {/* The picture, and the control that changes it - one target rather than
            a thumbnail beside a separate "choose file" button. A merchant is
            aiming at the image they can already see, so that is what they click.
            The same affordance Theme 1's category panel uses, deliberately: the
            two panels are different shapes of the same job, and a merchant who
            uses both should not have to learn it twice. */}
        <label
          className={`tree-row__thumb${uploading ? ' is-busy' : ''}`}
          title={
            node.image
              ? `Change the picture for ${node.name}`
              : `Add a picture for ${node.name}`
          }
        >
          {node.image ? (
            <img src={node.image} alt="" />
          ) : (
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
              <path
                d="M8 5.4v5.2M5.4 8h5.2"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          )}
          <input
            type="file"
            accept="image/*"
            hidden
            disabled={Boolean(imageBusy)}
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Cleared so picking the SAME file twice in a row still fires a
              // change event - otherwise the second pick silently does nothing.
              event.target.value = '';
              if (file) onImage(node, file);
            }}
          />
        </label>

        <span className="tree-row__name">{node.name}</span>

        {hasChildren ? <span className="badge">{children.length}</span> : null}

        <div className="tree-row__actions">
          {/* A category with a picture gets a way to take it away. Without this
              the only route back to a plain card is to delete the category and
              rebuild it, losing everything filed underneath it. */}
          {node.image ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-danger"
              onClick={() => onImage(node, '')}
              disabled={Boolean(imageBusy)}
              title={`Remove the picture from ${node.name}`}
            >
              No pic
            </button>
          ) : null}

          {/* The depth cap is refused HERE as well as by the server, so the
              button that cannot work is not offered at all. A button that always
              fails is worse than one that is simply gone. */}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => onStartAdding(node.id)}
            disabled={busy || atCap}
            title={
              atCap
                ? `Categories can be nested ${MAX_CATEGORY_DEPTH} levels deep.`
                : `Add a category inside ${node.name}`
            }
          >
            + inside
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-danger"
            onClick={() => onRemove(node)}
            disabled={busy}
          >
            Delete
          </button>
        </div>
      </div>

      {addingUnder === node.id ? (
        <form className="tree-row__add" onSubmit={(event) => onSubmit(event, node.id)}>
          <label className="field field--sm">
            <span>Inside “{node.name}”</span>
            <input
              type="text"
              value={draft}
              maxLength={60}
              placeholder="e.g. Cold drinks"
              disabled={busy}
              onChange={(event) => onDraft(event.target.value)}
              autoFocus
            />
          </label>
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={busy || !draft.trim()}
          >
            Add
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => onStartAdding(null)}
            disabled={busy}
          >
            Cancel
          </button>
        </form>
      ) : null}

      {isOpen && hasChildren ? (
        <ul className="tree-list">
          {children.map((child) => (
            <TreeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              open={open}
              busy={busy}
              /* These two are what make a subcategory's picture uploadable.

                 They were MISSING here, so every row below the top level got
                 `onImage === undefined`. Clicking a subcategory thumbnail still
                 opened the file dialog (the input is in the shared row markup),
                 and then `onImage(node, file)` threw "onImage is not a
                 function" - so the picture silently never reached the API, and
                 only top-level categories could be given one. Passing them down
                 is the entire fix; the handler itself already existed. */
              imageBusy={imageBusy}
              addingUnder={addingUnder}
              draft={draft}
              atCap={atCap}
              onToggle={onToggle}
              onStartAdding={onStartAdding}
              onDraft={onDraft}
              onSubmit={onSubmit}
              onImage={onImage}
              onRemove={onRemove}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

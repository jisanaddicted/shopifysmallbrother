import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, Link } from 'react-router-dom';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import storeService from '../../services/storeService';
import menuService from '../../services/menuService';

const TARGET_TYPES = [
  { value: 'category', label: 'Category' },
  { value: 'product', label: 'Product' },
  { value: 'url', label: 'Web address' },
];

/**
 * Menu row icons, as inline SVG rather than glyphs.
 *
 * The first version of this used characters - the braille grip "?", a caret,
 * a pencil, a bin, a circled plus. They rendered as literal "?" boxes on a
 * machine with no font covering them, and they cannot be styled: a glyph takes
 * its colour from the font, not the element, so the hover state on the delete
 * button could not be made to work. Inline SVG inherits currentColor, scales
 * with the row, and renders the same on every machine.
 */
const Icon = ({ name, className = '' }) => {
  const paths = {
    // Six dots in two columns - the "grab me" handle.
    grip: (
      <>
        <circle cx="6" cy="5" r="1.4" />
        <circle cx="6" cy="9" r="1.4" />
        <circle cx="6" cy="13" r="1.4" />
        <circle cx="11" cy="5" r="1.4" />
        <circle cx="11" cy="9" r="1.4" />
        <circle cx="11" cy="13" r="1.4" />
      </>
    ),
    // Points down; the row rotates this to point up when open.
    caret: <path d="M4 6l4 4 4-4" />,
    pencil: (
      <>
        <path d="M2.5 13.5l.6-2.6 7-7 2 2-7 7-2.6.6z" />
        <path d="M9.4 4.6l2 2" />
      </>
    ),
    trash: (
      <>
        <path d="M3 4.5h10" />
        <path d="M6.5 4.5V3h3v1.5" />
        <path d="M4.5 4.5l.6 8.2a.9.9 0 0 0 .9.8h4a.9.9 0 0 0 .9-.8l.6-8.2" />
      </>
    ),
    plus: (
      <>
        <circle cx="8" cy="8" r="6.2" />
        <path d="M8 5.4v5.2M5.4 8h5.2" />
      </>
    ),
  };

  return (
    <svg
      className={'menu-icon ' + className}
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name] || null}
    </svg>
  );
};


/** Builds a nested tree from the flat item list (each node gains `children`). */
function buildTree(items) {
  const byId = new Map();
  const root = [];
  for (const item of items) {
    const node = { ...item, children: [] };
    byId.set(String(item.id), node);
  }
  for (const item of items) {
    const node = byId.get(String(item.id));
    const parentId = item.parentId || item.parent;
    if (parentId && byId.has(String(parentId))) {
      byId.get(String(parentId)).children.push(node);
    } else {
      root.push(node);
    }
  }
  return root.sort((a, b) => (a.position || 0) - (b.position || 0));
}

/**
 * Theme builder — merchants and admins build a store's public navbar here
 * (Shopify-style top-level items with hover dropdowns).
 *
 * Variant is detected from the route: `/merchant/theme` = store mode,
 * `/admin/theme` = admin mode (pick any store).
 */
export default function ThemeBuilder() {
  const location = useLocation();
  const isMerchant = location.pathname.startsWith('/merchant');

  const [store, setStore] = useState(null);
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [allStores, setAllStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setError] = useState('');
  const [successMsg, setSuccess] = useState('');
  const [logoPreview, setLogoPreview] = useState('');
  const [logoBusy, setLogoBusy] = useState(false);

  // Which menu rows are showing their children, and which are showing their
  // edit form. Two separate sets on purpose: browsing the tree and editing an
  // item are different intentions, and collapsing a parent must never throw
  // away what was typed into one of its children.
  const [openIds, setOpenIds] = useState(() => new Set());
  const [editingIds, setEditingIds] = useState(() => new Set());
  // The row currently being dragged. React state rather than the DataTransfer
  // itself, so a drop can read the id without parsing a payload back out.
  // The row currently being dragged. Held in BOTH a ref and state on purpose:
  // the drop handler needs the value synchronously, and a ref is read at drag
  // time while state would only be visible after the next render - a drop that
  // lands in the same tick as the dragstart saw a stale null and did nothing.
  // The state copy is only for the `is-dragging` class.
  const dragIdRef = useRef(null);
  const [dragId, setDragId] = useState(null);

  /* --- Load initial data --- */
  const applyStore = useCallback((s) => {
    setStore(s);
    setLogoPreview(s?.logo || s?.image || '');
  }, []);

  const loadMenu = useCallback(async (storeId) => {
    try {
      setLoading(true);
      setError('');
      const data = await menuService.loadStoreMenu(storeId);
      applyStore(data.store);
      setItems(data.items);
      setCategories(data.categories);
      setProducts(data.products);
    } catch (err) {
      setError(err.message || 'Could not load the menu.');
    } finally {
      setLoading(false);
    }
  }, [applyStore]);

  useEffect(() => {
    if (isMerchant) {
      storeService
        .getMyStore()
        .then((data) => {
          const s = data.store;
          applyStore(s);
          loadMenu(s._id || s.id);
        })
        .catch((err) => {
          setError(err.message || 'Could not load your store.');
          setLoading(false);
        });
    } else {
      storeService
        .listStores()
        .then((stores) => setAllStores(stores))
        .catch((err) => setError(err.message || 'Could not load stores.'))
        .finally(() => setLoading(false));
    }
    }, [isMerchant, loadMenu, applyStore]);

  /* --- Logo upload: file input -> instant preview -> persist on the store -- */
  const handleLogoFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !store) return;
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file (PNG, JPG, SVG…).');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Logo must be under 5 MB.');
      return;
    }
    const localUrl = URL.createObjectURL(file);
    setLogoPreview(localUrl);
    setLogoBusy(true);
    setError('');
    setSuccess('');
    try {
      const updated = await storeService.uploadStoreLogo(
        file,
        store._id || store.id,
      );
      applyStore(updated);
      setSuccess('Logo updated!');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setLogoPreview(store?.logo || store?.image || '');
      setError(err.message || 'Could not upload the logo.');
    } finally {
      URL.revokeObjectURL(localUrl);
      setLogoBusy(false);
    }
  };

  const handleLogoRemove = async () => {
    if (!store || logoBusy) return;
    setLogoBusy(true);
    setError('');
    setSuccess('');
    try {
      const updated = await storeService.updateMyStore(
        { logo: '' },
        store._id || store.id,
      );
      applyStore(updated);
      setSuccess('Logo removed.');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.message || 'Could not remove the logo.');
    } finally {
      setLogoBusy(false);
    }
  };

  /* --- Inline-edit operations on the flat item list --- */
  const updateItem = (id, field, value) => {
    setItems((prev) =>
      prev.map((i) =>
        String(i.id) === String(id) ? { ...i, [field]: value } : i
      )
    );
  };

  const removeItem = (id) => {
    const targetId = String(id);
    setItems((prev) =>
      prev.filter(
        (i) =>
          String(i.id) !== targetId &&
          String(i.parentId || '') !== targetId
      )
    );
  };

  const moveItem = (id, direction) => {
    const item = items.find((i) => String(i.id) === String(id));
    if (!item) return;
    const parentId = item.parentId || null;
    const siblings = items
      .filter(
        (i) =>
          String(i.parentId || null) === String(parentId || null)
      )
      .sort((a, b) => (a.position || 0) - (b.position || 0));
    const idx = siblings.findIndex((s) => String(s.id) === String(id));
    if (idx < 0) return;
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= siblings.length) return;
    const newItems = [...items];
    const a = newItems.findIndex((i) => String(i.id) === String(id));
    const b = newItems.findIndex(
      (i) => String(siblings[targetIdx].id) === String(i.id)
    );
    const posA = newItems[a].position;
    newItems[a].position = newItems[b].position;
    newItems[b].position = posA;
    setItems(newItems);
  };

  /**
   * Add a menu item, as a top-level row or as a sub-item of `parentId`.
   *
   * Returns the new row's id so the caller can open it straight away.
   *
   * The row is appended to the END of its sibling group, so a sub-item lands
   * under the parent's caret instead of jumping to the top of the menu.
   *
   * Two things are opened automatically, because otherwise a freshly added
   * sub-item would be effectively invisible: a sub-item only renders inside an
   * expanded parent, and it has no label yet, so an empty "Untitled" row gives
   * the user nothing obvious to click in order to name it.
   */
  const addItem = (parentId = null) => {
    const id = `new_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const siblingCount = items.filter(
      (i) => String(i.parentId || null) === String(parentId || null)
    ).length;

    // The functional form, so two rapid clicks cannot both read the same stale
    // `items` snapshot and one of the new rows would be silently lost.
    setItems((prev) => [
      ...prev,
      {
        id,
        label: '',
        // A target is REQUIRED - the save endpoint rejects a row without one
        // with "Every menu item needs a target". Defaulting to a category with
        // an empty value therefore produced a row that could not be saved at
        // all, so a new sub-item was born unsaveable until the user thought to
        // pick a category. Pointing it at the store's own page is always valid,
        // needs no product or category to exist first, and is a sensible
        // "not set up yet" default the user can overwrite.
        targetType: 'url',
        target: store?.publicPath || (store?.slug ? `/s/${store.slug}` : ''),
        parentId,
        position: siblingCount,
        isVisible: true,
        isNew: true,
      },
    ]);

    if (parentId) {
      setOpenIds((prev) => new Set(prev).add(String(parentId)));
    }
    setEditingIds((prev) => new Set(prev).add(id));

    return id;
  };

  /* --- Collapse / expand --- */
  // Sets are replaced rather than mutated: React compares by reference, so
  // toggling in place would not re-render the row at all.
  const toggleIn = (setter, id) =>
    setter((prev) => {
      const next = new Set(prev);
      const key = String(id);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const toggleOpen = (id) => toggleIn(setOpenIds, id);
  const toggleEditing = (id) => toggleIn(setEditingIds, id);

  /* --- Drag to reorder --- */
  /**
   * Move `dragId` to sit where `dropId` is, among the siblings they share.
   *
   * Only within one level, deliberately: a drag that could re-parent an item
   * would make "reorder" and "nest" the same gesture, and a mis-drop would
   * silently move an item under a different parent. Nesting stays an explicit
   * action, so this only ever rewrites `position` between siblings.
   *
   * Positions are renumbered 0..n-1 for the whole sibling group rather than
   * swapped, so dropping onto a neighbour lands exactly where the row under
   * the cursor is, instead of after it.
   */
  const reorderTo = (dragId, dropId) => {
    setItems((prev) => {
      const dragKey = String(dragId);
      const dropKey = String(dropId);
      if (dragKey === dropKey) return prev;

      const dragged = prev.find((i) => String(i.id) === dragKey);
      const dropped = prev.find((i) => String(i.id) === dropKey);
      if (!dragged || !dropped) return prev;

      const sameParent =
        String(dragged.parentId || null) === String(dropped.parentId || null);
      if (!sameParent) return prev;

      const parentKey = String(dragged.parentId || null);
      const siblings = prev
        .filter((i) => String(i.parentId || null) === parentKey)
        .sort((a, b) => (a.position || 0) - (b.position || 0));

      const from = siblings.findIndex((s) => String(s.id) === dragKey);
      const to = siblings.findIndex((s) => String(s.id) === dropKey);
      if (from < 0 || to < 0) return prev;

      const moved = [...siblings];
      moved.splice(to, 0, moved.splice(from, 1)[0]);

      // Renumber the whole group, then write those positions back.
      const positionById = new Map(
        moved.map((s, index) => [String(s.id), index]),
      );
      return prev.map((i) =>
        positionById.has(String(i.id))
          ? { ...i, position: positionById.get(String(i.id)) }
          : i,
      );
    });
  };

  /* --- Duplicate the whole menu --- */
  /**
   * Copy every item once, keeping each copy under the same parent as its
   * original.
   *
   * The nesting is rebuilt through an old-id -> new-id map rather than by
   * pointing copies at the originals, which would produce two parents
   * sharing one set of children and lose the original rows on the next save.
   * New rows land after the originals so the menu still reads in order.
   */
  const duplicateMenu = () => {
    if (!items.length) return;

    const stamp = Date.now();
    const newIdFor = new Map(
      items.map((item, index) => [String(item.id), `copy_${stamp}_${index}`]),
    );

    const copies = items.map((item, index) => ({
      ...item,
      id: newIdFor.get(String(item.id)),
      parentId: item.parentId
        ? (newIdFor.get(String(item.parentId)) ?? null)
        : null,
      // Pushed past every original so the duplicate reads as an appended
      // copy rather than interleaving with the menu it came from.
      position: (Number(item.position) || 0) + 1000,
      isNew: true,
    }));

    setItems((prev) => [...prev, ...copies]);
  };

  /**
   * Flatten the working list into the payload the save endpoint expects.
   *
   * Extracted from handleSave because the filtering below has a consequence
   * worth stating once, in one place.
   *
   * Rows with no label are dropped - an abandoned "Untitled" row should not
   * become a real menu entry. But a dropped row can be some OTHER row's parent:
   * open a parent, add a sub-item, never name it, then save, and the child
   * still points at an id that is no longer in the batch. The server rejects
   * that with "Parent must reference another item in this batch", so the whole
   * menu fails to save because of one half-finished row.
   *
   * So a child whose parent was dropped is promoted to the top level instead
   * of taking the menu down with it. The alternative - silently deleting the
   * child - would throw away a row the user can still see and name.
   */
  const buildPayload = (list) => {
    const named = list.filter((i) => String(i.label || '').trim());
    const namedIds = new Set(named.map((i) => String(i.id)));

    return named
      .map((i) => ({
        id: i.id,
        label: String(i.label || '').trim(),
        targetType: i.targetType || 'category',
        target: String(i.target || '').trim(),
        // Promoted when the parent was dropped for having no label.
        parentId:
          i.parentId && namedIds.has(String(i.parentId)) ? i.parentId : null,
        position: Number(i.position || 0),
        isVisible: i.isVisible !== false,
      }))
      .sort((a, b) => {
        const aLevel = a.parentId ? 1 : 0;
        const bLevel = b.parentId ? 1 : 0;
        return aLevel - bLevel || a.position - b.position;
      });
  };

  const handleSave = async () => {
    if (!store) return;
    const storeId = store._id || store.id;
    if (!storeId) return;

    const normalized = buildPayload(items);

    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const saved = await menuService.saveStoreMenu(storeId, normalized);
      setItems(saved);
      setSuccess('Menu saved!');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.message || 'Could not save the menu.');
    } finally {
      setSaving(false);
    }
  };

  const handleStoreSelect = (storeId) => {
    const s = allStores.find((st) => String(st._id) === storeId);
        applyStore(s);
    loadMenu(storeId);
  };

  /* --- Tree rendering -------------------------------------------------
     * One collapsed row per item, exactly as the reference: a drag handle, an
     * expand caret, and the label. The editing form lives BELOW the row and only
     * exists while that row is open.
     *
     * This is the whole reason the screen reads as a menu rather than a form.
     * Previously every item rendered its label field, target type, target
     * picker, visibility checkbox and four buttons all at once, so a menu with
     * twelve items was a wall of controls with no shape to it. Now the shape is
     * the content: you can see the menu, and you open one row to change it.
     * ------------------------------------------------------------------- */
  function renderBranch(nodes, depth = 0) {
    return nodes.map((item) => {
      const key = String(item.id);
      const isOpen = openIds.has(key);
      const isEditing = editingIds.has(key);
      const children = item.children || [];
      const hasChildren = children.length > 0;
      const siblingCount = items.filter(
        (i) => String(i.parentId || null) === String(item.parentId || null)
      ).length;

      return (
        <div key={key} className={'menu-node' + (depth ? ' menu-node--child' : '')}>
          <div
            className={
              'menu-row' +
              (isEditing ? ' is-editing' : '') +
              (dragId === key ? ' is-dragging' : '')
            }
            draggable
            onDragStart={() => {
              dragIdRef.current = key;
              setDragId(key);
            }}
            onDragEnd={() => {
              dragIdRef.current = null;
              setDragId(null);
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIdRef.current) reorderTo(dragIdRef.current, key);
              dragIdRef.current = null;
              setDragId(null);
            }}
          >
            <span className="menu-row__grip" aria-hidden="true">
              <Icon name="grip" />
            </span>

            {/* Every top-level row gets a caret, INCLUDING a leaf. That is the
                whole "add a sub-item" affordance: a parent with no children yet
                still needs a way to open its (empty) submenu, and the add row
                lives in there. A leaf had no caret before, so the first
                sub-item could only ever be added to a parent that already had
                one.

                A caret is deliberately NOT given to sub-items. Nesting stops at
                two levels here because the save endpoint resolves parents in a
                single parents-then-children pass, so a third level would be
                written before its own parent existed and the whole save would
                fail with "Parent item was not found earlier in the batch". */}
            {depth === 0 ? (
              <button
                type="button"
                className={'menu-row__caret' + (isOpen ? ' is-open' : '')}
                onClick={() => toggleOpen(key)}
                aria-expanded={isOpen}
                aria-label={
                  hasChildren
                    ? isOpen
                      ? 'Hide sub-items'
                      : 'Show sub-items'
                    : 'Add a sub-item'
                }
                title={
                  hasChildren
                    ? isOpen
                      ? 'Hide sub-items'
                      : 'Show sub-items'
                    : 'Add a sub-item'
                }
              >
                <Icon name="caret" />
              </button>
            ) : null}

            <button
              type="button"
              className="menu-row__label"
              onClick={() => toggleEditing(key)}
              aria-expanded={isEditing}
            >
              {String(item.label || '').trim() || (
                <span className="menu-row__untitled">Untitled</span>
              )}
            </button>

            {item.isVisible === false ? (
              <span className="menu-row__hidden" title="Hidden from the storefront">
                Hidden
              </span>
            ) : null}

            <div className="menu-row__actions">
              <button
                type="button"
                className="menu-row__action"
                onClick={() => toggleEditing(key)}
                title="Edit"
                aria-label={'Edit ' + (item.label || 'menu item')}
              >
                <Icon name="pencil" />
              </button>
              <button
                type="button"
                className="menu-row__action menu-row__action--danger"
                onClick={() => removeItem(key)}
                title="Delete"
                aria-label={'Delete ' + (item.label || 'menu item')}
              >
                <Icon name="trash" />
              </button>
            </div>
          </div>

          {isEditing ? (
            <div className="menu-row__editor">
              <label className="field field--sm">
                <span>Label</span>
                <input
                  type="text"
                  value={item.label || ''}
                  placeholder="Menu item name"
                  onChange={(e) => updateItem(item.id, 'label', e.target.value)}
                />
              </label>

              <label className="field field--sm">
                <span>Links to</span>
                <select
                  value={item.targetType || 'category'}
                  onChange={(e) => {
                    updateItem(item.id, 'targetType', e.target.value);
                    updateItem(item.id, 'target', '');
                  }}
                >
                  {TARGET_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </label>

              {item.targetType === 'category' ? (
                <label className="field field--sm">
                  <span>Category</span>
                  <select
                    value={item.target || ''}
                    onChange={(e) => updateItem(item.id, 'target', e.target.value)}
                  >
                    <option value="">Pick a category</option>
                    {categories.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                    {item.target && !categories.includes(item.target) ? (
                      <option value={item.target}>&ldquo;{item.target}&rdquo;</option>
                    ) : null}
                  </select>
                </label>
              ) : item.targetType === 'product' ? (
                <label className="field field--sm">
                  <span>Product</span>
                  <select
                    value={item.target || ''}
                    onChange={(e) => updateItem(item.id, 'target', e.target.value)}
                  >
                    <option value="">Pick a product</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </label>
              ) : (
                <label className="field field--sm">
                  <span>Address</span>
                  <input
                    type="url"
                    placeholder="/path or https://…"
                    value={item.target || ''}
                    onChange={(e) => updateItem(item.id, 'target', e.target.value)}
                  />
                </label>
              )}

              <label className="checkbox-inline menu-row__visible">
                <input
                  type="checkbox"
                  checked={item.isVisible !== false}
                  onChange={(e) => updateItem(item.id, 'isVisible', e.target.checked)}
                />
                Visible
              </label>

              <div className="menu-row__editor-actions">
                {siblingCount > 1 ? (
                  <>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      onClick={() => moveItem(item.id, 'up')}
                    >
                      Move up
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      onClick={() => moveItem(item.id, 'down')}
                    >
                      Move down
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  onClick={() => toggleEditing(key)}
                >
                  Done
                </button>
              </div>
            </div>
          ) : null}

          {/* Rendered whenever the row is OPEN, not only when it has children.
              That is what makes an empty submenu usable: a parent opened for
              the first time shows one button and nothing else, which says
              "this can have sub-items" far better than hiding the only way to
              create one. */}
          {isOpen ? (
            <div className="menu-children">
              {renderBranch(children, depth + 1)}

              {/* "Add menu item to <PARENT>", named for the parent it will land
                  under. A generic "+" would not say where the new row goes.
                  addItem expands this parent and opens the new row's editor
                  on its own, so no extra state juggling is needed here. */}
              <button
                type="button"
                className="menu-row menu-row--add"
                onClick={() => addItem(key)}
              >
                <span className="menu-row__grip" aria-hidden="true" />
                <span className="menu-row__plus" aria-hidden="true">
                  <Icon name="plus" />
                </span>
                Add menu item to {String(item.label || '').trim() || 'this item'}
              </button>
            </div>
          ) : null}
        </div>
      );
    });
  }


  const topLevel = useMemo(() => buildTree(items), [items]);

  if (loading && !store && !allStores.length) {
    return <LoadingSpinner fullPage label="Loading…" />;
  }

  return (
    <div className="theme-builder">
      <header className="theme-builder__header">
        <div>
          <h1>{isMerchant ? 'Store theme' : 'Menu editor'}</h1>
          {store ? (
            <p className="muted">
              Editing: <strong>{store.name}</strong> · /s/{store.slug}
            </p>
          ) : null}
        </div>
        <div className="theme-builder__actions">
          {!isMerchant && (
            <select
              className="field field--sm"
              value={store ? String(store._id) : ''}
              onChange={(e) => handleStoreSelect(e.target.value)}
            >
              <option value="">Select a store</option>
              {allStores.map((s) => (
                <option key={String(s._id)} value={String(s._id)}>{s.name}</option>
              ))}
            </select>
          )}
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={duplicateMenu}
            disabled={!store || !items.length}
            title="Copy every item in this menu"
          >
            Duplicate
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handleSave}
            disabled={saving || !store}
          >
            {saving ? 'Saving…' : 'Save menu'}
          </button>
          {store ? (
            <Link
              to={store?.publicPath || `/s/${store.slug}`}
              className="btn btn-ghost btn-sm"
              target="_blank"
              rel="noopener noreferrer"
            >
              View store
            </Link>
          ) : null}
        </div>
      </header>

      {errorMsg ? <div className="alert alert--danger">{errorMsg}</div> : null}
      {successMsg ? <div className="alert alert--ok">{successMsg}</div> : null}

      {store ? (
        <section className="panel theme-logo">
          <div className="theme-logo__preview">
            {logoPreview ? (
              <img src={logoPreview} alt={`${store.name} logo`} className="theme-logo__img" />
            ) : (
              <span className="theme-logo__placeholder" aria-hidden="true">
                {String(store.name || '?').trim().slice(0, 2).toUpperCase() || '?'}
              </span>
            )}
          </div>
          <div className="theme-logo__body">
            <h2 className="panel__title">Store logo</h2>
            <p className="muted small">
              Shown in the storefront header next to the store name. PNG or JPG
              under 5 MB works best.
            </p>
            <div className="button-row">
              <label className={`btn btn-outline btn-sm${logoBusy ? ' is-disabled' : ''}`}>
                {logoBusy ? 'Uploading…' : logoPreview ? 'Change logo' : 'Upload logo'}
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  disabled={logoBusy}
                  onChange={handleLogoFile}
                />
              </label>
              {logoPreview ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm btn-danger"
                  onClick={handleLogoRemove}
                  disabled={logoBusy}
                >
                  Remove
                </button>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {!store ? (
        <p className="muted">
          {isMerchant
            ? 'No store linked to your account.'
            : 'Select a store to edit its menu.'}
        </p>
      ) : (
        <section className="menu-editor">
          <h2 className="menu-editor__title">Menu items</h2>

          {/* The list sits in one bordered card, as in the reference. The
              heading stays OUTSIDE it: the card is the menu, the heading is
              the page. */}
          <div className="menu-editor__card">
            {topLevel.length === 0 ? (
              <p className="muted menu-editor__empty">
                No menu items yet. Add one below to start building your
                storefront navigation.
              </p>
            ) : (
              renderBranch(topLevel)
            )}

            {/* The always-present "Add menu item" row, as in the reference. It
                sits at the bottom of the card so the list has a closing edge
                and the next item is always one click away, rather than a
                button in the page header that scrolls out of reach. */}
            <button
              type="button"
              className="menu-row menu-row--add menu-row--add-root"
              onClick={() => addItem(null)}
              disabled={!store}
            >
              <span className="menu-row__grip" aria-hidden="true" />
              <span className="menu-row__plus" aria-hidden="true">
                <Icon name="plus" />
              </span>
              Add menu item
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, Link } from 'react-router-dom';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import storeService from '../../services/storeService';
import menuService from '../../services/menuService';

const TARGET_TYPES = [
  { value: 'category', label: 'Category' },
  { value: 'product', label: 'Product' },
  { value: 'url', label: 'Web address' },
];

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

  /* --- Load initial data --- */
  const loadMenu = useCallback(async (storeId) => {
    try {
      setLoading(true);
      setError('');
      const data = await menuService.loadStoreMenu(storeId);
      setStore(data.store);
      setItems(data.items);
      setCategories(data.categories);
      setProducts(data.products);
    } catch (err) {
      setError(err.message || 'Could not load the menu.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isMerchant) {
      storeService
        .getMyStore()
        .then((data) => {
          const s = data.store;
          setStore(s);
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
    }, [isMerchant, loadMenu]);

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

  const addItem = (parentId = null) => {
    const siblingCount = items.filter(
      (i) => String(i.parentId || null) === String(parentId || null)
    ).length;
    setItems([
      ...items,
      {
        id: `new_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        label: '',
        targetType: 'category',
        target: '',
        parentId,
        position: siblingCount,
        isVisible: true,
        isNew: true,
      },
    ]);
  };

  const handleSave = async () => {
    if (!store) return;
    const storeId = store._id || store.id;
    if (!storeId) return;

    const normalized = items
      .filter((i) => String(i.label || '').trim())
      .map((i) => ({
        id: i.id,
        label: String(i.label || '').trim(),
        targetType: i.targetType || 'category',
        target: String(i.target || '').trim(),
        parentId: i.parentId || null,
        position: Number(i.position || 0),
        isVisible: i.isVisible !== false,
      }))
      .sort((a, b) => {
        const aLevel = a.parentId ? 1 : 0;
        const bLevel = b.parentId ? 1 : 0;
        return aLevel - bLevel || a.position - b.position;
      });

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
        setStore(s);
    loadMenu(storeId);
  };

  /* --- Tree rendering --- */
  function renderBranch(nodes, depth = 0) {
    return nodes.map((item) => {
      const topLevel = depth === 0;
      const siblingCount = items.filter(
        (i) => String(i.parentId || null) === String(item.parentId || null)
      ).length;

      return (
        <div
          key={item.id}
          className={`theme-item ${topLevel ? 'theme-item--top' : 'theme-item--sub'}`}
          style={{ '--depth': depth }}
        >
          <div className="theme-item__row">
            <input
              type="text"
              className="field field--sm"
              placeholder="Label"
              value={item.label || ''}
              onChange={(e) => updateItem(item.id, 'label', e.target.value)}
            />

            <select
              className="field field--sm"
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

            {item.targetType === 'category' ? (
              <select
                className="field field--sm"
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
            ) : item.targetType === 'product' ? (
              <select
                className="field field--sm"
                value={item.target || ''}
                onChange={(e) => updateItem(item.id, 'target', e.target.value)}
              >
                <option value="">Pick a product</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            ) : (
              <input
                type="url"
                className="field field--sm"
                placeholder="/path or https://…"
                value={item.target || ''}
                onChange={(e) => updateItem(item.id, 'target', e.target.value)}
              />
            )}

            <label className="checkbox-inline">
              <input
                type="checkbox"
                checked={item.isVisible !== false}
                onChange={(e) => updateItem(item.id, 'isVisible', e.target.checked)}
              />
              Visible
            </label>

            <div className="theme-item__actions">
              {topLevel && siblingCount > 1 ? (
                <>
                  <button type="button" className="btn btn-ghost btn-xs"
                    onClick={() => moveItem(item.id, 'up')} title="Move up">↑</button>
                  <button type="button" className="btn btn-ghost btn-xs"
                    onClick={() => moveItem(item.id, 'down')} title="Move down">↓</button>
                </>
              ) : null}

              {depth === 0 ? (
                <button type="button" className="btn btn-ghost btn-xs"
                  onClick={() => addItem(item.id)} title="Add sub-item">+</button>
              ) : null}

              <button type="button" className="btn btn-ghost btn-xs btn-danger"
                onClick={() => removeItem(item.id)} title="Remove">✕</button>
            </div>
          </div>

          {item.children && item.children.length > 0 ? (
            <div className="theme-item__children">
              {renderBranch(item.children, depth + 1)}
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
            onClick={() => addItem(null)}
            disabled={!store}
          >
            + Top-level item
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

      {!store ? (
        <p className="muted">
          {isMerchant
            ? 'No store linked to your account.'
            : 'Select a store to edit its menu.'}
        </p>
      ) : (
        <div className="theme-list">
          {topLevel.length === 0 ? (
            <p className="muted">
              No menu items yet. Click “+ Top-level item” to add one, or use a
              category link so customers can filter products.
            </p>
          ) : (
            renderBranch(topLevel)
          )}
        </div>
      )}
    </div>
  );
}

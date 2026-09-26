import { useCallback, useEffect, useMemo, useState } from 'react';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import { useAuth } from '../../context/AuthContext';
import productService from '../../services/productService';
import { formatCurrency, formatLocation, truncate } from '../../utils/formatters';

const EMPTY_FORM = {
  name: '',
  price: '',
  category: '',
  stock: '',
  rack: '',
  shelf: '',
  image: '',
  description: '',
};

export default function ProductManager() {
  const { stores, storeRole } = useAuth();
  // Every catalogue editor - store owner, appointed store admin, or platform
  // admin through an accepted invitation - only ever sees and edits the
  // store(s) they run.
  const memberStores = useMemo(
    () => (stores || []).map((entry) => entry.store).filter(Boolean),
    [stores],
  );
  const [storeId, setStoreId] = useState('');

  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  // "Where is it?" box: filters the loaded catalogue by name, category,
  // description, rack or shelf, so a picker can type A3 and get straight to
  // that rack. Client-side because every store this account runs is already
  // loaded - typing must not cost a round trip per keystroke.
  const [query, setQuery] = useState('');

  // One client-side pass over the products already loaded for the stores this
  // account runs, matching the same fields as GET /products?search=. This list
  // is the merchant's own working view, not the public storefront.
  const visibleProducts = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return products;

    return products.filter((product) =>
      [product.name, product.category, product.description, product.rack, product.shelf].some(
        (value) => String(value ?? '').toLowerCase().includes(term),
      ),
    );
  }, [products, query]);

  // Default the target store: the primary one from the session.
  useEffect(() => {
    if (memberStores.length && !storeId) {
      setStoreId(String(memberStores[0]._id || memberStores[0].id));
    }
  }, [memberStores, storeId]);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      // One call per store they run, merged newest-first. The backend also
      // re-checks every write, so this list is only ever a convenience.
      const lists = await Promise.all(
        memberStores.map((store) =>
          productService.getProducts({ store: store._id || store.id }),
        ),
      );
      setProducts(
        lists
          .flat()
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
      );
    } catch (err) {
      setError(err.message || 'Could not load the inventory.');
    } finally {
      setLoading(false);
    }
  }, [memberStores]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  const handleChange = (event) =>
    setForm((prev) => ({ ...prev, [event.target.name]: event.target.value }));

  const resetForm = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const startEdit = (product) => {
    const id = product._id || product.id;

    setEditingId(id);
    setForm({
      name: product.name || '',
      price: String(product.price ?? ''),
      category: product.category || '',
      stock: String(product.stock ?? ''),
      rack: product.rack || '',
      shelf: product.shelf || '',
      image: product.image || '',
      description: product.description || '',
    });
    setNotice('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setNotice('');

    if (!form.name.trim()) {
      setError('A product needs a name.');
      return;
    }

    const payload = {
      name: form.name.trim(),
      price: Number(form.price) || 0,
      category: form.category.trim(),
      stock: form.stock === '' ? 0 : Number(form.stock),
      rack: form.rack.trim(),
      shelf: form.shelf.trim(),
      image: form.image.trim(),
      description: form.description.trim(),
    };

    // A member running several stores must say which one; the backend pins
    // the product for anybody with a single store.
    if (memberStores.length > 1 && storeId) {
      payload.storeId = storeId;
    }

    setSaving(true);

    try {
      if (editingId) {
        const updated = await productService.updateProduct(editingId, payload);
        setProducts((prev) =>
          prev.map((product) =>
            (product._id || product.id) === editingId
              ? { ...product, ...payload, ...updated }
              : product,
          ),
        );
        setNotice(`“${payload.name}” updated.`);
      } else {
        const created = await productService.createProduct(payload);
        setProducts((prev) => [created, ...prev]);
        setNotice(`“${payload.name}” added to the catalogue.`);
      }

      resetForm();
    } catch (err) {
      setError(err.message || 'Could not save that product.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (product) => {
    const id = product._id || product.id;

    if (!id) return;
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete “${product.name}”? This cannot be undone.`)) {
      return;
    }

    setDeletingId(id);
    setError('');

    try {
      await productService.deleteProduct(id);
      setProducts((prev) =>
        prev.filter((item) => (item._id || item.id) !== id),
      );
      if (editingId === id) resetForm();
    } catch (err) {
      setError(err.message || 'Could not delete that product.');
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) return <LoadingSpinner fullPage label="Loading inventory…" />;

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1>Inventory</h1>
          <p className="muted">
            {memberStores.length === 0
              ? 'No store is linked to this account yet — accept a store invitation to manage its catalogue.'
              : `${products.length} products in ${memberStores.length > 1 ? 'your stores' : memberStores[0]?.name || 'your store'}`}
            {storeRole === 'admin' ? ' · you were appointed as a store admin' : ''}
          </p>
        </div>

        <button
          type="button"
          className="btn btn-outline btn-sm"
          onClick={loadProducts}
        >
          Refresh
        </button>
      </header>

      {error ? <p className="alert alert--danger">{error}</p> : null}
      {notice ? <p className="alert alert--ok">{notice}</p> : null}

      <div className="manager">
        <form className="panel" onSubmit={handleSubmit}>
          <h2 className="panel__title">
            {editingId ? 'Edit product' : 'Add a product'}
          </h2>

          {memberStores.length > 1 ? (
            <label className="field">
              <span>Store</span>
              <select
                value={storeId}
                onChange={(event) => setStoreId(event.target.value)}
              >
                {memberStores.map((store) => (
                  <option key={store._id || store.id} value={store._id || store.id}>
                    {store.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="field">
            <span>Name</span>
            <input
              type="text"
              name="name"
              value={form.name}
              onChange={handleChange}
              placeholder="Chicken Momo"
              required
            />
          </label>

          <div className="field-row">
            <label className="field">
              <span>Price</span>
              <input
                type="number"
                name="price"
                min="0"
                step="0.01"
                value={form.price}
                onChange={handleChange}
                placeholder="4.50"
                required
              />
            </label>

            <label className="field">
              <span>Stock</span>
              <input
                type="number"
                name="stock"
                min="0"
                step="1"
                value={form.stock}
                onChange={handleChange}
                placeholder="25"
              />
            </label>
          </div>

          <label className="field">
            <span>Category</span>
            <input
              type="text"
              name="category"
              value={form.category}
              onChange={handleChange}
              placeholder="Food"
            />
          </label>

          <div className="field-row">
            <label className="field">
              <span>Rack</span>
              <input
                type="text"
                name="rack"
                maxLength={20}
                value={form.rack}
                onChange={handleChange}
                placeholder="A3"
              />
            </label>

            <label className="field">
              <span>Shelf</span>
              <input
                type="text"
                name="shelf"
                maxLength={20}
                value={form.shelf}
                onChange={handleChange}
                placeholder="2"
              />
            </label>
          </div>

          <p className="muted small">
            Where the item sits in the shop, so staff can find it on a big
            order. Both parts are optional.
          </p>

          <label className="field">
            <span>Image URL</span>
            <input
              type="url"
              name="image"
              value={form.image}
              onChange={handleChange}
              placeholder="https://example.com/photo.jpg"
            />
          </label>

          <label className="field">
            <span>Description</span>
            <textarea
              name="description"
              rows={3}
              value={form.description}
              onChange={handleChange}
              placeholder="Short text shown on the store card"
            />
          </label>

          <div className="button-row">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving
                ? 'Saving…'
                : editingId
                  ? 'Save changes'
                  : 'Add product'}
            </button>

            {editingId ? (
              <button type="button" className="btn btn-ghost" onClick={resetForm}>
                Cancel
              </button>
            ) : null}
          </div>
        </form>

        <div className="table-wrap">
          <div className="table-toolbar">
            <label className="field">
              <span>Find a product</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Name, category, rack or shelf — e.g. A3"
              />
            </label>

            <span className="muted small">
              {query.trim()
                ? `${visibleProducts.length} of ${products.length} shown`
                : `${products.length} product(s)`}
            </span>
          </div>

          <table className="table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Category</th>
                <th>Location</th>
                <th>Price</th>
                <th>Stock</th>
                <th />
              </tr>
            </thead>

            <tbody>
              {visibleProducts.map((product) => {
                const id = product._id || product.id;

                return (
                  <tr key={id}>
                    <td>
                      <div className="table__product">
                        {product.image ? (
                          <img src={product.image} alt="" className="thumb" />
                        ) : (
                          <span className="thumb thumb--empty" aria-hidden="true">
                            🛍️
                          </span>
                        )}

                        <div>
                          <strong>{product.name}</strong>
                          <span className="muted small block">
                            {truncate(product.description || '—', 48)}
                          </span>
                        </div>
                      </div>
                    </td>

                    <td>{product.category || '—'}</td>
                    <td className="muted">{formatLocation(product)}</td>
                    <td>{formatCurrency(product.price)}</td>
                    <td>{product.stock ?? '—'}</td>

                    <td className="table__actions">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => startEdit(product)}
                      >
                        Edit
                      </button>

                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={() => handleDelete(product)}
                        disabled={deletingId === id}
                      >
                        {deletingId === id ? 'Deleting…' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {visibleProducts.length === 0 ? (
            <p className="empty">
              {query.trim()
                ? `Nothing matches “${query.trim()}”.`
                : 'No products yet — add your first one on the left.'}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
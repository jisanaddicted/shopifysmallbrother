import { useCallback, useEffect, useState } from 'react';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import productService from '../../services/productService';
import { formatCurrency, truncate } from '../../utils/formatters';

const EMPTY_FORM = {
  name: '',
  price: '',
  category: '',
  stock: '',
  image: '',
  description: '',
};

export default function ProductManager() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const list = await productService.getProducts();
      setProducts(Array.isArray(list) ? list : []);
    } catch (err) {
      setError(err.message || 'Could not load the inventory.');
    } finally {
      setLoading(false);
    }
  }, []);

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
      image: form.image.trim(),
      description: form.description.trim(),
    };

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
          <p className="muted">{products.length} products in the catalogue</p>
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
          <table className="table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Category</th>
                <th>Price</th>
                <th>Stock</th>
                <th />
              </tr>
            </thead>

            <tbody>
              {products.map((product) => {
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

          {products.length === 0 ? (
            <p className="empty">
              No products yet — add your first one on the left.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import BulkEditPanel from '../../components/store/BulkEditPanel';
import { useAuth } from '../../context/AuthContext';
import productService from '../../services/productService';
import {
  formatInventoryValue,
  inventoryLabel,
  isOutOfStock,
  statusLabel,
  statusTone,
  summarise,
} from '../../utils/catalog';
import {
  PRODUCT_STATUS,
  PRODUCT_STATUS_LABELS,
  PRODUCT_STATUS_VALUES,
  productEditPath,
  productNewPath,
} from '../../utils/constants';
import { formatProductPrice } from '../../utils/variants';

// The status filter's "All" option. `all` is a real value the API understands
// (see listProducts), not a client-side fiction - asking for it there is what
// lets this screen see drafts at all, since the API hides them by default.
const STATUS_FILTERS = ['all', ...PRODUCT_STATUS_VALUES];

/**
 * The products list.
 *
 * Deliberately holds no form state: opening a product navigates to
 * ProductEditor, which owns everything that writes. That split is what makes
 * "click a row" and "Add product" the same code path rather than two
 * hand-maintained copies of a form that can drift apart.
 *
 * `basePath` is the route this list itself is mounted at, passed in by App.jsx
 * so the merchant and admin shells can share this one component and still
 * produce links that stay inside their own side rail.
 */
export default function ProductManager({ basePath = '/merchant/products' }) {
  const navigate = useNavigate();
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

  // "Where is it?" box: filters the loaded catalogue by anything a picker
  // would know - name, description, category, rack, shelf, vendor, product
  // type, a collection or a variant SKU. Client-side because every store this
  // account runs is already loaded, so typing must not cost a round trip per
  // keystroke. The API matches the same fields, so the two agree.
  const [query, setQuery] = useState('');
  // Which slice of the catalogue to show. Defaults to Active because that is
  // what the storefront shows; a draft is a thing you go looking for.
  const [statusFilter, setStatusFilter] = useState(PRODUCT_STATUS.ACTIVE);

  // Rows ticked in the table, for the bulk bar. A Set because the same id can
  // arrive from a re-render and a list must not care about order.
  const [selected, setSelected] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  // Whether the bulk edit form is showing. Kept open across a selection
  // change so a merchant who ticks one more box does not lose what they
  // typed - the form holds its own state, not the list.
  const [bulkOpen, setBulkOpen] = useState(false);

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
      // One call per store they run, merged newest-first. `status: all` is
      // required: the API hides drafts and archived products from anyone who
      // has not asked for them, and this screen is where a merchant manages
      // exactly those. The backend also re-checks every write, so this list is
      // only ever a convenience.
      const lists = await Promise.all(
        memberStores.map((store) =>
          productService.getProducts({ store: store._id || store.id, status: 'all' }),
        ),
      );
      setProducts(
        lists
          .flat()
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
      );
    } catch (err) {
      setError(err.message || 'Could not load the catalogue.');
    } finally {
      setLoading(false);
    }
  }, [memberStores]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  /**
   * What the table shows, after the status filter and then the search box.
   *
   * Both run client-side against the already-loaded rows, in that order, so
   * typing narrows whatever slice is on screen rather than resetting the
   * merchant back to "Active" every time they type a character.
   */
  const visibleProducts = useMemo(() => {
    const term = query.trim().toLowerCase();
    const rows =
      statusFilter === 'all'
        ? products
        : products.filter((product) => (product.status || PRODUCT_STATUS.ACTIVE) === statusFilter);

    if (!term) return rows;

    return rows.filter((product) =>
      [
        product.name,
        product.category,
        product.description,
        product.rack,
        product.shelf,
        product.vendor,
        product.productType,
        ...(product.collections || []),
        ...(product.variants || []).map((variant) => variant.sku),
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term)),
    );
  }, [products, query, statusFilter]);

  // The headline numbers describe what is on screen, not the whole catalogue:
  // after a filter the merchant is asking about the filtered list.
  const stats = useMemo(() => summarise(visibleProducts), [visibleProducts]);

  // A selection that outlives its rows (after a delete, or a filter change)
  // would make the bulk bar act on products that are not listed. Dropped here
  // rather than checked at click time so the count in the bar is always true.
  useEffect(() => {
    const live = new Set(visibleProducts.map((product) => product._id || product.id));
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => live.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [visibleProducts]);

  const toggleRow = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allVisibleSelected =
    visibleProducts.length > 0 && visibleProducts.every((p) => selected.has(p._id || p.id));

  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      const ids = visibleProducts.map((product) => product._id || product.id);
      if (allVisibleSelected) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });

  const openProduct = (product) =>
    navigate(productEditPath(basePath, product._id || product.id));

  const handleDelete = async (product) => {
    const id = product._id || product.id;
    if (!id) return;
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete “${product.name}”? This cannot be undone.`)) {
      return;
    }

    setError('');

    try {
      await productService.deleteProduct(id);
      setProducts((prev) => prev.filter((item) => (item._id || item.id) !== id));
      setNotice(`“${product.name}” deleted.`);
    } catch (err) {
      setError(err.message || 'Could not delete that product.');
    }
  };

  /**
   * Apply one set of changes to every ticked product, in a single request.
   *
   * This used to loop over PUT /products/:id. One PATCH instead is not just
   * faster: a PUT is a full replace, so the old loop had to echo every field
   * of every product back from the browser copy. If one had been edited
   * anywhere else since the list loaded, that round trip would silently
   * revert it. The bulk endpoint is a partial update, so nothing outside
   * `changes` can be touched.
   *
   * The server answers with what happened to EACH product rather than a bare
   * ok, so a partial success is reported honestly - three products it cannot
   * touch must not read as "everything was saved".
   */
  const runBulkEdit = async (changes) => {
    const ids = [...selected];
    if (!ids.length) return;

    setBulkBusy(true);
    setError('');
    setNotice('');

    try {
      const result = await productService.bulkUpdateProducts(ids, changes);

      const updated = result.updated?.length || 0;
      const problems = [...(result.skipped || []), ...(result.failed || [])];

      // Closed and cleared only on a clean run, so a partial failure leaves
      // the merchant looking at the products that did not change and able to
      // retry exactly those.
      if (updated === ids.length) {
        setBulkOpen(false);
        setSelected(new Set());
        setNotice(`Updated ${updated} product${updated === 1 ? '' : 's'}.`);
      } else if (updated > 0) {
        setNotice(`Updated ${updated} of ${ids.length}.`);
      }

      if (problems.length) {
        setError(
          `${problems.length} product(s) could not be changed: ${problems[0].reason}`,
        );
      }

      await loadProducts();
    } catch (err) {
      setError(err.message || 'Could not update those products.');
    } finally {
      setBulkBusy(false);
    }
  };

  /**
   * Delete every ticked product.
   *
   * One confirmation for the whole batch, naming a few of them: deleting
   * thirty products is not undoable, and a dialog that only said
   * "delete 30?" would not let anybody check they had ticked the right ones.
   */
  const runBulkDelete = async () => {
    const ids = [...selected];
    if (!ids.length) return;

    const names = visibleProducts
      .filter((product) => ids.includes(product._id || product.id))
      .map((product) => product.name);
    const preview = names.slice(0, 3).join(', ');
    const more = names.length > 3 ? ` and ${names.length - 3} more` : '';

    // eslint-disable-next-line no-alert
    if (
      !window.confirm(
        `Delete ${ids.length} product(s)?\n\n${preview}${more}\n\nThis cannot be undone.`,
      )
    ) {
      return;
    }

    setBulkBusy(true);
    setError('');
    setNotice('');

    try {
      const result = await productService.bulkDeleteProducts(ids);
      const deleted = result.deleted || 0;

      if (deleted === ids.length) {
        setBulkOpen(false);
        setSelected(new Set());
      }

      setNotice(`Deleted ${deleted} product${deleted === 1 ? '' : 's'}.`);

      if (result.skipped?.length) {
        setError(
          `${result.skipped.length} could not be deleted: ${result.skipped[0].reason}`,
        );
      }

      await loadProducts();
    } catch (err) {
      setError(err.message || 'Could not delete those products.');
    } finally {
      setBulkBusy(false);
    }
  };

  if (loading) return <LoadingSpinner fullPage label="Loading catalogue…" />;

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1>Products</h1>
          <p className="muted">
            {memberStores.length === 0
              ? 'No store is linked to this account yet — accept a store invitation to manage its catalogue.'
              : `${products.length} product${products.length === 1 ? '' : 's'} in ${
                  memberStores.length > 1
                    ? 'your stores'
                    : memberStores[0]?.name || 'your store'
                }${storeRole === 'admin' ? ' · you were appointed as a store admin' : ''}`}
          </p>
        </div>

        <div className="button-row">
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={loadProducts}
            disabled={loading}
          >
            Refresh
          </button>

          <Link className="btn btn-primary" to={productNewPath(basePath)}>
            Add product
          </Link>
        </div>
      </header>

      {error ? <p className="alert alert--danger">{error}</p> : null}
      {notice ? <p className="alert alert--ok">{notice}</p> : null}

      {/* The summary strip. Reads the filtered rows rather than the whole
          catalogue, so the figures always describe what the table below is
          actually showing. */}
      <div className="psum">
        <div className="psum__cell">
          <span className="psum__label">Showing</span>
          <strong className="psum__value">
            {visibleProducts.length} of {products.length}
          </strong>
        </div>

        <div className="psum__cell">
          <span className="psum__label">Active</span>
          <strong className="psum__value">{stats.active}</strong>
          <span className="psum__note">
            {stats.draft} draft · {stats.archived} archived
          </span>
        </div>

        <div className="psum__cell">
          <span className="psum__label">Out of stock</span>
          <strong className={`psum__value${stats.outOfStock ? ' is-danger' : ''}`}>
            {stats.outOfStock}
          </strong>
          <span className="psum__note">across the list</span>
        </div>

        <div className="psum__cell">
          <span className="psum__label">With options</span>
          <strong className="psum__value">{stats.withVariants}</strong>
          <span className="psum__note">sold as a matrix</span>
        </div>

        <div className="psum__cell">
          <span className="psum__label">Inventory value</span>
          <strong className="psum__value">{formatInventoryValue(stats.inventoryValue)}</strong>
          <span className="psum__note">cheapest price × stock</span>
        </div>
      </div>

      <div className="table-wrap">
        <div className="table-toolbar">
          <label className="field">
            <span>Search and filter</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Name, vendor, rack, SKU…"
            />
          </label>

          <label className="field field--inline">
            <span>Status</span>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              {STATUS_FILTERS.map((status) => (
                <option key={status} value={status}>
                  {status === 'all' ? 'All' : PRODUCT_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </label>

          {memberStores.length > 1 ? (
            <label className="field field--inline">
              <span>Store</span>
              <select value={storeId} onChange={(event) => setStoreId(event.target.value)}>
                {memberStores.map((store) => (
                  <option key={store._id || store.id} value={store._id || store.id}>
                    {store.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>

        {selected.size > 0 ? (
          <div className="bulkwrap">
            <div className="bulkbar">
              <strong>
                {selected.size} product{selected.size === 1 ? '' : 's'} selected
              </strong>

              <div className="button-row">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  aria-expanded={bulkOpen}
                  onClick={() => setBulkOpen((open) => !open)}
                >
                  {bulkOpen ? 'Close editor' : 'Bulk edit'}
                </button>

                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setSelected(new Set());
                    setBulkOpen(false);
                  }}
                >
                  Clear selection
                </button>
              </div>
            </div>

            {bulkOpen ? (
              <BulkEditPanel
                count={selected.size}
                onApply={runBulkEdit}
                onDelete={runBulkDelete}
                busy={bulkBusy}
              />
            ) : null}
          </div>
        ) : null}

        <table className="table products">
          <thead>
            <tr>
              <th className="products__check">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleAll}
                  aria-label="Select every product shown"
                />
              </th>
              <th>Product</th>
              <th>Status</th>
              <th>Inventory</th>
              <th>Category</th>
              <th>Type</th>
              <th>Vendor</th>
              <th>Price</th>
              <th />
            </tr>
          </thead>

          <tbody>
            {visibleProducts.map((product) => {
              const id = product._id || product.id;
              const out = isOutOfStock(product);

              return (
                <tr key={id}>
                  <td className="products__check">
                    <input
                      type="checkbox"
                      checked={selected.has(id)}
                      onChange={() => toggleRow(id)}
                      aria-label={`Select ${product.name}`}
                    />
                  </td>

                  {/* The whole product cell is the open button, and so is the
                      name, because a merchant scanning a table of photos is
                      looking for "the one with the bottle on it". A real
                      <button> keeps it reachable by keyboard. */}
                  <td>
                    <button
                      type="button"
                      className="table__product table__product--button"
                      onClick={() => openProduct(product)}
                    >
                      {product.image ? (
                        <img src={product.image} alt="" className="thumb" />
                      ) : (
                        <span className="thumb thumb--empty" aria-hidden="true">
                          🛍️
                        </span>
                      )}

                      <span className="table__product-text">
                        <strong>{product.name}</strong>
                        {product.hasVariants ? (
                          <span className="muted small block">
                            {product.variants.length} option
                            {product.variants.length === 1 ? '' : 's'}
                          </span>
                        ) : null}
                        {product.status !== PRODUCT_STATUS.ACTIVE ? (
                          <span className="muted small block">
                            Hidden from your storefront
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </td>

                  <td>
                    <span className={`badge ${statusTone(product)}`}>{statusLabel(product)}</span>
                  </td>

                  <td className={out ? 'is-danger' : undefined}>{inventoryLabel(product)}</td>

                  <td>{product.category || '—'}</td>
                  <td>{product.productType || '—'}</td>
                  <td>{product.vendor || '—'}</td>

                  {/* Reads the range across the matrix, or the product's own
                      price when it has none, so this never shows a seed value
                      that nobody pays. */}
                  <td>{formatProductPrice(product)}</td>

                  <td className="table__actions">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => openProduct(product)}
                    >
                      Edit
                    </button>

                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      onClick={() => handleDelete(product)}
                    >
                      Delete
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
              : statusFilter === PRODUCT_STATUS.ACTIVE
                ? 'No active products yet — add your first one.'
                : `No ${PRODUCT_STATUS_LABELS[statusFilter].toLowerCase()} products.`}
          </p>
        ) : null}
      </div>
    </div>
  );
}

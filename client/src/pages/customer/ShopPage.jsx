import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import ProductCard from '../../components/store/ProductCard';
import { useAuth } from '../../context/AuthContext';
import { useCart } from '../../context/CartContext';
import storeService from '../../services/storeService';
import { ROUTES } from '../../utils/constants';

/**
 * A store's public page: /s/<slug>
 *
 * Anyone with the link can browse this store's products - no account needed.
 * Signing in is only required once they try to check out.
 */
export default function ShopPage() {
  const { slug } = useParams();
  const { isAuthenticated } = useAuth();
  const { itemCount, openCart } = useCart();

  const [store, setStore] = useState(null);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  const loadStore = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const data = await storeService.getPublicStore(slug);
      setStore(data.store || null);
      setProducts(Array.isArray(data.products) ? data.products : []);
    } catch (err) {
      setError(err.message || 'Could not load that store.');
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    loadStore();
  }, [loadStore]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return products;

    return products.filter(
      (product) =>
        String(product.name || '').toLowerCase().includes(term) ||
        String(product.description || '').toLowerCase().includes(term),
    );
  }, [products, search]);

  if (loading) return <LoadingSpinner fullPage label="Loading the store…" />;

  if (error) {
    return (
      <div className="page">
        <p className="alert alert--danger">{error}</p>
        <div className="button-row">
          <button type="button" className="btn btn-outline" onClick={loadStore}>
            Try again
          </button>
          <Link className="btn btn-ghost" to={ROUTES.HOME}>
            Go home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="store-banner">
        <div>
          <h1>{store?.name}</h1>
          {store?.description ? <p className="muted">{store.description}</p> : null}
          <p className="store-banner__url">
            {store?.address?.city ? `${store.address.city} · ` : ''}
            Store page: <code>/s/{store?.slug}</code>
          </p>
        </div>

        <button type="button" className="btn btn-outline" onClick={openCart}>
          Cart {itemCount > 0 ? `(${itemCount})` : ''}
        </button>
      </div>

      <div className="filters">
        <input
          type="search"
          className="filters__search"
          placeholder="Search this store…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      {!isAuthenticated ? (
        <p className="alert alert--warn">
          Browsing freely — <Link to={ROUTES.LOGIN}>sign in</Link> when you are
          ready to order.
        </p>
      ) : null}

      {visible.length === 0 ? (
        <p className="empty">
          This store has not listed any products yet. Check back soon.
        </p>
      ) : (
        <div className="grid">
          {visible.map((product) => (
            <ProductCard key={product._id || product.id} product={product} />
          ))}
        </div>
      )}
    </div>
  );
}
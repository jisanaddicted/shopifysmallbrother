import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useLocation } from 'react-router-dom';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import ProductCard from '../../components/store/ProductCard';
import StoreNav from '../../components/storefront/StoreNav';
import { useAuth } from '../../context/AuthContext';
import { useCart } from '../../context/CartContext';
import storeService from '../../services/storeService';
import menuService from '../../services/menuService';
import { ROUTES } from '../../utils/constants';

/**
 * A store's public page: /s/<slug>
 *
 * Anyone with the link can browse this store's products - no account needed.
 * Signing in is only required once they try to check out.
 */
export default function ShopPage() {
    const { slug } = useParams();
  const location = useLocation();
  const { isAuthenticated } = useAuth();
  const { itemCount, openCart } = useCart();

  const [store, setStore] = useState(null);
  const [menu, setMenu] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
    const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');

  /* Derive unique categories from the store's products. */
  const categories = useMemo(() => {
    const seen = new Set();
    for (const p of products) {
      if (p.category && p.category.trim()) seen.add(p.category);
    }
    return ['all', ...seen];
  }, [products]);

  /* Read ?category= from the URL so nav links filter the catalogue. */
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const cat = params.get('category');
    if (cat && cat !== category) setCategory(cat);
  }, [location.search, category]);

  const loadStore = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const [data, menuData] = await Promise.all([
        storeService.getPublicStore(slug),
        /* The navbar is decorative — a menu failure must never blank the
           whole storefront. Fall back to an empty menu and keep the store. */
        menuService.getPublicStoreMenu(slug).catch(() => []),
      ]);
      setStore(data.store || null);
      setProducts(Array.isArray(data.products) ? data.products : []);
      setMenu(Array.isArray(menuData) ? menuData : []);
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

    return products.filter((product) => {
      const matchesCategory = category === 'all' || product.category === category;
      const matchesSearch =
        !term ||
        String(product.name || '').toLowerCase().includes(term) ||
        String(product.description || '').toLowerCase().includes(term);
      return matchesCategory && matchesSearch;
    });
  }, [products, search, category]);

  if (loading) return <LoadingSpinner fullPage label="Loading the store…" />;

  if (error) {
    return (
      <div className="page page--customer">
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
    <div className="page page--customer">
      {store ? <StoreNav menu={menu} /> : null}

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
        <select
          className="filters__select"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          {categories.map((c) => (
            <option key={c} value={c}>
              {c === 'all' ? 'All categories' : c}
            </option>
          ))}
        </select>

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
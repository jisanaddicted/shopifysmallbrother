import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useLocation } from 'react-router-dom';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import ProductCard from '../../components/store/ProductCard';
import StoreHeader from '../../components/storefront/StoreHeader';
import StoreNav from '../../components/storefront/StoreNav';
import MobileTabs from '../../components/storefront/MobileTabs';
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
  const { isAuthenticated, user } = useAuth();
  const { itemCount, openCart } = useCart();

  const [store, setStore] = useState(null);
  const [menu, setMenu] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
    const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [menuOpen, setMenuOpen] = useState(false);
  const searchRef = useRef(null);

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
      <StoreHeader store={store} itemCount={itemCount} user={user} onCartClick={openCart} />
      {store ? <StoreNav menu={menu} /> : null}

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
          ref={searchRef}
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

      {/* Mobile-only bottom tab bar: Home · Menu · Cart · Search · Account */}
      <MobileTabs
        store={store}
        itemCount={itemCount}
        user={user}
        menuOpen={menuOpen}
        onCartClick={openCart}
        onMenuClick={() => setMenuOpen((open) => !open)}
        onSearchClick={() => {
          searchRef.current?.focus();
          searchRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }}
      />
      {/* Mobile menu sheet: category list opened from the bottom MENU tab */}
      {menuOpen ? (
        <div className="menu-sheet" role="dialog" aria-label="Menu categories">
          <button
            type="button"
            className="menu-sheet__scrim"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
          />
          <div className="menu-sheet__panel">
            <div className="menu-sheet__head">
              <strong>Menu</strong>
              <button
                type="button"
                className="menu-sheet__close"
                onClick={() => setMenuOpen(false)}
                aria-label="Close menu"
              >
                ✕
              </button>
            </div>
            <ul className="menu-sheet__list">
              {categories.map((c) => (
                <li key={c}>
                  <button
                    type="button"
                    className={`menu-sheet__item${category === c ? ' is-active' : ''}`}
                    onClick={() => {
                      setCategory(c);
                      setMenuOpen(false);
                    }}
                  >
                    {c === 'all' ? 'All items' : c}
                    <span aria-hidden="true">→</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}
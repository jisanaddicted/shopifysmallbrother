import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useLocation } from 'react-router-dom';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import ProductCard from '../../components/store/ProductCard';
import StoreHeader from '../../components/storefront/StoreHeader';
import StoreNav from '../../components/storefront/StoreNav';
import StoreSearchBar from '../../components/storefront/StoreSearchBar';
import StoreMenuDrawer from '../../components/storefront/StoreMenuDrawer';
import MobileTabs from '../../components/storefront/MobileTabs';
import CustomerAccountSheet from '../../components/storefront/CustomerAccountSheet';
import { useAuth } from '../../context/AuthContext';
import { useCart } from '../../context/CartContext';
import storeService from '../../services/storeService';
import menuService from '../../services/menuService';
import { ROUTES, rememberStoreVisit } from '../../utils/constants';

/**
 * A store's public page: /s/<slug>
 *
 * Anyone with the link can browse this store's products - no account needed.
 * Signing in is only required once they try to check out.
 */
export default function ShopPage() {
    const { slug } = useParams();
  const location = useLocation();
  const { user } = useAuth();
  const { itemCount, openCart } = useCart();

  const [store, setStore] = useState(null);
  const [menu, setMenu] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
    const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  /* The store's own nav menu, as a side drawer. Opened from BOTH the header's
     three-line button and the bottom tab bar's MENU tab, so the two
     affordances always show the shopper the same thing. */
  const [navOpen, setNavOpen] = useState(false);
  /* The ACCOUNT tab's sheet: this shopper's own account, not the store's. */
  const [accountOpen, setAccountOpen] = useState(false);
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

  /*
   * The catalogue narrowed to the active category, BEFORE the search term.
   *
   * The search bar suggests from this rather than from the whole store. The
   * grid ANDs the two filters, so a suggestion drawn from the unfiltered list
   * could offer "Whole Milk" while the Drinks category is selected - and
   * tapping it would then show nothing at all. Suggesting only from what can
   * actually match keeps every suggestion a promise the grid will keep.
   */
  const inCategory = useMemo(
    () =>
      category === 'all'
        ? products
        : products.filter((product) => product.category === category),
    [products, category],
  );

  /* Remember which storefront this is: signing out later - even from
     /profile - brings the shopper back to THE store they were visiting. */
  useEffect(() => {
    rememberStoreVisit(slug);
  }, [slug]);

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
      <StoreHeader
        store={store}
        itemCount={itemCount}
        user={user}
        onCartClick={openCart}
        /* Only offer the menu button when the store actually has a menu, so we
           never open an empty drawer. */
        onMenuClick={menu.length ? () => setNavOpen(true) : undefined}
      />
      {store ? <StoreNav menu={menu} /> : null}

      {/*
        The prominent search. It sits directly under the store's own header and
        nav, above the category filter, because searching is the main way into
        a catalogue and filtering is the secondary one. The old <input> was
        sharing a flex row with the category <select> at equal weight, which
        made it read as one of two filters rather than as the store's front
        door.
      */}
      <StoreSearchBar
        products={inCategory}
        value={search}
        onChange={setSearch}
        inputRef={searchRef}
        resultCount={visible.length}
        placeholder={`Search ${store?.name || 'this store'}…`}
      />

      {/* The category filter kept its own row. The search took over the search
          input's job, so all that is left here is the one control it never
          did. */}
      <div className="filters">
        <select
          className="filters__select"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="Filter by category"
        >
          {categories.map((c) => (
            <option key={c} value={c}>
              {c === 'all' ? 'All categories' : c}
            </option>
          ))}
        </select>
      </div>

      {/*
        The "browse freely, sign in if you want history" notice used to sit
        here. It is gone on purpose: account access is now reached through the
        Navbar's user icon (and the store header's account button), so a
        paragraph of sign-in copy above the product grid was a second, louder
        place to say the same thing — and it pushed the actual products below
        the fold. A shopper who wants an account has a persistent control in
        the header; a shopper who does not never has to scroll past a
        paragraph about it.
      */}

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

      {/* The store's own menu, as a drawer from the left. Opened by the
          three-line button in the header; phones only. */}
      <StoreMenuDrawer
        menu={menu}
        open={navOpen}
        onClose={() => setNavOpen(false)}
      />

      {/* Mobile-only bottom tab bar: Home · Menu · Cart · Search · Account */}
      <MobileTabs
        store={store}
        itemCount={itemCount}
        user={user}
        menuOpen={navOpen}
        accountOpen={accountOpen}
        onCartClick={openCart}
        /* The bottom MENU tab opens the SAME store menu the header's three-line
           button does. It used to open a separate sheet listing product
           CATEGORIES, so two different panels on one screen were both called
           "Menu" and the tab never showed anything the merchant had actually
           built in the theme editor.

           Nothing is lost by dropping that sheet: the category filter is still
           right there in the .filters__select above, which does the same job on
           every screen size. */
        onMenuClick={() => {
          setAccountOpen(false);
          setNavOpen(true);
        }}
        onAccountClick={() => {
          setNavOpen(false);
          setAccountOpen(true);
        }}
        onSearchClick={() => {
          searchRef.current?.focus();
          searchRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }}
      />
      {/* Mobile account sheet: the shopper's own account details, or the
          Create account / Log in choice when they are browsing as a guest. */}
      <CustomerAccountSheet
        open={accountOpen}
        onClose={() => setAccountOpen(false)}
        store={store}
      />
    </div>
  );
}
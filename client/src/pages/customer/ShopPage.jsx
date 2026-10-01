import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useLocation } from 'react-router-dom';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import ProductCard from '../../components/store/ProductCard';
import StoreHeader from '../../components/storefront/StoreHeader';
import StoreNav from '../../components/storefront/StoreNav';
import StoreSearchBar from '../../components/storefront/StoreSearchBar';
import StoreMenuDrawer from '../../components/storefront/StoreMenuDrawer';
import CategoryRail from '../../components/storefront/CategoryRail';
import CategorySlider from '../../components/storefront/CategorySlider';
import CategoryTreeView from '../../components/storefront/CategoryTreeView';
import MobileTabs from '../../components/storefront/MobileTabs';
import CustomerAccountSheet from '../../components/storefront/CustomerAccountSheet';
import { useAuth } from '../../context/AuthContext';
import { useCart } from '../../context/CartContext';
import storeService from '../../services/storeService';
import menuService from '../../services/menuService';
import { categoryPath, ROUTES, rememberStoreVisit, THEME } from '../../utils/constants';

/**
 * Heading for products filed under no category.
 *
 * Only ever used as a display label - it is not a real category name, so it is
 * never written back to a product and never put in a `?category=` link, which
 * would filter on a string no product has. Held in one constant so the
 * storefront and the theme builder's confirmation copy can name the same
 * destination.
 */
const UNCATEGORISED = 'Other items';

/**
 * The section a product belongs to, by ONE rule used everywhere on this page.
 *
 * This exists because the naming was previously spelled out in three places and
 * the three copies drifted apart:
 *
 *   - the grouping that builds the sections folded a product with no category
 *     into "Other items",
 *   - the dropdown built its options from `product.category` alone, so it never
 *     listed "Other items" at all,
 *   - and the filter compared against the raw `product.category`.
 *
 * The visible result was a page showing two sections ("Other items", "milk")
 * behind a dropdown offering only "All categories" and "milk" - so the FIRST
 * section could not be selected, ever, and selecting anything looked like it
 * only ever applied to some of the page.
 *
 * One function, used by the dropdown, the filter and the grouping, means a
 * section's name and its filter option are the same string by construction.
 */
const sectionNameOf = (product) =>
  String(product?.category || '').trim() || UNCATEGORISED;

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

  /* The Theme 2 category tree, held HERE rather than fetched by each component
     that needs it.

     Two components want it - the drill-down itself and the side menu - and they
     must never disagree, or the shopper taps a branch in the drawer and the page
     below shows somewhere else. One fetch, one array, one source of truth. */
  const [tree, setTree] = useState([]);
  const [treeLoading, setTreeLoading] = useState(false);

  /* The filter's options, in the SAME names the sections use.

     Built from `sectionNameOf`, not from `product.category`, so every section on
     the page has an option that selects it. Listing only real categories meant
     the uncategorised section was unreachable from the filter. */
  const categories = useMemo(() => {
    const seen = new Set();
    for (const p of products) {
      seen.add(sectionNameOf(p));
    }
    return ['all', ...seen];
  }, [products]);

  /*
   * Category name -> picture, resolved once per store.
   *
   * The map on the store is keyed by the LOWERCASED name (see models/Store.js),
   * because category matching is case-insensitive everywhere else: a product
   * filed as "DRINKS" is the same section as one filed as "Drinks". So the
   * lookup is lowercased here too, and the section gets its picture even when
   * the spelling on the product differs from the spelling the merchant typed.
   *
   * Read defensively: this ships as a plain object, and an older store document
   * that predates the field has nothing there at all.
   */
  const imagesByCategory = useMemo(() => {
    const raw = store?.categoryImages;
    const out = new Map();
    if (!raw || typeof raw !== 'object') return out;

    for (const [key, value] of Object.entries(raw)) {
      const image = String(value || '').trim();
      if (image) out.set(key.toLowerCase(), image);
    }
    return out;
  }, [store]);

  /* Every category the store trades in, with its picture and product count -
     the data behind the slider. Built from ALL the store's products, not from
     `visible`, so the strip stays a stable navigation aid: a shopper searching
     for "cola" still sees the full set of categories to jump to rather than a
     strip that has collapsed to the one that happened to match. */
  const stripCategories = useMemo(() => {
    const groups = new Map();

    for (const product of products) {
      const name = sectionNameOf(product);
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(product);
    }

    return [...groups.entries()]
      .map(([name, items]) => ({
        name,
        count: items.length,
        image: imagesByCategory.get(name.toLowerCase()) || '',
      }))
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  }, [products, imagesByCategory]);

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
  /*
   * The search bar's suggestion source: the whole catalogue.
   *
   * It used to be narrowed to the active category, on the reasoning that a
   * suggestion the grid would then hide is a broken promise. That reasoning
   * assumed the category filter narrowed the whole page - which it deliberately
   * does not any more, since the dropdown now drives only the "Categories"
   * section. So offering every product is honest again: typing "milk" can suggest
   * milk, and it will still be on screen afterwards because nothing below was
   * filtered out.
   */
  const inCategory = products;

  /* Remember which storefront this is: signing out later - even from
     /profile - brings the shopper back to THE store they were visiting. */
  useEffect(() => {
    rememberStoreVisit(slug);
  }, [slug]);

  /* Which layout this store shows. Read off the store the page already loaded -
     `getPublicStore` returns the whole store document - so this costs nothing
     extra and cannot disagree with what the Theme tab set.

     The `!store` guard matters for the same reason the theme's own default does:
     a store fetched before this feature existed has no `theme` at all, and must
     render the layout it always rendered rather than a blank tree. */
  const isTreeTheme = Boolean(store) && store.theme === THEME.TWO;

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

      /* The tree comes back INSIDE the store response for a Theme 2 store, so
         there is no third request to make.

         It used to be fetched separately, after this one resolved - the client
         cannot know whether it wants a tree until it knows the theme, and the
         theme is in this response. That cost a shopper a whole extra round trip
         to a database where one takes a second or more, and a second visible
         loading state: the header would paint, then the categories would fill in
         a moment later. Now the page arrives in one piece.

         Theme 1 stores send no `tree` at all, and are not asked for one - making
         a store that will never show categories wait on them would slow down
         every shop not using this feature. */
      if (data.store?.theme === THEME.TWO) {
        setTree(Array.isArray(data.tree) ? data.tree : []);
        setTreeLoading(false);
      } else {
        setTree([]);
        setTreeLoading(false);
      }
    } catch (err) {
      setError(err.message || 'Could not load that store.');
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    loadStore();
  }, [loadStore]);

  /*
   * Everything the store has, narrowed by the SEARCH term and nothing else.
   *
   * The category dropdown deliberately does NOT feed into this list. It used to,
   * and that is the behaviour that made the filter read as broken: choosing a
   * category collapsed every section on the page into one, so a shopper could
   * not tell whether the filter was choosing a category or replacing the whole
   * page with one. Now the dropdown drives ONLY the "Categories" section above,
   * and the per-category sections below stay exactly as they are.
   *
   * Search still applies, because narrowing the sections to what was searched
   * for is what a shopper expects from a search box.
   */
  const searchMatched = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return products;

    return products.filter(
      (product) =>
        String(product.name || '').toLowerCase().includes(term) ||
        String(product.description || '').toLowerCase().includes(term),
    );
  }, [products, search]);

  /* What the "Categories" section lists: the dropdown's choice, or everything.

     This is the ONE place the dropdown is applied. Selecting "milk" puts milk's
     products in that section and leaves every other section on the page alone. */
  const selectedProducts = useMemo(
    () =>
      category === 'all'
        ? searchMatched
        : searchMatched.filter((product) => sectionNameOf(product) === category),
    [searchMatched, category],
  );

  /*
   * The catalogue grouped into one section per category — "Drinks", then
   * "Pizza", each a horizontal rail of its own products.
   *
   * Built from `searchMatched`, so it inherits the search term but NOT the
   * category dropdown. A shopper who searches "cola" gets one "Drinks" rail
   * holding the three that matched, rather than every section reappearing with
   * the other nine drinks hidden inside it — while choosing a category in the
   * dropdown leaves this list untouched.
   *
   * The uncategorised bucket is the reason this is a fold rather than just
   * `product.category`. A product with no category used to appear in the plain
   * grid with nothing above it; with section headings everywhere else on the
   * page it would have nowhere to live, so those products are gathered into one
   * clearly-labelled section instead of quietly disappearing on a phone.
   */
  const sections = useMemo(() => {
    const groups = new Map();

    for (const product of searchMatched) {
      // The SAME rule the dropdown options use, so a section's heading and its
      // filter option are one string and every section is selectable.
      const name = sectionNameOf(product);
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(product);
    }

    return [...groups.entries()].map(([name, items]) => ({ name, items }));
  }, [searchMatched]);

  /* The category <select>, built once.

     One element, rendered in one of two places: inside the first section's
     heading when there are sections to host it, or in a plain filter row when
     there are none. Keeping it as a single value rather than duplicating the
     markup means the two placements can never disagree about what the options
     are or what the control is called. */
  const categoryFilter = (
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
  );

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
        resultCount={searchMatched.length}
        placeholder={`Search ${store?.name || 'this store'}…`}
        /* So tapping a product suggestion opens that product, rather than only
           narrowing whatever is on screen - which on Theme 2 is one node's
           shelf, and so often nothing at all. */
        slug={slug}
      />

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

      {/*
        The category card slider. Deliberately OUTSIDE `.store-sections` and
        with no media query of its own, so it renders at every screen size.

        It used to live inside each per-category rail, which reads as tidier -
        one card per section, no separate strip. That was wrong twice over: the
        `.store-sections` block is hidden above 640px, so on any desktop the
        cards vanished entirely; and even on a phone it made a shopper swipe
        sideways to find out what categories the shop had. A single strip at the
        top answers "what is here?" in one glance, and stays put as a way back
        when a section is filtered down to a single category.
      */}
      {/*
        THEME 2 - the category tree.

        A whole different layout, branched on the store's own `theme`, rather
        than a flag threaded through the Theme 1 sections below. Two layouts
        that share half their markup are two layouts that end up agreeing about
        nothing, and every Theme 1 behaviour on this page - the strip, the
        dropdown, the per-category rails - is specific to that theme and has no
        meaning here.

        Rendered INSTEAD of everything below, not above it, so a Theme 2 store
        never briefly paints the Theme 1 layout on the way to the tree. */}
      {isTreeTheme ? (
        <CategoryTreeView
          nodes={tree}
          loading={treeLoading}
          error=""
          products={products}
          searchTerm={search}
          onClearSearch={() => setSearch('')}
        />
      ) : null}

      {!isTreeTheme ? (
        <>
      <CategorySlider
        categories={stripCategories}
        activeCategory={category}
        /* Each card links to that category's own page rather than filtering the
           storefront in place. A category is somewhere a shopper can BE, not a
           toggle they flip - so it gets a URL, survives a refresh, can be
           shared, and leaves Back pointing at the storefront. */
        linkFor={(name) => categoryPath(slug, name)}
        /* The <select>, on THIS section's heading.

           This is the section that lists the categories as cards, so it is where
           the control that filters BY them belongs. It used to sit in a band of
           its own above the catalogue: two routes to the same categories, side by
           side, with nothing connecting them - and a shopper filtering to "milk"
           had to work out which of the two things they had just used was the
           filter.

           The strip renders whenever the store has any product at all (it is built
           from every product, not from the filtered list), so the dropdown is
           reachable in exactly the states where there is something to filter. That
           is why no separate fallback copy is needed: if the strip is not on
           screen, the store has no products, and there is nothing to filter. */
        filterControl={categoryFilter}
        /* The chosen category's PRODUCTS, shown in this section.

           This is the whole point of the dropdown: pick a category and its
           products appear here, in one place to browse, while every per-category
           section below stays exactly as it was. */
        products={selectedProducts}
        selectedLabel={category === 'all' ? 'All products' : category}
      />

      {searchMatched.length === 0 ? (
        <p className="empty">
          This store has not listed any products yet. Check back soon.
        </p>
      ) : (
        /* One section per category, each a horizontally scrolling rail of that
           category's product cards — the layout a phone shopper actually wants,
           and the whole reason the theme builder has a category panel.

           On a desktop the plain grid below takes over instead, via CSS: at
           that width a shopper can see a whole screen of products at once and
           has no reason to swipe, so forcing them into rails would only add a
           scroll gesture to reach the next item. Both are rendered and the
           stylesheet decides which one is visible — that keeps the section
           list in the DOM for search engines and for a screen reader
           navigating by heading, instead of being a phone-only afterthought. */
        <div className="store-sections">
          {sections.map((section) => (
            <CategoryRail
              key={section.name}
              name={section.name}
              products={section.items}
              showAllLabel={
                section.items.length > 1
                  ? `${section.items.length} items`
                  : null
              }
            />
          ))}
        </div>
      )}

      {/* The grid is the desktop view of the very same `searchMatched` list the
          sections are built from. Kept as its own element rather than swapped in
          JS on a media query, so there is exactly one source of truth for "which
          products are showing" - and so the desktop grid can never disagree with
          the phone rails about what the category dropdown did, which is nothing. */}
      {searchMatched.length > 0 ? (
        <div className="grid store-sections__grid">
          {searchMatched.map((product) => (
            <ProductCard key={product._id || product.id} product={product} />
          ))}
        </div>
      ) : null}
        </>
      ) : null}

      {/* The store's own menu, as a drawer from the left. Opened by the
          three-line button in the header; phones only.

          On Theme 2 the drawer leads with the CATEGORY TREE, because on that
          theme the categories are the navigation - the merchant's menu is a
          Theme 1 idea, and its items were built from the Theme 1 category list,
          so leading with it would show a second, stale set of the same
          categories. */}
      <StoreMenuDrawer
        menu={menu}
        tree={isTreeTheme ? tree : []}
        isTreeTheme={isTreeTheme}
        treeLoading={treeLoading}
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
           there, in the first category section's heading, which does the same job
           on every screen size. */
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
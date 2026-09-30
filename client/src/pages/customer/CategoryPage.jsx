import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import ProductCard from '../../components/store/ProductCard';
import StoreHeader from '../../components/storefront/StoreHeader';
import StoreSearchBar from '../../components/storefront/StoreSearchBar';
import CategorySlider from '../../components/storefront/CategorySlider';
import { useAuth } from '../../context/AuthContext';
import { useCart } from '../../context/CartContext';
import storeService from '../../services/storeService';
import { categoryPath, rememberStoreVisit, shopPath } from '../../utils/constants';
import { initials } from '../../utils/formatters';

/**
 * One category of a store: /s/<slug>/c/<category>
 *
 * Opened by tapping a card in the category slider. It is a real PAGE and not a
 * filter state on the storefront, for the reason the route is a path and not a
 * query string - see categoryPath() in utils/constants.js. The short version:
 * Back from here should return to the store rather than leave it, and the URL
 * should be shareable.
 *
 * It reuses the storefront's own header, search, slider and product card rather
 * than inventing a second look for the same shop. What differs is only the shape
 * of the content: a back link, a titled header, and the products in this one
 * category.
 */
export default function CategoryPage() {
  const { slug, category: rawCategory } = useParams();
  const { user } = useAuth();
  const { itemCount, openCart } = useCart();

  const [store, setStore] = useState(null);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  /* React Router hands back the path segment ALREADY percent-decoded, so a
     category called "Hot & Cold" arrives as `Hot & Cold` and not encoded. That
     is what lets the comparison below against `product.category` be a plain
     string match, with no decoding step to get wrong.

     Decoded defensively anyway: a hand-typed or older link can reach here with
     a still-encoded value, and `decodeURIComponent` on a plain name is a no-op
     except for a stray '%', which is why the try/catch is there rather than a
     bare call that would throw and blank the page. */
  const category = (() => {
    try {
      return decodeURIComponent(rawCategory || '');
    } catch {
      return rawCategory || '';
    }
  })();

  const load = useCallback(async () => {
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
    load();
  }, [load]);

  /* Same as the storefront: signing out later should return the shopper to THIS
     store, not whichever one they happened to visit first. */
  useEffect(() => {
    rememberStoreVisit(slug);
  }, [slug]);

  /* A different category is a different set of results - an old search term
     would show an empty screen with no obvious cause. */
  useEffect(() => {
    setSearch('');
  }, [category]);

  /* The store's categories, for the slider. Built here the same way the
     storefront builds it, so the two screens look identical to a shopper and
     there is one place that decides how a category is presented.

     `store.categoryImages` is keyed by the LOWERCASED category name, so the
     lookup is lowercased too - that is what lets a product filed as "DRINKS"
     still show the picture uploaded for "Drinks". */
  const allCategories = useMemo(() => {
    const images = store?.categoryImages || {};
    const groups = new Map();

    for (const product of products) {
      const name = String(product.category || '').trim() || 'Other items';
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(product);
    }

    return [...groups.entries()]
      .map(([name, items]) => ({
        name,
        count: items.length,
        image: String(images[name.toLowerCase()] || ''),
      }))
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  }, [products, store]);

  /* This category's products, then the search term applied on top.
     Case-insensitive, so a shopper who types "cola" into a category called
     "Cola & Tonics" is not quietly shown nothing. */
  const visible = useMemo(() => {
    const inCategory = products.filter(
      (product) => String(product.category || '').trim() === category,
    );

    const term = search.trim().toLowerCase();
    if (!term) return inCategory;

    return inCategory.filter(
      (product) =>
        String(product.name || '').toLowerCase().includes(term) ||
        String(product.description || '').toLowerCase().includes(term),
    );
  }, [products, category, search]);

  /* The picture for THIS category, for the title block. */
  const categoryImage = String(store?.categoryImages?.[category.toLowerCase()] || '');

  if (loading) return <LoadingSpinner fullPage label="Loading the category…" />;

  if (error) {
    return (
      <div className="page page--customer">
        <p className="alert alert--danger">{error}</p>
        <div className="button-row">
          <button type="button" className="btn btn-outline" onClick={load}>
            Try again
          </button>
          <Link className="btn btn-ghost" to={shopPath(slug)}>
            Back to the store
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
      />

      {/* The same slider, so the shopper can cross to another category without
          going back to the store first. `linkFor` makes each card a real link
          to that category's page: every step through the categories becomes a
          history entry, which is what makes Back behave. */}
      <CategorySlider
        categories={allCategories}
        activeCategory={category}
        linkFor={(name) => categoryPath(slug, name)}
      />

      <div className="catpage">
        <Link className="catpage__back" to={shopPath(slug)}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path
              d="M15 5l-7 7 7 7"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          All products
        </Link>

        <header className="catpage__head">
          {categoryImage ? (
            <img className="catpage__image" src={categoryImage} alt="" />
          ) : (
            /* No picture: initials, the same fallback the category card and the
               store logo use, so the title block never looks broken. */
            <span className="catpage__initials" aria-hidden="true">
              {initials(category)}
            </span>
          )}

          <div className="catpage__heading">
            <h1 className="catpage__title">{category}</h1>
            <p className="muted small">
              {visible.length} {visible.length === 1 ? 'product' : 'products'}
              {search.trim() ? ' matching your search' : ''}
            </p>
          </div>
        </header>

        <StoreSearchBar
          products={visible}
          value={search}
          onChange={setSearch}
          resultCount={visible.length}
          placeholder={`Search ${category}…`}
        />

        {visible.length === 0 ? (
          <p className="empty">
            {search.trim()
              ? `Nothing in ${category} matches "${search.trim()}".`
              : `This store has no products in ${category} yet.`}
          </p>
        ) : (
          <div className="grid">
            {visible.map((product) => (
              <ProductCard key={product._id || product.id} product={product} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


import { useEffect, useMemo, useState } from 'react';
import ProductCard from '../../components/store/ProductCard';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import { useCart } from '../../context/CartContext';
import productService from '../../services/productService';

export default function Storefront() {
  const { itemCount, openCart } = useCart();

  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');

  const loadProducts = async () => {
    setLoading(true);
    setError('');

    try {
      const list = await productService.getProducts();
      setProducts(Array.isArray(list) ? list : []);
    } catch (err) {
      setError(err.message || 'Could not load the catalogue.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProducts();
  }, []);

  // Unique categories, built from whatever the API returned.
  const categories = useMemo(() => {
    const unique = products
      .map((product) => product.category)
      .filter(Boolean);
    return ['all', ...new Set(unique)];
  }, [products]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();

    return products.filter((product) => {
      const matchesCategory =
        category === 'all' || product.category === category;
      const matchesSearch =
        !term ||
        String(product.name || '')
          .toLowerCase()
          .includes(term) ||
        String(product.description || '')
          .toLowerCase()
          .includes(term);

      return matchesCategory && matchesSearch;
    });
  }, [products, search, category]);

  return (
    <div className="page page--customer">
      <header className="page__header">
        <div>
          <h1>Store</h1>
          <p className="muted">
            Fresh picks delivered by a rider near you.
          </p>
        </div>

        <button type="button" className="btn btn-outline" onClick={openCart}>
          Cart {itemCount > 0 ? `(${itemCount})` : ''}
        </button>
      </header>

      <div className="filters">
        <input
          type="search"
          className="filters__search"
          placeholder="Search products…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />

        <select
          className="filters__select"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
        >
          {categories.map((option) => (
            <option key={option} value={option}>
              {option === 'all' ? 'All categories' : option}
            </option>
          ))}
        </select>
      </div>

      {loading ? <LoadingSpinner label="Loading products…" /> : null}

      {error ? (
        <div className="alert alert--danger">
          <p>{error}</p>
          <button type="button" className="btn btn-outline btn-sm" onClick={loadProducts}>
            Try again
          </button>
        </div>
      ) : null}

      {!loading && !error && visible.length === 0 ? (
        <p className="empty">
          No products match your search. Add items from the admin panel, then
          refresh.
        </p>
      ) : null}

      <div className="grid">
        {visible.map((product) => (
          <ProductCard key={product._id || product.id} product={product} />
        ))}
      </div>
    </div>
  );
}
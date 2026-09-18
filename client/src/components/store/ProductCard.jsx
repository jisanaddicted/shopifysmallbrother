import { useCart } from '../../context/CartContext';
import { formatCurrency, truncate } from '../../utils/formatters';

export default function ProductCard({ product }) {
  const { addItem } = useCart();

  const stock = product?.stock ?? product?.quantity ?? null;
  const outOfStock = stock !== null && Number(stock) <= 0;

  return (
    <article className="product-card">
      <div className="product-card__media">
        {product?.image ? (
          <img src={product.image} alt={product.name} loading="lazy" />
        ) : (
          <span className="product-card__placeholder" aria-hidden="true">
            🛍️
          </span>
        )}

        {outOfStock && <span className="chip chip--danger">Out of stock</span>}
      </div>

      <div className="product-card__body">
        {product?.category ? (
          <span className="chip">{product.category}</span>
        ) : null}

        <h3 className="product-card__title">{product?.name}</h3>
        <p className="product-card__desc">
          {truncate(product?.description || 'No description yet.', 70)}
        </p>

        <div className="product-card__footer">
          <strong className="price">{formatCurrency(product?.price)}</strong>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={outOfStock}
            onClick={() => addItem(product, 1)}
          >
            {outOfStock ? 'Unavailable' : 'Add to cart'}
          </button>
        </div>
      </div>
    </article>
  );
}

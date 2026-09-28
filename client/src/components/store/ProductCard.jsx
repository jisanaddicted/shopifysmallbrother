import { useEffect, useRef, useState } from 'react';
import { useCart } from '../../context/CartContext';
import { formatCurrency, truncate } from '../../utils/formatters';

export default function ProductCard({ product }) {
  const { addItem } = useCart();

  const stock = product?.stock ?? product?.quantity ?? null;
  const outOfStock = stock !== null && Number(stock) <= 0;

  // "Added ✓" on the button itself.
  //
  // Adding to the cart no longer pops the drawer open (that made tapping
  // "Add" on a grid unusable - the panel covered the next product), so the
  // button is where the confirmation has to happen. It is a swap of the button's
  // own label rather than a toast, so it can never cover the thing the shopper
  // was looking at.
  const [justAdded, setJustAdded] = useState(false);
  const timer = useRef(null);

  // Clear a pending timer if the card unmounts, so a fast navigation cannot
  // leave it firing into a dead component.
  useEffect(() => () => clearTimeout(timer.current), []);

  const handleAdd = () => {
    addItem(product, 1);

    setJustAdded(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setJustAdded(false), 1400);
  };

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
            className={`btn btn-primary btn-sm${justAdded ? ' is-added' : ''}`}
            disabled={outOfStock}
            onClick={handleAdd}
          >
            {outOfStock ? 'Unavailable' : justAdded ? 'Added ✓' : 'Add to cart'}
          </button>
        </div>
      </div>
    </article>
  );
}

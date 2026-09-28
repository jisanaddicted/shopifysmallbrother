import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  DELIVERY_FEE,
  FREE_DELIVERY_OVER,
  STORAGE_KEYS,
} from '../utils/constants';

const CartContext = createContext(null);

/**
 * A cart line is keyed by _id (Mongo) or id (SQL/other backends).
 *
 * For a product with variants this is the VARIANT's id, not the product's - two
 * sizes of the same shirt are two different things to buy and must be two
 * separate lines that can have separate quantities. A product with no variants
 * keeps using its own id, which is what every existing saved cart contains.
 */
const idOf = (product) => product?._id || product?.id || product?.productId;

/**
 * The cart key for a line.
 *
 * A variant product keys on the variant; anything else keys on the product. The
 * variant is detected off the item itself (`variantId` set by the product card,
 * which already knows which row was picked) rather than by re-reading the
 * product, so a line restored from `localStorage` behaves identically to a fresh
 * one.
 */
const lineKey = (product) => product?.variantId || idOf(product);

function readStoredCart() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CART);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function CartProvider({ children }) {
  const [items, setItems] = useState(readStoredCart);
  const [isOpen, setIsOpen] = useState(false);

  // The cart survives a page refresh.
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.CART, JSON.stringify(items));
  }, [items]);

  const addItem = useCallback((product, quantity = 1) => {
    const key = lineKey(product);
    if (!key) return;

    setItems((prev) => {
      const already = prev.find((line) => line._id === key);

      if (already) {
        return prev.map((line) =>
          line._id === key
            ? { ...line, quantity: line.quantity + quantity }
            : line,
        );
      }

      return [
        ...prev,
        {
          _id: key,
          name: product.name,
          price: Number(product.price) || 0,
          image: product.image || '',
          quantity,
          // Carried so the cart can render "L / Blue" and the server knows which
          // row to price. Both are optional: a product with no variants sends
          // neither, and the server falls back to the product's own price.
          ...(product.variantId
            ? {
                productId: idOf(product),
                variantId: product.variantId,
                variantTitle: product.variantTitle || '',
              }
            : {}),
        },
      ];
    });

    // Deliberately does NOT open the drawer.
    //
    // It used to, and that was wrong: a shopper browsing a grid is tapping "Add"
    // on item after item, and having a panel slide over the catalogue on every
    // single tap meant the next tap landed on the drawer instead of the product
    // they were looking at. Adding to a basket is not a request to review it -
    // the Cart button in the navbar, the store header and the storefront all
    // open it on purpose, and the item count is visible in each of them.
    //
    // Feedback is the button's job instead: ProductCard flashes "Added ✓" on
    // itself, which confirms the tap without covering the page.
  }, []);

  const removeItem = useCallback((id) => {
    setItems((prev) => prev.filter((line) => line._id !== id));
  }, []);

  const setQuantity = useCallback((id, quantity) => {
    const qty = Number(quantity);
    setItems((prev) =>
      qty <= 0
        ? prev.filter((line) => line._id !== id)
        : prev.map((line) =>
            line._id === id ? { ...line, quantity: qty } : line,
          ),
    );
  }, []);

  const increment = useCallback((id) => {
    setItems((prev) =>
      prev.map((line) =>
        line._id === id ? { ...line, quantity: line.quantity + 1 } : line,
      ),
    );
  }, []);

  const decrement = useCallback((id) => {
    setItems((prev) =>
      prev.flatMap((line) => {
        if (line._id !== id) return [line];
        // Dropping to zero removes the line.
        return line.quantity - 1 <= 0
          ? []
          : [{ ...line, quantity: line.quantity - 1 }];
      }),
    );
  }, []);

  const clearCart = useCallback(() => {
    setItems([]);
    setIsOpen(false);
  }, []);

  const openCart = useCallback(() => setIsOpen(true), []);
  const closeCart = useCallback(() => setIsOpen(false), []);
  const toggleCart = useCallback(() => setIsOpen((open) => !open), []);

  const totals = useMemo(() => {
    const subtotal = items.reduce(
      (sum, line) => sum + line.price * line.quantity,
      0,
    );
    const deliveryFee =
      items.length === 0 || subtotal >= FREE_DELIVERY_OVER ? 0 : DELIVERY_FEE;

    return { subtotal, deliveryFee, total: subtotal + deliveryFee };
  }, [items]);

  const itemCount = useMemo(
    () => items.reduce((count, line) => count + line.quantity, 0),
    [items],
  );

  const value = useMemo(
    () => ({
      items,
      isOpen,
      itemCount,
      ...totals,
      addItem,
      removeItem,
      setQuantity,
      increment,
      decrement,
      clearCart,
      openCart,
      closeCart,
      toggleCart,
    }),
    [
      items,
      isOpen,
      itemCount,
      totals,
      addItem,
      removeItem,
      setQuantity,
      increment,
      decrement,
      clearCart,
      openCart,
      closeCart,
      toggleCart,
    ],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error('useCart must be used inside <CartProvider>');
  }
  return context;
}

export default CartContext;
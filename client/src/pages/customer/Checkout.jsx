import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AddressPickerMap from '../../components/maps/AddressPickerMap';
import OrderSummary from '../../components/store/OrderSummary';
import { useCart } from '../../context/CartContext';
import orderService from '../../services/orderService';
import { ROUTES, STORAGE_KEYS, orderTrackerPath } from '../../utils/constants';

const EMPTY_ADDRESS = {
  label: 'Home',
  line1: '',
  city: '',
  phone: '',
  notes: '',
};

function readStoredAddress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.ADDRESS);
    return raw ? { ...EMPTY_ADDRESS, ...JSON.parse(raw) } : EMPTY_ADDRESS;
  } catch {
    return EMPTY_ADDRESS;
  }
}

export default function Checkout() {
  const navigate = useNavigate();
  const { items, clearCart } = useCart();

  const [address, setAddress] = useState(readStoredAddress);
  const [point, setPoint] = useState(null);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState('');

  // Remember the address for next time.
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.ADDRESS, JSON.stringify(address));
  }, [address]);

  const handleChange = (event) =>
    setAddress((prev) => ({ ...prev, [event.target.name]: event.target.value }));

  const handlePlaceOrder = async () => {
    setError('');

    if (items.length === 0) {
      setError('Your cart is empty.');
      return;
    }
    if (!address.line1.trim() || !address.phone.trim()) {
      setError('Please add a street address and a phone number.');
      return;
    }
    if (!point?.lat && !(address.lat && address.lng)) {
      setError('Please drop the pin on the map so the rider can find you.');
      return;
    }

    const dropOff = point || { lat: address.lat, lng: address.lng };

    setPlacing(true);

    try {
      const order = await orderService.createOrder({
        items: items.map((line) => ({
          productId: line._id,
          name: line.name,
          price: line.price,
          quantity: line.quantity,
        })),
        address: {
          label: address.label,
          line1: address.line1,
          city: address.city,
          phone: address.phone,
          notes: address.notes,
        },
        location: { lat: dropOff.lat, lng: dropOff.lng },
        paymentMethod: 'cod',
      });

      const orderId = order?._id || order?.id;
      clearCart();

      if (orderId) {
        navigate(orderTrackerPath(orderId), { replace: true });
      } else {
        navigate(ROUTES.STORE, { replace: true });
      }
    } catch (err) {
      setError(err.message || 'Could not place your order.');
    } finally {
      setPlacing(false);
    }
  };

  if (items.length === 0) {
    return (
      <div className="page page--customer">
        <div className="card empty">
          <h1>Your cart is empty</h1>
          <p className="muted">Add a few products and come back here.</p>
          <Link className="btn btn-primary" to={ROUTES.STORE}>
            Browse the store
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page page--customer">
      <header className="page__header">
        <h1>Checkout</h1>
        <Link className="link-btn" to={ROUTES.STORE}>
          ← Keep shopping
        </Link>
      </header>

      {error ? <p className="alert alert--danger">{error}</p> : null}

      <div className="checkout">
        <section className="panel">
          <h2 className="panel__title">Delivery details</h2>

          <div className="field-row">
            <label className="field">
              <span>Label</span>
              <input
                type="text"
                name="label"
                value={address.label}
                onChange={handleChange}
                placeholder="Home / Office"
              />
            </label>

            <label className="field">
              <span>Phone</span>
              <input
                type="tel"
                name="phone"
                value={address.phone}
                onChange={handleChange}
                placeholder="+1 555 010 2030"
                required
              />
            </label>
          </div>

          <label className="field">
            <span>Street address</span>
            <input
              type="text"
              name="line1"
              value={address.line1}
              onChange={handleChange}
              placeholder="221B Baker Street, Apt 4"
              required
            />
          </label>

          <label className="field">
            <span>City</span>
            <input
              type="text"
              name="city"
              value={address.city}
              onChange={handleChange}
              placeholder="Kathmandu"
            />
          </label>

          <label className="field">
            <span>Notes for the rider (optional)</span>
            <textarea
              name="notes"
              rows={2}
              value={address.notes}
              onChange={handleChange}
              placeholder="Gate code, landmark, floor…"
            />
          </label>

          <h3 className="panel__subtitle">Pin the drop-off point</h3>
          <AddressPickerMap value={point} onChange={setPoint} />
        </section>

        <OrderSummary
          address={address}
          onPlaceOrder={handlePlaceOrder}
          placing={placing}
          ctaLabel="Place order"
        >
          <p className="muted small">
            Payment is collected in cash on delivery.
          </p>
        </OrderSummary>
      </div>
    </div>
  );
}
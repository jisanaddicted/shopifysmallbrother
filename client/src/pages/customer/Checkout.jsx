import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import AddressPickerMap from '../../components/maps/AddressPickerMap';
import OrderSummary from '../../components/store/OrderSummary';
import { useAuth } from '../../context/AuthContext';
import { useCart } from '../../context/CartContext';
import orderService from '../../services/orderService';
import paymentService from '../../services/paymentService';
import { getPublicStore } from '../../services/storeService';
import { initials } from '../../utils/formatters';
import {
  PAYMENT_METHOD_HINTS,
  PAYMENT_METHODS,
  ROUTES,
  STORAGE_KEYS,
  checkoutPath,
  customerPath,
  lastStoreVisit,
  orderTrackerPath,
  rememberStoreVisit,
  saveGuestToken,
  shopPath,
} from '../../utils/constants';

const EMPTY_ADDRESS = {
  label: 'Home',
  line1: '',
  city: '',
  phone: '',
  notes: '',
};

const EMPTY_GUEST = { name: '', email: '' };

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
  const { slug: routeSlug } = useParams();
  const { isAuthenticated } = useAuth();
  const { items, clearCart } = useCart();

  // The store this checkout belongs to: the slug in the URL when the shopper
  // came through /s/<slug>/checkout, else the last storefront visited (so the
  // bare /checkout can bounce there and brand itself with THAT store).
  const storeSlug = routeSlug || lastStoreVisit() || '';
  const shopTarget = storeSlug ? shopPath(storeSlug) : ROUTES.STORE;
  const loginTarget = storeSlug ? customerPath(storeSlug, 'login') : ROUTES.LOGIN;

  const [address, setAddress] = useState(readStoredAddress);
  // Guests have no account, so checkout asks for a name (+ optional email)
  // instead of forcing a signup.
  const [guest, setGuest] = useState(EMPTY_GUEST);
  const [point, setPoint] = useState(null);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState('');
  // Which route the shopper wants to pay by. Cash on delivery is the default
  // because it is the one that always works - no gateway credentials, no card,
  // no redirect, and it is what this checkout has always done.
  const [paymentMethod, setPaymentMethod] = useState(PAYMENT_METHODS.COD);
  // The visiting store's logo + name for the header (no generic default).
  const [store, setStore] = useState(null);
  const [logoBroken, setLogoBroken] = useState(false);

  // Remember the address for next time.
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.ADDRESS, JSON.stringify(address));
  }, [address]);

  // Checkout is a page OF this store: record the slug (like ShopPage does)
  // and fetch the store so the header can show its real logo + name instead
  // of a generic brand.
  useEffect(() => {
    rememberStoreVisit(storeSlug);
    if (!storeSlug) {
      setStore(null);
      return undefined;
    }
    let cancelled = false;
    setStore(null);
    setLogoBroken(false);

    getPublicStore(storeSlug)
      .then((data) => {
        if (!cancelled) setStore(data?.store || data || null);
      })
      .catch(() => {
        // A stale slug must not break checkout - the URL still carries the
        // store and the order API validates the products themselves.
        if (!cancelled) setStore(null);
      });

    return () => {
      cancelled = true;
    };
  }, [storeSlug]);

  const handleChange = (event) =>
    setAddress((prev) => ({ ...prev, [event.target.name]: event.target.value }));

  const handleGuestChange = (event) =>
    setGuest((prev) => ({ ...prev, [event.target.name]: event.target.value }));

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
    if (!isAuthenticated && !guest.name.trim()) {
      setError('Please tell us your name so the rider knows who to ask for.');
      return;
    }
    if (!point?.lat && !(address.lat && address.lng)) {
      setError('Please drop the pin on the map so the rider can find you.');
      return;
    }

    const dropOff = point || { lat: address.lat, lng: address.lng };

    setPlacing(true);

    try {
      const { order, guestToken } = await orderService.createOrder({
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
        paymentMethod,
        // Signed-in buyers order as themselves; guests attach a contact.
        ...(!isAuthenticated
          ? { guest: { name: guest.name.trim(), email: guest.email.trim() } }
          : {}),
      });

      const orderId = order?._id || order?.id;
      if (guestToken && orderId) saveGuestToken(orderId, guestToken);

      if (!orderId) {
        clearCart();
        navigate(shopTarget, { replace: true });
        return;
      }

      // Cash on delivery: the order is the end of it, go track it.
      if (paymentMethod === PAYMENT_METHODS.COD) {
        clearCart();
        navigate(orderTrackerPath(orderId), { replace: true });
        return;
      }

      // Pay online. The basket is deliberately NOT cleared yet: if the gateway
      // refuses to start, the shopper must come back to a cart that is still
      // full rather than an empty one and a "your cart is empty" page.
      const { url } = await paymentService.initPayment(orderId);
      if (!url) {
        throw new Error('The payment gateway did not return a payment page.');
      }

      // A full navigation, not a router push: this leaves the SPA entirely for
      // the gateway's own page, and the gateway brings the shopper back to
      // /payment-success or /payment-failed afterwards.
      clearCart();
      window.location.assign(url);
    } catch (err) {
      setError(err.message || 'Could not place your order.');
    } finally {
      setPlacing(false);
    }
  };

  // Old bare /checkout links bounce to the store's own checkout URL when we
  // know which store that is (same pattern as bare /profile -> /s/<slug>/profile).
  if (!routeSlug && storeSlug) {
    return <Navigate to={checkoutPath(storeSlug)} replace />;
  }

  if (items.length === 0) {
    return (
      <div className="page page--customer">
        <div className="card empty">
          <h1>Your cart is empty</h1>
          <p className="muted">Add a few products and come back here.</p>
          <Link className="btn btn-primary" to={shopTarget}>
            Browse the store
          </Link>
        </div>
      </div>
    );
  }

  const storeName = store?.name || '';
  const storeLogo = !logoBroken
    ? store?.logo || store?.logoUrl || store?.image || ''
    : '';

  return (
    <div className="page page--customer">
      <header className="page__header">
        <div className="store-header__brand">
          {/* The visiting store's own mark: its logo image, else its
              initials - never the generic platform brand. */}
          {storeName || storeLogo ? (
            storeLogo ? (
              <img
                src={storeLogo}
                alt={storeName ? `${storeName} logo` : 'Store logo'}
                className="store-header__logo"
                onError={() => setLogoBroken(true)}
              />
            ) : (
              <span className="store-header__mark" aria-hidden="true">
                {initials(storeName)}
              </span>
            )
          ) : null}
          <div>
            <h1>Checkout</h1>
            {storeName ? <p className="muted small">{storeName}</p> : null}
          </div>
        </div>
        <Link className="link-btn" to={shopTarget}>
          ← Keep shopping
        </Link>
      </header>

      {error ? <p className="alert alert--danger">{error}</p> : null}

      <div className="checkout">
        <section className="panel">
          <h2 className="panel__title">Delivery details</h2>

          {!isAuthenticated ? (
            <>
              <p className="muted small">
                No account needed — just tell the rider who to ask for.{' '}
                <Link className="link-btn" to={loginTarget}>
                  Prefer to sign in?
                </Link>
              </p>
              <div className="field-row">
                <label className="field">
                  <span>Your name</span>
                  <input
                    type="text"
                    name="name"
                    value={guest.name}
                    onChange={handleGuestChange}
                    placeholder="Jane Doe"
                    required
                  />
                </label>

                <label className="field">
                  <span>Email (optional)</span>
                  <input
                    type="email"
                    name="email"
                    value={guest.email}
                    onChange={handleGuestChange}
                    placeholder="jane@example.com"
                  />
                </label>
              </div>
            </>
          ) : null}

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

        {/* How to pay. A radio group rather than a dropdown: there are exactly
            two routes, they mean very different things to the shopper (pay now
            vs pay at the door), and one of them leaves this site entirely. */}
        <section className="panel">
          <h2 className="panel__title">Payment</h2>

          <div
            className="pay-methods"
            role="radiogroup"
            aria-label="How would you like to pay?"
          >
            {[PAYMENT_METHODS.COD, PAYMENT_METHODS.CARD].map((method) => (
              <label
                key={method}
                className={`pay-method${paymentMethod === method ? ' is-on' : ''}`}
              >
                <input
                  type="radio"
                  name="paymentMethod"
                  value={method}
                  checked={paymentMethod === method}
                  onChange={() => setPaymentMethod(method)}
                />

                <span className="pay-method__text">
                  <strong>
                    {method === PAYMENT_METHODS.COD
                      ? 'Cash on delivery'
                      : 'Pay online'}
                  </strong>
                  <em className="muted small">
                    {PAYMENT_METHOD_HINTS[method]}
                  </em>
                </span>

                <span className="pay-method__icon" aria-hidden="true">
                  {method === PAYMENT_METHODS.COD ? '💵' : '💳'}
                </span>
              </label>
            ))}
          </div>

          {paymentMethod === PAYMENT_METHODS.CARD ? (
            <p className="muted small">
              You will be taken to our secure payment page to pay by card, mobile
              banking or wallet, and brought straight back here afterwards.
            </p>
          ) : null}
        </section>

        <OrderSummary
          address={address}
          onPlaceOrder={handlePlaceOrder}
          placing={placing}
          ctaLabel={
            paymentMethod === PAYMENT_METHODS.CARD
              ? 'Pay online'
              : 'Place order'
          }
        >
          <p className="muted small">
            {paymentMethod === PAYMENT_METHODS.CARD
              ? 'You will be redirected to the payment page after this.'
              : 'Payment is collected in cash on delivery.'}
          </p>
        </OrderSummary>
      </div>
    </div>
  );
}
import { useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import orderService from '../../services/orderService';
import {
  saveSession,
  saveStores,
  saveCustomerStores,
} from '../../services/authService';
import { formatCurrency, formatDateTime } from '../../utils/formatters';
import {
  clearGuestToken,
  getGuestToken,
  orderTrackerPath,
} from '../../utils/constants';

/**
 * The "order placed" screen.
 *
 * Until this existed, checkout dropped the shopper straight on the tracker,
 * which is the wrong page for the moment they land on: the tracker is a dense
 * status board for an order already in motion, and the one thing it cannot say
 * is the thing a guest actually wants to know here — "can I keep this order?"
 *
 * So the order is confirmed, and a guest is OFFERED an account right there,
 * while the basket they just filled is still the most recent thing they did.
 * It is a plain offer with a plain "No thanks": the order is already placed
 * and already trackable, and nothing about the offer is a condition of it.
 */
export default function OrderSuccess() {
  const [params] = useSearchParams();
  const location = useLocation();
  const { isAuthenticated } = useAuth();

  // Checkout hands the new order over through router state, which is the
  // richest source (it already has the priced total). The query string is the
  // fallback so a refresh - or a link shared from a cashier's screen - still
  // lands on something real.
  const fromState = location.state || {};
  const orderId = fromState.orderId || params.get('orderId') || '';

  const [order, setOrder] = useState(fromState.order || null);
  const [loading, setLoading] = useState(!fromState.order);
  const [loadError, setLoadError] = useState('');

  // The offer. `name` is pre-filled from the order so most guests submit just
  // a password.
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [name, setName] = useState(fromState.guestName || '');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [claimed, setClaimed] = useState(false);
  /* The order may only be in router state (a hard refresh loses that), so fall
     back to fetching it. A guest needs their token; getOrderById reads it from
     storage on its own, which is the same token checkout saved. */
  useEffect(() => {
    if (!orderId || order) return undefined;

    let cancelled = false;
    setLoading(true);
    setLoadError('');

    orderService
      .getOrderById(orderId)
      .then((data) => {
        if (!cancelled) setOrder(data);
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError('We could not load that order just now.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [orderId, order]);

  // Prefill the name from whatever the order already knows about this guest, so
  // the common case is "type a password, press save".
  useEffect(() => {
    if (!name && order?.guest?.name) setName(order.guest.name);
  }, [order, name]);

  // A signed-in shopper has no use for the offer, and neither does an order
  // that already has an owner (we just claimed it, or it never was a guest's).
  const guestToken = orderId ? getGuestToken(orderId) : null;
  const canClaim =
    !isAuthenticated && !claimed && Boolean(guestToken) && !order?.customer;

  const handleSave = async (event) => {
    event.preventDefault();
    setSaveError('');

    if (password.length < 6) {
      setSaveError('Your password must be at least 6 characters.');
      return;
    }
    if (password !== confirm) {
      setSaveError('Those two passwords do not match.');
      return;
    }

    setSaving(true);
    try {
      const { data } = await orderService.claimGuestOrder({
        orderId,
        guestToken,
        password,
        name: name.trim() || undefined,
      });

      // The API answers exactly like login, so persist the same session. Doing
      // it by hand rather than through authService.register is deliberate: the
      // account already exists server-side, this is a claim, not a signup.
      saveSession({ token: data.token, user: data.user });
      saveStores(data.stores || []);
      saveCustomerStores(data.customerStores || []);

      // The order now has an owner, so the guest secret was retired
      // server-side. Drop the local copy so nothing keeps pointing at it.
      clearGuestToken(orderId);
      setClaimed(true);
    } catch (err) {
      // The API refuses when the email is already registered. That is not a
      // failure to retry - it is a real account belonging to somebody, and the
      // only correct answer is to sign in as them.
      setSaveError(
        err?.response?.data?.message ||
          'We could not create that account just now. Please try again.',
      );
    } finally {
      setSaving(false);
    }
  };

  if (!orderId) {
    return (
      <div className="page">
        <div className="empty">
          <h1 className="page__title">No order to show</h1>
          <p className="muted">
            We could not tell which order this was.{' '}
            <Link className="link-btn" to="/store">
              Browse a store
            </Link>
            .
          </p>
        </div>
      </div>
    );
  }
  const total = order?.total ?? order?.totalAmount ?? null;

  return (
    <div className="page">
      <div className="order-success">
        <header className="order-success__head">
          <span className="order-success__tick" aria-hidden="true">
            ✓
          </span>
          <h1 className="page__title">Order placed</h1>
          <p className="muted">
            {order?.store?.name ? `${order.store.name} has it. ` : ''}
            You can follow it every step of the way.
          </p>
        </header>

        {loading && !order ? <p className="muted">Loading your order…</p> : null}
        {loadError ? <p className="alert alert--danger">{loadError}</p> : null}

        {order ? (
          <section className="panel order-success__summary">
            <h2 className="panel__title">What happens next</h2>
            <dl className="detail-list">
              <div>
                <dt>Order</dt>
                <dd>
                  <code>{order.code || order._id || order.id}</code>
                </dd>
              </div>
              {order.status ? (
                <div>
                  <dt>Status</dt>
                  <dd>
                    <span className="pill">{order.status}</span>
                  </dd>
                </div>
              ) : null}
              {order.placedAt || order.createdAt ? (
                <div>
                  <dt>Placed</dt>
                  <dd>{formatDateTime(order.placedAt || order.createdAt)}</dd>
                </div>
              ) : null}
              {total != null ? (
                <div>
                  <dt>Total</dt>
                  <dd>
                    <strong>{formatCurrency(total)}</strong>
                  </dd>
                </div>
              ) : null}
              {order.paymentMethod ? (
                <div>
                  <dt>Payment</dt>
                  <dd>
                    {order.paymentMethod === 'cod'
                      ? 'Cash on delivery'
                      : 'Paid online'}
                  </dd>
                </div>
              ) : null}
            </dl>

            <Link className="btn btn-primary" to={orderTrackerPath(orderId)}>
              Track this order
            </Link>
          </section>
        ) : null}

        {/*
          The offer. Only a guest holding a valid token for THIS order ever sees
          it, and "No thanks" is a real button, not a dismissive link: the order
          is already placed, so declining costs them nothing and has to feel
          like nothing.
        */}
        {canClaim ? (
          <section className="panel order-success__claim">
            <h2 className="panel__title">Keep this order</h2>
            <p className="muted small">
              You checked out as a guest, so this order is only reachable from
              this browser. Set a password and it becomes a real account — this
              order moves into your history, and next time you order without
              retyping anything.
            </p>

            <form onSubmit={handleSave} className="order-success__form">
              <label className="field">
                <span>Name (optional)</span>
                <input
                  type="text"
                  name="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Jane Doe"
                  autoComplete="name"
                />
              </label>

              <label className="field">
                <span>Password</span>
                <input
                  type="password"
                  name="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="At least 6 characters"
                  autoComplete="new-password"
                  required
                />
              </label>

              <label className="field">
                <span>Confirm password</span>
                <input
                  type="password"
                  name="confirm"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  placeholder="Type it again"
                  autoComplete="new-password"
                  required
                />
              </label>

              {saveError ? (
                <p className="alert alert--danger">{saveError}</p>
              ) : null}

              <div className="order-success__actions">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={saving}
                >
                  {saving ? 'Creating your account…' : 'Save this order'}
                </button>
                <Link
                  className="btn btn-ghost"
                  to={orderTrackerPath(orderId)}
                >
                  No thanks, take me to the order
                </Link>
              </div>
            </form>
          </section>
        ) : null}

        {claimed ? (
          <section className="panel order-success__claim">
            <h2 className="panel__title">Your account is ready</h2>
            <p className="muted small">
              {order?.code || 'That order'} is now in your order history, and
              you are signed in on this device.
            </p>
            <div className="order-success__actions">
              <Link
                className="btn btn-primary"
                to={orderTrackerPath(orderId)}
              >
                Track this order
              </Link>
              <Link className="btn btn-ghost" to="/store">
                Keep shopping
              </Link>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import orderService from '../../services/orderService';
import {
  saveSession,
  saveStores,
  saveCustomerStores,
} from '../../services/authService';
import {
  formatCurrency,
  formatDateTime,
  formatObjectId,
  formatStatus,
} from '../../utils/formatters';
import {
  clearGuestToken,
  getGuestToken,
  orderTrackerPath,
  ORDER_STATUS_TONE,
  PAYMENT_METHOD_LABELS,
} from '../../utils/constants';

/**
 * Write text to the clipboard, reporting whether it worked.
 *
 * `navigator.clipboard` is unavailable on an insecure origin, which includes
 * this app reached over plain HTTP on a LAN address - the phone-testing path
 * `vite.config.js` explicitly allows. Rather than throw inside the click
 * handler, the promise is caught and reported as `false` so the button can say
 * something honest. Returns a promise because the caller flips state on the
 * result.
 */
function copyToClipboard(text) {
  if (!navigator.clipboard?.writeText) return Promise.resolve(false);
  return navigator.clipboard.writeText(text).then(
    () => true,
    () => false,
  );
}

/**
 * A small inline SVG, matching how the rest of the client draws icons (there is
 * no icon library installed - see Navbar.jsx, CategoryRail.jsx). Inherits
 * `currentColor` so the button's own colour drives it.
 */
function CopyIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

/**
 * The tick, drawn rather than typed.
 *
 * `size` is a prop because this glyph appears at two very different scales: the
 * 28px confirmation badge and the 12px "Copied" state inside the copy button. A
 * single hardcoded size would mean one of the two is wrong - and a 28px check
 * inside a 24px-tall button pushes the row taller than everything beside it,
 * which is exactly the ragged-height problem the badge base rule warns about.
 *
 * Inherits `currentColor`, so the button's own colour drives it, and it is
 * `aria-hidden` because the surrounding text ("Order placed", "Copied") already
 * carries the meaning.
 */
function CheckIcon({ size = 28 }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

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
  /* Copy feedback. `copied` is a short-lived flag rather than a message: the
     button relabels itself, so there is nothing to read and nothing to
     dismiss. The timer is held in a ref so a second click restarts the window
     instead of leaving two timeouts racing to clear a state that has since been
     set again - and so the cleanup below can cancel the one that is live. */
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef(null);

  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );

  const handleCopy = async () => {
    // Copy the FULL id, never the truncated form. The truncation exists to be
    // read; pasting "6ac0…bfc5" into a search box finds nothing.
    const ok = await copyToClipboard(order?._id || order?.code || '');
    setCopied(ok);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 1800);
  };
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
            <CheckIcon />
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
                  {/* `code` is the short human reference the store quotes to
                      a shopper ("DR-4821") and is preferred when present; the
                      ObjectId is the fallback, truncated because it is the
                      longest thing on the page. Either way the copy button
                      yields the value that will actually match a lookup. */}
                  <span className="order-success__id">
                    {formatObjectId(order.code || order._id || order.id)}
                  </span>
                  <button
                    type="button"
                    className={`order-success__copy${
                      copied ? ' order-success__copy--done' : ''
                    }`}
                    onClick={handleCopy}
                  >
                    {copied ? (
                      <>
                        <CheckIcon size={12} /> Copied
                      </>
                    ) : (
                      <>
                        <CopyIcon /> Copy ID
                      </>
                    )}
                  </button>
                </dd>
              </div>
              {order.status ? (
                <div>
                  <dt>Status</dt>
                  <dd>
                    {/* The tone comes from the shared ORDER_STATUS_TONE map, so
                        this pill is the same colour as the one on the orders
                        board and the tracker. It falls back to `muted` because
                        that class exists specifically to stop a live order
                        being flagged - `.badge`'s own default is solid brand
                        blue, which would shout about the least interesting
                        fact on the receipt. `formatStatus` capitalises it and
                        maps the machine value ("ready_for_pickup") to words. */}
                    <span
                      className={`badge badge--${
                        ORDER_STATUS_TONE[order.status] || 'muted'
                      }`}
                    >
                      {formatStatus(order.status)}
                    </span>
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
                  {/* No <strong> wrapper: `.detail-list dd` is already
                      font-weight 600, so nesting a bold inside it produced a
                      double-weighted total that sat heavier than every other
                      value on the receipt. */}
                  <dd>{formatCurrency(total)}</dd>
                </div>
              ) : null}
              {order.paymentMethod ? (
                <div>
                  <dt>Payment</dt>
                  {/* Named from the shared PAYMENT_METHOD_LABELS rather than
                      re-decided here. The old ternary collapsed bKash, Nagad,
                      Rocket and Card into one "Paid online" string, which threw
                      away the channel the order actually recorded - and the one
                      thing a shopper checking a receipt is looking for when
                      they want to know whether they already paid. */}
                  <dd>
                    {PAYMENT_METHOD_LABELS[order.paymentMethod] ||
                      formatStatus(order.paymentMethod)}
                  </dd>
                </div>
              ) : null}
            </dl>

            <Link
              className="btn btn-primary btn-block"
              to={orderTrackerPath(orderId)}
            >
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

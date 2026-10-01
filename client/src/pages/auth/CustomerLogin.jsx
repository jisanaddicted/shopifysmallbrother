import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { getPublicStore } from '../../services/storeService';
import { initials } from '../../utils/formatters';
import { rememberStoreVisit } from '../../utils/constants';
import './customer-auth.css';

/**
 * Customer sign-in for ONE store: /s/<slug>/login.
 *
 * The slug in the URL *is* the store context - it is sent to POST /auth/login
 * as `storeSlug`, which is what links the account to this store. Shoppers only
 * ever reach this page from a store page, so there is no role picker and no
 * demo chips: this is the customer-facing door. /login stays for staff.
 */
export default function CustomerLogin() {
  const { slug } = useParams();
  const { login, isAuthenticated, loading } = useAuth();

  const shopPath = `/s/${slug}`;

  const [store, setStore] = useState(null);
  const [storeError, setStoreError] = useState('');
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Brand the card with the store's logo + name.
  useEffect(() => {
    // This door IS the store's page - record it so signing out sends the
    // shopper back here rather than to the staff login page.
    rememberStoreVisit(slug);
    let cancelled = false;
    setStore(null);
    setStoreError('');

    getPublicStore(slug)
      .then((data) => {
        if (!cancelled) setStore(data?.store || data || null);
      })
      .catch((err) => {
        if (!cancelled) setStoreError(err.message || 'Could not load this store.');
      });

    return () => {
      cancelled = true;
    };
  }, [slug]);

  // Already signed in - drop the shopper straight back into the store.
  if (isAuthenticated && !loading) return <Navigate to={shopPath} replace />;

  const handleChange = (event) =>
    setForm((prev) => ({ ...prev, [event.target.name]: event.target.value }));

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      // `slug` becomes the store association on the account.
      await login(form.email.trim(), form.password, slug);
      // The guard above navigates once isAuthenticated flips.
    } catch (err) {
      setError(err.message || 'Could not sign you in.');
      setSubmitting(false);
    }
  };

  const storeName = store?.name || '';

  return (
    <div className="cust-auth">
      <div className="cust-auth__card">
        <div className="cust-auth__store">
          {store?.logo || store?.image ? (
            <img
              className="cust-auth__logo"
              src={store.logo || store.image}
              alt={`${storeName} logo`}
            />
          ) : (
            <span className="cust-auth__initials" aria-hidden="true">
              {initials(storeName || slug)}
            </span>
          )}
          <div className="cust-auth__store-text">
            <p className="cust-auth__store-name">{storeName || 'Store'}</p>
            <p className="cust-auth__store-sub muted small">Customer account</p>
          </div>
        </div>

        <h1 className="cust-auth__title">Welcome back</h1>
        <p className="cust-auth__subtitle">
          Sign in to order from {storeName || 'this store'}.
        </p>

        {storeName ? (
          <p className="cust-auth__note">
            You&rsquo;re signing in at <strong>{storeName}</strong>. Your account
            will be saved to this store.
          </p>
        ) : null}

        {storeError ? <p className="alert alert--danger">{storeError}</p> : null}
        {error ? <p className="alert alert--danger">{error}</p> : null}

        <form className="cust-auth__form" onSubmit={handleSubmit}>
          <label className="cust-auth__field">
            <span className="cust-auth__label">Email</span>
            <input
              className="cust-auth__input"
              type="email"
              name="email"
              value={form.email}
              onChange={handleChange}
              placeholder="you@example.com"
              autoComplete="username"
              required
            />
          </label>

          <label className="cust-auth__field">
            <span className="cust-auth__label">Password</span>
            <input
              className="cust-auth__input"
              type="password"
              name="password"
              value={form.password}
              onChange={handleChange}
              placeholder="••••••••"
              autoComplete="current-password"
              minLength={6}
              required
            />
          </label>

          <button
            type="submit"
            className="btn btn-primary btn-block cust-auth__submit"
            disabled={submitting}
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div className="cust-auth__foot">
          <span>
            New here? <Link to={`/s/${slug}/register`}>Create an account</Link>
          </span>
          <Link to={shopPath}>← Back to {storeName || 'the store'}</Link>
        </div>
      </div>
    </div>
  );
}

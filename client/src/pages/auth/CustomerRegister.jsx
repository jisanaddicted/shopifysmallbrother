import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { getPublicStore } from '../../services/storeService';
import { initials } from '../../utils/formatters';
import { rememberStoreVisit } from '../../utils/constants';
import './customer-auth.css';

/**
 * Customer sign-up for ONE store: /s/<slug>/register.
 *
 * Mirrors CustomerLogin: the slug in the URL *is* the store context, sent to
 * POST /auth/register as `storeSlug`, which links the new account to this
 * store. No role picker - this door only ever creates customers.
 */
export default function CustomerRegister() {
  const { slug } = useParams();
  const { register, isAuthenticated, loading } = useAuth();

  const shopPath = `/s/${slug}`;

  const [store, setStore] = useState(null);
  const [storeError, setStoreError] = useState('');
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    password: '',
    confirm: '',
  });
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

    if (!form.name.trim()) {
      setError('Please tell us your name.');
      return;
    }
    if (form.password.length < 6) {
      setError('Your password must be at least 6 characters.');
      return;
    }
    if (form.password !== form.confirm) {
      setError('The two passwords do not match.');
      return;
    }

    setSubmitting(true);

    try {
      // `slug` becomes the store association on the new account.
      await register({
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        password: form.password,
        storeSlug: slug,
      });
      // The guard above navigates once isAuthenticated flips.
    } catch (err) {
      setError(err.message || 'Could not create your account.');
      setSubmitting(false);
    }
  };

  const storeName = store?.name || '';

  return (
    <div className="cust-auth cust-auth--register">
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

        <h1 className="cust-auth__title">Create your account</h1>
        <p className="cust-auth__subtitle">
          Order from {storeName || 'this store'} in minutes.
        </p>

        {storeName ? (
          <p className="cust-auth__note">
            You&rsquo;re creating your account at <strong>{storeName}</strong>.
            It will be saved to this store.
          </p>
        ) : null}

        {storeError ? <p className="alert alert--danger">{storeError}</p> : null}
        {error ? <p className="alert alert--danger">{error}</p> : null}

        <form className="cust-auth__form" onSubmit={handleSubmit}>
          <label className="cust-auth__field">
            <span className="cust-auth__label">Full name</span>
            <input
              className="cust-auth__input"
              type="text"
              name="name"
              value={form.name}
              onChange={handleChange}
              placeholder="Your name"
              autoComplete="name"
              maxLength={80}
              required
            />
          </label>

          <label className="cust-auth__field">
            <span className="cust-auth__label">Email</span>
            <input
              className="cust-auth__input"
              type="email"
              name="email"
              value={form.email}
              onChange={handleChange}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </label>

          <label className="cust-auth__field">
            <span className="cust-auth__label">Phone (optional)</span>
            <input
              className="cust-auth__input"
              type="tel"
              name="phone"
              value={form.phone}
              onChange={handleChange}
              placeholder="+977-…"
              autoComplete="tel"
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
              autoComplete="new-password"
              minLength={6}
              required
            />
          </label>

          <label className="cust-auth__field">
            <span className="cust-auth__label">Confirm password</span>
            <input
              className="cust-auth__input"
              type="password"
              name="confirm"
              value={form.confirm}
              onChange={handleChange}
              placeholder="••••••••"
              autoComplete="new-password"
              minLength={6}
              required
            />
          </label>

          <button
            type="submit"
            className="btn btn-primary btn-block cust-auth__submit"
            disabled={submitting}
          >
            {submitting ? 'Creating…' : 'Create account'}
          </button>
        </form>

        <div className="cust-auth__foot">
          <span>
            Already have an account? <Link to={`/s/${slug}/login`}>Sign in</Link>
          </span>
          <Link to={shopPath}>Back to {storeName || 'the store'}</Link>
        </div>
      </div>
    </div>
  );
}

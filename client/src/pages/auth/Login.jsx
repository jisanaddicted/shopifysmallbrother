import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { HOME_ROUTE_BY_ROLE, ROLES, ROUTES } from '../../utils/constants';
import PortalAuth from './PortalAuth';
import './portal-auth.css';

// Handy shortcuts while your backend users don't exist yet.
// Press a chip to fill the form, then edit the values if needed.
const DEMO_ACCOUNTS = [
  { role: ROLES.RIDER, label: 'Rider', email: 'rider@example.com', password: 'password123' },
  { role: ROLES.STORE, label: 'Store owner', email: 'store@example.com', password: 'password123' },
  { role: ROLES.STORE_ADMIN, label: 'Store admin', email: 'storeadmin@example.com', password: 'password123' },
  { role: ROLES.ADMIN, label: 'Admin', email: 'admin@example.com', password: 'password123' },
];

export default function Login() {
  const { login, isAuthenticated, user, loading, customerHomeRoute } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // The store page this sign-in came from, if any. Sent to the API so the
  // store becomes one of the account's stores (and so a customer created
  // elsewhere is recognised here).
  const storeSlug = location.state?.storeSlug || '';
  const storeName = location.state?.storeName || '';
  const storePath = location.state?.storePath || '';

  // If ProtectedRoute sent us here, go back where the user was heading.
  const redirectTo =
    location.state?.from?.pathname ||
    storePath ||
    customerHomeRoute ||
    HOME_ROUTE_BY_ROLE[user?.role] ||
    ROUTES.HOME;

  useEffect(() => {
    if (isAuthenticated && !loading) {
      navigate(redirectTo, { replace: true });
    }
  }, [isAuthenticated, loading, redirectTo, navigate]);

  const handleChange = (event) =>
    setForm((prev) => ({ ...prev, [event.target.name]: event.target.value }));

  const fillDemo = (account) =>
    setForm({ email: account.email, password: account.password });

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      await login(form.email.trim(), form.password, storeSlug);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(err.message || 'Could not sign you in.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PortalAuth mode="login">
      <div className="auth-page">
        <form className="card auth-card" onSubmit={handleSubmit}>
          <h1 className="auth-card__title">Welcome back</h1>
          <p className="muted">
            Sign in as a store owner, rider, store admin or admin to open your
            workspace.
          </p>

          {storeName ? (
            <p className="alert alert--ok">
              Signing in to <strong>{storeName}</strong>. This store will be saved
              to your account.
            </p>
          ) : null}

          {error ? <p className="alert alert--danger">{error}</p> : null}

          <label className="field">
            <span>Email or username</span>
            <input
              type="text"
              name="email"
              value={form.email}
              onChange={handleChange}
              placeholder="you@example.com or sam.rider"
              autoComplete="username"
              required
            />
          </label>

          <label className="field">
            <span>Password</span>
            <input
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
            className="btn btn-primary btn-block"
            disabled={submitting}
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>

          <div className="demo-accounts">
            <p className="muted">Demo accounts:</p>
            {DEMO_ACCOUNTS.map((account) => (
              <button
                key={account.role}
                type="button"
                className="chip chip--button"
                onClick={() => fillDemo(account)}
                title={`${account.label}: ${account.email}`}
              >
                {account.label}
              </button>
            ))}
          </div>

          <p className="auth-card__footer">
            New here?{' '}
            <Link
              to={ROUTES.REGISTER}
              state={{
                storeSlug,
                storeName,
                storePath,
                from: location.state?.from,
              }}
            >
              Create a staff account
            </Link>
          </p>
        </form>
      </div>
    </PortalAuth>
  );
}

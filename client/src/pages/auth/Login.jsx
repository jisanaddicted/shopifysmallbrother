import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { HOME_ROUTE_BY_ROLE, ROLES, ROUTES } from '../../utils/constants';

// Handy shortcuts while your backend users don't exist yet.
// Press a chip to fill the form, then edit the values if needed.
const DEMO_ACCOUNTS = [
  { role: ROLES.CUSTOMER, email: 'customer@example.com', password: 'password123' },
  { role: ROLES.RIDER, email: 'rider@example.com', password: 'password123' },
  { role: ROLES.ADMIN, email: 'admin@example.com', password: 'password123' },
];

export default function Login() {
  const { login, isAuthenticated, user, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // If ProtectedRoute sent us here, go back where the user was heading.
  const redirectTo =
    location.state?.from?.pathname ||
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
      await login(form.email.trim(), form.password);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(err.message || 'Could not sign you in.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="card auth-card" onSubmit={handleSubmit}>
        <h1 className="auth-card__title">Welcome back</h1>
        <p className="muted">
          Sign in to shop, deliver or dispatch orders.
        </p>

        {error ? <p className="alert alert--danger">{error}</p> : null}

        <label className="field">
          <span>Email</span>
          <input
            type="email"
            name="email"
            value={form.email}
            onChange={handleChange}
            placeholder="you@example.com"
            autoComplete="email"
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
            >
              {account.role}
            </button>
          ))}
        </div>

        <p className="auth-card__footer">
          New here? <Link to={ROUTES.REGISTER}>Create an account</Link>
        </p>
      </form>
    </div>
  );
}
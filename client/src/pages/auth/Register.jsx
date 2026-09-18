import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { HOME_ROUTE_BY_ROLE, ROLES, ROUTES } from '../../utils/constants';

const INITIAL_FORM = {
  name: '',
  email: '',
  phone: '',
  password: '',
  confirmPassword: '',
  role: ROLES.CUSTOMER,
};

export default function Register() {
  const { register, isAuthenticated, user, loading } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState(INITIAL_FORM);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const redirectTo = HOME_ROUTE_BY_ROLE[user?.role] || ROUTES.HOME;

  useEffect(() => {
    if (isAuthenticated && !loading) {
      navigate(redirectTo, { replace: true });
    }
  }, [isAuthenticated, loading, redirectTo, navigate]);

  const handleChange = (event) =>
    setForm((prev) => ({ ...prev, [event.target.name]: event.target.value }));

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    if (form.password !== form.confirmPassword) {
      setError('The two passwords do not match.');
      return;
    }

    setSubmitting(true);

    try {
      // `confirmPassword` is only a UI concern - never send it to the API.
      const { confirmPassword, ...payload } = form;
      await register({
        ...payload,
        name: payload.name.trim(),
        email: payload.email.trim(),
        phone: payload.phone.trim(),
      });
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(err.message || 'Could not create your account.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="card auth-card" onSubmit={handleSubmit}>
        <h1 className="auth-card__title">Create your account</h1>
        <p className="muted">Order food and groceries in minutes.</p>

        {error ? <p className="alert alert--danger">{error}</p> : null}

        <label className="field">
          <span>Full name</span>
          <input
            type="text"
            name="name"
            value={form.name}
            onChange={handleChange}
            placeholder="Aarav Sharma"
            autoComplete="name"
            required
          />
        </label>

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
          <span>Phone</span>
          <input
            type="tel"
            name="phone"
            value={form.phone}
            onChange={handleChange}
            placeholder="+1 555 010 2030"
            autoComplete="tel"
          />
        </label>

        <label className="field">
          <span>I am a</span>
          <select name="role" value={form.role} onChange={handleChange}>
            <option value={ROLES.CUSTOMER}>Customer — I want to order</option>
            <option value={ROLES.RIDER}>Rider — I want to deliver</option>
          </select>
        </label>

        <div className="field-row">
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              name="password"
              value={form.password}
              onChange={handleChange}
              autoComplete="new-password"
              minLength={6}
              required
            />
          </label>

          <label className="field">
            <span>Confirm password</span>
            <input
              type="password"
              name="confirmPassword"
              value={form.confirmPassword}
              onChange={handleChange}
              autoComplete="new-password"
              minLength={6}
              required
            />
          </label>
        </div>

        <button
          type="submit"
          className="btn btn-primary btn-block"
          disabled={submitting}
        >
          {submitting ? 'Creating account…' : 'Create account'}
        </button>

        <p className="auth-card__footer">
          Already registered? <Link to={ROUTES.LOGIN}>Sign in</Link>
        </p>
      </form>
    </div>
  );
}
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import authService from '../../services/authService';
import {
  HOME_ROUTE_BY_ROLE,
  ROLES,
  ROLES_REQUIRING_USERNAME,
  ROUTES,
} from '../../utils/constants';

const INITIAL_FORM = {
  name: '',
  email: '',
  phone: '',
  username: '',
  storeName: '',
  password: '',
  confirmPassword: '',
  role: ROLES.CUSTOMER,
};

// Mirrors isValidUsername() on the server.
const USERNAME_PATTERN = /^[a-z][a-z0-9._-]{2,19}$/;

export default function Register() {
  const { register, isAuthenticated, user, loading } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState(INITIAL_FORM);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [usernameState, setUsernameState] = useState({
    checking: false,
    available: null,
    reason: '',
  });

  const redirectTo = HOME_ROUTE_BY_ROLE[user?.role] || ROUTES.HOME;

  // Stores and riders MUST pick a username. A customer may too (optional):
  // a store owner can appoint any account as a store admin, and a handle is
  // how they find them - without one they can only be invited by email.
  const mustHaveUsername = ROLES_REQUIRING_USERNAME.includes(form.role);
  const isStore = form.role === ROLES.STORE;

  const needsUsername = mustHaveUsername || form.username.trim().length > 0;

  useEffect(() => {
    if (isAuthenticated && !loading) {
      navigate(redirectTo, { replace: true });
    }
  }, [isAuthenticated, loading, redirectTo, navigate]);

  // Tell the user whether their handle is free, as they type (debounced).
  useEffect(() => {
    const username = form.username.trim().toLowerCase();

    if (!needsUsername || !username) {
      setUsernameState({ checking: false, available: null, reason: '' });
      return undefined;
    }

    let active = true;
    setUsernameState((prev) => ({ ...prev, checking: true }));

    const timer = setTimeout(async () => {
      try {
        const result = await authService.checkUsername(username);
        if (!active) return;
        setUsernameState({
          checking: false,
          available: result.available,
          reason: result.reason || '',
        });
      } catch {
        // Never block signup because the check itself failed.
        if (active) setUsernameState({ checking: false, available: null, reason: '' });
      }
    }, 400);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [form.username, needsUsername]);

  const handleChange = (event) =>
    setForm((prev) => ({ ...prev, [event.target.name]: event.target.value }));

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    if (form.password !== form.confirmPassword) {
      setError('The two passwords do not match.');
      return;
    }

    const username = form.username.trim().toLowerCase();

    if (needsUsername) {
      if (form.username.trim() && !USERNAME_PATTERN.test(username)) {
        setError(
          'Pick a username: 3-20 characters using letters, numbers, dot, dash or underscore, starting with a letter.',
        );
        return;
      }
      if (mustHaveUsername && !USERNAME_PATTERN.test(username)) {
        setError(
          'Pick a username: 3-20 characters using letters, numbers, dot, dash or underscore, starting with a letter.',
        );
        return;
      }
      if (
        usernameState.available === false &&
        USERNAME_PATTERN.test(username)
      ) {
        setError(usernameState.reason || 'That username is already taken.');
        return;
      }
    }

    setSubmitting(true);

    try {
      // `confirmPassword` is a UI concern only - never send it to the API.
      const { confirmPassword, storeName, ...payload } = form;

      await register({
        ...payload,
        name: payload.name.trim(),
        email: payload.email.trim(),
        phone: payload.phone.trim(),
        ...(needsUsername ? { username } : {}),
        // A merchant needs a store name; fall back to their own name.
        ...(isStore ? { storeName: storeName.trim() || payload.name.trim() } : {}),
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

        {needsUsername ? (
          <label className="field">
            <span>
              {isStore
                ? 'Store username'
                : form.role === ROLES.STORE_ADMIN
                  ? 'Store admin username'
                  : form.role === ROLES.RIDER
                    ? 'Rider username'
                    : 'Username (optional)'}
            </span>
            <input
              type="text"
              name="username"
              value={form.username}
              onChange={handleChange}
              placeholder={isStore ? 'joes.pizza' : 'sam.rider'}
              autoComplete="username"
              required={mustHaveUsername}
            />

            {form.username.trim() ? (
              <span
                className={`muted small block ${
                  usernameState.available === false ? 'field-error' : ''
                }`}
              >
                {usernameState.checking
                  ? 'Checking availability…'
                  : usernameState.available === true
                    ? '✓ Available'
                    : usernameState.available === false
                      ? usernameState.reason
                      : 'Usernames are 3-20 characters, starting with a letter.'}
              </span>
            ) : (
              <span className="muted small block">
                {mustHaveUsername
                  ? 'Stores and admins will find you by this handle.'
                  : 'Optional - a store owner needs a handle or your email to appoint you a store admin.'}
              </span>
            )}
          </label>
        ) : null}

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
            <option value={ROLES.STORE}>
              Store — I want to sell and dispatch
            </option>
            <option value={ROLES.STORE_ADMIN}>
              Store admin — I manage a store's products &amp; orders
            </option>
          </select>
        </label>

        {isStore ? (
          <label className="field">
            <span>Store name</span>
            <input
              type="text"
              name="storeName"
              value={form.storeName}
              onChange={handleChange}
              placeholder="Joe's Pizza"
            />
            <span className="muted small block">
              You get a public page at /s/&lt;your-store-name&gt; that lists only
              your products.
            </span>
          </label>
        ) : null}

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
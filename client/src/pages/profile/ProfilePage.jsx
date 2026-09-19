import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import authService from '../../services/authService';
import { initials } from '../../utils/formatters';

/**
 * The signed-in user's own profile. The username is the headline: it is the
 * handle a store owner or admin types to find and invite this account, so
 * riders (and merchants) need to see it at a glance.
 */
export default function ProfilePage() {
  const { user, setUser, isRider } = useAuth();

  const [name, setName] = useState(user?.name || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const handleSave = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');

    try {
      const updated = await authService.updateProfile({
        name: name.trim(),
        phone: phone.trim(),
      });
      setUser(updated);
      setNotice('Profile saved.');
    } catch (err) {
      setError(err.message || 'Could not save your profile.');
    } finally {
      setSaving(false);
    }
  };

  const toggleAvailability = async () => {
    setError('');
    setNotice('');

    try {
      const updated = await authService.updateProfile({
        isAvailable: !user?.isAvailable,
      });
      setUser(updated);
      setNotice(
        updated.isAvailable
          ? 'You are visible to dispatch again.'
          : 'You are hidden from dispatch until you switch back.',
      );
    } catch (err) {
      setError(err.message || 'Could not update your availability.');
    }
  };

  const roleLabel = user?.role
    ? user.role.charAt(0).toUpperCase() + user.role.slice(1)
    : '';

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1>My profile</h1>
          <p className="muted">Your account details and delivery handle.</p>
        </div>
      </header>

      {error ? <p className="alert alert--danger">{error}</p> : null}
      {notice ? <p className="alert alert--success">{notice}</p> : null}

      <div className="profile">
        <section className="card profile__identity">
          <span className="avatar avatar--lg" aria-hidden="true">
            {initials(user?.name || user?.email)}
          </span>

          <div className="profile__who">
            <span className="badge badge--info">{roleLabel}</span>

            {/* The headline: the handle others use to find this account. */}
            {user?.username ? (
              <p className="profile__username" title="Your username">
                @{user.username}
              </p>
            ) : (
              <p className="profile__username muted">No username set</p>
            )}

            <p className="profile__name">{user?.name}</p>
            <p className="muted small">{user?.email}</p>
            {user?.phone ? (
              <p className="muted small">{user.phone}</p>
            ) : null}
          </div>

          {user?.username ? (
            <p className="muted small profile__hint">
              Stores and admins find you by searching{' '}
              <strong>@{user.username}</strong> — share it exactly like that.
            </p>
          ) : null}

          {isRider && (
            <button
              type="button"
              className={`btn btn-sm ${
                user?.isAvailable ? 'btn-outline' : 'btn-primary'
              }`}
              onClick={toggleAvailability}
            >
              {user?.isAvailable
                ? 'Available for deliveries — go off duty'
                : 'Off duty — go available'}
            </button>
          )}
        </section>

        <section className="card">
          <h2>Details</h2>
          <form onSubmit={handleSave}>
            <label className="field">
              <span>Full name</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Sam Rider"
                required
              />
            </label>

            <label className="field">
              <span>Phone</span>
              <input
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="+1 555 010 2030"
              />
            </label>

            <button
              type="submit"
              className="btn btn-primary"
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </form>
          <p className="muted small">
            Your username and email cannot be changed here — they are how other
            people find your account.
          </p>
        </section>
      </div>
    </div>
  );
}

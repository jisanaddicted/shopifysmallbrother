import { useCallback, useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import authService from '../../services/authService';
import storeService from '../../services/storeService';
import {
  HOME_ROUTE_BY_ROLE,
  ROUTES,
  customerPath,
  lastStoreVisit,
} from '../../utils/constants';
import { initials } from '../../utils/formatters';

/**
 * The signed-in user's own profile. The username is the headline: it is the
 * handle a store owner or admin types to find and invite this account, so
 * riders (and merchants) need to see it at a glance.
 *
 * When mounted under /s/:slug/profile the page stays inside the customer's
 * store (slug from the URL); the bare /profile route is kept for staff and
 * old links — customers landing there are bounced to their scoped page.
 *
 * Because it is a full page (opened from the storefront's account sheet), the
 * header carries a ✕ that closes it again — see closeProfile below.
 */
export default function ProfilePage() {
  const { user, setUser, isRider, isCustomer, customerHomeRoute, homeRoute, shoppingStores } =
    useAuth();
  // Present only on the scoped route /s/:slug/profile — that slug is what
  // keeps the customer inside their store after login.
  const { slug: routeSlug } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  // Where the ✕ in the header sends people when there is no step to undo:
  // customers back to the store they were browsing (slug straight from the
  // URL, so the store never drops out of the URL), staff to their dashboard.
  const closeTarget = routeSlug
    ? customerPath(routeSlug)
    : homeRoute || customerHomeRoute || HOME_ROUTE_BY_ROLE[user?.role] || ROUTES.HOME;

  // "Close" should undo the step that opened the profile (the storefront
  // account sheet, the rider console, ...). A deep link or a refresh has no
  // step to undo — the router marks the first page with key 'default' — so
  // those fall back to closeTarget instead of leaving the app.
  const closeProfile = () => {
    if (location.key !== 'default') {
      navigate(-1);
      return;
    }

    navigate(closeTarget, { replace: true });
  };

  const [name, setName] = useState(user?.name || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  // Store invitations addressed to me. Riders answer theirs in the rider
  // console; invited store admins (regular users) answer them right here.
  const [invitations, setInvitations] = useState([]);
  const [invBusy, setInvBusy] = useState(false);

  const loadInvitations = useCallback(async () => {
    const list = await storeService.listMyRequests().catch(() => []);
    setInvitations(Array.isArray(list) ? list : []);
  }, []);

  useEffect(() => {
    loadInvitations();
  }, [loadInvitations]);

  const respondToInvitation = async (requestId, action) => {
    setInvBusy(true);
    setError('');
    setNotice('');

    try {
      await storeService.respondToRequest(requestId, action);
      setNotice(
        action === 'accept'
          ? 'Invitation accepted.'
          : 'Invitation declined.',
      );
      await loadInvitations();
    } catch (err) {
      setError(err.message || 'Could not answer that invitation.');
    } finally {
      setInvBusy(false);
    }
  };

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
          ? 'You are visible for orders again.'
          : 'You are hidden from order offers until you switch back.',
      );
    } catch (err) {
      setError(err.message || 'Could not update your availability.');
    }
  };

  const roleLabel = user?.role
    ? user.role.charAt(0).toUpperCase() + user.role.slice(1)
    : '';

  // A customer on the bare /profile URL (old bookmark, avatar link) belongs
  // on their scoped page /s/<slug>/profile so the store slug never drops
  // out of the URL after login. Staff keep the global page as-is.
  if (isCustomer && !routeSlug) {
    const slug = shoppingStores?.[0]?.slug || lastStoreVisit() || '';
    return <Navigate to={slug ? customerPath(slug, 'profile') : customerHomeRoute || '/store'} replace />;
  }

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1>My profile</h1>
          <p className="muted">Your account details and delivery handle.</p>
        </div>

        {/* The same ✕ the cart drawer and the account sheets carry, so a
            shopper who opened the profile by mistake can close it again
            instead of hunting for a back button. */}
        <button
          type="button"
          className="icon-btn profile__close"
          onClick={closeProfile}
          aria-label="Close profile"
          title="Close profile"
        >
          ✕
        </button>
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

        {invitations.length > 0 ? (
          <section className="card">
            <h2>Store invitations</h2>
            <p className="muted small">
              A store owner or admin invited you. Accepting links your account
              to that store.
            </p>

            {invitations.map((invite) => {
              const id = invite._id || invite.id;
              const storeName =
                invite.store?.name || invite.store?.slug || 'a store';

              return (
                <div
                  key={id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.75rem',
                    padding: '0.6rem 0',
                    borderTop: '1px solid rgba(0, 0, 0, 0.08)',
                  }}
                >
                  <div>
                    <strong>{storeName}</strong>
                    <p className="muted small" style={{ margin: 0 }}>
                      {invite.role === 'admin'
                        ? 'You were invited to help manage this store.'
                        : 'You were invited to deliver for this store.'}
                    </p>
                  </div>

                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={invBusy}
                      onClick={() => respondToInvitation(id, 'accept')}
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      disabled={invBusy}
                      onClick={() => respondToInvitation(id, 'decline')}
                    >
                      Decline
                    </button>
                  </div>
                </div>
              );
            })}
          </section>
        ) : null}

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

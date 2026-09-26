import { useCallback, useEffect, useState } from 'react';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import { useAuth } from '../../context/AuthContext';
import storeService from '../../services/storeService';

/**
 * Admin panel: Invitations.
 *
 * A store owner invites this account by username ("Invite as store admin"
 * from their dashboard). Every pending invitation lands here; accepting links
 * the store to the account, after which Dispatch, Products and Theme only
 * show that store's data. Declining leaves the account untouched. Each store
 * under "Stores you run" carries a Remove store button that drops the
 * membership again (the store can always invite this account later).
 *
 * The session is re-read after an acceptance or a removal so the sidebar and
 * product lists stay correct without a fresh sign-in.
 */
export default function AdminInvitations() {
  const { user, stores, refreshSession } = useAuth();
  const [invitations, setInvitations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    setError('');

    try {
      const list = await storeService.listMyRequests();
      // The panel is about stores asking for an admin; rider invitations
      // (if any) belong to the rider console.
      setInvitations(
        (Array.isArray(list) ? list : []).filter(
          (request) => request.role === 'admin',
        ),
      );
    } catch (err) {
      setError(err.message || 'Could not load the invitations.');
    } finally {
      if (initial) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(true);
  }, [load]);

  // "Remove store" - drop this account's membership at that store. The
  // session re-read is what actually empties the list: Dispatch, Products and
  // Theme all scope themselves through the same `stores` list.
  const removeStore = async (entry) => {
    const storeId = entry.store?._id || entry.store?.id;
    if (!storeId) return;

    setBusy(true);
    setError('');
    setNotice('');

    try {
      await storeService.leaveStore(storeId);
      await refreshSession();
      setNotice(
        `${entry.store?.name || 'That store'} was removed — you no longer run it.`,
      );
    } catch (err) {
      setError(err.message || 'Could not remove that store.');
    } finally {
      setBusy(false);
    }
  };

  const respond = async (requestId, action) => {
    setBusy(true);
    setError('');
    setNotice('');

    try {
      await storeService.respondToRequest(requestId, action);

      if (action === 'accept') {
        // Pull the new membership into the session immediately - the sidebar,
        // product lists and theme store picker all read it from there.
        await refreshSession();
        setNotice('Invitation accepted — that store now shows up across your panel.');
      } else {
        setNotice('Invitation declined.');
      }

      await load();
    } catch (err) {
      setError(err.message || 'Could not answer that invitation.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <LoadingSpinner fullPage label="Loading invitations…" />;
  }

  const handle = user?.username ? `@${user.username}` : 'your account';

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1>Invitations</h1>
          <p className="muted">
            Stores invite you by username. Accept to work on a store — its
            orders, products and theme then appear in your panel. Nothing else
            on the platform is visible to you.
          </p>
        </div>

        <button
          type="button"
          className="btn btn-outline btn-sm"
          onClick={() => load(true)}
          disabled={busy}
        >
          Refresh
        </button>
      </header>

      {error ? <p className="alert alert--danger">{error}</p> : null}
      {notice ? <p className="alert alert--ok">{notice}</p> : null}

      <section className="panel">
        <div className="panel__header">
          <h2 className="panel__title">
            Pending invitations ({invitations.length})
          </h2>
          <span className="muted small">Waiting for your answer</span>
        </div>

        {invitations.length === 0 ? (
          <p className="empty">
            No store is waiting for an answer. When a store owner invites{' '}
            {handle} from their Team section, the request shows up here.
          </p>
        ) : (
          <ul className="rider-list">
            {invitations.map((invite) => (
              <li key={invite._id || invite.id}>
                <div className="rider-list__item">
                  <span className="rider-list__id">
                    {invite.store?.name || 'A store'}
                  </span>
                  <span className="muted small">
                    Invited by{' '}
                    {invite.invitedBy?.username
                      ? `@${invite.invitedBy.username}`
                      : invite.invitedBy?.name || 'the owner'}
                    {invite.createdAt
                      ? ` · ${String(invite.createdAt).slice(0, 10)}`
                      : ''}
                  </span>

                  <div className="button-row">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={busy}
                      onClick={() => respond(invite._id || invite.id, 'accept')}
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busy}
                      onClick={() => respond(invite._id || invite.id, 'decline')}
                    >
                      Decline
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <div className="panel__header">
          <h2 className="panel__title">Stores you run</h2>
          <span className="muted small">
            Accepted invitations and stores you own
          </span>
        </div>

        {stores.length === 0 ? (
          <p className="empty">
            None yet — accept an invitation above to start working on a store.
          </p>
        ) : (
          <ul className="rider-list">
            {stores.map((entry) => (
              <li key={entry.store?._id || entry.store?.id}>
                <div className="rider-list__item">
                  <div className="rider-list__row">
                    <div className="rider-list__main">
                      <span className="rider-list__id">
                        {entry.store?.name || 'A store'}
                      </span>
                      <span className="muted small">
                        {entry.role === 'owner'
                          ? 'You own this store'
                          : 'You were appointed as a store admin'}
                      </span>
                    </div>

                    <button
                      type="button"
                      className="btn btn-ghost btn-sm btn-danger"
                      disabled={busy}
                      onClick={() => removeStore(entry)}
                    >
                      Remove store
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

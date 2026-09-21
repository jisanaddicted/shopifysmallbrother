import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import { useAuth } from '../../context/AuthContext';
import storeService from '../../services/storeService';
import {
  ORDER_STATUS,
  ORDER_STATUS_TONE,
  STORE_RIDER_STATUS,
  STORE_RIDER_STATUS_LABELS,
  shopPath,
} from '../../utils/constants';
import { formatCurrency, formatStatus } from '../../utils/formatters';

const BLANK_FORM = {
  name: '',
  description: '',
  phone: '',
  line1: '',
  city: '',
  image: '',
  slug: '',
};

export default function MerchantDashboard() {
  const { refreshSession } = useAuth();

  const [store, setStore] = useState(null);
  const [riders, setRiders] = useState([]);
  const [members, setMembers] = useState([]);
  const [orders, setOrders] = useState([]);
  const [form, setForm] = useState(BLANK_FORM);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  // False for an appointed store admin: they see orders/products but cannot
  // edit the storefront or manage the team.
  const [isOwner, setIsOwner] = useState(true);
  // Store-admin invitations waiting for this account's answer.
  const [invites, setInvites] = useState([]);

  // Rider roster controls
  const [term, setTerm] = useState('');
  const [results, setResults] = useState([]);
  const [rosterBusy, setRosterBusy] = useState(false);
  const [rosterError, setRosterError] = useState('');
  // What role a found person is invited for: rider or store admin.
  const [inviteRole, setInviteRole] = useState('rider');

  const flash = (message) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 3500);
  };

  const loadRoster = useCallback(async (storeId) => {
    try {
      const links = await storeService.listStoreRiders(storeId);
      setRiders(links.filter((link) => link.role !== 'admin'));
      setMembers(links);
    } catch (err) {
      setRosterError(err.message || 'Could not load the rider roster.');
    }
  }, []);

  // Pending store-admin invitations addressed to this account.
  const loadInvites = useCallback(async () => {
    try {
      const requests = await storeService.listMyRequests();
      setInvites(requests.filter((request) => request.role === 'admin'));
    } catch {
      setInvites([]);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const [mine, orderList] = await Promise.all([
        storeService.getMyStore(),
        storeService.listStoreOrders(),
      ]);

      const nextStore = mine.store;
      setStore(nextStore);
      setIsOwner(mine.isOwner !== false);
      setRiders(mine.riders || []);
      setMembers(mine.members || mine.riders || []);
      setOrders(orderList);

      setForm({
        name: nextStore?.name || '',
        description: nextStore?.description || '',
        phone: nextStore?.phone || '',
        line1: nextStore?.address?.line1 || '',
        city: nextStore?.address?.city || '',
        image: nextStore?.image || '',
        slug: nextStore?.slug || '',
      });

      if (mine.isOwner === false) loadInvites();
    } catch (err) {
      setError(err.message || 'Could not load your store.');
    } finally {
      setLoading(false);
    }
  }, [loadInvites]);

  useEffect(() => {
    load();
  }, [load]);

  const saveStore = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');

    try {
      const updated = await storeService.updateMyStore({
        name: form.name,
        description: form.description,
        phone: form.phone,
        image: form.image,
        address: { line1: form.line1, city: form.city },
      });

      setStore(updated);
      setForm((prev) => ({ ...prev, slug: updated.slug || prev.slug }));
      flash('Storefront saved.');
    } catch (err) {
      setError(err.message || 'Could not save the store.');
    } finally {
      setSaving(false);
    }
  };

  const searchPeople = async (event) => {
    event.preventDefault();
    setRosterError('');

    try {
      // Global people search: any user, by username, with a profile card.
      const found = await storeService.lookupUser(term.trim());
      setResults(found || null);

      if (!found) {
        setRosterError(`No account matched “${term.trim()}”. Check the spelling.`);
      }
    } catch (err) {
      setRosterError(err.message || 'The search failed.');
    }
  };

  const invite = async (username) => {
    setRosterBusy(true);
    setRosterError('');

    try {
      await storeService.inviteRider(store._id, username, inviteRole);
      await loadRoster(store._id);
      setResults(null);
      flash(
        `Invitation sent to @${username} as ${inviteRole === 'admin' ? 'a store admin' : 'a rider'}. They accept it in their console.`,
      );
    } catch (err) {
      setRosterError(err.message || 'Could not send the invitation.');
    } finally {
      setRosterBusy(false);
    }
  };

  const removeRider = async (riderId) => {
    setRosterBusy(true);
    setRosterError('');

    try {
      await storeService.removeStoreRider(store._id, riderId);
      await loadRoster(store._id);
      flash('Rider removed from this store.');
    } catch (err) {
      setRosterError(err.message || 'Could not remove the rider.');
    } finally {
      setRosterBusy(false);
    }
  };

  // Accept or decline a store-admin invitation. Accepting re-reads the
  // session so the new store appears in the navbar/account immediately.
  const respondToInvite = async (requestId, action) => {
    setRosterBusy(true);
    setRosterError('');

    try {
      await storeService.respondToRequest(requestId, action);

      if (action === 'accept') {
        await refreshSession();
        flash('Welcome aboard! You can now see this store and its orders.');
      } else {
        flash('Invitation declined.');
      }

      await load();
    } catch (err) {
      setRosterError(err.message || 'Could not respond to the invitation.');
    } finally {
      setRosterBusy(false);
    }
  };

  const setField = (key) => (event) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  if (loading) {
    return <LoadingSpinner fullPage label="Loading your store…" />;
  }

  if (!store) {
    return (
      <div className="page">
        <p className="alert alert--danger">
          {error || 'No store is linked to this account yet.'}
        </p>
        <button type="button" className="btn btn-outline" onClick={load}>
          Try again
        </button>
      </div>
    );
  }

  const liveOrders = orders.filter(
    (order) =>
      order.status !== ORDER_STATUS.DELIVERED &&
      order.status !== ORDER_STATUS.CANCELLED,
  );

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1>{store.name}</h1>
          <p className="muted">
            Public page: <Link to={shopPath(store.slug)}>/s/{store.slug}</Link>
            {store.isActive ? '' : ' · closed to customers'}
          </p>
        </div>
        <button type="button" className="btn btn-outline btn-sm" onClick={load}>
          Refresh
        </button>
      </header>

      {notice ? <p className="alert alert--ok">{notice}</p> : null}
      {error ? <p className="alert alert--danger">{error}</p> : null}

      <div className="stats">
        <div className="stat">
          <strong>{orders.length}</strong>
          <span className="stat__label">Total orders</span>
        </div>
        <div className="stat stat--warn">
          <strong>{liveOrders.length}</strong>
          <span className="stat__label">In progress</span>
        </div>
        <div className="stat stat--ok">
          <strong>
            {riders.filter((r) => r.status === STORE_RIDER_STATUS.ACTIVE).length}
          </strong>
          <span className="stat__label">Riders delivering</span>
        </div>
      </div>

      {/* ---- Pending store-admin invitations ----------------------------- */}
      {invites.length > 0 ? (
        <section className="panel">
          <div className="panel__header">
            <h2 className="panel__title">Invitations</h2>
            <span className="muted small">
              A store owner has appointed you to help run their store.
            </span>
          </div>

          {rosterError ? <p className="alert alert--warn">{rosterError}</p> : null}

          <ul className="rider-list">
            {invites.map((invite) => (
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
                  </span>
                  <div className="button-row">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={rosterBusy}
                      onClick={() =>
                        respondToInvite(invite._id || invite.id, 'accept')
                      }
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={rosterBusy}
                      onClick={() =>
                        respondToInvite(invite._id || invite.id, 'decline')
                      }
                    >
                      Decline
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ---- Rider roster - owner only ----------------------------------- */}
      {isOwner ? (
      <section className="panel">
        <div className="panel__header">
          <h2 className="panel__title">Team</h2>
          <span className="muted small">
            Search anyone on the platform by username, then invite them as a
            rider or a store admin.
          </span>
        </div>

        <div className="filters">
          <label className="field field--inline">
            <span>Invite as</span>
            <select
              value={inviteRole}
              onChange={(event) => setInviteRole(event.target.value)}
            >
              <option value="rider">Rider</option>
              <option value="admin">Store admin</option>
            </select>
          </label>
        </div>

        <form className="filters" onSubmit={searchPeople}>
          <input
            type="search"
            className="filters__search"
            placeholder="username, e.g. sam.rider"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
          />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={rosterBusy || term.trim().length === 0}
          >
            Search
          </button>
        </form>

        {rosterError ? <p className="alert alert--warn">{rosterError}</p> : null}

        {results ? (
          <ul className="rider-list">
            <li>
              <div className="rider-list__item">
                <span className="rider-list__id">@{results.username}</span>
                <span className="muted small">{results.name}</span>
                <span className="badge badge--info">
                  {results.role === 'rider' ? 'Rider' : results.role}
                </span>
                <span className="muted small">
                  {results.stats?.deliveriesCompleted != null
                    ? `${results.stats.deliveriesCompleted} delivered · ${results.stats.deliveriesActive} active · ${results.stats.stores} store${results.stats.stores === 1 ? '' : 's'}`
                    : results.stats?.storesOwned != null
                      ? `${results.stats.storesOwned} owned · ${results.stats.storesManaged} managed`
                      : ''}
                </span>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={rosterBusy}
                  onClick={() => invite(results.username)}
                >
                  Invite as {inviteRole === 'admin' ? 'store admin' : 'rider'}
                </button>
              </div>
            </li>
          </ul>
        ) : null}

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Rider</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {riders.map((link) => (
                <tr key={link._id || link.id}>
                  <td className="table__product">
                    <strong>@{link.rider?.username}</strong>
                    <span className="muted small">
                      {link.rider?.name || link.rider?.email || ''}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`badge badge--${
                        link.status === STORE_RIDER_STATUS.ACTIVE
                          ? 'success'
                          : link.status === STORE_RIDER_STATUS.PENDING
                            ? 'warn'
                            : 'info'
                      }`}
                    >
                      {STORE_RIDER_STATUS_LABELS[link.status] || link.status}
                    </span>
                  </td>
                  <td className="table__actions">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={rosterBusy}
                      onClick={() =>
                        removeRider(link.rider?._id || link.rider?.id)
                      }
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      ) : null}

      {/* ---- Orders ------------------------------------------------------ */}
      <section className="panel">
        <div className="panel__header">
          <h2 className="panel__title">Orders</h2>
          <span className="muted small">
            A rider appears here once they take the delivery.
          </span>
        </div>

        {orders.length === 0 ? (
          <p className="empty">
            No orders yet. Share your store link to start selling.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Placed</th>
                  <th>Total</th>
                  <th>Status</th>
                  <th>Rider</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => {
                  const id = order._id || order.id;
                  return (
                    <tr key={id}>
                      <td className="table__product">
                        <strong>#{String(id).slice(-6).toUpperCase()}</strong>
                        <span className="muted small">
                          {order.items?.length || 0} item(s)
                        </span>
                      </td>
                      <td className="muted small">
                        {new Date(order.createdAt).toLocaleString()}
                      </td>
                      <td className="price">{formatCurrency(order.total)}</td>
                      <td>
                        <span
                          className={`badge badge--${
                            ORDER_STATUS_TONE[order.status] || 'info'
                          }`}
                        >
                          {formatStatus(order.status)}
                        </span>
                      </td>
                      <td>
                        {order.rider ? `@${order.rider.username}` : 'Unclaimed'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---- Storefront details - owner only ------------------------------ */}
      {isOwner ? (
      <section className="panel">
        <div className="panel__header">
          <h2 className="panel__title">Storefront details</h2>
        </div>

        <form onSubmit={saveStore}>
          <div className="field-row">
            <label className="field">
              <span>Store name</span>
              <input value={form.name} onChange={setField('name')} required />
            </label>

            <label className="field">
              <span>Phone</span>
              <input value={form.phone} onChange={setField('phone')} />
            </label>
          </div>

          <label className="field">
            <span>Description</span>
            <textarea
              rows={2}
              value={form.description}
              onChange={setField('description')}
            />
          </label>

          <div className="field-row">
            <label className="field">
              <span>Address line</span>
              <input value={form.line1} onChange={setField('line1')} />
            </label>

            <label className="field">
              <span>City</span>
              <input value={form.city} onChange={setField('city')} />
            </label>
          </div>

          <label className="field">
            <span>Image URL</span>
            <input value={form.image} onChange={setField('image')} />
          </label>

          <div className="button-row">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save storefront'}
            </button>
          </div>
        </form>
      </section>
      ) : null}
    </div>
  );
}

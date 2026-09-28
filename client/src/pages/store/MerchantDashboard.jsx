import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import storeService from '../../services/storeService';
import {
  CLOSED_STATUSES,
  ORDER_STATUS,
  STORE_RIDER_STATUS,
  STORE_RIDER_STATUS_LABELS,
  ROUTES,
  shopPath,
} from '../../utils/constants';

const BLANK_FORM = {
  name: '',
  description: '',
  phone: '',
  line1: '',
  city: '',
  image: '',
  slug: '',
};

const storeKey = (entry) => String(entry?._id || entry?.id || '');

const isSameStore = (a, b) => {
  const ka = storeKey(a);
  const kb = storeKey(b);
  return Boolean(ka && kb && ka === kb);
};

export default function MerchantDashboard() {
  const { refreshSession, stores: sessionStores } = useAuth();
  const { newOrders, statusUpdates } = useSocket();
  const storeIdRef = useRef(null);

  const [store, setStore] = useState(null);
  // Every store this account runs (owner + appointed admin), as
  // [{ store, role, isOwner }]. Powers the "My storefronts" card with each
  // store's landing-page link (/s/<slug>).
  const [myStores, setMyStores] = useState([]);
  const [riders, setRiders] = useState([]);
  const [members, setMembers] = useState([]);
  // Only the two customer COUNTS the stat tiles show. The list itself moved to
  // its own page (the Customers tab), so this page deliberately does not keep a
  // second copy of the rows to maintain alongside it.
  const [customersMeta, setCustomersMeta] = useState({
    total: 0,
    newThisWeek: 0,
  });
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

  // The customer COUNTS for the stat tile. The list behind that number is on the
  // Customers page now; this still fetches it because the endpoint returns both,
  // and a failed fetch here just leaves the tile at zero rather than taking the
  // whole dashboard down.
  const loadCustomerCounts = useCallback(async (storeId) => {
    if (!storeId) {
      setCustomersMeta({ total: 0, newThisWeek: 0 });
      return;
    }

    try {
      const data = await storeService.listStoreCustomers(storeId);
      setCustomersMeta({
        total: data?.total ?? 0,
        newThisWeek: data?.newThisWeek ?? 0,
      });
    } catch {
      setCustomersMeta({ total: 0, newThisWeek: 0 });
    }
  }, []);

  const load = useCallback(
    async (storeId) => {
      setLoading(true);
      setError('');

      try {
        // The store switcher: `storeId` picks one of the account's several
        // stores; without it the primary store is used. `mine/all` is the
        // source for the "My storefronts" card (every landing-page link),
        // while `mine` still carries the primary roster inline.
        const [mine, allStores, orderList] = await Promise.all([
          storeService.getMyStore(),
          storeService.listMyMerchantStores().catch(() => []),
          storeService.listStoreOrders(storeId),
        ]);

        const entries = Array.isArray(allStores) ? allStores : [];
        setMyStores(entries);

        const activeId = storeId || null;
        const activeEntry = activeId
          ? entries.find(
              (entry) =>
                String(entry.store?._id || entry.store?.id) ===
                String(activeId),
            )
          : null;
        const nextStore = activeEntry?.store || mine.store || null;
        setStore(nextStore);
        storeIdRef.current = nextStore?._id || nextStore?.id || null;
        // The ownership flag follows the ACTIVE store, not the primary one,
        // so switching to an administered store correctly hides owner
        // controls. Falls back to `mine` when the switcher list is empty.
        const ownerFlag = activeEntry
          ? activeEntry.isOwner !== false
          : mine.isOwner !== false;
        setIsOwner(ownerFlag);
        setRiders(mine.riders || []);
        setMembers(mine.members || mine.riders || []);
        // When a non-primary store is active the roster inline in `mine`
        // belongs to the primary store - reload it for the active one
        // (owner only: the roster endpoints are owner-only, so a store
        // admin viewing an administered store keeps an empty roster
        // instead of a 403).
        if (activeEntry && !isSameStore(mine.store, nextStore)) {
          if (activeEntry.isOwner !== false) {
            await loadRoster(storeIdRef.current);
          } else {
            setRiders([]);
            setMembers([]);
          }
        }
        setOrders(orderList);
        // The store's customers, for the "Customers" panel below. Uses the
        // ACTIVE store, so switching stores re-scopes the list.
        loadCustomerCounts(storeIdRef.current);

        setForm({
          name: nextStore?.name || '',
          description: nextStore?.description || '',
          phone: nextStore?.phone || '',
          line1: nextStore?.address?.line1 || '',
          city: nextStore?.address?.city || '',
          image: nextStore?.image || '',
          slug: nextStore?.slug || '',
        });

        if (mine.isOwner === false && !activeEntry) loadInvites();
      } catch (err) {
        setError(err.message || 'Could not load your store.');
      } finally {
        setLoading(false);
      }
    },
    [loadInvites, loadRoster, loadCustomerCounts],
  );

  // Switch the whole dashboard (orders, roster, storefront form) to another
  // of this account's stores.
  const switchStore = useCallback(
    (storeId) => {
      load(storeId);
    },
    [load],
  );

  useEffect(() => {
    load();
  }, [load]);

  // Keep the switcher list fresh without wiping the active dashboard: the
  // session (AuthContext) already carries every store, so merge it in. This
  // guarantees every store's landing-page link is visible even if
  // `/stores/mine/all` failed on first load.
  useEffect(() => {
    if (!Array.isArray(sessionStores) || sessionStores.length === 0) return;
    setMyStores((prev) => {
      const seen = new Set(prev.map((entry) => storeKey(entry.store)));
      const merged = [...prev];
      for (const entry of sessionStores) {
        if (!entry?.store || seen.has(storeKey(entry.store))) continue;
        seen.add(storeKey(entry.store));
        merged.push(entry);
      }
      return merged;
    });
  }, [sessionStores]);

  // Live-refresh without a manual click, so "rider accepted but status still
  // shows old / undefined" can never go stale on screen:
  //  - `order:new` now also fires when a rider claims or advances an order
  //    (server pings the store owner + members), so re-fetch orders + roster.
  //  - `order:status:updated` patches the visible row immediately even before
  //    the re-fetch lands.
  const refreshOrders = useCallback(async () => {
    try {
      const [orderList, links] = await Promise.all([
        storeService.listStoreOrders(storeIdRef.current || undefined),
        storeIdRef.current
          ? storeService.listStoreRiders(storeIdRef.current).catch(() => null)
          : Promise.resolve(null),
      ]);
      setOrders(orderList);
      if (Array.isArray(links)) {
        setRiders(links.filter((link) => link.role !== 'admin'));
        setMembers(links);
      }
    } catch {
      // Best-effort live refresh - the last fetched lists stay on screen.
    }
  }, []);

  const newOrderCountRef = useRef(0);
  useEffect(() => {
    const count = Object.keys(newOrders || {}).length;
    if (count > newOrderCountRef.current) refreshOrders();
    newOrderCountRef.current = count;
  }, [newOrders, refreshOrders]);

  useEffect(() => {
    const entries = Object.entries(statusUpdates || {});
    if (entries.length === 0) return;
    setOrders((prev) =>
      prev.map((order) => {
        const id = String(order._id || order.id);
        const live = statusUpdates[id];
        return live?.status ? { ...order, status: live.status } : order;
      }),
    );
  }, [statusUpdates]);

  const saveStore = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');

    try {
      // Target the ACTIVE store so saving while viewing a second storefront
      // edits that store, not the primary one.
      const updated = await storeService.updateMyStore(
        {
          name: form.name,
          description: form.description,
          phone: form.phone,
          image: form.image,
          address: { line1: form.line1, city: form.city },
        },
        storeIdRef.current || undefined,
      );

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

      await load(storeIdRef.current || undefined);
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
        <button type="button" className="btn btn-outline" onClick={() => load()}>
          Try again
        </button>
      </div>
    );
  }

  // "Still live" means not finished, and an order the customer has confirmed
  // receiving is finished - so it must drop off this board, not sit here
  // looking like work still to do.
  const liveOrders = orders.filter(
    (order) => !CLOSED_STATUSES.includes(order.status),
  );

  const activeStoreId = storeIdRef.current
    ? String(storeIdRef.current)
    : String(store?._id || store?.id || '');
  // Full public URL for copy/share: origin + /s/<slug>. Falls back to the
  // relative landing-page path when the slug is missing.
  const storeUrl = (entry) => {
    const slug = entry?.slug || '';
    if (typeof window !== 'undefined' && window.location?.origin && slug) {
      return `${window.location.origin}${shopPath(slug)}`;
    }
    return slug ? shopPath(slug) : '#';
  };

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
        <div className="button-row">
          {/* Store switcher, only once the account actually runs more than
              one store - the full "My storefronts" list used to live here. */}
          {myStores.length > 1 ? (
            <label className="field field--inline">
              <span>Store</span>
              <select
                value={activeStoreId}
                onChange={(event) => switchStore(event.target.value)}
              >
                {myStores.map((entry) => {
                  const entryStore = entry.store || {};
                  return (
                    <option
                      key={storeKey(entryStore) || entryStore.slug}
                      value={String(entryStore._id || entryStore.id || '')}
                    >
                      {entryStore.name || 'Unnamed store'}
                    </option>
                  );
                })}
              </select>
            </label>
          ) : null}
          {store.slug ? (
            <a
              className="btn btn-outline btn-sm"
              href={storeUrl(store)}
              target="_blank"
              rel="noreferrer"
            >
              Open landing page
            </a>
          ) : null}
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => load(storeIdRef.current || undefined)}
          >
            Refresh
          </button>
        </div>
      </header>

      {notice ? <p className="alert alert--ok">{notice}</p> : null}
      {error ? <p className="alert alert--danger">{error}</p> : null}

      <div className="stats">
        <div className="stat">
          <Link className="stat stat--link" to={ROUTES.MERCHANT_ORDERS}>
            <strong>{orders.length}</strong>
            <span className="stat__label">Total orders</span>
          </Link>
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
          <Link className="stat stat--link" to={ROUTES.MERCHANT_CUSTOMERS}>
            <strong>{customersMeta.total}</strong>
            <span className="stat__label">
              Customers
              {customersMeta.newThisWeek > 0
                ? ` (+${customersMeta.newThisWeek} this week)`
                : ''}
            </span>
          </Link>
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
              {riders.map((link) => {
                // `link.status` is the invitation state (pending/active/...),
                // never the delivery state. When the row arrives without it
                // (stale cache / partial payload) fall back to `pending`
                // instead of rendering a bare "undefined" badge.
                const linkStatus = link.status || STORE_RIDER_STATUS.PENDING;
                const handle =
                  link.rider?.username ||
                  link.rider?.name ||
                  link.rider?.email ||
                  'rider';
                return (
                <tr key={link._id || link.id}>
                  <td className="table__product">
                    <strong>@{handle}</strong>
                    <span className="muted small">
                      {link.rider?.name || link.rider?.email || ''}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`badge badge--${
                        linkStatus === STORE_RIDER_STATUS.ACTIVE
                          ? 'success'
                          : linkStatus === STORE_RIDER_STATUS.PENDING
                            ? 'warn'
                            : 'info'
                      }`}
                    >
                      {STORE_RIDER_STATUS_LABELS[linkStatus] || linkStatus}
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
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      ) : null}

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

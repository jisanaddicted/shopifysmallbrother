import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import LoadingSpinner from '../../components/common/LoadingSpinner';
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
  const [store, setStore] = useState(null);
  const [riders, setRiders] = useState([]);
  const [orders, setOrders] = useState([]);
  const [form, setForm] = useState(BLANK_FORM);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);

  // Rider roster controls
  const [term, setTerm] = useState('');
  const [results, setResults] = useState([]);
  const [rosterBusy, setRosterBusy] = useState(false);
  const [rosterError, setRosterError] = useState('');

  const flash = (message) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 3500);
  };

  const loadRoster = useCallback(async (storeId) => {
    try {
      const links = await storeService.listStoreRiders(storeId);
      setRiders(links);
    } catch (err) {
      setRosterError(err.message || 'Could not load the rider roster.');
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
      setRiders(mine.riders || []);
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
    } catch (err) {
      setError(err.message || 'Could not load your store.');
    } finally {
      setLoading(false);
    }
  }, []);

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

  const searchRiders = async (event) => {
    event.preventDefault();
    setRosterError('');

    try {
      const found = await storeService.searchRiders(term);
      setResults(found);

      if (found.length === 0) {
        setRosterError(`No rider matched “${term}”. Check the spelling.`);
      }
    } catch (err) {
      setRosterError(err.message || 'The search failed.');
    }
  };

  const invite = async (username) => {
    setRosterBusy(true);
    setRosterError('');

    try {
      await storeService.inviteRider(store._id, username);
      await loadRoster(store._id);
      setResults((prev) => prev.filter((r) => r.username !== username));
      flash(`Invitation sent to @${username}. They accept it in their console.`);
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

      {/* ---- Rider roster ------------------------------------------------ */}
      <section className="panel">
        <div className="panel__header">
          <h2 className="panel__title">Riders</h2>
          <span className="muted small">
            Find a rider by the username they signed up with.
          </span>
        </div>

        <form className="filters" onSubmit={searchRiders}>
          <input
            type="search"
            className="filters__search"
            placeholder="e.g. speedyrider"
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

        {results.length > 0 ? (
          <ul className="rider-list">
            {results.map((rider) => (
              <li key={rider._id || rider.id}>
                <div className="rider-list__item">
                  <span className="rider-list__id">@{rider.username}</span>
                  <span className="muted small">{rider.name || rider.email}</span>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={rosterBusy}
                    onClick={() => invite(rider.username)}
                  >
                    Add to this store
                  </button>
                </div>
              </li>
            ))}
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

      {/* ---- Storefront details ------------------------------------------ */}
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
    </div>
  );
}

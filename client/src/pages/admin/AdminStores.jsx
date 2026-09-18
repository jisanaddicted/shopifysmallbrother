import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import storeService from '../../services/storeService';
import {
  STORE_RIDER_STATUS,
  STORE_RIDER_STATUS_LABELS,
  shopPath,
} from '../../utils/constants';

/**
 * Admin page: every merchant on the platform, plus the power to attach a rider
 * (found by the username they signed up with) to any of those stores.
 */
export default function AdminStores() {
  const [stores, setStores] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [riders, setRiders] = useState([]);
  const [term, setTerm] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const store = stores.find((s) => (s._id || s.id) === selectedId) || null;

  const load = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const list = await storeService.listStores();
      setStores(list);
      setSelectedId(
        (current) =>
          current ?? list[0]?._id ?? list[0]?.id ?? null,
      );
    } catch (err) {
      setError(err.message || 'Could not load the stores.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRoster = useCallback(async (storeId) => {
    if (!storeId) {
      setRiders([]);
      return;
    }

    try {
      const links = await storeService.listStoreRiders(storeId);
      setRiders(links);
    } catch (err) {
      setError(err.message || 'Could not load that roster.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadRoster(selectedId);
  }, [selectedId, loadRoster]);

  const search = async (event) => {
    event.preventDefault();
    setError('');

    try {
      const found = await storeService.searchRiders(term);
      setResults(found);

      if (found.length === 0) {
        setError(`No rider matched “${term}”.`);
      }
    } catch (err) {
      setError(err.message || 'The search failed.');
    }
  };

  const invite = async (username) => {
    setBusy(true);
    setError('');

    try {
      await storeService.inviteRider(selectedId, username);
      await loadRoster(selectedId);
      setResults((prev) => prev.filter((r) => r.username !== username));
    } catch (err) {
      setError(err.message || 'Could not attach that rider.');
    } finally {
      setBusy(false);
    }
  };

  const removeRider = async (riderId) => {
    setBusy(true);
    setError('');

    try {
      await storeService.removeStoreRider(selectedId, riderId);
      await loadRoster(selectedId);
    } catch (err) {
      setError(err.message || 'Could not remove that rider.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingSpinner fullPage label="Loading stores…" />;

  if (stores.length === 0) {
    return (
      <div className="page">
        <h1>Stores</h1>
        <p className="empty">
          No merchant has signed up yet. Store accounts register at /register.
        </p>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1>Stores</h1>
          <p className="muted">
            Pick a store, search a rider by username, attach them to it.
          </p>
        </div>
        <button type="button" className="btn btn-outline btn-sm" onClick={load}>
          Refresh
        </button>
      </header>

      {error ? <p className="alert alert--danger">{error}</p> : null}

      <div className="filters">
        <select
          className="filters__select"
          value={selectedId || ''}
          onChange={(event) => setSelectedId(event.target.value || null)}
        >
          {stores.map((option) => (
            <option key={option._id || option.id} value={option._id || option.id}>
              {option.name}
            </option>
          ))}
        </select>

        {store ? (
          <span className="muted small">
            Public page: <Link to={shopPath(store.slug)}>/s/{store.slug}</Link>
          </span>
        ) : null}
      </div>

      <section className="panel">
        <div className="panel__header">
          <h2 className="panel__title">
            {store ? `Riders of ${store.name}` : 'Riders'}
          </h2>
        </div>

        <form className="filters" onSubmit={search}>
          <input
            type="search"
            className="filters__search"
            placeholder="Rider username…"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
          />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy || term.trim().length === 0 || !selectedId}
          >
            Search
          </button>
        </form>

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
                    disabled={busy}
                    onClick={() => invite(rider.username)}
                  >
                    Add to this store
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        {riders.length === 0 ? (
          <p className="empty">No riders attached yet.</p>
        ) : (
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
                        disabled={busy}
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
        )}
      </section>
    </div>
  );
}

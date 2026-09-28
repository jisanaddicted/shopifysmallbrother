import { useCallback, useEffect, useMemo, useState } from 'react';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import { useAuth } from '../../context/AuthContext';
import storeService from '../../services/storeService';
import {
  STORE_CUSTOMER_STATUS,
  STORE_CUSTOMER_STATUS_LABELS,
} from '../../utils/constants';
import { formatCurrency, initials } from '../../utils/formatters';

/**
 * Everyone who shops at this store, as a full page in the side rail.
 *
 * This replaces the customer table that used to sit halfway down "My store".
 * It was not a shortage of space that moved it - the same data was on screen
 * before - it was that a list of people is something a merchant returns to and
 * searches, not something they scroll past once while looking for the team
 * panel.
 *
 * The two right-hand columns are why this is a page and not a card: "orders" and
 * "amount spent" are how a merchant ranks customers, and the server rolls both
 * up per customer so the ordering can be a real sort rather than a guess.
 */

// Customers arrive newest-first from the server, which is the useful default,
// but "biggest spender" is the question this page exists to answer, so it gets
// a real sort instead of being left to the API.
const SORTS = [
  { value: 'recent', label: 'Recently joined' },
  { value: 'spent', label: 'Most spent' },
  { value: 'orders', label: 'Most orders' },
  { value: 'name', label: 'Name A–Z' },
];

/** The name to show: their chosen name, else the handle, else the email. */
const displayName = (customer) =>
  customer?.name || customer?.username || customer?.email || 'Customer';

export default function StoreCustomers() {
  const { stores: sessionStores } = useAuth();
  const [entries, setEntries] = useState([]);
  const [stores, setStores] = useState([]);
  const [storeId, setStoreId] = useState('');
  const [term, setTerm] = useState('');
  const [sort, setSort] = useState('recent');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // The store switcher, as on the orders board - the list is always one store's.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const mine = await storeService.listMyMerchantStores();
        if (!alive) return;
        const list = Array.isArray(mine) ? mine : mine?.stores || [];
        setStores(list);
        setStoreId(
          (current) => current || list[0]?.store?._id || list[0]?._id || '',
        );
      } catch {
        if (!alive) return;
        const fallback = (sessionStores || []).map((entry) => ({
          store: entry.store || entry,
        }));
        setStores(fallback);
        setStoreId((current) => current || fallback[0]?.store?._id || '');
      }
    })();
    return () => {
      alive = false;
    };
  }, [sessionStores]);

  const load = useCallback(async () => {
    if (!storeId) {
      setEntries([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await storeService.listStoreCustomers(storeId);
      setEntries(data?.customers || []);
    } catch (err) {
      setError(err.message || 'Could not load your customers.');
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => {
    const needle = term.trim().toLowerCase();

    const filtered = entries.filter((entry) => {
      if (!needle) return true;
      const customer = entry.customer || {};
      return [customer.name, customer.email, customer.username, customer.phone]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(needle);
    });

    const sorted = [...filtered];
    if (sort === 'spent') {
      sorted.sort((a, b) => (b.spent || 0) - (a.spent || 0));
    } else if (sort === 'orders') {
      sorted.sort((a, b) => (b.orders || 0) - (a.orders || 0));
    } else if (sort === 'name') {
      sorted.sort((a, b) =>
        displayName(a.customer).localeCompare(displayName(b.customer)),
      );
    } else {
      // "Recently joined" - the server already returns them newest first, so
      // this is just the stable default when the list is unsorted.
      sorted.sort(
        (a, b) =>
          new Date(b.joinedAt || 0).getTime() -
          new Date(a.joinedAt || 0).getTime(),
      );
    }
    return sorted;
  }, [entries, term, sort]);

  const exportCsv = () => {
    const header = ['Name', 'Email', 'Phone', 'Location', 'Orders', 'Amount spent'];
    const rows = visible.map((entry) => {
      const customer = entry.customer || {};
      return [
        displayName(customer),
        customer.email || '',
        customer.phone || '',
        entry.location || '',
        entry.orders || 0,
        entry.spent || 0,
      ];
    });

    const escape = (value) => `"${String(value).replace(/"/g, '""')}"`;
    const csv = [header, ...rows]
      .map((row) => row.map(escape).join(','))
      .join('\r\n');

    const url = URL.createObjectURL(
      new Blob([csv], { type: 'text/csv;charset=utf-8' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `customers-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const totalSpent = visible.reduce((sum, entry) => sum + (entry.spent || 0), 0);

  if (loading) return <LoadingSpinner label="Loading customers…" />;

  return (
    <div className="customers">
      <header className="customers__head">
        <h1 className="customers__title">Customers</h1>

        <div className="customers__head-actions">
          {stores.length > 1 ? (
            <select
              className="input"
              value={storeId}
              onChange={(event) => setStoreId(event.target.value)}
              aria-label="Choose a store"
            >
              {stores.map((entry) => {
                const store = entry.store || entry;
                return (
                  <option key={store._id} value={store._id}>
                    {store.name}
                  </option>
                );
              })}
            </select>
          ) : null}

          <select
            className="input"
            value={sort}
            onChange={(event) => setSort(event.target.value)}
            aria-label="Sort customers"
          >
            {SORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={exportCsv}
            disabled={!visible.length}
          >
            Export
          </button>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={load}
          >
            Refresh
          </button>
        </div>
      </header>

      {error ? <p className="alert alert--danger">{error}</p> : null}

      <div className="orders__filters">
        <div className="orders__search">
          <span aria-hidden="true">🔍</span>
          <input
            type="search"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Search customers"
            aria-label="Search customers"
          />
        </div>
      </div>

      {visible.length ? (
        <>
          <div className="table-wrap">
            <table className="table customers__table">
              <thead>
                <tr>
                  <th>Customer name</th>
                  <th>Email</th>
                  <th>Location</th>
                  <th>Status</th>
                  <th className="orders__num">Orders</th>
                  <th className="orders__num">Amount spent</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((entry) => {
                  const customer = entry.customer || {};
                  const blocked = entry.status === STORE_CUSTOMER_STATUS.BLOCKED;

                  return (
                    <tr key={customer._id || entry.id}>
                      <td>
                        <span className="customers__who">
                          <span className="avatar avatar--sm" aria-hidden="true">
                            {initials(displayName(customer))}
                          </span>
                          <span>
                            <strong>{displayName(customer)}</strong>
                            {customer.username ? (
                              <span className="muted small block">
                                @{customer.username}
                              </span>
                            ) : null}
                          </span>
                        </span>
                      </td>
                      <td className="muted small">
                        {customer.email || '—'}
                      </td>
                      <td className="muted small">
                        {entry.location || '—'}
                      </td>
                      <td>
                        <span
                          className={`badge badge--${blocked ? 'danger' : 'success'}`}
                        >
                          {STORE_CUSTOMER_STATUS_LABELS[entry.status] ||
                            'Active'}
                        </span>
                      </td>
                      <td className="orders__num">{entry.orders || 0}</td>
                      <td className="price orders__num nowrap">
                        {formatCurrency(entry.spent || 0)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="muted small orders__count">
            {visible.length} customer{visible.length === 1 ? '' : 's'} ·{' '}
            {formatCurrency(totalSpent)} spent in total
          </p>
        </>
      ) : (
        <div className="card empty">
          <p className="muted">
            {entries.length
              ? 'No customers match that search.'
              : 'No customers yet. Anyone who signs up or orders from your store shows up here.'}
          </p>
        </div>
      )}
    </div>
  );
}

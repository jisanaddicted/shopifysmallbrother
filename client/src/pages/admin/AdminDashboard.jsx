import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import orderService from '../../services/orderService';
import {
  ORDER_STATUS,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_TONE,
  adminOrderPath,
} from '../../utils/constants';
import {
  formatCurrency,
  formatDateTime,
  formatStatus,
} from '../../utils/formatters';

const STATUS_FILTERS = ['all', ...Object.values(ORDER_STATUS)];

// --- Date range filter -------------------------------------------------------
// A date input hands back a bare "YYYY-MM-DD" with no timezone, so both bounds
// are built in the *viewer's* local calendar. Comparing against
// `new Date('2026-09-27')` would parse that as UTC midnight instead, which
// silently drops or double-counts orders for anyone not on UTC. `endOfDay` is
// what makes "To: 27 Sep" include an order placed at 23:50 that same evening.

/** First millisecond of the given local day. */
const startOfDay = (value) => new Date(`${value}T00:00:00.000`);

/** Last millisecond of the given local day (inclusive). */
const endOfDay = (value) => new Date(`${value}T23:59:59.999`);

/** A Date as "YYYY-MM-DD" in local time — toISOString() would shift the day. */
const toInputDate = (date) => {
  const pad = (n) => String(n).padStart(2, '0');

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}`;
};

/** Shortcuts that fill the two date boxes. "7" counts today itself. */
const RANGE_PRESETS = [
  { value: 'all', label: 'All time' },
  { value: 'today', label: 'Today' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
];

export default function AdminDashboard() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // The board opens on what the desk actually works: today's orders that are
  // still Pending. Both filters are seeded, not just the selects - the date
  // boxes show today's range so what is in force is visible, which is why the
  // `preset` and the two date values have to agree from the first render.
  const [filter, setFilter] = useState(ORDER_STATUS.PENDING);
  const [preset, setPreset] = useState('today');
  const [dateFrom, setDateFrom] = useState(() => toInputDate(new Date()));
  const [dateTo, setDateTo] = useState(() => toInputDate(new Date()));

  const loadBoard = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const orderList = await orderService.getAllOrders();
      setOrders(Array.isArray(orderList) ? orderList : []);
    } catch (err) {
      setError(err.message || 'Could not load the orders board.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBoard();
  }, [loadBoard]);

  const clearDates = () => {
    setPreset('all');
    setDateFrom('');
    setDateTo('');
  };

  // A preset fills the two date boxes rather than being applied on its own, so
  // the range actually in force is always visible — and can then be nudged by
  // hand (which switches the select to "Custom range").
  const applyPreset = (value) => {
    if (value === 'all' || value === 'custom') {
      clearDates();
      return;
    }

    const to = new Date();
    const from = new Date();
    if (value === 'today') {
      from.setHours(0, 0, 0, 0);
    } else {
      from.setDate(from.getDate() - (Number(value) - 1));
      from.setHours(0, 0, 0, 0);
    }

    setPreset(value);
    setDateFrom(toInputDate(from));
    setDateTo(toInputDate(to));
  };

  const hasDateFilter = Boolean(dateFrom || dateTo);

  const visible = useMemo(() => {
    // Either bound may be empty on its own — "everything from 27 Sep onwards"
    // is a legitimate filter, so neither is assumed.
    const from = dateFrom ? startOfDay(dateFrom).getTime() : null;
    const to = dateTo ? endOfDay(dateTo).getTime() : null;

    return orders.filter((order) => {
      if (filter !== 'all' && order.status !== filter) return false;
      if (from === null && to === null) return true;

      const placed = new Date(order.createdAt).getTime();
      if (!Number.isFinite(placed)) return false;
      if (from !== null && placed < from) return false;
      if (to !== null && placed > to) return false;

      return true;
    });
  }, [orders, filter, dateFrom, dateTo]);

  const stats = useMemo(() => {
    const isOpen = (order) =>
      order.status !== ORDER_STATUS.DELIVERED &&
      order.status !== ORDER_STATUS.CANCELLED;

    return {
      total: orders.length,
      active: orders.filter(isOpen).length,
      unassigned: orders.filter((order) => isOpen(order) && !order.rider).length,
      delivered: orders.filter(
        (order) => order.status === ORDER_STATUS.DELIVERED,
      ).length,
      revenue: orders
        .filter((order) => order.status === ORDER_STATUS.DELIVERED)
        .reduce((sum, order) => sum + (Number(order.total) || 0), 0),
    };
  }, [orders]);

  const riderName = (order) =>
    order.rider?.name || (order.rider ? 'Rider' : 'Awaiting rider');

  if (loading) {
    return <LoadingSpinner fullPage label="Loading the orders board…" />;
  }

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1>Orders</h1>
          <p className="muted">
            Riders are notified automatically - they accept each delivery from
            their own console.
          </p>
        </div>

        <button
          type="button"
          className="btn btn-outline btn-sm"
          onClick={loadBoard}
        >
          Refresh
        </button>
      </header>

      {error ? <p className="alert alert--danger">{error}</p> : null}

      <div className="stats">
        <div className="stat">
          <span className="stat__label">Orders</span>
          <strong>{stats.total}</strong>
        </div>
        <div className="stat">
          <span className="stat__label">In progress</span>
          <strong>{stats.active}</strong>
        </div>
        <div className="stat stat--warn">
          <span className="stat__label">Needs a rider</span>
          <strong>{stats.unassigned}</strong>
        </div>
        <div className="stat stat--ok">
          <span className="stat__label">Delivered</span>
          <strong>{stats.delivered}</strong>
        </div>
        <div className="stat">
          <span className="stat__label">Revenue</span>
          <strong>{formatCurrency(stats.revenue)}</strong>
        </div>
      </div>

      <div className="filters">
        <label className="field field--inline">
          <span>Status</span>
          <select value={filter} onChange={(event) => setFilter(event.target.value)}>
            {STATUS_FILTERS.map((status) => (
              <option key={status} value={status}>
                {status === 'all'
                  ? 'All statuses'
                  : ORDER_STATUS_LABELS[status] || status}
              </option>
            ))}
          </select>
        </label>

        <label className="field field--inline">
          <span>Placed</span>
          <select value={preset} onChange={(event) => applyPreset(event.target.value)}>
            {RANGE_PRESETS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
            {/* Only offered while a hand-picked range is in force, so the select
                can never report "All time" while dates are still applied. */}
            {preset === 'custom' ? (
              <option value="custom">Custom range</option>
            ) : null}
          </select>
        </label>

        <label className="field field--inline">
          <span>From</span>
          <input
            type="date"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(event) => {
              setDateFrom(event.target.value);
              setPreset('custom');
            }}
          />
        </label>

        <label className="field field--inline">
          <span>To</span>
          <input
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(event) => {
              setDateTo(event.target.value);
              setPreset('custom');
            }}
          />
        </label>

        {hasDateFilter ? (
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={clearDates}
          >
            Clear dates
          </button>
        ) : null}
      </div>

      {hasDateFilter ? (
        <p className="muted small">
          Showing {visible.length} of {orders.length} orders placed between{' '}
          {dateFrom ? startOfDay(dateFrom).toLocaleDateString() : 'the start'} and{' '}
          {dateTo ? endOfDay(dateTo).toLocaleDateString() : 'now'}.
        </p>
      ) : null}

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Placed</th>
              <th>Drop-off</th>
              <th>Status</th>
              <th>Rider</th>
              <th>Total</th>
            </tr>
          </thead>

          <tbody>
            {visible.map((order) => {
              const id = order._id || order.id;
              const assignedId =
                order.rider?._id || order.rider?.id || order.rider || '';

              return (
                <tr key={id}>
                  <td>
                    {/* Stays inside /admin so the side rail is still there when
                        the details open (the customer /track/:id route is
                        outside the shell and swaps the rail for the navbar). */}
                    <Link className="link-btn" to={adminOrderPath(id)}>
                      #{String(id).slice(-6).toUpperCase()}
                    </Link>
                  </td>

                  <td className="muted small">
                    {formatDateTime(order.createdAt)}
                  </td>

                  <td>
                    <span>{order.address?.line1 || '—'}</span>
                    {order.address?.city ? (
                      <span className="muted small block">
                        {order.address.city}
                      </span>
                    ) : null}
                  </td>

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
                    {order.rider ? (
                      <span>{riderName(order)}</span>
                    ) : (
                      <span className="muted small">
                        Notified · waiting for a rider to accept
                      </span>
                    )}
                  </td>

                  <td>{formatCurrency(order.total)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {visible.length === 0 ? (
          <p className="empty">No orders match this filter yet.</p>
        ) : null}
      </div>
    </div>
  );
}
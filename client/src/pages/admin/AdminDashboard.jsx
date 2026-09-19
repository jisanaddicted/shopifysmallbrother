import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import orderService from '../../services/orderService';
import {
  ORDER_STATUS,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_TONE,
  orderTrackerPath,
} from '../../utils/constants';
import {
  formatCurrency,
  formatDateTime,
  formatStatus,
} from '../../utils/formatters';

const STATUS_FILTERS = ['all', ...Object.values(ORDER_STATUS)];

export default function AdminDashboard() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');

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

  const visible = useMemo(() => {
    if (filter === 'all') return orders;
    return orders.filter((order) => order.status === filter);
  }, [orders, filter]);

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
      </div>

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
                    <Link className="link-btn" to={orderTrackerPath(id)}>
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
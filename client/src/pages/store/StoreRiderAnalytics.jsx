import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import orderService from '../../services/orderService';
import { ROUTES } from '../../utils/constants';
import {
  formatCurrency,
  formatDateTime,
  formatDurationMs,
  formatStatus,
} from '../../utils/formatters';

/**
 * Rider analytics for the store dashboard: how long this store's deliveries
 * take, and who is responsible for the slow parts.
 *
 * Split by who owned the wait, because "the order took 50 minutes" is not
 * actionable until you know whether the kitchen was slow or the ride was:
 *
 *   placed ---- ready for pickup == picked up ---- delivered
 *     prep (store)   |  wait (rider)  |  ride (rider) |
 *
 * Every figure arrives computed by the server from the orders' own
 * statusHistory (see summariseTimings / summariseByRider in
 * backend/src/utils/deliveryTiming.js), so this page is a record of what
 * happened rather than a counter that could drift.
 */

/**
 * How much of a whole delivery one stage takes, as a percentage for the bar.
 *
 * Drawn against the average *delivery* rather than the longest stage, so the
 * bars together read as one order's worth of time. A stage that never happened
 * gets no bar instead of a misleading sliver.
 */
function legShare(value, avgTotalMs) {
  if (!Number.isFinite(value) || !Number.isFinite(avgTotalMs) || avgTotalMs <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(2, Math.round((value / avgTotalMs) * 100)));
}

export default function StoreRiderAnalytics() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await orderService.getStoreAnalytics());
    } catch (err) {
      setError(err.message || 'Could not load your delivery numbers.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return <LoadingSpinner fullPage label="Working out your numbers…" />;
  }

  const summary = data?.summary || {};
  const rows = data?.orders || [];
  const riders = data?.riders || [];
  const finished = data?.delivered || 0;
  const storeName = data?.store?.name || 'your store';

  const legs = [
    { key: 'prepMs', label: 'Store prep', hint: 'order placed → ready' },
    { key: 'waitMs', label: 'Waited at counter', hint: 'ready → picked up' },
    { key: 'rideMs', label: 'Ride time', hint: 'picked up → delivered' },
  ];

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1>Rider analytics</h1>
          <p className="muted">
            {finished} delivered · {data?.open || 0} in progress
            {finished
              ? ` · last ${data?.window || rows.length} orders of ${storeName}`
              : ''}
          </p>
        </div>

        <div className="button-row">
          <button type="button" className="btn btn-outline btn-sm" onClick={load}>
            Refresh
          </button>
          <Link to={ROUTES.MERCHANT_DASHBOARD} className="btn btn-ghost btn-sm">
            Back to store
          </Link>
        </div>
      </header>

      {error ? <p className="alert alert--danger">{error}</p> : null}

      {finished === 0 ? (
        <section className="panel">
          <p className="empty">
            No finished deliveries yet. Once an order reaches the doorstep, the
            time each stage took shows up here.
          </p>
        </section>
      ) : (
        <>
          {/* --- Headline numbers ------------------------------------------- */}
          <section className="stats timing-stats">
            <div className="stat">
              <span className="stat__label">Avg delivery</span>
              <strong>{formatDurationMs(summary.avgTotalMs)}</strong>
              <span className="muted small">order → doorstep</span>
            </div>

            <div className="stat">
              <span className="stat__label">Avg prep</span>
              <strong>{formatDurationMs(summary.avgPrepMs)}</strong>
              <span className="muted small">the store&apos;s part</span>
            </div>

            <div className="stat">
              <span className="stat__label">Avg ride time</span>
              <strong>{formatDurationMs(summary.avgRideMs)}</strong>
              <span className="muted small">the rider&apos;s part</span>
            </div>

            <div className="stat">
              <span className="stat__label">Fastest</span>
              <strong>{formatDurationMs(summary.bestMs)}</strong>
              <span className="muted small">best run</span>
            </div>

            <div
              className={`stat ${
                summary.onTimePct === null
                  ? ''
                  : summary.onTimePct >= 80
                    ? 'stat--ok'
                    : 'stat--warn'
              }`}
            >
              <span className="stat__label">Under 45 min</span>
              <strong>
                {summary.onTimePct === null ? '—' : `${summary.onTimePct}%`}
              </strong>
              <span className="muted small">
                {summary.onTime} of {finished}
              </span>
            </div>
          </section>
          {/* --- Where the time goes --------------------------------------- */}
          <section className="panel">
            <div className="panel__header">
              <div>
                <h2 className="panel__title">Where the time goes</h2>
                <p className="panel__subtitle">
                  Average of your {finished} delivered order(s), split by who
                  owned the wait.
                </p>
              </div>
            </div>

            <ul className="legs">
              {legs.map((leg) => {
                const value = summary[leg.key];

                return (
                  <li key={leg.key} className="leg">
                    <span className="leg__label">
                      {leg.label}
                      <span className="muted small block">{leg.hint}</span>
                    </span>

                    {/* Scaled against the whole delivery, so the three bars add
                        up to the length of the average order. */}
                    <span className="leg__track">
                      <span
                        className="leg__fill"
                        style={{
                          width: `${legShare(value, summary.avgTotalMs)}%`,
                        }}
                      />
                    </span>

                    <strong className="leg__value">
                      {formatDurationMs(value)}
                    </strong>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* --- Per rider -------------------------------------------------- */}
          <section className="panel">
            <div className="panel__header">
              <div>
                <h2 className="panel__title">Every rider</h2>
                <p className="panel__subtitle">
                  The same deliveries, grouped by who carried them. Averages
                  cover that rider&apos;s finished deliveries only.
                </p>
              </div>
            </div>

            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Rider</th>
                    <th>Delivered</th>
                    <th>In progress</th>
                    <th>Avg prep</th>
                    <th>Avg wait</th>
                    <th>Avg ride</th>
                    <th>Avg delivery</th>
                  </tr>
                </thead>

                <tbody>
                  {riders.map((row) => (
                    <tr key={row.riderId || 'unassigned'}>
                      <td>
                        <strong>{row.name}</strong>
                        {row.username ? (
                          <span className="muted small block">
                            @{row.username}
                          </span>
                        ) : null}
                      </td>

                      <td>{row.delivered}</td>
                      <td>{row.open}</td>

                      {/* A rider with no finished delivery has nothing to
                          average - an em dash, never a misleading 0. */}
                      <td>
                        {row.delivered
                          ? formatDurationMs(row.summary.avgPrepMs)
                          : '—'}
                      </td>
                      <td>
                        {row.delivered
                          ? formatDurationMs(row.summary.avgWaitMs)
                          : '—'}
                      </td>
                      <td>
                        {row.delivered
                          ? formatDurationMs(row.summary.avgRideMs)
                          : '—'}
                      </td>

                      <td>
                        <strong>
                          {row.delivered
                            ? formatDurationMs(row.summary.avgTotalMs)
                            : '—'}
                        </strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {riders.length === 0 ? (
                <p className="empty">No deliveries yet.</p>
              ) : null}
            </div>
          </section>
          {/* --- Every delivery -------------------------------------------- */}
          <section className="panel">
            <div className="panel__header">
              <div>
                <h2 className="panel__title">Every delivery</h2>
                <p className="panel__subtitle">
                  Newest first. Times are measured from the order&apos;s own
                  status history.
                </p>
              </div>
            </div>

            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Rider</th>
                    <th>Status</th>
                    <th>Prep</th>
                    <th>Waited</th>
                    <th>Ride</th>
                    <th>Total</th>
                    <th>Value</th>
                    <th>Placed</th>
                  </tr>
                </thead>

                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <Link
                          to={ROUTES.ORDER_TRACKER.replace(
                            ':orderId',
                            row.id,
                          )}
                        >
                          #{String(row.id).slice(-6).toUpperCase()}
                        </Link>
                      </td>

                      <td className="muted">{row.riderName || '—'}</td>

                      <td>
                        <span
                          className={`chip${
                            row.isDelivered
                              ? ''
                              : row.isCancelled
                                ? ' chip--danger'
                                : ' chip--warn'
                          }`}
                        >
                          {formatStatus(row.status)}
                        </span>
                      </td>

                      <td>{formatDurationMs(row.prepMs)}</td>
                      <td>{formatDurationMs(row.waitMs)}</td>
                      <td>{formatDurationMs(row.rideMs)}</td>

                      <td>
                        <strong>
                          {row.isDelivered
                            ? formatDurationMs(row.totalMs)
                            : '—'}
                        </strong>
                        {row.isOpen ? (
                          <span className="muted small block">in progress</span>
                        ) : null}
                      </td>

                      <td className="muted">{formatCurrency(row.total)}</td>

                      <td className="muted small">
                        {formatDateTime(row.placedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {rows.length === 0 ? (
                <p className="empty">Nothing here yet.</p>
              ) : null}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

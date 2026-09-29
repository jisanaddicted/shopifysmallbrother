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
 * Rider analytics: how long each stage of a delivery takes.
 *
 * The backend derives every number from each order's own statusHistory, so a
 * delivery finished last month still reports exactly what it took. The three
 * legs are shown separately on purpose - "the order took 50 minutes" is not
 * actionable until you know whether the store was slow or the ride was.
 *
 *   placed ---- ready ---- picked up ---- delivered
 *     prep (store)   wait (rider)   ride (rider)
 */

/**
 * How much of a whole delivery one stage takes, as a percentage for the bar.
 *
 * A stage is drawn against the average *delivery*, not against the longest
 * stage, so the three bars together read as one order's worth of time. A stage
 * that never happened gets no bar rather than a misleading sliver.
 */
function legShare(value, avgTotalMs) {
  if (!Number.isFinite(value) || !Number.isFinite(avgTotalMs) || avgTotalMs <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(2, Math.round((value / avgTotalMs) * 100)));
}
export default function RiderAnalytics() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await orderService.getRiderAnalytics());
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
  const finished = data?.delivered || 0;

  /*
   * The three stages of a delivery, in the order they happen.
   *
   * Keys are the `summary` AVERAGES. They used to be the per-order field names
   * (`prepMs` / `waitMs` / `rideMs`), which live on the `orders[]` rows and
   * never on `summary` - so `summary[leg.key]` was always undefined and this
   * breakdown rendered as three em dashes with empty bars.
   */
  const legs = [
    { key: 'avgPrepMs', label: 'Store prep', hint: 'order placed → ready' },
    { key: 'avgWaitMs', label: 'Waited at counter', hint: 'ready → picked up' },
    { key: 'avgRideMs', label: 'Ride time', hint: 'picked up → delivered' },
  ];

  // The same cohort the three legs are averaged over, so the bars and the
  // headline "Avg delivery" figure are describing the same deliveries.
  const totalForBreakdown = Number.isFinite(summary.avgLegsTotalMs)
    ? summary.avgLegsTotalMs
    : summary.avgTotalMs;

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1>Delivery analytics</h1>
          <p className="muted">
            {finished} delivered · {data?.open || 0} in progress
            {finished ? ' · last 100 orders' : ''}
          </p>
        </div>

        <div className="button-row">
          <button type="button" className="btn btn-outline btn-sm" onClick={load}>
            Refresh
          </button>
          <Link to={ROUTES.RIDER_CONSOLE} className="btn btn-ghost btn-sm">
            Back to deliveries
          </Link>
        </div>
      </header>

      {error ? <p className="alert alert--danger">{error}</p> : null}

      {finished === 0 ? (
        <section className="panel">
          <p className="empty">
            No finished deliveries yet. Once you complete one, the time each
            stage took shows up here.
          </p>
        </section>
      ) : (
        <>
          {/* --- Headline numbers ------------------------------------------- */}
          <section className="stats timing-stats">
            <div className="stat">
              <span className="stat__label">Avg delivery</span>
              <strong>{formatDurationMs(totalForBreakdown)}</strong>
              <span className="muted small">order → doorstep</span>
            </div>

            <div className="stat">
              <span className="stat__label">Avg ride time</span>
              <strong>{formatDurationMs(summary.avgRideMs)}</strong>
              <span className="muted small">your part of it</span>
            </div>

            <div className="stat">
              <span className="stat__label">Fastest</span>
              <strong>{formatDurationMs(summary.bestMs)}</strong>
              <span className="muted small">best run</span>
            </div>

            <div className="stat">
              <span className="stat__label">Slowest</span>
              <strong>{formatDurationMs(summary.worstMs)}</strong>
              <span className="muted small">worst run</span>
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

                    {/* The bar is scaled against the whole delivery, so the
                        three bars add up to the length of the average order. */}
                    <span className="leg__track">
                      <span
                        className="leg__fill"
                        style={{
                          width: `${legShare(value, totalForBreakdown)}%`,
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

            <p className="muted small">
              A bar is only as long as that stage's share of a whole delivery,
              so a long wait at the counter is visible next to a short ride.
            </p>
          </section>

          {/* --- Every delivery -------------------------------------------- */}
          <section className="panel">
            <div className="panel__header">
              <div>
                <h2 className="panel__title">Every delivery</h2>
                <p className="panel__subtitle">
                  Newest first. Times are measured from the order's own status
                  history.
                </p>
              </div>
            </div>

            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Store</th>
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
                        {/* Stays INSIDE the rider shell (/rider/orders/:id) so
                            the side rail survives. Linking to the public
                            /track/:orderId instead dropped the rider onto the
                            top navbar. */}
                        <Link
                          to={ROUTES.RIDER_ORDER.replace(
                            ':orderId',
                            row.id,
                          )}
                        >
                          {row.store}
                        </Link>
                      </td>

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

                      <td className="muted">
                        {formatCurrency(row.total)}
                      </td>

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


import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import orderService from '../../services/orderService';
import { ROUTES } from '../../utils/constants';
import {
  ANY_DATE,
  CUSTOM_RANGE,
  DATE_OPTIONS,
  dateWindow,
  inWindow,
  isDefaultDateFilter,
} from '../../utils/dateWindow';
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

  /* The date filter, over "Every delivery" only.

     Deliberately NOT a server-side filter: the analytics response already
     carries every order this store has, so filtering here is one pass over an
     array that is in memory - no round trip, and the list never flickers while
     the filter changes. Same reasoning as the rider console's filters.

     It narrows the LIST and nothing else. The headline cards and the per-rider
     table above keep describing all time, because those figures are computed by
     the server (summariseTimings / summariseByRider) and re-deriving them here
     would produce a second set of averages that quietly disagreed with the
     first - exactly the drift this page's own header warns against. So the
     filter is labelled as being about the list, and the caption says so. */
  const [dateFilter, setDateFilter] = useState(ANY_DATE);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

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

  /* The filtered list, and whether the merchant narrowed it at all.

     ABOVE the `if (loading)` early return on purpose: a hook below it would be
     called on the first render (loading, data null) and skipped on the second
     (loaded), and React throws "Rendered fewer hooks than expected" the moment
     loading flips. Every hook in a component has to sit before any early exit.

     `placedAt` is the field the server sorts the rows by (see summariseTimings
     in backend/src/utils/deliveryTiming.js), so filtering on it is filtering on
     the same notion of "when this order happened" the list is already ordered
     by. An order with no parseable timestamp is HIDDEN rather than shown: a row
     that cannot be placed in the window cannot honestly be claimed to be inside
     it. `rows` is empty while loading, so this is simply an empty list then. */
  const allRows = data?.orders || [];
  const range = dateWindow(dateFilter, fromDate, toDate);
  const visibleRows = useMemo(
    () => (range ? allRows.filter((row) => inWindow(row.placedAt, range)) : allRows),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allRows, dateFilter, fromDate, toDate],
  );

  if (loading) {
    return <LoadingSpinner fullPage label="Working out your numbers…" />;
  }

  const summary = data?.summary || {};
  const rows = allRows;
  const riders = data?.riders || [];
  const finished = data?.delivered || 0;
  const filterActive = !isDefaultDateFilter(dateFilter, fromDate, toDate);

  const clearDates = () => {
    setDateFilter(ANY_DATE);
    setFromDate('');
    setToDate('');
  };

  /*
   * Each leg points at the AVERAGE in `summary`, not at the per-order field of
   * the same name.
   *
   * These keys used to be `prepMs` / `waitMs` / `rideMs`, which are the
   * per-order timings in the `orders[]` rows - `summary` only ever had
   * `avgPrepMs` / `avgWaitMs` / `avgRideMs`. So `summary[leg.key]` was always
   * undefined and the whole breakdown rendered as three em dashes with empty
   * bars, under a heading that claimed the time was being split up. The label
   * text was the only thing on the panel that was ever right.
   */
  const legs = [
    { key: 'avgPrepMs', label: 'Store Prep' },
    { key: 'avgWaitMs', label: 'Counter Wait' },
    { key: 'avgRideMs', label: 'Transit Time' },
  ];

  /*
   * The total the breakdown is drawn against, and the count behind it.
   *
   * `avgLegsTotalMs` is the average over the same deliveries the three legs are
   * averaged over, so the bars and the headline "Avg. Delivery Time" card are
   * describing one cohort and the parts genuinely add up to the whole. Falling
   * back to `avgTotalMs` covers a backend that predates the field, so the page
   * still renders rather than showing an em dash.
   */
  const totalForBreakdown = Number.isFinite(summary.avgLegsTotalMs)
    ? summary.avgLegsTotalMs
    : summary.avgTotalMs;

  const measuredCount = Number.isFinite(summary.measured)
    ? summary.measured
    : finished;

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1>Rider analytics</h1>

          {/*
            Scope and status are separate concerns, so they are separate
            elements: a scope label says HOW WIDE the numbers are, and the pills
            say what is in that window right now. Run together in one sentence
            the reader had to parse "72 delivered - 121 in progress - last 200
            orders" to work out which number was a count and which was a range.
          */}
          <div className="analytics-scope">
            <span className="analytics-scope__label">
              Scope: Last {data?.window || rows.length} orders
            </span>

            <div className="analytics-scope__pills">
              <span className="chip chip--ok">{finished} Delivered</span>
              <span className="chip chip--warn">
                {data?.open || 0} In Progress
              </span>
            </div>
          </div>
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
          {/*
            Five numbers on one scan line, in the order an operator asks for
            them: how long does a delivery take, then how that time splits, then
            how good is the best run, then are we holding the target.

            The subtext under each card used to explain which party owned the
            wait ("the store's part", "the rider's part"). Once the labels say
            Store Prep and Transit Time that is no longer ambiguous, and the
            extra line under every value was the first thing pushing the numbers
            out of alignment - five cards, five different heights, and the eye
            had to re-find the baseline on each one. Only the on-time card keeps
            a subtext, because "96%" alone hides its own sample size.
          */}
          <section className="stats timing-stats">
            <div className="stat">
              <span className="stat__label">Avg. Delivery Time</span>
              <strong>{formatDurationMs(totalForBreakdown)}</strong>
            </div>

            <div className="stat">
              <span className="stat__label">Avg. Store Prep</span>
              <strong>{formatDurationMs(summary.avgPrepMs)}</strong>
            </div>

            <div className="stat">
              <span className="stat__label">Avg. Transit Time</span>
              <strong>{formatDurationMs(summary.avgRideMs)}</strong>
            </div>

            <div className="stat">
              <span className="stat__label">Fastest Delivery</span>
              <strong>{formatDurationMs(summary.bestMs)}</strong>
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
              <span className="stat__label">On-Time Rate (&lt;45m)</span>
              <strong>
                {summary.onTimePct === null ? '—' : `${summary.onTimePct}%`}
              </strong>
              {/* The denominator, so the percentage is readable on its own. */}
              <span className="muted small">
                {summary.onTime} / {finished} orders
              </span>
            </div>
          </section>
          {/* --- Delivery time breakdown ------------------------------------ */}
          <section className="panel">
            <div className="panel__header">
              <div>
                <h2 className="panel__title">Delivery Time Breakdown</h2>
                {/*
                  Metadata, not a sentence. "Average of your 72 delivered
                  order(s), split by who owned the wait" repeated the panel
                  title in longer words and added a bracketed plural; all the
                  reader needs is how many deliveries the split is built from.
                */}
                <p className="panel__subtitle">
                  Based on {measuredCount} completed{' '}
                  {measuredCount === 1 ? 'delivery' : 'deliveries'}
                </p>
              </div>
            </div>

            <ul className="legs">
              {legs.map((leg) => {
                const value = summary[leg.key];

                return (
                  <li key={leg.key} className="leg">
                    <span className="leg__label">{leg.label}</span>

                    {/* Scaled against the whole delivery, so the three bars add
                        up to the length of the average order. */}
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

            {/* The time filter, in the same vocabulary as the rider console's
                (see utils/dateWindow.js), so "Last 7 days" means the same days to
                a rider and to the store owner reading the same deliveries. */}
            <div className="filters">
              <label className="field field--inline">
                <span>Placed</span>
                <select
                  value={dateFilter}
                  onChange={(event) => setDateFilter(event.target.value)}
                >
                  {DATE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              {dateFilter === CUSTOM_RANGE ? (
                <>
                  <label className="field field--inline">
                    <span>From</span>
                    <input
                      type="date"
                      value={fromDate}
                      max={toDate || undefined}
                      onChange={(event) => setFromDate(event.target.value)}
                    />
                  </label>

                  <label className="field field--inline">
                    <span>To</span>
                    <input
                      type="date"
                      value={toDate}
                      min={fromDate || undefined}
                      onChange={(event) => setToDate(event.target.value)}
                    />
                  </label>
                </>
              ) : null}

              {filterActive ? (
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={clearDates}
                >
                  Clear dates
                </button>
              ) : null}
            </div>

            {/* What the filter is doing, and - just as important - what it is NOT
                doing. The cards and the rider table above are server-computed
                over ALL time, so a merchant who narrows to 7 days must not read
                the 12-minute average above as belonging to those 7 days. */}
            <p className="muted small">
              {filterActive
                ? `Showing ${visibleRows.length} of ${rows.length} deliveries in this range. The figures above still cover every delivery.`
                : `Showing all ${rows.length} deliveries.`}
            </p>

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
                  {visibleRows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        {/* The MERCHANT order detail, not /track/:orderId.

                            /track/:orderId mounts the page as the CUSTOMER sees it,
                            so a store owner clicking a row here was dropped out of
                            the dashboard shell and shown the buyer's closing
                            sequence - "Confirm your delivery", the rating form, "Sign
                            in to rate this delivery". None of that is the store's to
                            do: `received` is the buyer's status alone, and the API
                            refuses anybody else (assertOrderOwner). It also threw
                            away the side rail for a page the store only opened to
                            read timings.

                            MERCHANT_ORDER_DETAIL keeps the shell and renders
                            variant="merchant", which carries the order, the live map
                            and the back-office timings with none of the buyer's
                            controls. StoreOrders.jsx already links here. */}
                        <Link
                          to={ROUTES.MERCHANT_ORDER_DETAIL.replace(
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

              {visibleRows.length === 0 ? (
                <p className="empty">
                  {/* Two different "nothing" cases, so the merchant is not sent
                      hunting for a missing order that is simply outside the range
                      they picked. */}
                  {rows.length === 0
                    ? 'Nothing here yet.'
                    : 'No deliveries in this range.'}
                </p>
              ) : null}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import DeliveryMap from '../../components/maps/DeliveryMap';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import storeService from '../../services/storeService';
import {
  CLOSED_STATUSES,
  ORDER_STATUS,
  ORDER_STATUS_TONE,
  ROUTES,
  STORE_RIDER_STATUS,
  STORE_RIDER_STATUS_LABELS,
  shopPath,
} from '../../utils/constants';
import {
  distanceBetween,
  formatDistance,
  formatStatus,
  timeAgo,
} from '../../utils/formatters';

// How often the "pinged 40 sec ago" labels are recomputed. Without this a page
// left open would freeze the times it first rendered with.
const TICK_MS = 15000;

/** Badge tone per store<->rider binding status. */
const ROSTER_TONE = {
  [STORE_RIDER_STATUS.ACTIVE]: 'success',
  [STORE_RIDER_STATUS.PENDING]: 'warn',
  [STORE_RIDER_STATUS.DECLINED]: 'danger',
  [STORE_RIDER_STATUS.REVOKED]: 'danger',
};

/** The orders this board is ABOUT: the ones a rider has actually set off with.
 *
 *  Deliberately `out_for_delivery` and nothing looser. The obvious looser test -
 *  "has a rider and is not finished" - also matches `preparing`,
 *  `ready_for_pickup` and `picked_up`, which are all still inside the shop: the
 *  rider is holding the bag, not riding anywhere, and putting those on a live
 *  map says they are en route when they are standing at a counter. A customer-
 *  confirmed `received` is finished too, so the pin stops being followed. */
const isOnTheRoad = (order) =>
  Boolean(order?.rider) && order?.status === ORDER_STATUS.OUT_FOR_DELIVERY;

const isOpen = (order) => !CLOSED_STATUSES.includes(order?.status);

const orderIdOf = (order) => String(order?._id || order?.id || '');

const riderIdOf = (order) =>
  String(order?.rider?._id || order?.rider?.id || order?.rider || '');

/**
 * The last GPS fix stored on the order itself. It is what keeps a rider on the
 * map after a refresh - or after they went offline mid-delivery.
 */
const storedPoint = (order) =>
  order?.riderLocation || order?.rider?.location || null;

/** "@aashish" when the rider has a username, otherwise their name. */
const riderHandle = (order) =>
  order?.rider?.username
    ? `@${order.rider.username}`
    : order?.rider?.name || 'Rider';

const shortId = (orderId) => `#${String(orderId).slice(-6).toUpperCase()}`;

/**
 * The live delivery board: every delivery that is currently moving.
 *
 * Now reached from the ADMIN panel (/admin/riders), not the store dashboard, so
 * it has to cope with three callers:
 *  - the stores this account runs come from the session (`useAuth().stores`),
 *    which is already in memory, so the picker costs no request. Without that a
 *    platform admin who runs no store would simply see nothing - and says so,
 *    instead of the "You do not have a store yet" error this page used to
 *    surface as a red alert.
 *  - `?storeId=` in the URL picks which store, and survives a refresh or a
 *    shared link, so switching does not fire a request for a page we already
 *    have.
 *  - a store owner (or an admin running one store) never sees a picker at all.
 *
 *  - the roster and the orders come from REST (`getMyStore` + `listStoreOrders`,
 *    both of which work for the owner AND for a store admin the owner appointed,
 *    AND for a platform admin appointed to run the store),
 *  - each order in progress is joined as a socket room, and the server relays
 *    every rider GPS ping to that room (see backend/src/sockets/index.js), so
 *    the pin moves with no refresh,
 *  - a rider who is offline still shows their last known position, because the
 *    order carries `riderLocation` and the user carries `location`.
 */
export default function RiderTracker() {
  const {
    connected,
    joinOrder,
    leaveOrder,
    getRiderLocation,
    statusUpdates,
    newOrders,
  } = useSocket();

  // The session's store list - `[{ store, role }]`, owner-owned first.
  const { stores } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [store, setStore] = useState(null);
  const [orders, setOrders] = useState([]);
  const [roster, setRoster] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Bumped on a timer purely so the time labels re-render (see TICK_MS).
  const [, setTick] = useState(0);

  // An account that runs no store has nothing to track. This is a normal state
  // in the admin panel - not something to render as a failure.
  const hasStore = (stores || []).length > 0;

  // The requested store, but only if this account may actually run it -
  // otherwise fall back to the primary one, so a hand-edited ?storeId= cannot
  // point the page at somebody else's shop.
  const requestedId = searchParams.get('storeId');
  const activeEntry = useMemo(() => {
    const entries = stores || [];
    if (!entries.length) return null;

    return (
      entries.find(
        (entry) => String(entry.store?._id || entry.store?.id) === requestedId,
      ) || entries[0]
    );
  }, [stores, requestedId]);

  const activeStoreId = activeEntry?.store?._id || activeEntry?.store?.id || null;

  const load = useCallback(
    async (storeId) => {
      setError('');

      // Nothing to load yet - leave the empty state in charge.
      if (!storeId) {
        setStore(null);
        setRoster([]);
        setOrders([]);
        setLoading(false);
        return;
      }

      try {
        // Two reads, both scoped to the SAME store:
        //  - getMyStore      -> the store + its team (owner, appointed store
        //    admin, or a platform admin running it)
        //  - listStoreOrders -> the orders, each with the assigned rider and the
        //    last GPS ping they reported (ORDER_POPULATE on the server).
        const [mine, orderList] = await Promise.all([
          storeService.getMyStore(storeId),
          storeService.listStoreOrders(storeId),
        ]);

        setStore(mine.store || null);
        setRoster(Array.isArray(mine.riders) ? mine.riders : []);
        setOrders(Array.isArray(orderList) ? orderList : []);
      } catch (err) {
        setError(err.message || 'Could not load the delivery board.');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    load(activeStoreId);
  }, [load, activeStoreId]);

  // Switching stores re-scopes the board, and keeps the choice in the URL.
  const switchStore = useCallback(
    (nextId) => {
      setSelectedId(null);
      setOrders([]);
      setSearchParams(nextId ? { storeId: nextId } : {});
    },
    [setSearchParams],
  );

  // Keep the "pinged N min ago" labels honest while the page stays open.
  useEffect(() => {
    const timer = window.setInterval(() => setTick((n) => n + 1), TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  // A delivery accepted, advanced or delivered elsewhere means the board on
  // this page is stale, so re-read it - the same live ping the merchant
  // dashboard uses. The ref starts null so mounting does not double-fetch.
  const pingCountRef = useRef(null);
  useEffect(() => {
    const count = Object.keys(newOrders || {}).length;
    if (pingCountRef.current !== null && count > pingCountRef.current) load();
    pingCountRef.current = count;
  }, [newOrders, load]);

  // Patch statuses that arrive over the socket before the re-fetch lands.
  useEffect(() => {
    const entries = Object.entries(statusUpdates || {});
    if (entries.length === 0) return;

    setOrders((prev) =>
      prev.map((order) => {
        const live = statusUpdates[orderIdOf(order)];
        return live?.status ? { ...order, status: live.status } : order;
      }),
    );
  }, [statusUpdates]);

  const liveOrders = useMemo(() => orders.filter(isOnTheRoad), [orders]);
  // One socket room per delivery in progress.
  const liveKey = liveOrders.map(orderIdOf).join('|');

  // The followed delivery: whatever the merchant clicked, else the first one.
  const selected =
    liveOrders.find((order) => orderIdOf(order) === selectedId) ||
    liveOrders[0] ||
    null;

  const joinedRef = useRef([]);
  const connectedRef = useRef(false);

  useEffect(() => {
    const ids = liveKey ? liveKey.split('|') : [];
    // A reconnect drops every room subscription, so re-join them all.
    if (connected && !connectedRef.current) joinedRef.current = [];
    connectedRef.current = connected;

    for (const id of ids) {
      if (!joinedRef.current.includes(id)) joinOrder(id);
    }
    for (const id of joinedRef.current) {
      if (!ids.includes(id)) leaveOrder(id);
    }

    joinedRef.current = ids;
  }, [liveKey, connected, joinOrder, leaveOrder]);

  // Never keep watching an order after the merchant leaves the page.
  useEffect(
    () => () => {
      for (const id of joinedRef.current) leaveOrder(id);
      joinedRef.current = [];
    },
    [leaveOrder],
  );

  // This session's live ping first, then the ping stored on the order.
  const pointFor = (order) =>
    getRiderLocation(orderIdOf(order)) || storedPoint(order);

  const distanceToDrop = (order) =>
    distanceBetween(pointFor(order), order.location);

  // rider id -> the delivery they are on, so the roster can show who is busy.
  const deliveryByRider = useMemo(() => {
    const map = {};
    for (const order of liveOrders) map[riderIdOf(order)] = order;
    return map;
  }, [liveOrders]);

  const waiting = orders.filter(
    (order) => isOpen(order) && !order.rider,
  ).length;
  const pinging = liveOrders.filter((order) =>
    getRiderLocation(orderIdOf(order)),
  ).length;
  const onDuty = roster.filter(
    (link) => link.status === STORE_RIDER_STATUS.ACTIVE,
  ).length;

  const selectedPing = selected ? pointFor(selected) : null;

  if (loading) {
    return <LoadingSpinner fullPage label="Loading the rider tracker…" />;
  }

  // An admin who runs no store has nothing to watch. Say what to do about it
  // rather than showing the raw "You do not have a store yet" failure.
  if (!hasStore) {
    return (
      <div className="page">
        <header className="page__header">
          <div>
            <h1>Rider tracker</h1>
            <p className="muted">
              every delivery that is moving right now, live.
            </p>
          </div>
        </header>

        <section className="panel">
          <p className="empty">
            You do not run a store yet, so there is nothing to track. A store
            owner invites you by username, and the store appears here once you
            accept the invitation.
          </p>

          <div className="button-row">
            <Link className="btn btn-outline btn-sm" to={ROUTES.ADMIN_INVITATIONS}>
              Go to invitations
            </Link>
            <Link className="btn btn-ghost btn-sm" to={ROUTES.ADMIN_DASHBOARD}>
              Back to orders
            </Link>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1>Rider tracker</h1>
          <p className="muted">
            {store?.name ? (
              <>
                <Link to={shopPath(store.slug)}>{store.name}</Link> ·{' '}
              </>
            ) : null}
            only the deliveries that are out for delivery right now, live.
          </p>
        </div>

        <div className="button-row">
          {/* Only worth showing when there is a choice to make: an admin can run
              several stores, and each one has its own riders and deliveries. */}
          {(stores || []).length > 1 ? (
            <label className="field field--inline">
              <span>Store</span>
              <select
                value={activeStoreId || ''}
                onChange={(event) => switchStore(event.target.value)}
              >
                {(stores || []).map((entry) => (
                  <option
                    key={String(entry.store?._id || entry.store?.id)}
                    value={String(entry.store?._id || entry.store?.id)}
                  >
                    {entry.store?.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <span className={`live-dot ${connected ? 'live-dot--on' : ''}`}>
            {connected ? 'Live' : 'Offline'}
          </span>
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

      <div className="stats">
        <div className="stat">
          <strong>{liveOrders.length}</strong>
          <span className="stat__label">On the road</span>
        </div>
        <div className="stat stat--ok">
          <strong>{pinging}</strong>
          <span className="stat__label">Pinging live</span>
        </div>
        <div className="stat stat--warn">
          <strong>{waiting}</strong>
          <span className="stat__label">Waiting for a rider</span>
        </div>
        <div className="stat">
          <strong>{onDuty}</strong>
          <span className="stat__label">Riders on the team</span>
        </div>
      </div>

      <div className="rider-grid">
        {/* ---- Every delivery in progress; pick one to follow ------------- */}
        <section className="panel">
          <div className="panel__header">
            <h2 className="panel__title">On the road</h2>
          </div>

          {liveOrders.length === 0 ? (
            <p className="muted">
              Nothing is out for delivery right now. A delivery appears here the
              moment a rider marks it out for delivery - new orders land on{' '}
              <Link to={ROUTES.ADMIN_DASHBOARD}>Orders</Link>.
            </p>
          ) : (
            <ul className="rider-list">
              {liveOrders.map((order) => {
                const id = orderIdOf(order);
                const remaining = distanceToDrop(order);
                const ping = pointFor(order);
                const isActive = selected ? orderIdOf(selected) === id : false;

                return (
                  <li key={id}>
                    <button
                      type="button"
                      className={`rider-list__item${
                        isActive ? ' is-active' : ''
                      }`}
                      onClick={() => setSelectedId(id)}
                    >
                      <span className="rider-list__id">{riderHandle(order)}</span>
                      <span className="muted small">
                        {shortId(id)} · {formatStatus(order.status)}
                      </span>
                      <span className="muted small">
                        {remaining === null
                          ? ping
                            ? 'Drop-off pin not set'
                            : 'Waiting for the first GPS ping…'
                          : `${formatDistance(remaining)} to the drop-off`}
                        {ping?.at ? ` · pinged ${timeAgo(ping.at)}` : ''}
                      </span>
                      <span
                        className={`badge badge--${
                          ORDER_STATUS_TONE[order.status] || 'info'
                        }`}
                      >
                        {formatStatus(order.status)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="rider-main">
          {selected ? (
            <>
              <DeliveryMap
                customerLocation={selected.location}
                riderLocation={selectedPing}
                riderLabel={riderHandle(selected)}
              />

              <div className="tracker-grid">
                <section className="panel">
                  <h2 className="panel__title">Rider</h2>

                  <p>
                    <strong>{selected.rider?.name || 'Rider'}</strong>
                    {selected.rider?.username ? (
                      <span className="muted"> @{selected.rider.username}</span>
                    ) : null}
                  </p>
                  {selected.rider?.phone ? (
                    <p className="muted small">☎ {selected.rider.phone}</p>
                  ) : null}

                  {selected.rider?.isAvailable === false ? (
                    <p className="alert alert--warn">
                      Off duty for new work - they are still finishing this
                      delivery.
                    </p>
                  ) : null}

                  {selectedPing ? (
                    <p className="muted small">
                      Last position {Number(selectedPing.lat).toFixed(5)},{' '}
                      {Number(selectedPing.lng).toFixed(5)}
                      {selectedPing.at
                        ? ` · ${timeAgo(selectedPing.at)}`
                        : ' · from their last delivery'}
                    </p>
                  ) : (
                    <p className="muted small">
                      No GPS ping yet - the pin moves as soon as their phone
                      reports a position.
                    </p>
                  )}
                </section>

                <section className="panel">
                  <h2 className="panel__title">Drop-off</h2>

                  <p>
                    <strong>{selected.address?.line1 || 'Pinned location'}</strong>
                    {selected.address?.city ? (
                      <span className="muted small block">
                        {selected.address.city}
                      </span>
                    ) : null}
                  </p>
                  {selected.address?.phone ? (
                    <p className="muted small">☎ {selected.address.phone}</p>
                  ) : null}
                  {selected.address?.notes ? (
                    <p className="muted small">“{selected.address.notes}”</p>
                  ) : null}
                  <p className="muted small">
                    {shortId(orderIdOf(selected))} ·{' '}
                    {formatStatus(selected.status)}
                  </p>

                  <Link
                    className="btn btn-outline btn-sm"
                    to={ROUTES.ADMIN_RIDER_ORDER.replace(
                      ':orderId',
                      orderIdOf(selected),
                    )}
                  >
                    Open the full timeline
                  </Link>
                </section>
              </div>
            </>
          ) : (
            <section className="panel">
              <h2 className="panel__title">Live map</h2>
              <p className="empty">
                No rider to follow yet. Once one of your team accepts a
                delivery, you can watch the pin move here in real time.
              </p>
            </section>
          )}
        </div>
      </div>

      {/* ---- The whole team, busy or idle -------------------------------- */}
      <section className="panel">
        <div className="panel__header">
          <h2 className="panel__title">Rider roster</h2>
          <span className="muted small">
            Invite or remove riders from{' '}
            <Link to={ROUTES.ADMIN_DASHBOARD}>Orders</Link>.
          </span>
        </div>

        {roster.length === 0 ? (
          <p className="muted">
            No riders are attached to this store yet. Invite them by username
            from the dashboard - they accept the invitation in the rider
            console, and then their deliveries show up here.
          </p>
        ) : (
          <ul className="rider-list">
            {roster.map((link) => {
              const person = link.rider || {};
              const delivery = deliveryByRider[String(person._id || person.id)];
              const point = delivery
                ? pointFor(delivery)
                : person.location || null;

              return (
                <li key={link._id || person._id || person.username}>
                  <div className="rider-list__item">
                    <span className="rider-list__id">
                      {person.name || 'Rider'}
                      {person.username ? ` · @${person.username}` : ''}
                    </span>

                    <span className="muted small">
                      {delivery
                        ? `Delivering ${shortId(orderIdOf(delivery))} · ${formatStatus(
                            delivery.status,
                          )}`
                        : point
                          ? `Idle · last seen ${Number(point.lat).toFixed(4)}, ${Number(
                              point.lng,
                            ).toFixed(4)}`
                          : 'Idle · no position reported yet'}
                      {person.isAvailable === false ? ' · switched off' : ''}
                    </span>

                    <div className="button-row">
                      <span
                        className={`badge badge--${
                          ROSTER_TONE[link.status] || 'info'
                        }`}
                      >
                        {STORE_RIDER_STATUS_LABELS[link.status] || link.status}
                      </span>
                      {delivery ? (
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          onClick={() => setSelectedId(orderIdOf(delivery))}
                        >
                          Follow
                        </button>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

    </div>
  );
}

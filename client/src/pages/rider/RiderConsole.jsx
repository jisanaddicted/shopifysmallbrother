import { useCallback, useEffect, useRef, useState } from 'react';
import DeliveryMap from '../../components/maps/DeliveryMap';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import { useSocket } from '../../context/SocketContext';
import orderService from '../../services/orderService';
import storeService from '../../services/storeService';
import {
  ORDER_STATUS,
  ORDER_STATUS_FLOW,
  ORDER_STATUS_TONE,
} from '../../utils/constants';
import { formatCurrency, formatStatus } from '../../utils/formatters';

// Never send a GPS ping more often than this (milliseconds).
const PING_INTERVAL_MS = 4000;

export default function RiderConsole() {
  const { broadcastLocation, joinOrder, leaveOrder, connected } = useSocket();

  const [orders, setOrders] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Store features: invitations, the unclaimed pool, my stores.
  const [requests, setRequests] = useState([]);
  const [pool, setPool] = useState([]);
  const [myStores, setMyStores] = useState([]);
  const [poolBusy, setPoolBusy] = useState(false);

  const [broadcasting, setBroadcasting] = useState(false);
  const [myPosition, setMyPosition] = useState(null);
  const [locationError, setLocationError] = useState('');

  const watchIdRef = useRef(null);
  const lastPingRef = useRef(0);

  const activeOrder =
    orders.find((order) => (order._id || order.id) === activeId) || null;

  // --- Load the orders assigned to me --------------------------------------
  const loadOrders = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const list = await orderService.getRiderOrders();
      const safeList = Array.isArray(list) ? list : [];
      setOrders(safeList);
      setActiveId(
        (current) => current ?? safeList[0]?._id ?? safeList[0]?.id ?? null,
      );
    } catch (err) {
      setError(err.message || 'Could not load your deliveries.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  // --- Load the store-related lists (invitations, pool, stores) -------------
  const loadExtras = useCallback(async () => {
    const [invitations, available, stores] = await Promise.all([
      storeService.listMyRequests().catch(() => []),
      storeService.getOrderPool().catch(() => []),
      storeService.listMyStores().catch(() => []),
    ]);

    setRequests(invitations);
    setPool(available);
    setMyStores(stores);
  }, []);

  useEffect(() => {
    loadExtras();
  }, [loadExtras]);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadOrders(), loadExtras()]);
  }, [loadOrders, loadExtras]);

  // --- Answer a store invitation -------------------------------------------
  const respond = async (requestId, action) => {
    setPoolBusy(true);
    setError('');

    try {
      await storeService.respondToRequest(requestId, action);
      const [invitations, stores] = await Promise.all([
        storeService.listMyRequests().catch(() => []),
        storeService.listMyStores().catch(() => []),
      ]);
      setRequests(invitations);
      setMyStores(stores);
    } catch (err) {
      setError(err.message || 'Could not answer that invitation.');
    } finally {
      setPoolBusy(false);
    }
  };

  // --- Take a delivery from the pool ----------------------------------------
  const claim = async (orderId) => {
    setPoolBusy(true);
    setError('');

    try {
      const claimed = await storeService.claimOrder(orderId);
      const newId = claimed?._id || claimed?.id || orderId;

      // Reload both lists, then jump straight to the claimed order.
      await loadOrders();
      setPool((prev) => prev.filter((o) => (o._id || o.id) !== orderId));
      setActiveId(newId);
    } catch (err) {
      setError(err.message || 'Could not take that delivery.');
      loadExtras();
    } finally {
      setPoolBusy(false);
    }
  };

  // --- Join the socket room for the selected order --------------------------
  useEffect(() => {
    if (!activeId) return undefined;

    joinOrder(activeId);
    return () => leaveOrder(activeId);
  }, [activeId, joinOrder, leaveOrder]);

  // --- Broadcast my GPS while the toggle is on ------------------------------
  useEffect(() => {
    if (!broadcasting || !activeId) return undefined;

    if (!navigator.geolocation) {
      setLocationError('This browser cannot read your location.');
      return undefined;
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const coords = {
          lat: Number(position.coords.latitude.toFixed(6)),
          lng: Number(position.coords.longitude.toFixed(6)),
          accuracy: position.coords.accuracy,
          heading: position.coords.heading,
          speed: position.coords.speed,
        };

        setMyPosition(coords);
        setLocationError('');

        // Throttle: one socket ping every few seconds is plenty.
        const now = Date.now();
        if (now - lastPingRef.current < PING_INTERVAL_MS) return;
        lastPingRef.current = now;

        broadcastLocation(activeId, coords);
      },
      (err) =>
        setLocationError(
          err?.message || 'Location permission denied — enable GPS to share.',
        ),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [broadcasting, activeId, broadcastLocation]);

  // --- Status helpers -------------------------------------------------------
  const nextStatus = (current) => {
    const index = ORDER_STATUS_FLOW.indexOf(current);
    if (index === -1 || index >= ORDER_STATUS_FLOW.length - 1) return null;
    return ORDER_STATUS_FLOW[index + 1];
  };

  const advanceStatus = async () => {
    if (!activeOrder) return;

    const target = nextStatus(activeOrder.status);
    if (!target) return;

    setBusy(true);
    setError('');

    try {
      const updated = await orderService.updateOrderStatus(activeId, target);
      setOrders((prev) =>
        prev.map((order) =>
          (order._id || order.id) === activeId
            ? { ...order, ...updated }
            : order,
        ),
      );
    } catch (err) {
      setError(err.message || 'Could not update the status.');
    } finally {
      setBusy(false);
    }
  };

  const markDelivered = async () => {
    if (!activeOrder) return;

    setBusy(true);
    setError('');

    try {
      const updated = await orderService.updateOrderStatus(
        activeId,
        ORDER_STATUS.DELIVERED,
      );
      setOrders((prev) =>
        prev.map((order) =>
          (order._id || order.id) === activeId
            ? { ...order, ...updated }
            : order,
        ),
      );
      setBroadcasting(false);
    } catch (err) {
      setError(err.message || 'Could not complete the delivery.');
    } finally {
      setBusy(false);
    }
  };

  const customerLocation =
    activeOrder?.location || activeOrder?.address?.location || null;
  const target = nextStatus(activeOrder?.status);

  if (loading) {
    return <LoadingSpinner fullPage label="Loading your deliveries…" />;
  }

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1>Rider console</h1>
          <p className="muted">
            {orders.length} assigned {orders.length === 1 ? 'order' : 'orders'} ·{' '}
            {pool.length} available ·{' '}
            <span className={`live-dot ${connected ? 'live-dot--on' : ''}`}>
              {connected ? 'Live' : 'Offline'}
            </span>
          </p>
        </div>

        <button
          type="button"
          className="btn btn-outline btn-sm"
          onClick={refreshAll}
        >
          Refresh
        </button>
      </header>

      {error ? <p className="alert alert--danger">{error}</p> : null}

      {/* --- Invitations from stores/admins ----------------------------------- */}
      {requests.length > 0 ? (
        <section className="panel">
          <div className="panel__header">
            <h2 className="panel__title">
              Store invitations ({requests.length})
            </h2>
          </div>

          <ul className="rider-list">
            {requests.map((request) => (
              <li key={request._id || request.id}>
                <div className="rider-list__item">
                  <span className="rider-list__id">
                    {request.store?.name || 'A store'}
                  </span>
                  <span className="muted small">
                    wants you to deliver for them
                  </span>
                  <span className="button-row">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={poolBusy}
                      onClick={() =>
                        respond(request._id || request.id, 'accept')
                      }
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={poolBusy}
                      onClick={() =>
                        respond(request._id || request.id, 'decline')
                      }
                    >
                      Decline
                    </button>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* --- Stores I deliver for ---------------------------------------------- */}
      {myStores.length > 0 ? (
        <p className="muted small">
          Delivering for:{' '}
          {myStores.map((s) => s.name).join(', ')}
        </p>
      ) : null}

      {/* --- Unclaimed deliveries ---------------------------------------------- */}
      {pool.length > 0 ? (
        <section className="panel">
          <div className="panel__header">
            <h2 className="panel__title">Available deliveries</h2>
            <span className="muted small">
              Unclaimed orders from your stores — take one to start.
            </span>
          </div>

          <ul className="rider-list">
            {pool.map((order) => {
              const id = order._id || order.id;
              return (
                <li key={id}>
                  <div className="rider-list__item">
                    <span className="rider-list__id">
                      #{String(id).slice(-6).toUpperCase()}
                    </span>
                    <span className="muted small">
                      {order.store?.name || 'General catalogue'} ·{' '}
                      {order.address?.line1 || 'No address'} ·{' '}
                      {order.items?.length || 0} item(s)
                    </span>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={poolBusy}
                      onClick={() => claim(id)}
                    >
                      Take delivery
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {orders.length === 0 ? (
        <p className="empty">
          Nothing assigned to you right now.{' '}
          {pool.length > 0
            ? 'Take an available delivery above to get started.'
            : 'New orders will appear here.'}
        </p>
      ) : (
        <div className="rider-grid">
          <aside className="panel rider-list">
            <h2 className="panel__title">Assigned to me</h2>
            <ul>
              {orders.map((order) => {
                const id = order._id || order.id;
                const isActive = id === activeId;

                return (
                  <li key={id}>
                    <button
                      type="button"
                      className={`rider-list__item ${
                        isActive ? 'is-active' : ''
                      }`}
                      onClick={() => setActiveId(id)}
                    >
                      <span className="rider-list__id">
                        #{String(id).slice(-6).toUpperCase()}
                      </span>
                      <span
                        className={`badge badge--${
                          ORDER_STATUS_TONE[order.status] || 'info'
                        }`}
                      >
                        {formatStatus(order.status)}
                      </span>
                      <span className="muted small">
                        {order.address?.line1 || 'No address'}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>

          <div className="rider-main">
            <section className="panel">
              <div className="panel__header">
                <h2 className="panel__title">
                  {activeOrder
                    ? `Delivering #${String(activeId).slice(-6).toUpperCase()}`
                    : 'Select an order'}
                </h2>

                <button
                  type="button"
                  className={`btn btn-sm ${
                    broadcasting ? 'btn-danger' : 'btn-primary'
                  }`}
                  onClick={() => setBroadcasting((on) => !on)}
                  disabled={
                    !activeId || activeOrder?.status === ORDER_STATUS.DELIVERED
                  }
                >
                  {broadcasting ? 'Stop sharing GPS' : 'Start sharing GPS'}
                </button>
              </div>

              {locationError ? (
                <p className="alert alert--warn">{locationError}</p>
              ) : null}

              <p className="muted small">
                {broadcasting && myPosition
                  ? `Sending ${myPosition.lat}, ${myPosition.lng} · accuracy ±${Math.round(
                      myPosition.accuracy || 0,
                    )} m`
                  : `GPS sharing is ${broadcasting ? 'starting…' : 'off'}.`}
              </p>

              <DeliveryMap
                customerLocation={customerLocation}
                riderLocation={myPosition}
                riderLabel="You"
              />

              <div className="button-row">
                {target ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={advanceStatus}
                    disabled={busy}
                  >
                    {busy ? 'Updating…' : `Mark as ${formatStatus(target)}`}
                  </button>
                ) : null}

                {activeOrder && activeOrder.status !== ORDER_STATUS.DELIVERED ? (
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={markDelivered}
                    disabled={busy}
                  >
                    Mark delivered
                  </button>
                ) : null}
              </div>
            </section>

            {activeOrder ? (
              <section className="panel">
                <h2 className="panel__title">Drop-off</h2>
                <p>{activeOrder.address?.line1}</p>
                {activeOrder.address?.city ? (
                  <p>{activeOrder.address.city}</p>
                ) : null}
                {activeOrder.address?.phone ? (
                  <p className="muted">☎ {activeOrder.address.phone}</p>
                ) : null}
                {activeOrder.address?.notes ? (
                  <p className="muted small">“{activeOrder.address.notes}”</p>
                ) : null}
                <p className="price">
                  Collect {formatCurrency(activeOrder.total)} on delivery
                </p>
              </section>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

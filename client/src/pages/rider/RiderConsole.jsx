import { useCallback, useEffect, useRef, useState } from 'react';
import DeliveryMap from '../../components/maps/DeliveryMap';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import { useSocket } from '../../context/SocketContext';
import orderService from '../../services/orderService';
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
            {orders.length} assigned {orders.length === 1 ? 'order' : 'orders'}{' '}
            ·{' '}
            <span className={`live-dot ${connected ? 'live-dot--on' : ''}`}>
              {connected ? 'Live' : 'Offline'}
            </span>
          </p>
        </div>

        <button
          type="button"
          className="btn btn-outline btn-sm"
          onClick={loadOrders}
        >
          Refresh
        </button>
      </header>

      {error ? <p className="alert alert--danger">{error}</p> : null}

      {orders.length === 0 ? (
        <p className="empty">
          Nothing assigned to you right now. Dispatch will push new orders here.
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

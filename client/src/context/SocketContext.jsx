import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  connectSocket,
  disconnectSocket,
  emitRiderLocation,
  joinOrderRoom,
  leaveOrderRoom,
} from '../services/socket';
import { SOCKET_EVENTS, getGuestToken } from '../utils/constants';
import { useAuth } from './AuthContext';

const SocketContext = createContext(null);

export function SocketProvider({ children }) {
  const { token, isAuthenticated } = useAuth();

  const [connected, setConnected] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  // { [orderId]: { lat, lng, at } } - last known position of each rider
  const [riderLocations, setRiderLocations] = useState({});
  // { [orderId]: { status, at } } - live status pushed from the server
  const [statusUpdates, setStatusUpdates] = useState({});
  // { [orderId]: { storeName, at } } - live "a new order just landed" pings
  const [newOrders, setNewOrders] = useState({});

  const socketRef = useRef(null);

  // Connect while logged in, tear down on logout.
  // Guests get live tracking too: the tracker passes its guestToken+orderId
  // to joinOrder(), which connects a guest socket lazily (see below).
  const guestAuthRef = useRef(null);

  const attachSocket = (socket) => {
    socketRef.current = socket;

    const handleConnect = () => {
      setConnected(true);
      setConnectionError('');
    };
    const handleDisconnect = () => setConnected(false);
    const handleConnectError = (error) =>
      setConnectionError(error?.message || 'Could not reach the live server');

    const handleRiderLocation = (payload = {}) => {
      const { orderId, lat, lng, at } = payload;
      if (!orderId || !Number.isFinite(Number(lat))) return;

      setRiderLocations((prev) => ({
        ...prev,
        [orderId]: { lat: Number(lat), lng: Number(lng), at: at || Date.now() },
      }));
    };

    const handleStatusUpdated = (payload = {}) => {
      const { orderId, status } = payload;
      if (!orderId || !status) return;

      setStatusUpdates((prev) => ({
        ...prev,
        [orderId]: { status, at: Date.now() },
      }));
    };

    // "An order just landed for one of your stores" - the rider console
    // surfaces this as an accept prompt and refreshes the pool.
    const handleNewOrder = (payload = {}) => {
      const { orderId, storeName } = payload;
      if (!orderId) return;

      setNewOrders((prev) => ({
        ...prev,
        [orderId]: { storeName: storeName || 'a store', at: Date.now() },
      }));
    };

    // The server telling us something went wrong (e.g. "that order is not
    // assigned to you"). Previously this reused handleStatusUpdated, which
    // silently swallowed the message because there is no `status` in it.
    const handleServerError = (payload = {}) => {
      setConnectionError(
        payload.message || 'The live server reported a problem.',
      );
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect_error', handleConnectError);
    socket.on(SOCKET_EVENTS.RIDER_LOCATION_UPDATED, handleRiderLocation);
    socket.on(SOCKET_EVENTS.ORDER_STATUS_UPDATED, handleStatusUpdated);
    socket.on(SOCKET_EVENTS.ORDER_NEW, handleNewOrder);
    socket.on(SOCKET_EVENTS.SERVER_ERROR, handleServerError);

    if (socket.connected) handleConnect();

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('connect_error', handleConnectError);
      socket.off(SOCKET_EVENTS.RIDER_LOCATION_UPDATED, handleRiderLocation);
      socket.off(SOCKET_EVENTS.ORDER_STATUS_UPDATED, handleStatusUpdated);
      socket.off(SOCKET_EVENTS.ORDER_NEW, handleNewOrder);
      socket.off(SOCKET_EVENTS.SERVER_ERROR, handleServerError);
    };
  };

  useEffect(() => {
    if (!isAuthenticated || !token) {
      // No account: keep any guest socket a tracker opened (see joinOrder).
      if (!guestAuthRef.current) {
        disconnectSocket();
        socketRef.current = null;
        setConnected(false);
      }
      return undefined;
    }

    // Signing in replaces any guest socket with the account one.
    guestAuthRef.current = null;
    const socket = connectSocket({ token });
    return attachSocket(socket);
  }, [isAuthenticated, token]);

  const joinOrder = useCallback(
    (orderId, { guestToken } = {}) => {
      if (!orderId) return;
      // Guests (no JWT): connect scoped to this one order using the token
      // checkout returned (or the stored one), then join its room.
      if (!token) {
        const scoped = guestToken || getGuestToken(orderId) || null;
        if (scoped) {
          guestAuthRef.current = { orderId, guestToken: scoped };
          const socket = connectSocket({ guestToken: scoped, orderId });
          if (socketRef.current !== socket) attachSocket(socket);
        }
      }
      joinOrderRoom(orderId);
    },
    [token],
  );
  const leaveOrder = useCallback((orderId) => leaveOrderRoom(orderId), []);

  // The rider console calls this once the order is visible / claimed.
  const clearNewOrder = useCallback((orderId) => {
    setNewOrders((prev) => {
      if (!prev[orderId]) return prev;
      const next = { ...prev };
      delete next[orderId];
      return next;
    });
  }, []);
  const broadcastLocation = useCallback(
    (orderId, coords) => emitRiderLocation(orderId, coords),
    [],
  );

  // Handy for the rider console: "where was this rider last seen?"
  const getRiderLocation = useCallback(
    (orderId) => riderLocations[orderId] || null,
    [riderLocations],
  );

  const value = useMemo(
    () => ({
      connected,
      connectionError,
      riderLocations,
      statusUpdates,
      newOrders,
      clearNewOrder,
      getRiderLocation,
      joinOrder,
      leaveOrder,
      broadcastLocation,
      socket: socketRef.current,
    }),
    [
      connected,
      connectionError,
      riderLocations,
      statusUpdates,
      newOrders,
      clearNewOrder,
      getRiderLocation,
      joinOrder,
      leaveOrder,
      broadcastLocation,
    ],
  );

  return (
    <SocketContext.Provider value={value}>{children}</SocketContext.Provider>
  );
}

export function useSocket() {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used inside <SocketProvider>');
  }
  return context;
}

export default SocketContext;
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
import { SOCKET_EVENTS } from '../utils/constants';
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

  const socketRef = useRef(null);

  // Connect while logged in, tear down on logout.
  useEffect(() => {
    if (!isAuthenticated || !token) {
      disconnectSocket();
      socketRef.current = null;
      setConnected(false);
      return undefined;
    }

    const socket = connectSocket(token);
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
    socket.on(SOCKET_EVENTS.SERVER_ERROR, handleServerError);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('connect_error', handleConnectError);
      socket.off(SOCKET_EVENTS.RIDER_LOCATION_UPDATED, handleRiderLocation);
      socket.off(SOCKET_EVENTS.ORDER_STATUS_UPDATED, handleStatusUpdated);
      socket.off(SOCKET_EVENTS.SERVER_ERROR, handleServerError);
    };
  }, [isAuthenticated, token]);

  const joinOrder = useCallback((orderId) => joinOrderRoom(orderId), []);
  const leaveOrder = useCallback((orderId) => leaveOrderRoom(orderId), []);
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
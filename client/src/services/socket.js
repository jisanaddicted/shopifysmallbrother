import { io } from 'socket.io-client';
import { SOCKET_EVENTS, SOCKET_URL } from '../utils/constants';

/**
 * A single shared socket.io connection for the whole app.
 * The SocketContext (src/context/SocketContext.jsx) owns the lifecycle and
 * components call the small helpers below instead of touching `io` directly.
 */
let socket = null;

/** Create (or reuse) the connection. `auth` authenticates the handshake:
 *  - signed-in: { token } (JWT)
 *  - guest tracker: { guestToken, orderId } (scoped to one order, no account)
 *  Kept backwards compatible: connectSocket(tokenString) still means { token }.
 */
export function connectSocket(auth) {
  const nextAuth =
    typeof auth === 'string' || auth == null ? { token: auth } : auth;

  const sameAuth =
    socket &&
    socket.auth?.token === nextAuth.token &&
    socket.auth?.guestToken === nextAuth.guestToken &&
    socket.auth?.orderId === nextAuth.orderId;
  if (socket && (socket.connected || sameAuth)) {
    if (sameAuth) return socket;
    if (socket.connected) return socket;
  }

  if (socket) socket.disconnect();

  socket = io(SOCKET_URL, {
    autoConnect: true,
    auth: { ...nextAuth },
    withCredentials: true,
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });

  return socket;
}

export function getSocket() {
  return socket;
}

export function disconnectSocket() {
  if (!socket) return;
  socket.removeAllListeners();
  socket.disconnect();
  socket = null;
}

/** Subscribe to a server event and return an unsubscribe function. */
export function onSocketEvent(event, handler) {
  if (!socket) return () => {};
  socket.on(event, handler);
  return () => socket.off(event, handler);
}

// --- Order room helpers ----------------------------------------------------

/** Customer/rider asks the server to join the room for one order. */
export function joinOrderRoom(orderId) {
  socket?.emit(SOCKET_EVENTS.JOIN_ORDER, { orderId });
}

export function leaveOrderRoom(orderId) {
  socket?.emit(SOCKET_EVENTS.LEAVE_ORDER, { orderId });
}

/** Rider broadcasts the current GPS fix for the order they are delivering. */
export function emitRiderLocation(orderId, { lat, lng, accuracy, heading, speed }) {
  socket?.emit(SOCKET_EVENTS.RIDER_LOCATION, {
    orderId,
    lat,
    lng,
    accuracy,
    heading,
    speed,
    at: Date.now(),
  });
}

export default {
  connectSocket,
  getSocket,
  disconnectSocket,
  onSocketEvent,
  joinOrderRoom,
  leaveOrderRoom,
  emitRiderLocation,
};
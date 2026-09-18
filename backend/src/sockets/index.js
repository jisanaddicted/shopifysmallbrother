import { Server } from 'socket.io';
import { config } from '../config/env.js';
import Order from '../models/Order.js';
import User from '../models/User.js';
import { ROLES, SOCKET_EVENTS } from '../utils/constants.js';
import { verifyToken } from '../utils/jwt.js';
import { canAccessOrder } from '../utils/orderAccess.js';

/** Every order has its own room, so a tracker only hears about its own order. */
const roomFor = (orderId) => `order:${orderId}`;

let io = null;

/**
 * Verifies the JWT sent in the handshake (`auth: { token }` - see
 * client/src/services/socket.js) and attaches the live user document.
 */
async function authenticateSocket(socket, next) {
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;

  if (!token) return next(new Error('Authentication token missing.'));

  try {
    const payload = verifyToken(token);
    const user = await User.findById(payload.sub).select('name email role');

    if (!user) return next(new Error('Your account no longer exists.'));

    socket.user = user;
    return next();
  } catch {
    return next(new Error('Your session has expired.'));
  }
}

/** Wraps a handler so a thrown error never kills the socket. */
const safe = (socket, handler) => async (payload = {}) => {
  try {
    await handler(payload);
  } catch (err) {
    console.error('[socket]', err);
    socket.emit(SOCKET_EVENTS.SERVER_ERROR, {
      message: err.message || 'Something went wrong.',
    });
  }
};

export function initSockets(httpServer) {
  io = new Server(httpServer, {
    // The browser app is a different origin (Vite on 5173).
    cors: { origin: config.clientOrigins, credentials: true },
  });

  io.use(authenticateSocket);

  io.on('connection', (socket) => {
    console.log(`[socket] ${socket.user.role} connected (${socket.id})`);

    /** Join the room for one order - only if this user may see it. */
    socket.on(
      SOCKET_EVENTS.JOIN_ORDER,
      safe(socket, async ({ orderId }) => {
        if (!orderId) return;

        const order = await Order.findById(orderId).select('customer rider');
        if (!order || !canAccessOrder(order, socket.user)) {
          socket.emit(SOCKET_EVENTS.SERVER_ERROR, {
            orderId,
            message: 'You cannot watch that order.',
          });
          return;
        }

        socket.join(roomFor(orderId));
      }),
    );

    socket.on(
      SOCKET_EVENTS.LEAVE_ORDER,
      safe(socket, async ({ orderId }) => {
        if (orderId) socket.leave(roomFor(orderId));
      }),
    );

    /**
     * A rider sharing their GPS. We persist the ping (so a late-joining
     * tracker still gets a position) and relay it to everyone in the room.
     */
    socket.on(
      SOCKET_EVENTS.RIDER_LOCATION,
      safe(socket, async (payload) => {
        const { orderId, lat, lng, accuracy, heading, speed, at } = payload;

        if (socket.user.role !== ROLES.RIDER) {
          socket.emit(SOCKET_EVENTS.SERVER_ERROR, {
            orderId,
            message: 'Only a rider can share a location.',
          });
          return;
        }

        const order = await Order.findById(orderId).select('rider');
        if (!order || String(order.rider) !== String(socket.user._id)) {
          socket.emit(SOCKET_EVENTS.SERVER_ERROR, {
            orderId,
            message: 'That order is not assigned to you.',
          });
          return;
        }

        const point = { lat: Number(lat), lng: Number(lng) };
        if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return;

        const pingedAt = at || Date.now();

        order.riderLocation = point;
        await order.save();

        // Keep the rider's own last-known position fresh for dispatch.
        await User.updateOne(
          { _id: socket.user._id },
          { $set: { location: point } },
        );

        io.to(roomFor(orderId)).emit(SOCKET_EVENTS.RIDER_LOCATION_UPDATED, {
          orderId: String(orderId),
          lat: point.lat,
          lng: point.lng,
          accuracy,
          heading,
          speed,
          at: pingedAt,
        });
      }),
    );

    socket.on('disconnect', (reason) => {
      console.log(`[socket] ${socket.id} disconnected (${reason})`);
    });
  });

  return io;
}

/** The io instance, or null before initSockets() has run (e.g. in scripts). */
export function getIO() {
  return io;
}

/** Broadcasts a status change to everyone watching that order. */
export function emitOrderStatusUpdated(orderId, status, note = '') {
  if (!io) return;
  io.to(roomFor(orderId)).emit(SOCKET_EVENTS.ORDER_STATUS_UPDATED, {
    orderId: String(orderId),
    status,
    note,
    at: Date.now(),
  });
}

export { roomFor };

export default { initSockets, getIO, emitOrderStatusUpdated, roomFor };

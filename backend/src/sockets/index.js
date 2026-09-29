import crypto from 'node:crypto';
import { Server } from 'socket.io';
import Order from '../models/Order.js';
import User from '../models/User.js';
import { ROLES, SOCKET_EVENTS, STORE_RIDER_STATUS } from '../utils/constants.js';
import { verifyToken } from '../utils/jwt.js';
import { corsOriginFn } from '../config/cors.js';
import { hashGuestToken } from '../middleware/auth.js';
import { canAccessOrder } from '../utils/orderAccess.js';
import { activeStoreIds } from '../utils/storeRider.js';
import { managedStoreIds } from '../utils/storeAccess.js';
import StoreRider from '../models/StoreRider.js';

/** Every order has its own room, so a tracker only hears about its own order. */
const roomFor = (orderId) => `order:${orderId}`;

let io = null;

/**
 * userId -> Set<socketId> for every connected account. Lets
 * notifyStoreMembers() reach every open tab of a store's riders AND store
 * admins, even before they join any order room.
 */
const userSockets = new Map();

/**
 * Verifies the JWT sent in the handshake (`auth: { token }` - see
 * client/src/services/socket.js) and attaches the live user document.
 * Guests (order tracker without an account) pass `auth: { guestToken,
 * orderId }` instead — they may only join that one order's room.
 */
async function authenticateSocket(socket, next) {
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;

  if (token) {
    try {
      const payload = verifyToken(token);
      const user = await User.findById(payload.sub).select('name email role');

      if (!user) return next(new Error('Your account no longer exists.'));

      socket.user = user;
      socket.guest = null;
      return next();
    } catch {
      return next(new Error('Your session has expired.'));
    }
  }

  // Guest tracker: token is the raw guestToken from checkout, bound to one order.
  const guestToken = socket.handshake.auth?.guestToken || socket.handshake.query?.guestToken;
  const guestOrderId = socket.handshake.auth?.orderId || socket.handshake.query?.orderId;
  if (guestToken && guestOrderId) {
    try {
      const order = await Order.findById(guestOrderId).select('customer guestTokenHash');
      if (order && !order.customer && order.guestTokenHash) {
        const expected = Buffer.from(order.guestTokenHash, 'utf8');
        const actual = Buffer.from(hashGuestToken(guestToken), 'utf8');
        if (expected.length === actual.length && crypto.timingSafeEqual(expected, actual)) {
          socket.user = null;
          socket.guest = { orderId: String(guestOrderId) };
          return next();
        }
      }
    } catch {
      // fall through to the missing-token error
    }
  }

  return next(new Error('Authentication token missing.'));
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
  // The SAME policy the REST layer uses (config/cors.js). This used to be a
  // second, hand-written copy that had already drifted from the first: a build
  // served by the backend loaded its page but every live-tracking connection
  // then failed the handshake with 400. One shared function, one behaviour.
  io = new Server(httpServer, {
    cors: { origin: corsOriginFn, credentials: true },
  });

  io.use(authenticateSocket);

  io.on('connection', (socket) => {
    const isGuest = !socket.user && Boolean(socket.guest);
    console.log(
      `[socket] ${isGuest ? `guest:${socket.guest.orderId}` : socket.user.role} connected (${socket.id})`,
    );

    // Track every account, not just riders: store owners and the admins they
    // appointed need the live "an order just arrived" ping too.
    // Guests are NOT tracked — they may only join their own order room below.
    const userId = socket.user ? String(socket.user._id) : null;
    if (userId) {
      if (!userSockets.has(userId)) userSockets.set(userId, new Set());
      userSockets.get(userId).add(socket.id);
    }

    /** Join the room for one order - only if this user may see it. */
    socket.on(
      SOCKET_EVENTS.JOIN_ORDER,
      safe(socket, async ({ orderId }) => {
        if (!orderId) return;

        // Guests may only ever watch the one order their token was issued for.
        if (isGuest) {
          if (String(orderId) !== String(socket.guest.orderId)) {
            socket.emit(SOCKET_EVENTS.SERVER_ERROR, {
              orderId,
              message: 'You cannot watch that order.',
            });
            return;
          }
          socket.join(roomFor(orderId));
          return;
        }

        const order = await Order.findById(orderId).select(
          'customer rider store',
        );
        if (!order) {
          socket.emit(SOCKET_EVENTS.SERVER_ERROR, {
            orderId,
            message: 'That order does not exist.',
          });
          return;
        }

        // Riders may join the room of an unclaimed order from a store they
        // are bound to (the pool) - that is how the live "new order" card
        // works before anyone has accepted the delivery. Store owners and
        // store admins may join the room of any order their store owns, so
        // the back office watches a delivery move in real time.
        const boundStoreIds =
          socket.user.role === ROLES.RIDER
            ? await activeStoreIds(socket.user._id)
            : [];
        const memberStoreIds = await managedStoreIds(socket.user);

        if (
          !canAccessOrder(order, socket.user, boundStoreIds, memberStoreIds)
        ) {
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

        if (!socket.user || socket.user.role !== ROLES.RIDER) {
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

        // Keep the rider's own last-known position fresh for order tracking.
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
      if (userId) {
        const tabs = userSockets.get(userId);
        if (tabs) {
          tabs.delete(socket.id);
          if (tabs.size === 0) userSockets.delete(userId);
        }
      }
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

/**
 * Real-time "an order just arrived" ping.
 *
 * Given the store the order belongs to, this finds every member whose binding
 * to that store is active - delivery riders AND store admins - and pings all of
 * their open sockets. The payload is a preview only: the rider's console
 * re-fetches /orders/pool and the merchant dashboard re-fetches
 * /orders/store/mine for the truth.
 *
 * Members who are offline simply miss the ping; the fetched lists are the
 * fallback, which is also why unbinding and claim-free pool access are never
 * removed.
 */
export async function notifyStoreMembers(storeId, payload) {
  if (!io || !storeId) return;

  const bindings = await StoreRider.find({
    store: storeId,
    status: STORE_RIDER_STATUS.ACTIVE,
  }).select('rider role');

  const targets = new Set();
  for (const binding of bindings) {
    const tabs = userSockets.get(String(binding.rider));
    if (tabs) for (const socketId of tabs) targets.add(socketId);
  }

  // The store owner is not in the StoreRider table, but the merchant
  // dashboard must still hear live pings (new order / rider claimed /
  // status changed). Without this the merchant only sees updates after a
  // manual Refresh, which reads as "status still undefined / stale".
  try {
    const { default: Store } = await import('../models/Store.js');
    const store = await Store.findById(storeId).select('owner');
    if (store?.owner) {
      const tabs = userSockets.get(String(store.owner));
      if (tabs) for (const socketId of tabs) targets.add(socketId);
    }
  } catch {
    // Live ping is best-effort: the REST lists are the source of truth.
  }

  if (targets.size === 0) return;

  io.to([...targets]).emit(SOCKET_EVENTS.ORDER_NEW, {
    storeId: String(storeId),
    ...payload,
    at: Date.now(),
  });
}

export { roomFor };

export default {
  initSockets,
  getIO,
  emitOrderStatusUpdated,
  notifyStoreMembers,
  roomFor,
};

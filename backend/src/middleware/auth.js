import crypto from 'node:crypto';
import User from '../models/User.js';
import { bearerFromHeader, verifyToken } from '../utils/jwt.js';
import { storesForUser } from '../utils/storeAccess.js';
import { HttpError } from './errorHandler.js';

/**
 * A guest order's secret access token. The raw token is returned ONCE at
 * order creation (the client stores it in localStorage); only its SHA-256
 * hash is persisted, so a database leak does not hand out order access.
 */
export function hashGuestToken(raw) {
  return crypto.createHash('sha256').update(String(raw), 'utf8').digest('hex');
}

export function issueGuestToken() {
  const raw = crypto.randomBytes(32).toString('hex');
  return { raw, hash: hashGuestToken(raw) };
}

function tokenFromRequest(req) {
  return (
    bearerFromHeader(req.headers.authorization) ||
    req.query.token ||
    req.headers['x-guest-token'] ||
    req.body?.guestToken ||
    req.query.guestToken ||
    null
  );
}

/**
 * Reads the token from `Authorization: Bearer <token>` (falling back to a
 * `?token=` query param so the socket handshake logic can be reused) and
 * attaches the *current* user document to `req.user`.
 *
 * Loading the user per request means a deleted/role-changed account stops
 * working immediately instead of when the token expires.
 */
export function requireAuth(req, res, next) {
  const token = tokenFromRequest(req);

  if (!token) {
    return next(new HttpError(401, 'You need to sign in to do that.'));
  }

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    return next(new HttpError(401, 'Your session has expired. Please sign in again.'));
  }

  return User.findById(payload.sub)
    .then((user) => {
      if (!user) {
        return next(new HttpError(401, 'Your account no longer exists.'));
      }

      req.user = user;
      req.token = token;
      return next();
    })
    .catch(next);
}

/**
 * Like requireAuth, but a missing/invalid token is NOT an error: the request
 * continues as a guest (`req.user === null`). Guest-capable handlers
 * (guest checkout: POST /orders, GET /orders/:id with ?guestToken=) then
 * decide what a guest may do. Everything else still rejects guests itself.
 */
export function optionalAuth(req, res, next) {
  const token = tokenFromRequest(req);

  if (!token) {
    req.user = null;
    req.token = null;
    return next();
  }

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    // A guest order token is not a JWT — leave it for the handler (it checks
    // the order's guestTokenHash itself). A bad JWT is also left alone here
    // so public handlers can still serve guests; protected handlers re-check.
    req.user = null;
    req.token = null;
    return next();
  }

  return User.findById(payload.sub)
    .then((user) => {
      req.user = user || null;
      req.token = user ? token : null;
      return next();
    })
    .catch(() => {
      req.user = null;
      req.token = null;
      return next();
    });
}

/** Guards a route to one or more roles: requireRole(ROLES.ADMIN). */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return next(new HttpError(401, 'You need to sign in to do that.'));
    }

    if (!roles.includes(req.user.role)) {
      return next(
        new HttpError(403, 'Your account is not allowed to do that.'),
      );
    }

    return next();
  };
}

/**
 * Guards the store back office to the people who actually run a store: the
 * owner who signed it up, and every store admin they appointed (an accepted
 * `role: 'admin'` membership). A store admin keeps their own platform role, so
 * this can never be a `requireRole()` check.
 *
 * The resolved memberships are attached to `req.stores` so the controller does
 * not have to ask the database the same question twice.
 *
 * A platform admin goes through the very same membership test: they only pass
 * for stores they run (owned, or an accepted invitation). One who runs no
 * store at all is rejected before anything is queried.
 */
export function requireStoreStaff(req, res, next) {
  if (!req.user) {
    return next(new HttpError(401, 'You need to sign in to do that.'));
  }

  return storesForUser(req.user)
    .then((stores) => {
      if (stores.length === 0) {
        return next(
          new HttpError(
            403,
            'No store is linked to your account. Sign up as a store, or accept an invitation from a store owner.',
          ),
        );
      }

      req.stores = stores;
      return next();
    })
    .catch(next);
}

/**
 * The catalogue editors: platform admins, store owners and the store admins
 * they appointed - all resolved through the stores they actually run. The
 * controller still checks that the product belongs to a store in that list,
 * so this is only the first of two gates.
 */
export function requireProductManager(req, res, next) {
  return requireStoreStaff(req, res, next);
}

export default { requireAuth, optionalAuth, requireRole, requireStoreStaff, requireProductManager };

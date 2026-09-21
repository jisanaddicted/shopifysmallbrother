import User from '../models/User.js';
import { bearerFromHeader, verifyToken } from '../utils/jwt.js';
import { storesForUser } from '../utils/storeAccess.js';
import { ROLES } from '../utils/constants.js';
import { HttpError } from './errorHandler.js';

/**
 * Reads the token from `Authorization: Bearer <token>` (falling back to a
 * `?token=` query param so the socket handshake logic can be reused) and
 * attaches the *current* user document to `req.user`.
 *
 * Loading the user per request means a deleted/role-changed account stops
 * working immediately instead of when the token expires.
 */
export function requireAuth(req, res, next) {
  const token =
    bearerFromHeader(req.headers.authorization) || req.query.token || null;

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
 * Platform admins pass through - they supervise every store. A caller who runs
 * no store at all is rejected before anything is queried.
 */
export function requireStoreStaff(req, res, next) {
  if (!req.user) {
    return next(new HttpError(401, 'You need to sign in to do that.'));
  }

  if (req.user.role === ROLES.ADMIN) {
    req.stores = [];
    return next();
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
 * they appointed. The controller still checks that the product belongs to a
 * store the caller runs, so this is only the first of two gates.
 */
export function requireProductManager(req, res, next) {
  if (req.user?.role === ROLES.ADMIN) {
    req.stores = [];
    return next();
  }

  return requireStoreStaff(req, res, next);
}

export default { requireAuth, requireRole, requireStoreStaff, requireProductManager };

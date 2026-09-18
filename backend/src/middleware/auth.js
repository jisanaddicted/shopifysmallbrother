import User from '../models/User.js';
import { bearerFromHeader, verifyToken } from '../utils/jwt.js';
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

export default { requireAuth, requireRole };

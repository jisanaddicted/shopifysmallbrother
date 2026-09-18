import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';

/** Signs a token for a user document. `sub` is always the Mongo id string. */
export function signToken(user) {
  return jwt.sign(
    { sub: String(user._id), role: user.role },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn },
  );
}

/** Returns the decoded payload, or throws if the token is invalid/expired. */
export function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret);
}

/** Pulls the token out of an `Authorization: Bearer <token>` header. */
export function bearerFromHeader(headerValue = '') {
  const [scheme, token] = String(headerValue).split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}

export default { signToken, verifyToken, bearerFromHeader };

import User from '../models/User.js';
import Store from '../models/Store.js';
import { HttpError } from '../middleware/errorHandler.js';
import {
  ROLES,
  ROLES_REQUIRING_USERNAME,
  SELF_SIGNUP_ROLES,
} from '../utils/constants.js';
import { signToken } from '../utils/jwt.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { storesForUser } from '../utils/storeAccess.js';
import {
  isValidUsername,
  normaliseUsername,
  uniqueSlug,
} from '../utils/slug.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normaliseEmail = (value) => String(value || '').trim().toLowerCase();

/**
 * POST /api/auth/register
 * body: { name, email, phone, password, role }
 *
 * Responds with the same shape as login: { token, user }.
 */
export const register = asyncHandler(async (req, res) => {
  const { name, email, phone, password, storeName } = req.body || {};

  const cleanName = String(name || '').trim();
  const cleanEmail = normaliseEmail(email);
  const cleanPhone = String(phone || '').trim();

  if (!cleanName) throw new HttpError(400, 'Please tell us your name.');
  if (!cleanEmail || !EMAIL_PATTERN.test(cleanEmail)) {
    throw new HttpError(400, 'Please enter a valid email address.');
  }
  if (!password || String(password).length < 6) {
    throw new HttpError(400, 'Your password must be at least 6 characters.');
  }

  // Only customer/rider/store can be self-selected. Anything else (including a
  // missing value) falls back to customer so nobody can sign up as an admin.
  const requestedRole = String(req.body?.role || '').toLowerCase();
  const role = SELF_SIGNUP_ROLES.includes(requestedRole)
    ? requestedRole
    : ROLES.CUSTOMER;

  // Stores and riders MUST have a username - it is how a store owner finds
  // somebody to invite. A customer may pick one too (optional), because a
  // store owner can appoint any account as a store admin; without a handle
  // they could only be found by email.
  let username;
  if (ROLES_REQUIRING_USERNAME.includes(role) || req.body?.username) {
    username = normaliseUsername(req.body?.username);

    if (!isValidUsername(username)) {
      throw new HttpError(
        400,
        'Pick a username: 3-20 characters using letters, numbers, dot, dash or underscore, starting with a letter.',
      );
    }

    const taken = await User.exists({ username });
    if (taken) {
      throw new HttpError(409, `The username “${username}” is already taken.`);
    }
  }

  const existing = await User.findOne({ email: cleanEmail });
  if (existing) {
    throw new HttpError(409, 'That email is already registered.');
  }

  const user = await User.create({
    name: cleanName,
    email: cleanEmail,
    phone: cleanPhone,
    role,
    username,
    passwordHash: await User.hashPassword(password),
  });

  // A merchant account gets its own public storefront straight away, so the
  // owner can share the URL before adding a single product.
  let store = null;
  if (role === ROLES.STORE) {
    const displayName = String(storeName || cleanName).trim();

    const slug = await uniqueSlug(displayName, {
      exists: (candidate) => Store.exists({ slug: candidate }),
    });

    store = await Store.create({
      name: displayName,
      slug,
      owner: user._id,
      phone: cleanPhone,
    });
  }

  // A store admin sees the stores they were appointed to run, so the response
  // carries the full list; `store` stays the primary one for the older client
  // code paths.
  const entries = await storesForUser(user);

  res.status(201).json({
    token: signToken(user),
    user,
    store: store || entries[0]?.store || null,
    stores: entries,
  });
});

/**
 * POST /api/auth/login
 * body: { email, password }
 *
 * Responds { token, user } - the shape client/src/services/authService.js reads.
 */
export const login = asyncHandler(async (req, res) => {
  const { password } = req.body || {};

  // The login form sends one field, and it may be either an email address or a
  // username (riders and stores use their username).
  const identifier = normaliseEmail(
    req.body?.email || req.body?.username || req.body?.identifier,
  );

  if (!identifier || !password) {
    throw new HttpError(400, 'Please enter your email and password.');
  }

  // passwordHash is `select: false`, so ask for it explicitly.
  const user = await User.findOne({
    $or: [{ email: identifier }, { username: identifier }],
  }).select('+passwordHash');

  // Same message for "no such user" and "wrong password" so the endpoint
  // can't be used to discover which emails exist.
  if (!user || !(await user.verifyPassword(password))) {
    throw new HttpError(401, 'Invalid email or password.');
  }

  // Which stores does this account run? For a merchant, the store it signed
  // up; for a store admin, the store(s) an owner appointed it to. The client
  // needs the list to land an admin - who keeps their original role - on the
  // store dashboard instead of the customer storefront.
  const entries = await storesForUser(user);

  res.json({
    token: signToken(user),
    user,
    store: entries[0]?.store || null,
    stores: entries,
  });
});

/**
 * GET /api/auth/username-available?username=sam.rider
 * Used by the signup form to check a handle before submitting.
 */
export const usernameAvailable = asyncHandler(async (req, res) => {
  const username = normaliseUsername(req.query.username);

  if (!isValidUsername(username)) {
    return res.json({
      username,
      available: false,
      reason:
        'Usernames are 3-20 characters using letters, numbers, dot, dash or underscore, and start with a letter.',
    });
  }

  const taken = await User.exists({ username });

  return res.json({
    username,
    available: !taken,
    reason: taken ? 'That username is already taken.' : '',
  });
});

/**
 * GET /api/auth/me - used on refresh to re-validate the stored token.
 *
 * The store list is resolved on every call, so an account that accepted a
 * store-admin invitation a minute ago has the dashboard available without
 * signing in again.
 */
export const me = asyncHandler(async (req, res) => {
  const entries = await storesForUser(req.user);

  res.json({
    user: req.user,
    store: entries[0]?.store || null,
    stores: entries,
  });
});

/**
 * PATCH /api/auth/me - a user editing their own profile.
 * Only these fields are editable; role changes go through an admin.
 */
export const updateMe = asyncHandler(async (req, res) => {
  const { name, phone, isAvailable, location } = req.body || {};
  const user = req.user;

  if (name !== undefined) {
    const cleanName = String(name).trim();
    if (!cleanName) throw new HttpError(400, 'Please tell us your name.');
    user.name = cleanName;
  }

  if (phone !== undefined) user.phone = String(phone).trim();

  // A rider toggling themselves on/off the dispatch list.
  if (isAvailable !== undefined && user.role === ROLES.RIDER) {
    user.isAvailable = Boolean(isAvailable);
  }

  if (location && Number.isFinite(Number(location.lat))) {
    user.location = { lat: Number(location.lat), lng: Number(location.lng) };
  }

  await user.save();

  res.json({ user });
});

export default { register, login, me, updateMe, usernameAvailable };

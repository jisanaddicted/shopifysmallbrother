import User from '../models/User.js';
import { HttpError } from '../middleware/errorHandler.js';
import { ROLES, SELF_SIGNUP_ROLES } from '../utils/constants.js';
import { signToken } from '../utils/jwt.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normaliseEmail = (value) => String(value || '').trim().toLowerCase();

/**
 * POST /api/auth/register
 * body: { name, email, phone, password, role }
 *
 * Responds with the same shape as login: { token, user }.
 */
export const register = asyncHandler(async (req, res) => {
  const { name, email, phone, password } = req.body || {};

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

  // Only customer/rider can be self-selected. Anything else (including a
  // missing value) falls back to customer so nobody can sign up as an admin.
  const requestedRole = String(req.body?.role || '').toLowerCase();
  const role = SELF_SIGNUP_ROLES.includes(requestedRole)
    ? requestedRole
    : ROLES.CUSTOMER;

  const existing = await User.findOne({ email: cleanEmail });
  if (existing) {
    throw new HttpError(409, 'That email is already registered.');
  }

  const user = await User.create({
    name: cleanName,
    email: cleanEmail,
    phone: cleanPhone,
    role,
    passwordHash: await User.hashPassword(password),
  });

  res.status(201).json({ token: signToken(user), user });
});

/**
 * POST /api/auth/login
 * body: { email, password }
 *
 * Responds { token, user } - the shape client/src/services/authService.js reads.
 */
export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  const cleanEmail = normaliseEmail(email);

  if (!cleanEmail || !password) {
    throw new HttpError(400, 'Please enter your email and password.');
  }

  // passwordHash is `select: false`, so ask for it explicitly.
  const user = await User.findOne({ email: cleanEmail }).select('+passwordHash');

  // Same message for "no such user" and "wrong password" so the endpoint
  // can't be used to discover which emails exist.
  if (!user || !(await user.verifyPassword(password))) {
    throw new HttpError(401, 'Invalid email or password.');
  }

  res.json({ token: signToken(user), user });
});

/** GET /api/auth/me - used on refresh to re-validate the stored token. */
export const me = asyncHandler(async (req, res) => {
  res.json({ user: req.user });
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

export default { register, login, me, updateMe };

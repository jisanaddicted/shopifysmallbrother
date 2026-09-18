import api from './api';
import { STORAGE_KEYS } from '../utils/constants';

// ---------------------------------------------------------------------------
// Session helpers (token + user persisted in localStorage)
// ---------------------------------------------------------------------------

export function getToken() {
  return localStorage.getItem(STORAGE_KEYS.TOKEN);
}

export function getStoredUser() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.USER);
    return raw ? JSON.parse(raw) : null;
  } catch {
    // Corrupted value in storage - treat it as "logged out".
    return null;
  }
}

export function saveSession({ token, user }) {
  if (token) localStorage.setItem(STORAGE_KEYS.TOKEN, token);
  if (user) localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
}

export function saveUser(user) {
  if (user) localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(STORAGE_KEYS.TOKEN);
  localStorage.removeItem(STORAGE_KEYS.USER);
}

// ---------------------------------------------------------------------------
// API calls - adjust the paths if your backend names them differently.
// ---------------------------------------------------------------------------

/**
 * POST /auth/login
 * Expected response: { token: "...", user: { _id, name, email, role } }
 */
export async function login(email, password) {
  const { data } = await api.post('/auth/login', { email, password });

  // Be forgiving about the exact response shape the server uses.
  const token = data.token || data.accessToken || data.jwt;
  const user = data.user || data.data?.user || null;
  const session = { token, user };

  saveSession(session);
  return session;
}

/**
 * POST /auth/register
 * Expected response: same shape as login.
 */
export async function register(payload) {
  const { data } = await api.post('/auth/register', payload);

  const token = data.token || data.accessToken || data.jwt;
  const user = data.user || data.data?.user || null;
  const session = { token, user };

  if (token || user) saveSession(session);
  return session;
}

/** GET /auth/me - used on refresh to confirm the stored token is still valid. */
export async function getProfile() {
  const { data } = await api.get('/auth/me');
  const user = data.user || data.data || data;

  saveUser(user);
  return user;
}

/** PATCH /auth/me - e.g. change name / phone / default address. */
export async function updateProfile(payload) {
  const { data } = await api.patch('/auth/me', payload);
  const user = data.user || data.data || data;

  saveUser(user);
  return user;
}

/**
 * GET /auth/username-available - used by the signup form to tell the user
 * whether their handle is free before they submit.
 */
export async function checkUsername(username) {
  const { data } = await api.get('/auth/username-available', {
    params: { username },
  });

  return data;
}

/** Clears the local session. Call the API first if you use refresh tokens. */
export function logout() {
  clearSession();
}

export default {
  login,
  register,
  getProfile,
  updateProfile,
  checkUsername,
  logout,
  getToken,
  getStoredUser,
  saveSession,
  saveUser,
  clearSession,
};

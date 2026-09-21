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

/**
 * The session response also lists every store the account runs, as
 * `[{ store, role }]` - `role` is "owner" or "admin". Persisted so a store
 * admin lands on the right dashboard even before /auth/me answers.
 */
export function saveStores(entries) {
  if (Array.isArray(entries)) {
    localStorage.setItem(STORAGE_KEYS.STORES, JSON.stringify(entries));
  }
}

export function getStoredStores() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.STORES);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function clearSession() {
  localStorage.removeItem(STORAGE_KEYS.TOKEN);
  localStorage.removeItem(STORAGE_KEYS.USER);
  localStorage.removeItem(STORAGE_KEYS.STORES);
}

// ---------------------------------------------------------------------------
// API calls - adjust the paths if your backend names them differently.
// ---------------------------------------------------------------------------

/** Pulls { token, user, stores } out of the shapes the auth endpoints use. */
function readSession(data) {
  return {
    token: data.token || data.accessToken || data.jwt,
    user: data.user || data.data?.user || null,
    stores: Array.isArray(data.stores)
      ? data.stores
      : data.stores?.entries || [],
  };
}

/**
 * POST /auth/login
 * Expected response: { token, user, store, stores: [{ store, role }] }
 */
export async function login(email, password) {
  const { data } = await api.post('/auth/login', { email, password });
  const session = readSession(data);

  saveSession(session);
  saveStores(session.stores);
  return session;
}

/**
 * POST /auth/register
 * Expected response: same shape as login.
 */
export async function register(payload) {
  const { data } = await api.post('/auth/register', payload);
  const session = readSession(data);

  if (session.token || session.user) saveSession(session);
  saveStores(session.stores);
  return session;
}

/**
 * GET /auth/me - used on refresh to confirm the stored token is still valid.
 * The store list is refreshed with it, so an account that just accepted a
 * store-admin invitation gets the dashboard without signing in again.
 */
export async function getProfile() {
  const { data } = await api.get('/auth/me');
  const user = data.user || data.data || data;
  const stores = Array.isArray(data.stores) ? data.stores : [];

  saveUser(user);
  saveStores(stores);
  return { user, stores };
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
  saveStores,
  getStoredStores,
  clearSession,
};

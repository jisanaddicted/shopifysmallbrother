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

/**
 * The stores this account *shops at*, as `[{ store, status, source, ... }]`.
 * Different from `stores` above, which is the ones the account *runs*. A
 * customer who signed up at /s/<slug> has that store here.
 */
export function saveCustomerStores(entries) {
  if (Array.isArray(entries)) {
    localStorage.setItem(STORAGE_KEYS.CUSTOMER_STORES, JSON.stringify(entries));
  }
}

export function getStoredCustomerStores() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CUSTOMER_STORES);
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
  localStorage.removeItem(STORAGE_KEYS.CUSTOMER_STORES);
}

// ---------------------------------------------------------------------------
// API calls - adjust the paths if your backend names them differently.
// ---------------------------------------------------------------------------

/**
 * Pulls { token, user, stores, customerStores } out of the shapes the auth
 * endpoints use. `stores` are the stores the account runs; `customerStores`
 * are the ones it shops at (see STORE_CUSTOMER_STATUS).
 */
function readSession(data) {
  return {
    token: data.token || data.accessToken || data.jwt,
    user: data.user || data.data?.user || null,
    stores: Array.isArray(data.stores)
      ? data.stores
      : data.stores?.entries || [],
    customerStores: Array.isArray(data.customerStores)
      ? data.customerStores
      : [],
  };
}

/** Persists the whole session. `storeSlug` below never touches storage. */
function persistSession(session) {
  saveSession(session);
  saveStores(session.stores);
  saveCustomerStores(session.customerStores);
  return session;
}

/**
 * POST /auth/login
 * Expected response: { token, user, store, stores, customerStores }
 *
 * `storeSlug` is the store whose page the shopper signed in from, e.g.
 * "joe-s-pizza" for /s/joe-s-pizza. Sending it records the sign-in against
 * that store, so an account created elsewhere becomes a customer of it.
 */
export async function login(email, password, storeSlug) {
  const { data } = await api.post('/auth/login', {
    email,
    password,
    ...(storeSlug ? { storeSlug } : {}),
  });

  return persistSession(readSession(data));
}

/**
 * POST /auth/register
 * Expected response: same shape as login.
 *
 * `payload.storeSlug` makes the new account a customer of that store - this is
 * the "I signed up at this store" case.
 */
export async function register(payload) {
  const { data } = await api.post('/auth/register', payload);
  const session = readSession(data);

  if (session.token || session.user) persistSession(session);
  return session;
}

/**
 * GET /auth/me - used on refresh to confirm the stored token is still valid.
 * The store lists are refreshed with it, so an account that just accepted a
 * store-admin invitation gets the dashboard without signing in again.
 */
export async function getProfile() {
  const { data } = await api.get('/auth/me');
  const user = data.user || data.data || data;
  const stores = Array.isArray(data.stores) ? data.stores : [];
  const customerStores = Array.isArray(data.customerStores)
    ? data.customerStores
    : [];

  saveUser(user);
  saveStores(stores);
  saveCustomerStores(customerStores);
  return { user, stores, customerStores };
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
  saveCustomerStores,
  getStoredCustomerStores,
  clearSession,
};

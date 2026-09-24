import axios from 'axios';
import { API_BASE_URL, STORAGE_KEYS } from '../utils/constants';

/**
 * The single axios instance the whole app talks through.
 * - baseURL comes from VITE_API_URL (.env)
 * - the JWT is attached automatically to every request
 * - every failure is turned into an Error with a readable `.message`
 */
const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

// --- Request: attach the bearer token --------------------------------------
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem(STORAGE_KEYS.TOKEN);
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// --- Response: normalise errors, handle expired sessions -------------------
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;

    // No `response` at all means the request never reached a server: the API
    // is down / not started, the URL or port is wrong, or the browser blocked
    // it (CORS). Axios calls this "Network Error", which tells the user nothing,
    // so say where we tried to connect instead.
    if (!error.response) {
      const timedOut =
        error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT';

      const unreachable = new Error(
        timedOut
          ? 'The server took too long to respond. Please try again.'
          : `Cannot reach the API server at ${API_BASE_URL}. Is the backend running?`,
      );
      unreachable.code = error.code;
      unreachable.original = error;

      return Promise.reject(unreachable);
    }

    const message =
      error.response?.data?.message ||
      error.response?.data?.error ||
      error.message ||
      'Something went wrong, please try again.';

    // Token missing/expired/invalid -> wipe the session and bounce to login.
    // BUT only when the request actually SENT a token: guest checkout/tracker
    // requests carry none, and their legitimate 401s (e.g. tracker opened
    // without its guestToken) must not log a signed-in user out.
    if (status === 401 && error.config?.headers?.Authorization) {
      localStorage.removeItem(STORAGE_KEYS.TOKEN);
      localStorage.removeItem(STORAGE_KEYS.USER);
      if (!window.location.pathname.startsWith('/login')) {
        window.location.assign('/login');
      }
    }

    const normalised = new Error(message);
    normalised.status = status;
    normalised.details = error.response?.data?.errors;
    normalised.original = error;

    return Promise.reject(normalised);
  },
);

export default api;

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
    const message =
      error.response?.data?.message ||
      error.response?.data?.error ||
      error.message ||
      'Something went wrong, please try again.';

    // Token missing/expired/invalid -> wipe the session and bounce to login.
    if (status === 401) {
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

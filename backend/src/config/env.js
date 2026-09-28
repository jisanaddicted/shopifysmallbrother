import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

// Always read backend/.env, no matter which directory the process was started
// from (root scripts use `npm --prefix backend`, which changes the cwd).
dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** Trailing slashes are stripped so `${url}/api/...` never doubles up. */
const toBaseUrl = (value, fallback) => {
  const raw = String(value || '').trim();
  const chosen = raw || fallback;
  return chosen.replace(/\/+$/, '');
};

// "a, b ,c" -> ['a', 'b', 'c']; falls back when nothing usable was provided.
const toList = (value, fallback) => {
  const entries = String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  return entries.length > 0 ? entries : fallback;
};

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: toInt(process.env.PORT, 5000),
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/delivery_app',
  // Optional DNS override, only needed when a router/VPN blocks the SRV
  // lookups that mongodb+srv:// URLs require. See config/db.js.
  mongoDnsServers: toList(process.env.MONGO_DNS_SERVERS, []),
  jwtSecret: process.env.JWT_SECRET || 'dev-only-insecure-secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  // The Vite dev server is a different origin, so CORS has to allow it.
  clientOrigins: toList(process.env.CLIENT_ORIGIN, [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ]),
  autoSeed: String(process.env.AUTO_SEED ?? 'true').toLowerCase() !== 'false',

  // --- SSLCommerz (sandbox) ------------------------------------------------
  // Online payment for the `card` method. Cash on delivery needs none of this -
  // it is the absence of a gateway, not a gateway configured differently.
  //
  // NOTE on the two URLs: they are NOT the same by default in a typical
  // deployment, but in THIS app they are, because the backend serves the built
  // client from the same origin (that is what makes one Cloudflare URL work).
  // `backendUrl` is the address the BANKER's BROWSER and SSLCommerz's servers
  // must be able to reach; `clientUrl` is where we send the shopper afterwards.
  // Point both at the public host when demoing through a tunnel, or the gateway
  // will redirect to a localhost URL the customer's phone cannot open.
  sslcommerz: {
    storeId: String(process.env.SSLCOMMERZ_STORE_ID || '').trim(),
    storePassword: String(process.env.SSLCOMMERZ_STORE_PASSWORD || '').trim(),
    // Third argument of the library is `live`, the inverse of "sandbox".
    isSandbox:
      String(process.env.SSLCOMMERZ_IS_SANDBOX ?? 'true').toLowerCase() !==
      'false',
    backendUrl: toBaseUrl(process.env.BACKEND_URL, 'http://localhost:5000'),
    clientUrl: toBaseUrl(
      process.env.CLIENT_URL,
      process.env.BACKEND_URL || 'http://localhost:5000',
    ),
    currency: String(process.env.PAYMENT_CURRENCY || 'BDT').trim() || 'BDT',
  },
};

/**
 * Are the gateway credentials actually present? Checked on every request that
 * needs them, so a demo without a sandbox password gets one clear sentence
 * instead of a library error about a missing store_id.
 */
export const isSslcommerzConfigured = () =>
  Boolean(config.sslcommerz.storeId && config.sslcommerz.storePassword);

export const isProduction = config.nodeEnv === 'production';

export default config;

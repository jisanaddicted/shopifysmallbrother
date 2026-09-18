import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

// Always read backend/.env, no matter which directory the process was started
// from (root scripts use `npm --prefix backend`, which changes the cwd).
dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
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
};

export const isProduction = config.nodeEnv === 'production';

export default config;

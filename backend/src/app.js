import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import { config } from './config/env.js';
import routes from './routes/index.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

/**
 * The browser talks to this API from a different origin (Vite dev server on
 * 5173, or a Cloudflare quick-tunnel URL), so CORS has to name the allowed
 * origins explicitly. Requests without an Origin header (curl, health checks)
 * are allowed through.
 *
 * Tunnel-friendly: any https://*.trycloudflare.com origin is accepted so a
 * fresh `cloudflared tunnel --url` works without editing backend/.env. Set
 * CLIENT_ORIGIN to lock this down for production.
 */
const TUNNEL_SUFFIX = '.trycloudflare.com';

const corsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (config.clientOrigins.includes('*')) return callback(null, true);
    if (config.clientOrigins.includes(origin)) return callback(null, true);
    if (origin.endsWith(TUNNEL_SUFFIX)) return callback(null, true);
    return callback(new Error(`Origin ${origin} is not allowed by CORS.`));
  },
  credentials: true,
};

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(cors(corsOptions));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Compact request log - noisy enough to help, quiet enough to leave on.
  if (config.nodeEnv !== 'production') {
    app.use((req, res, next) => {
      const startedAt = Date.now();
      res.on('finish', () => {
        console.log(
          `[api] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - startedAt}ms)`,
        );
      });
      next();
    });
  }

  app.use('/api', routes);

  // Serve the built Vite site (client/dist) from the same origin when it
  // exists — this is what makes ONE Cloudflare URL work for both the app
  // and the API. In dev (no dist) this is skipped silently.
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const distDir = path.resolve(here, '../../client/dist');
    if (fs.existsSync(path.join(distDir, 'index.html'))) {
      // index.html names the hashed JS bundle, so it must NEVER be served
      // from cache: a stale copy pins visitors to an old build after every
      // deploy (e.g. seeing the pre-fix logout behaviour). Hashed assets
      // keep their normal caching - only the entry document revalidates.
      app.use(
        express.static(distDir, {
          setHeaders: (res, filePath) => {
            if (filePath.endsWith('index.html')) {
              res.setHeader('Cache-Control', 'no-store');
            }
          },
        }),
      );
      // SPA fallback: anything not /api/* serves index.html (react-router).
      app.get(/^\/(?!api\/).*/, (req, res, next) => {
        if (req.method !== 'GET') return next();
        res.setHeader('Cache-Control', 'no-store');
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  } catch {
    // Static serving is a convenience — never break the API over it.
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp;

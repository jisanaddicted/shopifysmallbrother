import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import { config } from './config/env.js';
import routes from './routes/index.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { corsOriginFn } from './config/cors.js';
import { compressResponses } from './middleware/compress.js';

// The browser talks to this API from a different origin (Vite dev server on
// 5173, or a Cloudflare quick-tunnel URL), so CORS has to name the allowed
// origins explicitly - see config/cors.js, which socket.io shares.

const corsOptions = {
  origin: corsOriginFn,
  credentials: true,
};

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(cors(corsOptions));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  /* Compressible responses go out gzipped (brotli when the client offers it).
   *
   * Mounted before the routes AND before the static handler, so both the API's
   * JSON and the built client's assets are covered - a storefront response is
   * ~942KB and the JS bundle is another ~500KB, and neither was compressed
   * before this. See middleware/compress.js for what it refuses to touch and
   * why. */
  app.use(compressResponses());

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
      //
      // Everything under /assets/ is content-hashed by Vite, so the file name
      // changes whenever the bytes do. That makes it safe to cache for a year
      // and never revalidate: a returning visitor loads the app from cache
      // instead of re-downloading ~530KB on every single page load. Before
      // this, those files went out with `max-age=0`, which turned every visit
      // into a full re-download plus a conditional request per file - the
      // single largest source of perceived slowness in the app.
      //
      // The guard is the hash itself. If a future build stops hashing a file
      // (a fixed name like `logo.png`), only the hashed pattern is exempted
      // and the rest falls back to express.static's default revalidation,
      // which is the safe direction to fail.
      const ONE_YEAR = 31536000;
      app.use(
        express.static(distDir, {
          setHeaders: (res, filePath) => {
            if (filePath.endsWith('index.html')) {
              res.setHeader('Cache-Control', 'no-store');
              return;
            }
            // Vite's build output: /assets/<name>-<8 hex chars>.<ext>
            if (/-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/.test(filePath)) {
              res.setHeader('Cache-Control', `public, max-age=${ONE_YEAR}, immutable`);
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

import express from 'express';
import cors from 'cors';
import { config } from './config/env.js';
import routes from './routes/index.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

/**
 * The browser talks to this API from a different origin (Vite dev server on
 * 5173), so CORS has to name the allowed origins explicitly. Requests without
 * an Origin header (curl, health checks) are allowed through.
 */
const corsOptions = {
  origin(origin, callback) {
    if (!origin || config.clientOrigins.includes(origin)) {
      return callback(null, true);
    }
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

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp;

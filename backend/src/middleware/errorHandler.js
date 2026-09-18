import { isProduction } from '../config/env.js';

/**
 * An error we threw on purpose. The client reads `message` (and optionally
 * `errors`) off the response body, so those two fields are all that matter.
 */
export class HttpError extends Error {
  constructor(status, message, errors = undefined) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.errors = errors;
  }
}

/** 404 for anything that fell through the router. */
export function notFoundHandler(req, res) {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` });
}

/**
 * Single place where every failure becomes { message, errors? }.
 *
 * NOTE: this must keep 4 arguments, otherwise Express treats it as a normal
 * middleware and never calls it.
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  // Mongoose schema validation -> 400 with a per-field breakdown.
  if (err.name === 'ValidationError') {
    const errors = Object.fromEntries(
      Object.entries(err.errors || {}).map(([field, detail]) => [
        field,
        detail.message,
      ]),
    );

    return res.status(400).json({ message: 'Validation failed.', errors });
  }

  // Malformed ObjectId in a URL (/orders/abc) -> 400 instead of a 500.
  if (err.name === 'CastError') {
    return res.status(400).json({ message: `Invalid ${err.path}: ${err.value}` });
  }

  // Unique index violation, e.g. registering an email twice.
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || { email: '' })[0];
    return res
      .status(409)
      .json({ message: `That ${field} is already in use.` });
  }

  const status = err.status || err.statusCode || 500;
  const message =
    status === 500 && isProduction
      ? 'Something went wrong on the server.'
      : err.message || 'Something went wrong on the server.';

  if (status >= 500) {
    console.error('[error]', err);
  }

  const body = { message };
  if (err.errors) body.errors = err.errors;

  return res.status(status).json(body);
}

export default errorHandler;

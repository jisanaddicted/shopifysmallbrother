import { config } from '../config/env.js';

/**
 * One CORS policy, shared by the REST layer (app.js) and the socket.io
 * handshake (sockets/index.js).
 *
 * It used to be written out twice - once in each place - and the two copies had
 * already drifted: the REST side learned to accept a request from the API's own
 * origin, the socket side did not, and a build served by the backend loaded its
 * page but then failed every live-tracking connection with a 400. Sharing one
 * function means the two cannot disagree again.
 *
 * The browser reaches this API from a different origin in development (the Vite
 * dev server on 5173) and from the SAME origin in production (createApp serves
 * the built client from here, so one URL covers both the app and the API). Both
 * have to work.
 */

/** Any https://*.trycloudflare.com host, so a fresh quick-tunnel works. */
const TUNNEL_SUFFIX = '.trycloudflare.com';

/**
 * Is this origin the API's own host - loopback or LAN?
 *
 * Parsed as a URL rather than compared as a string, so `http://localhost:5000`
 * and `http://127.0.0.1:5000` both match the server that served the page.
 *
 * Self-requests carry no cross-origin risk: it is the same server answering
 * itself. Without this, a build served by the backend was rejected by its own
 * API (CLIENT_ORIGIN only lists the Vite dev ports) and rendered a blank page.
 */
export function isSelfOrigin(origin) {
  let host;
  try {
    host = new URL(origin).hostname;
  } catch {
    return false;
  }
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    // A LAN address (192.168.x.x / 10.x.x.x) is still this machine, not the
    // internet - it is how a phone on the same Wi-Fi reaches the demo.
    /^192\.168\.\d+\.\d+$/.test(host) ||
    /^10\.\d+\.\d+\.\d+$/.test(host)
  );
}

/**
 * Is this origin allowed to talk to the API?
 *
 * Returns null when it is allowed, or a reason string when it is not. Callers
 * turn that into their own rejection - an express `Error` for REST, the
 * socket.io callback for the handshake.
 */
export function originAllowed(origin) {
  // No Origin header at all: curl, health checks, server-to-server.
  if (!origin) return null;

  // A wildcard in config is an explicit "allow anything".
  if (config.clientOrigins.includes('*')) return null;

  if (config.clientOrigins.includes(origin)) return null;

  if (isSelfOrigin(origin)) return null;

  let isTunnel = false;
  try {
    isTunnel = new URL(origin).hostname.endsWith(TUNNEL_SUFFIX);
  } catch {
    isTunnel = false;
  }
  if (isTunnel) return null;

  return `Origin ${origin} is not allowed by CORS.`;
}

/**
 * The `origin` callback both the express `cors` middleware and socket.io expect.
 */
export function corsOriginFn(origin, callback) {
  const reason = originAllowed(origin);
  if (reason) return callback(new Error(reason));
  return callback(null, true);
}

export default corsOriginFn;

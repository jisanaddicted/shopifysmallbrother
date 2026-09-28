// Prints the public URLs the backend will hand to payment gateways. Quick
// tunnels get a NEW random hostname every run, so a stale BACKEND_URL here is
// the usual reason a customer's phone lands on a dead page after paying.
// Run: node scripts/whereAmI.mjs
import { config, isSslcommerzConfigured } from '../src/config/env.js';

const s = config.sslcommerz;

console.log(`gateway creds : ${isSslcommerzConfigured() ? 'set' : 'MISSING (COD only)'}`);
console.log(`sandbox       : ${s.isSandbox}`);
console.log(`backendUrl    : ${s.backendUrl}`);
console.log(`clientUrl     : ${s.clientUrl}`);
console.log(`origins       : ${config.clientOrigins.join(', ')}`);
console.log(`port          : ${config.port}`);

// The failure this script exists to catch: the configured public host does not
// answer, so a customer's phone would be redirected into nothing after paying.
try {
  const res = await fetch(`${s.backendUrl}/api/health`, {
    signal: AbortSignal.timeout(15000),
  });
  console.log(`\nhealth        : ${res.status} ${res.ok ? 'reachable' : 'UNHEALTHY'}`);
} catch (err) {
  console.log(`\nhealth        : UNREACHABLE - ${err.message}`);
  console.log('  A quick tunnel gets a new hostname each run. Re-run expose-site.bat');
  console.log('  and update BACKEND_URL / CLIENT_URL in backend/.env to match.');
}

// No process.exit() here on purpose: forcing an exit while the undici keep-alive
// socket is still closing trips a libuv assertion on Windows and prints a scary
// "Assertion failed" after the useful output. Let the loop drain instead.

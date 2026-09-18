import http from 'node:http';
import { config } from './config/env.js';
import { connectDB, disconnectDB } from './config/db.js';
import { createApp } from './app.js';
import { initSockets } from './sockets/index.js';
import { DEMO_PASSWORD, seedDemoData } from './seed.js';

async function start() {
  console.log(`[api] starting in ${config.nodeEnv} mode`);

  // The database has to be reachable before we accept any traffic.
  await connectDB();

  if (config.autoSeed) {
    const summary = await seedDemoData();
    console.log(
      `[seed] demo accounts ready (created: ${summary.users.created.length}, ` +
        `refreshed: ${summary.users.updated.length}, password: ${DEMO_PASSWORD})`,
    );
  }

  const app = createApp();
  const server = http.createServer(app);

  // socket.io shares the same HTTP server (and therefore the same port).
  initSockets(server);

  await new Promise((resolve) => server.listen(config.port, resolve));

  console.log(`[api] REST   -> http://localhost:${config.port}/api`);
  console.log(`[api] socket -> http://localhost:${config.port}`);

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(`\n[api] ${signal} received - shutting down`);
    server.close();

    try {
      await disconnectDB();
    } catch (err) {
      console.error('[api] error while closing the database:', err.message);
    }

    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch((err) => {
  console.error('[api] failed to start:', err.message);

  // The most common failures by far - say exactly what to do about each.
  if (/querySrv|queryTxt/i.test(err.message)) {
    console.error(
      '[api] your DNS resolver refused the SRV lookup for the Atlas cluster. ' +
        'Set MONGO_DNS_SERVERS=8.8.8.8,1.1.1.1 in backend/.env.',
    );
  } else if (/ECONNREFUSED|server selection/i.test(err.message)) {
    console.error(
      '[api] could not reach MongoDB. Check MONGO_URI in backend/.env, and - for Atlas - ' +
        'that this machine\'s IP is on the cluster\'s Network Access allow-list.',
    );
  } else if (/Authentication failed|bad auth/i.test(err.message)) {
    console.error(
      '[api] MongoDB rejected the credentials in MONGO_URI (check the user and password).',
    );
  }

  process.exit(1);
});

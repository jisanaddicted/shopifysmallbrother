import http from 'node:http';
import { config } from './config/env.js';
import { connectDB, disconnectDB } from './config/db.js';
import { createApp } from './app.js';
import { initSockets } from './sockets/index.js';
import { DEMO_PASSWORD, seedDemoData } from './seed.js';
import { warmStorefronts } from './controllers/storeController.js';
import { imageHostingReady } from './services/cloudinary.js';
import { config as appConfig } from './config/env.js';

async function start() {
  console.log(`[api] starting in ${config.nodeEnv} mode`);

  // The database has to be reachable before we accept any traffic.
  await connectDB();

  if (config.autoSeed) {
    const summary = await seedDemoData();
    console.log(
      `[seed] demo data ready (users +${summary.users.created.length}/~${summary.users.updated.length}, ` +
        `stores +${summary.stores.created.length}/~${summary.stores.updated.length}, ` +
        `products +${summary.products.created}, ` +
        `team +${summary.memberships.created.length}/~${summary.memberships.updated.length}, ` +
        `password: ${DEMO_PASSWORD})`,
    );
    console.log('[seed] storefronts: /s/joes-pizza and /s/green-grocer');
    console.log(
      '[seed] store admin: storeadmin@example.com helps run /s/joes-pizza',
    );
  }

  const app = createApp();
  const server = http.createServer(app);

  // socket.io shares the same HTTP server (and therefore the same port).
  initSockets(server);

  await new Promise((resolve) => server.listen(config.port, '0.0.0.0', resolve));

  console.log(`[api] REST   -> http://localhost:${config.port}/api`);
  console.log(`[api] socket -> http://localhost:${config.port}`);
  console.log(`[api] LAN    -> http://<this-machine-ip>:${config.port}/api (same Wi-Fi)`);

  /* Warm the public storefront cache in the background.
   *
   * The cache lives in this process, so every restart starts it empty - and the
   * first storefront visit after a restart pays for that: measured at 7.5s on
   * this project's data, against 15ms once warm. In development `node --watch`
   * restarts on every file save, which made the slow path the normal one.
   *
   * Deliberately NOT awaited, and after `listen` rather than before it: warming
   * is a nice-to-have, and a slow or unreachable database must not delay the
   * server answering anything. It cannot throw into startup either - every
   * failure is caught and only ever logged. */
  warmStorefronts()
    .then(({ warmed, failed, slugs }) => {
      console.log(
        `[api] warmed ${warmed} storefront(s)${failed ? ` (${failed} failed)` : ''}` +
          (slugs?.length ? `: ${slugs.join(', ')}` : ''),
      );
    })
    .catch((err) => {
      console.warn('[api] storefront warm-up skipped:', err.message);
    });

  /* Say out loud, at boot, whether images are hosted or inline.
   *
   * Silently storing pictures inline because the Cloudinary credentials are
   * wrong would look exactly like "it works" while quietly reintroducing the
   * 900KB storefront payload this was meant to remove. One line in the log is
   * the difference between a configuration mistake found now and a mystery
   * found next month. Un-awaited: Cloudinary must never delay `listen`. */
  imageHostingReady()
    .then((ready) => {
      console.log(
        ready
          ? `[images] hosted on Cloudinary (cloud "${appConfig.cloudinary.cloudName}", folder "${appConfig.cloudinary.folder}")`
          : '[images] hosting OFF - images are stored inline as base64 (check CLOUDINARY_* in backend/.env)',
      );
    })
    .catch(() => {});

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

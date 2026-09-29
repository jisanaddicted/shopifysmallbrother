import dns from 'node:dns';
import mongoose from 'mongoose';
import { config } from './env.js';

/**
 * mongodb+srv:// URLs need an SRV DNS lookup ("_mongodb._tcp.<cluster>...").
 *
 * Some routers, VPNs and DNS proxies refuse those queries. Node resolves DNS
 * through c-ares using its own server list, so the failure looks like:
 *
 *   querySrv ECONNREFUSED _mongodb._tcp.<cluster>.mongodb.net
 *
 * Which is easy to mistake for "the cluster is down". Pointing Node's resolver
 * at a public DNS server that does answer SRV queries fixes it. Set
 * MONGO_DNS_SERVERS in .env to enable this (leave it empty to use the OS list).
 */
function applyDnsOverride() {
  if (config.mongoDnsServers.length === 0) return;

  dns.setServers(config.mongoDnsServers);
  console.log(`[db] dns servers -> ${config.mongoDnsServers.join(', ')}`);
}

/**
 * Connects to MongoDB. Resolves once the connection is ready, so the HTTP
 * server is only started after the database is reachable.
 */
export async function connectDB() {
  mongoose.set('strictQuery', true);
  applyDnsOverride();

  // Generous on purpose: a remote Atlas cluster may need to wake up first.
  // Failing fast with a clear message beats hanging for the 30s default.
  await mongoose.connect(config.mongoUri, {
    serverSelectionTimeoutMS: 15000,

    // The database is a REMOTE Atlas cluster, so every query pays a network
    // round trip. The driver defaults to a pool of 5, which is far too small
    // once a page fires several queries in parallel - the extra ones queue
    // behind the pool and each adds a full round trip of waiting.
    //
    // maxPoolSize 20 covers the widest fan-out in the app (the merchant
    // dashboard and the order board both load several collections at once)
    // without opening connections nobody needs.
    maxPoolSize: 20,

    // Never let a request hang on an exhausted pool. Without this a saturated
    // pool makes requests queue for the driver's 30s default instead of
    // failing over to the read preference below, which is the whole point of
    // having one.
    waitQueueTimeoutMS: 10000,

    // Retry a read once against a secondary if the primary is briefly
    // unavailable. Every dashboard read in this app is a read, so this turns a
    // brief primary election from a pile of failed requests into a slower
    // response instead.
    readPreference: 'primaryPreferred',
    retryReads: true,
    retryWrites: true,
  });

  const { host, port, name } = mongoose.connection;
  console.log(`[db] connected to ${name} at ${host}${port ? `:${port}` : ''}`);

  mongoose.connection.on('disconnected', () => {
    console.warn('[db] disconnected');
  });

  return mongoose.connection;
}

export async function disconnectDB() {
  await mongoose.connection.close();
  console.log('[db] connection closed');
}

export default connectDB;

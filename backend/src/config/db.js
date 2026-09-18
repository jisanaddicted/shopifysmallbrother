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
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 15000 });

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

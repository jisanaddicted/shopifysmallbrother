import mongoose from 'mongoose';
import { config } from './env.js';

/**
 * Connects to MongoDB. Resolves once the connection is ready, so the HTTP
 * server is only started after the database is reachable.
 */
export async function connectDB() {
  mongoose.set('strictQuery', true);

  // Fail fast with a clear message instead of hanging for the default 30s.
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 10000 });

  const { host, port, name } = mongoose.connection;
  console.log(`[db] connected to mongodb://${host}:${port}/${name}`);

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

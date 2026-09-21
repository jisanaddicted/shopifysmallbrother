import mongoose from 'mongoose';
import { connectDB } from './src/config/db.js';
await connectDB();
const users = await mongoose.connection.collection('users').find({}, { projection: { username: 1, name: 1, email: 1, role: 1 } }).sort({ role: 1, username: 1 }).toArray();
console.log('USER COUNT:', users.length);
for (const u of users) console.log(`${u.role || '?'} | username=${JSON.stringify(u.username ?? null)} | ${u.email}`);
await mongoose.disconnect();

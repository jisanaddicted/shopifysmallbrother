import mongoose from 'mongoose';
import { connectDB } from './src/config/db.js';
import User from './src/models/User.js';
await connectDB();
const users = await User.find({}).select('username name email role').sort('username').lean();
console.log(JSON.stringify(users.map(u => ({ username: u.username, name: u.name, role: u.role, email: u.email })), null, 1));
await mongoose.disconnect();

import mongoose from 'mongoose';
import { connectDB } from './src/config/db.js';
import User from './src/models/User.js';

await connectDB();
const users = await User.find({})
  .select('name email username role')
  .sort({ email: 1 })
  .lean();
console.log(JSON.stringify(users, null, 2));
await mongoose.disconnect();

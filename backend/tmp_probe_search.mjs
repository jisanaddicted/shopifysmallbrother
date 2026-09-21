import mongoose from 'mongoose';
import { connectDB } from './src/config/db.js';
import User from './src/models/User.js';

const BASE = 'http://localhost:5000/api';

async function main() {
  await connectDB();

  console.log('=== ALL USERS IN DB ===');
  const users = await User.find({}).select('username email role').lean();
  for (const u of users) {
    console.log(`username=${u.username || '(none)'} | email=${u.email} | role=${u.role}`);
  }

  const loginRes = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'store@example.com', password: 'password123' }),
  });
  const login = await loginRes.json();

  console.log('\n=== LOOKUP PROBES ===');
  for (const q of [
    '@ada.admin',
    'ada.admin',
    'sara.admin',
    '@sara.admin',
    'sam.rider',
    '@sam.rider',
  ]) {
    const res = await fetch(
      `${BASE}/users/lookup?username=${encodeURIComponent(q)}`,
      { headers: { Authorization: `Bearer ${login.token}` } },
    );
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = '(non-json)';
    }
    console.log(`q="${q}" -> ${res.status} ${JSON.stringify(body).slice(0, 180)}`);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

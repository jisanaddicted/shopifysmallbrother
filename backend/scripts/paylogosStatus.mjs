/* Read the current paymentLogos and leave the store clean.

   Run after scripts/livePaymentLogos.mjs, which deliberately leaves the demo
   store as it found it. This is the "what is actually on it right now" probe -
   useful on its own when a run is interrupted part way and leaves a logo behind.

     node scripts/paylogosStatus.mjs
*/
const BASE = process.env.BULK_API?.replace(/\/api\/?$/, '') || 'http://127.0.0.1:5000';
const EMAIL = process.env.SMOKE_EMAIL || 'store@example.com';
const PASSWORD = process.env.SMOKE_PASSWORD || 'password123';

const call = async (method, path, { token, body } = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json };
};

/* The public storefront payload for this store is around 2MB (categoryImages is
   base64 per category), which is big enough that a single fetch occasionally
   gets reset mid-body. One retry is enough and keeps the probe honest. */
const publicStore = async (slug) => {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await call('GET', `/api/stores/${slug}`);
      return res.json?.store || {};
    } catch (err) {
      if (attempt === 3) throw err;
      console.log(`  (read reset, retry ${attempt})`);
    }
  }
  return {};
};

const login = await call('POST', '/api/auth/login', {
  body: { email: EMAIL, password: PASSWORD },
});
const token = login.json?.data?.token || login.json?.token;
if (!token) throw new Error(`login failed: ${login.status}`);

const mine = await call('GET', '/api/stores/mine', { token });
const storeId = mine.json?.data?.store?._id || mine.json?.store?._id;
const slug = mine.json?.data?.store?.slug || mine.json?.store?.slug;

console.log(`store: ${slug} (${storeId})`);

const before = await publicStore(slug);
const keys = Object.keys(before.paymentLogos || {});
console.log(`paymentLogos right now: ${keys.length ? keys.join(', ') : '(none)'}`);
for (const [k, v] of Object.entries(before.paymentLogos || {})) {
  console.log(`  ${k} -> ${String(v).slice(0, 90)}`);
}

if (keys.length) {
  const cleared = await call(
    'PATCH',
    `/api/stores/mine?storeId=${storeId}`,
    { token, body: { paymentLogos: Object.fromEntries(keys.map((k) => [k, ''])) } },
  );
  console.log(`cleanup: status ${cleared.status}`);
} else {
  console.log('cleanup: nothing to remove');
}

const after = await publicStore(slug);
const left = Object.keys(after.paymentLogos || {});
console.log(`paymentLogos after cleanup: ${left.length ? left.join(', ') : '(none)'}`);
console.log(left.length ? 'STILL DIRTY' : 'CLEAN');
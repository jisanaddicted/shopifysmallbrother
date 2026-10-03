/* An end-to-end check of the payment-brand upload, against the RUNNING backend.

   The contract test (testPaymentLogos.mjs) reads source; this one exercises the
   real thing: a real store owner, a real base64 PNG going to Cloudinary, the real
   public storefront payload a checkout reads.

   The part that matters most is the MERGE. "Save bKash, then save Nagad" must
   leave BOTH set. A plain assignment passes every other check here and still
   loses a merchant's logos.

     node scripts/livePaymentLogos.mjs
*/
const BASE =
  process.env.BULK_API?.replace(/\/api\/?$/, '') ||
  'http://127.0.0.1:5000';
const EMAIL = process.env.SMOKE_EMAIL || 'store@example.com';
const PASSWORD = process.env.SMOKE_PASSWORD || 'password123';

// A real 1x1 PNG, so hostImage has actual image bytes to work with.
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let pass = 0;
let fail = 0;
const check = (label, ok, detail = '') => {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
};

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
  return { status: res.status, json, text };
};

console.log(`--- logging in as the store OWNER (${EMAIL}) ---`);
// Not storeadmin@example.com, which the seed log also names: that account is an
// ordinary CUSTOMER the owner appointed, so it is refused at the portal door
// with a 403 AND is not the OWNER that updateMyStore requires. The storefront
// settings belong to store@example.com alone.
const login = await call('POST', '/api/auth/login', {
  body: { email: EMAIL, password: PASSWORD },
});
const token = login.json?.data?.token || login.json?.token;
check('the seeded store owner can sign in', Boolean(token), login.status);

if (!token) {
  console.log('\nno token - cannot continue');
  process.exit(1);
}

const mine = await call('GET', '/api/stores/mine', { token });
const storeId = mine.json?.data?.store?._id || mine.json?.store?._id;
const slug = mine.json?.data?.store?.slug || mine.json?.store?.slug;
check('their store is readable', Boolean(storeId), slug);

/* The public storefront payload for this store is around 2MB (categoryImages is
   a base64 data URL per category), which is large enough that a single fetch is
   occasionally reset part way through the body. Two attempts is plenty, and the
   retry keeps a flaky read from being mistaken for a missing field. */
const publicLogos = async () => {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await call('GET', `/api/stores/${slug}`);
      return res.json?.store?.paymentLogos || {};
    } catch (err) {
      if (attempt === 3) throw err;
      console.log(`  (storefront read reset, retry ${attempt})`);
    }
  }
  return {};
};

console.log('\n--- uploading the bKash mark ---');
const one = await call('PATCH', `/api/stores/mine?storeId=${storeId}`, {
  token,
  body: { paymentLogos: { bkash: PNG } },
});
check('saved without an error', one.status === 200, `status ${one.status}`);
const bkashUrl = String(one.json?.store?.paymentLogos?.bkash || '');
check(
  'it came back as a CLOUDINARY url, not the base64 we sent',
  /^https?:\/\//.test(bkashUrl) && !bkashUrl.startsWith('data:'),
  bkashUrl.slice(0, 70) || '(empty)',
);

console.log('\n--- uploading the Nagad mark (the merge test) ---');
const two = await call('PATCH', `/api/stores/mine?storeId=${storeId}`, {
  token,
  body: { paymentLogos: { nagad: PNG } },
});
const after = two.json?.store?.paymentLogos || {};
check('nagad is set', Boolean(after.nagad), after.nagad ? 'yes' : 'no');
check(
  'AND bkash is STILL set - saving one channel did not wipe the other',
  Boolean(after.bkash),
  after.bkash === bkashUrl
    ? 'same url, untouched'
    : after.bkash
      ? 'present but CHANGED - suspicious'
      : 'LOST',
);

console.log('\n--- the checkout can see them ---');
const shown = await publicLogos();
check('the PUBLIC store payload carries paymentLogos', Boolean(shown.bkash));
check('with both logos, for the storefront cache path', Boolean(shown.nagad));

console.log('\n--- the closed key set ---');
const bad = await call('PATCH', `/api/stores/mine?storeId=${storeId}`, {
  token,
  body: { paymentLogos: { cod: PNG } },
});
check('"cod" is refused with a 400', bad.status === 400, `status ${bad.status}`);
const junk = await call('PATCH', `/api/stores/mine?storeId=${storeId}`, {
  token,
  body: { paymentLogos: { upay: PNG } },
});
check('an unknown channel ("upay") is refused too', junk.status === 400, `status ${junk.status}`);

console.log('\n--- cleaning up, so the demo store is left as it was ---');
const cleared = await call('PATCH', `/api/stores/mine?storeId=${storeId}`, {
  token,
  body: { paymentLogos: { bkash: '', nagad: '' } },
});
const left = cleared.json?.store?.paymentLogos || {};
check(
  'clearing both leaves an empty map',
  !left.bkash && !left.nagad,
  Object.keys(left).join(', ') || '(none)',
);
check(
  'and the refusal above did not sneak one in',
  !(await publicLogos()).cod,
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
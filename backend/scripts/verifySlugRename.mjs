// Live end-to-end proof that renaming a store from the dashboard now moves its
// public URL. Registers a throwaway store through the PUBLIC API (exactly the
// path a merchant takes), renames it via PATCH /stores/mine (exactly what the
// dashboard form posts), and checks the storefront link follows.
//
//   node scripts/verifySlugRename.mjs
//
// Not part of `npm test`: this one needs the server running, and it talks to
// whatever BULK_API points at - so it also works against a Cloudflare tunnel.
// Everything it creates is removed in the finally block.
// `set X=y &&` in cmd.exe stores the space before `&&` AS PART OF THE VALUE,
// which turns every path into `/api%20/auth/register` -> "Route not found".
// This is the same trap client/src/utils/constants.js documents for
// VITE_API_URL; trim it so it cannot bite here too.
const API = (process.env.BULK_API || 'http://localhost:5000/api')
  .trim()
  .replace(/\/+$/, '');

const stamp = Date.now();
const name = `Slug Proof ${stamp}`;
// A username is capped at 20 characters (isValidUsername), so the stamp cannot
// go in verbatim - `slugproof.1790848400000` is 22. Only the tail is kept,
// which is still unique enough to identify the throwaway account afterwards.
const username = `sp${String(stamp).slice(-12)}`;
const pass = [];
const fail = [];
const check = (label, ok, detail = '') => {
  (ok ? pass : fail).push(label);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
};

const call = async (method, path, { body, token } = {}) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data = {};
  try {
    data = JSON.parse(text);
  } catch {
    // Not JSON - almost always the SPA fallback serving index.html, which means
    // the request reached the frontend and not the API. Keep the raw text so the
    // failure says WHY instead of just "got 404".
    data = { raw: text.slice(0, 200) };
  }
  if (process.env.VERBOSE && res.status >= 400) {
    console.log(`   [debug] ${method} ${path} -> ${res.status} ${JSON.stringify(data).slice(0, 300)}`);
  }
  return { status: res.status, data };
};

const storeSlug = (d) => d?.store?.slug || d?.slug || '';

console.log(`\nLive slug/rename proof against ${API}\n`);

let token = '';
let storeId = '';
let email = '';

try {
  // 1. Register the way the signup form does - the slug is derived from the name.
  //    `username` is REQUIRED for a store account (it is how an owner is later
  //    found to invite), so omitting it is a 400, not a store.
  email = `slug.proof.${stamp}@example.com`;
  const reg = await call('POST', '/auth/register', {
    body: {
      name: `Slug Owner ${stamp}`,
      email,
      username,
      password: 'password123',
      role: 'store',
      storeName: name,
    },
  });
  token = reg.data?.token || '';
  storeId = String(reg.data?.store?._id || '');
  // 201, not 200: this endpoint CREATES the account. (An earlier run of this
  // script asserted 200 and "failed" a perfectly good registration.)
  check(
    'registered a store through the public API',
    reg.status === 201 && !!token,
    `got ${reg.status}`,
  );
  // The name is stamped, so the slug is the stamped form - and uniqueSlug may
  // append -2 if an earlier proof run has not been cleaned up yet, so only the
  // prefix is asserted.
  check(
    'its slug was derived from the name',
    /^slug-proof/.test(storeSlug(reg.data)),
    storeSlug(reg.data),
  );
  const derivedSlug = storeSlug(reg.data);

  // 2. Rename it, posting EXACTLY what the dashboard form posts: the name, and
  //    the slug box with slugLocked:false (the box follows the name, unlocked).
  const newName = `Slug Proof Renamed ${stamp}`;
  const renamed = await call('PATCH', '/stores/mine', {
    token,
    body: { name: newName, slug: 'slug-proof-renamed', slugLocked: false },
  });
  check('the rename was accepted', renamed.status === 200, `got ${renamed.status}`);
  check(
    'and the slug MOVED with the name',
    storeSlug(renamed.data) === 'slug-proof-renamed',
    storeSlug(renamed.data),
  );

  // 3. The new public URL answers, and the old one is gone.
  const fresh = await call('GET', `/stores/${storeSlug(renamed.data)}`);
  check(
    'the NEW public URL serves the storefront',
    fresh.status === 200 && fresh.data?.store?.name === newName,
    `got ${fresh.status}`,
  );

  // The old URL must be gone. This uses the slug the store ACTUALLY had, not a
  // guessed one - a guess tests nothing when uniqueSlug has already appended -2.
  const stale = await call('GET', `/stores/${derivedSlug}`);
  check(
    'the OLD public URL no longer resolves',
    stale.status === 404,
    `got ${stale.status} for /${derivedSlug}`,
  );

  // 4. A claimed slug must NOT move - this is the half that protects links
  //    already printed on a menu, and the half most likely to regress.
  const claimed = await call('PATCH', '/stores/mine', {
    token,
    body: { name: `Slug Proof Third ${stamp}`, slug: 'my-chosen-address', slugLocked: true },
  });
  check(
    'the merchant can claim a slug',
    storeSlug(claimed.data) === 'my-chosen-address',
    storeSlug(claimed.data),
  );

  const afterClaim = await call('PATCH', '/stores/mine', {
    token,
    body: { name: `Slug Proof Fourth ${stamp}`, slug: 'my-chosen-address', slugLocked: true },
  });
  check(
    'and a later rename leaves that claimed slug alone',
    storeSlug(afterClaim.data) === 'my-chosen-address',
    storeSlug(afterClaim.data),
  );
  check(
    'while the name did change',
    afterClaim.data?.store?.name === `Slug Proof Fourth ${stamp}`,
    afterClaim.data?.store?.name,
  );
} catch (err) {
  console.error('\ncrashed:', err.message);
  fail.push(`crashed: ${err.message}`);
} finally {
  // There is no owner-delete endpoint, so the store and its throwaway account
  // are removed through the models, the same way testStoreSlug.mjs does it.
  if (storeId) {
    try {
      const { connectDB, disconnectDB } = await import('../src/config/db.js');
      const { default: Store } = await import('../src/models/Store.js');
      const { default: User } = await import('../src/models/User.js');
      await connectDB();
      await Store.deleteOne({ _id: storeId });
      await User.deleteMany({ email });
      // Also sweep any store left by an EARLIER run of this script, so repeated
      // runs cannot collide on the `slug-proof` prefix and append -2 forever.
      const swept = await Store.deleteMany({
        slug: { $in: ['slug-proof', 'slug-proof-renamed', 'my-chosen-address'] },
      });
      await User.deleteMany({ email: /^slug\.proof\./ });
      await disconnectDB();
      console.log(
        `cleaned up the proof store, its account, and ${swept.deletedCount} leftover(s)`,
      );
    } catch (e) {
      console.log(`cleanup skipped: ${e.message}`);
    }
  }
}

console.log(`\n${pass.length} passed, ${fail.length} failed\n`);
process.exit(fail.length === 0 ? 0 : 1);

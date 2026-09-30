/**
 * The public storefront cache: stale-while-revalidate semantics.
 *
 * No database, no HTTP, and no waiting on a real TTL - the TTL is read from the
 * environment at import time, so this test sets a 50ms one and reaches the
 * expired-entry path in a fraction of a second.
 *
 *   node scripts/testStorefrontCache.mjs
 *
 * What it locks in is the change that made a storefront open fast: an entry past
 * its TTL is still ANSWERED FROM (7.5s -> 15ms, measured on this project's own
 * data), the rebuild happens behind the caller, and a failed rebuild leaves the
 * stale copy in place rather than blanking the shop.
 */
process.env.STOREFRONT_CACHE_TTL_MS = '50';

const {
  clearCache,
  getAnyBySlug,
  getCached,
  getCachedBySlug,
  invalidateStore,
  refreshInBackground,
  rememberSlug,
  setCached,
  SLOTS,
} = await import('../src/utils/storefrontCache.js');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let pass = 0;
let fail = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  ok ? pass++ : fail++;
};

const STORE = '6aad6c1b042e57d92f96276a';

// --- 1. A fresh entry is fresh ------------------------------------------------
clearCache();
setCached(STORE, SLOTS.STORE, { v: 1 }, 'joes-pizza');
{
  const any = getAnyBySlug('joes-pizza', SLOTS.STORE);
  check(
    'fresh entry: answered, marked fresh',
    any?.fresh === true && any.payload.v === 1 && any.storeId === STORE,
    JSON.stringify(any),
  );
  check(
    'getCachedBySlug still works',
    getCachedBySlug('joes-pizza', SLOTS.STORE)?.v === 1,
  );
}

// --- 2. Past the TTL it is STILL answered, but no longer "fresh" --------------
await sleep(80);
{
  const any = getAnyBySlug('joes-pizza', SLOTS.STORE);
  check(
    'expired entry: STILL answered, marked stale',
    any?.fresh === false && any.payload.v === 1,
    JSON.stringify(any),
  );
}

// --- 3. ...but the old strict read really would have given up -----------------
// This is the whole change: `getCached` (the only read the routes used before)
// DELETES an expired entry and drops the caller into a multi-second rebuild.
// Note the ORDER of these three checks - it is the ordering the route handlers
// depend on: ask the stale-tolerant read FIRST, because the strict one consumes
// the entry on its way past.
clearCache();
setCached(STORE, SLOTS.STORE, { v: 1 }, 'joes-pizza');
await sleep(80);
{
  check(
    'getAnyBySlug still has it - the new behaviour',
    getAnyBySlug('joes-pizza', SLOTS.STORE)?.payload.v === 1,
  );
  check(
    'getCached (strict) refuses an expired entry - the old behaviour',
    getCached(STORE, SLOTS.STORE) === undefined,
  );
  check(
    '...and it consumed the entry, which is why the routes read getAnyBySlug first',
    getAnyBySlug('joes-pizza', SLOTS.STORE) === undefined,
  );
}

// --- 4. A background refresh does not block, and lands ------------------------
clearCache();
setCached(STORE, SLOTS.STORE, { v: 1 }, 'joes-pizza');
await sleep(80);
{
  let builds = 0;
  const started = Date.now();
  const task = refreshInBackground(SLOTS.STORE, STORE, async () => {
    builds++;
    await sleep(120);
    setCached(STORE, SLOTS.STORE, { v: 2 }, 'joes-pizza');
    return { v: 2 };
  });
  const returnedIn = Date.now() - started;

  check(
    'refreshInBackground returns immediately (the rebuild is behind the caller)',
    returnedIn < 30,
    `returned in ${returnedIn}ms`,
  );
  check(
    'the stale entry is served while it rebuilds',
    getAnyBySlug('joes-pizza', SLOTS.STORE)?.payload.v === 1,
  );

  await task;
  check(
    'the rebuilt payload replaced the stale one',
    getAnyBySlug('joes-pizza', SLOTS.STORE)?.payload.v === 2,
  );
  check(
    'the rebuilt entry is fresh again',
    getAnyBySlug('joes-pizza', SLOTS.STORE)?.fresh === true,
  );
  check('the producer ran exactly once', builds === 1, `builds=${builds}`);
}

// --- 5. A burst on an expired entry triggers ONE rebuild, not one each --------
clearCache();
setCached(STORE, SLOTS.STORE, { v: 1 }, 'joes-pizza');
await sleep(80);
{
  let builds = 0;
  const producer = async () => {
    builds++;
    await sleep(60);
    setCached(STORE, SLOTS.STORE, { v: 9 }, 'joes-pizza');
    return { v: 9 };
  };

  await Promise.all([
    refreshInBackground(SLOTS.STORE, STORE, producer),
    refreshInBackground(SLOTS.STORE, STORE, producer),
    refreshInBackground(SLOTS.STORE, STORE, producer),
    refreshInBackground(SLOTS.STORE, STORE, producer),
  ]);

  check('four concurrent refreshes share one build', builds === 1, `builds=${builds}`);
  check(
    'the shared result is in the cache',
    getAnyBySlug('joes-pizza', SLOTS.STORE)?.payload.v === 9,
  );
}

// --- 6. A FAILED rebuild keeps the stale copy and does not crash the process --
clearCache();
setCached(STORE, SLOTS.STORE, { v: 1 }, 'joes-pizza');
await sleep(80);
{
  const rejections = [];
  const onRejection = (err) => rejections.push(err);
  process.on('unhandledRejection', onRejection);

  refreshInBackground(SLOTS.STORE, STORE, async () => {
    throw new Error('database went away');
  });

  await sleep(60);
  process.off('unhandledRejection', onRejection);

  check(
    'a failed rebuild leaves the stale payload in place',
    getAnyBySlug('joes-pizza', SLOTS.STORE)?.payload.v === 1,
  );
  check(
    'a failed rebuild is not an unhandled rejection',
    rejections.length === 0,
    `${rejections.length} rejections`,
  );

  // ...and the next request can try again rather than finding a dead entry.
  let retried = 0;
  await refreshInBackground(SLOTS.STORE, STORE, async () => {
    retried++;
    setCached(STORE, SLOTS.STORE, { v: 3 }, 'joes-pizza');
    return { v: 3 };
  });
  check(
    'a later rebuild can retry after a failure',
    retried === 1 && getAnyBySlug('joes-pizza', SLOTS.STORE)?.payload.v === 3,
  );
}

// --- 7. Invalidation still wins over everything --------------------------------
clearCache();
setCached(STORE, SLOTS.STORE, { v: 1 }, 'joes-pizza');
setCached(STORE, SLOTS.TREE, { tree: [] }, 'joes-pizza');
rememberSlug('joes-pizza', STORE);
{
  invalidateStore('joes-pizza');
  check(
    'invalidate by slug drops every slot',
    getAnyBySlug('joes-pizza', SLOTS.STORE) === undefined &&
      getAnyBySlug('joes-pizza', SLOTS.TREE) === undefined,
  );

  setCached(STORE, SLOTS.STORE, { v: 1 }, 'joes-pizza');
  invalidateStore(STORE);
  check('invalidate by id drops it too', getAnyBySlug('joes-pizza', SLOTS.STORE) === undefined);
  check('...and it is not resurrected on the next read', getAnyBySlug('joes-pizza', SLOTS.STORE) === undefined);
}

clearCache();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

/**
 * A tiny in-process cache for the PUBLIC storefront reads.
 *
 * Why this exists, measured rather than guessed: on this project's setup
 * (MongoDB Atlas, reached over the internet) `GET /api/health` - which touches no
 * collection - answers in ~5ms, while `GET /api/stores/:slug` takes ~4s. The
 * server is not slow and the queries are not slow; each round trip to the
 * cluster costs 1-2s, and a storefront open pays several of them in sequence.
 * The evidence that it is the round trips and not the query count: the category
 * tree route, which issues THREE queries, comes back FASTER than the nav menu
 * route, which issues one. A fixed cost per query, not a cost per row.
 *
 * So the two things that actually help are (a) doing fewer round trips and
 * (b) not doing them again for a request that was just answered. This is (b).
 *
 * DELIBERATELY process-local, in a Map, with no Redis. It is a latency cushion
 * for a single-node deployment, not a shared cache - and that framing decides
 * the staleness rule below, which is the one thing that could go wrong here.
 */

/**
 * How long an entry may be served before it is re-read from the database.
 *
 * This is a BACKSTOP, not the freshness mechanism. Every write that a shopper
 * could notice calls `invalidateStore` explicitly, so a product edit shows up
 * immediately rather than after this expires. The TTL exists to bound how wrong
 * things can get if a write path is ever added without an invalidation call -
 * 30s of stale catalogue instead of forever.
 *
 * Deliberately short. The tempting value here is minutes, and it would be faster
 * still, but a merchant who adds a product and refreshes the shop must not be
 * told by their own storefront that it is not there yet.
 */
const TTL_MS = 30_000;

/**
 * Cap on cached stores.
 *
 * A Map with a TTL but no bound is a memory leak wearing a deadline: every
 * store anyone has ever opened stays resident for TTL_MS past its last read,
 * and each entry holds that store's full product list. Small stores, small
 * numbers - but unbounded is unbounded. 100 stores at a few hundred KB of
 * products each is well inside a normal Node heap, and beyond that the least
 * recently used entry is dropped.
 */
const MAX_STORES = 100;

/**
 * In-flight requests, keyed the same way as the cache.
 *
 * This is the half that fixes the storefront specifically. `ShopPage` and
 * `Navbar` both call `getPublicStore(slug)` on mount, in the same tick, for the
 * same store - so without this, opening a store fires the identical multi-
 * second query TWICE and the browser waits on both. With it, the first caller
 * does the work and the second awaits the same promise.
 *
 * Not a micro-optimisation: it is the difference between paying 4s once and
 * paying 4s twice for a single page view.
 */
const inFlight = new Map();

/** storeId -> { [slot]: { payload, expiresAt } }. */
const byStore = new Map();

/* Payloads are held in named SLOTS, not one entry per store.
 *
 * The storefront's two public reads - the store document and the category tree -
 * are keyed by the same store but are not the same answer. One slot would mean
 * whichever route ran last overwrote the other, and the loser would serve the
 * winner's shape: a shopper who hit the tree first would get
 * `{store, tree, products: null}` from /stores/:slug and see an empty catalogue,
 * with no error anywhere. Slots make that unrepresentable.
 *
 * They are invalidated together, deliberately - see `invalidateStore` - because
 * a stale tree and a fresh product list would disagree with each other on
 * screen, and one store's worth of data is small enough that keeping both is
 * not a cost worth optimising. */
export const SLOTS = {
  /** `/stores/:slug` - the store document plus its products. */
  STORE: 'store',
  /** `/stores/:slug/tree` - the Theme 2 category tree. */
  TREE: 'tree',
  /** `/menu/:slug` - the storefront nav. */
  MENU: 'menu',
};


/**
 * slug -> storeId.
 *
 * The public routes are addressed by slug; the write paths know the store id. A
 * cache keyed only one way would force every invalidation to go and look the
 * other half up - another round trip, in the write path, where there is no
 * latency budget at all. Filled as the public routes resolve a slug.
 *
 * Needs no expiry of its own: a store's slug does not change, and a stale entry
 * can only cause a cache MISS, which is the safe direction to be wrong in.
 */
const slugToId = new Map();

/** Drop the least recently used entry. Called only when the map is at its cap. */
function evictIfFull() {
  if (byStore.size < MAX_STORES) return;

  // Map preserves insertion order, so the first key is the least recently
  // written. Re-writing an existing key does NOT move it to the end, so a hot
  // store can be evicted by a burst of cold ones - acceptable, since a miss is
  // cheap next to the memory it saves.
  const oldest = byStore.keys().next().value;
  if (oldest !== undefined) byStore.delete(oldest);
}

/**
 * Read a cached payload, or undefined.
 *
 * Expired entries are deleted on the way past rather than left to be skipped,
 * so an entry nobody reads again still goes away.
 */
export function getCached(storeId, slot) {
  // String() on every key, and it is load-bearing rather than tidiness.
  //
  // These ids arrive as Mongoose ObjectId OBJECTS. A Map compares object keys by
  // REFERENCE, so an ObjectId from one request is a different key from an
  // ObjectId for the same store in the next - the cache would be written once
  // and never read again, and `invalidateStore` (which deletes by string) would
  // never match either. Both failures are silent: no error, just a cache that
  // does nothing. Measured, this is what made the "cached" storefront still take
  // 4s. Every key in this module is normalised to a string, in one place, so the
  // two cannot drift apart again.
  const slots = byStore.get(String(storeId));
  if (!slots) return undefined;

  const hit = slots[slot];
  if (!hit) return undefined;

  // Expired entries are deleted on the way past rather than left to be skipped,
  // so an entry nobody reads again still goes away.
  if (Date.now() >= hit.expiresAt) {
    delete slots[slot];
    if (Object.keys(slots).length === 0) byStore.delete(String(storeId));
    return undefined;
  }

  return hit.payload;
}

/** Store a payload in one slot, replacing whatever was in it. */
export function setCached(storeId, slot, payload, slug) {
  const key = String(storeId);

  evictIfFull();
  if (!byStore.has(key)) byStore.set(key, {});

  byStore.get(key)[slot] = { payload, expiresAt: Date.now() + TTL_MS };
  if (slug) slugToId.set(slug, key);
}

/**
 * Forget everything cached for a store.
 *
 * Called by every write that changes what a shopper would see: a product
 * created, renamed, re-filed or deleted; the store's own details or theme
 * changed; a category or nav item edited. Without this, a merchant's own edit
 * would sit behind the TTL and the storefront would contradict the admin panel
 * that just told them it worked - the single most confusing failure this cache
 * could have.
 *
 * Takes a store id OR a slug, because the two halves of the app know different
 * ones and neither should have to look the other up.
 */
export function invalidateStore(storeOrSlug) {
  const key = String(storeOrSlug);

  // Direct hit on the id (the write paths).
  byStore.delete(key);

  // A slug was passed, or a slug->id entry points at this store.
  for (const [slug, mappedId] of slugToId) {
    if (slug === key || mappedId === key) {
      byStore.delete(mappedId);
      slugToId.delete(slug);
    }
  }
}

/**
 * A cached payload for a slug, WITHOUT querying the database first.
 *
 * This is the function that actually makes a repeat page load fast, and it exists
 * because caching by store id alone was not enough. The public routes are
 * addressed by slug, so resolving a slug meant a `Store.findOne` on EVERY
 * request - and with a cache hit behind it, that one round trip was the entire
 * remaining cost. Measured: the "fast" path was still ~4s, because the round
 * trip, not the query, is what is expensive against a remote cluster.
 *
 * So the slug lookup itself is cached: the first request for a slug resolves it
 * and records the mapping, and every request after that is answered from memory
 * with no database contact at all.
 *
 * Returns undefined when this process has never seen the slug, which is the
 * signal to fall back to the real query. A miss costs one round trip, exactly
 * as it did before, so the cold path is no worse than it was.
 */
export function getCachedBySlug(slug, slot) {
  if (!slug) return undefined;
  const storeId = slugToId.get(slug);
  if (!storeId) return undefined;
  return getCached(storeId, slot);
}

/**
 * Run `producer` at most once at a time per key, sharing the result.
 *
 * The point of the module in one function. Concurrent callers for the same slot
 * and store await ONE execution instead of each starting their own - which,
 * against a database where a query costs seconds, is the difference between one
 * slow request and several.
 *
 * Keyed by slot AND store, so the storefront's two public reads never share a
 * flight: they are different queries, and collapsing them would hand one caller
 * the other's answer.
 *
 * Failures are deliberately NOT cached. The `finally` clears the in-flight
 * entry whatever happens, so a transient database error is not remembered as
 * though it were an answer; a cached error would keep serving a broken
 * storefront until the TTL expired, long after the database recovered.
 */
export async function dedupe(slot, storeId, producer) {
  const key = `${slot}:${String(storeId)}`;
  const running = inFlight.get(key);
  if (running) return running;

  const task = (async () => producer())().finally(() => {
    inFlight.delete(key);
  });

  inFlight.set(key, task);
  return task;
}

/** Drop everything. For tests; not called by the app. */
export function clearCache() {
  byStore.clear();
  slugToId.clear();
  inFlight.clear();
}


/**
 * Remember which store a slug belongs to, WITHOUT caching its payload.
 *
 * Separate from `setCached` because a route may need the mapping (to key its
 * own cache entry) on a path where it never built a full payload.
 */
export function rememberSlug(slug, storeId) {
  if (slug && storeId) slugToId.set(slug, String(storeId));
}

/** The store id for a slug, or undefined if this process has never seen it. */
export function storeIdForSlug(slug) {
  return slugToId.get(slug);
}


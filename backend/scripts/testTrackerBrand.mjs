// The order tracker must BRAND the navbar with the store the order belongs to.
//
//   node scripts/testTrackerBrand.mjs
//
// THE BUG THIS PROTECTS AGAINST
//
// On a phone, /track/:orderId sits under the sticky navbar, and that navbar drew
// its brand from ONE place: the signed-in customer's own store, out of the
// session.
//
//     {isCustomer && brandStore ? <store logo> : <>DeliveryApp</> }
//
// Both halves of that guard are false for most of the people actually watching a
// delivery:
//
//   - `isCustomer` is false for a guest, and guest checkout is a supported path
//     (the tracker even carries the guest-token proof for confirming receipt).
//   - `brandStore` comes from `shoppingStores[0]` / `lastStoreVisit()`, so it is
//     also null for a customer opening a SHARED tracking link on a device that
//     had never visited that storefront.
//
// The result was the one screen whose entire subject is a particular shop -
// "your rider is 400m from Joe's Pizza" - branded as the generic app wordmark,
// at the top of the page, on the device most likely to be held in one hand.
//
// WHY THIS IS A TEST ABOUT FIVE FILES
//
// The navbar and the page are separate components with no common parent that
// knows anything about stores, so the fix is a contract between them: the page
// publishes a store, the navbar prefers it, the provider carries it, and the API
// sends the logo the navbar needs to draw. Any one of those four quietly
// disappearing puts the generic wordmark back, and none of them fails loudly -
// the page still renders perfectly, it is just branded as the app again. So this
// reads all of them and checks the wiring end to end.
//
// It also pins the ONE deliberate asymmetry: the logo is added to the
// single-order read and NOT to the list populate. A store logo can be a ~90KB
// base64 data URL, and a list would ship one per row.
import fs from 'node:fs';

let pass = 0;
let fail = 0;
const check = (label, ok, detail = '') => {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
};

/* `read` resolves against the backend package root (this file is in
   backend/scripts, so the helper's own `../` gets us to backend/). The client
   is a sibling of backend/, hence the extra `..` on those four. */
const read = (rel) =>
  fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

const navbarSrc = read('../client/src/components/common/Navbar.jsx');
const trackerSrc = read('../client/src/pages/customer/OrderTracker.jsx');
const mainSrc = read('../client/src/main.jsx');
const ctxSrc = read('../client/src/context/PageStoreContext.jsx');
const orderCtrlSrc = read('src/controllers/orderController.js');
// The navbar stylesheet, for the layout checks. The backend tests already read
// client files (this contract is split across both packages), so one more does
// not make it any worse.
const cssSrc = read('../client/src/index.css');

// --- 1. The provider actually wraps the navbar AND the page ---------------
console.log('--- the provider is mounted above both ends of the contract ---');

check(
  'main.jsx mounts PageStoreProvider',
  /<PageStoreProvider>/.test(mainSrc),
);
check(
  'and it wraps <App /> - the navbar is rendered BY App, so a provider inside a page is too low',
  /<PageStoreProvider>[\s\S]{0,80}<App \/>[\s\S]{0,80}<\/PageStoreProvider>/.test(
    mainSrc,
  ),
);
check(
  'usePageStore degrades to a no-op instead of throwing (the navbar reads it on every page)',
  /if \(!context\) return \{ store: null, logoOnly: false, setStore: NOOP \}/.test(
    ctxSrc,
  ),
);
check(
  'the setter is stable (a page publishes from an effect; a new identity would loop)',
  /const publishStore = useCallback\(/.test(ctxSrc),
);
check(
  'store + logoOnly are cleared in ONE write, so a bare-logo page cannot nameless the next one',
  /setBrand\(\{\s*store: next \|\| null,\s*logoOnly: Boolean\(options\?\.logoOnly\),\s*\}\)/.test(
    ctxSrc,
  ),
);

// --- 2. The navbar prefers the page's store --------------------------------
console.log('\n--- the navbar prefers what the page published ---');

check('Navbar reads the page store', /usePageStore\(\)/.test(navbarSrc));

const brandMatch = navbarSrc.match(/const brandStore = ([^;]+);/);
check(
  'brandStore is a single readable expression',
  Boolean(brandMatch),
  brandMatch?.[1]?.trim(),
);

if (brandMatch) {
  /* Evaluated for real, not pattern-matched: a test that only greps for
     `pageStore ||` proves the text is there, not that it wins. `homeStore` and
     `visitedStore` stand in for the session-derived values. */
  const resolve = new Function(
    'pageStore',
    'homeStore',
    'visitedStore',
    `return ${brandMatch[1].trim()}`,
  );

  const order = { name: "Joe's Pizza", slug: 'joes-pizza' };

  check(
    'a page-published store beats an empty session (the guest case - this is the bug)',
    resolve(order, null, null) === order,
  );
  check(
    'a page-published store beats a DIFFERENT session store (the page knows better)',
    resolve(order, { name: 'Other', slug: 'other' }, null) === order,
  );
  check(
    'the session store is still used when no page published one (nothing regresses)',
    resolve(null, order, null) === order,
  );
  check('the visited-store fallback is still last', resolve(null, null, order) === order);
  check(
    'with nothing known anywhere the brand stays generic',
    resolve(null, null, null) === null,
  );
}

// --- 3. The brand is no longer gated on being a signed-in customer ---------
console.log('\n--- the brand is not gated on the session ---');

check(
  'the store brand renders on `brandStore` alone, NOT `isCustomer && brandStore`',
  /\{brandStore \? \(/.test(navbarSrc) &&
    !/\{isCustomer && brandStore \? \(/.test(navbarSrc),
);
check(
  'the generic wordmark survives as the fallback for staff and unknown pages',
  /DeliveryApp/.test(navbarSrc),
);
check(
  'the logo chain prefers `logo` and matches StoreHeader (logo -> logoUrl -> image)',
  /brandStore\?\.logo \|\| brandStore\?\.logoUrl \|\| brandStore\?\.image/.test(
    navbarSrc,
  ),
);
check(
  'a store with no logo still falls back to its initials, not a broken image',
  /\{initials\(brandStore\.name \|\| 'S'\)\}/.test(navbarSrc),
);

// --- 3b. ... and the name can be dropped on request -------------------------
console.log('\n--- the customer tracker shows the mark WITHOUT the name ---');

check(
  'the name span is conditional, not unconditional',
  /\{brandLogoOnly \? \(/.test(navbarSrc),
);
check(
  'and the dropped name is kept for screen readers in sr-only (same call StoreHeader makes)',
  /<span className="sr-only">\{brandStore\.name \|\| 'Store'\}<\/span>/.test(
    navbarSrc,
  ),
);
check(
  'logoOnly is honoured ONLY for a store the page published - a session store always keeps its name',
  /const brandLogoOnly = Boolean\(pageStore && logoOnly\);/.test(navbarSrc),
);
check(
  'the tracker asks for the bare mark on the customer variant only',
  /setPageStore\(order\?\.store \|\| null, \{ logoOnly: !isStaffView \}\)/.test(
    trackerSrc,
  ),
);
check(
  'and logoOnly is in the effect deps, so flipping variant cannot leave a stale flag',
  /\[order\?\.store, isStaffView, setPageStore\]/.test(trackerSrc),
);

// --- 3c. ... and the account control stays pinned to the right ---------------
console.log('\n--- the cart + account controls stay on the right edge ---');

/* A REAL regression this codebase had, and one that is invisible rather than
 * loud: `.navbar__links` used to carry `margin-right: auto`, and that was the
 * only thing holding the right-hand controls to the edge of the bar. The phone
 * media query sets `.navbar__links { display: none }` - and a display:none box
 * contributes no margin at all, not even an automatic one - so on every phone
 * the anchor disappeared and brand / cart / account simply left-packed together.
 *
 * It went unnoticed while the brand was a fixed 30px square. The tracker header
 * shows the store's logo ALONE and that logo's width is the merchant's choice,
 * so the account icon began sliding left and right depending on which shop the
 * order belonged to. The anchor now lives on `.navbar__actions`, which is
 * rendered at every width. */
const navActionsRule =
  cssSrc.match(/^\.navbar__actions \{([\s\S]*?)\n\}/m)?.[1] || '';
const navLinksRule = cssSrc.match(/^\.navbar__links \{([\s\S]*?)\n\}/m)?.[1] || '';

check(
  'the auto margin lives on .navbar__actions, which is rendered at every width',
  /margin-left:\s*auto;/.test(navActionsRule),
);
check(
  'and NOT on .navbar__links, which is display:none on a phone',
  !/margin-right:\s*auto;/.test(navLinksRule),
  'two auto margins would also split the free space on a desktop',
);
check(
  'the phone still hides the nav links (that is what removed the old anchor)',
  /@media \(max-width: 720px\) \{[\s\S]{0,200}?\.navbar__links,[\s\S]{0,120}?display: none;/.test(
    cssSrc,
  ),
);

/* The mark may be wide, but not so wide it reaches the controls: the cap is what
 * stops the two colliding now that they always share one row. */
const navMarkCap =
  cssSrc.match(/\.navbar__brand--mark \.navbar__store-logo \{([\s\S]*?)\n\}/)?.[1] ||
  '';
check(
  'the mark-alone logo is still capped, so a wide wordmark cannot reach the buttons',
  /max-width:\s*min\(38vw, 140px\)/.test(navMarkCap),
);

// --- 4. The tracker publishes, and cleans up after itself -------------------
console.log("\n--- the tracker publishes its order's store ---");

check('OrderTracker reads the setter', /usePageStore\(\)/.test(trackerSrc));
check(
  'and publishes the store off the ORDER (authoritative - not guessed from the URL)',
  /setPageStore\(order\?\.store \|\| null,/.test(trackerSrc),
);
check(
  'it clears the store on unmount, so the next page is not mis-branded',
  /return \(\) => setPageStore\(null\);/.test(trackerSrc),
);
check(
  'the publish effect sits ABOVE the early returns (a hook after `if (loading)` is a crash)',
  trackerSrc.indexOf('setPageStore(order?.store') <
    trackerSrc.indexOf('if (loading) {'),
);

// --- 5. The API sends the logo the navbar needs to draw --------------------
console.log('\n--- the API sends the logo, and only on the single-order read ---');

const storeSelect = (src, constName) => {
  /* The array literal is located by its declaration, so the two constants that
     both select `path: 'store'` cannot be confused for one another. */
  const start = src.indexOf(`const ${constName} = [`);
  if (start === -1) return null;
  const body = src.slice(start, src.indexOf('];', start));
  const hit = body.match(/path: 'store',\s*select: '([^']*)'/);
  return hit ? hit[1] : null;
};

const sharedPopulate = storeSelect(orderCtrlSrc, 'ORDER_POPULATE');
const listPopulate = storeSelect(orderCtrlSrc, 'ORDER_LIST_POPULATE');

check(
  'ORDER_POPULATE selects the store',
  sharedPopulate !== null,
  sharedPopulate,
);
check(
  'ORDER_LIST_POPULATE selects the store',
  listPopulate !== null,
  listPopulate,
);
check(
  'the shared ORDER_POPULATE does NOT carry the logo (it feeds every list)',
  !/\blogo\b/.test(sharedPopulate || ''),
  sharedPopulate,
);
check('nor does ORDER_LIST_POPULATE', !/\blogo\b/.test(listPopulate || ''), listPopulate);
check(
  'there IS a detail populate, DERIVED from ORDER_POPULATE so the two cannot drift',
  /const ORDER_DETAIL_POPULATE = ORDER_POPULATE\.map\(/.test(orderCtrlSrc),
);
check(
  'and it adds the logo to the store select',
  /select: 'name slug image logo'/.test(orderCtrlSrc),
);
check(
  'the single-order read uses it',
  /\.populate\(ORDER_DETAIL_POPULATE\)/.test(orderCtrlSrc),
);

/* The payload guard, stated as a count: ORDER_DETAIL_POPULATE must be used by
   the one read and by nothing else. A future "just add it to the list too"
   would be the easy regression, and it would be invisible until the orders
   board got slow. */
const detailUses = (
  orderCtrlSrc.match(/populate\(ORDER_DETAIL_POPULATE\)/g) || []
).length;
check(
  'exactly one query uses the detail populate',
  detailUses === 1,
  `${detailUses} use(s)`,
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
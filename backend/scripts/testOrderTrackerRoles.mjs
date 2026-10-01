// The customer-only controls on the order tracker must exist in exactly ONE
// variant: the buyer's.
//
//   node scripts/testOrderTrackerRoles.mjs
//
// THE BUG THIS PROTECTS AGAINST
//
// App.jsx mounts OrderTracker four times with a `variant`: "rider", "merchant"
// (the store owner's own order detail), "admin" twice, and once with no variant
// at all - which defaults to "customer". Inside OrderTracker, `isStaffView` was
// an ALLOW-LIST of the staff variants:
//
//     const isStaffView = isAdmin || variant === 'rider';
//
// "merchant" was never added, so it was classified as a CUSTOMER view. The
// closing section is gated on `!isStaffView`, so the store owner's panel
// rendered "Confirm your delivery" with a live "Confirm delivery received"
// button - the buyer's control, in the store's own panel.
//
// The API refused it (`assertOrderOwner` in orderController.js), so nothing was
// corrupted: it was a 403 on a button that could never work. That is still a
// real defect. It tells a merchant they can close the loop on somebody else's
// delivery, which is exactly the separation the split exists to protect - and a
// control that can only fail is worse than no control at all.
//
// The same missing flag cost the merchant view two other things, because
// `isStaffView` is what they key off: the page rendered with the public
// storefront's `page--customer` padding, and the "Back to orders" link never
// rendered, so a store owner who opened an order had no way back to the list.
//
// WHY THIS IS A TEST ABOUT TWO FILES
//
// The allow-list could only rot because App.jsx and OrderTracker.jsx each knew
// half the answer. So this test reads BOTH: it finds every variant the router
// actually mounts, evaluates the real `isStaffView` expression against each
// one, and fails if a staff route is ever classified as the customer. Adding a
// new panel to the router can no longer quietly grant it the buyer's controls.
import fs from 'node:fs';

let pass = 0;
let fail = 0;
const check = (label, ok, detail = '') => {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
};

const appSrc = fs.readFileSync(
  new URL('../../client/src/App.jsx', import.meta.url),
  'utf8',
);
const trackerSrc = fs.readFileSync(
  new URL('../../client/src/pages/customer/OrderTracker.jsx', import.meta.url),
  'utf8',
);

// --- 1. What the router actually mounts ----------------------------------
console.log('--- the variants the router mounts ---');

/* `<OrderTracker variant="rider" />` and the multi-line merchant mount. The
   multi-line one is why this cannot be a single-line regex: the attribute sits
   on its own line, three lines below the tag. */
const mounts = [...appSrc.matchAll(/<OrderTracker\b([\s\S]*?)\/>/g)].map((m) => {
  const v = m[1].match(/variant="([^"]*)"/);
  return v ? v[1] : 'customer';
});

check('the router mounts the tracker at least four times', mounts.length >= 4, `${mounts.length} mounts`);
check('one of them is the plain customer tracker', mounts.includes('customer'));
check('the store owner has their own variant, mounted from the merchant shell', mounts.includes('merchant'));
check('and it passes a back target', /variant="merchant"[\s\S]{0,120}backTo=/.test(appSrc));

const staffVariants = mounts.filter((v) => v !== 'customer');
console.log(`     staff variants mounted: ${[...new Set(staffVariants)].join(', ')}`);

// --- 2. Does the real expression classify them correctly? ---------------
console.log('\n--- the real isStaffView expression, evaluated per variant ---');

/* The expression is lifted OUT of the component and evaluated for real, rather
   than pattern-matched. A test that only looks for the literal string
   `variant !== 'customer'` proves the text is present; this proves the text
   computes the right answer for every variant the router uses.

   `isAdmin` is passed in as well as `variant`, because the component defines it
   as `variant === 'admin'` and the old allow-list referenced it. Without it,
   reverting to that allow-list makes this script THROW instead of reporting a
   clean failure - a stack trace tells the reader far less than "merchant is
   classified as the customer" would. */
const exprMatch = trackerSrc.match(/const isStaffView = ([^;]+);/);
check('isStaffView is a single readable expression', Boolean(exprMatch), exprMatch?.[1]?.trim());

const classify = new Function('variant', 'isAdmin', `return ${exprMatch[1].trim()}`);
const isStaffView = (variant) => classify(variant, variant === 'admin');

for (const variant of [...new Set(mounts)]) {
  const staff = isStaffView(variant);
  const expected = variant !== 'customer';
  check(
    `variant="${variant}" is ${expected ? 'a STAFF view' : 'the CUSTOMER view'}`,
    staff === expected,
    `isStaffView -> ${staff}`,
  );
}

check('the default (no variant prop) is still the customer view', isStaffView('customer') === false);
check(
  'an UNKNOWN future variant is treated as staff, not as the buyer',
  isStaffView('some-new-panel') === true,
  'this is the direction that fails safe - an allow-list would say false',
);

// --- 3. The customer-only section is gated on that flag -------------------
console.log('\n--- the customer-only controls are gated on it ---');

/* The exact expression that caused the bug, asserted still to be in place: the
   closing section must be hidden for every staff variant. */
check(
  'the "Confirm your delivery" section is gated on !isStaffView',
  /!isStaffView && !isCancelled \?/.test(trackerSrc),
  'this is the guard that let merchant through',
);
check(
  'the confirm button itself is further gated on canConfirmReceived',
  /canConfirmReceived \?/.test(trackerSrc),
);
check(
  'and canConfirmReceived means the BUYER, not merely a logged-in viewer',
  /const canConfirmReceived = isOrderOwner \|\| \(isGuestOrder && hasGuestToken\)/.test(
    trackerSrc,
  ),
);

/* The server is the real authority, so the client hiding the button is belt and
   braces. If someone ever "fixes" this by deleting the button outright, this
   still has to hold - the refusal is what made the bug harmless. */
const controllerSrc = fs.readFileSync(
  new URL('../src/controllers/orderController.js', import.meta.url),
  'utf8',
);
const at = controllerSrc.indexOf('export const confirmReceived');
const receiveFn = controllerSrc.slice(at, at + 2500);
check(
  'the API refuses anyone but the buyer, so the UI was never the only guard',
  /assertOrderOwner\(order, req\.user\)/.test(receiveFn),
);

// --- 4. The other things isStaffView drives ------------------------------
console.log('\n--- the merchant view gets its staff chrome back ---');
check(
  'the page padding follows isStaffView, so merchant is not page--customer',
  /const pageClass = isStaffView \? 'page' : 'page page--customer'/.test(trackerSrc),
);
check(
  'the "Back to ..." link is shown to staff views',
  /\{isStaffView \? \(\s*<Link className="btn btn-outline btn-sm" to=\{backTo\}>/.test(
    trackerSrc,
  ),
  'a store owner opening an order had no way back to the list',
);
check(
  'the merchant variant is documented in the component header',
  /variant="merchant" - /.test(trackerSrc),
  'it was missing from the doc comment until it caused this',
);

// --- 5. No staff page may link to the BUYER's view of an order -----------
console.log('\n--- no staff page links to /track/:orderId ---');

/* Hiding the controls is only half of it. A staff page that LINKS to
   /track/:orderId drops the reader onto the customer variant - the shell is
   gone, and with it every guard on `isStaffView`, because that page mounts
   `<OrderTracker />` with no variant at all.

   That is how the block survived the isStaffView fix: StoreRiderAnalytics
   linked straight past the merchant route to the public tracker, so a store
   owner opening a row still got "Confirm your delivery", the rating form and
   "Sign in to rate this delivery". Every one of those controls is correct on
   the buyer's page and none of them is the store's to press. */
const staffDirs = ['store', 'rider'];
const staffFiles = staffDirs.flatMap((dir) =>
  fs
    .readdirSync(new URL(`../../client/src/pages/${dir}/`, import.meta.url))
    .filter((f) => f.endsWith('.jsx'))
    .map((f) => `client/src/pages/${dir}/${f}`),
);

let offenders = 0;
for (const rel of staffFiles) {
  const src = fs.readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
  const bad =
    /ROUTES\.ORDER_TRACKER/.test(src) ||
    /\borderTrackerPath\b/.test(src) ||
    /\/track\/\$\{/.test(src);
  if (bad) {
    offenders += 1;
    console.log(`       offending: ${rel}`);
  }
}

check(
  'no store or rider page links to the customer tracker route',
  offenders === 0,
  `${staffFiles.length} staff pages scanned`,
);
check(
  'StoreRiderAnalytics opens the MERCHANT order detail instead',
  /ROUTES\.MERCHANT_ORDER_DETAIL\.replace\([\s\S]{0,80}':orderId'/.test(
    fs.readFileSync(
      new URL('../../client/src/pages/store/StoreRiderAnalytics.jsx', import.meta.url),
      'utf8',
    ),
  ),
);

/* And the pages that legitimately belong to the buyer keep their link - the
   rule is "staff must not", not "nobody may". */
const customerSheet = fs.readFileSync(
  new URL('../../client/src/components/storefront/CustomerAccountSheet.jsx', import.meta.url),
  'utf8',
);
check(
  "the customer's own order list still links to /track/:orderId",
  /\borderTrackerPath\(id\)/.test(customerSheet),
  'the buyer must still be able to open their own order',
);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);

// Customer reviews have to REACH the merchant, in the Customers tab.
//
//   node scripts/testStoreCustomerReviews.mjs
//
// The bug this file exists for
//
//   A customer could sign up, confirm a delivery and rate it 1-5 stars with a
//   note - and the rating went nowhere visible. POST /orders/:id/review wrote it,
//   GET /stores/:id/reviews served it, `storeService.listStoreReviews` wrapped
//   it, and the backend smoke test asserted the owner could read it back. Every
//   layer worked. No component ever CALLED listStoreReviews, so the whole feature
//   ended at the service boundary and the merchant's Customers tab showed a
//   table of people and not one word any of them had said.
//
//   That is the shape of bug a passing API test cannot catch: the data path was
//   covered end to end and the SCREEN was not covered at all. So these checks
//   read the component, and the wiring is the thing under test.
//
// No browser and no server, same convention as testProductCardFit.
import fs from 'node:fs';

let pass = 0;
let fail = 0;
const check = (label, ok, detail = '') => {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
};

const read = (relative) =>
  fs.readFileSync(new URL(`../../${relative}`, import.meta.url), 'utf8');

const page = read('client/src/pages/store/StoreCustomers.jsx');
const service = read('client/src/services/storeService.js');
const css = read('client/src/index.css');
const routes = read('backend/src/routes/storeRoutes.js');
const reviewModel = read('backend/src/models/Review.js');

// --- the thing that was missing: the page calls the endpoint ----------------

check('the Customers tab calls listStoreReviews',
  /storeService\.listStoreReviews\s*\(/.test(page));
check('listStoreReviews was already in the service, unchanged',
  /export const listStoreReviews = \(storeId\) =>/.test(service));

/* Registered before the "/:slug" storefront catch-all, or "reviews" is read as
   a slug and the request 404s as "no such store". */
const reviewsRoute = routes.indexOf("router.get('/:id/reviews'");
const slugRoute = routes.indexOf("router.get('/:slug'");
check('the reviews route is mounted before the "/:slug" storefront catch-all',
  reviewsRoute !== -1 && (slugRoute === -1 || reviewsRoute < slugRoute),
  `reviews at ${reviewsRoute}, /:slug at ${slugRoute}`);
check('the reviews route is behind requireStoreStaff, not open',
  /router\.get\('\/:id\/reviews',\s*requireAuth,\s*requireStoreStaff/.test(routes));

// --- the data it reads ------------------------------------------------------

// The average and the histogram are computed server-side. Recomputing them here
// would be a second implementation of the same arithmetic that could disagree.
check('the average is read off the server, not recomputed',
  /setReviewAverage\(\s*Number\.isFinite\(reviewData\?\.average\)/.test(page) &&
  !/\.reduce\(\(sum, value\) => sum \+ Number/.test(page));
check('the 1-5 histogram is rendered from the server distribution',
  /distribution\.map\(/.test(page) && /bucket\.count/.test(page));

// `order` comes back as a bare ObjectId, not a populated document, so a naive
// `review.order._id` silently produces no link on every single review.
check('the order id is read tolerantly (bare id OR populated doc)',
  /review\?\.order\?\._id \|\| review\?\.order/.test(page));
check('each review links to the delivery it describes',
  /customers__review-order/.test(page) &&
  /MERCHANT_ORDER_DETAIL/.test(page));

/* The same rule StoreRiderAnalytics follows: /track/:orderId is the BUYER's
   page, carrying "Confirm your delivery" and the rating form. A merchant
   clicking through to a review must land on the staff view. */
check('a review never links to the customer tracker route',
  !/ROUTES\.ORDER_TRACKER/.test(page) && !/'\/track\//.test(page));
// --- a review is a DELIVERY, not a person -----------------------------------

/* The design decision most worth pinning: reviews are a separate section under
   the table, not columns bolted onto each customer row. A review describes one
   delivery; a customer can have many. Putting them in the row would force a
   "which review?" column and flatten a stream of opinions into a list of
   people. */
check('reviews render in their own section, outside the customers table',
  page.indexOf('className="customers__reviews"') !== -1 &&
  page.indexOf('className="customers__reviews"') >
    page.indexOf('</table>'));
check('the customers table still ends after its own count line',
  /customers__count|orders__count/.test(page));

// --- searching finds the person AND what they said --------------------------

check('the search box narrows the reviews as well as the customers',
  /const visibleReviews = useMemo/.test(page) &&
  /review\.customerName, review\.comment/.test(page));
check('a review with stars but no note is not rendered as an empty box',
  /No note left, just the stars\./.test(page));

// --- failure isolation ------------------------------------------------------

/* A reviews endpoint that is unhappy must NOT take the customers table down
   with it: `error` drives the table's own banner, so letting a review failure
   set it would replace a working customer list with a review error. */
check('a review failure does not write to the shared `error` state',
  /setReviewError\(err\.message \|\| 'Could not load your reviews\.'\)/.test(page));
check('the review error is rendered in its own place',
  /\{reviewError \? \(\s*<p className="alert alert--danger">\{reviewError\}<\/p>/.test(page));

// --- empty states are distinct ----------------------------------------------

check('"no reviews yet" is distinguished from "no reviews match that search"',
  /No reviews yet\./.test(page) && /No reviews match that search\./.test(page));

// --- read-only stars --------------------------------------------------------

/* The stars on this page reuse the customer's own .stars glyph, but a merchant
   cannot rate a customer. Without `.stars--readonly` they would carry
   `cursor: pointer` and a hover scale, i.e. look pressable and do nothing. */
check('the stars here are the read-only variant', /stars--readonly/.test(page));
check('.stars--readonly removes the pointer cursor',
  /\.stars--readonly \.stars__star \{[^}]*cursor: default/.test(css));
check('.stars--readonly removes the hover scale',
  /\.stars--readonly \.stars__star:hover \{[^}]*transform: none/.test(css));

// --- accessibility ----------------------------------------------------------

check('the stars carry a screen-reader rating',
  /className="sr-only"/.test(page) && /out of 5 stars/.test(page));
check('the review author avatar is hidden from readers (the name says it)',
  /className="avatar avatar--sm" aria-hidden="true"/.test(page));

// --- the data the panel trusts ---------------------------------------------

check('the author name falls back rather than rendering blank',
  /review\.customerName \|\| 'A customer of this store'/.test(page));
check('the model snapshots the author name, so a rename cannot rewrite history',
  /customerName/.test(reviewModel));

// --- hooks ------------------------------------------------------------------

/* Same trap as the analytics filter: a hook placed after the `if (loading)`
   early return throws "Rendered fewer hooks than expected" the moment loading
   flips, which is every single load. */
const earlyReturnAt = page.indexOf('if (loading) return');
const hooksAfterReturn =
  earlyReturnAt === -1
    ? []
    : page.slice(earlyReturnAt).match(/\buse(State|Effect|Memo|Callback|Ref)\(/g) || [];
check('no hook is called after the `if (loading)` early return',
  earlyReturnAt !== -1 && hooksAfterReturn.length === 0,
  hooksAfterReturn.length ? `found: ${hooksAfterReturn.join(', ')}` : '');

// --- per-customer review button --------------------------------------------

/* The row button is the way a merchant actually gets from "this person spent the
   most" to "here is what they said". It has to filter the panel, and it has to
   join on something reliable. */
check('each customer row has a Reviews button',
  /onClick=\{\(\) => showCustomerReviews\(customerId\)\}/.test(page));
check('the row button shows how many reviews that customer has',
  /theirReviews = reviewsByCustomer\.get\(customerId\)/.test(page) &&
  /\{theirReviews\.length\}/.test(page));
check('a customer with no reviews says so, rather than an empty button',
  /<span className="muted small">None<\/span>/.test(page));

/* Joined on the ID, never the name. `customerName` is a snapshot from write
   time, so a customer who has since renamed would silently lose their own
   history, and two people named Alex would pool their reviews. */
check('reviews are grouped by customer ID, not by name',
  /String\(review\.customer\?\._id \|\| review\.customer \|\| ''\)/.test(page) &&
  !/reviewsByCustomer\.get\(displayName/.test(page));

/* A toggle, and an explicit way back to the full list. A filter with no exit is
   the thing merchants report as "the reviews disappeared". */
check('clicking the focused row again un-focuses (it is a toggle)',
  /setFocusedCustomerId\(\(current\) => \(current === customerId \? '' : customerId\)\)/.test(page));
check('a focused panel offers a way back to all customers',
  /Show all customers/.test(page) && /setFocusedCustomerId\(''\)/.test(page));
check('the focused button reports its state, not just a colour',
  /aria-expanded=\{isFocused\}/.test(page) && /\{isFocused \? 'Showing' : 'Reviews'\}/.test(page));

/* On a long customer list the panel is below the fold, so a click that only
   changed something off-screen reads as a dead button. */
check('clicking scrolls the reviews panel into view',
  /reviewsRef\.current\?\.scrollIntoView/.test(page) && /ref=\{reviewsRef\}/.test(page));
check('the scroll target is the element the button points at',
  /aria-controls="customer-reviews"/.test(page) && /id="customer-reviews"/.test(page));

/* The store-wide histogram and the store-wide average describe ALL customers.
   Left on screen next to one person's reviews they read as that person's, and
   then contradict the list directly underneath. */
check('the store-wide histogram is hidden while focused',
  /distribution\.length && reviews\.length && !focusedCustomerId/.test(page));
check('the store-wide average is hidden while focused',
  /focusedCustomerId\s*\? 'Filtered to one customer\./.test(page));
check('"this customer has not reviewed" is its own message',
  /has not left a review\./.test(page));

// --- the CSV carries the same information -----------------------------------

/* A merchant who exports the customer list and opens it in Excel is doing the
   same job as clicking the button, so leaving reviews out of the file would
   make the export quietly incomplete. */
check('the CSV export includes review count, average and notes',
  /'Reviews',\s*\n\s*'Average rating',\s*\n\s*'Review notes'/.test(page));
check('CSV comments are flattened so a newline cannot break the row',
  /replace\(\/\\s\*\\r\?\\n\\s\*\/g, ' '\)/.test(page));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
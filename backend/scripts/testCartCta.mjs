// The cart drawer's footer must never present a control that does nothing.
//
//   node scripts/testCartCta.mjs
//
// THE BUG THIS PROTECTS AGAINST
//
// The drawer's whole footer ended in one button:
//
//     <button disabled={items.length === 0} onClick={goToCheckout}>
//       Go to checkout
//     </button>
//
// and `goToCheckout` has no guard of its own - it is `closeCart()` then
// `navigate(checkoutPath(storeSlug))`, full stop. So with an empty cart that
// button was a full-width primary-styled control that was permanently inert,
// and tapping it did LITERALLY nothing: no navigation, no message, no error, no
// change of any kind. `.btn:disabled` dims it to 0.55 opacity, which on a phone
// in daylight is not a strong enough signal to stop a thumb.
//
// The explanation existed, just nowhere near the button: the drawer's scrollable
// body said "Nothing here yet - add a product from the store". The footer is
// pinned, the body scrolls. A shopper's thumb and eyes are both on the footer,
// so the one thing the footer said was a dead button.
//
// WHY IT READS AS "checkout is broken" RATHER THAN "the cart is empty"
//
// The shopper has usually just been tapping through a storefront and reaches
// for the one control that sounds like the next step. A dead "Go to checkout"
// says "this app's checkout is not working"; it does not say "you have not put
// anything in the cart yet". Those are completely different bugs and they look
// identical from the outside.
//
// THE RULE
//
// The footer CTA is either live or absent. An empty cart gets an instruction and
// a real destination - to the same store the checkout link would have used - in
// the same slot and at the same size as the button it replaces.
import fs from 'node:fs';

let pass = 0;
let fail = 0;
const check = (label, ok, detail = '') => {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
};

const drawerSrc = fs.readFileSync(
  new URL('../../client/src/components/store/CartDrawer.jsx', import.meta.url),
  'utf8',
);
const cssSrc = fs.readFileSync(
  new URL('../../client/src/pages/../index.css', import.meta.url),
  'utf8',
);

/* The comments in these files quote the old code verbatim - "It used to be one
   button with `disabled={items.length === 0}`" - so a source grep run against
   the whole file matches its own explanation of the bug. The structural checks
   below therefore run against the code with comments stripped. */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const code = stripComments(drawerSrc);
const css = stripComments(cssSrc);

console.log('--- the checkout button is never disabled ---');

check(
  'the drawer does not disable "Go to checkout"',
  !/disabled=\{items\.length === 0\}/.test(code),
  'a disabled full-width primary button is the dead control this replaced',
);
check(
  'the button is rendered only for a cart that has something in it',
  /\{items\.length > 0 \? \(\s*<button/.test(code),
);

console.log('\n--- an empty cart gets an instruction and a way out ---');

check(
  'the empty state says why there is nothing to check out',
  /Nothing to check out yet/.test(code),
);
check(
  'and offers a real link, not another dead control',
  /<Link[\s\S]{0,160}to=\{shopTarget\}/.test(code),
);
check(
  'the link closes the drawer, so it cannot open over the store it navigates to',
  /to=\{shopTarget\}[\s\S]{0,80}onClick=\{closeCart\}/.test(code),
);

console.log('\n--- it goes to the right store ---');

check(
  'the empty-cart target reuses the same slug the checkout link uses',
  /const storeSlug = pathSlug \|\| lastStoreVisit\(\) \|\| '';/.test(code) &&
    /const shopTarget = storeSlug \? shopPath\(storeSlug\) : ROUTES\.STORE;/.test(
      code,
    ),
  'one slug, two targets - they cannot drift',
);
check(
  'with no store known it falls back to the store picker rather than a dead end',
  /: ROUTES\.STORE;/.test(code),
);

console.log('\n--- the checkout path itself is untouched ---');

check(
  'goToCheckout still navigates to the store-scoped checkout',
  /navigate\(checkoutPath\(storeSlug\)\)/.test(code),
);
check('the note above the button has a style', /\.drawer__empty-cta \{/.test(css));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

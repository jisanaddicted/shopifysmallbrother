// The product CARD must fit any image a merchant uploads - and, just as
// importantly, must not clip its own controls when it gets narrow.
//
//   node scripts/testProductCardFit.mjs
//
// THE BUG THIS PROTECTS AGAINST (Theme 2)
//
// The card's narrow layout used to live in `@media (max-width: 640px)`, keyed to
// the WINDOW. Theme 2's cards are narrow because of the 210px sidebar beside
// them, not because the shopper is on a phone, so at a 1256px window a 163px
// card never matched that media query and kept the desktop layout. Measured in a
// real browser against the real stylesheet, before the fix:
//
//   the "Add to cart" button rendered at x=396..490 inside a card ending at
//   x=397, and the footer needed 242px in a 134px box.
//
// `.product-card` has `overflow: hidden`, so that content did not push the card
// wider - it was silently CLIPPED. The shopper saw a card whose button was cut in
// half and could not add the product at all, with nothing reporting a problem.
// The photo box was 4:3 (161x120.8) at a width that wants square.
//
// THE FIX, in one line each
//
//   .product-card         min-width: 0     - a grid item defaults to
//                                           min-width:auto (min-content), so the
//                                           unshrinkable footer floored the card.
//   .product-card         container-type   - so the card can be MEASURED and asked
//                                           "are you narrow?", instead of the
//                                           window being asked "is it small?".
//   @container card       the narrow layout- keyed to the card, so the phone grid
//                                           and Theme 2 are handled by one rule.
//   .product-card__media  overflow: hidden  - the photo box is a fixed shape; the
//                                           image is dealt with inside it.
//
// No browser and no server: this reads the stylesheet and asserts the rules that
// produced those numbers are still in place. Same convention as testLogoSize.
import fs from 'node:fs';

let pass = 0;
let fail = 0;
const check = (label, ok, detail = '') => {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
};

const css = fs.readFileSync(
  new URL('../../client/src/index.css', import.meta.url),
  'utf8',
);

/**
 * Every TOP-LEVEL block whose header is `selector`, as an array of rule texts.
 *
 * "Top level" is the whole trick, and it is why this is a line-based scan rather
 * than a brace counter. A brace counter walks straight into this stylesheet's
 * comments - they are long, they explain the rules in prose, and several quote
 * CSS - so an unbalanced brace inside a comment throws the depth off and the
 * "block" it returns runs on into whatever follows. Every rule this file asks
 * about is written at column 0 and closed by a `}` at column 0, so the end is
 * simply the next line that starts with `}`.
 *
 * An array, not a single string, because the selector is ambiguous in two ways
 * that both fail SILENTLY. `@media (max-width: 640px)` appears nine times in
 * this stylesheet, and `.product-card__media {` appears twice (once at top
 * level, once inside the card's container query). A plain `indexOf` returns
 * whichever comes first, and the assertions then measure the wrong rules while
 * reporting a confident, wrong failure.
 *
 * Requiring the header at the start of a line is what stops `.product-card {`
 * matching `.rail__track > .product-card {`.
 */
const allBlocks = (selector) => {
  const found = [];
  let from = 0;
  for (;;) {
    const atStart = css.startsWith(selector, from);
    const hit = css.indexOf(`\n${selector}`, from);
    if (hit < 0 && !atStart) break;
    const headerAt = hit < 0 ? from : hit + 1;
    // The closing brace of a top-level rule is the next `}` in column 0.
    const close = css.indexOf('\n}', headerAt);
    if (close < 0) break;
    found.push(css.slice(headerAt, close + 2));
    from = close + 2;
  }
  return found;
};

/**
 * The FIRST block for `selector` - the top-level definition, which by convention
 * precedes any nested restatement of the same rule.
 */
const block = (selector) => allBlocks(selector)[0] || '';

/** The one block for `selector` that also contains `needle`. */
const blockContaining = (selector, needle) =>
  allBlocks(selector).find((b) => b.includes(needle)) || '';

// --- 1. The card can shrink ------------------------------------------------
console.log('--- the card can get narrow ---');
const card = block('.product-card {');
check(
  'the card is still a flex column with a border and radius',
  /display:\s*flex/.test(card) && /border-radius/.test(card),
);
check(
  'the card has min-width: 0, so the footer cannot floor it (the clip)',
  /min-width:\s*0/.test(card),
);
check(
  'the card is a size container, so it can be MEASURED',
  /container-type:\s*inline-size/.test(card),
);
check(
  'and that container is named, so the query below can find it',
  /container-name:\s*card/.test(card),
);

// --- 2. The photo box is a fixed shape ------------------------------------
console.log('\n--- the photo box is a fixed shape ---');
const media = block('.product-card__media {');
check('it still has a fixed aspect ratio', /aspect-ratio:\s*4\s*\/\s*3/.test(media));
check('it clips, so no image can paint outside it', /overflow:\s*hidden/.test(media));
check('and it can shrink too', /min-width:\s*0/.test(media));

const img = block('.product-card__media img {');
check('the image fills the box', /width:\s*100%/.test(img) && /height:\s*100%/.test(img));
check(
  'the WHOLE image is shown, not a crop of it (object-fit: contain)',
  /object-fit:\s*contain/.test(img),
);
check(
  'and it is NEVER cover - that is what cut the bottles in half',
  !/object-fit:\s*cover/.test(img),
  'cover crops; the request was the whole image',
);
check(
  'the photo floats inside its box, so the leftover area reads as a frame',
  /padding:\s*[\d.]+rem/.test(img),
);
check(
  'the image has a hard ceiling, so a failed object-fit still cannot escape',
  /max-width:\s*100%/.test(img) && /max-height:\s*100%/.test(img),
  'belt and braces - see the comment in the stylesheet',
);
check(
  'and it is a block, so there is no inline baseline gap under it',
  /display:\s*block/.test(img),
);

/* The box has to have a backdrop for `contain` to letterbox into. Without one
   the unmatched area is transparent and reads as a broken image, which is the
   whole risk `contain` carries. */
check(
  'the photo box has a background for the letterbox to land on',
  /background:\s*var\(--surface-alt\)/.test(media),
  'without it the bars read as emptiness rather than as a frame',
);

/* The product page shows the same picture, so it must not crop it either -
   a shopper who saw a whole bottle on the card must not open the page to find
   it sliced. */
const hero = block('.product-page__hero img {');
check('the product page hero also shows the whole image', /object-fit:\s*contain/.test(hero));
check('the product page hero is never cover', !/object-fit:\s*cover/.test(hero));

// --- 5. The image box can actually be the size of the photo box -----------
console.log('\n--- the image is allowed to shrink into the box ---');
/* `contain` fits the picture into whatever box the <img> ELEMENT has. If that
   element is bigger than the photo box, the picture is fitted into the bigger
   box and the box's `overflow: hidden` crops it - so `contain` is in the
   stylesheet, the picture is still cut, and everything looks correct in review.

   Both the card's link wrapper and the product page hero are `display: grid`,
   which makes the <img> a GRID ITEM, and a grid item's automatic minimum size
   is its INTRINSIC size. Measured in Edge before this was fixed:

     portrait 600x900 -> img=171.5x250.1 inside box=171.5x171.5

   Zeroing the automatic minimum is what makes `height: 100%` mean anything. */
const openChild = block('.product-card__open > * {');
check('the card photo link stretches to fill its box', /height:\s*100%/.test(openChild));
check(
  'and its automatic minimum is zeroed, so a TALL image can shrink into it',
  /min-height:\s*0/.test(openChild),
  'a grid item otherwise refuses to be shorter than the image',
);
check('the same for the inline axis', /min-width:\s*0/.test(openChild));
check(
  'the product page hero image is not floored by its own height either',
  /min-height:\s*0/.test(hero),
  'same grid-item trap, same fix',
);

// --- 3. The narrow layout is keyed to the CARD, not the window -------------
console.log('\n--- the narrow layout follows the card, not the window ---');
const container = block('@container card (max-width: 210px) {');
check('the narrow layout is a container query on the card', container.length > 0);
check(
  'the photo goes square when the card is narrow',
  /aspect-ratio:\s*1\s*\/\s*1/.test(container),
);
check(
  'the footer wraps, so price + stepper + button stop fighting',
  /flex-wrap:\s*wrap/.test(container),
);
check(
  'the buy wrapper dissolves so the button can take its own line',
  /display:\s*contents/.test(container),
);
check('the button is allowed to shrink', /min-width:\s*0/.test(container));

/* The regression that matters most. If these rules are moved back into a
   viewport media query, Theme 2 breaks again while every phone test keeps
   passing - which is precisely how it broke in the first place. */
/* `.grid {`, not `.grid` - the bare string also matches `.store-sections__grid`
   and the word "grid" in prose, either of which picks the wrong block. */
const phoneBlock = blockContaining('@media (max-width: 640px) {', '.grid {');
check('the phone media query next to the product grid was found', phoneBlock.length > 0);
check(
  'the phone media query no longer holds the card layout (that WAS the bug)',
  !/product-card__media/.test(phoneBlock),
  'the card layout belongs to the card, not the window',
);
check(
  'the phone media query still sets the phone GRID tracks',
  /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/.test(phoneBlock),
  'a media query is correct for the grid itself',
);

// --- 4. The Theme 2 grids cannot overflow a narrow pane --------------------
console.log('\n--- the Theme 2 grids cannot overflow ---');
for (const sel of ['.treeview__products {', '.treeview__grid {']) {
  const g = block(sel);
  check(
    `${sel} has a min() floor, so a track can shrink below 150px`,
    /minmax\(min\(150px,\s*100%\),\s*1fr\)/.test(g),
    g.match(/grid-template-columns:[^;]+/)?.[0] || 'not found',
  );
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);

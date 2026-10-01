// The product CARD must fit any image a merchant uploads - and, just as
// importantly, must not clip its own controls when it gets narrow.
//
//   node scripts/testProductCardFit.mjs
//
// It also covers the other two places the SAME picture is shown - the product
// page hero and the cart-drawer thumbnail - because all three had the same pair
// of defects, and a rule that holds in one of them and not the others is worse
// than no rule at all: the shopper sees a whole bottle in the grid and a sliced
// one in their own cart.
//
// THE TWO BUGS, both of which crop the product
//
//   1. `object-fit: cover` fills the box and discards the overflow, so a tall
//      bottle photo showed its middle slice - cap at the top, base gone.
//   2. The image is a GRID ITEM (each of the three boxes is `display: grid`), and
//      a grid item's automatic minimum size is its INTRINSIC size. A tall photo
//      therefore refused to be shorter than itself, `height: 100%` silently did
//      nothing, and the box's `overflow: hidden` cropped it - so fixing (1)
//      alone changed nothing, with `contain` sitting in the stylesheet looking
//      like it had worked.
//
// Measured in Edge, before the fix, in the real Theme 2 layout:
//
//   portrait 600x900 -> img=171.5x250.1 inside a 171.5x171.5 photo box
//
// A third bug, specific to the card and unrelated to images: its narrow layout
// lived in `@media (max-width: 640px)`, keyed to the WINDOW, so Theme 2's cards
// - which are narrow because of the 210px sidebar beside them - never matched it
// and kept the desktop layout at 163px wide. The "Add to cart" button rendered
// at x=396..490 inside a card ending at x=397: clipped away entirely, because
// `overflow: hidden` hides overflow instead of pushing the card wider.
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

// --- 6. Every other place a product picture is shown agrees ----------------
console.log('\n--- the cart drawer shows the whole picture too ---');
/* The cart row is the LAST look at a product before the order is placed: the
   shopper is confirming "is this the thing I picked?". A cropped thumbnail
   makes that check harder, and worse, it contradicts what they just saw in the
   grid - the bottle they clicked is not the bottle in their cart.

   It had exactly the two defects the card had, and both are load-bearing:
   `cover`, and the grid-item automatic minimum (`.cart-line__media` is
   `display: grid`, so the img is a grid item whose automatic minimum size is
   its intrinsic height - `height: 100%` does nothing for a tall photo). */
const cartImg = block('.cart-line__media img {');
check('the cart thumbnail shows the whole image', /object-fit:\s*contain/.test(cartImg));
check('the cart thumbnail is never cover', !/object-fit:\s*cover/.test(cartImg));
check(
  'and its automatic minimum is zeroed, so a tall photo can shrink into it',
  /min-height:\s*0/.test(cartImg),
  'same grid-item trap as the card',
);
check('the same for the inline axis', /min-width:\s*0/.test(cartImg));
check(
  'it is given a little padding, so the letterbox reads as a frame',
  /padding:\s*[\d.]+(px|rem)/.test(cartImg),
);
const cartBox = block('.cart-line__media {');
check(
  'the cart thumbnail box has a background and clips, like the card box',
  /background:\s*var\(--surface-alt\)/.test(cartBox) && /overflow:\s*hidden/.test(cartBox),
);

/* A single rule, applied once, would be better than three copies - but the
   client cannot import from a stylesheet it does not own, and these three boxes
   genuinely differ in size and shape. What must not drift is the RULE, and
   that is what the assertions above pin: every one of them is `contain`, and
   every one of them has its automatic minimum zeroed. */
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);

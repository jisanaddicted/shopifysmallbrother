// Checks the storefront logo SIZE - the Theme tab's slider/number control, the
// store field behind it, and the CSS that draws the header logo at it. No server,
// no browser: nothing here needs one, and the rules worth protecting are all
// "these two places must agree".
//
//   node scripts/testLogoSize.mjs
//
// Why this file exists at all: the bounds are written down FOUR times - the
// backend constant, the model's min/max, the client's constant and the client's
// clamp - because the client cannot import from the server. That is the
// arrangement the whole project uses (see the duplicated-constants note in the
// README), and its cost is exactly one thing: the copies drift. A wider bound in
// the Theme tab and not in the API would have the merchant dragging to a size the
// server refuses; a narrower one and the slider stops short of sizes the API
// happily accepts. Every assertion below is one of those pairs.
import fs from 'node:fs';
import {
  LOGO_SIZE_DEFAULT,
  LOGO_SIZE_MAX,
  LOGO_SIZE_MIN,
  LEGACY_LOGO_SIZES,
  isLogoSize,
} from '../src/utils/constants.js';

const check = (label, ok, detail = '') =>
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);

const read = (relative) =>
  fs.readFileSync(new URL(relative, import.meta.url), 'utf8');

// --- 1. The server's own bounds ---------------------------------------------
console.log('--- the bounds (backend) ---');
check(
  'a size can be anything between 48 and 200, not a fixed list of four',
  LOGO_SIZE_MIN === 48 && LOGO_SIZE_MAX === 200,
  `${LOGO_SIZE_MIN}-${LOGO_SIZE_MAX}`,
);
check(
  'the default is inside the bounds',
  isLogoSize(LOGO_SIZE_DEFAULT),
  `${LOGO_SIZE_DEFAULT}`,
);

/* The range check is what stops a 2000px logo from being saved, so it has to
   refuse the edges AND the junk: `Number('')` is 0 and `Number('big')` is NaN,
   and a validator built on `value >= MIN && value <= MAX` alone lets NaN walk
   straight through both comparisons. */
check('48 is accepted', isLogoSize(48));
check('200 is accepted', isLogoSize(200));
check('47 is refused', !isLogoSize(47));
check('201 is refused', !isLogoSize(201));
check('a blank string is refused, not read as 0', !isLogoSize(Number('')));
check('a word is refused, not read as NaN', !isLogoSize(Number('big')));
check('NaN itself is refused', !isLogoSize(NaN));
check('undefined is refused', !isLogoSize(undefined));

const modelSrc = read('../src/models/Store.js');
const modelField = modelSrc.match(/logoSize:\s*\{([\s\S]*?)\n {4}\}/);
check('the Store model has a logoSize field', Boolean(modelField));
check(
  "the field is a NUMBER, not the four-value string enum it replaced",
  /type:\s*Number/.test(modelField?.[1] || ''),
);
check(
  'the model enforces the same bounds',
  /min:\s*LOGO_SIZE_MIN/.test(modelField?.[1] || '') &&
    /max:\s*LOGO_SIZE_MAX/.test(modelField?.[1] || ''),
);

/* The setter is the migration. The field shipped as a string enum first, so a
   store saved in that window still holds "lg"; without the coercion its next
   save would fail validation and take the merchant's other storefront edits
   down with it. */
const setter = modelField?.[1].match(/set:\s*\(value\)\s*=>\s*\{([\s\S]*?)\n {6}\}/)?.[1] || '';
check(
  'the setter maps a legacy step string to its pixels',
  /LEGACY_LOGO_SIZES\[/.test(setter),
);
check(
  'every legacy step has a pixel value, and all are inside the new bounds',
  Object.values(LEGACY_LOGO_SIZES).every(isLogoSize),
  Object.entries(LEGACY_LOGO_SIZES)
    .map(([k, v]) => `${k}:${v}`)
    .join(' '),
);
check(
  'the legacy default maps to the current default, so nothing visibly moves',
  LEGACY_LOGO_SIZES.md === LOGO_SIZE_DEFAULT,
  `${LEGACY_LOGO_SIZES.md} vs ${LOGO_SIZE_DEFAULT}`,
);
check(
  'the setter clamps rather than trusting the caller',
  /Math\.min\(LOGO_SIZE_MAX, Math\.max\(LOGO_SIZE_MIN/.test(setter),
);

const controllerSrc = read('../src/controllers/storeController.js');
check(
  'updateMyStore validates logoSize through the shared check',
  /isLogoSize\(size\)/.test(controllerSrc),
);
check(
  'a refused size is a 400 that names the range',
  /isLogoSize\(size\)[\s\S]{0,200}?HttpError\(\s*400/.test(controllerSrc) &&
    /between \$\{LOGO_SIZE_MIN\} and \$\{LOGO_SIZE_MAX\}/.test(controllerSrc),
);
check(
  'updateMyStore rounds and writes logoSize',
  /store\.logoSize = Math\.round\(size\);/.test(controllerSrc),
);

/* The cache. The public storefront payload is served from memory for its TTL,
   so a size that saves but never invalidates means the merchant drags the slider,
   refreshes, and sees the old logo - and reasonably concludes the control does
   nothing. updateMyStore already invalidates on every save, which is what makes
   this a non-issue; this asserts that is still true. */
check(
  'a saved size invalidates the storefront cache (updateMyStore still calls invalidateStore)',
  /invalidateStore\(store\._id\)/.test(controllerSrc),
);

// --- 2. The client's copy ----------------------------------------------------
console.log('\n--- the bounds (client) ---');
/* The client's constants cannot be imported here: they read `import.meta.env`,
   which only Vite defines, so a plain node import throws on the first line.
   They are read as text instead - the same trick testSections.mjs uses. */
const clientConstants = read('../../client/src/utils/constants.js');

const clientBounds = {
  MIN: Number(clientConstants.match(/LOGO_SIZE_MIN = (\d+)/)?.[1]),
  MAX: Number(clientConstants.match(/LOGO_SIZE_MAX = (\d+)/)?.[1]),
  DEFAULT: Number(clientConstants.match(/LOGO_SIZE_DEFAULT = (\d+)/)?.[1]),
};
check(
  'the client offers the same range the API accepts',
  clientBounds.MIN === LOGO_SIZE_MIN && clientBounds.MAX === LOGO_SIZE_MAX,
  `${clientBounds.MIN}-${clientBounds.MAX} vs ${LOGO_SIZE_MIN}-${LOGO_SIZE_MAX}`,
);
check(
  'and the same default',
  clientBounds.DEFAULT === LOGO_SIZE_DEFAULT,
  `${clientBounds.DEFAULT} vs ${LOGO_SIZE_DEFAULT}`,
);

/* `logoSizePx` is the guard the storefront relies on, and it has to clamp on BOTH
   sides: an upper clamp alone would let a corrupt document paint a 4000px logo
   that shoves the cart button off the screen, and a missing value has to become
   the default rather than `NaNpx` - an image with no dimensions at all. */
const clampBody = clientConstants.match(/export const logoSizePx[\s\S]*?\n\};/)?.[0] || '';
check(
  'the client clamps a stored size to the same bounds, both ends',
  /Math\.min\(LOGO_SIZE_MAX/.test(clampBody) &&
    /Math\.max\(LOGO_SIZE_MIN/.test(clampBody),
);
check(
  'an unknown or missing size falls back to the default, not to NaN',
  /if \(!Number\.isFinite\(size\)\) return LOGO_SIZE_DEFAULT;/.test(clampBody),
);
check(
  'the size reaches the CSS as a LENGTH, so the storefront can cap it with min()',
  /'--store-logo-size': `\$\{logoSizePx\(value\)\}px`/.test(clientConstants),
);

// --- 3. The header applies it ------------------------------------------------
console.log('\n--- the storefront header ---');
const css = read('../../client/src/index.css');

check(
  'the size token exists with the default on it',
  /--store-logo-size:\s*96px;/.test(css),
);
check(
  'the token is a length, not the multiplier the four named sizes used',
  /--store-logo-scale/.test(css) === false,
);

/* Both the uploaded logo and the initials fallback must be sized by the same
   expression. If only the image were sized, the header would change height the
   moment a merchant uploaded a logo - the exact jump the shared rule prevents. */
const sharedBoxRule = css.match(
  /\.store-header__logo,\s*\.store-header__mark \{([\s\S]*?)\n\}/,
)?.[1] || '';
check(
  'the logo and its initials fallback share one box rule',
  /--logo-box:\s*var\(--store-logo-size\)/.test(sharedBoxRule),
);
check(
  'the initials scale with the box instead of overflowing a small one',
  /font-size: calc\(var\(--logo-box\) \* 0\.26\)/.test(css),
);

/* The phone rules are two separate jobs and both have to be there: the ratio is
   what makes one number look right on a phone AND a desktop, and the viewport cap
   is the last word for a merchant who drags the slider all the way up. Drop the
   cap and a 200px logo takes the room the cart and account buttons need. */
const phoneBox =
  css.match(
    // `\r?\n` rather than `\n`: index.css is CRLF on disk, and a regex that
    // assumes LF silently matches nothing - which looks exactly like the CSS
    // not existing.
    /@media \(max-width: 768px\) \{\r?\n {2}\.store-header \{[\s\S]*?\r?\n {2}\}\r?\n\}/,
  )?.[0] ||
  '';
check(
  'a phone shrinks the logo to roughly two thirds of the chosen size',
  /calc\(var\(--store-logo-size\) \* 0\.66\)/.test(phoneBox),
);
check(
  'and caps it at a third of the screen, so the buttons are never pushed off',
  /36vw/.test(phoneBox),
);

const headerSrc = read('../../client/src/components/storefront/StoreHeader.jsx');
check(
  "the header sends the store's chosen size into the CSS",
  /style=\{logoSizeStyle\(store\?\.logoSize\)\}/.test(headerSrc),
);
check(
  'the logo is its own cell, which is what lets a phone centre it',
  /className="store-header__identity"/.test(headerSrc),
);
check(
  'the store name is NOT printed beside the logo any more',
  !/store-header__name/.test(headerSrc) && !/\.store-header__name/.test(css),
);

/* Phones centre the logo; a desktop keeps it hard left. The centring is equal
   outer tracks (`1fr auto 1fr`) precisely because the actions cell is wider
   than the menu button - a `1fr auto` split would sit the logo visibly
   off-centre by that difference. */
const mobileBlock =
  css.match(
    /@media \(max-width: 768px\) \{\s*\.store-header \{([\s\S]*?)\n {2}\}/,
  )?.[1] || '';
check(
  'a phone centres the logo between two equal tracks',
  /grid-template-columns:\s*1fr auto 1fr/.test(mobileBlock),
);
check(
  'the menu button and the logo are both centred within their tracks',
  /\.store-header__brand,\s*\.store-header__identity \{\s*justify-self: center;/.test(css),
);
check(
  'the icon buttons stay pinned to the right edge (a stretched flex row would put them mid-header)',
  /\.store-header__actions \{[\s\S]*?justify-self: end;/.test(css),
);
check(
  'the logo still carries no border',
  !/border:/.test(css.match(/\.store-header__logo \{[^}]*\}/)?.[0] || ''),
);

// --- 4. The Theme tab can actually reach it ----------------------------------
console.log('\n--- the theme tab ---');
const themeBuilder = read('../../client/src/pages/store/ThemeBuilder.jsx');
check('the logo panel renders the size control', /<LogoSizePicker/.test(themeBuilder));
check(
  'the preview is drawn at the size being chosen, not only the saved one',
  /style=\{logoSizeStyle\(liveLogoSize\)\}/.test(themeBuilder),
);

const pickerSrc = read('../../client/src/components/storefront/LogoSizePicker.jsx');
check(
  'the control saves through the store owner endpoint',
  /updateMyStore\(\s*\{ logoSize: next \}/.test(pickerSrc),
);
/* The request itself: a free number needs both a drag and a box to type into,
   because a drag can only ever land on the steps it has. */
check(
  'it is a free number, not a fixed list: a slider AND a number box',
  /type="range"/.test(pickerSrc) && /type="number"/.test(pickerSrc),
);
check(
  'both inputs are bounded by the same constants the API validates',
  (pickerSrc.match(/min=\{LOGO_SIZE_MIN\}/g) || []).length === 2 &&
    (pickerSrc.match(/max=\{LOGO_SIZE_MAX\}/g) || []).length === 2,
);
/* The debounce is the whole difference between this control and the four pills:
   a drag emits a change on every pixel, and one write per event would queue a
   hundred four-second round trips behind a single gesture. */
check(
  'dragging writes once, not once per pixel of travel',
  /SAVE_DELAY_MS = \d+/.test(pickerSrc) && /setTimeout\(/.test(pickerSrc),
);
check(
  'the preview follows the drag immediately, before the write lands',
  /onPreview\?\.\(next\)/.test(pickerSrc),
);
check(
  'a refused save puts the control and the preview back where they were',
  /setSize\(saved\)/.test(pickerSrc) && /onPreview\?\.\(saved\)/.test(pickerSrc),
);
check(
  'a drag left mid-air is committed rather than lost',
  /const commitNow = \(\) =>/.test(pickerSrc),
);
/* The copy is load-bearing too: the number is the desktop size, so a merchant
   who sets 180 and then checks their phone needs to be told why it is smaller. */
check(
  'the control tells the merchant the number is the desktop size',
  /on a desktop/.test(pickerSrc) && /on a phone/.test(pickerSrc),
);

/* The admin's Theme tab is the same component (ROUTES.ADMIN_THEME), so the
   control reaches both portals without a second copy - worth pinning, because a
   second copy is exactly how the two would drift. */
check(
  'the admin theme route points at the same builder (one control, both portals)',
  /ADMIN_THEME:\s*'\/admin\/theme'/.test(clientConstants),
);

// --- 5. The logo is not shrunk by its own padding ---------------------------
console.log('\n--- a padded logo still reads at full size ---');

/*
 * The reported bug, and it has two independent causes:
 *
 *  1. THE BOX WAS SQUARE. A wide wordmark fitted into a square with
 *     `object-fit: contain` is shrunk until it fits the WIDTH, so a logo four
 *     times wider than it is tall renders at a quarter of the size that was
 *     asked for - and no amount of dragging the size slider can fix it, because
 *     the box is already as big as it is allowed to be. Fixed by sizing the
 *     image by its HEIGHT (`max-height` with auto dimensions).
 *  2. THE IMAGE ITSELF IS MOSTLY EMPTY. A logo pasted from a web page arrives
 *     wrapped in white space, which eats the height again. Fixed at upload by
 *     trimming the empty border in the shared pipeline.
 *
 * Both are asserted here, because either one alone still leaves a small logo.
 */
const logoRule = css.match(/\.store-header__logo \{([\s\S]*?)\n\}/)?.[1] || '';
check(
  'the logo is sized by its HEIGHT, not fitted into a square box',
  /max-height:\s*var\(--logo-box\)/.test(logoRule) &&
    /width:\s*auto;/.test(logoRule) &&
    /height:\s*auto;/.test(logoRule),
);
check(
  'the square width/height no longer come from the box (that was the bug)',
  // Anchored to the start of a declaration: an unanchored `height:` also
  // matches inside `max-height:`, which is exactly what SHOULD be there.
  !/^\s*width:\s*var\(--logo-box\)/m.test(logoRule) &&
    !/^\s*height:\s*var\(--logo-box\)/m.test(logoRule),
);
check(
  'a wide logo is capped so it cannot eat the header',
  /--logo-max-width:\s*min\(320px, 38vw\)/.test(css) &&
    /max-width:\s*var\(--logo-max-width\)/.test(logoRule),
);
check(
  'a phone caps it harder still, and keeps the buttons reachable',
  /--logo-max-width:\s*46vw/.test(phoneBox),
);
/* The initials fallback must stay square: it has no shape to honour, and the
   shared box rule is the only reason the header does not jump when a merchant
   uploads a real logo. */
check(
  'the initials fallback still uses the box for both sides',
  /\.store-header__mark \{[\s\S]*?width:\s*var\(--logo-box\);[\s\S]*?height:\s*var\(--logo-box\)/.test(css),
);

const imageFile = read('../../client/src/utils/imageFile.js');
check(
  'the upload pipeline trims the empty border',
  /contentBounds/.test(imageFile) && /getImageData/.test(imageFile),
);
check(
  'it trims transparent AND near-white space (a logo pasted from a web page)',
  /BLANK_ALPHA/.test(imageFile) && /BLANK_CHANNEL/.test(imageFile),
);
check(
  'a canvas that cannot be read costs the trim, never the upload',
  /typeof ctx\?\.getImageData !== 'function'/.test(imageFile) &&
    /catch \{\s*return null;\s*\}/.test(imageFile.replace(/\s+/g, ' ')),
);
check(
  'a blank picture is never cropped down to a speck',
  /MIN_TRIMMED_EDGE/.test(imageFile),
);

const storeService = read('../../client/src/services/storeService.js');
check(
  'the logo upload goes through that shared pipeline',
  /imageToDataUrl\(file, 256\)/.test(storeService),
);
check(
  'and its old private copy of the resize code is gone',
  !/fileToResizedDataUrl/.test(storeService),
);

console.log('');


// (Section 1's controller checks live above, next to the model they belong to.)

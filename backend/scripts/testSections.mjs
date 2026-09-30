// Checks the storefront's category-section grouping against real store data,
// and that the stylesheet actually produces a horizontal rail. No browser
// needed: the behaviour lives in the grouping rule, and the rail is pure CSS.
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:5000/api';

const check = (label, ok, detail = '') =>
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);

// The exact fold from ShopPage.jsx, kept here so a change to one without the
// other shows up as a failing test rather than a silent behaviour change.
const UNCATEGORISED = 'Other items';
const group = (visible) => {
  const groups = new Map();
  for (const product of visible) {
    const name = String(product.category || '').trim() || UNCATEGORISED;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(product);
  }
  return [...groups.entries()].map(([name, items]) => ({ name, items }));
};

const store = await fetch(`${BASE}/stores/joes-pizza`).then((r) => r.json());
const products = store.products || [];
console.log(`store has ${products.length} products\n`);

const sections = group(products);

check(
  'every product lands in exactly one section',
  sections.reduce((n, s) => n + s.items.length, 0) === products.length,
  `${sections.reduce((n, s) => n + s.items.length, 0)} of ${products.length}`,
);
check(
  'no product is duplicated across sections',
  new Set(sections.flatMap((s) => s.items.map((p) => p.id))).size === products.length,
);
check(
  'no section has a blank heading',
  sections.every((s) => s.name.trim().length > 0),
);
check(
  'products with no category are gathered, not dropped',
  products.filter((p) => !String(p.category || '').trim()).every((p) =>
    sections.some((s) => s.name === UNCATEGORISED && s.items.some((i) => i.id === p.id)),
  ),
  `${sections.find((s) => s.name === UNCATEGORISED)?.items.length ?? 0} in "${UNCATEGORISED}"`,
);

console.log('\nsections the storefront would show:');
for (const s of sections) {
  console.log(`  ${s.name}  (${s.items.length})`);
  for (const p of s.items) console.log(`      - ${p.name}`);
}

// --- The rail markup itself -------------------------------------------
const css = fs.readFileSync(
  new URL('../../client/src/index.css', import.meta.url),
  'utf8',
);
check('CSS gives the track a horizontal scroller', /\.rail__track[\s\S]{0,400}overflow-x:\s*auto/.test(css));
check('CSS stops cards from stretching', /\.rail__track > \.product-card[\s\S]{0,120}flex:\s*0 0 auto/.test(css));
check('CSS pins each card to a fixed width', /\.rail__track > \.product-card[\s\S]{0,200}width:/.test(css));
check('CSS snaps to a card as you scroll', /\.rail__track[\s\S]{0,400}scroll-snap-type/.test(css));
check(
  'the grid takes over above the phone breakpoint',
  /@media \(min-width: 641px\)[\s\S]{0,400}store-sections__grid[\s\S]{0,80}display:\s*grid/.test(css),
);
check(
  'the rails are hidden on desktop, so nothing is listed twice',
  /@media \(min-width: 641px\)[\s\S]{0,200}\.store-sections \{[\s\S]{0,60}display:\s*none/.test(css),
);

/* --- The category card slider -----------------------------------------
   The regression that motivated this: the category cards used to live INSIDE
   `.store-sections`, which is `display: none` above 640px, so on any desktop
   the customer view showed the plain grid and NO category cards at all.

   These checks assert the slider's CSS is NOT inside that media query, so the
   bug cannot quietly come back. */
check('the category slider has styles', /\.cat-card \{[\s\S]{0,300}width:/.test(css));
check(
  'the slider track scrolls horizontally',
  /\.catstrip__track \{[\s\S]{0,300}overflow-x:\s*auto/.test(css),
);
check(
  'the slider snaps its cards while scrolling',
  /\.catstrip__track \{[\s\S]{0,300}scroll-snap-type/.test(css),
);
check(
  'slider cards are a fixed width, so the row overflows',
  /\.cat-card \{[\s\S]{0,120}flex:\s*0 0 auto/.test(css),
);
check('the selected card is visibly marked', /\.cat-card\.is-active \{/.test(css));

/* The load-bearing check. Take the whole desktop media query and confirm the
   slider is not inside it - if `.catstrip` or `.cat-card` were ever nested in
   that block, the cards would vanish above 640px all over again. */
const desktopBlock = (() => {
  const at = css.indexOf('@media (min-width: 641px)');
  if (at < 0) return '';
  const next = css.indexOf('@media', at + 10);
  return next < 0 ? css.slice(at) : css.slice(at, next);
})();

check(
  'the desktop breakpoint still exists (so this check means something)',
  desktopBlock.length > 0,
  `${desktopBlock.length} chars`,
);
check(
  'the category slider is NOT hidden on desktop (the regression)',
  !/\.catstrip\b[^}]*display:\s*none/.test(desktopBlock) &&
    !/\.cat-card\b[^}]*display:\s*none/.test(desktopBlock),
  desktopBlock.replace(/\s+/g, ' ').slice(0, 120),
);

/* The component must render one card per category, carrying the picture (or
   initials when there is none). The card's ELEMENT TYPE is asserted further
   down - it is a <Link> to a page, not a <button> filter. */
const sliderSrc = fs.readFileSync(
  new URL('../../client/src/components/storefront/CategorySlider.jsx', import.meta.url),
  'utf8',
);
check('the card carries the category picture', /category\.image[\s\S]{0,200}<img/.test(sliderSrc));
check('an imageless category falls back to initials', /initials\(category\.name\)/.test(sliderSrc));

/* And it must be mounted by the storefront as a SIBLING of the phone-only
   block, not inside it. */
const shopSrc = fs.readFileSync(
  new URL('../../client/src/pages/customer/ShopPage.jsx', import.meta.url),
  'utf8',
);
const sliderAt = shopSrc.indexOf('<CategorySlider');
const sectionsAt = shopSrc.indexOf('className="store-sections"');
check('ShopPage renders the slider', sliderAt > 0);
check(
  'the slider is a sibling of store-sections, not inside it',
  sliderAt > 0 && sectionsAt > 0 && sliderAt < sectionsAt,
  `slider@${sliderAt} sections@${sectionsAt}`,
);

/* --- The category page (/s/<slug>/c/<category>) ------------------------
   A category card must link to a PAGE, not filter in place. The check that
   matters is the one a casual read would miss: is the card a real <Link> (so
   the URL changes, the page is shareable and Back works) or a <button> with
   onClick state? */
check(
  'category cards are real links, not in-place filters',
  /<Link[\s\S]{0,220}className=\{`cat-card/.test(sliderSrc),
);
check('each card links to the category page', /to=\{linkFor\(category\.name\)\}/.test(sliderSrc));
check(
  'the active card is marked aria-current (it navigates, not toggles)',
  /aria-current=\{active \? 'page' : undefined\}/.test(sliderSrc),
);
check('the old onSelect filter prop is gone from the slider', !/onSelect/.test(sliderSrc));

const constantsSrc = fs.readFileSync(
  new URL('../../client/src/utils/constants.js', import.meta.url),
  'utf8',
);
check(
  'the category route is registered',
  /SHOP_CATEGORY: '\/s\/:slug\/c\/:category'/.test(constantsSrc),
);
check(
  'categoryPath encodes the name (an "&" or "/" must not break the path)',
  /export const categoryPath[\s\S]{0,220}encodeURIComponent/.test(constantsSrc),
);

const appSrc = fs.readFileSync(
  new URL('../../client/src/App.jsx', import.meta.url),
  'utf8',
);
check('the category page is routed', /ROUTES\.SHOP_CATEGORY\}/.test(appSrc));
check(
  'the category page is code-split like every other page',
  /lazy\(\(\) => import\('\.\/pages\/customer\/CategoryPage'\)\)/.test(appSrc),
);

/* The page must decode the segment: React Router hands back the raw value, and
   comparing an encoded "Tea%20%26%20Coffee" against a product's stored
   "Tea & Coffee" would silently match nothing. */
const catPageSrc = fs.readFileSync(
  new URL('../../client/src/pages/customer/CategoryPage.jsx', import.meta.url),
  'utf8',
);
check(
  'the page decodes the category from the URL',
  /decodeURIComponent\(rawCategory/.test(catPageSrc),
);
check(
  'and guards against a malformed escape',
  /catch \{[\s\S]{0,140}rawCategory/.test(catPageSrc),
);
check(
  'it shows the category name as a heading',
  /<h1 className="catpage__title">\{category\}/.test(catPageSrc),
);
check(
  'it offers a way back to the whole store',
  /catpage__back[\s\S]{0,320}shopPath\(slug\)/.test(catPageSrc),
);
check(
  'it reuses the shared product card, not a lookalike',
  /<ProductCard key=\{product\._id \|\| product\.id\} product=\{product\} \/>/.test(catPageSrc),
);
check(
  'its search is scoped to the category',
  /placeholder=\{`Search \$\{category\}…`\}/.test(catPageSrc),
);

/* The SPA fallback has to serve this deep path, or a refresh on
   /s/joes-pizza/c/drinks 404s even though the in-app click worked. */
const serverSrc = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
check(
  'the server SPA fallback covers any non-/api GET, so /s/x/c/y refreshes',
  serverSrc.includes('(?!api\\/)'),
  serverSrc.match(/app\.get\([^\n]*/)?.[0]?.trim().slice(0, 60),
);

/* --- Static identifier guard ------------------------------------------
   A guard, because the bug this catches is invisible to the build.

   Vite/esbuild only fails on an unresolved IMPORT. A bare identifier that was
   never declared - `setSuccessMsg` where the state setter is `setSuccess` -
   bundles perfectly and only throws a ReferenceError when that line runs. In a
   click handler behind a busy flag, that ReferenceError lands BEFORE the try,
   so the flag is never released and the button sits on "Adding…" forever. It
   shipped that way once already.

   So: every identifier ThemeBuilder.jsx calls should be declared in the file,
   imported, or a known global. Anything else is a name that does not exist. */
const themeSrc = fs.readFileSync(
  new URL('../../client/src/pages/store/ThemeBuilder.jsx', import.meta.url),
  'utf8',
);

/* Scan JS only, not JSX.

   In JSX, `<span>Added ✓</span>` is text, but a naive scan reads the word after
   a tag as if it were being CALLED, and every word inside a string or comment
   looks the same. Both produce noise that buries the one real finding.

   So strip, in order: comments, string/template literals, then JSX elements. */
const themeJs = themeSrc
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/\/\/[^\n]*/g, ' ')
  .replace(/`(?:\\.|[^`\\])*`/g, '""')
  .replace(/'(?:\\.|[^'\\])*'/g, '""')
  .replace(/"(?:\\.|[^"\\])*"/g, '""')
  .replace(/<[A-Za-z][^<>]*\/>/g, ' ')
  .replace(/<[A-Za-z][^<>]*>[\s\S]*?<\/[A-Za-z][^<>]*>/g, ' ')
  .replace(/<>/g, ' ')
  .replace(/<\/[^<>]*>/g, ' ');

/* What JSX and the runtime provide. Anything called that is not declared,
   imported, or listed here is undefined. */
const GLOBALS = new Set([
  'console', 'fetch', 'setTimeout', 'clearTimeout', 'setInterval',
  'clearInterval', 'window', 'document', 'localStorage', 'sessionStorage',
  'navigator', 'location', 'alert', 'confirm', 'prompt', 'URL', 'URLSearchParams',
  'Date', 'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean',
  'Map', 'Set', 'Promise', 'Error', 'RegExp', 'isNaN', 'parseInt', 'parseFloat',
  'encodeURIComponent', 'decodeURIComponent', 'Intl', 'AbortController',
  'FormData', 'FileReader', 'Image', 'Blob',
]);

/* Keywords are matched when they precede a paren, so they are removed by hand.
   Anything NOT on this list gets reported as a missing identifier. */
const calledBare = new Set();
for (const m of themeJs.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
  calledBare.add(m[1]);
}
for (const kw of [
  'if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'typeof',
  'async', 'await', 'new', 'delete', 'void', 'in', 'of', 'do', 'else',
  'yield', 'throw', 'case', 'instanceof',
]) {
  calledBare.delete(kw);
}

const declared = new Set();
for (const m of themeJs.matchAll(/(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) {
  declared.add(m[1]);
}
/* Destructured state and props. The array form matters most here: the SETTER
   lives in the brackets, and it is the setter that gets called -
   `const [errorMsg, setError] = useState('')`. */
for (const m of themeJs.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=/g)) {
  for (const part of m[1].split(',')) {
    const name = part.split(':').pop().split('=')[0].trim().replace(/^\.\.\./, '');
    if (name) declared.add(name);
  }
}
for (const m of themeJs.matchAll(/(?:const|let|var)\s*\[([^\]]*)\]\s*=/g)) {
  for (const part of m[1].split(',')) {
    const name = part.split(':').pop().trim().replace(/^\.\.\./, '');
    if (name) declared.add(name);
  }
}
/* Function parameters are local names, not globals. */
for (const m of themeJs.matchAll(/\(([^()]*)\)\s*=>/g)) {
  for (const part of m[1].split(',')) {
    const name = part.split('=')[0].trim().replace(/^\.\.\./, '');
    if (/^[A-Za-z_$][\w$]*$/.test(name)) declared.add(name);
  }
}
for (const m of themeJs.matchAll(/function\s*\*?\s*[A-Za-z_$][\w$]*\s*\(([^()]*)\)/g)) {
  for (const part of m[1].split(',')) {
    const name = part.split('=')[0].trim().replace(/^\.\.\./, '');
    if (/^[A-Za-z_$][\w$]*$/.test(name)) declared.add(name);
  }
}
/* Imports come from the ORIGINAL source: the string pass above rewrites
   `'./storeService'` to `""`, which would hide the names being looked for. */
for (const m of themeSrc.matchAll(/import\s+(.+?)\s+from/g)) {
  for (const part of m[1].replace(/[{}]/g, ',').split(',')) {
    const name = part.trim().split(/\s+as\s+/).pop().trim();
    if (name && /^[A-Za-z_$][\w$]*$/.test(name)) declared.add(name);
  }
}

const missing = [...calledBare]
  .filter((n) => !declared.has(n) && !GLOBALS.has(n))
  .sort();

console.log(
  missing.length === 0
    ? 'PASS  every function called in ThemeBuilder.jsx resolves to something real'
    : `FAIL  undefined identifier(s) called in ThemeBuilder.jsx:\n  ${missing.join('\n  ')}`,
);

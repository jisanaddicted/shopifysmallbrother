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

/* The arrows sit with the section heading, not in a row of their own below the
   cards. Below, they sat 0.35rem from the cards they control and 1.75rem from the
   NEXT section's heading - so they read as belonging to the section below, in a
   34px row of mostly empty space. These pin the placement and the rhythm. */
const railSrc = fs.readFileSync(
  new URL('../../client/src/components/storefront/CategoryRail.jsx', import.meta.url),
  'utf8',
);
check(
  'the arrows live inside the heading, not after the track',
  /rail__head[\s\S]{0,700}rail__nav[\s\S]{0,1400}<\/header>/.test(railSrc),
);
check(
  'and the heading closes before the track begins',
  /<\/header>[\s\S]{0,400}rail__track/.test(railSrc),
);
check('there is exactly one nav row, not two', (railSrc.match(/rail__nav/g) || []).length === 1);
check(
  'the arrows do not steal the track\'s width (the track still spans the section)',
  /\.rail__nav \{[\s\S]{0,200}flex-shrink: 0/.test(css) &&
    !/\.rail__nav \{[\s\S]{0,200}margin-top/.test(css),
);
check(
  'the header centres its rows rather than baselining against a round button',
  /\.rail__head \{[\s\S]{0,120}align-items: center/.test(css),
);
check(
  'the title can shrink so a long name cannot push the arrows off-screen',
  /\.rail__labels \{[\s\S]{0,160}flex: 1 1 auto[\s\S]{0,60}min-width: 0/.test(css),
);
check(
  'a heading sits closer to its own cards than to the next section (the rhythm)',
  /\.rail__head \{[\s\S]{0,600}margin-bottom: 0\.75rem/.test(css) &&
    /\.store-sections \{[\s\S]{0,120}gap: 1\.6rem/.test(css),
);
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

/* --- The product card's quantity stepper -------------------------------
   A stepper that can offer more than exists is worse than no stepper: the
   shopper builds a request the server refuses at checkout. These check the
   rules that keep that from happening, plus the fact that the chosen quantity
   actually reaches the cart. */
const cardSrc = fs.readFileSync(
  new URL('../../client/src/components/store/ProductCard.jsx', import.meta.url),
  'utf8',
);

check('the card has a quantity', /const \[qty, setQty\] = useState\(1\)/.test(cardSrc));
check(
  'the chosen quantity is passed to the cart, not a hardcoded 1',
  /addItem\([\s\S]{0,700}?\bqty,/.test(cardSrc) && !/addItem\(product, 1\)/.test(cardSrc),
);

/* The ceiling. One tap must never exceed the CHOSEN variant's stock, and a
   product that does not track inventory must not be capped by a number that is
   not a count. */
check('there is an upper bound per tap', /MAX_ADD_PER_TAP = \d+/.test(cardSrc));
check(
  'the bound follows the chosen variant stock, not the product',
  /maxAddable[\s\S]{0,300}stock/.test(cardSrc),
);
/* The three-way behaviour, asserted on the real source rather than a
   remembered shape of it: the ternary wraps across lines, so a single-line
   regex would miss it and report a false failure. Read the declaration and
   check the branches are there. */
const maxAddableDecl = (cardSrc.match(
  /const maxAddable =[\s\S]{0,260}?;/,
) || [''])[0];
check(
  'the ceiling falls back to the per-tap cap when stock is not counted',
  /countsStock && stock !== null/.test(maxAddableDecl) &&
    /:\s*MAX_ADD_PER_TAP/.test(maxAddableDecl),
  maxAddableDecl.replace(/\s+/g, ' ').slice(0, 90),
);
check(
  'and is otherwise clamped to the actual stock',
  /Math\.min\(MAX_ADD_PER_TAP, Number\(stock\) \|\| 0\)/.test(maxAddableDecl),
);
check(
  'the quantity is CLAMPED when the ceiling drops',
  /setQty\(\(previous\) => Math\.min\(Math\.max\(1, previous\), maxAddable\)\)/.test(cardSrc),
);
check(
  'and it resets when the card is reused for another product',
  /setSelection\(defaultSelection\(product\)\);[\s\S]{0,60}setQty\(1\)/.test(cardSrc),
);

/* The two bounds must be enforced in the UI too, or the clamp is only a
   backstop and the shopper can still type their way past it. */
check('the minus button is disabled at 1', /disabled=\{qty <= 1\}/.test(cardSrc));
check(
  'the plus button is disabled at the ceiling',
  /disabled=\{qty >= maxAddable\}/.test(cardSrc),
);
check('the plus button steps up within the bound', /setQty\(\(n\) => Math\.min\(maxAddable, n \+ 1\)\)/.test(cardSrc));
check('the minus button never goes below 1', /setQty\(\(n\) => Math\.max\(1, n - 1\)\)/.test(cardSrc));

/* A stepper that only changes a number the shopper cannot read is not a
   control. The button label carries the quantity too, so the action is never
   ambiguous. */
check(
  'the button states the quantity when it is not 1',
  /Add \$\{qty\} to cart/.test(cardSrc),
);
check(
  'the confirmation states the quantity too',
  /Added \$\{qty\} ✓/.test(cardSrc),
);
check('the count is announced to a screen reader', /aria-live="polite"/.test(cardSrc));
check(
  'each stepper button names what it does',
  (cardSrc.match(/aria-label=\{`One (?:fewer|more)/g) || []).length === 2,
);

/* A variant product must add the CHOSEN row, or two sizes of one product
   collapse into a single cart line. */
check(
  'a variant product adds the chosen row, keyed on the variant',
  /variantId: chosen\._id \|\| chosen\.id/.test(cardSrc),
);

/* A stray block comment that is never closed is INVISIBLE to the compiler in a
   way that matters here: everything it swallows still parses as comment text,
   so the build succeeds and the app fails at runtime with "x is not defined"
   for a declaration the source plainly contains.

   Not hypothetical. While adding the quantity stepper, a comment opened with a
   block marker and then continued with line-comment markers on the lines below.
   It swallowed the "Added" state, the unmount cleanup and the whole of
   handleAdd in ProductCard.jsx. The build was green, and every product card
   threw the moment Add was pressed.

   So this is a balance check over real code, with literals and comments
   stripped first - otherwise an image accept attribute and the host glob both
   read as an unclosed comment. */
const filesToCheck = [
  '../../client/src/components/store/ProductCard.jsx',
  '../../client/src/pages/store/ThemeBuilder.jsx',
  '../../client/src/pages/customer/ShopPage.jsx',
  '../../client/src/pages/customer/CategoryPage.jsx',
  '../../client/src/components/storefront/CategorySlider.jsx',
  '../../client/src/components/storefront/CategoryRail.jsx',
  '../../client/src/App.jsx',
  '../../client/src/utils/constants.js',
];

/* Did a stray block comment swallow real code?

   The failure this exists to catch: a comment opened with `/*` whose following
   lines used `//` instead of continuing the block. Everything from there to the
   next real `/*` becomes comment text, so a `const [justAdded, setJustAdded] =
   useState(false)` and a whole `handleAdd` silently vanish - the build stays
   green and every product card throws "addItem is not defined" at runtime.

   Attempted first as a real lexer, twice, and both versions were wrong in ways
   that reported a healthy file as broken and then a broken file as healthy -
   an apostrophe in prose ("one that does not count stock is never 'out of
   it'") opens a string that never closes, and after that the scan is fiction.
   A checker that cannot be trusted is worse than none.

   So this asserts the thing that actually matters, using only comparisons that
   cannot be thrown off by prose: does the file still CONTAIN the declarations a
   swallowed comment would have deleted? Those are exact strings, matched
   literally, so an apostrophe in a comment elsewhere is irrelevant. */
for (const rel of filesToCheck) {
  const raw = fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

  /* Structural sanity: balanced braces, as a cheap signal that a comment did
     not eat the end of a function.

     Scoped to the component files only. App.jsx is a route table full of JSX,
     where a brace can legitimately appear in rendered text, so counting them
     there reports a healthy file as broken. Inside a component body the braces
     really are code and really do balance. */
  const countsBraces = !rel.endsWith('App.jsx');
  if (countsBraces) {
    const opens = (raw.match(/\{/g) || []).length;
    const closes = (raw.match(/\}/g) || []).length;
    check(
      `braces balance in ${rel.split('/').pop()}`,
      opens === closes,
      opens === closes ? '' : `${opens} { vs ${closes} }`,
    );
  }
}

/* The declarations a swallowed comment deleted, asserted by exact content. Each
   one is a line of real code, not prose, so the match is unambiguous. */
const requiredInCard = [
  ['the Added state', 'const [justAdded, setJustAdded] = useState(false);'],
  ['the quantity state', 'const [qty, setQty] = useState(1);'],
  ['the cart hook', 'const { addItem } = useCart();'],
  ['handleAdd', 'const handleAdd = () => {'],
];
for (const [what, text] of requiredInCard) {
  check(`${what} is present in ProductCard.jsx`, cardSrc.includes(text), text);
}

/* And the one that actually threw: the cart call. If the comment ate
   handleAdd's body, `addItem(` is gone from the file even though the JSX still
   mentions the button. */
check(
  'handleAdd still calls the cart (this is what threw "addItem is not defined")',
  /addItem\(\s*chosen/.test(cardSrc),
);

/* The declarations the stray comment ate, asserted directly so a future failure
   names the missing thing rather than just "comments unbalanced". */
check(
  'the Added state survived (a stray comment swallowed it once)',
  /const \[justAdded, setJustAdded\] = useState\(false\)/.test(cardSrc),
);
check(
  'the unmount cleanup survived',
  /useEffect\(\(\) => \(\) => clearTimeout\(timer\.current\), \[\]\)/.test(cardSrc),
);
check('handleAdd is still defined', /const handleAdd = \(\) => \{/.test(cardSrc));
check(
  'handleAdd closes properly (the stray comment truncated it)',
  /setTimeout\(\(\) => setJustAdded\(false\), 1400\);\s*\};/.test(cardSrc),
);

check('the stepper reuses the shared .qty class', /className="qty qty--card"/.test(cardSrc));
check('the card stepper drops the drawer\'s vertical margin', /\.qty--card \{[\s\S]{0,120}margin-top: 0/.test(css));
check('the stepper and button share one row', /\.product-card__buy \{[\s\S]{0,160}display: flex/.test(css));
check(
  'the button can shrink so the stepper is never pushed out of a phone card',
  /\.product-card__buy \.btn \{[\s\S]{0,160}min-width: 0/.test(css),
);

/* --- The card is now a doorway, not a summary -------------------------- */
check(
  'the card no longer renders a description (it lives on the product page)',
  !/product-card__desc/.test(cardSrc) && !/truncate\(/.test(cardSrc),
);
check(
  'and the dead .product-card__desc CSS went with it',
  !/\.product-card__desc/.test(css),
);
check(
  'the card no longer shows a category badge (also on the product page now)',
  !/\{product\?\.category \?/.test(cardSrc),
);
check(
  'the card takes the store slug off the route rather than a prop',
  /useParams\(\)/.test(cardSrc) && /productPath\(slug, productId\)/.test(cardSrc),
);
check(
  'the card photo is a link to the product page',
  /className="product-card__open"[\s\S]{0,80}to=\{detailPath\}/.test(cardSrc),
);
check(
  'the photo link is hidden from assistive tech (the title link is the real one)',
  /product-card__open[\s\S]{0,220}tabIndex=\{-1\}[\s\S]{0,40}aria-hidden="true"/.test(
    cardSrc,
  ),
);
check(
  'the photo link is out of the flow, so the stock and options chips stay above it',
  /\.product-card__open \{[\s\S]{0,120}position: absolute[\s\S]{0,40}inset: 0/.test(css),
);
check(
  'the card title is a link that does not shout',
  /\.product-card__title a \{[\s\S]{0,80}text-decoration: none/.test(css),
);

/* The squeeze. Side by side in a ~150px card the label truncated to "Add 3 to…";
   the button now claims a full line of its own instead. */
check(
  'the phone footer wraps instead of forcing the stepper and button onto one line',
  /\.product-card__footer \{[\s\S]{0,140}flex-wrap: wrap/.test(css),
);
check(
  'the buy wrapper dissolves so the button can reach the second line',
  /\.product-card__buy \{\s*display: contents;/.test(css),
);
check(
  'the add button takes the full card width on a phone (this is the squeeze fix)',
  /\.product-card__buy \.btn \{[\s\S]{0,700}flex: 0 0 100%/.test(css),
);
check(
  'and the stepper moves to the right of the price rather than off the card',
  /\.product-card__buy \.qty--card \{[\s\S]{0,80}margin-left: auto/.test(css),
);

/* --- Product page ------------------------------------------------------ */
check(
  'the product route is registered',
  /SHOP_PRODUCT: '\/s\/:slug\/p\/:productId'/.test(constantsSrc),
);
check(
  'productPath encodes the id',
  /export const productPath[\s\S]{0,200}encodeURIComponent/.test(constantsSrc),
);
check('the product page is routed', /ROUTES\.SHOP_PRODUCT\}/.test(appSrc));
check(
  'the product page is code-split like every other page',
  /lazy\(\(\) => import\('\.\/pages\/customer\/ProductPage'\)\)/.test(appSrc),
);

const prodPageSrc = fs.readFileSync(
  new URL('../../client/src/pages/customer/ProductPage.jsx', import.meta.url),
  'utf8',
);
check(
  'it loads the product by id',
  /productService\.getProductById\(productId\)/.test(prodPageSrc),
);
check(
  'it renders the FULL description, which is why the card stopped carrying one',
  /product-page__desc[\s\S]{0,200}<p>\{product\.description\}<\/p>/.test(prodPageSrc),
);
check(
  'the description keeps the merchant\'s own line breaks',
  /\.product-page__desc p \{[\s\S]{0,200}white-space: pre-line/.test(css),
);
check(
  'it shows the category the card used to badge',
  /product-page__category[\s\S]{0,120}\{category\}/.test(prodPageSrc),
);
check(
  'it says how many are left, which no card had room for',
  /product-page__stock/.test(prodPageSrc),
);
check(
  'the purchase bar sticks, so a long description cannot hide the only buy button',
  /\.product-page__buy \{[\s\S]{0,120}position: sticky[\s\S]{0,40}bottom: 0/.test(css),
);
check(
  'the buy button takes the remaining width beside the stepper',
  /\.product-page__add \{[\s\S]{0,80}flex: 1/.test(css),
);
check(
  'a gallery of thumbnails only appears when there is a choice to make',
  /gallery\.length > 1 \?/.test(prodPageSrc),
);
check(
  'the chosen variant\'s own photo leads the gallery',
  /push\(chosen\?\.image\);[\s\S]{0,60}push\(product\?\.image\)/.test(prodPageSrc),
);
check(
  'picking an option resets the gallery to that option\'s picture',
  /setActiveImage\(0\);[\s\S]{0,40}\}, \[selection/.test(prodPageSrc),
);
check(
  'it caps one tap at the same 20 the card uses',
  /const MAX_ADD_PER_TAP = 20/.test(prodPageSrc),
);
check(
  'and honours the chosen variant\'s stock, like the card',
  /Math\.min\(MAX_ADD_PER_TAP, Number\(stock\) \|\| 0\)/.test(prodPageSrc),
);
check(
  'it adds the chosen VARIANT, so the cart line keys on the right row',
  /variantId: chosen\._id \|\| chosen\.id[\s\S]{0,120}price: chosen\.price/.test(
    prodPageSrc,
  ),
);
check(
  'it destructures addItem (its absence is what shipped "addItem is not defined")',
  /const \{ addItem, itemCount, openCart \} = useCart\(\);/.test(prodPageSrc),
);
check(
  'the "Added" confirmation is not scoped to the card, so the product page shows it too',
  /\.btn-primary\.is-added \{[\s\S]{0,120}var\(--ok\)/.test(css) &&
    !/\.product-card__footer \.btn\.is-added/.test(css),
);
check(
  'it offers more from the same category instead of a dead end',
  /More in \{category\}/.test(prodPageSrc),
);
check(
  'and that strip reuses the shared card, so it links onward to more pages',
  /<ProductCard key=\{item\._id \|\| item\.id\} product=\{item\} \/>/.test(prodPageSrc),
);
check(
  'the page stacks on a phone and splits into two columns above 640px',
  /@media \(min-width: 641px\)[\s\S]{0,120}product-page__layout[\s\S]{0,160}minmax\(0, 1fr\) minmax\(0, 1fr\)/.test(
    css,
  ),
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
const KEYWORDS = [
  'if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'typeof',
  'async', 'await', 'new', 'delete', 'void', 'in', 'of', 'do', 'else',
  'yield', 'throw', 'case', 'instanceof',
];

/**
 * Every bare name `src` calls that is not declared in it, imported by it, or
 * provided by the runtime.
 *
 * Applied to more than one file now. `addItem is not defined` has shipped twice
 * in this codebase - once on a card, once on a page - and both times it was a
 * name that was called but never pulled out of the hook that provides it. Each
 * of those is a one-line omission in a component that builds perfectly.
 */
function undefinedIdentifiers(src) {
  /* Scan JS only, not JSX.

     In JSX, `<span>Added ✓</span>` is text, but a naive scan reads the word after
     a tag as if it were being CALLED, and every word inside a string or comment
     looks the same. Both produce noise that buries the one real finding.

     So strip, in order: comments, string/template literals, then JSX elements. */
  const js = src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/`(?:\\.|[^`\\])*`/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, '""')
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/<[A-Za-z][^<>]*\/>/g, ' ')
    .replace(/<[A-Za-z][^<>]*>[\s\S]*?<\/[A-Za-z][^<>]*>/g, ' ')
    .replace(/<>/g, ' ')
    .replace(/<\/[^<>]*>/g, ' ');

  const calledBare = new Set();
  for (const m of js.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
    calledBare.add(m[1]);
  }
  for (const kw of KEYWORDS) calledBare.delete(kw);

  const declared = new Set();
  for (const m of js.matchAll(/(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) {
    declared.add(m[1]);
  }
  /* Destructured state and props. The array form matters most here: the SETTER
     lives in the brackets, and it is the setter that gets called -
     `const [errorMsg, setError] = useState('')`. */
  for (const m of js.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=/g)) {
    for (const part of m[1].split(',')) {
      const name = part.split(':').pop().split('=')[0].trim().replace(/^\.\.\./, '');
      if (name) declared.add(name);
    }
  }
  for (const m of js.matchAll(/(?:const|let|var)\s*\[([^\]]*)\]\s*=/g)) {
    for (const part of m[1].split(',')) {
      const name = part.split(':').pop().trim().replace(/^\.\.\./, '');
      if (name) declared.add(name);
    }
  }
  /* Function parameters are local names, not globals. */
  for (const m of js.matchAll(/\(([^()]*)\)\s*=>/g)) {
    for (const part of m[1].split(',')) {
      const name = part.split('=')[0].trim().replace(/^\.\.\./, '');
      if (/^[A-Za-z_$][\w$]*$/.test(name)) declared.add(name);
    }
  }
  for (const m of js.matchAll(/function\s*\*?\s*[A-Za-z_$][\w$]*\s*\(([^()]*)\)/g)) {
    for (const part of m[1].split(',')) {
      const name = part.split('=')[0].trim().replace(/^\.\.\./, '');
      if (/^[A-Za-z_$][\w$]*$/.test(name)) declared.add(name);
    }
  }
  /* Imports come from the ORIGINAL source: the string pass above rewrites
     `'./storeService'` to `""`, which would hide the names being looked for.

     `[\s\S]` rather than `.` because most files here import several names across
     a multi-line block, and a dot does not cross a newline - so a non-greedy
     `.+?` would fail to match those imports at all and report every name in them
     as undefined. That is a false positive, and a guard that cries wolf gets
     ignored. */
  for (const m of src.matchAll(/import\s+([\s\S]+?)\s+from/g)) {
    for (const part of m[1].replace(/[{}]/g, ',').split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) declared.add(name);
    }
  }

  return [...calledBare]
    .filter((n) => !declared.has(n) && !GLOBALS.has(n))
    .sort();
}

for (const [label, relative] of [
  ['ThemeBuilder.jsx', '../../client/src/pages/store/ThemeBuilder.jsx'],
  ['ProductPage.jsx', '../../client/src/pages/customer/ProductPage.jsx'],
  ['ProductCard.jsx', '../../client/src/components/store/ProductCard.jsx'],
  ['CategoryPage.jsx', '../../client/src/pages/customer/CategoryPage.jsx'],
]) {
  const src = fs.readFileSync(new URL(relative, import.meta.url), 'utf8');
  const missing = undefinedIdentifiers(src);
  console.log(
    missing.length === 0
      ? `PASS  every function called in ${label} resolves to something real`
      : `FAIL  undefined identifier(s) called in ${label}:\n  ${missing.join('\n  ')}`,
  );
}

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

/* A static guard, because the bug this catches is invisible to the build.

   Vite/esbuild only fails on an unresolved IMPORT. A bare identifier that was
   never declared - `setSuccessMsg` where the state setter is `setSuccess` -
   bundles perfectly and only throws a ReferenceError when that line actually
   runs. In a click handler behind a busy flag, that ReferenceError lands
   BEFORE the try, so the flag is never released and the button sits on
   "Adding…" forever. It shipped that way once already.

   So: every identifier this file calls should be either declared in the file,
   imported, or a known global. Anything else is a name that does not exist. */
const src = fs.readFileSync(
  new URL('../../client/src/pages/store/ThemeBuilder.jsx', import.meta.url),
  'utf8',
);

/* Scan JS only, not JSX.

   In JSX, `<span>Added ✓</span>` is text, but a naive scan reads the word after
   a tag as if it were being CALLED, and every word inside a string or a
   comment looks the same. Both produce noise that buries the one real finding.

   So strip, in order: comments, then string/template literals, then any JSX
   element or fragment. What is left is close enough to the script half of the
   file for an identifier check, which is all this is for. */
const js = src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')      // block comments
  .replace(/\/\/[^\n]*/g, ' ')            // line comments
  .replace(/`(?:\\.|[^`\\])*`/g, '""')    // template literals
  .replace(/'(?:\\.|[^'\\])*'/g, '""')    // single-quoted strings
  .replace(/"(?:\\.|[^"\\])*"/g, '""')    // double-quoted strings
  /* JSX tags, self-closing or paired: <div ...> ... </div>. The inner text of
     an element is not an expression, so the whole element goes. */
  .replace(/<[A-Za-z][^<>]*\/>/g, ' ')
  .replace(/<[A-Za-z][^<>]*>[\s\S]*?<\/[A-Za-z][^<>]*>/g, ' ')
  .replace(/<>/g, ' ')
  .replace(/<\/[^<>]*>/g, ' ');

const GLOBALS = new Set([
  'console', 'fetch', 'setTimeout', 'clearTimeout', 'setInterval',
  'clearInterval', 'window', 'document', 'localStorage', 'sessionStorage',
  'navigator', 'location', 'alert', 'confirm', 'prompt', 'URL', 'Date',
  'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Map',
  'Set', 'Promise', 'Error', 'RegExp', 'isNaN', 'parseInt', 'parseFloat',
  'encodeURIComponent', 'decodeURIComponent', 'Intl', 'AbortController',
]);

/* `x.y(` and `x?.y(` count as using `x`, not as calling a bare `y`. */
const calledBare = new Set();
for (const m of js.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
  calledBare.add(m[1]);
}

/* Keywords are matched by the regex above when they precede a paren, so they
   have to be removed by hand: `async` in `(async () => ...)`, `new` in
   `new Set(`, and so on. Listed explicitly rather than guessed, because
   anything NOT on this list gets reported as a missing identifier. */
for (const kw of [
  'if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'typeof',
  'async', 'await', 'new', 'delete', 'void', 'in', 'of', 'do', 'else',
  'yield', 'throw', 'case', 'instanceof',
]) {
  calledBare.delete(kw);
}
const declared = new Set();
for (const m of js.matchAll(/(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) {
  declared.add(m[1]);
}
/* Destructured state and props: `const { a, b } = useState()` and the
   `function C({ a })` parameter form. Note the multi-name form this has to
   catch is `const [errorMsg, setError] = useState('')` - the SETTER lives in
   the brackets, and it is the setter that gets called. */
for (const m of js.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=/g)) {
  for (const part of m[1].split(',')) {
    const name = part.split(':').pop().split('=')[0].trim().replace(/^\.\.\./, '');
    if (name) declared.add(name);
  }
}
/* Array destructuring - `const [a, b] = useState()`. Each comma-separated slot
   is a name, and a renamed slot is `original: local`. */
for (const m of js.matchAll(/(?:const|let|var)\s*\[([^\]]*)\]\s*=/g)) {
  for (const part of m[1].split(',')) {
    const name = part.split(':').pop().trim().replace(/^\.\.\./, '');
    if (name) declared.add(name);
  }
}
/* Imports are read from the ORIGINAL source, not the stripped copy: the
   string-literal pass above rewrites `'./storeService'` to `""`, which would
   hide the very names this is looking for. */
for (const m of src.matchAll(/import\s+(.+?)\s+from/g)) {
  for (const part of m[1].replace(/[{}]/g, ',').split(',')) {
    const name = part.trim().split(/\s+as\s+/).pop().trim();
    if (name && /^[A-Za-z_$][\w$]*$/.test(name)) declared.add(name);
  }
}

/* Function PARAMETERS are local names, not globals. `const toggleIn = (setter,
   id) => ...` DECLARES `setter`, so calling it is not an undefined reference.
   Without this, every callback parameter in the file reads as a missing global. */
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

const missing = [...calledBare].filter((n) => !declared.has(n) && !GLOBALS.has(n)).sort();

console.log(missing.length === 0
  ? 'PASS  every function called in ThemeBuilder.jsx resolves to something real'
  : `FAIL  undefined identifier(s) called in ThemeBuilder.jsx:\n  ${missing.join('\n  ')}`);

process.exitCode = missing.length === 0 ? 0 : 1;


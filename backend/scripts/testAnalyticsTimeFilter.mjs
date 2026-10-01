// The date filter behind the rider console and the store's rider analytics.
//
//   node scripts/testAnalyticsTimeFilter.mjs
//
// Two things are being protected here.
//
// 1. ONE definition of "today". The filter was written inside RiderConsole, then
//    needed again by StoreRiderAnalytics. Copy-pasting it would have been the
//    path of least resistance, but two copies of `startOfDay` is how a rider and
//    a store owner end up disagreeing about which deliveries "last 7 days"
//    covers - and the whole point of this page is that a rider and a store owner
//    are reading about the SAME orders. So it lives in utils/dateWindow.js and
//    both screens import it. The behaviour tests below run against that real
//    file; the source assertions prove neither screen grew a private copy back.
//
// 2. The filter narrows the LIST and nothing else. The headline cards and the
//    per-rider table are computed by the server over all time. Re-deriving them
//    client-side from the filtered rows would produce a second set of averages
//    that silently disagreed with the first.
//
// No browser and no server, same convention as testProductCardFit.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

let pass = 0;
let fail = 0;
const check = (label, ok, detail = '') => {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
};

const clientSrc = new URL('../../client/src/', import.meta.url);
const read = (relative) => fs.readFileSync(new URL(relative, clientSrc), 'utf8');

const utilSource = read('utils/dateWindow.js');
const analytics = read('pages/store/StoreRiderAnalytics.jsx');
const rider = read('pages/rider/RiderConsole.jsx');

/* The util is plain ESM with no JSX, but it sits under client/package.json
   rather than backend's, so it is copied to a .mjs temp file first and imported
   from there. That keeps these tests running the REAL source text rather than a
   re-implementation of it, which would happily agree with a bug. */
const tempModule = path.join(os.tmpdir(), `dateWindow-under-test-${process.pid}.mjs`);
fs.writeFileSync(tempModule, utilSource, 'utf8');

const {
  ANY_DATE,
  CUSTOM_RANGE,
  DATE_OPTIONS,
  DATE_WINDOWS,
  dateWindow,
  endOfDay,
  inWindow,
  isDefaultDateFilter,
  parseDay,
  startOfDay,
} = await import(pathToFileURL(tempModule).href);

const DAY_MS = 24 * 60 * 60 * 1000;

// --- parseDay: local, never UTC ---------------------------------------------

const day = parseDay('2026-09-26');
check(
  'parseDay reads YYYY-MM-DD as LOCAL midnight, not UTC',
  day.getFullYear() === 2026 &&
    day.getMonth() === 8 &&
    day.getDate() === 26 &&
    day.getHours() === 0,
  `got ${day.toString()}`,
);
check('parseDay rejects an empty value', parseDay('') === null);
check('parseDay rejects a non-date value', parseDay('not-a-date') === null);
check('parseDay rejects null rather than throwing', parseDay(null) === null);

// --- dateWindow -------------------------------------------------------------

check('"Any date" means no window at all', dateWindow(ANY_DATE, '', '') === null);
check('an unknown filter means no window (fails open, never hides everything)',
  dateWindow('nonsense', '', '') === null);

const week = dateWindow(CUSTOM_RANGE, '2026-09-01', '2026-09-07');
check('a custom range starts at the first millisecond of the from day',
  week.from.getTime() === new Date(2026, 8, 1, 0, 0, 0, 0).getTime());
check('a custom range ends at the LAST millisecond of the to day',
  week.to.getTime() === new Date(2026, 8, 7, 23, 59, 59, 999).getTime(),
  'so an order placed at 23:50 that evening is included, not dropped');

const reversed = dateWindow(CUSTOM_RANGE, '2026-09-07', '2026-09-01');
check('a reversed custom range is swapped, not rejected',
  reversed.from.getTime() === week.from.getTime() &&
  reversed.to.getTime() === week.to.getTime());

check('a custom range with only the from date is "any date", NOT "hide everything"',
  dateWindow(CUSTOM_RANGE, '2026-09-01', '') === null);
check('a custom range with only the to date is "any date"',
  dateWindow(CUSTOM_RANGE, '', '2026-09-07') === null);

const today = dateWindow('today', '', '');
check('"Today" runs from the first millisecond of today',
  today.from.getTime() === startOfDay(new Date()).getTime());
check('"Today" ends at the last millisecond of today',
  today.to.getTime() === endOfDay(new Date()).getTime());

// "7d" must be SEVEN days including today, so it reaches back six - not seven.
for (const [preset, days] of Object.entries(DATE_WINDOWS)) {
  const w = dateWindow(preset, '', '');
  const reached = Math.round(
    (startOfDay(new Date()).getTime() - w.from.getTime()) / DAY_MS,
  );
  check(`"${preset}" covers ${days} days including today (reaches back ${days - 1})`,
    reached === days - 1,
    `reached back ${reached}`);
}

// "Any date" and "Custom range" are the two options that legitimately produce
// NO window - one means "don't filter", the other waits on the date inputs. The
// rest must each resolve to a real window, or one of the presets silently
// degrades into a no-op filter.
const windowlessOptions = [ANY_DATE, CUSTOM_RANGE];
check('every quick preset in DATE_OPTIONS resolves to a real window',
  DATE_OPTIONS
    .filter((o) => !windowlessOptions.includes(o.value))
    .every((o) => dateWindow(o.value, '', '') !== null));
check('"Any date" and "Custom range" are the only windowless options',
  windowlessOptions.every((v) => dateWindow(v, '', '') === null));
// --- inWindow ---------------------------------------------------------------

const range = {
  from: new Date(2026, 8, 1, 0, 0, 0, 0),
  to: new Date(2026, 8, 7, 23, 59, 59, 999),
};
check('inWindow includes the very first millisecond', inWindow(range.from, range));
check('inWindow includes the very last millisecond', inWindow(range.to, range));
check('inWindow excludes a day before the range', !inWindow(new Date(2026, 7, 31, 12), range));
check('inWindow excludes a day after the range', !inWindow(new Date(2026, 8, 8), range));
check('a null window keeps everything', inWindow(new Date(), null));
check('a null-window call keeps an undated row too', inWindow(undefined, null));

// The analytics list uses this to hide undated rows: an order whose timestamp
// cannot be parsed cannot honestly be claimed to fall inside a range. The rider
// console deliberately keeps undated rows visible instead - a missing job is a
// missed delivery - so this is the one behaviour that intentionally differs
// between the two screens, and it is why they share the helper but not the call.
check('an undated row is HIDDEN from a real window', !inWindow(undefined, range));

check('isDefaultDateFilter is true only at the untouched starting state',
  isDefaultDateFilter(ANY_DATE, '', '') === true &&
  isDefaultDateFilter('7d', '', '') === false &&
  isDefaultDateFilter(ANY_DATE, '2026-09-01', '') === false);

// --- one shared definition --------------------------------------------------

for (const [name, source] of [
  ['RiderConsole', rider],
  ['StoreRiderAnalytics', analytics],
]) {
  check(`${name} imports the shared date helpers`,
    /from '\.\.\/\.\.\/utils\/dateWindow'/.test(source));

  // A private copy would be a second `function dateWindow(` or `DATE_WINDOWS =`.
  check(`${name} defines no private copy of the filter logic`,
    !/function dateWindow\s*\(/.test(source) &&
    !/const\s+DATE_WINDOWS\s*=/.test(source) &&
    !/const\s+parseDay\s*=/.test(source));
}

// --- the filter is on the list, above it, and only on it ---------------------

// Anchored on the panel HEADING, not the phrase "Every delivery": that phrase
// also appears in this file's top comment, and the file renders an EARLIER table
// (the per-rider one). A bare indexOf('<table') would measure the filter against
// the wrong table and fail for the wrong reason.
const ordersPanelAt = analytics.indexOf('>Every delivery<');
const filterAt = analytics.indexOf('<div className="filters">', ordersPanelAt);
const tableAt = analytics.indexOf('<table', ordersPanelAt);
check('the time filter renders INSIDE the delivery panel, above its list',
  ordersPanelAt !== -1 && filterAt > ordersPanelAt && tableAt > filterAt,
  `panel ${ordersPanelAt}, filter ${filterAt}, table ${tableAt}`);

check('the order list is rendered from the FILTERED rows',
  /visibleRows\.map\(/.test(analytics) && !/<tbody>\s*\{rows\.map\(/.test(analytics));

check('the filter offers the quick presets and a custom range',
  /DATE_OPTIONS\.map\(/.test(analytics) && analytics.includes('type="date"'));
check('a clear button is offered only when a filter is active',
  analytics.includes('onClick={clearDates}') && /filterActive\s*\?/.test(analytics));

// The regression this page is most likely to reintroduce: re-deriving the
// averages from the filtered rows so the cards "match" the list. `summary` must
// keep coming straight off the server payload.
check('the summary cards are NOT recomputed from the filtered rows',
  !/summary\s*=\s*\{[\s\S]{0,200}visibleRows/.test(analytics) &&
  analytics.includes('data?.summary'));
check('the per-rider table is NOT recomputed from the filtered rows',
  !/riders\s*=\s*[\s\S]{0,120}visibleRows/.test(analytics) &&
  analytics.includes('data?.riders'));

// --- hook ordering ----------------------------------------------------------

/* A real bug, caught while writing this: the `useMemo` that computes
   visibleRows was first placed after the `if (loading)` early return. That works
   on the render where loading is true and throws "Rendered fewer hooks than
   expected" on the very next one, i.e. the analytics page would have crashed
   every single time it loaded. Guard it. */
const earlyReturnAt = analytics.indexOf('if (loading) {');
const hooksAfterReturn =
  analytics.slice(earlyReturnAt).match(/\buse(State|Effect|Memo|Callback|Ref)\(/g) || [];
check('no hook is called after the `if (loading)` early return',
  earlyReturnAt !== -1 && hooksAfterReturn.length === 0,
  hooksAfterReturn.length ? `found: ${hooksAfterReturn.join(', ')}` : '');
check('the filtered rows are computed with useMemo',
  analytics.includes('visibleRows') && analytics.includes('useMemo'));

fs.rmSync(tempModule, { force: true });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
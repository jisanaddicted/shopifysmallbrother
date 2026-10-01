/**
 * The date filter shared by the rider console and the store's rider analytics.
 *
 * It started as a private block at the top of RiderConsole.jsx and was copied
 * - not shared - into AdminDashboard, where a second `startOfDay`/`endOfDay`
 * pair turned up with subtly different behaviour. Three copies of "what does
 * 'today' mean" is three places for them to disagree, so this is now the only
 * definition and both screens import it.
 *
 * Everything here is PURE and takes its clock from `new Date()` at call time,
 * which is what makes it testable: pass a window, get a window back, no state.
 */

/** The value meaning "do not filter by date at all". */
export const ANY_DATE = 'all';

/** The value meaning "use the from/to inputs". */
export const CUSTOM_RANGE = 'custom';

/**
 * The quick options, in the order they are offered.
 *
 * Deliberately the same list in both screens. A rider and a store owner looking
 * at the same deliveries should not have to learn two vocabularies for "last
 * week".
 */
export const DATE_OPTIONS = [
  { value: ANY_DATE, label: 'Any date' },
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: CUSTOM_RANGE, label: 'Custom range' },
];

/**
 * How many days back each quick option reaches. "7d" means today *and* the six
 * days before it, so it is 7 days of orders in total rather than 8.
 */
export const DATE_WINDOWS = { today: 1, '7d': 7, '30d': 30 };

/**
 * Parses a `<input type="date">` value ("2026-09-26") into a *local* midnight.
 *
 * `new Date('2026-09-26')` is parsed as UTC by the language and can land on the
 * previous day for anybody west of Greenwich, which would quietly hide every
 * order placed on the day they selected. The parts are read out by hand.
 */
export const parseDay = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;

  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
};

export const startOfDay = (date) => {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
};

export const endOfDay = (date) => {
  const copy = startOfDay(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
};

/**
 * The [from, to] window a filter selects, or null for "any date".
 *
 * Two deliberate choices about half-finished input:
 *
 *  - A custom range with only one end filled in is "any date", NOT "hide
 *    everything". Somebody is halfway through typing, and a list that empties the
 *    moment they pick the first date reads as a bug rather than as a filter.
 *  - Reversed dates are swapped rather than rejected, so a range is always
 *    usable even if the two boxes are filled in the other order.
 */
export function dateWindow(dateFilter, fromDate, toDate) {
  if (dateFilter === CUSTOM_RANGE) {
    const from = parseDay(fromDate);
    const to = parseDay(toDate);
    if (!from || !to) return null;

    return from.getTime() <= to.getTime()
      ? { from: startOfDay(from), to: endOfDay(to) }
      : { from: startOfDay(to), to: endOfDay(from) };
  }

  const days = DATE_WINDOWS[dateFilter];
  if (!days) return null;

  const to = endOfDay(new Date());
  const from = startOfDay(new Date());
  from.setDate(from.getDate() - (days - 1));

  return { from, to };
}

/** Is `value` a timestamp inside `window`? A null window means "everything". */
export const inWindow = (value, window) => {
  if (!window) return true;

  const at = new Date(value || 0).getTime();
  if (!Number.isFinite(at)) return false;

  return at >= window.from.getTime() && at <= window.to.getTime();
};

/**
 * The filter's state is at its default - used to decide whether to show a
 * "clear" button at all, so a screen that opens on its default never nags.
 */
export const isDefaultDateFilter = (dateFilter, fromDate, toDate) =>
  dateFilter === ANY_DATE && !fromDate && !toDate;

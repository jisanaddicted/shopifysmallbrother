/**
 * Proves the order-confirmation formatters render what the receipt promises.
 *
 * These are the three places the page can quietly print something wrong: the
 * truncated ObjectId, the status pill, and the total. Each has a failure mode
 * that compiles perfectly and is invisible until a shopper looks at it - a
 * "DR-…4821" where a short code should be, an uncapitalised "pending", a total
 * with no thousands separator. Asserting the output strings is the only way to
 * catch them without opening the page by hand for every status.
 *
 * The shared constants read `import.meta.env`, which bare node cannot evaluate,
 * so this runs under Vite's SSR module loader rather than plain `node`. That is
 * the same reason the sibling backend tests that need those constants read them
 * as source text instead of importing them - except here the assertions are
 * about real OUTPUT, so importing is worth the extra machinery.
 *
 * Run:  npm --prefix client run test:orderconfirm
 */
import {
  formatCurrency,
  formatDateTime,
  formatObjectId,
  formatStatus,
} from '../src/utils/formatters.js';
import {
  ORDER_STATUS,
  ORDER_STATUS_TONE,
  PAYMENT_METHOD_LABELS,
} from '../src/utils/constants.js';

let failures = 0;

function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      expected: ${expected}\n      actual:   ${actual}`);
}

console.log('--- the ObjectId, truncated ---');
check(
  'first four and last four of a 24-char hex id',
  formatObjectId('0123456789abcdef01234567'),
  '0123…4567',
);
check(
  'the truncated id is 9 characters (4 + ellipsis + 4)',
  formatObjectId('0123456789abcdef01234567').length,
  9,
);
check(
  'uppercase hex is truncated too',
  formatObjectId('0123456789ABCDEF01234567'),
  '0123…4567',
);
check('a short human code is left alone', formatObjectId('DR-4821'), 'DR-4821');
check(
  'a uuid is left alone',
  formatObjectId('550e8400-e29b-41d4-a716-446655440000'),
  '550e8400-e29b-41d4-a716-446655440000',
);
check('undefined is empty, not the word "undefined"', formatObjectId(undefined), '');

console.log('\n--- the status pill ---');
for (const status of Object.values(ORDER_STATUS)) {
  const label = formatStatus(status);
  const tone = ORDER_STATUS_TONE[status];
  check(
    `${status} -> "${label}" (tone: ${tone})`,
    Boolean(label) && label[0] === label[0].toUpperCase() && Boolean(tone),
    true,
  );
}
check(
  'a machine value with underscores becomes words',
  formatStatus(ORDER_STATUS.READY_FOR_PICKUP),
  'Ready for pickup',
);
check('an unknown status still renders', formatStatus('brand_new'), 'brand new');

console.log('\n--- the money ---');
check('a small total', formatCurrency(450), '৳450.00');
check(
  'a total over 1000 gets a thousands separator',
  formatCurrency(125000).includes(','),
  true,
);
check('zero is a total, not a blank', formatCurrency(0), '৳0.00');
check('a string from the API is coerced', formatCurrency('850.5'), '৳850.50');
check('NaN never reaches the page', formatCurrency('not-a-number'), '—');

console.log('\n--- the date ---');
check(
  'an ISO string becomes a readable date, not an ISO blob',
  formatDateTime('2026-10-03T09:50:00.000Z').length > 0 &&
    !formatDateTime('2026-10-03T09:50:00.000Z').includes('T'),
  true,
);
check('a missing date is an em dash', formatDateTime(null), '—');
check('a nonsense date is an em dash', formatDateTime('nonsense'), '—');

console.log('\n--- the payment channel ---');
check('cod is named, not guessed', PAYMENT_METHOD_LABELS.cod, 'Cash on delivery');
check('bkash keeps its own name', PAYMENT_METHOD_LABELS.bkash, 'bKash');
check(
  'every payment method has a label',
  ['cod', 'card', 'bkash', 'nagad', 'rocket'].every(
    (m) => Boolean(PAYMENT_METHOD_LABELS[m]),
  ),
  true,
);

console.log(
  failures === 0
    ? '\nAll order-confirmation checks passed.'
    : `\n${failures} check(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);

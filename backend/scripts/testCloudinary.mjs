/**
 * Tests for src/services/cloudinary.js (image hosting).
 *
 *   npm --prefix backend run test:images
 *
 * Two halves, because the interesting failure modes are different:
 *
 *  1. The pure helpers - public-id construction, URL parsing, the data-URL
 *     validator. These run always, with or without credentials, and they are
 *     where a mistake is silent: a mangled public id uploads fine and then the
 *     NEXT upload to the same slot creates a second file instead of replacing
 *     the first.
 *
 *  2. The live path - a real upload, a real fetch of the delivered URL. Needs
 *     working credentials; without them it SKIPS rather than fails, so a fresh
 *     clone without a Cloudinary account still has a green test run. The point
 *     of that half is to catch the credential problem itself, so when
 *     credentials ARE configured but rejected, it fails loudly.
 */
import {
  hostImage,
  isCloudinaryUrl,
  isImageDataUrl,
  imageHostingReady,
  publicIdFor,
  publicIdFromUrl,
  removeImage,
  uploadImage,
} from '../src/services/cloudinary.js';
import { config, isCloudinaryConfigured } from '../src/config/env.js';

// A real 1x1 PNG, so this is a genuine image payload and not a fake header.
const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let passed = 0;
let failed = 0;
const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? `  ${extra}` : ''}`);
  if (ok) passed += 1;
  else failed += 1;
};

// --------------------------------------------------------------------------
// 1. Pure helpers - no network, no credentials
// --------------------------------------------------------------------------

console.log('--- helpers ---');

check(isImageDataUrl(PNG_1PX), 'a 1x1 PNG data URL is accepted');
check(!isImageDataUrl('data:text/html;base64,PGI+hi'), 'a non-image data URL is refused');
check(!isImageDataUrl('https://example.com/x.png'), 'a remote URL is refused');
check(!isImageDataUrl('javascript:alert(1)'), 'a javascript: URL is refused');
check(!isImageDataUrl(null) && !isImageDataUrl(undefined), 'a missing value is refused');

const overCap = `data:image/png;base64,${'A'.repeat(1024 * 1024 * 4)}`;
check(!isImageDataUrl(overCap), 'a payload over the 1MB cap is refused');

check(publicIdFor('65f0a1b2c3', 'logo') === '65f0a1b2c3-logo', 'public id: store + slot');
check(
  publicIdFor('store1', 'category', 'Hot & Spicy') === 'store1-category-hot-spicy',
  'public id: punctuation and spaces are squashed',
  publicIdFor('store1', 'category', 'Hot & Spicy'),
);
check(publicIdFor('store1', '') === 'store1', 'public id: empty parts are dropped');

const deliverySample =
  'https://res.cloudinary.com/d9ok/image/upload/q_auto,f_auto/v1234/delivery-app/stores/abc/logo.png';
check(
  publicIdFromUrl(deliverySample) === 'delivery-app/stores/abc/logo',
  'public id is recovered from a delivery URL',
  publicIdFromUrl(deliverySample),
);
check(publicIdFromUrl(PNG_1PX) === '', 'public id of a non-Cloudinary value is empty');
check(
  publicIdFromUrl('https://evil.example.com/image/upload/x/logo.png') === '',
  "another host is not treated as ours (we do not delete other people's files)",
);

check(
  isCloudinaryUrl('https://res.cloudinary.com/d9ok/image/upload/v1/x.png'),
  'a Cloudinary delivery URL is recognised',
);
check(!isCloudinaryUrl(PNG_1PX) && !isCloudinaryUrl(''), 'a data URL is not a Cloudinary URL');
// The fallback every deployment without working credentials relies on.
check(
  (await imageHostingReady()) || (await hostImage(PNG_1PX)) === PNG_1PX,
  'without working credentials a data URL is stored unchanged (old behaviour)',
);

// --------------------------------------------------------------------------
// 2. Live upload - skipped without credentials, FAILED when they are rejected
// --------------------------------------------------------------------------

const configured = isCloudinaryConfigured();
const ready = await imageHostingReady();

if (!configured) {
  console.log('\n--- live upload ---');
  console.log(
    'SKIP  no CLOUDINARY_* credentials in backend/.env, so images stay inline (as before).',
  );
} else if (!ready) {
  console.log('\n--- live upload ---');
  check(
    false,
    'credentials are configured but Cloudinary rejected them',
    `cloud "${config.cloudinary.cloudName}" - copy the API key and secret again from Cloudinary -> API Keys`,
  );
} else {
  console.log('\n--- live upload ---');
  console.log(`      cloud: ${config.cloudinary.cloudName}  folder: ${config.cloudinary.folder}`);

  const publicId = publicIdFor('test', 'suite', 'probe');
  const result = await uploadImage(PNG_1PX, {
    folder: `${config.cloudinary.folder}/test`,
    publicId,
  });

  check(typeof result?.secure_url === 'string', 'upload returns a secure_url', result?.secure_url);
  check(result.width === 1 && result.height === 1, 'dimensions survive the round-trip');
  check(result.format === 'png', 'format survives', String(result.format));

  const url = await hostImage(PNG_1PX, {
    folder: `${config.cloudinary.folder}/test`,
    publicId,
  });

  check(url.startsWith('https://res.cloudinary.com/'), 'the stored value is an https URL', url);
  check(isCloudinaryUrl(url), 'the stored value is recognised as Cloudinary');
  check(url.includes('q_auto,f_auto'), 'the stored URL negotiates format and quality', url);
  check(!url.startsWith('data:'), 'no base64 is stored at all');

  /* The image has to be REACHABLE, and it has to be the pixels that came back -
     a URL that 404s is worse than no URL, because the storefront shows a broken
     image instead of a missing one. */
  const fetched = await fetch(url);
  check(fetched.ok, 'the delivered URL fetches', `HTTP ${fetched.status}`);
  check(
    String(fetched.headers.get('content-type') || '').startsWith('image/'),
    'the delivered URL serves an image',
    String(fetched.headers.get('content-type')),
  );
  const bytes = Buffer.from(await fetched.arrayBuffer());
  check(bytes.length > 0, 'the delivered image has bytes', `${bytes.length}B`);

  /* f_auto is the reason the stored URL is built the way it is: a browser that
     can decode WebP must get one. */
  const webp = await fetch(url, { headers: { accept: 'image/webp,*/*' } });
  check(
    String(webp.headers.get('content-type') || '').includes('webp'),
    'a WebP-capable client is served WebP',
    String(webp.headers.get('content-type')),
  );

  /* Re-uploading the same slot must REPLACE, not accumulate - this is what the
     deterministic public id is for. */
  const again = await uploadImage(PNG_1PX, {
    folder: `${config.cloudinary.folder}/test`,
    publicId,
  });
  check(
    again.public_id === result.public_id,
    'the same slot keeps the same public id',
    again.public_id,
  );

  const passthrough = await hostImage('https://example.com/photo.jpg');
  check(
    passthrough === 'https://example.com/photo.jpg',
    'a typed-in URL is left alone',
  );

  await removeImage(url);
  console.log('\n      (test asset cleaned up)');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

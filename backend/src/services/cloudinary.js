/**
 * Image hosting on Cloudinary.
 *
 * One rule, applied by every image write in the app: an image is a URL in the
 * database, never bytes. The browser downscales the file on a canvas and sends
 * a data URL; this module forwards it to Cloudinary and returns the URL to
 * store. Everything downstream - `<img src>`, the storefront payload, the
 * category map - is unchanged, because a URL is what those fields always held.
 *
 * Why it matters, measured: `GET /api/stores/joes-pizza` was 942,386 bytes,
 * almost all of it base64 pictures inside the JSON. A data URL cannot be cached
 * as an image, cannot be decoded off the main thread, and is re-downloaded and
 * re-parsed on every page load. The same picture as a Cloudinary URL is ~120
 * bytes of JSON, cached by the browser, served over a CDN near the shopper, and
 * negotiated by Cloudinary into WebP/AVIF for whoever asks (`f_auto`).
 *
 * DESIGN NOTES
 *
 * - Uploaded THROUGH the API, signed with the secret, never from the browser.
 *   The alternative is an unsigned upload preset, which sends the file straight
 *   from the phone and saves a hop - but it also publishes an endpoint anyone
 *   on the internet can push files into your Cloudinary account. Worth doing
 *   for a production deployment, behind a rate limit and a preset; not worth it
 *   here, where the client already downscales the file before sending it.
 *
 * - The credentials are PROBED before they are trusted (see `imageHostingReady`),
 * so a typo in `.env` degrades to the old inline behaviour instead of failing
 * every upload. `server.js` prints which mode is live at boot.
 *
 * - `public_id` is deterministic (store id + what the picture is), so
 *   re-uploading a logo REPLACES it instead of leaving yesterday's file in the
 *   account forever. `invalidate` makes the replacement visible at the CDN
 *   immediately rather than after the old asset's TTL.
 *
 * - With no credentials configured, `hostImage` returns its input untouched. A
 *   fresh clone without a Cloudinary account keeps working exactly as before.
 */
import { v2 as cloudinary } from 'cloudinary';
import { config, isCloudinaryConfigured } from '../config/env.js';
import { HttpError } from '../middleware/errorHandler.js';

/**
 * A base64 data URL for an image type we accept, and no larger.
 *
 * The same rule the controllers apply to their inputs, kept here as well because
 * the backfill script has to make the identical decision for rows written
 * before this module existed. The prefix is the security-relevant half: it
 * keeps a remote `http(s)` URL (a tracker beacon following shoppers around on
 * someone else's host) and a `javascript:` URL out of the image fields.
 */
const ALLOWED_IMAGE = /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/]+=*$/;
const MAX_IMAGE_BYTES = 1024 * 1024;

/** Is this a data URL carrying a real image, within the size cap? */
export function isImageDataUrl(value) {
  if (typeof value !== 'string' || !ALLOWED_IMAGE.test(value)) return false;

  // ~4 chars per 3 bytes; measure the payload, not the whole data URL.
  const base64 = value.slice(value.indexOf(',') + 1);
  return Math.floor((base64.length * 3) / 4) <= MAX_IMAGE_BYTES;
}

/** Is this one of OUR Cloudinary URLs (so it is ours to delete)? */
export function isCloudinaryUrl(value) {
  return (
    typeof value === 'string' &&
    /^https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\//.test(value)
  );
}

/**
 * A stable public id for one slot, e.g. `store-65f0-logo`.
 *
 * Deterministic so a second upload of the same logo overwrites the first rather
 * than accumulating files nobody will ever delete. Lowercased and squashed to
 * `[a-z0-9-]` because "Hot & Spicy" is a legal category name and a perfectly
 * illegal Cloudinary folder segment.
 */
export function publicIdFor(...parts) {
  return parts
    .map((part) =>
      String(part ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, ''),
    )
    .filter(Boolean)
    .join('-');
}

/** The public id behind one of our delivery URLs, or '' if it is not ours. */
export function publicIdFromUrl(url) {
  const raw = String(url || '').trim();
  if (!isCloudinaryUrl(raw)) return '';

  const afterUpload = raw.split('/image/upload/')[1] || '';
  // Drop any transformation segment (q_auto,f_auto) and the version segment,
  // both of which sit between "upload" and the id in a delivery URL.
  const segments = afterUpload
    .split('/')
    .filter((s) => s && !s.includes(',') && !/^v\d+$/.test(s));
  const last = segments.pop() || '';
  return segments.concat(last.replace(/\.[a-z0-9]+$/i, '')).join('/');
}
function configure() {
  cloudinary.config({
    cloud_name: config.cloudinary.cloudName,
    api_key: config.cloudinary.apiKey,
    api_secret: config.cloudinary.apiSecret,
    secure: true,
  });
}

/**
 * Has Cloudinary actually accepted the configured credentials?
 *
 * Configured is not the same as working: a mistyped cloud name or a rotated
 * secret produces a perfectly valid-looking `.env` that fails every upload. So
 * the credentials are PROBED (one `ping`) before they are trusted, once per
 * process, and until that probe succeeds images fall back to the inline
 * behaviour this module replaced. A merchant uploading a logo should never get
 * a 502 because somebody typo'd an environment variable.
 *
 * The probe is lazy and its result cached, so the ordinary path costs nothing
 * after the first call. `server.js` calls it at boot so the operator sees the
 * answer in the log rather than on the first upload.
 */
let readiness = null; // null = not probed yet

async function probe() {
  configure();
  try {
    await cloudinary.api.ping();
    return true;
  } catch (err) {
    /* Cloudinary's wording does NOT reliably tell you WHICH value is wrong, and
       the obvious reading of it is wrong. Measured against the live API with the
       configured pair, a fake cloud name, and a garbage key:

         real cloud + real key  -> "unknown api_key"   (what we get)
         fake cloud + real key  -> "unknown api_key"   (identical)
         real cloud + garbage  -> "unknown api_key"   (identical)
         real cloud + no key   -> "api_key not provided"

       So "unknown api_key" only means "the request was not authenticated". An
       earlier version of this comment claimed it proved the CLOUD NAME was
       wrong, and the hint below repeated that claim - it sent the operator off
       to re-copy a cloud name that was fine. Only a missing key has its own
       distinct message.

       The honest hint is therefore the generic one in every case, plus the one
       thing that is cheap to check and catches the usual cause: Cloudinary API
       secrets are 32 characters, and a short one here is a paste that got cut
       off (trailing text lost in a browser, a trimmed editor, a wrapped PDF). */
    const detail =
      err?.error?.message || err?.message || err?.http_code || String(err);
    const secretTooShort =
      (config.cloudinary.apiSecret || '').length > 0 &&
      (config.cloudinary.apiSecret || '').length < 32;
    console.error(
      `[images] Cloudinary rejected the credentials for cloud "${config.cloudinary.cloudName}": ${detail}. ` +
        'Images are stored inline, exactly as they were before. ' +
        'Copy all three values again from Cloudinary -> the cloud -> "API Keys": ' +
        'the error does not say which one is wrong. ' +
        (secretTooShort
          ? `Note: the API secret is ${config.cloudinary.apiSecret.length} characters; Cloudinary secrets are 32, so that paste is probably truncated.`
          : ''),
    );
    return false;
  }
}

/** True when an upload would actually be hosted. Probes once, then caches. */
export async function imageHostingReady() {
  if (!isCloudinaryConfigured()) return false;
  if (readiness === null) readiness = probe();
  return readiness;
}

/** Forget the cached probe. For tests, and after credentials change on disk. */
export function resetImageHosting() {
  readiness = null;
}

/**
 * Upload one image and return Cloudinary's record of it.
 *
 * `folder` defaults to the configured root so nothing lands loose in the
 * account root. `publicId` is optional: pass it for a slot that should be
 * replaced in place (a logo), omit it for a one-off (a product photo) where
 * every upload is its own asset.
 */
export async function uploadImage(source, { folder, publicId } = {}) {
  if (!isCloudinaryConfigured()) {
    throw new HttpError(
      503,
      'Image hosting is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET.',
    );
  }
  if (!(await imageHostingReady())) {
    throw new HttpError(
      503,
      'Image hosting rejected the configured Cloudinary credentials. An administrator needs to check them.',
    );
  }
  if (!isImageDataUrl(source)) {
    throw new HttpError(
      400,
      'That image could not be used. Pick a PNG, JPG, WEBP or GIF under 1 MB.',
    );
  }

  configure();

  try {
    return await cloudinary.uploader.upload(source, {
      folder: folder || config.cloudinary.folder,
      resource_type: 'image',
      ...(publicId ? { public_id: publicId, overwrite: true, invalidate: true } : {}),
    });
  } catch (err) {
    // Cloudinary's own message ("Invalid extension", "File size too large", a
    // 401 from bad credentials) is the useful one; the merchant gets a sentence,
    // the operator gets the real reason in the log.
    console.error(`[images] Cloudinary upload failed: ${err.message}`);
    throw new HttpError(
      502,
      'The image could not be uploaded. Please try again in a moment.',
    );
  }
}

/**
 * The URL to STORE for an uploaded image.
 *
 * `q_auto` and `f_auto` are part of the stored URL on purpose: Cloudinary then
 * serves WebP (or AVIF) to a browser that says it can decode one and the
 * original format to everyone else. Baking them in means every existing
 * `<img src>` gets the benefit without touching the client, and a shopper on
 * mobile data gets a fraction of the bytes a PNG costs.
 */
export function deliveryUrl(result) {
  return cloudinary.url(result.public_id, {
    secure: true,
    transformation: [{ quality: 'auto', fetch_format: 'auto' }],
    ...(result.version ? { version: result.version } : {}),
  });
}

/**
 * THE function the controllers call: hand it whatever the client sent, get back
 * the string to store.
 *
 * - '' stays '' (a cleared picture is still a cleared picture)
 * - a URL stays that URL (product photos are typed in, not uploaded)
 * - a data URL goes to Cloudinary and comes back as a delivery URL
 * - with no credentials, a data URL is returned unchanged: the app still runs,
 *   just without hosted images
 */
export async function hostImage(source, options = {}) {
  const value = String(source ?? '').trim();
  if (!value) return '';
  if (!isImageDataUrl(value)) return value;
  if (!(await imageHostingReady())) return value;

  return deliveryUrl(await uploadImage(value, options));
}

/**
 * Delete an image this app owns, if it is one of ours.
 *
 * Best effort by design: a Cloudinary outage must not turn "the merchant
 * removed their logo" into a failed request. A file left behind costs storage;
 * a merchant who cannot clear a logo is a bug with a support ticket.
 */
export async function removeImage(value) {
  const publicId = publicIdFromUrl(value);
  if (!publicId || !isCloudinaryConfigured()) return;

  configure();
  try {
    await cloudinary.uploader.destroy(publicId, { invalidate: true });
  } catch (err) {
    console.warn(`[images] could not delete ${publicId}: ${err.message}`);
  }
}

/** The folder one store's images live in, so the account stays browsable. */
export function storeFolder(storeId, kind) {
  return [config.cloudinary.folder, 'stores', publicIdFor(storeId), kind]
    .filter(Boolean)
    .join('/');
}

export default {
  hostImage,
  uploadImage,
  removeImage,
  imageHostingReady,
  resetImageHosting,
  isImageDataUrl,
  isCloudinaryUrl,
  publicIdFor,
  publicIdFromUrl,
  storeFolder,
};


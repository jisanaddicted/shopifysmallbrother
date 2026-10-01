/**
 * Turning a picked image File into something small enough to send.
 *
 * SHARED on purpose. Four screens pick pictures - ThemeBuilder's store logo, its
 * category cards, its tree nodes, and the product editor - and each needs the
 * same three things: reject a non-image, cap the size, and shrink it. The helper
 * used to live privately inside `menuService`, which left the product form with
 * no way to reuse it and would have grown a second, subtly different copy. One
 * definition, imported by every caller, is what keeps the rules from drifting.
 *
 * Why downscale at all: a phone photo is 3-5MB. A product card renders at about
 * 150-300px and a category card at about 150px, so shipping the original would
 * push megabytes through the API on every save. The API's own body limit is 1MB
 * (`express.json({ limit: '1mb' })`), so an undownscaled photo is turned away at
 * the door with a generic "entity too large" that tells the merchant nothing.
 *
 * PNG, not JPEG: this is a re-encode of a picture that is about to be re-encoded
 * again by Cloudinary (`f_auto`), so JPEG's first-generation artefacts would
 * survive into the delivered file and buy no meaningful size here. It is also
 * what `setCategoryImage` already sent, so nothing about that path changes.
 */

/**
 * The edge the caller downscales TO, in pixels.
 *
 * Deliberately larger than a card renders at: this is the largest a shopper
 * sees - the product detail page - before the browser upscales it on a Retina
 * screen. Bigger than the rendered size keeps the download sharp there; smaller
 * would ship a blurry image.
 */
export const IMAGE_MAX_EDGE = 640;

/** A picked file above this is refused before it is even decoded. */
export const IMAGE_MAX_FILE_BYTES = 10 * 1024 * 1024;

/**
 * Channels at or above this count as "blank" when trimming.
 *
 * 248 rather than 255 on purpose: a JPEG of a white background is very rarely
 * exactly 255, and a trim that demands pure white would find nothing to remove
 * and leave the merchant's logo padded exactly as it was.
 */
const BLANK_CHANNEL = 248;

/** Alpha below this counts as empty, so a soft anti-aliased edge still trims. */
const BLANK_ALPHA = 8;

/** Never crop down to a speck, however blank the picture is. */
const MIN_TRIMMED_EDGE = 8;

/**
 * The bounding box of everything that is NOT empty space, or null if there is
 * nothing worth trimming.
 *
 * "Empty" is TRANSPARENT or NEAR-WHITE, and deliberately nothing else. This
 * function runs on every picture the app takes - the store logo, category cards,
 * product photos - and a logo pasted from a web page arrives with a wide white
 * margin around it, which is invisible on a white page and turns into a logo
 * rendered at a fraction of the size the merchant asked for. Trimming the empty
 * border is what makes the size they pick mean something.
 *
 * The narrow definition is the safety. A picture whose border is a deliberate
 * solid colour - a white logo on a green square, say - is left completely alone,
 * because trimming a colour we did not recognise is how a good logo becomes a
 * cropped one. Only space that is genuinely empty, or empty by any reasonable
 * reading of "the background", goes.
 *
 * Returns null - meaning "use the picture as it is" - for a picture with no
 * blank border, an entirely blank one, or one too small to crop safely.
 */
function contentBounds(pixels, w, h) {
  const blankAt = (x, y) => {
    const i = (y * w + x) * 4;
    if (pixels[i + 3] < BLANK_ALPHA) return true;
    return (
      pixels[i] >= BLANK_CHANNEL &&
      pixels[i + 1] >= BLANK_CHANNEL &&
      pixels[i + 2] >= BLANK_CHANNEL
    );
  };

  const rowBlank = (y) => {
    for (let x = 0; x < w; x += 1) if (!blankAt(x, y)) return false;
    return true;
  };
  const colBlank = (x) => {
    for (let y = 0; y < h; y += 1) if (!blankAt(x, y)) return false;
    return true;
  };

  let top = 0;
  let bottom = h - 1;
  let left = 0;
  let right = w - 1;

  while (top < bottom && rowBlank(top)) top += 1;
  while (bottom > top && rowBlank(bottom)) bottom -= 1;
  while (left < right && colBlank(left)) left += 1;
  while (right > left && colBlank(right)) right -= 1;

  const width = right - left + 1;
  const height = bottom - top + 1;

  // Nothing to gain, or a blank/speck of a picture: hand back the original.
  if (left === 0 && top === 0 && right === w - 1 && bottom === h - 1) return null;
  if (width < MIN_TRIMMED_EDGE || height < MIN_TRIMMED_EDGE) return null;

  return { left, top, width, height };
}

/**
 * A canvas holding just the content of `source`, or null to keep `source`.
 *
 * Also GROWS the result back towards the pixel budget, capped at 2x. A logo that
 * arrives as 640x640 with the mark in a 90x90 corner would trim to 90x90 and
 * then be painted at 96px tall - a visible, soft blur for a picture that had the
 * detail all along. The 2x cap stops it stretching a genuinely tiny logo into
 * something that looks like a mistake.
 */
function trimmed(source, ctx, w, h, maxEdge) {
  if (typeof ctx?.getImageData !== 'function') return null;

  let pixels;
  try {
    pixels = ctx.getImageData(0, 0, w, h).data;
  } catch {
    return null;
  }

  const box = contentBounds(pixels, w, h);
  if (!box) return null;

  const grow = Math.min(maxEdge / Math.max(box.width, box.height), 2);
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(box.width * grow));
  out.height = Math.max(1, Math.round(box.height * grow));

  const outCtx = out.getContext('2d');
  if (!outCtx) return null;

  outCtx.drawImage(
    source,
    box.left,
    box.top,
    box.width,
    box.height,
    0,
    0,
    out.width,
    out.height,
  );
  return out;
}

/**
 * Is this a picked file we are willing to even try to read?
 *
 * Type and size are checked BEFORE the expensive decode, so a 9MB video fails
 * instantly with a sentence aimed at the merchant, instead of hanging a canvas
 * read for ten seconds and then reporting something less useful.
 *
 * Returns '' when the file is acceptable, or the reason it is not.
 */
export function validateImageFile(file) {
  if (!file) return 'No file was chosen.';
  if (!String(file.type || '').startsWith('image/')) {
    return 'Please choose an image file (PNG, JPG, WEBP, GIF…).';
  }
  if (file.size > IMAGE_MAX_FILE_BYTES) {
    return `That image is ${(file.size / (1024 * 1024)).toFixed(1)} MB. Choose one under 10 MB.`;
  }
  return '';
}

/**
 * Read a picked File into a downscaled base64 data URL.
 *
 * Passed through untouched, without a canvas round-trip:
 *  - '' — CLEARING a picture. The "No pic" / "Remove" buttons send this, and so
 *    does `handleCategoryImageRemove` in ThemeBuilder. The server reads '' as
 *    "no picture" (it is the default across Store.image / Product.image /
 *    CategoryNode.image), so clearing must survive this function unchanged.
 *  - a data URL — a caller that already has one.
 *  - an http(s) URL — what the server stores once Cloudinary has hosted the
 *    upload (see backend/src/services/cloudinary.js). Re-uploading the stored
 *    value unchanged must not try to read a URL as a file.
 *
 * The first rule used to be a COMMENT and not code. The guard listed the three
 * prefixes above, and '' matched none of them, so clearing fell through to
 * FileReader and threw
 *
 *   Failed to execute 'readAsDataURL' on 'FileReader': parameter 1 is not of type 'Blob'
 *
 * from inside `setTreeNodeImage` — so the "No pic" button on a Theme 2 category
 * (and its Theme 1 equivalent) could only ever fail, with a browser-level error
 * that meant nothing to the merchant. Testing `typeof === 'string'` instead of
 * an allow-list of prefixes is what actually honours the documented contract:
 * any string is a value the caller already decided on, and re-reading it as a
 * file is never right.
 */
export function imageToDataUrl(image, maxEdge = IMAGE_MAX_EDGE, { trim = true } = {}) {
  // '' clears a picture; null/undefined clear it too. Anything else that is a
  // string is a data URL or a hosted URL and is already in its final form.
  if (image === '' || image === null || image === undefined) {
    return Promise.resolve('');
  }
  if (typeof image === 'string') return Promise.resolve(image);

  /* Not a string, so it should be a picked File. Anything else is a caller
     mistake (an object, a number), and saying so is far better than letting
     readAsDataURL throw a Blob type error that explains nothing. */
  if (typeof Blob === 'undefined' || !(image instanceof Blob)) {
    return Promise.reject(
      new Error('That image could not be read. Please choose the file again.'),
    );
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that image.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file is not a valid image.'));
      img.onload = () => {
        // `Math.min(1, ...)` so a small image is not scaled UP - upscaling
        // cannot add detail, it only inflates the file.
        const scale = Math.min(1, maxEdge / Math.max(img.width, img.height, 1));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Your browser could not process that image.'));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);

        /* Trim the empty border, if there is one, and export THAT.
         *
         * Done after the downscale rather than before: the padding is usually
         * the cheaper half of the picture, so cropping first would spend the
         * whole pixel budget on white space and then shrink the logo to fit
         * what is left. After, the budget is spent on the part anyone sees.
         *
         * `getImageData` can throw on a canvas the browser has tainted, and a
         * context without it at all is a stub rather than a browser - so a
         * failure here costs the trim, never the upload. */
        const box = trim ? trimmed(canvas, ctx, w, h, maxEdge) : null;
        resolve((box || canvas).toDataURL('image/png'));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(image);
  });
}

export default { imageToDataUrl, validateImageFile, IMAGE_MAX_EDGE };
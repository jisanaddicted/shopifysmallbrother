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
 *  - '' — CLEARING a picture. `handleCategoryImageRemove` sends this. It used to
 *    fall through to FileReader, which rejects a string, so removing a category
 *    picture could only ever fail.
 *  - a data URL — a caller that already has one.
 *  - an http(s) URL — what the server stores once Cloudinary has hosted the
 *    upload (see backend/src/services/cloudinary.js). Re-uploading the stored
 *    value unchanged must not try to read a URL as a file.
 */
export function imageToDataUrl(image, maxEdge = IMAGE_MAX_EDGE) {
  const alreadyAString =
    typeof image === 'string' &&
    (image.startsWith('data:image/') ||
      image.startsWith('https://') ||
      image.startsWith('http://'));

  if (alreadyAString) return Promise.resolve(image);

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
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(image);
  });
}

export default { imageToDataUrl, validateImageFile, IMAGE_MAX_EDGE };
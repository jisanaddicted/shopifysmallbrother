/**
 * Turns a name into a URL-safe slug: "Joe's Pizza!" -> "joe-s-pizza".
 * The slug is what goes in a store's public URL (/s/joe-s-pizza).
 */
export function slugify(value, fallback = 'store') {
  const slug = String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    // Strip accents so "Café" becomes "cafe".
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

  return slug || fallback;
}

/**
 * Finds a slug nobody else is using by appending -2, -3, ... when needed.
 * `excludeId` lets a store keep its own slug while it is being updated.
 */
export async function uniqueSlug(base, { exists, excludeId = null } = {}) {
  const root = slugify(base);

  for (let suffix = 1; suffix <= 50; suffix += 1) {
    const candidate = suffix === 1 ? root : `${root}-${suffix}`;
    // eslint-disable-next-line no-await-in-loop
    const taken = await exists(candidate, excludeId);

    if (!taken) return candidate;
  }

  // Extremely unlikely - fall back to something unique-ish.
  return `${root}-${Date.now().toString(36)}`;
}

/** Is this a valid public handle? 3-20 chars, starts with a letter. */
export function isValidUsername(value) {
  return /^[a-z][a-z0-9._-]{2,19}$/.test(String(value || '').trim().toLowerCase());
}

/** Normalises a username for storage/lookup. */
export function normaliseUsername(value) {
  return String(value || '').trim().toLowerCase();
}

/** Suggests a username from a name/email, e.g. "Sam Rider" -> "sam.rider". */
export function suggestUsername(name, email) {
  const fromName = String(name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .replace(/\.{2,}/g, '.')
    .slice(0, 20);

  if (isValidUsername(fromName)) return fromName;

  const fromEmail = String(email || '').split('@')[0];
  const candidate = `${fromEmail}`.toLowerCase().replace(/[^a-z0-9._-]/g, '');

  return isValidUsername(candidate) ? candidate.slice(0, 20) : '';
}

export default { slugify, uniqueSlug, isValidUsername, normaliseUsername, suggestUsername };
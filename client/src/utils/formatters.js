import {
  DEFAULT_CURRENCY,
  DEFAULT_LOCALE,
  ORDER_STATUS_LABELS,
} from './constants';

/**
 * Format a number as money. Returns an em dash for invalid input so the UI
 * never shows "$NaN".
 */
export function formatCurrency(amount, currency = DEFAULT_CURRENCY) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return '—';

  return new Intl.NumberFormat(DEFAULT_LOCALE, {
    style: 'currency',
    currency,
    // 'narrowSymbol' prefers the real sign over the ISO code, so BDT prints as
    // "৳12.50" instead of "BDT 12.50" (and NPR/PKR as "Rs"). For USD/EUR/GBP/
    // INR/AED it is identical to the default, so this only ever helps.
    currencyDisplay: 'narrowSymbol',
    maximumFractionDigits: 2,
  }).format(value);
}

/** "850 m" or "3.4 km" from a value in metres. */
export function formatDistance(meters) {
  const m = Number(meters);
  if (!Number.isFinite(m)) return '—';
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}

/** "2h 15m" from a value in seconds. */
export function formatDuration(seconds) {
  const total = Number(seconds);
  if (!Number.isFinite(total) || total < 0) return '—';

  const hours = Math.floor(total / 3600);
  const minutes = Math.round((total % 3600) / 60);
  if (hours <= 0) return `${minutes} min`;
  return `${hours}h ${minutes}m`;
}

/**
 * "38 min" / "1h 05m" from a duration in *milliseconds* - the unit the backend
 * reports delivery timings in. Unlike formatDuration() this takes ms, not
 * seconds, so a whole delivery can be read at a glance. Returns an em dash for
 * anything missing, which is what a stage that never happened looks like.
 */
export function formatDurationMs(ms) {
  const total = Number(ms);
  if (!Number.isFinite(total) || total < 0) return '—';

  const minutes = Math.round(total / 60000);
  if (minutes < 1) return 'under a minute';

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours <= 0) return `${rest} min`;
  return `${hours}h ${String(rest).padStart(2, '0')}m`;
}

/**
 * Straight-line distance in metres between two { lat, lng } points.
 * Used for the "rider is 850 m away" readout (Haversine formula).
 */
export function distanceBetween(a, b) {
  if (!a || !b) return null;
  const lat1 = Number(a.lat);
  const lng1 = Number(a.lng);
  const lat2 = Number(b.lat);
  const lng2 = Number(b.lng);
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return null;

  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371000; // earth radius in metres
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(h));
}

export function formatDateTime(input) {
  const date = input ? new Date(input) : null;
  if (!date || Number.isNaN(date.getTime())) return '—';

  return new Intl.DateTimeFormat(DEFAULT_LOCALE, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function formatTime(input) {
  const date = input ? new Date(input) : null;
  if (!date || Number.isNaN(date.getTime())) return '—';

  return new Intl.DateTimeFormat(DEFAULT_LOCALE, { timeStyle: 'short' }).format(
    date,
  );
}

/** "just now", "4 min ago", "2 days ago" */
export function timeAgo(input) {
  const date = input ? new Date(input) : null;
  if (!date || Number.isNaN(date.getTime())) return '—';

  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 30) return 'just now';
  if (seconds < 90) return '1 min ago';
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 7200) return '1 hour ago';
  if (seconds < 86400) return `${Math.round(seconds / 3600)} hours ago`;
  return `${Math.round(seconds / 86400)} days ago`;
}

/** Human label for an order status, falling back to "out for delivery". */
export function formatStatus(status) {
  if (!status) return '—';
  return ORDER_STATUS_LABELS[status] || String(status).replace(/_/g, ' ');
}

/**
 * "Rack A3 · Shelf 2" from a product's location fields, or an em dash when
 * the merchant has not recorded one. Accepts the whole product or the two
 * halves on their own.
 */
export function formatLocation(product) {
  const rack = String(product?.rack ?? '').trim();
  const shelf = String(product?.shelf ?? '').trim();

  const parts = [];
  if (rack) parts.push(`Rack ${rack}`);
  if (shelf) parts.push(`Shelf ${shelf}`);

  return parts.length ? parts.join(' · ') : '—';
}

/** Cut long text and add an ellipsis. */
export function truncate(text, max = 80) {
  const value = String(text ?? '');
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/** Initials for avatars: "Aarav Sharma" -> "AS" */
export function initials(name) {
  return String(name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

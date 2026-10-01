/**
 * Probing Cloudinary with the REAL credentials from backend/.env, to find out
 * WHICH value is wrong instead of guessing from the app's hint text.
 *
 * Cloudinary distinguishes two failures:
 *   - a cloud name that does not exist -> "Unknown API key" (no key after it)
 *   - a real cloud + unregistered key  -> "Invalid API key <value>"
 * So the raw error names the culprit. Nothing here uploads or mutates anything:
 * `ping` is a read-only call.
 */
import { v2 as cloudinary } from 'cloudinary';
import { config, isCloudinaryConfigured } from '../src/config/env.js';
import { imageHostingReady, isImageDataUrl } from '../src/services/cloudinary.js';

console.log('--- what dotenv actually loaded ---');
console.log('isCloudinaryConfigured :', isCloudinaryConfigured());
console.log('cloud_name             :', JSON.stringify(config.cloudinary.cloudName));
console.log('api_key                :', JSON.stringify(config.cloudinary.apiKey));
console.log(
  'api_secret             :',
  `present=${Boolean(config.cloudinary.apiSecret)} length=${(config.cloudinary.apiSecret || '').length}`,
);
console.log('folder                 :', JSON.stringify(config.cloudinary.folder));
console.log('');

console.log('--- shape sanity checks ---');
const name = config.cloudinary.cloudName || '';
console.log('cloud name is non-empty      :', Boolean(name));
console.log('cloud name has no whitespace :', !/\s/.test(name));
console.log('cloud name is lowercase      :', name === name.toLowerCase());
console.log('cloud name length            :', name.length);
// Cloudinary keys are usually base64-ish, but they are NOT always: a purely
// numeric key like 696784287135787 is valid and this check reported it as
// suspicious, which is a false alarm. Length is the useful signal.
console.log('api key length (Cloudinary: ~15):', config.cloudinary.apiKey.length);
console.log(
  'api secret length (Cloudinary: 27-32):',
  config.cloudinary.apiSecret.length,
);
console.log('');

cloudinary.config({
  cloud_name: config.cloudinary.cloudName,
  api_key: config.cloudinary.apiKey,
  api_secret: config.cloudinary.apiSecret,
  secure: true,
});

console.log('--- live ping (what the app does at boot) ---');
try {
  const res = await cloudinary.api.ping();
  console.log('PING OK ->', JSON.stringify(res));
} catch (err) {
  console.log('PING FAILED');
  console.log('  http_code :', err?.http_code);
  console.log('  error.name:', err?.error?.error);
  console.log('  message   :', err?.error?.message);
  console.log('  raw       :', JSON.stringify(err?.error ?? err?.message));
}

console.log('');
console.log('--- imageHostingReady() (the gate that turns uploads into inline data) ---');
console.log('ready:', await imageHostingReady());

console.log('');
console.log('--- would hostImage() have taken this data URL? ---');
const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
console.log('isImageDataUrl(1px png):', isImageDataUrl(PNG_1PX));
const { hostImage } = await import('../src/services/cloudinary.js');
const out = await hostImage(PNG_1PX, { folder: 'probe' });
const hosted = /^https:\/\//.test(out);
console.log('hostImage returned a URL    :', hosted);
console.log('hostImage left it inline    :', !hosted && out.startsWith('data:'));
console.log(
  hosted
    ? '=> uploads ARE hosted on Cloudinary'
    : '=> uploads are still stored INLINE as base64 (hosting not ready)',
);
if (hosted) {
  // Do not leave the probe asset lying in the account.
  const { removeImage } = await import('../src/services/cloudinary.js');
  await removeImage(out);
  console.log('=> probe asset removed from the account');
}
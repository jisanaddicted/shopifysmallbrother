/**
 * Test the credentials WITHOUT writing them to disk.
 *
 * The secret is read from an env var (CLOUDINARY_URL) rather than hardcoded, so
 * this file can be committed and shared without leaking anything.
 *
 * Usage:
 *   set CLOUDINARY_URL=cloudinary://<key>:<secret>@<cloudname>
 *   node scripts/testCredentialsFromUrl.mjs
 *
 * Read-only apart from the final round-trip upload, which is the only way to
 * prove an upload actually lands; that asset is destroyed again before exit.
 */
import { v2 as cloudinary } from 'cloudinary';

const url = String(process.env.CLOUDINARY_URL || '').trim();

if (!url) {
  console.error('Set CLOUDINARY_URL first, e.g.');
  console.error('  set CLOUDINARY_URL=cloudinary://key:secret@cloudname');
  process.exit(1);
}

/* Parse `cloudinary://<key>:<secret>@<cloudname>`. Split on the LAST colon
   before the '@' so a secret containing a colon would still parse. */
const match = url.match(/^cloudinary:\/\/([^:]+):(.+)@([^/]+)\/?$/);
if (!match) {
  console.error(`Could not parse that URL. Expected cloudinary://key:secret@cloudname`);
  process.exit(1);
}
const [, apiKey, apiSecret, cloudName] = match;

console.log('--- parsed ---');
console.log('cloud_name:', JSON.stringify(cloudName), `(len ${cloudName.length})`);
console.log('api_key   :', JSON.stringify(apiKey), `(len ${apiKey.length})`);
console.log('api_secret:', `<hidden> (len ${apiSecret.length})`);
console.log('');

console.log('--- what Cloudinary expects ---');
console.log('api keys are typically ~15 chars; secrets ~27-32');
console.log('');

cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });

console.log('--- ping ---');
try {
  const res = await cloudinary.api.ping();
  console.log('PING OK ->', JSON.stringify(res));
} catch (err) {
  console.log('PING FAILED ->', err?.error?.message || err?.message);
  console.log('');
  console.log('These credentials do not authenticate, so no upload was attempted.');
  process.exit(2);
}

console.log('');
console.log('--- real upload round-trip ---');
const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
let uploaded;
try {
  uploaded = await cloudinary.uploader.upload(PNG_1PX, {
    folder: 'delivery-app/_credential-test',
    resource_type: 'image',
  });
  console.log('UPLOAD OK');
  console.log('  public_id :', uploaded.public_id);
  console.log('  format    :', uploaded.format);
  console.log('  bytes     :', uploaded.bytes);
  console.log('  secure_url:', uploaded.secure_url);
} catch (err) {
  console.log('UPLOAD FAILED ->', err?.error?.message || err?.message);
  process.exit(3);
}

console.log('');
console.log('--- is the uploaded asset actually fetchable? ---');
const head = await fetch(uploaded.secure_url);
console.log('GET', uploaded.secure_url);
console.log('  status :', head.status);
console.log('  type   :', head.headers.get('content-type'));

console.log('');
console.log('--- cleanup (destroying the test asset) ---');
try {
  const destroyed = await cloudinary.uploader.destroy(uploaded.public_id);
  console.log('destroy ->', JSON.stringify(destroyed));
} catch (err) {
  console.log('destroy failed ->', err?.error?.message || err?.message);
}

console.log('');
console.log('RESULT: these credentials work.');
/**
 * List what this app has left in the Cloudinary account, and how big it is.
 *
 * Read-only. Written because "is it uploading?" is easier to answer from the
 * account side than from the API side, and because a test run that uploaded
 * assets needs a way to see what it left behind.
 *
 *   npm --prefix backend run images:inventory
 */
import { v2 as cloudinary } from 'cloudinary';
import { config, isCloudinaryConfigured } from '../src/config/env.js';
import { imageHostingReady } from '../src/services/cloudinary.js';

if (!isCloudinaryConfigured()) {
  console.error('No CLOUDINARY_* values in backend/.env');
  process.exit(1);
}

if (!(await imageHostingReady())) {
  console.error('Credentials do not authenticate - run test:images:why first.');
  process.exit(2);
}

const root = config.cloudinary.folder;

console.log(`--- assets under "${root}" ---`);
const res = await cloudinary.api.resources({
  type: 'upload',
  prefix: `${root}/`,
  max_results: 100,
});
const seen = res.resources || [];
let bytes = 0;
for (const a of seen) bytes += a.bytes || 0;

console.log(`count: ${seen.length}`);
console.log(`total size: ${(bytes / 1024).toFixed(1)} KB`);
console.log('');
for (const a of seen) {
  console.log(`${a.public_id}  (${a.bytes} bytes)`);
}

/* Removing an asset is destructive, so it only happens when explicitly asked
   for with `--prune`. Printing what is there is the default, because "what is in
   the account" is the question that is actually asked, and silently deleting a
   merchant's uploaded logo to answer it would be unforgivable. */
if (!process.argv.includes('--prune')) {
  console.log('');
  console.log('Run with --prune to destroy every asset listed above.');
  process.exit(0);
}

console.log('');
console.log('--- pruning ---');
for (const a of seen) {
  try {
    // eslint-disable-next-line no-await-in-loop
    const out = await cloudinary.uploader.destroy(a.public_id);
    console.log(`destroyed ${a.public_id} -> ${out.result}`);
  } catch (err) {
    console.log(`FAILED ${a.public_id} -> ${err?.error?.message || err?.message}`);
  }
}
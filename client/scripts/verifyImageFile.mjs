/**
 * Proves the fix for: Failed to execute 'readAsDataURL' on 'FileReader':
 * parameter 1 is not of type 'Blob'  (the "No pic" button).
 *
 * The browser APIs it uses (FileReader, Image, document.createElement('canvas'))
 * are not available in plain node, so they are stubbed with the minimum each
 * one is asked for. That is enough to prove the DECISION the function makes
 * before it reaches FileReader, which is exactly where the bug was: `''` must
 * resolve without ever touching FileReader.
 */

const calls = { readAsDataURL: 0, getContext: 0 };

class FakeBlob {
  constructor(name = 'x.png') {
    this.name = name;
    this.size = 10;
    this.type = 'image/png';
  }
}
globalThis.Blob = FakeBlob;
globalThis.File = FakeBlob;

globalThis.FileReader = class {
  readAsDataURL(value) {
    calls.readAsDataURL += 1;
    // Reproduce the browser's own refusal, so a regression fails loudly here
    // exactly as it did in the browser.
    if (!(value instanceof FakeBlob)) {
      throw new TypeError(
        "Failed to execute 'readAsDataURL' on 'FileReader': parameter 1 is not of type 'Blob'.",
      );
    }
    this.onload?.();
  }
};

globalThis.Image = class {
  set src(v) {
    this.onload?.();
  }
};

globalThis.document = {
  createElement: () => ({
    getContext: () => {
      calls.getContext += 1;
      return { drawImage() {} };
    },
    toDataURL: () => 'data:image/png;base64,UExBQ0VIT0xERVI=',
  }),
};

const { imageToDataUrl, validateImageFile } = await import('../src/utils/imageFile.js');

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures += 1;
};

console.log('--- clearing a picture (what "No pic" sends) ---');
for (const empty of ['', null, undefined]) {
  const before = calls.readAsDataURL;
  const out = await imageToDataUrl(empty);
  check(
    `imageToDataUrl(${JSON.stringify(empty)}) -> ''`,
    out === '' && calls.readAsDataURL === before,
    `readAsDataURL called ${calls.readAsDataURL - before} times`,
  );
}

console.log('');
console.log('--- already-final values pass through untouched ---');
const hosted = 'https://res.cloudinary.com/ulcid9ok/image/upload/v1/delivery-app/x.png';
const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
for (const value of [hosted, dataUrl]) {
  const out = await imageToDataUrl(value);
  check(
    `${value.slice(0, 28)}...`,
    out === value,
    'unchanged, no FileReader',
  );
}

console.log('');
console.log('--- a real picked File still downscales ---');
const before = calls.readAsDataURL;
const out = await imageToDataUrl(new FakeBlob('photo.png'));
check(
  'File -> data URL',
  out.startsWith('data:image/png') && calls.readAsDataURL === before + 1,
  `readAsDataURL called ${calls.readAsDataURL - before} time(s)`,
);

console.log('');
console.log('--- a junk value is refused, not crashed on ---');
const junk = await imageToDataUrl({ nope: true }).then(
  () => null,
  (e) => e.message,
);
check(
  'an object is rejected with a readable message',
  typeof junk === 'string' && !junk.includes('Blob'),
  JSON.stringify(junk),
);

console.log('');
console.log('--- validateImageFile ---');
check('a real image passes', validateImageFile(new FakeBlob()) === '');
check(
  'a non-image is refused',
  validateImageFile({ type: 'video/mp4', size: 1 }).includes('image file'),
);
check(
  'an oversized file is refused',
  validateImageFile({ type: 'image/png', size: 50 * 1024 * 1024 }).includes('10 MB'),
);

console.log('');
console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
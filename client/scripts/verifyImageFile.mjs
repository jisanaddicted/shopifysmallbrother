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

console.log('--- the empty border is trimmed (the padded-logo bug) ---');

/*
 * A logo pasted from a web page arrives wrapped in white space. Fitted into a
 * square box that padding is invisible to the merchant on their screen and very
 * visible in the storefront: the mark ends up a fraction of the size they chose,
 * because most of the image is nothing.
 *
 * So the pipeline crops the empty border. These checks pin WHICH border: only
 * empty space and near-white are cut, and a deliberate coloured border is left
 * alone. Getting that second half wrong would crop a perfectly good logo.
 */

/** A w*h buffer of one flat colour, alpha included. */
function flatPixels(w, h, [r, g, b, a = 255]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i += 1) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  }
  return data;
}

/** Paint a rectangle of content into an existing buffer. */
function paint(data, w, x0, y0, x1, y1, rgb) {
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * w + x) * 4;
      data[i] = rgb[0];
      data[i + 1] = rgb[1];
      data[i + 2] = rgb[2];
      data[i + 3] = 255;
    }
  }
}

/*
 * Swap in a canvas that can actually answer getImageData, and report every
 * canvas that was created: [0] is the downscaled source, and when a trim happens
 * the LAST one is the cropped picture that gets exported.
 */
function withRealCanvas({ pixels, nativeW, nativeH }) {
  const made = [];
  const realDocument = globalThis.document;
  const realImage = globalThis.Image;

  globalThis.Image = class {
    constructor() {
      this.width = nativeW;
      this.height = nativeH;
    }
    set src(v) {
      this.onload?.();
    }
  };

  globalThis.document = {
    createElement: () => {
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage() {},
          getImageData(x, y, w, h) {
            // A canvas sized to NaN (which is what the stub Image above yields
            // without dimensions) is one that cannot be read - throw, exactly as
            // a tainted canvas does, so the failure path is real.
            if (!Number.isInteger(w) || w < 1 || !Number.isInteger(h) || h < 1) {
              throw new Error('cannot read pixels');
            }
            return { data: pixels };
          },
        }),
        toDataURL() {
          return `data:image/png;base64,${this.width}x${this.height}`;
        },
      };
      made.push(canvas);
      return canvas;
    },
  };

  const restore = () => {
    globalThis.document = realDocument;
    globalThis.Image = realImage;
  };

  return { made, restore };
}

/** "120x80" out of the stub's data URL (`data:image/png;base64,120x80`). */
const exportedSize = (dataUrl) => String(dataUrl).split(',').pop();

/* 1. A white margin all round: 200x120 with the mark in the middle. */
{
  const pixels = flatPixels(200, 120, [255, 255, 255, 255]);
  paint(pixels, 200, 70, 40, 130, 80, [18, 53, 36]);
  const { made, restore } = withRealCanvas({ pixels, nativeW: 200, nativeH: 120 });
  const out = await imageToDataUrl(new FakeBlob('logo.png'), 256);
  restore();
  check(
    'the white margin is cropped away',
    exportedSize(out) === '120x80',
    `${exportedSize(out)} (the mark is 60x40, grown 2x)`,
  );
  check(
    'and the crop came off the downscaled source, not the raw file',
    made[0]?.width === 200 && made.length === 2,
    `source ${made[0]?.width}x${made[0]?.height}, ${made.length} canvases`,
  );
}

/* 2. A transparent margin (a PNG out of a design tool) trims the same. */
{
  const pixels = flatPixels(120, 120, [0, 0, 0, 0]);
  paint(pixels, 120, 30, 40, 90, 80, [200, 30, 30]);
  const { made, restore } = withRealCanvas({ pixels, nativeW: 120, nativeH: 120 });
  const out = await imageToDataUrl(new FakeBlob('logo.png'), 256);
  restore();
  check(
    'a transparent margin is cropped away too',
    exportedSize(out) === '120x80',
    exportedSize(out),
  );
}

/* 3. Nothing to trim: the picture is used exactly as it came in. */
{
  const pixels = flatPixels(100, 100, [255, 255, 255, 255]);
  paint(pixels, 100, 0, 0, 100, 100, [18, 53, 36]);
  const { made, restore } = withRealCanvas({ pixels, nativeW: 100, nativeH: 100 });
  const out = await imageToDataUrl(new FakeBlob('logo.png'), 256);
  restore();
  check(
    'a logo that already fills its canvas is left alone',
    exportedSize(out) === '100x100' && made.length === 1,
    `${exportedSize(out)}, ${made.length} canvas(es)`,
  );
}

/* 4. A DELIBERATE coloured border must survive - this is the safety rule. */
{
  const pixels = flatPixels(100, 100, [18, 53, 36, 255]);
  paint(pixels, 100, 12, 12, 88, 88, [255, 255, 255]);
  const { made, restore } = withRealCanvas({ pixels, nativeW: 100, nativeH: 100 });
  const out = await imageToDataUrl(new FakeBlob('logo.png'), 256);
  restore();
  check(
    'a coloured border is NOT trimmed - that space is part of the logo',
    exportedSize(out) === '100x100' && made.length === 1,
    `${exportedSize(out)}, ${made.length} canvas(es)`,
  );
}

/* 5. An entirely blank picture must not be cropped down to a speck. */
{
  const pixels = flatPixels(200, 200, [255, 255, 255, 255]);
  const { made, restore } = withRealCanvas({ pixels, nativeW: 200, nativeH: 200 });
  const out = await imageToDataUrl(new FakeBlob('blank.png'), 256);
  restore();
  check(
    'an empty picture is kept whole rather than cropped to nothing',
    exportedSize(out) === '200x200' && made.length === 1,
    `${exportedSize(out)}, ${made.length} canvas(es)`,
  );
}

/* 6. The trim is opt-out, for a picture whose padding is the point. */
{
  const pixels = flatPixels(200, 120, [255, 255, 255, 255]);
  paint(pixels, 200, 70, 40, 130, 80, [18, 53, 36]);
  const { made, restore } = withRealCanvas({ pixels, nativeW: 200, nativeH: 120 });
  const out = await imageToDataUrl(new FakeBlob('logo.png'), 256, { trim: false });
  restore();
  check(
    'trimming can be turned off, for a picture whose padding is the point',
    exportedSize(out) === '200x120' && made.length === 1,
    exportedSize(out),
  );
}

console.log('');
console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
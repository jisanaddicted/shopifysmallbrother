/**
 * Tests for src/middleware/compress.js.
 *
 *   npm --prefix backend run test:compression
 *
 * Two halves: the Accept-Encoding negotiation as a pure table (that is where a
 * `q=0` refusal or a `*` wildcard can go wrong silently), then the middleware
 * against a real HTTP server, because the interesting rules (minimum size,
 * content-type allowlist, "only when it actually shrinks", not double-encoding,
 * 304/HEAD) all live in the response path and none of them are visible from
 * reading the source.
 *
 * No database and no app boot: the middleware only needs node:http.
 */
import http from 'node:http';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { compressResponses, accepts } from '../src/middleware/compress.js';

let passed = 0;
let failed = 0;
const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? `  ${extra}` : ''}`);
  if (ok) passed += 1;
  else failed += 1;
};

// --------------------------------------------------------------------------
// 1. Accept-Encoding negotiation
// --------------------------------------------------------------------------

const NEGOTIATION = [
  // plain offers
  ['br', 'br', true],
  ['br', 'gzip', false],
  ['gzip, deflate, br', 'br', true],
  ['gzip, deflate, br', 'gzip', true],
  ['gzip, deflate', 'br', false],
  ['br, gzip', 'gzip', true],
  ['', 'br', false],
  ['identity', 'br', false],
  ['  br  ', 'br', true],
  ['BR', 'br', true],
  // q values
  ['gzip;q=0.5', 'gzip', true],
  ['br;q=0', 'br', false], // explicit refusal - the bug the naive regex had
  ['br;q=0, gzip', 'br', false],
  ['br;q=0, gzip', 'gzip', true],
  ['gzip;q=0, *', 'gzip', false], // refusal beats the wildcard
  ['br;q=abc, gzip', 'br', true], // malformed q is ignored, not fatal
  // wildcard (RFC 9110 12.5.3)
  ['*', 'br', true],
  ['*', 'gzip', true],
  ['*, br;q=0', 'br', false],
  ['br;q=0, *', 'br', false],
  ['*, gzip;q=0', 'gzip', false],
];

console.log('--- accept-encoding negotiation ---');
for (const [header, token, want] of NEGOTIATION) {
  const got = accepts(header, token);
  check(got === want, `accepts(${JSON.stringify(header)}, ${token})`, `want=${want} got=${got}`);
}

// --------------------------------------------------------------------------
// 2. The middleware on a real response
// --------------------------------------------------------------------------

const bigBody = JSON.stringify({ slug: 'test', items: 'x'.repeat(6000) });
const tinyBody = '{"ok":true}';
const textBody = 'y'.repeat(4000);
const pngish = crypto.randomBytes(4096); // binary, not on the allowlist
const randomJson = crypto.randomBytes(4096); // incompressible on purpose

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  compressResponses()(req, res, () => {
    switch (pathname) {
      case '/big':
        res.setHeader('content-type', 'application/json; charset=utf-8');
        return res.end(bigBody);
      case '/text':
        res.setHeader('content-type', 'text/plain; charset=utf-8');
        return res.end(textBody);
      case '/tiny':
        res.setHeader('content-type', 'application/json');
        return res.end(tinyBody);
      case '/image':
        res.setHeader('content-type', 'image/png');
        return res.end(pngish);
      case '/preencoded':
        res.setHeader('content-type', 'application/json');
        res.setHeader('content-encoding', 'br');
        return res.end('already-encoded-payload');
      case '/notsmaller':
        res.setHeader('content-type', 'application/json');
        return res.end(randomJson);
      case '/empty':
        res.statusCode = 304;
        return res.end();
      default:
        res.statusCode = 404;
        res.setHeader('content-type', 'text/plain; charset=utf-8');
        return res.end('nope');
    }
  });
});

function request(port, path, acceptEncoding, method = 'GET') {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (acceptEncoding !== undefined) headers['accept-encoding'] = acceptEncoding;
    const req = http.request(
      { host: '127.0.0.1', port, path, method, headers },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function decode(res) {
  const enc = res.headers['content-encoding'];
  if (enc === 'gzip') return zlib.gunzipSync(res.body);
  if (enc === 'br') return zlib.brotliDecompressSync(res.body);
  return res.body;
}

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

console.log('\n--- middleware on real responses ---');

const brRes = await request(port, '/big', 'br, gzip');
check(
  brRes.headers['content-encoding'] === 'br' && decode(brRes).toString() === bigBody,
  'brotli when the client offers br',
  `enc=${brRes.headers['content-encoding']} ${brRes.body.length}B (raw ${bigBody.length}B)`,
);
check(
  String(brRes.headers['vary'] || '').toLowerCase().includes('accept-encoding'),
  'Vary: Accept-Encoding on a compressed response',
  `vary=${brRes.headers['vary']}`,
);

const gzipRes = await request(port, '/big', 'gzip');
check(
  gzipRes.headers['content-encoding'] === 'gzip' && decode(gzipRes).toString() === bigBody,
  'gzip when only gzip is offered',
  `enc=${gzipRes.headers['content-encoding']} ${gzipRes.body.length}B`,
);

const refused = await request(port, '/big', 'br;q=0, gzip');
check(
  refused.headers['content-encoding'] === 'gzip' && decode(refused).toString() === bigBody,
  'br;q=0 falls back to gzip instead of brotli',
  `enc=${refused.headers['content-encoding']}`,
);

const wildcard = await request(port, '/big', '*');
check(
  wildcard.headers['content-encoding'] !== undefined && decode(wildcard).toString() === bigBody,
  'a bare * still gets a compression',
  `enc=${wildcard.headers['content-encoding']}`,
);

for (const ae of [undefined, 'identity']) {
  const res = await request(port, '/big', ae);
  check(
    res.headers['content-encoding'] === undefined && res.body.toString() === bigBody,
    `identity when accept-encoding is ${ae === undefined ? 'absent' : JSON.stringify(ae)}`,
    `${res.body.length}B untouched`,
  );
}

const tiny = await request(port, '/tiny', 'br, gzip');
check(
  tiny.headers['content-encoding'] === undefined && tiny.body.toString() === tinyBody,
  'responses under 1KB are left alone',
  `${tiny.body.length}B`,
);

const image = await request(port, '/image', 'br, gzip');
check(
  image.headers['content-encoding'] === undefined && image.body.equals(pngish),
  'types outside the allowlist are left alone (image/png)',
  `enc=${image.headers['content-encoding']}`,
);

const pre = await request(port, '/preencoded', 'br, gzip');
check(
  pre.headers['content-encoding'] === 'br' && pre.body.toString() === 'already-encoded-payload',
  'an already-encoded response is passed through untouched',
  `${pre.body.length}B`,
);

const notSmaller = await request(port, '/notsmaller', 'gzip');
check(
  notSmaller.headers['content-encoding'] === undefined && notSmaller.body.equals(randomJson),
  'skipped when gzip would not make it smaller',
  `${notSmaller.body.length}B`,
);

const empty = await request(port, '/empty', 'br, gzip');
check(
  empty.status === 304 && empty.headers['content-encoding'] === undefined && empty.body.length === 0,
  '304 stays bodiless and unencoded',
  `status=${empty.status}`,
);

const head = await request(port, '/big', 'br, gzip', 'HEAD');
check(
  head.headers['content-encoding'] === undefined,
  'HEAD has no body to compress',
  `enc=${head.headers['content-encoding']}`,
);

const text = await request(port, '/text', 'gzip');
check(
  text.headers['content-encoding'] === 'gzip' && decode(text).toString() === textBody,
  'text/* is on the allowlist',
  `enc=${text.headers['content-encoding']} ${text.body.length}B`,
);

const missing = await request(port, '/nope', 'br, gzip');
check(
  missing.status === 404 && missing.headers['content-encoding'] === undefined,
  'small 404 bodies pass through',
  `status=${missing.status} ${missing.body.length}B`,
);

server.close();

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

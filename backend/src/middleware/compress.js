import zlib from 'node:zlib';

/**
 * gzip/brotli for the API and the built client, using Node's own zlib.
 *
 * Why this exists, measured rather than guessed: `GET /api/stores/joes-pizza`
 * answers in 942,386 bytes with `content-encoding: -`. That is ONE storefront
 * open. Almost all of it is base64 embedded in the JSON, so no browser can cache
 * it as an image - the browser sees one 942KB entity it must re-download and the
 * page must re-parse - and the app's own JS bundle is another 500KB+ on top.
 * Against a Cloudflare tunnel or a phone on mobile data that transfer, not the
 * database once the cache is warm, is the largest single part of "the app takes
 * ages to load".
 *
 * The `compression` package would do this in one line, and it is a dependency
 * this project does not have. Rather than add one for a 60-line filter, this is
 * the same idea implemented against `node:zlib`, which is already there.
 *
 * What it deliberately does NOT do:
 *  - compress tiny responses (below `minBytes`): the CPU and the extra header
 *    cost more than the bytes saved, and a 52-byte /health is not worth it.
 *  - touch an already-encoded response, a range response, or a bodiless one
 *    (204/304/HEAD): there is either nothing to gain or nothing to send.
 *  - compress when the result is not actually smaller. A base64 PNG is already
 *    compressed data, and brotli can hand back a slightly LARGER body; sending
 *    the original then is the difference between "smaller responses" and
 *    "smaller responses usually".
 *
 * Buffered, not streamed: Express's `res.json`/`res.send` build the whole body
 * before ending the response anyway, so there is nothing to stream. A streamed
 * body (`express.static`) is collected here first, which is a trade this app can
 * afford - the largest thing served that way is a hashed JS chunk.
 */

/** Below this, compression is not worth the header or the CPU. */
const MIN_BYTES = 1024;

/**
 * Types worth compressing.
 *
 * A positive list, not "everything except images": a storefront image or a font
 * is already compressed, and letting one through would spend CPU to make it
 * bigger. Anything not named here passes through untouched, which is the safe
 * direction - the failure mode is an uncompressed response, never a corrupt one.
 */
const COMPRESSIBLE =
  /^(?:text\/|application\/(?:json|javascript|xml|manifest\+json)|image\/svg\+xml)/i;

/**
 * Does this client accept `token` (`br` / `gzip`)?
 *
 * Parsed token by token rather than pattern-matched, because two perfectly real
 * headers break the naive version. Both were caught while probing the app
 * through a Cloudflare tunnel:
 *
 *   `Accept-Encoding: br;q=0`  - an explicit REFUSAL. A substring match sees
 *                                "br" followed by ";" and answers "yes", which
 *                                would send brotli to a client that just said
 *                                it cannot decode it.
 *   `Accept-Encoding: *`       - RFC 9110 12.5.3: "any available content-coding
 *                                not explicitly listed". Answering "no" turns
 *                                every such response into raw bytes, i.e. the
 *                                failure mode this middleware exists to avoid.
 *
 * An explicit entry for the token decides on its own (q > 0), wins over a `*`
 * anywhere in the list, and a `q=0` entry never counts as accepting.
 */
export function accepts(header, token) {
  let wildcard = false;

  for (const entry of String(header || '').split(',')) {
    const [rawName, ...params] = entry.split(';');
    const name = rawName.trim().toLowerCase();
    if (!name) continue;

    // q is 1 unless a parseable q= says otherwise; a malformed q is ignored
    // (lenient on purpose: guessing "unacceptable" would drop the encoding).
    let q = 1;
    for (const param of params) {
      const match = param.trim().match(/^q=(.+)$/i);
      if (match) {
        const parsed = Number.parseFloat(match[1]);
        if (!Number.isNaN(parsed)) q = parsed;
      }
    }

    if (name === token) return q > 0;
    if (q <= 0) continue;
    if (name === '*') wildcard = true;
  }

  return wildcard;
}

/** Brotli at quality 5, NOT the default 11: ~10x faster for ~2% more bytes. */
function brotli(body) {
  return new Promise((resolve, reject) => {
    zlib.brotliCompress(
      body,
      {
        params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: 5,
          [zlib.constants.BROTLI_PARAM_SIZE_HINT]: body.length,
        },
      },
      (err, out) => (err ? reject(err) : resolve(out)),
    );
  });
}

function gzip(body) {
  return new Promise((resolve, reject) => {
    zlib.gzip(body, { level: zlib.constants.Z_DEFAULT_COMPRESSION }, (err, out) =>
      err ? reject(err) : resolve(out),
    );
  });
}

export function compressResponses({ minBytes = MIN_BYTES } = {}) {
  return function compress(req, res, next) {
    // A HEAD response has no body to compress, and nothing to negotiate on.
    if (req.method === 'HEAD' || req.method === 'OPTIONS') return next();

    const accept = String(req.headers['accept-encoding'] || '');
    const useBrotli = accepts(accept, 'br');
    const useGzip = accepts(accept, 'gzip');
    if (!useBrotli && !useGzip) return next();

    /* The decision is taken ONCE, on the first byte, and frozen.
     *
     * It cannot be taken up front: `Content-Type` and the status code are set by
     * the route handler (or by express.static) just before the body, so at
     * middleware time there is nothing to inspect yet. It cannot be taken late
     * either - buffering the start of a response and then handing a later chunk
     * straight to the socket would send a body that is half raw and half
     * buffered. Deciding on the first write and remembering it is the only
     * ordering that is correct in both directions. */
    let buffering = null;

    const chunks = [];
    let bufferedBytes = 0;

    const originalWrite = res.write.bind(res);
    const originalEnd = res.end.bind(res);

    const shouldBuffer = () => {
      if (buffering !== null) return buffering;

      buffering =
        !res.getHeader('content-encoding') &&
        res.statusCode !== 204 &&
        res.statusCode !== 304 &&
        res.statusCode !== 206 &&
        COMPRESSIBLE.test(String(res.getHeader('content-type') || ''));

      return buffering;
    };

    const collect = (chunk, encoding) => {
      if (chunk === null || chunk === undefined) return;

      const buf = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk, typeof encoding === 'string' ? encoding : 'utf8');

      chunks.push(buf);
      bufferedBytes += buf.length;
    };

    res.write = function write(chunk, encoding, callback) {
      if (!shouldBuffer()) return originalWrite(chunk, encoding, callback);

      collect(chunk, encoding);
      if (typeof callback === 'function') callback();
      // "Handed over" as far as the caller is concerned; the flush happens in end().
      return true;
    };

    res.end = function end(chunk, encoding, callback) {
      if (!shouldBuffer()) return originalEnd(chunk, encoding, callback);

      if (typeof chunk === 'function') {
        callback = chunk;
        chunk = undefined;
      } else if (typeof encoding === 'function') {
        callback = encoding;
        encoding = undefined;
      }

      collect(chunk, encoding);

      // An empty body (a 200 with nothing in it) keeps its own headers.
      if (bufferedBytes === 0) return originalEnd();

      const body =
        chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, bufferedBytes);

      const send = (payload, encodingName) => {
        res.removeHeader('content-length');
        res.setHeader('content-length', payload.length);

        if (encodingName) res.setHeader('content-encoding', encodingName);

        /* `Vary` is what stops a shared cache or a proxy handing gzipped bytes
         * to a client that never asked for them. Appended rather than assigned,
         * because CORS has usually already put `Origin` here. */
        const vary = res.getHeader('vary');
        if (!String(vary || '').includes('accept-encoding')) {
          res.setHeader(
            'vary',
            vary ? `${vary}, Accept-Encoding` : 'Accept-Encoding',
          );
        }

        // `end` returns the response object, and some callers chain off it.
        return originalEnd(payload, () => {
          if (typeof callback === 'function') callback();
        });
      };

      if (body.length < minBytes) return send(body, null);

      const encode = useBrotli ? brotli : gzip;

      return encode(body)
        .then((compressed) => {
          // Already-compressed input (a base64 PNG) can come back bigger. The
          // original is the better answer, and it is right here.
          if (!compressed || compressed.length >= body.length) {
            return send(body, null);
          }
          return send(compressed, useBrotli ? 'br' : 'gzip');
        })
        .catch(() => send(body, null));
    };

    return next();
  };
}

export default compressResponses;

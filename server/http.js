/**
 * Static file serving.
 *
 * Two things here are deliberate rather than tidy:
 *
 *  - The phone page is assembled once at boot into ONE gzipped response with
 *    its CSS and JS inlined. Thirty phones loading simultaneously is the worst
 *    congestion moment of the night; it should cost one request each.
 *  - `shared/protocol.js` is inlined into that page with its `export` keywords
 *    stripped, so the phone and the server can never disagree about the wire
 *    format even though the phone loads no modules.
 */

import { createReadStream, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';

/** @type {Record<string, string>} */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/** Directories that may be served verbatim. Anything else 404s. */
const STATIC_DIRS = ['shared', 'sim', 'client/display'];

/**
 * @param {string} root repo root
 * @returns {{buildPhonePage: () => {gz: Buffer, raw: Buffer}}}
 */
function makeBuilder(root) {
  const stripExports = /** @param {string} src */ (src) =>
    src.replace(/^export\s+(?=(const|let|var|function|class)\b)/gm, '');

  return {
    buildPhonePage() {
      const html = readFileSync(path.join(root, 'client/phone/index.html'), 'utf8');
      const protocol = stripExports(readFileSync(path.join(root, 'shared/protocol.js'), 'utf8'));
      const tuning = stripExports(readFileSync(path.join(root, 'shared/tuning.js'), 'utf8'));
      const out = html
        .replace('/*__PROTOCOL__*/', () => protocol)
        .replace('/*__TUNING__*/', () => tuning);
      const raw = Buffer.from(out, 'utf8');
      return { gz: gzipSync(raw, { level: 9 }), raw };
    },
  };
}

/**
 * @param {object} opts
 * @param {string} opts.root
 * @param {boolean} opts.dev rebuild the phone page on every request
 * @param {() => unknown} opts.getCheckpoint
 * @param {() => string} opts.getJoinUrl
 * @returns {import('node:http').RequestListener}
 */
export function createHandler({ root, dev, getCheckpoint, getJoinUrl }) {
  const builder = makeBuilder(root);
  let phone = builder.buildPhonePage();

  return (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const pathname = decodeURIComponent(url.pathname);
    const acceptsGzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));

    // No caching anywhere. This is a prototype that gets reloaded constantly,
    // and every asset is tiny.
    res.setHeader('Cache-Control', 'no-store');

    // Browsers ask for this unprompted; a 404 in the console is noise that
    // hides real errors when something actually goes wrong at the venue.
    if (pathname === '/favicon.ico') {
      res.writeHead(204).end();
      return;
    }

    if (pathname === '/api/checkpoint') {
      const body = JSON.stringify(getCheckpoint() ?? null);
      res.writeHead(200, { 'Content-Type': MIME['.json'] });
      res.end(body);
      return;
    }

    if (pathname === '/api/health') {
      res.writeHead(200, { 'Content-Type': MIME['.json'] });
      // The display is loaded from localhost and has no idea what the LAN
      // address is, so it asks — that is what the on-screen QR encodes.
      res.end(JSON.stringify({ ok: true, joinUrl: getJoinUrl() }));
      return;
    }

    // The gamepad. Every unknown path lands here too, so a mistyped URL from a
    // phone still joins the game instead of 404ing at a player mid-party.
    if (pathname === '/' || pathname === '/index.html' || pathname === '/join') {
      if (dev) phone = builder.buildPhonePage();
      const body = acceptsGzip ? phone.gz : phone.raw;
      /** @type {Record<string,string>} */
      const headers = { 'Content-Type': MIME['.html'], 'Content-Length': String(body.length) };
      if (acceptsGzip) headers['Content-Encoding'] = 'gzip';
      res.writeHead(200, headers);
      res.end(body);
      return;
    }

    if (pathname === '/display' || pathname === '/display/') {
      sendFile(res, path.join(root, 'client/display/index.html'));
      return;
    }

    // Static module trees.
    const rel = pathname.replace(/^\/+/, '');
    if (STATIC_DIRS.some((d) => rel === d || rel.startsWith(d + '/'))) {
      const abs = path.normalize(path.join(root, rel));
      if (!abs.startsWith(root + path.sep)) {
        res.writeHead(403).end('forbidden');
        return;
      }
      sendFile(res, abs);
      return;
    }

    // The NoSleep asset, if it has been generated (see tools/make-nosleep.sh).
    if (pathname === '/nosleep.mp4' || pathname === '/nosleep.webm') {
      sendFile(res, path.join(root, 'client/phone', path.basename(pathname)));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
  };
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {string} abs
 */
function sendFile(res, abs) {
  let st;
  try {
    st = statSync(abs);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
    return;
  }
  if (!st.isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
    return;
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(abs)] ?? 'application/octet-stream',
    'Content-Length': String(st.size),
  });
  createReadStream(abs).pipe(res);
}

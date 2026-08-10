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
  '.woff2': 'font/woff2',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
};

/** Directories that may be served verbatim. Anything else 404s. */
const STATIC_DIRS = ['shared', 'sim', 'client/display', 'assets'];

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
      const palette = stripExports(readFileSync(path.join(root, 'shared/palette.js'), 'utf8'));
      const out = html
        .replace('/*__PROTOCOL__*/', () => protocol)
        .replace('/*__TUNING__*/', () => tuning)
        .replace('/*__PALETTE__*/', () => palette);
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

    if (pathname === '/api/questions') {
      try {
        const pack = loadQuestions(root);
        res.writeHead(200, { 'Content-Type': MIME['.json'] });
        res.end(JSON.stringify(pack));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': MIME['.json'] });
        res.end(JSON.stringify({ error: String(err) }));
      }
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

    // Many gamepads on one machine, for functional testing without a room full
    // of phones. Says nothing about latency — see the note in the page itself.
    if (pathname === '/testpad' || pathname === '/testpad/') {
      sendFile(res, path.join(root, 'client/testpad/index.html'));
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


/**
 * Read and sanity-check the question pack. Read fresh each request so editing
 * questions.json and reloading the display is the whole edit loop.
 *
 * Problems are reported loudly but do not stop the game: refusing to start a
 * party because one answer is 29 characters long would be the wrong trade. The
 * length caps exist because of across-the-room readability, and an over-long
 * answer will simply be shrunk to fit by the renderer.
 * @param {string} root
 */
export function loadQuestions(root) {
  const file = path.join(root, 'questions/default.json');
  const pack = JSON.parse(readFileSync(file, 'utf8'));

  /** @type {string[]} */
  const problems = [];
  const questions = (pack.questions ?? []).filter((/** @type {any} */ q, /** @type {number} */ i) => {
    const where = `Q${i + 1}`;
    if (typeof q?.text !== 'string' || !Array.isArray(q?.answers)) {
      problems.push(`${where}: missing text or answers — skipped`);
      return false;
    }
    if (q.answers.length < 2 || q.answers.length > 4) {
      problems.push(`${where}: ${q.answers.length} answers, must be 2-4 — skipped`);
      return false;
    }
    if (!Number.isInteger(q.correct) || q.correct < 0 || q.correct >= q.answers.length) {
      problems.push(`${where}: "correct" is out of range — skipped`);
      return false;
    }
    if (q.text.length > 90) problems.push(`${where}: question is ${q.text.length} chars (>90 is hard to read across a room)`);
    for (const a of q.answers) {
      if (String(a).length > 28) problems.push(`${where}: answer "${a}" is ${String(a).length} chars (>28 shrinks small)`);
    }
    return true;
  });

  if (problems.length) {
    console.log('\n  \x1b[33m!\x1b[0m  questions/default.json:');
    for (const m of problems) console.log(`       ${m}`);
    console.log('');
  }

  return { pack: pack.pack ?? 'default', answerMs: pack.answerMs ?? 12000, questions };
}

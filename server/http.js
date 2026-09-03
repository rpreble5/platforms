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

import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { packMode, plainImageName, validatePack } from '../shared/pack-validate.js';
// Re-exported so existing callers (and tests) keep one import site.
export { suggestOrder } from '../shared/pack-validate.js';
import { gzipSync } from 'node:zlib';
import path from 'node:path';

import { deleteLevel, listLevels, saveLevel } from './levels-store.js';
import { commitToGitHub, packRev, publishPack } from './pack-store.js';
import { NOTES_CAP, draftPack, suggestShorter, underDailyLimit } from './ai-draft.js';

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
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

/** Directories that may be served verbatim. Anything else 404s. */
const STATIC_DIRS = ['shared', 'sim', 'client/display', 'client/builder', 'client/training', 'assets'];

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
      const avatar = stripExports(readFileSync(path.join(root, 'shared/avatar.js'), 'utf8'));
      const out = html
        .replace('/*__PROTOCOL__*/', () => protocol)
        .replace('/*__TUNING__*/', () => tuning)
        .replace('/*__PALETTE__*/', () => palette)
        .replace('/*__AVATAR__*/', () => avatar);
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
        // The pack param is matched against the actual directory listing, so
        // it can only ever name a file that exists in questions/ — no paths.
        const want = url.searchParams.get('pack');
        const known = listPacks(root).map((p) => p.file);
        const file = want && known.includes(want) ? want : 'default.json';
        const pack = loadQuestions(root, file);
        res.writeHead(200, { 'Content-Type': MIME['.json'] });
        res.end(JSON.stringify(pack));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': MIME['.json'] });
        res.end(JSON.stringify({ error: String(err) }));
      }
      return;
    }

    // The Studio's sign-in: is a passcode needed here, and is this one
    // right? No passcode configured (the host laptop) means no sign-in.
    if (pathname === '/api/session') {
      const passcode = process.env.AI_PASSCODE;
      const okay = !passcode || req.headers['x-ai-passcode'] === passcode;
      res.writeHead(okay ? 200 : 401, { 'Content-Type': MIME['.json'] });
      res.end(JSON.stringify(okay ? { ok: true, required: !!passcode } : { ok: false, required: true, error: 'wrong or missing passcode' }));
      return;
    }

    if (pathname === '/api/packs' && req.method === 'POST') {
      // Publishing from the Studio: gated by the same AI_PASSCODE faculty
      // already use for drafting (one code to hand out); writes the deck
      // into questions/ here, and commits it to the repository when this
      // server holds a GitHub token, so the venue laptop pulls it later.
      const fail = (/** @type {number} */ code, /** @type {object} */ body) => {
        res.writeHead(code, { 'Content-Type': MIME['.json'] });
        res.end(JSON.stringify(body));
      };
      const passcode = process.env.AI_PASSCODE;
      if (passcode && req.headers['x-ai-passcode'] !== passcode) {
        fail(401, { error: 'wrong or missing passcode' });
        return;
      }
      readBody(req, 512 * 1024)
        .then(async (body) => {
          const parsed = JSON.parse(body);
          const saved = publishPack(root, parsed);
          /** @type {any} */
          const out = { ok: true, file: saved.file, rev: saved.rev, created: saved.created, committed: false };
          const token = process.env.GITHUB_TOKEN;
          const repo = process.env.GITHUB_REPO;
          if (token && repo) {
            const by = typeof parsed.by === 'string' && parsed.by.trim() ? ` (by ${parsed.by.trim().slice(0, 60)})` : '';
            try {
              const c = await commitToGitHub({
                token, repo,
                branch: process.env.GITHUB_BRANCH || process.env.RENDER_GIT_BRANCH || 'main',
                file: saved.file, content: saved.text,
                message: `Publish deck: ${String(parsed.pack.pack).slice(0, 80)}${by}`,
              });
              out.committed = true;
              out.commitUrl = c.url;
            } catch (err) {
              out.commitError = String(err instanceof Error ? err.message : err);
            }
          }
          fail(200, out);
        })
        .catch((/** @type {any} */ err) => {
          if (err?.code === 'CONFLICT') return fail(409, { error: err.message, current: err.current });
          if (err?.code === 'BAD_PACK') return fail(400, { error: err.message });
          if (err instanceof SyntaxError) return fail(400, { error: 'not valid JSON' });
          return fail(500, { error: 'publish failed — try again' });
        });
      return;
    }

    if (pathname === '/api/packs') {
      res.writeHead(200, { 'Content-Type': MIME['.json'] });
      res.end(JSON.stringify(listPacks(root)));
      return;
    }

    // AI drafting for the Pack Studio: faculty notes -> the doc format,
    // reviewed in the editor. Spends real API money, so it is off without
    // ANTHROPIC_API_KEY, passcode-gated when AI_PASSCODE is set (the public
    // Render instance should set both), and per-IP rate limited.
    if (pathname === '/api/ai-draft' && req.method === 'POST') {
      const fail = (/** @type {number} */ code, /** @type {string} */ error) => {
        res.writeHead(code, { 'Content-Type': MIME['.json'] });
        res.end(JSON.stringify({ error }));
      };
      if (!process.env.ANTHROPIC_API_KEY) {
        fail(503, 'AI drafting is not configured on this server — set ANTHROPIC_API_KEY (and AI_PASSCODE) in its environment');
        return;
      }
      const passcode = process.env.AI_PASSCODE;
      if (passcode && req.headers['x-ai-passcode'] !== passcode) {
        fail(401, 'wrong or missing passcode');
        return;
      }
      const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '?').split(',')[0].trim();
      if (!underDailyLimit(ip)) {
        fail(429, 'daily drafting limit reached for this connection — try again tomorrow');
        return;
      }
      readBody(req, NOTES_CAP + 16 * 1024)
        .then((body) => {
          const parsed = JSON.parse(body);
          /** @type {Promise<object>} */
          const run = parsed?.mode === 'suggest' ? suggestShorter(parsed) : draftPack(parsed);
          return run;
        })
        .then((out) => {
          res.writeHead(200, { 'Content-Type': MIME['.json'] });
          res.end(JSON.stringify(out));
        })
        .catch((/** @type {any} */ err) => {
          if (err?.code === 'SDK_MISSING') return fail(503, err.message);
          if (err instanceof RangeError) return fail(400, err.message);
          // Anthropic SDK errors carry .status; map the interesting ones.
          if (err?.status === 401) return fail(502, 'the server’s API key was rejected — check ANTHROPIC_API_KEY');
          if (err?.status === 429) return fail(502, 'the AI API is rate limited right now — try again in a minute');
          if (Number.isInteger(err?.status)) return fail(502, `AI API error ${err.status}`);
          return fail(500, 'drafting failed — try again');
        });
      return;
    }

    // The level library. Reads are open; writes are how the /levels editor
    // saves, and deletes exist so housekeeping never means shelling into the
    // levels/ directory. Names are matched against the actual library — the
    // client never supplies a filename.
    if (pathname === '/api/levels') {
      if (req.method === 'POST') {
        readBody(req, 64 * 1024)
          .then((body) => {
            const saved = saveLevel(root, JSON.parse(body));
            if (!saved) {
              res.writeHead(400, { 'Content-Type': MIME['.json'] });
              res.end(JSON.stringify({ error: 'not a level: needs a name and 2-5 boards' }));
              return;
            }
            res.writeHead(200, { 'Content-Type': MIME['.json'] });
            res.end(JSON.stringify({ ok: true, slug: saved.slug, spec: saved.spec }));
          })
          .catch((err) => {
            res.writeHead(400, { 'Content-Type': MIME['.json'] });
            res.end(JSON.stringify({ error: String(err) }));
          });
        return;
      }
      if (req.method === 'DELETE') {
        const name = url.searchParams.get('name') ?? '';
        const gone = deleteLevel(root, name);
        res.writeHead(gone ? 200 : 404, { 'Content-Type': MIME['.json'] });
        res.end(JSON.stringify({ ok: gone }));
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME['.json'] });
      res.end(JSON.stringify(listLevels(root)));
      return;
    }

    // Question images — the ONE window into questions/. The directory
    // itself is deliberately never served (packs carry answer keys), so
    // this route accepts a plain image basename and nothing else.
    if (pathname.startsWith('/qimg/')) {
      const name = decodeURIComponent(pathname.slice('/qimg/'.length));
      if (name !== path.basename(name) || !/\.(png|jpe?g|webp|svg)$/i.test(name)) {
        res.writeHead(403).end('forbidden');
        return;
      }
      sendFile(res, path.join(root, 'questions', 'images', name));
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

    // The host's remote control. The page itself is public; the WebSocket
    // requires the key from the URL fragment, which never reaches the server
    // in the HTTP request — so serving the page to a curious player is free.
    if (pathname === '/host' || pathname === '/host/') {
      sendFile(res, path.join(root, 'client/host/index.html'));
      return;
    }

    // The Pack Studio: zero-install pack authoring. Also published on
    // GitHub Pages for faculty. The page lives at its real directory path
    // so its RELATIVE imports resolve identically here and on Pages;
    // /builder is just the memorable front door.
    if (pathname === '/builder' || pathname === '/builder/') {
      res.writeHead(302, { Location: '/client/builder/' }).end();
      return;
    }
    if (pathname === '/client/builder/' || pathname === '/client/builder') {
      sendFile(res, path.join(root, 'client/builder/index.html'));
      return;
    }

    // The question writer's guide: arena diagrams + limits, for faculty
    // "training". Same serving pattern as the Studio.
    if (pathname === '/training' || pathname === '/training/') {
      res.writeHead(302, { Location: '/client/training/' }).end();
      return;
    }
    if (pathname === '/client/training/' || pathname === '/client/training') {
      sendFile(res, path.join(root, 'client/training/index.html'));
      return;
    }

    // Avatar preview: every colour in both finishes on each year's body.
    if (pathname === '/sprites' || pathname === '/sprites/') {
      sendFile(res, path.join(root, 'client/display/sprites-preview.html'));
      return;
    }

    // Level design loop: drag platforms on the real renderer, with the layout
    // rules checked live and an export snippet for sim/levels.js.
    if (pathname === '/levels' || pathname === '/levels/') {
      sendFile(res, path.join(root, 'client/display/level-editor.html'));
      return;
    }

    // Physical input sandbox: embedded top/bottom control boxes across four
    // floors, intentionally separate from quiz modes and scoring.
    if (pathname === '/controls' || pathname === '/controls/') {
      sendFile(res, path.join(root, 'client/display/control-lab.html'));
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
 * Collect a request body, capped — the only writer is the level editor, and
 * a level is a few hundred bytes, so anything huge is a mistake or mischief.
 * @param {import('node:http').IncomingMessage} req
 * @param {number} cap bytes
 * @returns {Promise<string>}
 */
function readBody(req, cap) {
  return new Promise((resolve, reject) => {
    let size = 0;
    /** @type {Buffer[]} */
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > cap) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}


/**
 * Every question pack in questions/, with just enough metadata for a menu.
 * Read fresh on each call — dropping a new pack file in and reloading the
 * display is the whole workflow.
 * @param {string} root
 * The cover is the one filesystem truth in this list: it is reported only
 * when the file is really in questions/images, so the lobby never chases a
 * 404 for a picture that was never sent along with the pack.
 * @returns {Array<{file:string, name:string, questions:number,
 *   mode:'solo'|'teams', cover?:string, showdown:boolean, controlRoom:number,
 *   rev:string, by:string, at:string}>}
 */
export function listPacks(root) {
  const dir = path.join(root, 'questions');
  /** @type {string[]} */
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  } catch {
    return [];
  }
  return files.map((file) => {
    try {
      const text = readFileSync(path.join(dir, file), 'utf8');
      const j = JSON.parse(text);
      /** @type {any} */
      const row = {
        file,
        name: typeof j.pack === 'string' ? j.pack : file.replace(/\.json$/, ''),
        questions: Array.isArray(j.questions) ? j.questions.length : 0,
        mode: packMode(j),
        showdown: !!j.showdown?.statements?.length,
        controlRoom: Array.isArray(j.controlRoom?.questions) ? j.controlRoom.questions.length : 0,
        // The Studio sends this rev back on publish so a stale overwrite is
        // refused; who/when comes from the last publish, if any.
        rev: packRev(text),
        by: typeof j.published?.by === 'string' ? j.published.by : '',
        at: typeof j.published?.at === 'string' ? j.published.at : '',
      };
      if (plainImageName(j.cover) && existsSync(path.join(dir, 'images', j.cover))) row.cover = j.cover;
      return row;
    } catch {
      return { file, name: `${file} (broken)`, questions: 0, mode: 'solo', showdown: false, controlRoom: 0 };
    }
  });
}

/**
 * Read a question pack and validate it through the SHARED rulebook
 * (shared/pack-validate.js — the same module the Pack Studio uses), then
 * apply the one check only this host can make: whether each referenced
 * image actually exists in questions/images. Read fresh each request so
 * editing questions/*.json and reloading the display is the whole edit
 * loop; problems are printed, never fatal.
 * @param {string} root
 * @param {string} [packFile] basename within questions/; callers validate
 */
export function loadQuestions(root, packFile = 'default.json') {
  let name = path.basename(packFile);
  // The library has no privileged filename: if the requested pack is gone,
  // boot on the first one there is rather than refusing to start.
  if (!existsSync(path.join(root, 'questions', name))) {
    const first = listPacks(root)[0];
    if (first) name = first.file;
  }
  const file = path.join(root, 'questions', name);
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  const { pack, problems } = validatePack(raw);

  for (let i = 0; i < pack.questions.length; i++) {
    const q = pack.questions[i];
    if (q.image && !existsSync(path.join(root, 'questions', 'images', q.image))) {
      problems.push(`Q${i + 1}: image "${q.image}" not found in questions/images — ignored`);
      delete q.image;
    }
  }
  if (pack.cover && !existsSync(path.join(root, 'questions', 'images', pack.cover))) {
    problems.push(`cover "${pack.cover}" not found in questions/images — ignored`);
    delete pack.cover;
  }

  if (problems.length) {
    console.log(`\n  \x1b[33m!\x1b[0m  questions/${name}:`);
    for (const m of problems) console.log(`       ${m}`);
    console.log('');
  }

  return { ...pack, file: path.basename(packFile) };
}

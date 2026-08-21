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

import { createReadStream, readdirSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';

import { deleteLevel, listLevels, saveLevel } from './levels-store.js';

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

    if (pathname === '/api/packs') {
      res.writeHead(200, { 'Content-Type': MIME['.json'] });
      res.end(JSON.stringify(listPacks(root)));
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
 * @returns {Array<{file:string, name:string, questions:number, showdown:boolean, controlRoom:number}>}
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
      const j = JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
      return {
        file,
        name: typeof j.pack === 'string' ? j.pack : file.replace(/\.json$/, ''),
        questions: Array.isArray(j.questions) ? j.questions.length : 0,
        showdown: !!j.showdown?.statements?.length,
        controlRoom: Array.isArray(j.controlRoom?.questions) ? j.controlRoom.questions.length : 0,
      };
    } catch {
      return { file, name: `${file} (broken)`, questions: 0, showdown: false, controlRoom: 0 };
    }
  });
}

/**
 * Read and sanity-check a question pack. Read fresh each request so editing
 * questions/*.json and reloading the display is the whole edit loop.
 *
 * Problems are reported loudly but do not stop the game: refusing to start a
 * party because one answer is 29 characters long would be the wrong trade. The
 * length caps exist because of across-the-room readability, and an over-long
 * answer will simply be shrunk to fit by the renderer.
 * @param {string} root
 * @param {string} [packFile] basename within questions/; callers validate
 */
export function loadQuestions(root, packFile = 'default.json') {
  const file = path.join(root, 'questions', path.basename(packFile));
  const pack = JSON.parse(readFileSync(file, 'utf8'));

  /** @type {string[]} */
  const problems = [];
  const questions = (pack.questions ?? []).filter((/** @type {any} */ q, /** @type {number} */ i) => {
    const where = `Q${i + 1}`;

    if (q?.type === 'range') {
      if (typeof q.text !== 'string') {
        problems.push(`${where}: missing text — skipped`);
        return false;
      }
      if (!Number.isFinite(q.min) || !Number.isFinite(q.max) || q.min >= q.max) {
        problems.push(`${where}: range needs numeric min < max — skipped`);
        return false;
      }
      const [lo, hi] = Array.isArray(q.answer) ? q.answer : [];
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo > hi) {
        problems.push(`${where}: "answer" must be [low, high] with low <= high — skipped`);
        return false;
      }
      if (lo < q.min || hi > q.max) {
        problems.push(`${where}: answer [${lo}, ${hi}] falls outside the ${q.min}-${q.max} line — skipped`);
        return false;
      }
      if (q.text.length > 90) problems.push(`${where}: question is ${q.text.length} chars (>90 is hard to read across a room)`);
      return true;
    }

    if (typeof q?.text !== 'string' || !Array.isArray(q?.answers)) {
      problems.push(`${where}: missing text or answers — skipped`);
      return false;
    }
    if (q.answers.length < 2 || q.answers.length > 6) {
      problems.push(`${where}: ${q.answers.length} answers, must be 2-6 — skipped`);
      return false;
    }
    if (
      q.layout !== undefined &&
      !['row', 'islands', 'pyramid', 'reverse-pyramid'].includes(q.layout)
    ) {
      problems.push(`${where}: unknown layout "${q.layout}" — using islands`);
      delete q.layout;
    }
    // `correct` is one index, or an array for select-all-that-apply: at
    // least two right (else it's a normal question) and at least one wrong
    // (else the round has no stakes).
    if (Array.isArray(q.correct)) {
      const inRange = q.correct.every(
        (/** @type {any} */ c) => Number.isInteger(c) && c >= 0 && c < q.answers.length
      );
      const distinct = new Set(q.correct).size === q.correct.length;
      if (!inRange || !distinct || q.correct.length < 2 || q.correct.length >= q.answers.length) {
        problems.push(`${where}: select-all "correct" needs 2+ distinct in-range indexes and at least one wrong answer — skipped`);
        return false;
      }
    } else if (!Number.isInteger(q.correct) || q.correct < 0 || q.correct >= q.answers.length) {
      problems.push(`${where}: "correct" is out of range — skipped`);
      return false;
    }
    if (q.text.length > 90) problems.push(`${where}: question is ${q.text.length} chars (>90 is hard to read across a room)`);
    for (const a of q.answers) {
      if (String(a).length > 28) problems.push(`${where}: answer "${a}" is ${String(a).length} chars (>28 shrinks small)`);
    }
    return true;
  });

  // Control Room questions are a separate pool. At game start the display
  // assigns a distinct case to every participating team, then either
  // interleaves those turns or runs the pool as a standalone mode.
  /** @type {{questions:any[], perTeam:number, answerMs:number} | null} */
  let controlRoom = null;
  if (pack.controlRoom) {
    const answerMs = Number.isFinite(pack.controlRoom.answerMs)
      ? Math.max(10000, Math.min(90000, Math.round(pack.controlRoom.answerMs)))
      : 40000;
    const controlQuestions = (Array.isArray(pack.controlRoom.questions) ? pack.controlRoom.questions : [])
      .filter((/** @type {any} */ q, /** @type {number} */ i) => {
        const where = `control #${i + 1}`;
        if (typeof q?.text !== 'string' || !Array.isArray(q.controls)) {
          problems.push(`${where}: needs text and controls — skipped`);
          return false;
        }
        if (q.controls.length < 6 || q.controls.length > 8) {
          problems.push(`${where}: ${q.controls.length} controls, must be 6-8 — skipped`);
          return false;
        }
        for (let c = 0; c < q.controls.length; c++) {
          const control = q.controls[c];
          const at = `${where} control ${c + 1}`;
          if (typeof control?.label !== 'string' || !['toggle', 'number'].includes(control.kind)) {
            problems.push(`${at}: needs a label and toggle/number kind — skipped`);
            return false;
          }
          if (control.label.length > 18) problems.push(`${at}: label "${control.label}" is over 18 chars`);
          if (control.kind === 'toggle') {
            if (typeof control.initial !== 'boolean' || typeof control.answer !== 'boolean') {
              problems.push(`${at}: toggle initial/answer must be boolean — skipped`);
              return false;
            }
          } else {
            const values = [control.initial, control.answer, control.min, control.max, control.step];
            if (!values.every(Number.isFinite) || control.min > control.max || control.step <= 0) {
              problems.push(`${at}: invalid numeric range — skipped`);
              return false;
            }
            if (
              control.initial < control.min || control.initial > control.max ||
              control.answer < control.min || control.answer > control.max
            ) {
              problems.push(`${at}: initial/answer outside range — skipped`);
              return false;
            }
            // The box only ever holds initial ± k*step (clamped), so an
            // answer off that lattice can NEVER be dialled in: the item is
            // permanently unscoreable and a perfect board impossible.
            const steps = (control.answer - control.initial) / control.step;
            if (Math.abs(steps - Math.round(steps)) > 1e-9) {
              problems.push(`${at}: answer ${control.answer} is unreachable from ${control.initial} in steps of ${control.step} — skipped`);
              return false;
            }
          }
        }
        q.type = 'control';
        // Same clamp as the block-level window: a stray 500ms (or negative)
        // per-question value would end a team's whole turn unplayed.
        q.answerMs = Number.isFinite(q.answerMs)
          ? Math.max(10000, Math.min(90000, Math.round(q.answerMs)))
          : answerMs;
        return true;
      });
    if (controlQuestions.length) {
      controlRoom = {
        questions: controlQuestions,
        perTeam: Math.max(1, Math.min(4, Math.floor(pack.controlRoom.perTeam ?? 1))),
        answerMs,
      };
    } else {
      problems.push('controlRoom: no valid questions — block ignored');
    }
  }

  // The showdown block is optional and separate from the quiz deck — a list
  // of true/false statements for the sudden-death mode.
  /** @type {{statements: any[], answerMs?: number} | null} */
  let showdown = null;
  if (pack.showdown) {
    const statements = (Array.isArray(pack.showdown.statements) ? pack.showdown.statements : [])
      .filter((/** @type {any} */ st, /** @type {number} */ i) => {
        if (typeof st?.text !== 'string' || typeof st?.answer !== 'boolean') {
          problems.push(`showdown #${i + 1}: needs text and a boolean answer — skipped`);
          return false;
        }
        if (st.text.length > 110) problems.push(`showdown #${i + 1}: ${st.text.length} chars (>110 is hard to read fast)`);
        return true;
      });
    if (statements.length) {
      showdown = { statements };
      if (Number.isFinite(pack.showdown.answerMs)) showdown.answerMs = pack.showdown.answerMs;
    } else {
      problems.push('showdown: no valid statements — block ignored');
    }
  }

  let theme = 'glass';
  if (pack.theme !== undefined) {
    if (['terrazzo', 'dusk', 'glass', 'aurora', 'berry', 'ocean', 'frost', 'cream', 'noir'].includes(pack.theme)) theme = pack.theme;
    else problems.push(`theme "${pack.theme}" is unknown — using glass`);
  }

  if (problems.length) {
    console.log(`\n  \x1b[33m!\x1b[0m  questions/${path.basename(packFile)}:`);
    for (const m of problems) console.log(`       ${m}`);
    console.log('');
  }

  return {
    pack: pack.pack ?? 'default',
    file: path.basename(packFile),
    answerMs: pack.answerMs ?? 12000,
    theme,
    questions,
    showdown,
    controlRoom,
  };
}

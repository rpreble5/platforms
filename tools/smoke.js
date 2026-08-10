/**
 * Browser smoke test: does the whole loop actually run?
 *
 * The unit tests cover the sim and the relay, but neither proves that the
 * display page boots, connects, ticks, and paints — and a runtime error in the
 * renderer looks exactly like "nothing happens" at the venue. This drives a
 * real Chromium against a real server with a real phone socket attached, and
 * fails on any console error.
 *
 *   node tools/smoke.js            # headless
 *   node tools/smoke.js --shots    # also write PNGs to state/
 *
 * playwright-core is optional and not a dependency; install it to run this.
 */

import http from 'node:http';
import path from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { WebSocket } from 'ws';

import { createHandler } from '../server/http.js';
import { Relay } from '../server/relay.js';
import { BTN_JUMP, BTN_RIGHT, T_INPUT, encodeInput, encodeJson, t16 } from '../shared/protocol.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.argv.includes('--shots');
const crowdArg = process.argv.indexOf('--crowd');
const crowd = crowdArg > 0 ? Number(process.argv[crowdArg + 1] ?? 0) : 0;

/** @type {any} */
let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  console.error('playwright-core is not installed — skipping browser smoke test.');
  console.error('  npm install --no-save playwright-core');
  process.exit(0);
}

// ---------------------------------------------------------------- server

/** @type {Relay} */
let relay;
let port = 0;
/** @type {import('node:http').Server} */
const server = http.createServer(
  createHandler({
    root,
    dev: true,
    getCheckpoint: () => relay?.checkpoint ?? null,
    getJoinUrl: /** @returns {string} */ () => `http://127.0.0.1:${port}/`,
  })
);
relay = new Relay(server);
server.listen(0, '127.0.0.1');
await once(server, 'listening');
port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
const base = `http://127.0.0.1:${port}`;

// ---------------------------------------------------------------- browser

// playwright-core is installed without its browser download, so point it at
// whatever Chromium the environment already has.
const executablePath =
  process.env.CHROME_PATH ??
  globSome([
    `${process.env.PLAYWRIGHT_BROWSERS_PATH ?? ''}/chromium-*/chrome-linux/chrome`,
    `${process.env.HOME ?? ''}/.cache/ms-playwright/chromium-*/chrome-linux/chrome`,
    '/opt/pw-browsers/chromium-*/chrome-linux/chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ]);

let browser;
try {
  browser = await chromium.launch({
    // With no hit, fall through to playwright's own browser resolution.
    ...(executablePath ? { executablePath } : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
} catch (err) {
  console.error(`\n  could not launch Chromium${executablePath ? ` at ${executablePath}` : ''}:`);
  console.error(`    ${err instanceof Error ? err.message.split('\n')[0] : err}`);
  console.error('  Install one with `npx playwright install chromium`, or set CHROME_PATH.\n');
  process.exit(1);
}

/** @type {string[]} */
const problems = [];
/** @param {string} where @param {import('playwright-core').Page} page */
function watch(where, page) {
  page.on('console', (/** @type {any} */ m) => {
    if (m.type() !== 'error') return;
    // Optional sprites and the optional display font are expected to 404 until
    // someone drops them in; everything else is a real problem.
    if (/\/assets\/|nosleep/.test(m.location?.()?.url ?? m.text())) return;
    problems.push(`[${where} console] ${m.text()}`);
  });
  page.on('pageerror', (/** @type {any} */ e) => problems.push(`[${where} pageerror] ${e.message}`));
  page.on('requestfailed', (/** @type {any} */ r) => {
    const u = r.url();
    // The NoSleep probe is expected to 404 when the asset has not been generated.
    if (u.endsWith('/nosleep.mp4') || u.includes('/assets/')) return;
    problems.push(`[${where} requestfailed] ${u} ${r.failure()?.errorText ?? ''}`);
  });
}

const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const display = await ctx.newPage();
watch('display', display);
await display.goto(`${base}/display/`, { waitUntil: 'load' });

await display.waitForFunction(() => /** @type {any} */ (globalThis).__platforms !== undefined, null, {
  timeout: 10000,
});
ok('display page booted');

await display.waitForFunction(
  () => document.getElementById('boot')?.classList.contains('hidden'),
  null,
  { timeout: 10000 }
);
ok('display connected to the relay');

// The sim must be advancing even with nobody connected.
const t1 = await display.evaluate(() => /** @type {any} */ (globalThis).__platforms.world.tick);
await display.waitForTimeout(400);
const t2 = await display.evaluate(() => /** @type {any} */ (globalThis).__platforms.world.tick);
assert(t2 - t1 > 20, `sim is ticking (${t2 - t1} ticks in 400ms)`);

// ---------------------------------------------------------------- a real phone socket

const phone = new WebSocket(`ws://127.0.0.1:${port}/ws`);
phone.binaryType = 'arraybuffer';
await once(phone, 'open');
phone.send(encodeJson({ type: 'HELLO', name: 'smoke' }));
await display.waitForFunction(
  () => /** @type {any} */ (globalThis).__platforms.world.players.size >= 2,
  null,
  { timeout: 5000 }
);
ok('phone joined and the display created an avatar');

const idOf = async () =>
  display.evaluate(() => {
    const w = /** @type {any} */ (globalThis).__platforms.world;
    return [...w.players.keys()].filter((/** @type {number} */ k) => k !== 0)[0];
  });
const pid = await idOf();
/** @param {number} id */
const posOf = (id) =>
  display.evaluate(
    (/** @type {number[]} */ [i]) => {
      const p = /** @type {any} */ (globalThis).__platforms.world.players.get(i);
      return { x: p.x, y: p.y, jumps: p.jumps, onGround: p.onGround };
    },
    [id]
  );

// Let the avatar settle on the floor, then park it in the clear stretch of
// floor between the two solid blocks — the default spawn is close enough to one
// that a half-second run just bumps into it (which is correct behaviour, but
// makes for a useless movement assertion).
await display.waitForFunction(
  (/** @type {number[]} */ [i]) => /** @type {any} */ (globalThis).__platforms.world.players.get(i)?.onGround,
  [pid],
  { timeout: 5000 }
);
await display.evaluate(
  (/** @type {number[]} */ [i]) => {
    const p = /** @type {any} */ (globalThis).__platforms.world.players.get(i);
    p.x = 650;
    p.vx = 0;
  },
  [pid]
);
const before = await posOf(pid);

let seq = 0;
const send = (/** @type {number} */ mask) =>
  phone.send(encodeInput(T_INPUT, mask, 0, ++seq, t16(performance.now())));

send(BTN_RIGHT);
await display.waitForTimeout(500);
const moved = await posOf(pid);
assert(moved.x > before.x + 100, `held RIGHT moved the avatar (${(moved.x - before.x).toFixed(0)}px)`);

// A tap so short that press and release land in the same tick must still jump.
send(BTN_RIGHT | BTN_JUMP);
send(BTN_RIGHT);
await display.waitForTimeout(300);
const jumped = await posOf(pid);
assert(jumped.jumps > 0, 'a one-frame tap still produced a jump');

send(0);
await display.waitForTimeout(600);
const stopped = await posOf(pid);
await display.waitForTimeout(300);
const stillStopped = await posOf(pid);
assert(Math.abs(stillStopped.x - stopped.x) < 1, 'releasing stops the avatar');

// Painting: the canvas must not be a flat field.
const painted = await display.evaluate(() => {
  const cv = /** @type {HTMLCanvasElement} */ (document.getElementById('stage'));
  const cx = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
  const d = cx.getImageData(0, 0, cv.width, cv.height).data;
  const seen = new Set();
  for (let i = 0; i < d.length; i += 4 * 977) seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
  return seen.size;
});
assert(painted > 8, `canvas is actually rendering (${painted} distinct sampled colours)`);

// ---------------------------------------------------------------- the phone page

const phonePage = await ctx.newPage();
watch('phone', phonePage);
await phonePage.setViewportSize({ width: 390, height: 844 });
await phonePage.goto(`${base}/`, { waitUntil: 'load' });
await phonePage.waitForFunction(
  () => document.getElementById('name')?.textContent !== 'connecting…',
  null,
  { timeout: 10000 }
);
const shown = await phonePage.textContent('#name');
assert(!!shown && shown !== 'connecting…', `phone page joined as "${shown}"`);

// ---------------------------------------------------------------- the setup card
//
// Name and colour, then "I'm ready". This gate is also where fullscreen and the
// wake lock get their user gesture, so nothing downstream works until it's done.
await phonePage.waitForSelector('#setup.on', { timeout: 5000 });
const PICK = 4; // jade
await phonePage.fill('#nameIn', 'Bosco');
await phonePage.locator(`.sw[data-i="${PICK}"]`).click();
assert(
  await phonePage
    .locator(`.sw[data-i="${PICK}"]`)
    .evaluate((/** @type {Element} */ el) => el.classList.contains('sel')),
  'tapping a swatch selects that colour'
);
await phonePage.locator('#go').click();
await phonePage.waitForSelector('#overlay', { state: 'hidden', timeout: 5000 });

// The bar shows what the SERVER settled on, not what was typed, so this has to
// wait for the echo rather than read straight after the tap.
await phonePage.waitForFunction(
  () => document.getElementById('name')?.textContent === 'Bosco',
  null,
  { timeout: 5000 }
);
ok('the phone shows the name the server confirmed');

// The pick has to survive the round trip and land on the display, or the whole
// "look at your phone, then find that on screen" mechanism is broken.
await display.waitForFunction(
  () =>
    [.../** @type {any} */ (globalThis).__platforms.roster.values()].some(
      (/** @type {any} */ v) => v.name === 'Bosco'
    ),
  null,
  { timeout: 5000 }
);
const onDisplay = await display.evaluate(() => {
  const r = /** @type {any} */ (globalThis).__platforms.roster;
  return [...r.values()].find((/** @type {any} */ v) => v.name === 'Bosco');
});
assert(
  onDisplay.color === '#2fc98d',
  `the display got the chosen colour (${onDisplay.color}) and a hat (${onDisplay.hat})`
);
const box = /** @type {{x:number,y:number,width:number,height:number}} */ (
  await phonePage.locator('#jump').boundingBox()
);
const beforeTap = await display.evaluate(() => {
  const w = /** @type {any} */ (globalThis).__platforms.world;
  return [...w.players.values()].reduce((/** @type {number} */ a, /** @type {any} */ p) => a + p.jumps, 0);
});
await phonePage.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await phonePage.mouse.down();
await phonePage.waitForTimeout(120);
await phonePage.mouse.up();
await display.waitForTimeout(400);
const afterTap = await display.evaluate(() => {
  const w = /** @type {any} */ (globalThis).__platforms.world;
  return [...w.players.values()].reduce((/** @type {number} */ a, /** @type {any} */ p) => a + p.jumps, 0);
});
assert(afterTap > beforeTap, 'tapping JUMP on the phone page jumped an avatar on the display');

// Crowd mode: what does the screen actually look like with a full room? This
// is the only way to check identity, label density, and platform crowding
// before thirty real people are standing in front of it.
/** @type {WebSocket[]} */
const bots = [];
if (crowd > 0) {
  for (let i = 0; i < crowd; i++) {
    const b = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    b.binaryType = 'arraybuffer';
    await once(b, 'open');
    b.send(encodeJson({ type: 'HELLO' }));
    bots.push(b);
  }
  await display.waitForFunction(
    (/** @type {number[]} */ [n]) => /** @type {any} */ (globalThis).__platforms.world.players.size >= n,
    [crowd + 2],
    { timeout: 15000 }
  );
  // Scatter them, then let a few hold buttons so the scene isn't static.
  await display.evaluate(() => {
    const w = /** @type {any} */ (globalThis).__platforms.world;
    let i = 0;
    for (const p of w.players.values()) {
      p.x = 120 + ((i * 137) % 1600);
      p.y = 300 + ((i * 91) % 300);
      i++;
    }
  });
  bots.forEach((b, i) => {
    if (i % 3 === 0) b.send(encodeInput(T_INPUT, BTN_RIGHT, 0, 1, t16(performance.now())));
  });
  await display.waitForTimeout(1200);
  ok(`crowded the display with ${crowd} bots`);
}

// ---------------------------------------------------------------- a real round
//
// The unit tests cover the round machine; this checks the part they can't --
// that it runs, renders, and scores inside an actual browser.

// Opening the phone page backgrounded this tab, and Chromium throttles rAF on
// background tabs. The sim is driven by rAF with a per-frame dt clamp, so a
// throttled display advances game time far slower than wall clock and the
// round never finishes. Not a product bug -- the display is fullscreen and
// focused at a party -- but the test has to reproduce that.
await display.bringToFront();

const deckSize = await display.evaluate(() => /** @type {any} */ (globalThis).__platforms.game.questions.length);
assert(deckSize > 0, `question deck loaded (${deckSize} questions)`);

await display.keyboard.press('Enter');
await display.waitForFunction(
  () => /** @type {any} */ (globalThis).__platforms.game.phase === 'ANSWER',
  null,
  { timeout: 15000 }
);
ok('round started and reached ANSWER');

if (shots) {
  mkdirSync(path.join(root, 'state'), { recursive: true });
  await display.screenshot({ path: path.join(root, 'state/round-answer.png') });
}

// Put roughly two thirds of the room on the right answer, staggered in time so
// the speed bonus actually has something to differentiate.
const placed = await display.evaluate(() => {
  const { world, game } = /** @type {any} */ (globalThis).__platforms;
  const q = game.questions[game.qIndex];
  const plat = world.platforms.find((/** @type {any} */ p) => p.id === `ans${q.correct}`);
  const wrong = world.platforms.find((/** @type {any} */ p) => p.id?.startsWith('ans') && p !== plat);
  let i = 0;
  let onCorrect = 0;
  for (const p of world.players.values()) {
    const target = i % 3 === 2 ? wrong : plat;
    if (target === plat) onCorrect++;
    p.x = target.x + 20 + ((i * 37) % Math.max(1, target.w - 60));
    p.y = target.y - p.h;
    p.vx = 0;
    p.vy = 0;
    p.onGround = true;
    p.standingOn = target;
    i++;
  }
  return onCorrect;
});
assert(placed > 0, `${placed} players standing on the correct answer`);

await display.waitForFunction(
  () => /** @type {any} */ (globalThis).__platforms.game.phase === 'REVEAL',
  null,
  { timeout: 20000 }
);
ok('reached REVEAL');

const scored = await display.evaluate(() => {
  const g = /** @type {any} */ (globalThis).__platforms.game;
  const correct = g.results.filter((/** @type {any} */ r) => r.correct);
  return {
    correct: correct.length,
    wrong: g.results.length - correct.length,
    top: correct[0]?.points ?? 0,
    bottom: correct[correct.length - 1]?.points ?? 0,
    debris: g.debris.length,
  };
});
assert(scored.correct === placed, `${scored.correct} scored, ${scored.wrong} did not`);
assert(scored.top >= scored.bottom, `points ordered by arrival (${scored.top} .. ${scored.bottom})`);
assert(scored.debris > 0, `${scored.debris} wrong platforms crumbled`);

await display.waitForFunction(
  () => /** @type {any} */ (globalThis).__platforms.game.phase === 'SCORE',
  null,
  { timeout: 15000 }
);
await display.waitForTimeout(400);
ok('reached SCORE with a scoreboard');

if (shots) {
  await display.screenshot({ path: path.join(root, 'state/round-score.png') });
  await phonePage.screenshot({ path: path.join(root, 'state/smoke-phone.png') });
  ok('screenshots written to state/');
}

// ---------------------------------------------------------------- teardown

phone.close();
for (const b of bots) b.close();
await ctx.close();
await browser.close();
clearInterval(relay.watchdog);
for (const c of relay.wss.clients) c.terminate();
relay.wss.close();
server.closeAllConnections();
server.close();

if (problems.length) {
  console.error('\n  console/page errors:');
  for (const p of problems) console.error(`    ${p}`);
  process.exit(1);
}
console.log('\n  smoke test passed\n');
process.exit(0);

/**
 * First existing path from a list of shell-free globs (only `*` in one segment).
 * @param {string[]} patterns
 * @returns {string | undefined}
 */
function globSome(patterns) {
  for (const pattern of patterns) {
    const star = pattern.indexOf('*');
    if (star < 0) {
      if (existsSync(pattern)) return pattern;
      continue;
    }
    const slash = pattern.lastIndexOf('/', star);
    const dir = pattern.slice(0, slash);
    const seg = pattern.slice(slash + 1, pattern.indexOf('/', star));
    const rest = pattern.slice(pattern.indexOf('/', star));
    const re = new RegExp('^' + seg.split('*').map(escapeRe).join('.*') + '$');
    let entries = [];
    try {
      entries = readdirSync(dir).filter((e) => re.test(e)).sort();
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = dir + '/' + e + rest;
      if (existsSync(full)) return full;
    }
  }
  return undefined;
}

/** @param {string} s */
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** @param {string} msg */
function ok(msg) {
  console.log(`  \x1b[32mok\x1b[0m  ${msg}`);
}
/** @param {boolean} cond @param {string} msg */
function assert(cond, msg) {
  if (cond) return ok(msg);
  console.error(`  \x1b[31mFAIL\x1b[0m  ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

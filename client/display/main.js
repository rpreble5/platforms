/**
 * The display: authoritative for physics, and the renderer.
 *
 * The loop below is the shape the whole project is organised around.
 * Three details are load-bearing:
 *
 *   - ONE rAF callback. No separate timer, no earlier rAF, no work after
 *     render(). rAF fires immediately before paint, so this is as late as we
 *     can legally tick — every millisecond earlier is a millisecond of staleness.
 *   - drainInputQueue() runs INSIDE the fixed-step loop, not once per frame. A
 *     packet that lands mid-frame is consumed by the very next tick.
 *   - render() draws the latest tick directly. No interpolation buffer.
 */

import {
  CHECKPOINT_MS,
  MAX_FRAME_DT_MS,
  MAX_STEPS_PER_FRAME,
  PHYS,
  STEP_MS,
  TWEAKABLE,
} from '../../shared/tuning.js';
import { BTN_JUMP, BTN_LEFT, BTN_RIGHT, T_INPUT_FWD, T_JSON, encodeJson, decodeJson } from '../../shared/protocol.js';
import { encodeQR } from '../../shared/qr.js';
import { addPlayer, createWorld, removePlayer } from '../../sim/world.js';
import { FLOOR_Y, buildArena } from '../../sim/levels.js';
import { PHASE, answerWindow, createGame, currentQuestion, respawnAll, skip, startGame, stepRound } from '../../sim/round.js';
import { FB_LANDED_CORRECT, FB_LANDED_WRONG } from '../../shared/protocol.js';
import { SD_PHASE, createShowdown, currentStatement, sdSkip, stepShowdown } from '../../sim/showdown.js';
import { drawConfetti } from './fx.js';
import { drawRoundOverlay } from './round-ui.js';
import { drawShowdown } from './showdown-ui.js';
import { loadArt } from './art.js';
import { InputBus } from './input-bus.js';
import { render } from './render.js';
import { drawHud } from './hud.js';
import { LatencyFlash } from './latency-flash.js';

// ------------------------------------------------------------------ canvas

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('stage'));
const cx = /** @type {CanvasRenderingContext2D} */ (
  // `desynchronized` is a genuine low-latency hint (it can skip a compositor
  // buffer); `alpha:false` avoids a per-frame blend pass.
  canvas.getContext('2d', { alpha: false, desynchronized: true })
);
const boot = /** @type {HTMLElement} */ (document.getElementById('boot'));

// ------------------------------------------------------------------ state

const world = createWorld(buildArena(4));
const bus = new InputBus();
let game = createGame([]);
world.spawn = { x: 1920 / 2 - PHYS.PLAYER_W / 2, y: FLOOR_Y - PHYS.PLAYER_H - 4 };
let lastPhase = game.phase;
const flash = new LatencyFlash();

/** @type {Map<number, import('./render.js').Look>} */
const roster = new Map();
/** @type {Map<number, {rttP50:number, rttP95:number, loss:number}>} */
const net = new Map();

/** @type {number[]} */
const frameSamples = [];
let lastSteps = 0;
let joinUrl = '';
/** @type {{size:number, modules:Uint8Array[]} | null} */
let qr = null;

const hud = { detail: false, note: '' };
const tune = { on: false, index: 0 };

// The local keyboard player. Server ids start at 1, so 0 is always free.
// Being able to drive an avatar from the host keyboard makes it possible to
// tune feel and verify the loop with no phone in the room.
const LOCAL_ID = 0;
let localMask = 0;

// ------------------------------------------------------------------ socket

/** @type {WebSocket | null} */
let ws = null;
let backoff = 250;

function connect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}/ws?role=display`);
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    backoff = 250;
    boot.classList.add('hidden');
    send({ type: 'DISPLAY_HELLO' });
    send({ type: 'ROSTER_REQ' });
  };

  ws.onmessage = (ev) => {
    const bytes = new Uint8Array(ev.data);
    if (!bytes.length) return;

    if (bytes[0] === T_INPUT_FWD) {
      bus.onPacket(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength));
      return;
    }
    if (bytes[0] === T_JSON) {
      /** @type {any} */
      let msg;
      try {
        msg = decodeJson(bytes);
      } catch {
        return;
      }
      onJson(msg);
    }
  };

  ws.onclose = () => {
    boot.textContent = 'relay disconnected — reconnecting…';
    boot.classList.remove('hidden');
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 4000);
  };
  ws.onerror = () => ws?.close();
}

/** @param {unknown} obj */
function send(obj) {
  if (ws && ws.readyState === 1) ws.send(encodeJson(obj));
}

/** @param {any} msg */
function onJson(msg) {
  switch (msg.type) {
    case 'ROSTER': {
      /** @type {Set<number>} */
      const seen = new Set([LOCAL_ID]);
      for (const p of msg.players) {
        seen.add(p.id);
        roster.set(p.id, {
          name: p.name,
          color: p.color,
          hat: p.hat,
          pattern: p.pattern,
          cohortIndex: p.cohortIndex,
          cohortSet: p.cohortSet,
          connected: p.connected,
        });
        addPlayer(world, p.id);
      }
      // Players are only ever removed from the roster on a full refresh; a
      // disconnected player keeps their avatar (translucent) so they can rejoin
      // into the same body.
      for (const id of [...world.players.keys()]) {
        if (!seen.has(id)) {
          removePlayer(world, id);
          roster.delete(id);
          net.delete(id);
          bus.forget(id);
        }
      }
      break;
    }
    case 'NET_STATS':
      net.set(msg.playerId, { rttP50: msg.rttP50, rttP95: msg.rttP95, loss: msg.loss });
      break;
    case 'HOST_CMD':
      // The host phone's remote control, relayed by the server. Same verbs the
      // keyboard has — the display stays the only authority over the game.
      switch (msg.cmd) {
        case 'next':
          if (showdown) sdSkip(showdown, world);
          else if (game.phase === PHASE.LOBBY || game.phase === PHASE.GAME_OVER) startGame(game, world);
          else skip(game, world);
          break;
        case 'pause':
          if (showdown) showdown.paused = true;
          else game.paused = true;
          hud.note = 'PAUSED by host — press P or use the host page to resume';
          break;
        case 'resume':
          if (showdown) showdown.paused = false;
          else game.paused = false;
          hud.note = '';
          break;
        case 'restart':
          if (showdown) endShowdown();
          else startGame(game, world);
          break;
        case 'showdown':
          if (!showdown && (game.phase === PHASE.LOBBY || game.phase === PHASE.GAME_OVER)) {
            startShowdown();
          }
          break;
        case 'packnext':
          if (menuOpen()) void selectPack(menu.packIndex + 1);
          break;
        case 'timenext':
          if (menuOpen()) cycleTime(1);
          break;
        default:
          break;
      }
      lastCheckpoint = 0; // report the new state immediately, not in 500ms
      break;
    default:
      break;
  }
}

// ------------------------------------------------------------------ menu

/**
 * The lobby menu. It's an overlay, not a mode: the world keeps simulating and
 * phones keep joining underneath it the whole time — warming up in the arena
 * IS the lobby experience.
 */
const menu = {
  /** @type {Array<{file:string, name:string, questions:number, showdown:boolean}>} */
  packs: [],
  packIndex: 0,
  // The cursor starts on "Start quiz" (row 2), so a plain Enter in the lobby
  // still does what it has always done — including for the smoke test.
  sel: 2,
  loading: false,
};

/** Menu rows, in display order. Showdown appears only when the pack has one. */
function menuItems() {
  /** @type {Array<'pack'|'time'|'quiz'|'showdown'>} */
  const items = ['pack', 'time', 'quiz'];
  if (showdownSpec) items.push('showdown');
  // Switching to a pack without a showdown can strand the cursor one row past
  // the end; pull it back rather than crash the key handler.
  if (menu.sel >= items.length) menu.sel = items.length - 1;
  return items;
}

function menuOpen() {
  return !showdown && game.phase === PHASE.LOBBY;
}

/**
 * Load a pack by index into the live game. Only ever called in the lobby,
 * where scores are empty and losing the Game object costs nothing.
 * @param {number} index
 */
async function selectPack(index) {
  if (!menu.packs.length) return;
  menu.packIndex = ((index % menu.packs.length) + menu.packs.length) % menu.packs.length;
  menu.loading = true;
  try {
    const file = menu.packs[menu.packIndex].file;
    const pack = await fetch(`/api/questions?pack=${encodeURIComponent(file)}`).then((r) => r.json());
    if (pack?.questions?.length) {
      game = createGame(pack.questions, pack.answerMs);
      showdownSpec = pack.showdown?.statements?.length ? pack.showdown : null;
      hud.note = '';
    } else {
      hud.note = `${file}: no valid questions`;
    }
  } catch {
    hud.note = 'could not load pack';
  }
  menu.loading = false;
  lastCheckpoint = 0;
}

/** The answer-time setting cycles through party-sensible windows. */
const TIME_STEPS = [8000, 12000, 15000, 20000];

/** @param {number} dir */
function cycleTime(dir) {
  const i = TIME_STEPS.findIndex((t) => t >= game.answerMs - 1);
  const at = i === -1 ? 1 : i;
  game.answerMs = TIME_STEPS[(at + dir + TIME_STEPS.length) % TIME_STEPS.length];
  lastCheckpoint = 0;
}

/** @param {'pack'|'time'|'quiz'|'showdown'} item @param {number} dir */
function menuAdjust(item, dir) {
  if (item === 'pack') void selectPack(menu.packIndex + dir);
  else if (item === 'time') cycleTime(dir);
}

/** @param {'pack'|'time'|'quiz'|'showdown'} item */
function menuActivate(item) {
  if (item === 'quiz') startGame(game, world);
  else if (item === 'showdown') startShowdown();
  else menuAdjust(item, 1);
}

// ------------------------------------------------------------------ showdown

/** @type {import('../../sim/showdown.js').Showdown | null} */
let showdown = null;
/** @type {{statements: {text:string, answer:boolean}[], answerMs?: number} | null} */
let showdownSpec = null;

function startShowdown() {
  if (!showdownSpec) {
    hud.note = 'no showdown block in questions/default.json';
    return;
  }
  // The keyboard test player sits out: an idle avatar that survives on luck
  // could win the whole thing, and the victor screen isn't for the laptop.
  showdown = createShowdown(
    showdownSpec,
    world,
    [...world.players.keys()].filter((id) => id !== LOCAL_ID)
  );
  hud.note = '';
}

function endShowdown() {
  showdown = null;
  world.platforms = buildArena(4);
  respawnAll(world);
  game.phase = PHASE.LOBBY;
  game.phaseT = 0;
}

// ------------------------------------------------------------------ the loop

let last = performance.now();
let acc = 0;
let lastCheckpoint = 0;

/** @param {number} now */
function frame(now) {
  requestAnimationFrame(frame);
  const t0 = performance.now();

  // Clamped so a tab restore cannot make us try to catch up 30 seconds of sim.
  acc += Math.min(now - last, MAX_FRAME_DT_MS);
  last = now;

  let steps = 0;
  while (acc >= STEP_MS && steps < MAX_STEPS_PER_FRAME) {
    // Always drain, so nothing accumulates in the bus during a freeze and
    // discharges all at once when the next question opens. stepRound decides
    // whether the drained input actually reaches the simulation.
    bus.applyMask(LOCAL_ID, localMask);
    bus.drainInto(world);
    flash.observe(world);
    if (showdown) stepShowdown(showdown, world, STEP_MS);
    else stepRound(game, world, STEP_MS);
    acc -= STEP_MS;
    steps++;
  }
  if (showdown?.phase === SD_PHASE.DONE) endShowdown();
  lastSteps = steps;

  if (game.phase !== lastPhase) {
    if (game.phase === PHASE.REVEAL) {
      for (const r of game.results) {
        if (r.id === LOCAL_ID) continue;
        send({
          type: 'FEEDBACK_REQ',
          playerId: r.id,
          code: r.correct ? FB_LANDED_CORRECT : FB_LANDED_WRONG,
        });
      }
    }
    lastPhase = game.phase;
  }

  render(cx, world, roster, game, {
    qr: game.phase === PHASE.LOBBY && !showdown ? qr : null,
    joinUrl,
  });
  if (!showdown) drawConfetti(cx, game, world);
  flash.draw(cx);
  if (showdown) drawShowdown(cx, showdown, world, roster);
  else drawRoundOverlay(cx, game, roster, world.players.size, menuOpen() ? { ...menu, items: menuItems(), answerMs: game.answerMs } : null);
  drawHud(cx, {
    bus,
    roster,
    net,
    frameSamples,
    steps: lastSteps,
    players: world.players.size,
    detail: hud.detail,
    note: hud.note,
  });
  if (tune.on) drawTuner(cx);

  const dur = performance.now() - t0;
  frameSamples.push(dur);
  if (frameSamples.length > 240) frameSamples.shift();

  if (now - lastCheckpoint >= CHECKPOINT_MS) {
    lastCheckpoint = now;
    send({
      type: 'CHECKPOINT',
      state: showdown
        ? {
            tick: world.tick,
            players: world.players.size,
            phase: `SHOWDOWN · ${showdown.phase}`,
            qIndex: showdown.index,
            qCount: showdown.statements.length,
            text: currentStatement(showdown)?.text ?? null,
            paused: showdown.paused,
            alive: showdown.alive.size,
            canShowdown: false,
            answerLeftMs:
              showdown.phase === SD_PHASE.ANSWER
                ? Math.max(0, showdown.answerMs - showdown.phaseT)
                : null,
          }
        : {
            tick: world.tick,
            players: world.players.size,
            phase: game.phase,
            qIndex: game.qIndex,
            qCount: game.questions.length,
            text: currentQuestion(game)?.text ?? null,
            paused: game.paused,
            canShowdown:
              !!showdownSpec &&
              (game.phase === PHASE.LOBBY || game.phase === PHASE.GAME_OVER),
            menu:
              game.phase === PHASE.LOBBY && menu.packs.length
                ? {
                    packs: menu.packs.map((p) => p.name),
                    packIndex: menu.packIndex,
                    answerMs: game.answerMs,
                  }
                : null,
            answerLeftMs:
              game.phase === PHASE.ANSWER ? Math.max(0, answerWindow(game) - game.phaseT) : null,
            scores: Object.fromEntries(game.scores),
          },
    });
  }
}

// ------------------------------------------------------------------ keyboard

/** @param {KeyboardEvent} e @param {boolean} down */
function onKey(e, down) {
  const k = e.key.toLowerCase();

  if (down && !e.repeat) {
    if (k === 'h') {
      hud.detail = !hud.detail;
      return;
    }
    if (k === 't') {
      tune.on = !tune.on;
      return;
    }
    if (k === 'f') {
      flash.enabled = !flash.enabled;
      hud.note = flash.enabled ? 'flash target armed (bottom right)' : '';
      return;
    }
    if (tune.on && k === 'p') {
      printTuning();
      return;
    }
    if (k === 'enter') {
      if (showdown) sdSkip(showdown, world);
      else if (menuOpen()) menuActivate(menuItems()[menu.sel]);
      else if (game.phase === PHASE.GAME_OVER) startGame(game, world);
      else skip(game, world);
      e.preventDefault();
      return;
    }
    // In the lobby the arrow keys belong to the menu; the test avatar keeps
    // A/D/space. Everywhere else arrows stay on the avatar.
    if (menuOpen() && (k === 'arrowup' || k === 'arrowdown' || k === 'arrowleft' || k === 'arrowright') && !tune.on) {
      const items = menuItems();
      if (k === 'arrowup') menu.sel = (menu.sel + items.length - 1) % items.length;
      else if (k === 'arrowdown') menu.sel = (menu.sel + 1) % items.length;
      else menuAdjust(items[menu.sel], k === 'arrowright' ? 1 : -1);
      e.preventDefault();
      return;
    }
    if (k === 'p') {
      if (showdown) {
        showdown.paused = !showdown.paused;
        hud.note = showdown.paused ? 'PAUSED — press P to resume' : '';
      } else {
        game.paused = !game.paused;
        hud.note = game.paused ? 'PAUSED — press P to resume' : '';
      }
      return;
    }
    if (k === 'r') {
      if (showdown) endShowdown();
      else startGame(game, world);
      return;
    }
    if (k === 's' && !showdown && (game.phase === PHASE.LOBBY || game.phase === PHASE.GAME_OVER)) {
      startShowdown();
      return;
    }
  }

  if (tune.on && down) {
    const stepDir = k === 'arrowup' ? 1 : k === 'arrowdown' ? -1 : 0;
    if (stepDir) {
      const [name, delta] = TWEAKABLE[tune.index];
      const next = round6(/** @type {any} */ (PHYS)[name] + delta * stepDir * (e.shiftKey ? 5 : 1));
      /** @type {any} */ (PHYS)[name] = Math.max(0, next);
      e.preventDefault();
      return;
    }
    if (k === 'arrowleft' || k === 'arrowright') {
      tune.index =
        (tune.index + (k === 'arrowright' ? 1 : TWEAKABLE.length - 1)) % TWEAKABLE.length;
      e.preventDefault();
      return;
    }
  }

  // Local test player.
  let bit = 0;
  if (k === 'a' || k === 'arrowleft') bit = BTN_LEFT;
  else if (k === 'd' || k === 'arrowright') bit = BTN_RIGHT;
  else if (k === ' ' || k === 'w' || k === 'arrowup') bit = BTN_JUMP;
  if (!bit) return;
  e.preventDefault();
  localMask = down ? localMask | bit : localMask & ~bit;
}

addEventListener('keydown', (e) => onKey(e, true));
addEventListener('keyup', (e) => onKey(e, false));
// A window that loses focus must release, or the avatar runs forever.
addEventListener('blur', () => {
  localMask = 0;
});

function printTuning() {
  const lines = TWEAKABLE.map(([name]) => `  ${name}: ${/** @type {any} */ (PHYS)[name]},`);
  // eslint-disable-next-line no-console
  console.log(`export const PHYS = {\n${lines.join('\n')}\n  // ...unchanged fields omitted\n};`);
  hud.note = 'tuning printed to console';
  setTimeout(() => (hud.note = ''), 2500);
}

/** @param {CanvasRenderingContext2D} c */
function drawTuner(c) {
  const w = 380;
  const h = 34 + TWEAKABLE.length * 24 + 30;
  const x = 1920 - w - 24;
  const y = 24;
  c.fillStyle = 'rgba(8,11,18,0.9)';
  c.beginPath();
  c.roundRect(x, y, w, h, 12);
  c.fill();
  c.strokeStyle = 'rgba(90,104,130,0.4)';
  c.stroke();

  c.font = '700 15px ui-monospace, SFMono-Regular, Menlo, monospace';
  c.fillStyle = '#ffd93d';
  c.fillText('TUNING  ←→ pick  ↑↓ adjust  P print', x + 16, y + 26);

  c.font = '500 14px ui-monospace, SFMono-Regular, Menlo, monospace';
  let ry = y + 52;
  TWEAKABLE.forEach(([name], i) => {
    const active = i === tune.index;
    c.fillStyle = active ? '#ffffff' : '#7c879b';
    c.fillText(`${active ? '▸' : ' '} ${name}`, x + 16, ry);
    c.textAlign = 'right';
    c.fillText(String(/** @type {any} */ (PHYS)[name]), x + w - 16, ry);
    c.textAlign = 'left';
    ry += 24;
  });
  c.fillStyle = '#5a6478';
  c.fillText('tune this over real WiFi, not localhost', x + 16, ry + 6);
}

/** @param {number} n @returns {number} */
function round6(n) {
  return Math.round(n * 1e6) / 1e6;
}

// ------------------------------------------------------------------ boot

async function init() {
  // Sprites and fonts BEFORE the first frame. The label cache measures text on
  // first use and keeps the result forever, so a font that arrives late would
  // leave every name rendered in the fallback face.
  const [artResult] = await Promise.all([
    loadArt(),
    // Explicitly kick the load: document.fonts.ready only awaits faces that
    // have already started loading, and a declared-but-unused @font-face
    // never starts. Without this it resolves instantly and every cached label
    // is measured in the fallback.
    document.fonts
      .load('800 40px PlatformsDisplay')
      .then(() => document.fonts.ready)
      .catch(() => undefined),
  ]);
  if (artResult.missing.length) {
    hud.note = `drawing ${artResult.missing.join(', ')} procedurally — see docs/ART-SPEC.md`;
  }

  addPlayer(world, LOCAL_ID);
  roster.set(LOCAL_ID, { name: 'keyboard', color: '#e8e2d4', hat: 'none', connected: true });

  try {
    const pack = await fetch('/api/questions').then((r) => r.json());
    if (pack?.questions?.length) game = createGame(pack.questions, pack.answerMs);
    else hud.note = 'no questions loaded — check questions/default.json';
    if (pack?.showdown?.statements?.length) showdownSpec = pack.showdown;
    const packs = await fetch('/api/packs').then((r) => r.json());
    if (Array.isArray(packs) && packs.length) {
      menu.packs = packs;
      menu.packIndex = Math.max(0, packs.findIndex((/** @type {any} */ p) => p.file === pack?.file));
    }
  } catch {
    hud.note = 'could not load questions';
  }

  try {
    const health = await fetch('/api/health').then((r) => r.json());
    if (health.joinUrl) {
      joinUrl = health.joinUrl;
      qr = encodeQR(joinUrl);
    }
  } catch {
    /* the QR is a convenience; the loop must start regardless */
  }

  // The display is served from localhost, which IS a secure context even over
  // plain HTTP — so unlike the phones, it gets wakeLock for free.
  try {
    // @ts-ignore - not in older lib.dom
    await navigator.wakeLock?.request('screen');
  } catch {
    /* not fatal */
  }

  // Debug handle. Useful from the console at the venue ("why is player 7 not
  // moving?") and used by the browser smoke test.
  Object.assign(globalThis, {
    __platforms: {
      world, bus, roster, net, PHYS, flash,
      get game() { return game; },
      get showdown() { return showdown; },
    },
  });

  connect();
  requestAnimationFrame(frame);
}

init();

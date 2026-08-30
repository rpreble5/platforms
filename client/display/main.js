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
import { clampCohort } from '../../shared/palette.js';
import { PACK_THEMES } from '../../shared/pack-validate.js';
import { encodeQR } from '../../shared/qr.js';
import { addPlayer, createWorld, removePlayer } from '../../sim/world.js';
import { FLOOR_Y, buildLobbyArena } from '../../sim/levels.js';
import {
  PHASE,
  activeControlTeam,
  answerWindow,
  buildQuestionSchedule,
  configureControlRounds,
  createGame,
  currentQuestion,
  isControlQuestion,
  isSortQuestion,
  respawnAll,
  skip,
  startGame,
  stepRound,
  targetIds,
} from '../../sim/round.js';
import { FB_LANDED_CORRECT, FB_LANDED_WRONG } from '../../shared/protocol.js';
import { SD_PHASE, createShowdown, currentStatement, sdSkip, stepShowdown } from '../../sim/showdown.js';
import { setRound, setTheme } from './themes.js';
import { cycleVoice, tickAudio, toggleMuted, unlockAudio } from './audio.js';
import { deferRevealBurst, drawConfetti, revealBurst } from './fx.js';
import { drawRoundOverlay, menuPlatforms } from './round-ui.js';
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

const world = createWorld(buildLobbyArena());
// The lobby menu's cards are furniture: their roofs are one-way platforms,
// so beans can stand on the menu. Rounds rebuild the arena from the
// question, which drops the furniture for the duration of play.
world.platforms.push(...menuPlatforms());
const bus = new InputBus();
let game = createGame([]);
world.spawn = { x: 1920 / 2 - PHYS.PLAYER_W / 2, y: FLOOR_Y - PHYS.PLAYER_H - 4 };
let lastPhase = game.phase;
/** Which sort item's flash already buzzed the phones, as `qIndex:itemIndex`. */
let lastItemKey = '';
const flash = new LatencyFlash();

/**
 * Designed levels from levels/*.json, via /api/levels. Kept in a module var
 * so pack changes (which replace `game`) don't lose the pool, and refreshed
 * at idle moments so a save in the /levels editor is picked up by the next
 * game without reloading the display.
 * @type {import('../../sim/levels.js').LevelSpec[]}
 */
let levelPool = [];
async function refreshLevels() {
  try {
    const list = await fetch('/api/levels').then((r) => r.json());
    if (Array.isArray(list)) {
      levelPool = list;
      game.levelPool = levelPool;
    }
  } catch {
    // keep whatever we had — an empty pool just means shipped layouts
  }
}

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

// The latency HUD is a dev/tuning tool, hidden by default — H cycles
// hidden → panel → panel + per-player detail. Transient notes (pause, mute,
// voicing) draw their own pill even while the HUD is hidden.
const hud = { mode: 0, note: '' };
const tune = { on: false, index: 0 };

/** @type {ReturnType<typeof setTimeout> | undefined} */
let noteTimer;
/** A transient HUD message that clears itself. @param {string} text */
function note(text) {
  hud.note = text;
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => (hud.note = ''), 2200);
}

// The local keyboard player. Server ids start at 1, so 0 is always free.
// Being able to drive an avatar from the host keyboard makes it possible to
// tune feel and verify the loop with no phone in the room.
const LOCAL_ID = 0;
let localMask = 0;

// Off by default: at a real party a bean labelled "keyboard" standing in
// the crowd is just clutter. K summons it for the dev loop (tuning feel,
// verifying the round with no phone in the room) and removes it again.
// Purely display-local — the server roster never contains id 0.
let keyboardOn = false;

function toggleKeyboardPlayer() {
  keyboardOn = !keyboardOn;
  if (keyboardOn) {
    addPlayer(world, LOCAL_ID);
    roster.set(LOCAL_ID, { name: 'keyboard', color: '#e8e2d4', finish: 'flat', connected: true });
    note('keyboard player added — K to remove');
  } else {
    localMask = 0;
    bus.forget(LOCAL_ID);
    removePlayer(world, LOCAL_ID);
    roster.delete(LOCAL_ID);
    note('keyboard player removed — K to bring it back');
  }
}

// ------------------------------------------------------------------ socket

/** @type {WebSocket | null} */
let ws = null;
let backoff = 250;
/** Consecutive sockets that died without EVER opening. Ordinary drops reset
 *  this; only a handshake that never completes counts. */
let neverOpened = 0;

/**
 * The socket refuses to open but the page itself loaded — so HTTPS works and
 * something between this browser and the server is eating the WebSocket
 * upgrade (hospital/corporate TLS inspection does this routinely). Confirm
 * with a plain fetch and say WHICH half is broken, instead of spinning on
 * "connecting" forever.
 */
async function diagnoseStuckBoot() {
  try {
    const r = await fetch('/api/health');
    if (r.ok) {
      boot.textContent =
        'the server is fine, but this network is blocking live connections (WebSockets) — try another WiFi or a phone hotspot';
      return;
    }
  } catch { /* fall through: the server itself is unreachable */ }
  boot.textContent = 'server unreachable — if it just woke up, give it a minute. retrying…';
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}/ws?role=display`);
  ws.binaryType = 'arraybuffer';
  let opened = false;

  ws.onopen = () => {
    opened = true;
    neverOpened = 0;
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
    if (!opened && ++neverOpened >= 3) void diagnoseStuckBoot();
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
          finish: p.finish,
          accessory: p.accessory,
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
          else if (game.phase === PHASE.LOBBY) startConfiguredGame(false);
          else if (game.phase === PHASE.GAME_OVER) startGame(game, world);
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
        case 'hold':
          holdPref = !holdPref;
          game.holdAfterReveal = holdPref;
          note(holdPref
            ? 'host-paced: each scoreboard holds until Next'
            : 'auto-advance restored');
          break;
        case 'restart':
          if (showdown) endShowdown();
          else if (game.phase === PHASE.LOBBY) startConfiguredGame(false);
          else startGame(game, world);
          break;
        case 'menu':
          toMenu();
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
/** Host-paced rounds: hold each scoreboard until Next. Toggled from the
 *  host phone (HOST_CMD 'hold') or the H key; reapplied by applyMode. */
let holdPref = false;

const menu = {
  /** @type {Array<{file:string, name:string, questions:number, mode?:'solo'|'teams', showdown:boolean, controlRoom?:number}>} */
  packs: [],
  packIndex: 0,
  // The lobby opens on its first question with the first answer highlighted.
  sel: 0,
  loading: false,
  /** @type {'solo'|'teams'} */
  mode: 'solo',
  // The host's background override: 'deck' plays the pack's theme; any
  // other value pins the room's look regardless of what packs say.
  look: 'deck',
  /** The row the pointer is over, for hover feedback. @type {string|null} */
  hover: null,
  /** Which mode's shelf the deck card is paging through. A filter, not a
   *  second owner of the mode: it only ever offers decks written for that
   *  mode, and the deck that loads still decides how the night is played.
   *  @type {'solo'|'teams'} */
  browse: 'solo',
  /** The deck you were last on in each mode, so switching the segment back
   *  returns you where you were instead of to the top of the shelf.
   *  @type {{solo: string|null, teams: string|null}} */
  lastIn: { solo: null, teams: null },
  // The dev-tools tab: the full key list, folded away until clicked.
  dev: false,
  /** Landing squash per furniture id, 0..1 — set by trackMenuLandings when
   *  a bean lands on a menu:* roof, decayed every frame. Pure fun: nothing
   *  here changes state. @type {Record<string, number>} */
  fx: {},
};

/**
 * Click targets for the lobby card, refilled by the renderer every frame.
 * The draw owns the geometry and writes it here, so a moved button can
 * never leave its hit box behind.
 * @type {Array<{id: string, x: number, y: number, w: number, h: number}>}
 */
const menuHits = [];

/** What each player stood on last frame, to tell a landing from standing. */
const stoodOn = new Map();

/** A fresh landing on a menu:* roof squashes that furniture (menu.fx). */
function trackMenuLandings() {
  if (!menuOpen()) {
    if (stoodOn.size) stoodOn.clear();
    return;
  }
  for (const [pid, pl] of world.players) {
    const on = pl.standingOn?.id ?? null;
    if (on && on.startsWith('menu:') && stoodOn.get(pid) !== on) menu.fx[on] = 1;
    if (on) stoodOn.set(pid, on);
    else stoodOn.delete(pid);
  }
  for (const k of Object.keys(menu.fx)) {
    menu.fx[k] *= 0.86;
    if (menu.fx[k] < 0.02) delete menu.fx[k];
  }
}

// ------------------------------------------------------ the reveal bounce
//
// REVEAL is two beats. Beat one, on entry: the wrong boards crumble and the
// phones buzz — the verdict, given room to read. Beat two, ~600ms later:
// the correct board crouches, springs, and at the exact apex three things
// happen on the same frame — the riders are released with an upward kick,
// and the confetti bursts (deferred from the auto-fire in fx.js). The toss
// IS the apex; nothing celebratory happens before it.
//
// The board is a real platform, so the hop runs in the sim: while crouching
// and rising it works as an elevator (feet re-pinned to the moving top each
// frame, because the one-way landing check refuses feet already below the
// surface), and after the release ordinary physics brings everyone back
// down onto the settled board. Scores can't change — results froze at LOCK.
//
// No riders → no hop and no deferral: a board celebrating an empty room
// reads wrong, and the auto-fire path stays correct (nobody aboard means
// nobody scored, so it stays quiet too). Sort rounds keep their per-item
// confetti, range rounds have no board to hop, control turns run on their
// own stage.

/** @typedef {import('../../sim/collide.js').Platform} Platform */
/** @typedef {import('../../sim/player.js').Player} Player */

const HOP_DELAY_MS = 600; // beat one: let the crumble read first
const CROUCH_MS = 120;
const CROUCH_PX = 7;
const RISE_MS = 180;
const FALL_MS = 350;
const HOP_PX = 26;
const HOP_KICK = 540; // px/s up at release — a clear pop, about half a jump

/** @type {{plats: Array<{plat: Platform, base: number}>, riders: Map<Player, Platform>, t0: number, kicked: boolean} | null} */
let hop = null;

/** Arm the hop on the frame the game enters REVEAL. */
function startRevealHop() {
  const q = currentQuestion(game);
  if (!q || isSortQuestion(q) || isControlQuestion(q)) return;
  const ids = targetIds(q);
  const plats = world.platforms
    .filter((p) => p.id?.startsWith('ans') && ids.has(p.id))
    .map((plat) => ({ plat, base: plat.y }));
  if (!plats.length) return;
  /** @type {Map<Player, Platform>} */
  const riders = new Map();
  for (const pl of world.players.values()) {
    if (pl.standingOn && plats.some((e) => e.plat === pl.standingOn)) {
      riders.set(pl, pl.standingOn);
    }
  }
  if (!riders.size) return;
  hop = { plats, riders, t0: world.t, kicked: false };
  deferRevealBurst(game.qIndex);
}

/** One frame of the hop; restores the exact base y when done or cut short. */
function tickRevealHop() {
  if (!hop) return;
  const t = world.t - hop.t0 - HOP_DELAY_MS;
  if (game.phase !== PHASE.REVEAL || t >= CROUCH_MS + RISE_MS + FALL_MS) {
    for (const e of hop.plats) e.plat.y = e.base;
    // A skip mid-choreography must not eat the party the deferral promised.
    if (!hop.kicked) revealBurst(game, world);
    hop = null;
    return;
  }
  if (t < 0) return; // beat one: boards falling, nothing moves here yet

  let lift; // px above base; negative is the crouch
  if (t < CROUCH_MS) {
    // Ease down into the crouch and hold at the bottom — the gather.
    lift = -CROUCH_PX * Math.sin(((Math.PI / 2) * t) / CROUCH_MS);
  } else if (t < CROUCH_MS + RISE_MS) {
    // Spring: crouch bottom to full height, decelerating into the apex.
    const u = (t - CROUCH_MS) / RISE_MS;
    lift = -CROUCH_PX + (HOP_PX + CROUCH_PX) * Math.sin((Math.PI / 2) * u);
  } else {
    // Past the apex: fall away with acceleration. The riders are already
    // airborne, so the widening gap under them is what sells the toss.
    const u = (t - CROUCH_MS - RISE_MS) / FALL_MS;
    lift = HOP_PX * (1 - u * u);
  }
  for (const e of hop.plats) e.plat.y = e.base - lift;

  if (t < CROUCH_MS + RISE_MS) {
    // Crouching or rising: adopt any late lander, then re-pin every rider's
    // feet to the moving top BEFORE the next physics step sees it.
    for (const pl of world.players.values()) {
      if (pl.standingOn && !hop.riders.has(pl) && hop.plats.some((e) => e.plat === pl.standingOn)) {
        hop.riders.set(pl, pl.standingOn);
      }
    }
    for (const [p, plat] of hop.riders) {
      p.y = plat.y - p.h;
      p.vy = 0;
      p.onGround = true;
      p.standingOn = plat;
    }
  } else if (!hop.kicked) {
    // THE apex frame: release with a flick and burst the confetti — toss,
    // full height and party on the same frame. Regular physics from here.
    hop.kicked = true;
    for (const [p] of hop.riders) {
      p.vy = -HOP_KICK;
      p.onGround = false;
      p.standingOn = null;
    }
    hop.riders.clear();
    revealBurst(game, world);
  }
}

/** The Background row's cycle: the deck's own theme, then every pack theme
 *  ('glass' is skipped — it is just an alias for blanc). */
const LOOKS = ['deck', ...PACK_THEMES.filter((t) => t !== 'glass')];

/** The loaded pack's theme, kept so "from deck" can win again later. */
/** @type {string | undefined} */
let deckTheme;

/** The one place the display's theme is decided: override beats deck. */
function applyTheme() {
  setTheme(menu.look === 'deck' ? deckTheme : menu.look);
}

/** The decks written for one mode, in library order. @param {'solo'|'teams'} mode */
function decksFor(mode) {
  return menu.packs.filter((p) => (p.mode ?? 'solo') === mode);
}

/** The shelf on the deck card: the decks of the mode being browsed. */
function shelf() {
  return decksFor(menu.browse);
}

/** Where the loaded deck sits on its shelf (0 when it is not on this one). */
function shelfIndex() {
  const file = menu.packs[menu.packIndex]?.file;
  return Math.max(0, shelf().findIndex((p) => p.file === file));
}

/**
 * The rows the cursor moves through, fixed however big the library gets:
 * the mode segment, the deck card, the two settings, then Start last — so
 * one ArrowUp from the top still reaches Start in a single press.
 *
 * Every row answers ◂ ▸ the same way (flip the mode, page the deck, cycle
 * the setting), which is what lets one menuAdjust handle all of them.
 * Control Room and Showdown are absent: both still parse, validate and
 * play, but neither is authored or offered any more.
 * @returns {string[]}
 */
function menuItems() {
  const items = ['mode', 'deck', 'look', 'quiz'];
  if (menu.sel >= items.length) menu.sel = items.length - 1;
  if (menu.sel < 0) menu.sel = 0;
  return items;
}

/**
 * Why Start cannot be pressed, or null when it can.
 *
 * A teams deck with nobody on a team plays every team mechanic as a no-op —
 * no coverage bonus, no team scoring — and looks fine while doing it. That
 * is worth blocking with the reason rather than discovering mid-round.
 * @returns {string|null}
 */
function startBlocked() {
  const pack = menu.packs[menu.packIndex];
  if (!pack) return 'no decks in questions/';
  if ((pack.mode ?? 'solo') !== 'teams') return null;
  return participatingTeams().length
    ? null
    : 'nobody has picked a PGY year yet — teams need at least one';
}

/**
 * Team index for the sim's scoring: the player's committed training year.
 * Uncommitted players (and the keyboard avatar) are -1 — never on a team.
 * @param {number} id
 */
function cohortOf(id) {
  const look = roster.get(id);
  return look?.cohortSet ? clampCohort(look.cohortIndex ?? -1) : -1;
}

/** Push the menu's mode choice (and the team lookup) onto the live game. */
function applyMode() {
  game.mode = menu.mode;
  game.cohortOf = cohortOf;
  // The emcee-pacing choice survives pack switches and restarts: applyMode
  // runs after every createGame.
  game.holdAfterReveal = holdPref;
}

/** Teams represented by at least one connected, committed phone at game start. */
function participatingTeams() {
  return [...new Set(
    [...roster.entries()]
      .filter(([, look]) => look.connected && look.cohortSet)
      .map(([id]) => cohortOf(id))
      .filter((team) => team >= 0)
  )].sort((a, b) => a - b);
}

/** @param {boolean} controlOnly */
function startConfiguredGame(controlOnly) {
  if (controlOnly) menu.mode = 'teams';
  applyMode();
  game.activeTeams = participatingTeams();
  configureControlRounds(game, {
    questions: controlSpec?.questions ?? [],
    perTeam: controlOnly || game.mode === 'teams' ? controlSpec?.perTeam ?? 0 : 0,
    only: controlOnly,
  });
  if (controlOnly) {
    if (!game.activeTeams.length) {
      note('Control Room needs at least one committed team');
      return;
    }
    // A pool smaller than the team count schedules zero full rounds, and a
    // zero-question game slams straight into the final-standings panel with
    // no explanation. Refuse with the reason instead.
    const turns = buildQuestionSchedule(
      [], game.controlPool, game.activeTeams, game.controlPerTeam, true, 0
    ).length;
    if (!turns) {
      note(`Control Room needs ${game.activeTeams.length} case${game.activeTeams.length === 1 ? '' : 's'} for ${game.activeTeams.length} team${game.activeTeams.length === 1 ? '' : 's'} — this pack has ${game.controlPool.length}`);
      return;
    }
  }
  startGame(game, world);
}

function menuOpen() {
  return !showdown && game.phase === PHASE.LOBBY;
}

/**
 * Everything the lobby screen draws from, computed fresh each frame: the
 * cohort headcount makes team readiness visible BEFORE anyone presses start,
 * and the start buttons carry their own disable reasons instead of erroring
 * after the press.
 * @returns {import('./round-ui.js').MenuView}
 */
function menuView() {
  const cohortCounts = [0, 0, 0];
  for (const [id, look] of roster) {
    if (look.connected && look.cohortSet) {
      const c = cohortOf(id);
      if (c >= 0) cohortCounts[c]++;
    }
  }
  return {
    ...menu,
    items: menuItems(),
    answerMs: game.answerMs,
    cohortCounts,
    controlCases: controlSpec?.questions.length ?? 0,
    deckTheme,
    hits: menuHits,
    startBlocked: startBlocked(),
  };
}

/** Bumped by every selectPack; a slower earlier fetch drops its result. */
let packSeq = 0;

/**
 * Load a pack by index into the live game. Only ever called in the lobby,
 * where scores are empty and losing the Game object costs nothing.
 *
 * Paging the deck card fires one of these per press, so a fast run through
 * the shelf has several in flight at once. The index moves immediately —
 * the card must never lag the arrow — and a response is applied only if no
 * later request has started since, or a slow early fetch would land on top
 * of the deck the host actually stopped on.
 * @param {number} index
 */
async function selectPack(index) {
  if (!menu.packs.length) return;
  menu.packIndex = ((index % menu.packs.length) + menu.packs.length) % menu.packs.length;
  const file = menu.packs[menu.packIndex].file;
  const deckMode = (menu.packs[menu.packIndex].mode ?? 'solo') === 'teams' ? 'teams' : 'solo';
  menu.lastIn[deckMode] = file;
  // Whoever picked the deck — a tab, a row, the host phone's Pack button —
  // the tabs follow it: the shelf on screen always holds the loaded deck.
  menu.browse = deckMode;
  const seq = ++packSeq;
  menu.loading = true;
  try {
    const pack = await fetch(`/api/questions?pack=${encodeURIComponent(file)}`).then((r) => r.json());
    if (seq !== packSeq) return; // a later deck was asked for; this one is stale
    if (pack?.questions?.length || pack?.controlRoom?.questions?.length) {
      game = createGame(pack.questions ?? [], pack.answerMs);
      game.levelPool = levelPool;
      // The deck carries the mode; loading one is how the mode is chosen.
      menu.mode = pack.mode === 'teams' ? 'teams' : 'solo';
      applyMode();
      showdownSpec = pack.showdown?.statements?.length ? pack.showdown : null;
      controlSpec = pack.controlRoom?.questions?.length ? pack.controlRoom : null;
      deckTheme = pack.theme;
      applyTheme();
      hud.note = '';
    } else {
      hud.note = `${file}: no valid questions`;
    }
  } catch {
    if (seq === packSeq) hud.note = 'could not load pack';
  }
  if (seq !== packSeq) return;
  menu.loading = false;
  lastCheckpoint = 0;
}

/**
 * Page the deck card. Wrapping is the point: with a long shelf, ◂ from the
 * first deck is the shortest way to the last one.
 * @param {number} dir
 */
function pageDeck(dir) {
  const list = shelf();
  if (list.length < 2) return;
  const next = list[(shelfIndex() + dir + list.length) % list.length];
  void selectPack(menu.packs.indexOf(next));
}

/**
 * Show a mode's shelf, and load the deck the host was last on there (or its
 * first). A mode with no decks is not offered — switching to it would leave
 * the card empty and Start pointing at a deck that is no longer on screen.
 * @param {'solo'|'teams'} mode
 */
function browseMode(mode) {
  const list = decksFor(mode);
  if (!list.length || menu.browse === mode) return;
  menu.browse = mode;
  const back = list.find((p) => p.file === menu.lastIn[mode]) ?? list[0];
  void selectPack(menu.packs.indexOf(back));
}

/** Answer-time steps for the HOST PHONE's 'timenext' command — the lobby
 *  itself no longer shows the setting; decks carry their own default. */
const TIME_STEPS = [8000, 12000, 15000, 20000];

/** @param {number} dir */
function cycleTime(dir) {
  const i = TIME_STEPS.findIndex((t) => t >= game.answerMs - 1);
  const at = i === -1 ? 1 : i;
  game.answerMs = TIME_STEPS[(at + dir + TIME_STEPS.length) % TIME_STEPS.length];
  lastCheckpoint = 0;
}

/** @param {string} item @param {number} dir */
function menuAdjust(item, dir) {
  if (item === 'deck') pageDeck(dir);
  else if (item === 'mode') browseMode(menu.browse === 'solo' ? 'teams' : 'solo');
  else if (item === 'look') {
    const at = Math.max(0, LOOKS.indexOf(menu.look));
    menu.look = LOOKS[(at + dir + LOOKS.length) % LOOKS.length];
    // Applied on the spot: the lobby sky is the preview.
    applyTheme();
  }
}

/**
 * Enter, or a click on the row the cursor is already on.
 * @param {string} item
 */
function menuActivate(item) {
  if (item.startsWith('mode:')) {
    browseMode(item.slice(5) === 'teams' ? 'teams' : 'solo');
  } else if (item.startsWith('deck:')) {
    // A row IS the pick — clicking a deck loads it, nothing to confirm.
    const ix = menu.packs.findIndex((p) => p.file === item.slice(5));
    if (ix >= 0) void selectPack(ix);
  } else if (item === 'look:prev') {
    menuAdjust('look', -1);
  } else if (item === 'look:next') {
    menuAdjust('look', 1);
  } else if (item === 'quiz') {
    // The button itself carries the reason, so a blocked press stays quiet
    // rather than repeating it in a banner.
    if (!startBlocked()) startConfiguredGame(false);
  } else menuAdjust(item, 1);
}

// ------------------------------------------------------------------ showdown

/** @type {import('../../sim/showdown.js').Showdown | null} */
let showdown = null;
/** @type {{statements: {text:string, answer:boolean}[], answerMs?: number} | null} */
let showdownSpec = null;
/** @type {{questions: import('../../sim/round.js').Question[], perTeam:number, answerMs?:number} | null} */
let controlSpec = null;

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
  world.platforms = [...buildLobbyArena(), ...menuPlatforms()];
  respawnAll(world);
  game.phase = PHASE.LOBBY;
  game.phaseT = 0;
}

/**
 * Back to the lobby menu, from a finished game or an abandoned one.
 *
 * The final screen used to offer only "play again", which replays the same
 * pack with the same settings — so switching pack, answer time or teams meant
 * restarting the server. This is the way out: a fresh Game over the same deck,
 * with the pack/time/mode settings the host already chose left intact.
 *
 * Scores go. That is the point — this is a new game, not a pause — and the
 * board is still on screen when the host presses it.
 */
function toMenu() {
  if (showdown) {
    endShowdown();
    return;
  }
  game = createGame(game.baseQuestions, game.answerMs);
  game.levelPool = levelPool;
  applyMode();
  world.platforms = [...buildLobbyArena(), ...menuPlatforms()];
  respawnAll(world);
  menu.sel = Math.max(0, menuItems().indexOf('quiz'));
  lastCheckpoint = 0;
}

/**
 * The current question's answer key, for the host's phone only. Rides the
 * CHECKPOINT as a `quiz` block that the relay strips from the public copy —
 * the host emcees from the back of the room and needs to know the answer
 * before the reveal; the room must not.
 * @returns {object | null}
 */
function quizForHost() {
  if (showdown) {
    const s = currentStatement(showdown);
    return s ? { kind: 'tf', answer: s.answer } : null;
  }
  if (game.phase === PHASE.LOBBY || game.phase === PHASE.GAME_OVER) return null;
  const q = currentQuestion(game);
  if (!q) return null;
  if (isControlQuestion(q)) {
    return {
      kind: 'control',
      team: q.team,
      controls: (q.controls ?? []).map((control) => ({ label: control.label, answer: control.answer, unit: control.unit ?? '' })),
    };
  }
  if (q.type === 'range' && q.answer) {
    return { kind: 'range', lo: q.answer[0], hi: q.answer[1], unit: q.unit ?? '' };
  }
  if (isSortQuestion(q)) {
    return {
      kind: 'sort',
      buckets: q.buckets ?? [],
      item: game.itemIndex,
      items: (q.items ?? []).map((it) => ({ label: it.label, bucket: it.bucket })),
    };
  }
  return { kind: 'choice', answers: q.answers, correct: q.correct };
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
    if (keyboardOn) bus.applyMask(LOCAL_ID, localMask);
    // Phase-aware: at GAME_OVER the last question is still "current", but
    // nobody is gated any more — activeControlTeam knows the difference.
    const controlTeam = showdown ? null : activeControlTeam(game);
    bus.drainInto(world, (id) => controlTeam === null || cohortOf(id) === controlTeam);
    flash.observe(world);
    if (showdown) stepShowdown(showdown, world, STEP_MS);
    else stepRound(game, world, STEP_MS);
    acc -= STEP_MS;
    steps++;
  }
  if (showdown?.phase === SD_PHASE.DONE) endShowdown();
  lastSteps = steps;

  // Landing notes ride the same frame as the landing squash.
  tickAudio(world);
  trackMenuLandings();
  tickRevealHop();

  if (game.phase !== lastPhase) {
    if (game.phase === PHASE.REVEAL) startRevealHop();
    // A sort round's phones already buzzed per item; the summary reveal
    // repeating the last verdict would read as a second judgement.
    if (game.phase === PHASE.REVEAL && !isSortQuestion(currentQuestion(game))) {
      for (const r of game.results) {
        if (r.id === LOCAL_ID) continue;
        send({
          type: 'FEEDBACK_REQ',
          playerId: r.id,
          code: r.correct ? FB_LANDED_CORRECT : FB_LANDED_WRONG,
        });
      }
    }
    // Idle moments re-read the level library, so save-in-editor → play is
    // seamless without reloading the display.
    if (game.phase === PHASE.LOBBY || game.phase === PHASE.GAME_OVER) void refreshLevels();
    lastPhase = game.phase;
  }

  // Sort rounds: buzz each phone at each item's flash — the per-item verdict
  // is the feedback that matters, and phase edges never see item boundaries.
  if (
    isSortQuestion(currentQuestion(game)) &&
    game.phase === PHASE.ANSWER &&
    game.itemPhase === 'flash'
  ) {
    const key = `${game.qIndex}:${game.itemIndex}`;
    if (lastItemKey !== key) {
      lastItemKey = key;
      for (const [id, hit] of game.itemHits) {
        if (id === LOCAL_ID) continue;
        send({
          type: 'FEEDBACK_REQ',
          playerId: id,
          code: hit ? FB_LANDED_CORRECT : FB_LANDED_WRONG,
        });
      }
    }
  }

  // The round's board colourway: rotates per question, rests on teal in the
  // lobby and the showdown. Set once per frame so every draw call agrees.
  setRound(showdown ? -1 : game.qIndex);

  render(cx, world, roster, game, {
    qr: game.phase === PHASE.LOBBY && !showdown ? qr : null,
    joinUrl,
  });
  if (!showdown) drawConfetti(cx, game, world);
  flash.draw(cx);
  if (showdown) drawShowdown(cx, showdown, world, roster);
  else drawRoundOverlay(cx, game, roster, world.players.size, menuOpen() ? menuView() : null);
  drawHud(cx, {
    bus,
    roster,
    net,
    frameSamples,
    steps: lastSteps,
    players: world.players.size,
    mode: hud.mode,
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
            quiz: quizForHost(),
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
            roundKind: isControlQuestion(currentQuestion(game)) ? 'control' : 'standard',
            activeTeam: isControlQuestion(currentQuestion(game)) ? currentQuestion(game)?.team ?? null : null,
            paused: game.paused,
            hold: game.holdAfterReveal,
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
            teamBonuses: Object.fromEntries(game.teamBonuses),
            quiz: quizForHost(),
          },
    });
  }
}

// ------------------------------------------------------------------ keyboard

/** @param {KeyboardEvent} e @param {boolean} down */
function onKey(e, down) {
  const k = e.key.toLowerCase();

  // Any key is the user gesture that lets the browser start audio — the
  // host's very first Enter unlocks the speakers as a side effect.
  if (down) unlockAudio();

  if (down && !e.repeat) {
    if (k === 'h') {
      hud.mode = (hud.mode + 1) % 3;
      return;
    }
    if (k === 'm') {
      note(toggleMuted() ? 'sound muted — M to unmute' : 'sound on');
      return;
    }
    if (k === 'n') {
      note(`landing notes: ${cycleVoice()}`);
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
      // From the lobby, R must start the same game Enter would — through the
      // configuration step, or a teams pack silently loses its Control Room
      // turns. Mid-game it stays a bare restart of the game as configured.
      else if (game.phase === PHASE.LOBBY) startConfiguredGame(false);
      else startGame(game, world);
      return;
    }
    if (k === 'k') {
      toggleKeyboardPlayer();
      return;
    }
    // Q for the menu. Deliberately live outside the lobby too, not just at
    // GAME_OVER: "wrong pack" is realised mid-round, and R (restart) is
    // already an equally big button on the same keyboard.
    if (k === 'q' && (showdown || game.phase !== PHASE.LOBBY)) {
      toMenu();
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
addEventListener('pointerdown', unlockAudio);

// ------------------------------------------------------------------ pointer
// The display hides its cursor — it is a projected screen, not a desktop —
// but the host drives it from a laptop, so the pointer comes back the moment
// the trackpad moves and fades away again once it is still.

/** @type {any} */
let cursorTimer = 0;
function wakeCursor() {
  clearTimeout(cursorTimer);
  cursorTimer = setTimeout(() => {
    document.body.style.cursor = 'none';
    menu.hover = null;
  }, 2500);
}

/**
 * Where a click landed in the 1920x1080 world. The canvas is letterboxed by
 * `object-fit: contain`, so undo that fit rather than assuming it fills.
 * @param {PointerEvent} e
 */
function stagePoint(e) {
  const r = canvas.getBoundingClientRect();
  const scale = Math.min(r.width / canvas.width, r.height / canvas.height);
  if (!(scale > 0)) return null;
  return {
    x: (e.clientX - (r.left + (r.width - canvas.width * scale) / 2)) / scale,
    y: (e.clientY - (r.top + (r.height - canvas.height * scale) / 2)) / scale,
  };
}

/** What the pointer is over, or null. @param {PointerEvent} e */
function targetAt(e) {
  const p = stagePoint(e);
  if (!p) return null;
  return menuHits.find(
    (a) => p.x >= a.x && p.x <= a.x + a.w && p.y >= a.y && p.y <= a.y + a.h
  ) ?? null;
}

// Hover is what makes a canvas feel like a UI: the row under the pointer
// lights up, and the cursor becomes a hand over anything clickable.
addEventListener('pointermove', (e) => {
  const over = menuOpen() ? targetAt(/** @type {PointerEvent} */ (e)) : null;
  menu.hover = over?.id ?? null;
  document.body.style.cursor = over ? 'pointer' : 'default';
  wakeCursor();
});

// The wheel pages the deck card: a scroll over the lobby flips through the
// shelf, which is what a scroll on a row of covers is expected to do.
canvas.addEventListener('wheel', (e) => {
  if (!menuOpen() || shelf().length < 2) return;
  pageDeck(e.deltaY > 0 ? 1 : -1);
  e.preventDefault();
}, { passive: false });

canvas.addEventListener('pointerdown', (e) => {
  document.body.style.cursor = 'pointer';
  wakeCursor();
  if (!menuOpen()) return;
  const target = targetAt(e);
  // With the key list open, a click anywhere else puts it away.
  if (menu.dev && target?.id !== 'dev') {
    menu.dev = false;
    return;
  }
  if (!target) return;
  if (target.id === 'dev') {
    menu.dev = !menu.dev;
    return;
  }
  // A click acts, the way a click does everywhere else. The cursor follows
  // it so the keyboard picks up where the pointer left off — a control
  // inside a row (an arrow, a dot, a mode pill) parks the cursor on the row
  // that owns it.
  menu.sel = Math.max(0, menuItems().indexOf(rowOf(target.id)));
  menuActivate(target.id);
});

/** The cursor row a clickable belongs to. @param {string} id */
function rowOf(id) {
  if (id.startsWith('mode:')) return 'mode';
  if (id.startsWith('deck:')) return 'deck';
  if (id.startsWith('look:')) return 'look';
  return id;
}
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
  // Missing art is reported inside the latency HUD (press H), not as a
  // standing on-screen note: the game is fully procedural by design, so on a
  // party screen this is dev information, not a warning.

  try {
    const pack = await fetch('/api/questions').then((r) => r.json());
    if (pack?.questions?.length || pack?.controlRoom?.questions?.length) {
      game = createGame(pack.questions ?? [], pack.answerMs);
    } else hud.note = 'no questions loaded — check the questions/ folder';
    if (pack?.mode === 'teams' || pack?.mode === 'solo') menu.mode = pack.mode;
    applyMode();
    await refreshLevels();
    if (pack?.showdown?.statements?.length) showdownSpec = pack.showdown;
    if (pack?.controlRoom?.questions?.length) controlSpec = pack.controlRoom;
    deckTheme = pack?.theme;
    applyTheme();
    const packs = await fetch('/api/packs').then((r) => r.json());
    if (Array.isArray(packs) && packs.length) {
      menu.packs = packs;
      menu.packIndex = Math.max(0, packs.findIndex((/** @type {any} */ p) => p.file === pack?.file));
      // The card opens on the shelf the booted deck belongs to, so the mode
      // segment and the deck under it can never disagree on the first frame.
      const here = menu.packs[menu.packIndex];
      menu.browse = (here?.mode ?? 'solo') === 'teams' ? 'teams' : 'solo';
      menu.lastIn[menu.browse] = here?.file ?? null;
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
      get menu() { return menu; },
      get hits() { return menuHits; },
    },
  });

  connect();
  requestAnimationFrame(frame);
}

init();

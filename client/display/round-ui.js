/**
 * Everything the round draws on top of the stage: question banner, timer,
 * scoreboard, lobby, final standings.
 *
 * Sizing throughout assumes the viewer is 5+ metres away, which is the real
 * constraint on a party screen — anything that needs leaning in has failed.
 *
 * The answer labels are NOT here. They're part of the signboard in stage.js,
 * because the platform and its answer are one object.
 */

import { WORLD_H, WORLD_W } from '../../shared/tuning.js';
import { COHORTS, TEAM_COLORS, clampCohort } from '../../shared/palette.js';
import { RANGE_ID } from '../../sim/levels.js';
import { PHASE, answerWindow, currentQuestion, isControlQuestion, isMulti, isSortQuestion, sortItemMs, standings, targetIds, teamStandings } from '../../sim/round.js';
import { drawFloor, drawNumberLine, drawRangeReveal, drawSign, drawSignText, fitFont } from './stage.js';
import { drawFrostBlobs, glassFam, glassFrost, themeName } from './themes.js';
import { FONT, UI } from './theme.js';

/**
 * The answer furniture for the current round: signboards for multiple choice,
 * the number line (and, after the buzzer, the glowing band) for a range.
 * @param {CanvasRenderingContext2D} cx
 * @param {import('../../sim/world.js').World} world
 * @param {import('../../sim/round.js').Game} g
 */
export function drawSigns(cx, world, g) {
  const q = currentQuestion(g);
  if (isControlQuestion(q)) return;
  const revealing = g.phase === PHASE.REVEAL || g.phase === PHASE.SCORE;

  if (q?.type === 'range') {
    const rq = /** @type {import('../../sim/levels.js').RangeQuestion} */ (q);
    // The rail floats above the crowd, so it survives the floor collapse and
    // stays up through the reveal — the answer tag hangs off the same rail.
    drawNumberLine(cx, rq);
    if (revealing) {
      const band = world.platforms.find((p) => p.id === RANGE_ID);
      if (band) drawRangeReveal(cx, band, rq);
    }
    return;
  }

  // A sort round lights its winning bucket during each between-items flash;
  // the arena itself never crumbles.
  const flashing =
    isSortQuestion(q) && g.phase === PHASE.ANSWER && g.itemPhase === 'flash';
  // ... and at the summary the buckets rest idle: the tally is the story,
  // no single bucket was "the" answer.
  const lit = isSortQuestion(q) ? flashing : revealing;
  const keep = q ? targetIds(q, g.itemIndex) : new Set();
  for (const p of world.platforms) {
    if (!p.id?.startsWith('ans')) continue;
    const i = Number(p.id.slice(3));
    const state = lit && q && keep.has(p.id) ? 'correct' : 'idle';
    drawSign(cx, p, { state });
    if (q) drawSignText(cx, p, q.answers?.[i] ?? '', { state });
  }
}

/**
 * Crumbled signboards keep being drawn as they fall, so the reveal reads as
 * consequence rather than as platforms blinking out. They carry their own
 * answer text down with them, which is the payoff of merging the two.
 * @param {CanvasRenderingContext2D} cx
 * @param {import('../../sim/round.js').Game} g
 */
export function drawDebris(cx, g) {
  if (!g.debris.length) return;
  const q = currentQuestion(g);
  // debrisT, not phaseT: phaseT resets when SCORE begins, which replayed the
  // whole fall a couple of seconds after the platforms had already gone.
  const fall = fallOffset(g.debrisT);
  const tilt = Math.min(0.22, g.debrisT / 5000);

  for (const p of g.debris) {
    const isFloor = String(p.id).startsWith('floor');
    cx.save();
    cx.globalAlpha = Math.max(0, 1 - fall / 900);
    cx.translate(p.x + p.w / 2, p.y + fall);
    // Floor slabs are several times wider than a signboard, so the same tilt
    // would swing their far edge up through the surviving band. Damp it.
    cx.rotate((p.x + p.w / 2 > WORLD_W / 2 ? 1 : -1) * tilt * (isFloor ? 0.35 : 1));
    cx.translate(-(p.x + p.w / 2), -p.y);
    if (isFloor) {
      drawFloor(cx, p);
    } else {
      const i = Number(String(p.id).slice(3));
      drawSign(cx, p, { state: 'wrong' });
      if (q) drawSignText(cx, p, q.answers?.[i] ?? '', { state: 'wrong' });
    }
    cx.restore();
  }
}

/** @param {number} t */
function fallOffset(t) {
  const s = t / 1000;
  return 0.5 * 2600 * s * s;
}

/**
 * @typedef {object} MenuView
 * @property {Array<{file:string, name:string, questions:number, mode?:'solo'|'teams', showdown:boolean, controlRoom?:number}>} packs
 * @property {number} packIndex
 * @property {number} sel
 * @property {boolean} loading
 * @property {string[]} items
 * @property {string|null} [hover] the row the pointer is over
 * @property {string|null} [startBlocked] why Start cannot run, or null
 * @property {number} answerMs
 * @property {'solo'|'teams'} mode
 * @property {string} look 'deck' = play the pack's theme; else the override
 * @property {string} [deckTheme] the loaded pack's own theme, for the row label
 * @property {number[]} [cohortCounts] committed + connected players per year
 * @property {number} [controlCases] size of the pack's Control Room pool
 * @property {boolean} [dev] the key-list panel is open
 * @property {Array<{id: string, x: number, y: number, w: number, h: number}>} [hits]
 *   click targets, refilled by the draw so the geometry can never drift
 */

/**
 * @param {CanvasRenderingContext2D} cx
 * @param {import('../../sim/round.js').Game} g
 * @param {Map<number, {name:string, color:string, cohortIndex?: number, cohortSet?: boolean}>} roster
 * @param {number} playerCount
 * @param {MenuView | null} [menu]
 */
export function drawRoundOverlay(cx, g, roster, playerCount, menu = null) {
  switch (g.phase) {
    case PHASE.LOBBY:
      if (menu) drawMenu(cx, menu, playerCount);
      else drawLobby(cx, playerCount);
      break;
    case PHASE.INTRO:
    case PHASE.ANSWER:
    case PHASE.LOCK:
    case PHASE.REVEAL:
      drawQuestion(cx, g);
      break;
    case PHASE.SCORE:
      drawQuestion(cx, g);
      drawScoreboard(cx, g, roster);
      // Host-paced mode parked here: say so quietly, or the room reads the
      // frozen scoreboard as a hang.
      if (g.holdAfterReveal && g.phaseT > 4000) {
        cx.font = `700 22px ${FONT.ui}`;
        cx.textAlign = 'center';
        cx.fillStyle = themeName() === 'glass' && glassFam().light
          ? glassFam().textDim
          : 'rgba(255,255,255,0.55)';
        cx.fillText('paced by the host — next question on their signal', 960, 1042);
        cx.textAlign = 'left';
      }
      break;
    case PHASE.GAME_OVER:
      drawFinal(cx, g, roster);
      break;
    default:
      break;
  }
}

/**
 * The game's name on the lobby masthead. A stand-in until it gets a real
 * one — the lobby is the screen people stare at longest, so whatever word
 * sits here is what the room will call the game.
 */
const WORDMARK = 'PLATFORMS';

/**
 * Stand-in cover art for a deck: the game in miniature. Packs will be able
 * to carry their own picture later; until then every deck shows this, so
 * the card has the same shape either way.
 * @param {CanvasRenderingContext2D} cx
 * @param {number} x @param {number} y @param {number} s square side
 */
function drawDeckCover(cx, x, y, s) {
  cx.save();
  cx.beginPath();
  cx.roundRect(x, y, s, s, 14);
  cx.clip();
  cx.fillStyle = 'rgba(255,255,255,0.10)';
  cx.fillRect(x, y, s, s);
  cx.fillStyle = 'rgba(255,255,255,0.30)';
  for (const [bx, by] of [[0.10, 0.64], [0.54, 0.52], [0.30, 0.38]]) {
    cx.beginPath();
    cx.roundRect(x + s * bx, y + s * by, s * 0.36, s * 0.07, 4);
    cx.fill();
  }
  cx.fillStyle = 'rgba(255,255,255,0.58)';
  cx.beginPath();
  cx.roundRect(x + s * 0.41, y + s * 0.22, s * 0.14, s * 0.16, 6);
  cx.fill();
  cx.restore();
  cx.strokeStyle = 'rgba(255,255,255,0.22)';
  cx.lineWidth = 1.5;
  cx.beginPath();
  cx.roundRect(x, y, s, s, 14);
  cx.stroke();
}

/**
 * The lobby: a composed screen, not a dialog. Setup card on the LEFT (host
 * business), join panel on the RIGHT (drawn with the QR in render.js), and
 * the whole centre left open — the lobby arena's platforms live there, so
 * the warm-up playground is never under a panel. The world runs live
 * throughout: setup time is play time.
 * @param {CanvasRenderingContext2D} cx
 * @param {MenuView} menu
 * @param {number} playerCount
 */
function drawMenu(cx, menu, playerCount) {
  void playerCount; // the join panel owns the headcount
  const x0 = 40;
  const y0 = 118;
  const w = 560;
  const pad = 30;

  cx.textAlign = 'left';
  cx.textBaseline = 'alphabetic';
  cx.font = `800 46px ${FONT.display}`;
  cx.fillStyle = themeName() === 'glass' && glassFam().light
    ? glassFam().text
    : 'rgba(255,255,255,0.92)';
  cx.fillText(WORDMARK, x0 + 4, 88);

  const hits = menu.hits;
  if (hits) hits.length = 0;
  const hit = (/** @type {string} */ id, /** @type {number} */ hx, /** @type {number} */ hy,
    /** @type {number} */ hw, /** @type {number} */ hh) => {
    if (hits) hits.push({ id, x: hx, y: hy, w: hw, h: hh });
  };

  const sel = menu.items[menu.sel];
  const decks = menu.packs;
  const solo = decks.filter((p) => (p.mode ?? 'solo') === 'solo');
  const teams = decks.filter((p) => (p.mode ?? 'solo') === 'teams');
  const counts = menu.cohortCounts ?? [0, 0, 0];
  const onTeams = counts.reduce((a, b) => a + b, 0);

  const rowH = 78;
  const headH = 34;
  const groups = [
    ['Free-for-all', 'everyone plays for themselves', solo],
    ['Teams', 'PGY years score together', teams],
  ].filter(([, , list]) => /** @type {any[]} */ (list).length);

  const listH = groups.reduce((t, [, , list]) => t + headH + /** @type {any[]} */ (list).length * rowH, 0);
  const h = pad + 24 + listH + 18 + 64 + 20 + 74 + pad - 16;
  panel(cx, x0, y0, w, h, undefined, { veil: lobbyVeil() });

  cx.font = `700 14px ${FONT.ui}`;
  cx.fillStyle = 'rgba(255,255,255,0.45)';
  cx.fillText('PICK A DECK', x0 + pad, y0 + pad + 8);

  let y = y0 + pad + 24;
  for (const [title, blurb, list] of groups) {
    const isTeams = title === 'Teams';
    cx.font = `800 17px ${FONT.display}`;
    cx.fillStyle = 'rgba(255,255,255,0.9)';
    cx.fillText(/** @type {string} */ (title), x0 + pad, y + 22);
    cx.font = `600 14px ${FONT.ui}`;
    cx.fillStyle = isTeams && !onTeams ? 'rgba(255,215,120,0.8)' : 'rgba(255,255,255,0.45)';
    const note = isTeams
      ? onTeams
        ? `${onTeams} player${onTeams === 1 ? '' : 's'} on a team`
        : 'waiting for players to pick a year'
      : /** @type {string} */ (blurb);
    cx.textAlign = 'right';
    cx.fillText(note, x0 + w - pad, y + 22);
    cx.textAlign = 'left';
    y += headH;

    for (const p of /** @type {any[]} */ (list)) {
      const id = `deck:${p.file}`;
      const chosen = p.file === menu.packs[menu.packIndex]?.file;
      const cursor = sel === id;
      const hovered = menu.hover === id;
      hit(id, x0 + 18, y, w - 36, rowH - 8);

      // EVERY deck is drawn as a card, not just the chosen one: a row that
      // only looks like a control once the pointer crosses it reads as a
      // label, and nobody clicks a label.
      cx.fillStyle = chosen
        ? 'rgba(255,255,255,0.20)'
        : cursor || hovered ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.06)';
      cx.strokeStyle = chosen
        ? 'rgba(255,255,255,0.85)'
        : cursor || hovered ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.22)';
      cx.lineWidth = chosen ? 2.5 : 1.5;
      cx.beginPath();
      cx.roundRect(x0 + 18, y, w - 36, rowH - 8, 14);
      cx.fill();
      cx.stroke();

      const cover = 52;
      drawDeckCover(cx, x0 + pad, y + 9, cover);
      const tx = x0 + pad + cover + 16;
      cx.font = fitFont(cx, p.name, w - pad * 2 - cover - 16, 24, 16);
      cx.fillStyle = chosen ? '#ffffff' : 'rgba(255,255,255,0.85)';
      cx.fillText(p.name, tx, y + 32);
      cx.font = `600 14px ${FONT.ui}`;
      cx.fillStyle = 'rgba(255,255,255,0.5)';
      cx.fillText(`${p.questions} questions`, tx, y + 54);
      cx.textAlign = 'right';
      cx.font = `700 13px ${FONT.ui}`;
      cx.fillStyle = chosen ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.38)';
      cx.fillText(chosen ? 'PLAYING' : 'click to pick', x0 + w - pad, y + 42);
      cx.textAlign = 'left';
      y += rowH;
    }
  }
  if (!decks.length) {
    cx.font = `600 17px ${FONT.ui}`;
    cx.fillStyle = 'rgba(255,255,255,0.6)';
    cx.fillText('No decks in questions/ yet.', x0 + pad, y + 26);
    y += 40;
  }

  y += 18;

  // ---- the two settings, side by side and quiet: set once, rarely touched
  /** @type {Array<['time'|'look', string, string]>} */
  const cells = [
    ['time', 'Answer time', `${Math.round(menu.answerMs / 1000)}s`],
    ['look', 'Background', menu.look === 'deck'
      ? `deck${menu.deckTheme ? ` · ${menu.deckTheme}` : ''}`
      : menu.look],
  ];
  const cellW = (w - pad * 2 - 12) / 2;
  cells.forEach(([key, label, value], i) => {
    const cxp = x0 + pad + i * (cellW + 12);
    const active = sel === key || menu.hover === key;
    hit(key, cxp, y, cellW, 58);
    cx.fillStyle = active ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.05)';
    cx.strokeStyle = active ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.16)';
    cx.lineWidth = 1.5;
    cx.beginPath();
    cx.roundRect(cxp, y, cellW, 58, 12);
    cx.fill();
    cx.stroke();
    cx.font = `700 12px ${FONT.ui}`;
    cx.fillStyle = 'rgba(255,255,255,0.45)';
    cx.fillText(label, cxp + 14, y + 22);
    cx.font = `700 19px ${FONT.ui}`;
    cx.fillStyle = 'rgba(255,255,255,0.9)';
    cx.fillText(active ? `${value}  ▸` : value, cxp + 14, y + 45);
  });
  y += 58 + 22;

  // ---- Start, and the reason when it cannot run
  const why = menu.startBlocked ?? null;
  const cursorHere = sel === 'quiz';
  const hoverHere = menu.hover === 'quiz';
  const btnH = 74;
  hit('quiz', x0 + 18, y, w - 36, btnH);
  cx.save();
  cx.beginPath();
  cx.roundRect(x0 + 18, y, w - 36, btnH, 18);
  if ((cursorHere || hoverHere) && !why) {
    cx.shadowColor = 'rgba(255,255,255,0.85)';
    cx.shadowBlur = 28;
  }
  cx.fillStyle = why
    ? 'rgba(255,255,255,0.05)'
    : cursorHere || hoverHere ? 'rgba(255,255,255,0.24)' : 'rgba(255,255,255,0.11)';
  cx.fill();
  cx.shadowColor = 'rgba(0,0,0,0)';
  cx.strokeStyle = why
    ? 'rgba(255,255,255,0.16)'
    : cursorHere || hoverHere ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.3)';
  cx.lineWidth = cursorHere || hoverHere ? 2.5 : 1.5;
  cx.stroke();
  cx.restore();
  cx.textAlign = 'center';
  if (why) {
    cx.font = `800 24px ${FONT.display}`;
    cx.fillStyle = 'rgba(255,255,255,0.4)';
    cx.fillText('Start', x0 + w / 2, y + 32);
    cx.font = `600 14px ${FONT.ui}`;
    cx.fillStyle = 'rgba(255,215,120,0.8)';
    cx.fillText(why, x0 + w / 2, y + 55);
  } else {
    cx.font = `800 30px ${FONT.display}`;
    cx.fillStyle = '#ffffff';
    cx.fillText(menu.loading ? 'loading…' : 'Start', x0 + w / 2, y + btnH / 2 + 11);
  }
  cx.textAlign = 'left';

  // ---- the dev-tools tab: every key, one click away, folded up otherwise
  const devW = 132;
  const devH = 34;
  const devY = y0 + h + 14;
  const devHover = menu.hover === 'dev';
  hit('dev', x0, devY, devW, devH);
  cx.fillStyle = menu.dev || devHover ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.07)';
  cx.strokeStyle = menu.dev || devHover ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.2)';
  cx.lineWidth = 1.5;
  cx.beginPath();
  cx.roundRect(x0, devY, devW, devH, 10);
  cx.fill();
  cx.stroke();
  cx.font = `700 14px ${FONT.ui}`;
  cx.fillStyle = menu.dev || devHover ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.55)';
  cx.fillText('⌨  dev tools', x0 + 14, devY + 22);
  if (menu.dev) drawDevPanel(cx, x0, devY + devH + 12);
}

/**
 * Every key the display answers to. The lobby is driven with the arrows and
 * Enter; the rest are running-a-game and debugging keys that would only
 * clutter the card, so they live behind the dev-tools tab.
 * @param {CanvasRenderingContext2D} cx
 * @param {number} x @param {number} y
 */
function drawDevPanel(cx, x, y) {
  /** @type {Array<[string, string]>} */
  const keys = [
    ['↑ ↓', 'move down the card'],
    ['◂ ▸', 'change the setting'],
    ['⏎', 'start, or browse decks'],
    ['P', 'pause / resume'],
    ['R', 'restart the round'],
    ['Q', 'back to the lobby'],
    ['S', 'start the showdown'],
    ['K', 'add a keyboard player'],
    ['M', 'mute the sound'],
    ['N', 'landing-note voice'],
    ['H', 'debug readout'],
    ['T', 'physics tuner'],
    ['F', 'flash target'],
  ];
  // Two columns, and the whole panel pulled up if it would run off the
  // bottom — the lobby card's height changes with the pack, so the space
  // under the tab is not fixed.
  const rowH = 30;
  const pad = 18;
  const colW = 290;
  const rows = Math.ceil(keys.length / 2);
  const w = pad * 2 + colW * 2;
  const h = pad * 2 + 26 + rows * rowH;
  const top = Math.min(y, 1080 - h - 28);
  panel(cx, x, top, w, h, undefined, { veil: lobbyVeil() });
  cx.textAlign = 'left';
  cx.font = `700 13px ${FONT.ui}`;
  cx.fillStyle = 'rgba(255,255,255,0.5)';
  cx.fillText('KEYBOARD', x + pad, top + pad + 12);
  keys.forEach(([key, what], i) => {
    const kx = x + pad + colW * Math.floor(i / rows);
    const ky = top + pad + 26 + (i % rows) * rowH;
    cx.font = `800 15px ${FONT.ui}`;
    cx.fillStyle = 'rgba(255,255,255,0.92)';
    cx.fillText(key, kx, ky + 20);
    cx.font = `600 15px ${FONT.ui}`;
    cx.fillStyle = 'rgba(255,255,255,0.6)';
    cx.fillText(what, kx + 52, ky + 20);
  });
}

/**
 * @param {CanvasRenderingContext2D} cx
 * @param {number} playerCount
 */
function drawLobby(cx, playerCount) {
  const joined = Math.max(0, playerCount - 1);
  panel(cx, 70, 64, 880, 186);

  cx.fillStyle = UI.paper;
  cx.font = `800 66px ${FONT.display}`;
  cx.textAlign = 'left';
  cx.textBaseline = 'alphabetic';
  cx.fillText('Scan to join', 110, 148);

  cx.font = `600 30px ${FONT.ui}`;
  cx.fillStyle = joined ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.45)';
  cx.fillText(
    joined ? `${joined} player${joined === 1 ? '' : 's'} in — press ENTER to start` : 'waiting for players…',
    110, 202
  );
}

/**
 * @param {CanvasRenderingContext2D} cx
 * @param {import('../../sim/round.js').Game} g
 */
function drawQuestion(cx, g) {
  const q = currentQuestion(g);
  if (!q) return;
  if (isControlQuestion(q)) {
    drawControlQuestion(cx, g, q);
    return;
  }

  const h = 150;
  cx.fillStyle = 'rgba(10,8,20,0.9)';
  cx.fillRect(0, 0, WORLD_W, h);

  // In a live sort round the ITEM is the question: the prompt shrinks to a
  // rubric line and the current item takes the stage.
  const sortLive = isSortQuestion(q) && g.phase === PHASE.ANSWER;
  const item = sortLive ? q.items?.[g.itemIndex] : null;

  cx.textBaseline = 'alphabetic';
  cx.textAlign = 'center';
  if (item) {
    cx.fillStyle = UI.dim;
    cx.font = `700 22px ${FONT.ui}`;
    cx.fillText(q.text, WORLD_W / 2, 38);
    cx.fillStyle = UI.paper;
    cx.font = fitFont(cx, item.label, WORLD_W - 480, 64, 34);
    cx.fillText(item.label, WORLD_W / 2, 102);
  } else {
    cx.fillStyle = UI.paper;
    cx.font = fitFont(cx, q.text, WORLD_W - 340, 74, 34);
    cx.fillText(q.text, WORLD_W / 2, 90);
  }

  cx.font = `700 24px ${FONT.mono}`;
  cx.fillStyle = UI.faint;
  cx.textAlign = 'left';
  cx.fillText(`Q${g.qIndex + 1}/${g.questions.length}`, 40, 90);
  if (sortLive && q.items) {
    cx.font = `700 20px ${FONT.mono}`;
    cx.fillText(`item ${g.itemIndex + 1}/${q.items.length}`, 40, 120);
  }

  // Timer as a full-width bar rather than digits: readable out of the corner of
  // your eye while you're running, from anywhere in the room. A sort round's
  // bar runs on the item clock — every item is its own little countdown.
  const win = sortLive ? sortItemMs(q) : answerWindow(g);
  const clock = sortLive ? g.itemT : g.phaseT;
  const answering = g.phase === PHASE.ANSWER && (!sortLive || g.itemPhase === 'go');
  const frac = answering ? Math.max(0, 1 - clock / win) : g.phase === PHASE.INTRO ? 1 : 0;
  const secsLeft = (frac * win) / 1000;

  const barY = h - 14;
  cx.fillStyle = 'rgba(255,255,255,0.08)';
  cx.fillRect(0, barY, WORLD_W, 14);
  cx.fillStyle = secsLeft <= 3 ? UI.wrong : secsLeft <= 6 ? UI.warn : UI.correct;
  cx.fillRect(0, barY, WORLD_W * frac, 14);

  if (answering && secsLeft <= 3) {
    cx.textAlign = 'right';
    cx.font = `800 58px ${FONT.display}`;
    cx.fillStyle = UI.wrong;
    cx.fillText(String(Math.ceil(secsLeft)), WORLD_W - 40, 98);
  }

  // A select-all round says so out loud, or half the room hunts for THE
  // answer and blames the game. In teams mode it also states the job.
  const multiTag = isMulti(q)
    ? g.mode === 'teams'
      ? 'SELECT ALL THAT APPLY — your year must cover every correct answer'
      : 'SELECT ALL THAT APPLY — any correct answer scores'
    : null;

  if (g.phase === PHASE.INTRO) {
    cx.textAlign = 'center';
    cx.font = `700 26px ${FONT.ui}`;
    cx.fillStyle = UI.dim;
    cx.fillText('get ready…', WORLD_W / 2, 128);
  } else if (multiTag && g.phase === PHASE.ANSWER) {
    cx.textAlign = 'center';
    cx.font = `800 24px ${FONT.display}`;
    cx.fillStyle = UI.gold;
    cx.fillText(multiTag, WORLD_W / 2, 128);
  }

  // Say it out loud, or the settle reads as the game having hung.
  if (g.phase === PHASE.LOCK) {
    cx.textAlign = 'center';
    cx.font = `800 30px ${FONT.display}`;
    cx.fillStyle = UI.warn;
    cx.fillText(isSortQuestion(q) ? 'final tally…' : "TIME'S UP", WORLD_W / 2, 130);
  }
  cx.textAlign = 'left';

  // The picture hangs through intro, answering and the reveal; the SCORE
  // panel owns that band, so it steps aside for the scoreboard.
  if (q.image && g.phase !== PHASE.SCORE) drawQuestionImage(cx, q);
}

/**
 * Question images, loaded once per filename. The map holds the Image even
 * while it loads; a frame simply skips drawing until it's ready.
 * @type {Map<string, HTMLImageElement>}
 */
const IMAGE_CACHE = new Map();

/**
 * Seed the image cache with a local source — the Pack Studio's preview
 * hands question images in as object URLs, since there is no /qimg server
 * behind a static page. A no-op for the display, which never calls it.
 * @param {string} name the filename the question references
 * @param {string} url  an object/data URL for the actual pixels
 */
export function registerPreviewImage(name, url) {
  const img = new Image();
  img.src = url;
  IMAGE_CACHE.set(name, img);
}

/** @param {string} name @returns {HTMLImageElement | null} */
function questionImage(name) {
  let img = IMAGE_CACHE.get(name);
  if (!img) {
    img = new Image();
    img.src = `/qimg/${encodeURIComponent(name)}`;
    IMAGE_CACHE.set(name, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

/**
 * The question's picture — an EKG, a rash, a map — hung like a photograph
 * in the airspace between the banner and the platforms. The loader forces
 * image choice questions onto the row layout, so this band is always clear.
 * @param {CanvasRenderingContext2D} cx
 * @param {import('../../sim/round.js').Question} q
 */
function drawQuestionImage(cx, q) {
  const img = q.image ? questionImage(q.image) : null;
  if (!img) return;
  const maxW = 780;
  // The height budget honors a contract the sim tests pin: image questions
  // keep ALL furniture in the bottom band, and the closest thing to the
  // picture is the range rail at y=770 — matte bottom (190 + 420 + 14)
  // clears it by ~145px. Grow maxH only with that budget in mind.
  const maxH = 420;
  // Fit the box; tiny images may grow a little, but never into mush.
  const s = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 2);
  const w = Math.round(img.naturalWidth * s);
  const h = Math.round(img.naturalHeight * s);
  const pad = 14;
  const x = (WORLD_W - w) / 2;
  const y = 190;
  cx.save();
  // A white photographic matte on every theme: clinical images are authored
  // against white, and the matte is what separates them from any sky.
  cx.shadowColor = 'rgba(4,6,24,0.4)';
  cx.shadowBlur = 30;
  cx.shadowOffsetY = 10;
  cx.fillStyle = '#f8f6f1';
  cx.beginPath();
  cx.roundRect(x - pad, y - pad, w + pad * 2, h + pad * 2, 16);
  cx.fill();
  cx.shadowColor = 'rgba(0,0,0,0)';
  cx.drawImage(img, x, y, w, h);
  cx.strokeStyle = 'rgba(23,20,42,0.18)';
  cx.lineWidth = 1.5;
  cx.strokeRect(x, y, w, h);
  cx.restore();
}

/**
 * @param {CanvasRenderingContext2D} cx
 * @param {import('../../sim/round.js').Game} g
 * @param {import('../../sim/round.js').Question} q
 */
function drawControlQuestion(cx, g, q) {
  const h = 150;
  const team = q.team ?? 0;
  const cohort = COHORTS[clampCohort(team)];
  const teamColor = TEAM_COLORS[clampCohort(team)];
  cx.fillStyle = 'rgba(10,8,20,0.9)';
  cx.fillRect(0, 0, WORLD_W, h);

  cx.textBaseline = 'alphabetic';
  cx.textAlign = 'center';
  cx.fillStyle = UI.paper;
  cx.font = fitFont(cx, q.text, WORLD_W - 360, 52, 34);
  cx.fillText(q.text, WORLD_W / 2, 76);

  cx.textAlign = 'left';
  cx.font = `800 20px ${FONT.display}`;
  cx.fillStyle = teamColor;
  cx.fillText(`${cohort.label} TURN`, 40, 42);

  let subline = q.context ?? '';
  if (g.phase === PHASE.INTRO) subline = `${cohort.label} get ready - other teams watching`;
  else if (g.phase === PHASE.LOCK) subline = 'BOARD LOCKED';
  else if ((g.phase === PHASE.REVEAL || g.phase === PHASE.SCORE) && g.controlResult) {
    subline = `${g.controlResult.correct}/${g.controlResult.total} correct${g.controlResult.perfect ? ' - PERFECT BOARD' : ''}`;
  }
  cx.textAlign = 'center';
  cx.font = `750 22px ${FONT.display}`;
  cx.fillStyle = g.phase === PHASE.REVEAL ? UI.gold : UI.faint;
  cx.fillText(subline, WORLD_W / 2, 118);

  const win = answerWindow(g);
  const frac = g.phase === PHASE.ANSWER ? Math.max(0, 1 - g.phaseT / win) : g.phase === PHASE.INTRO ? 1 : 0;
  const secsLeft = (frac * win) / 1000;
  const barY = h - 14;
  cx.fillStyle = 'rgba(255,255,255,0.08)';
  cx.fillRect(0, barY, WORLD_W, 14);
  cx.fillStyle = secsLeft <= 5 ? UI.wrong : secsLeft <= 10 ? UI.warn : teamColor;
  cx.fillRect(0, barY, WORLD_W * frac, 14);

  if (g.phase === PHASE.ANSWER && secsLeft <= 5) {
    cx.textAlign = 'right';
    cx.font = `800 58px ${FONT.display}`;
    cx.fillStyle = UI.wrong;
    cx.fillText(String(Math.ceil(secsLeft)), WORLD_W - 40, 98);
  }
  cx.textAlign = 'left';
}

/**
 * Year-vs-year standings, or null unless at least two years actually have
 * scored players — a solo keyboard test should never show an empty rivalry.
 * @param {import('../../sim/round.js').Game} g
 * @param {Map<number, {cohortIndex?: number, cohortSet?: boolean}>} roster
 * @returns {Array<{count:number, total:number, avg:number}> | null}
 */
function teamsFor(g, roster) {
  const teams = teamStandings(g.scores, (id) => {
    const look = roster.get(id);
    return look?.cohortSet ? clampCohort(look.cohortIndex ?? -1) : -1;
  }, 3, g.teamBonuses);
  return teams.filter((t) => t.count > 0).length >= 2 ? teams : null;
}

/**
 * The rivalry strip: PGY1 / PGY2 / PGY3 average score, leader in gold.
 * Averages, not sums — see teamStandings.
 * @param {CanvasRenderingContext2D} cx
 * @param {Array<{count:number, total:number, avg:number}>} teams
 * @param {number} x @param {number} y @param {number} w
 */
function drawTeamStrip(cx, teams, x, y, w) {
  const best = Math.max(...teams.map((t) => (t.count ? t.avg : -1)));
  const colW = w / teams.length;
  cx.textAlign = 'center';
  teams.forEach((t, i) => {
    const cxp = x + colW * (i + 0.5);
    const leading = t.count > 0 && t.avg === best;
    cx.font = `800 22px ${FONT.display}`;
    cx.fillStyle = leading ? UI.gold : UI.dim;
    cx.fillText(`${leading ? '★ ' : ''}${COHORTS[i].label}`, cxp, y);
    cx.font = `700 26px ${FONT.mono}`;
    cx.fillStyle = t.count ? (leading ? UI.gold : UI.faint) : UI.dim;
    cx.fillText(t.count ? String(t.avg) : '—', cxp, y + 34);
    cx.font = `500 15px ${FONT.ui}`;
    cx.fillStyle = UI.dim;
    cx.fillText(t.count ? `avg of ${t.count}` : 'nobody yet', cxp, y + 58);
  });
  cx.textAlign = 'left';
}

/**
 * @param {CanvasRenderingContext2D} cx
 * @param {import('../../sim/round.js').Game} g
 * @param {Map<number, {name:string, color:string, cohortIndex?: number, cohortSet?: boolean}>} roster
 */
function drawScoreboard(cx, g, roster) {
  if (isControlQuestion(currentQuestion(g))) {
    drawControlScoreboard(cx, g);
    return;
  }
  const rows = g.results.filter((r) => r.correct).slice(0, 10);
  const teams = teamsFor(g, roster);
  const w = 760;
  const rowH = 46;
  const teamH = teams ? 104 : 0;
  const h = 116 + Math.max(1, rows.length) * rowH + teamH;
  const x = (WORLD_W - w) / 2;
  // Sits high: the correct platform and whoever survived on it are the payoff,
  // and burying them under a panel wastes the best moment of the round.
  const y = 190;

  panel(cx, x, y, w, h);
  if (teams) {
    cx.strokeStyle = UI.panelEdge;
    cx.lineWidth = 1;
    cx.beginPath();
    cx.moveTo(x + 28, y + h - teamH + 4);
    cx.lineTo(x + w - 28, y + h - teamH + 4);
    cx.stroke();
    drawTeamStrip(cx, teams, x, y + h - teamH + 36, w);
  }

  cx.textAlign = 'center';
  cx.textBaseline = 'alphabetic';
  cx.font = `800 42px ${FONT.display}`;
  cx.fillStyle = rows.length ? UI.gold : UI.dim;
  cx.fillText(rows.length ? 'Correct!' : 'Nobody got it', WORLD_W / 2, y + 62);

  if (!rows.length) {
    cx.textAlign = 'left';
    return;
  }

  let ry = y + 118;
  for (const r of rows) {
    const look = roster.get(r.id) ?? { name: `#${r.id}`, color: UI.dim };
    cx.textAlign = 'left';
    cx.font = `800 30px ${FONT.display}`;
    cx.fillStyle = r.rank <= 3 ? UI.gold : UI.faint;
    cx.fillText(ordinal(r.rank), x + 32, ry);

    cx.fillStyle = look.color;
    cx.font = `700 30px ${FONT.display}`;
    cx.fillText(look.name.slice(0, 14), x + 116, ry);

    cx.textAlign = 'right';
    cx.fillStyle = UI.faint;
    cx.font = `500 24px ${FONT.mono}`;
    // Sort rounds: arrival times don't compare across items, so the middle
    // column carries items-landed instead of a photo-finish clock.
    const mid =
      r.hits !== undefined
        ? `${r.hits}/${currentQuestion(g)?.items?.length ?? r.hits}`
        : `${(r.arrivalMs / 1000).toFixed(1)}s`;
    cx.fillText(mid, x + w - 180, ry);

    cx.fillStyle = UI.paper;
    cx.font = `800 30px ${FONT.display}`;
    cx.fillText(`+${r.points}`, x + w - 32, ry);
    ry += rowH;
  }
  cx.textAlign = 'left';
}

/** @param {CanvasRenderingContext2D} cx @param {import('../../sim/round.js').Game} g */
function drawControlScoreboard(cx, g) {
  const result = g.controlResult;
  if (!result) return;
  const cohort = COHORTS[clampCohort(result.team)];
  const teamColor = TEAM_COLORS[clampCohort(result.team)];
  const w = 700;
  const h = 250;
  const x = (WORLD_W - w) / 2;
  const y = 205;
  panel(cx, x, y, w, h, result.perfect ? UI.gold : teamColor);

  cx.textAlign = 'center';
  cx.textBaseline = 'alphabetic';
  cx.font = `800 38px ${FONT.display}`;
  cx.fillStyle = teamColor;
  cx.fillText(cohort.label, WORLD_W / 2, y + 58);
  cx.font = `900 72px ${FONT.display}`;
  cx.fillStyle = result.perfect ? UI.gold : UI.paper;
  cx.fillText(`${result.correct}/${result.total}`, WORLD_W / 2, y + 140);
  cx.font = `800 30px ${FONT.display}`;
  cx.fillStyle = UI.faint;
  cx.fillText(`+${result.points} team points`, WORLD_W / 2, y + 194);
  cx.textAlign = 'left';
}

/**
 * @param {CanvasRenderingContext2D} cx
 * @param {import('../../sim/round.js').Game} g
 * @param {Map<number, {name:string, color:string, cohortIndex?: number, cohortSet?: boolean}>} roster
 */
function drawFinal(cx, g, roster) {
  const top = standings(g).slice(0, 10);
  const teams = teamsFor(g, roster);
  const w = 800;
  const rowH = 50;
  const teamH = teams ? 96 : 0;
  const h = 150 + Math.max(1, top.length) * rowH + teamH;
  const x = (WORLD_W - w) / 2;
  const y = (WORLD_H - h) / 2;

  panel(cx, x, y, w, h, UI.gold);

  cx.textAlign = 'center';
  cx.textBaseline = 'alphabetic';
  cx.font = `800 54px ${FONT.display}`;
  cx.fillStyle = UI.gold;
  cx.fillText('Final scores', WORLD_W / 2, y + 78);
  cx.font = `600 24px ${FONT.ui}`;
  cx.fillStyle = UI.faint;
  cx.fillText('R  play again        Q  main menu', WORLD_W / 2, y + 114);

  // The year rivalry gets the top slot on the final board — it's the thing
  // the whole room shares, where individual rank belongs to one person.
  if (teams) drawTeamStrip(cx, teams, x, y + 156, w);

  let ry = y + 178 + teamH;
  top.forEach((s, i) => {
    const look = roster.get(s.id) ?? { name: `#${s.id}`, color: UI.dim };
    cx.textAlign = 'left';
    cx.font = `800 32px ${FONT.display}`;
    cx.fillStyle = i < 3 ? UI.gold : UI.faint;
    cx.fillText(ordinal(i + 1), x + 36, ry);
    cx.fillStyle = look.color;
    cx.fillText(look.name.slice(0, 14), x + 128, ry);
    cx.textAlign = 'right';
    cx.fillStyle = UI.paper;
    cx.fillText(String(s.score), x + w - 36, ry);
    ry += rowH;
  });
  cx.textAlign = 'left';
}

/**
 * The veil for the lobby's two display cards (setup + join). Light families
 * push far more luminance through the frost, so they keep more veil than the
 * dark ones — both land where the breathing sky shows through but white text
 * still reads at projector distance.
 * @returns {number}
 */
export function lobbyVeil() {
  return glassFam().light ? 0.52 : 0.4;
}

/**
 * @param {CanvasRenderingContext2D} cx
 * @param {number} x @param {number} y @param {number} w @param {number} h
 * @param {string} [edge]
 * @param {{veil?: number}} [opts] veil is the dark wash's alpha over the
 *   frost (default 0.62). Dense-text panels — scoreboards, banners — need
 *   the full veil for contrast; the lobby's big display cards use
 *   lobbyVeil() so the breathing sky visibly bleeds through their glass.
 */
export function panel(cx, x, y, w, h, edge, opts = {}) {
  if (themeName() === 'glass') {
    // Panels are cut from the same glass as the platforms: a frosted window
    // onto the sky under a dark veil (the veil is what keeps white text
    // readable over the bright blobs), a sheen, and a light rim.
    const frost = glassFrost(WORLD_W, WORLD_H);
    const r = 24;
    cx.save();
    cx.beginPath();
    cx.roundRect(x, y, w, h, r);
    cx.shadowColor = 'rgba(4,6,24,0.45)';
    cx.shadowBlur = 34;
    cx.shadowOffsetY = 14;
    cx.fillStyle = 'rgba(14,10,30,0.72)';
    cx.fill();
    cx.shadowColor = 'rgba(0,0,0,0)';
    cx.clip();
    if (frost) {
      cx.drawImage(frost, 0, 0);
      // The live half of the frost — this frame's blobs, so the panel's
      // window shows the same colours as the sky around it.
      drawFrostBlobs(cx, WORLD_W, WORLD_H);
      cx.fillStyle = `rgba(12,8,28,${opts.veil ?? 0.62})`;
      cx.fillRect(x, y, w, h);
    }
    const sheen = cx.createLinearGradient(x, y, x + w * 0.6, y + h);
    sheen.addColorStop(0, 'rgba(255,255,255,0.10)');
    sheen.addColorStop(0.4, 'rgba(255,255,255,0.02)');
    sheen.addColorStop(1, 'rgba(255,255,255,0)');
    cx.fillStyle = sheen;
    cx.fillRect(x, y, w, h);
    cx.restore();

    cx.save();
    cx.beginPath();
    cx.roundRect(x + 1, y + 1, w - 2, h - 2, r - 1);
    cx.strokeStyle = edge ?? 'rgba(255,255,255,0.32)';
    cx.lineWidth = edge ? 3 : 1.5;
    cx.stroke();
    cx.restore();
    return;
  }
  cx.fillStyle = UI.panel;
  cx.beginPath();
  cx.roundRect(x, y, w, h, 20);
  cx.fill();
  cx.strokeStyle = edge ?? UI.panelEdge;
  cx.lineWidth = edge ? 3 : 2;
  cx.stroke();
}

/** @param {number} n @returns {string} */
function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

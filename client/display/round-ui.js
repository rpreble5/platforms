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
import { drawBean } from '../../shared/avatar.js';
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
 * @property {Array<{file:string, name:string, questions:number, showdown:boolean, controlRoom?:number}>} packs
 * @property {number} packIndex
 * @property {number} sel
 * @property {boolean} loading
 * @property {Array<'pack'|'time'|'mode'|'quiz'|'control'|'showdown'>} items
 * @property {number} answerMs
 * @property {'solo'|'teams'} mode
 * @property {number[]} [cohortCounts] committed + connected players per year
 * @property {number} [controlCases] size of the pack's Control Room pool
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
  void playerCount; // the join panel owns the headcount now
  const pack = menu.packs[menu.packIndex];
  const x0 = 40;
  const y0 = 118;
  const w = 520;
  const pad = 34;

  // Masthead, above the card. Ink on the light glass families — white
  // vanishes against their near-white upper corner.
  cx.textAlign = 'left';
  cx.textBaseline = 'alphabetic';
  cx.font = `800 46px ${FONT.display}`;
  cx.fillStyle = themeName() === 'glass' && glassFam().light
    ? glassFam().text
    : 'rgba(255,255,255,0.92)';
  cx.fillText(WORDMARK, x0 + 4, 88);

  // Which start buttons are honest right now?
  const counts = menu.cohortCounts ?? [0, 0, 0];
  const activeTeams = counts.filter((n) => n > 0).length;
  const controlReady = activeTeams >= 1 && (menu.controlCases ?? 0) >= activeTeams;
  const controlReason = !activeTeams
    ? 'teams only — needs at least one committed PGY year'
    : `needs ${activeTeams} case${activeTeams === 1 ? '' : 's'} · pack has ${menu.controlCases ?? 0}`;

  const actions = menu.items.filter((it) => it === 'quiz' || it === 'control' || it === 'showdown');
  const packH = 128;
  const rowH = 54;
  const stripH = 84;
  const btnH = 68;
  const h = pad + packH + 2 * rowH + 16 + stripH + 18 + actions.length * (btnH + 12) + pad - 12;
  // Lighter veil than the round furniture: the lobby is where the breathing
  // sky gets to show off, and this card's text is big enough to carry it.
  panel(cx, x0, y0, w, h, undefined, { veil: lobbyVeil() });

  const sel = menu.items[menu.sel];
  /** a brighter piece of glass behind whatever the cursor is on */
  const pill = (/** @type {number} */ py, /** @type {number} */ ph) => {
    cx.fillStyle = 'rgba(255,255,255,0.10)';
    cx.strokeStyle = 'rgba(255,255,255,0.38)';
    cx.lineWidth = 1.5;
    cx.beginPath();
    cx.roundRect(x0 + 16, py, w - 32, ph, 14);
    cx.fill();
    cx.stroke();
  };

  // ---- the pack, presented rather than crammed into a row
  let y = y0 + pad;
  if (sel === 'pack') pill(y - 12, packH);
  cx.font = `700 15px ${FONT.ui}`;
  cx.fillStyle = 'rgba(255,255,255,0.45)';
  cx.fillText('PACK', x0 + pad, y + 8);
  const name = menu.loading ? 'loading…' : pack ? pack.name : '—';
  cx.font = fitFont(cx, name, w - pad * 2 - 76, 42, 22);
  cx.fillStyle = '#ffffff';
  cx.fillText(name, x0 + pad, y + 56);
  if (sel === 'pack') {
    cx.font = `800 30px ${FONT.display}`;
    cx.fillStyle = 'rgba(255,255,255,0.75)';
    cx.textAlign = 'right';
    cx.fillText('◂ ▸', x0 + w - pad + 6, y + 54);
    cx.textAlign = 'left';
  }
  if (pack) {
    // The bucket labels say their mode out loud: Control Room is a teams
    // bucket, and a free-for-all game will simply not play it.
    const bits = [`${pack.questions} questions`];
    if (pack.controlRoom) bits.push('control room (teams)');
    if (pack.showdown) bits.push('showdown');
    const bitsLine = bits.join('  ·  ');
    cx.font = fitFont(cx, bitsLine, w - pad * 2, 20, 13);
    cx.fillStyle = 'rgba(255,255,255,0.55)';
    cx.fillText(bitsLine, x0 + pad, y + 92);
  }
  y += packH;

  // ---- the two settings
  /** @type {Array<['time'|'mode', string, string]>} */
  const settingRows = [
    ['time', 'Answer time', `${Math.round(menu.answerMs / 1000)}s`],
    ['mode', 'Teams', menu.mode === 'teams' ? 'PGY years' : 'off'],
  ];
  for (const [key, label, value] of settingRows) {
    const selected = sel === key;
    if (selected) pill(y + 2, rowH - 4);
    const base = y + rowH / 2 + 9;
    cx.font = `700 25px ${FONT.display}`;
    cx.fillStyle = selected ? '#ffffff' : 'rgba(255,255,255,0.8)';
    cx.fillText(label, x0 + pad, base);
    cx.textAlign = 'right';
    cx.font = `600 24px ${FONT.ui}`;
    cx.fillStyle = selected ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.55)';
    cx.fillText(selected ? `◂  ${value}  ▸` : value, x0 + w - pad, base);
    cx.textAlign = 'left';
    y += rowH;
  }

  y += 16;

  // ---- who is actually in: live committed headcount per year, as beans.
  // This is what makes the start buttons below honest — the host can SEE
  // whether teams play makes sense before pressing anything.
  cx.strokeStyle = 'rgba(255,255,255,0.14)';
  cx.lineWidth = 1;
  cx.beginPath();
  cx.moveTo(x0 + 24, y - 8);
  cx.lineTo(x0 + w - 24, y - 8);
  cx.stroke();
  const colW = (w - pad * 2) / 3;
  const feet = y + stripH - 26;
  for (let c = 0; c < 3; c++) {
    const cxp = x0 + pad + colW * c + 10;
    const bh = [30, 38, 52][c];
    cx.save();
    cx.translate(cxp, feet - bh);
    drawBean(cx, TEAM_COLORS[c], 'flat', 27, bh, COHORTS[c].shape, true, 'none');
    cx.restore();
    cx.font = `800 26px ${FONT.display}`;
    cx.fillStyle = counts[c] ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.3)';
    cx.fillText(`×${counts[c]}`, cxp + 38, feet - 6);
    cx.font = `700 14px ${FONT.ui}`;
    cx.fillStyle = counts[c] ? TEAM_COLORS[c] : 'rgba(255,255,255,0.3)';
    cx.fillText(COHORTS[c].label, cxp + 1, feet + 18);
  }
  y += stripH + 18;

  // ---- the ways to begin, as real buttons. The selected one glows with the
  // same light the correct answer gets; an unready one says WHY, up front.
  for (const item of actions) {
    const selected = sel === item;
    const disabled = item === 'control' && !controlReady;
    const label = item === 'quiz' ? 'Start quiz' : item === 'control' ? 'Start Control Room' : 'Start showdown';
    // Each button states what its mode will actually play, so the bucket
    // rules are visible before anyone presses anything.
    const sub =
      item === 'control'
        ? disabled ? controlReason : 'teams take turns'
        : item === 'showdown'
          ? 'no points · last one standing'
          : menu.mode === 'teams'
            ? (menu.controlCases ?? 0) > 0 ? 'teams · Control Room turns between questions' : 'teams by PGY year'
            : 'free-for-all';

    cx.save();
    cx.beginPath();
    cx.roundRect(x0 + 24, y, w - 48, btnH, 16);
    if (selected && !disabled) {
      cx.shadowColor = 'rgba(255,255,255,0.85)';
      cx.shadowBlur = 26;
    }
    cx.fillStyle = disabled
      ? 'rgba(255,255,255,0.04)'
      : selected ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.09)';
    cx.fill();
    cx.shadowColor = 'rgba(0,0,0,0)';
    cx.strokeStyle = disabled
      ? selected ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.12)'
      : selected ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.28)';
    cx.lineWidth = selected ? 2.5 : 1.5;
    cx.stroke();
    cx.restore();

    cx.textAlign = 'center';
    const ink = disabled ? 'rgba(255,255,255,0.35)' : selected ? '#ffffff' : 'rgba(255,255,255,0.85)';
    if (sub) {
      cx.font = `800 26px ${FONT.display}`;
      cx.fillStyle = ink;
      cx.fillText(label, x0 + w / 2, y + 32);
      cx.font = `600 15px ${FONT.ui}`;
      cx.fillStyle = disabled ? 'rgba(255,215,120,0.75)' : 'rgba(255,255,255,0.5)';
      cx.fillText(sub, x0 + w / 2, y + 54);
    } else {
      cx.font = `800 28px ${FONT.display}`;
      cx.fillStyle = ink;
      cx.fillText(label, x0 + w / 2, y + btnH / 2 + 10);
    }
    cx.textAlign = 'left';
    y += btnH + 12;
  }
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

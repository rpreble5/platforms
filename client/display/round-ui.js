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
import { COHORTS, clampCohort } from '../../shared/palette.js';
import { RANGE_ID } from '../../sim/levels.js';
import { PHASE, answerWindow, currentQuestion, standings, teamStandings } from '../../sim/round.js';
import { drawFloor, drawNumberLine, drawRangeReveal, drawSign, drawSignText, fitFont } from './stage.js';
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
  const revealing = g.phase === PHASE.REVEAL || g.phase === PHASE.SCORE;

  if (q?.type === 'range') {
    const rq = /** @type {import('../../sim/levels.js').RangeQuestion} */ (q);
    if (revealing) {
      // The outer floor is gone — a full number line over the void would read
      // as a glitch. The band and its interval are the whole story now.
      const band = world.platforms.find((p) => p.id === RANGE_ID);
      if (band) drawRangeReveal(cx, band, rq);
    } else {
      drawNumberLine(cx, rq);
    }
    return;
  }

  for (const p of world.platforms) {
    if (!p.id?.startsWith('ans')) continue;
    const i = Number(p.id.slice(3));
    const state = revealing && q && i === q.correct ? 'correct' : 'idle';
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
 * @property {Array<{file:string, name:string, questions:number, showdown:boolean}>} packs
 * @property {number} packIndex
 * @property {number} sel
 * @property {boolean} loading
 * @property {Array<'pack'|'time'|'quiz'|'showdown'>} items
 * @property {number} answerMs
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
 * The lobby menu. An overlay panel, deliberately NOT a screen: the world runs
 * live behind it, so people warm up, find their avatar, and keep joining
 * while the host picks a pack. Setup time is play time.
 * @param {CanvasRenderingContext2D} cx
 * @param {MenuView} menu
 * @param {number} playerCount
 */
function drawMenu(cx, menu, playerCount) {
  const joined = Math.max(0, playerCount - 1);
  const pack = menu.packs[menu.packIndex];
  const rowH = 64;
  const w = 880;
  const h = 196 + menu.items.length * rowH;
  // Right of the latency HUD's column, left of the QR: the one strip of sky
  // nothing else claims.
  const x0 = 420;
  panel(cx, x0, 64, w, h);

  cx.fillStyle = UI.paper;
  cx.font = `800 58px ${FONT.display}`;
  cx.textAlign = 'left';
  cx.textBaseline = 'alphabetic';
  cx.fillText('Scan to join', x0 + 40, 142);

  cx.font = `600 26px ${FONT.ui}`;
  cx.fillStyle = joined ? UI.correct : UI.dim;
  cx.fillText(
    joined ? `${joined} player${joined === 1 ? '' : 's'} in — run around, more can join any time` : 'waiting for players…',
    x0 + 40, 186
  );

  /** @param {'pack'|'time'|'quiz'|'showdown'} item @returns {[string, string]} */
  const rowText = (item) => {
    switch (item) {
      case 'pack':
        return [
          'Pack',
          menu.loading
            ? 'loading…'
            : pack
              ? `◂ ${pack.name} (${pack.questions} questions${pack.showdown ? ' + showdown' : ''}) ▸`
              : '—',
        ];
      case 'time':
        return ['Answer time', `◂ ${Math.round(menu.answerMs / 1000)}s ▸`];
      case 'quiz':
        return ['Start quiz', ''];
      case 'showdown':
        return ['Start showdown ☠', 'no points — last one standing'];
      default:
        return ['', ''];
    }
  };

  let ry = 236;
  menu.items.forEach((item, i) => {
    const selected = i === menu.sel;
    if (selected) {
      cx.fillStyle = 'rgba(255,255,255,0.08)';
      cx.beginPath();
      cx.roundRect(x0 + 24, ry - 40, w - 48, 56, 12);
      cx.fill();
    }
    const [label, value] = rowText(item);
    cx.font = `800 32px ${FONT.display}`;
    cx.fillStyle = selected ? UI.gold : UI.paper;
    cx.fillText(`${selected ? '▸ ' : '  '}${label}`, x0 + 40, ry);

    if (value) {
      cx.textAlign = 'right';
      cx.font = `600 26px ${FONT.ui}`;
      cx.fillStyle = selected ? UI.paper : UI.dim;
      cx.fillText(value, x0 + w - 40, ry);
      cx.textAlign = 'left';
    }
    ry += rowH;
  });

  cx.font = `500 20px ${FONT.ui}`;
  cx.fillStyle = UI.dim;
  cx.fillText('↑↓ select · ←→ change · Enter go · or drive it from the host page', x0 + 40, 64 + h - 28);
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
  cx.fillStyle = joined ? UI.correct : UI.dim;
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

  const h = 150;
  cx.fillStyle = 'rgba(10,8,20,0.9)';
  cx.fillRect(0, 0, WORLD_W, h);

  cx.textBaseline = 'alphabetic';
  cx.fillStyle = UI.paper;
  cx.textAlign = 'center';
  cx.font = fitFont(cx, q.text, WORLD_W - 340, 74, 34);
  cx.fillText(q.text, WORLD_W / 2, 90);

  cx.font = `700 24px ${FONT.mono}`;
  cx.fillStyle = UI.faint;
  cx.textAlign = 'left';
  cx.fillText(`Q${g.qIndex + 1}/${g.questions.length}`, 40, 90);

  // Timer as a full-width bar rather than digits: readable out of the corner of
  // your eye while you're running, from anywhere in the room.
  const win = answerWindow(g);
  const frac = g.phase === PHASE.ANSWER ? Math.max(0, 1 - g.phaseT / win) : g.phase === PHASE.INTRO ? 1 : 0;
  const secsLeft = (frac * win) / 1000;

  const barY = h - 14;
  cx.fillStyle = 'rgba(255,255,255,0.08)';
  cx.fillRect(0, barY, WORLD_W, 14);
  cx.fillStyle = secsLeft <= 3 ? UI.wrong : secsLeft <= 6 ? UI.warn : UI.correct;
  cx.fillRect(0, barY, WORLD_W * frac, 14);

  if (g.phase === PHASE.ANSWER && secsLeft <= 3) {
    cx.textAlign = 'right';
    cx.font = `800 58px ${FONT.display}`;
    cx.fillStyle = UI.wrong;
    cx.fillText(String(Math.ceil(secsLeft)), WORLD_W - 40, 98);
  }

  if (g.phase === PHASE.INTRO) {
    cx.textAlign = 'center';
    cx.font = `700 26px ${FONT.ui}`;
    cx.fillStyle = UI.dim;
    cx.fillText('get ready…', WORLD_W / 2, 128);
  }

  // Say it out loud, or the settle reads as the game having hung.
  if (g.phase === PHASE.LOCK) {
    cx.textAlign = 'center';
    cx.font = `800 30px ${FONT.display}`;
    cx.fillStyle = UI.warn;
    cx.fillText("TIME'S UP", WORLD_W / 2, 130);
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
  });
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
  cx.fillStyle = rows.length ? UI.correct : UI.dim;
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
    cx.fillText(`${(r.arrivalMs / 1000).toFixed(1)}s`, x + w - 180, ry);

    cx.fillStyle = UI.paper;
    cx.font = `800 30px ${FONT.display}`;
    cx.fillText(`+${r.points}`, x + w - 32, ry);
    ry += rowH;
  }
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
  cx.fillText('press R to play again', WORLD_W / 2, y + 114);

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
 * @param {CanvasRenderingContext2D} cx
 * @param {number} x @param {number} y @param {number} w @param {number} h
 * @param {string} [edge]
 */
function panel(cx, x, y, w, h, edge) {
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

/**
 * Everything the round draws: question banner, answer plates, timer, reveal,
 * scoreboard.
 *
 * Sizing throughout assumes the viewer is 5+ metres away, which is the real
 * constraint on a party screen — anything that needs leaning in has failed.
 */

import { WORLD_H, WORLD_W } from '../../shared/tuning.js';
import { answerId } from '../../sim/levels.js';
import { PHASE, answerWindow, currentQuestion, standings } from '../../sim/round.js';

const SANS = 'ui-sans-serif, system-ui, -apple-system, sans-serif';
const CORRECT = '#2fc98d';
const WRONG = '#ff5a3c';

/**
 * Answer plates hang *below* their platform, in the clear space above the
 * floor, so a crowd standing on the platform never covers the thing they're
 * voting for.
 * @param {CanvasRenderingContext2D} cx
 * @param {import('../../sim/world.js').World} world
 * @param {import('../../sim/round.js').Game} g
 */
export function drawAnswerPlates(cx, world, g) {
  const q = currentQuestion(g);
  if (!q || g.phase === PHASE.LOBBY || g.phase === PHASE.GAME_OVER) return;

  const revealing = g.phase === PHASE.REVEAL || g.phase === PHASE.SCORE;

  q.answers.forEach((text, i) => {
    const plat = world.platforms.find((p) => p.id === answerId(i)) ?? g.debris.find((p) => p.id === answerId(i));
    if (!plat) return;

    const isCorrect = i === q.correct;
    const fall = revealing && !isCorrect ? fallOffset(g.phaseT) : 0;
    const cxp = plat.x + plat.w / 2;
    const y = plat.y + plat.h + 14 + fall;
    const h = 62;
    const w = plat.w;

    cx.save();
    cx.globalAlpha = fall > 0 ? Math.max(0, 1 - fall / 500) : 1;

    cx.fillStyle = revealing ? (isCorrect ? 'rgba(47,201,141,0.22)' : 'rgba(255,90,60,0.18)') : 'rgba(10,14,24,0.85)';
    cx.beginPath();
    cx.roundRect(cxp - w / 2, y, w, h, 12);
    cx.fill();
    cx.lineWidth = revealing && isCorrect ? 4 : 2;
    cx.strokeStyle = revealing ? (isCorrect ? CORRECT : WRONG) : 'rgba(120,136,168,0.5)';
    cx.stroke();

    // Never colour alone: an icon carries the verdict for colourblind viewers
    // and for projectors that mangle hue.
    let textW = w - 28;
    if (revealing) {
      textW -= 46;
      cx.fillStyle = isCorrect ? CORRECT : WRONG;
      cx.font = `700 34px ${SANS}`;
      cx.textAlign = 'center';
      cx.fillText(isCorrect ? '✓' : '✕', cxp - w / 2 + 32, y + h / 2 + 12);
    }

    cx.fillStyle = revealing && !isCorrect ? '#9aa4b6' : '#eef3fb';
    cx.textAlign = 'center';
    cx.font = fitFont(cx, text, textW, 40, 20);
    cx.fillText(text, cxp + (revealing ? 20 : 0), y + h / 2 + 11);
    cx.restore();
  });
}

/**
 * Wrong platforms keep being drawn for a beat after they stop being solid, so
 * the fall reads as consequence rather than as the platform blinking out.
 * @param {CanvasRenderingContext2D} cx
 * @param {import('../../sim/round.js').Game} g
 */
export function drawDebris(cx, g) {
  if (!g.debris.length) return;
  const fall = fallOffset(g.phaseT);
  const tilt = Math.min(0.25, g.phaseT / 4000);
  for (const p of g.debris) {
    cx.save();
    cx.globalAlpha = Math.max(0, 1 - fall / 700);
    cx.translate(p.x + p.w / 2, p.y + fall);
    cx.rotate((p.x > WORLD_W / 2 ? 1 : -1) * tilt);
    cx.fillStyle = '#39435f';
    cx.beginPath();
    cx.roundRect(-p.w / 2, 0, p.w, p.h, 8);
    cx.fill();
    cx.restore();
  }
}

/** @param {number} t */
function fallOffset(t) {
  const s = t / 1000;
  return 0.5 * 2600 * s * s;
}

/**
 * @param {CanvasRenderingContext2D} cx
 * @param {import('../../sim/round.js').Game} g
 * @param {Map<number, {name:string, color:string}>} roster
 * @param {number} playerCount
 */
export function drawRoundOverlay(cx, g, roster, playerCount) {
  switch (g.phase) {
    case PHASE.LOBBY:
      drawLobby(cx, playerCount);
      break;
    case PHASE.INTRO:
    case PHASE.ANSWER:
    case PHASE.LOCK:
      drawQuestion(cx, g);
      break;
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
 * @param {CanvasRenderingContext2D} cx
 * @param {number} playerCount
 */
function drawLobby(cx, playerCount) {
  cx.fillStyle = 'rgba(6,9,16,0.72)';
  cx.beginPath();
  cx.roundRect(80, 70, 900, 170, 18);
  cx.fill();
  cx.fillStyle = '#eef3fb';
  cx.font = `800 62px ${SANS}`;
  cx.textAlign = 'left';
  cx.fillText('Scan to join', 120, 150);
  cx.font = `500 30px ${SANS}`;
  cx.fillStyle = playerCount > 1 ? CORRECT : '#8b95a8';
  cx.fillText(
    playerCount > 1 ? `${playerCount - 1} in — press SPACE to start` : 'waiting for players…',
    120, 200
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
  cx.fillStyle = 'rgba(6,9,16,0.88)';
  cx.fillRect(0, 0, WORLD_W, h);

  cx.fillStyle = '#eef3fb';
  cx.textAlign = 'center';
  cx.font = fitFont(cx, q.text, WORLD_W - 320, 72, 34);
  cx.fillText(q.text, WORLD_W / 2, 88);

  cx.font = `600 24px ${SANS}`;
  cx.fillStyle = '#5f6b80';
  cx.textAlign = 'left';
  cx.fillText(`Q${g.qIndex + 1} / ${g.questions.length}`, 40, 88);

  // Timer as a full-width bar rather than digits: legible from anywhere in the
  // room and readable out of the corner of your eye while you're running.
  const window = answerWindow(g);
  let frac = 1;
  if (g.phase === PHASE.ANSWER) frac = Math.max(0, 1 - g.phaseT / window);
  else if (g.phase === PHASE.INTRO) frac = 1;
  else frac = 0;

  const barY = h - 12;
  cx.fillStyle = 'rgba(255,255,255,0.07)';
  cx.fillRect(0, barY, WORLD_W, 12);
  const secsLeft = frac * window / 1000;
  cx.fillStyle = secsLeft <= 3 ? WRONG : secsLeft <= 6 ? '#ffa62b' : CORRECT;
  cx.fillRect(0, barY, WORLD_W * frac, 12);

  if (g.phase === PHASE.ANSWER && secsLeft <= 3) {
    cx.textAlign = 'right';
    cx.font = `800 56px ${SANS}`;
    cx.fillStyle = WRONG;
    cx.fillText(String(Math.ceil(secsLeft)), WORLD_W - 40, 96);
  }

  if (g.phase === PHASE.INTRO) {
    cx.textAlign = 'center';
    cx.font = `600 26px ${SANS}`;
    cx.fillStyle = '#8b95a8';
    cx.fillText('get ready…', WORLD_W / 2, 130);
  }
  cx.textAlign = 'left';
}

/**
 * @param {CanvasRenderingContext2D} cx
 * @param {import('../../sim/round.js').Game} g
 * @param {Map<number, {name:string, color:string}>} roster
 */
function drawScoreboard(cx, g, roster) {
  const rows = g.results.filter((r) => r.correct).slice(0, 10);
  const w = 720;
  const rowH = 46;
  const h = 110 + Math.max(1, rows.length) * rowH;
  const x = (WORLD_W - w) / 2;
  const y = (WORLD_H - h) / 2 + 40;

  cx.fillStyle = 'rgba(6,9,16,0.93)';
  cx.beginPath();
  cx.roundRect(x, y, w, h, 20);
  cx.fill();
  cx.strokeStyle = 'rgba(120,136,168,0.35)';
  cx.lineWidth = 2;
  cx.stroke();

  cx.textAlign = 'center';
  cx.font = `800 40px ${SANS}`;
  cx.fillStyle = CORRECT;
  cx.fillText(rows.length ? 'Correct!' : 'Nobody got it', WORLD_W / 2, y + 60);

  if (!rows.length) {
    cx.textAlign = 'left';
    return;
  }

  let ry = y + 112;
  for (const r of rows) {
    const look = roster.get(r.id) ?? { name: `#${r.id}`, color: '#8892a6' };
    cx.textAlign = 'left';
    cx.font = `700 30px ${SANS}`;
    cx.fillStyle = r.rank <= 3 ? '#ffd93d' : '#5f6b80';
    cx.fillText(ordinal(r.rank), x + 30, ry);

    cx.fillStyle = look.color;
    cx.font = `600 30px ${SANS}`;
    cx.fillText(look.name.slice(0, 14), x + 110, ry);

    cx.textAlign = 'right';
    cx.fillStyle = '#8b95a8';
    cx.font = `500 24px ${SANS}`;
    cx.fillText(`${(r.arrivalMs / 1000).toFixed(1)}s`, x + w - 170, ry);

    cx.fillStyle = '#eef3fb';
    cx.font = `700 30px ${SANS}`;
    cx.fillText(`+${r.points}`, x + w - 30, ry);
    ry += rowH;
  }
  cx.textAlign = 'left';
}

/**
 * @param {CanvasRenderingContext2D} cx
 * @param {import('../../sim/round.js').Game} g
 * @param {Map<number, {name:string, color:string}>} roster
 */
function drawFinal(cx, g, roster) {
  const top = standings(g).slice(0, 10);
  const w = 760;
  const rowH = 50;
  const h = 140 + Math.max(1, top.length) * rowH;
  const x = (WORLD_W - w) / 2;
  const y = (WORLD_H - h) / 2;

  cx.fillStyle = 'rgba(6,9,16,0.95)';
  cx.beginPath();
  cx.roundRect(x, y, w, h, 22);
  cx.fill();
  cx.strokeStyle = 'rgba(255,217,61,0.5)';
  cx.lineWidth = 3;
  cx.stroke();

  cx.textAlign = 'center';
  cx.font = `800 52px ${SANS}`;
  cx.fillStyle = '#ffd93d';
  cx.fillText('Final scores', WORLD_W / 2, y + 76);
  cx.font = `500 24px ${SANS}`;
  cx.fillStyle = '#5f6b80';
  cx.fillText('press R to play again', WORLD_W / 2, y + 112);

  let ry = y + 172;
  top.forEach((s, i) => {
    const look = roster.get(s.id) ?? { name: `#${s.id}`, color: '#8892a6' };
    cx.textAlign = 'left';
    cx.font = `700 32px ${SANS}`;
    cx.fillStyle = i < 3 ? '#ffd93d' : '#5f6b80';
    cx.fillText(ordinal(i + 1), x + 34, ry);
    cx.fillStyle = look.color;
    cx.fillText(look.name.slice(0, 14), x + 120, ry);
    cx.textAlign = 'right';
    cx.fillStyle = '#eef3fb';
    cx.fillText(String(s.score), x + w - 34, ry);
    ry += rowH;
  });
  cx.textAlign = 'left';
}

/** @param {number} n @returns {string} */
function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/**
 * Largest size in the range that fits, so a long answer shrinks rather than
 * running off its plate.
 * @param {CanvasRenderingContext2D} cx
 * @param {string} text @param {number} maxW @param {number} max @param {number} min
 * @returns {string}
 */
function fitFont(cx, text, maxW, max, min) {
  let size = max;
  for (; size > min; size--) {
    cx.font = `800 ${size}px ${SANS}`;
    if (cx.measureText(text).width <= maxW) break;
  }
  return `800 ${size}px ${SANS}`;
}

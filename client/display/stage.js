/**
 * The stage: sky, floor, and the answer signboards.
 *
 * Every draw here takes the sprite if it has loaded and falls back to shapes if
 * it hasn't, so the game looks intentional with an empty assets/ folder and you
 * can add PNGs one at a time.
 *
 * The signboard is the important idea. The platform is 28px of collision, but
 * it's *drawn* 76px tall with the extra hanging below the landing surface, and
 * the answer text lives in that skirt. One object instead of a platform plus a
 * floating label: it's unambiguous which answer belongs to which platform, the
 * label falls with the platform on reveal, and it fits the 132px of vertical
 * space between the platform and the heads of the crowd on the floor.
 */

import { WORLD_H, WORLD_W } from '../../shared/tuning.js';
import { ANSWER_H, ANSWER_SIGN_H, FLOOR_Y, rangeX } from '../../sim/levels.js';
import { SPRITES, art, drawTileBox, drawTiled, has } from './art.js';
import { FONT, INK, SKY, STAGE, UI } from './theme.js';

/** @typedef {import('../../sim/collide.js').Platform} Platform */

/**
 * @param {CanvasRenderingContext2D} cx
 * @param {number} t world time, for anything that drifts
 */
export function drawSky(cx, t) {
  if (has('bg')) {
    cx.drawImage(art.bg, 0, 0, WORLD_W, WORLD_H);
    return;
  }
  const g = cx.createLinearGradient(0, 0, 0, WORLD_H);
  g.addColorStop(0, SKY.top);
  g.addColorStop(1, SKY.bottom);
  cx.fillStyle = g;
  cx.fillRect(0, 0, WORLD_W, WORLD_H);

  // Low flat hills. Kept dull and kept below the question banner on purpose —
  // scenery that competes with 30 saturated avatars is a bug, not decoration.
  drawHills(cx, 700, 240, 5, 0.6, SKY.hillFar);
  drawHills(cx, 790, 190, 4, 1.9, SKY.hill);
  void t;
}

/**
 * @param {CanvasRenderingContext2D} cx
 * @param {number} baseY @param {number} r @param {number} count
 * @param {number} phase @param {string} fill
 */
function drawHills(cx, baseY, r, count, phase, fill) {
  // One continuous silhouette. Each arc's start point is joined to the previous
  // one automatically, so the whole ridge plus the ground below is a single
  // closed path — separate subpaths would fill as floating half-circles.
  const pad = r * 2;
  cx.fillStyle = fill;
  cx.beginPath();
  cx.moveTo(-pad, WORLD_H);
  cx.lineTo(-pad, baseY);
  for (let i = 0; i <= count; i++) {
    const x = (i / count) * (WORLD_W + pad * 2) - pad;
    const rr = r * (0.6 + 0.4 * Math.sin(i * 1.7 + phase));
    cx.arc(x, baseY, rr, Math.PI, 0);
  }
  cx.lineTo(WORLD_W + pad, baseY);
  cx.lineTo(WORLD_W + pad, WORLD_H);
  cx.closePath();
  cx.fill();
}

/**
 * @param {CanvasRenderingContext2D} cx
 * @param {Platform} p
 */
export function drawFloor(cx, p) {
  const visibleH = WORLD_H - FLOOR_Y + 4;
  if (has('floor')) {
    // Nothing drawn over the top of the sprite: the whole visible band is the
    // artwork's, so a supplied tile isn't cut by a hardcoded surface line.
    drawTiled(cx, art.floor, p.x, p.y, p.w, visibleH, SPRITES.floor.w);
    return;
  }
  cx.fillStyle = STAGE.floorBody;
  cx.fillRect(p.x, p.y, p.w, visibleH);
  cx.fillStyle = STAGE.floorTop;
  cx.fillRect(p.x, p.y, p.w, 14);
  cx.fillStyle = STAGE.floorEdge;
  cx.fillRect(p.x, p.y + 14, p.w, 4);
}

/**
 * One answer signboard. `alpha` and `dy` let the reveal reuse this for debris.
 * @param {CanvasRenderingContext2D} cx
 * @param {Platform} p
 * @param {{state?: 'idle'|'correct'|'wrong', dy?: number}} [opts]
 */
export function drawSign(cx, p, opts = {}) {
  const dy = opts.dy ?? 0;
  const state = opts.state ?? 'idle';
  const y = p.y + dy;

  if (has('platform')) {
    drawTileBox(cx, art.platform, p.x, y, p.w, ANSWER_SIGN_H);
  } else {
    const r = 10;
    cx.fillStyle = STAGE.platEdge;
    cx.beginPath();
    cx.roundRect(p.x, y, p.w, ANSWER_SIGN_H, r);
    cx.fill();
    cx.fillStyle = STAGE.platFace;
    cx.beginPath();
    cx.roundRect(p.x + 5, y + 5, p.w - 10, ANSWER_SIGN_H - 12, r - 3);
    cx.fill();
    // The landing surface is the brightest band on the whole stage, because
    // it's the thing players are aiming at. Radii are [tl, tr, br, bl].
    cx.fillStyle = STAGE.platTop;
    cx.beginPath();
    cx.roundRect(p.x, y, p.w, ANSWER_H, [r, r, 4, 4]);
    cx.fill();
  }

  if (state !== 'idle') {
    cx.save();
    cx.globalCompositeOperation = 'source-atop';
    cx.fillStyle = state === 'correct' ? 'rgba(61,220,154,0.42)' : 'rgba(20,14,26,0.55)';
    cx.fillRect(p.x - 4, y - 4, p.w + 8, ANSWER_SIGN_H + 8);
    cx.restore();
  }
}

/**
 * Answer text, set into the skirt below the landing surface.
 * @param {CanvasRenderingContext2D} cx
 * @param {Platform} p
 * @param {string} text
 * @param {{state?: 'idle'|'correct'|'wrong', dy?: number}} [opts]
 */
export function drawSignText(cx, p, text, opts = {}) {
  const dy = opts.dy ?? 0;
  const state = opts.state ?? 'idle';
  const skirtTop = p.y + ANSWER_H + dy;
  const skirtH = ANSWER_SIGN_H - ANSWER_H;
  const midY = skirtTop + skirtH / 2;

  let boxW = p.w - 40;
  if (state !== 'idle') boxW -= 54;

  cx.save();
  cx.textAlign = 'center';
  cx.textBaseline = 'middle';

  if (state !== 'idle') {
    // Icon as well as colour: colourblind viewers, and projectors that eat hue.
    cx.font = `800 40px ${FONT.display}`;
    cx.fillStyle = state === 'correct' ? UI.correct : UI.wrong;
    cx.fillText(state === 'correct' ? '✓' : '✕', p.x + 42, midY);
  }

  cx.font = fitFont(cx, text, boxW, 46, 22);
  cx.fillStyle = state === 'wrong' ? STAGE.platTextDim : STAGE.platText;
  cx.fillText(text, p.x + p.w / 2 + (state !== 'idle' ? 24 : 0), midY);
  cx.restore();
}

/**
 * A perch: a stepping-stone platform that is not an answer. Same construction
 * as a signboard's landing surface but with no skirt and a dimmer face — the
 * skirt is what says "this means something", and a perch deliberately doesn't.
 * @param {CanvasRenderingContext2D} cx
 * @param {Platform} p
 */
export function drawPerch(cx, p) {
  const h = ANSWER_H + 12;
  if (has('platform')) {
    drawTileBox(cx, art.platform, p.x, p.y, p.w, h);
    return;
  }
  cx.fillStyle = STAGE.platEdge;
  cx.beginPath();
  cx.roundRect(p.x, p.y, p.w, h, 8);
  cx.fill();
  cx.fillStyle = STAGE.platTop;
  cx.beginPath();
  cx.roundRect(p.x + 3, p.y + 3, p.w - 6, ANSWER_H - 8, 6);
  cx.fill();
}

/**
 * The number line for a range round, drawn on the floor's face — BELOW the
 * surface the players stand on. Feet sit at FLOOR_Y and sprites grow upward,
 * so nothing down here is ever covered by the crowd, no matter how full the
 * room is. That's the same reasoning as the signboard skirt.
 * @param {CanvasRenderingContext2D} cx
 * @param {import('../../sim/levels.js').RangeQuestion} q
 */
export function drawNumberLine(cx, q) {
  const x0 = rangeX(q, q.min);
  const x1 = rangeX(q, q.max);
  const railY = FLOOR_Y + 26;

  cx.save();
  cx.fillStyle = 'rgba(255,255,255,0.4)';
  cx.fillRect(x0, railY, x1 - x0, 4);

  cx.textAlign = 'center';
  cx.textBaseline = 'alphabetic';
  cx.font = `800 34px ${FONT.display}`;

  const step = tickStep(q.max - q.min);
  /** @type {number[]} */
  const ticks = [q.min];
  for (let v = Math.ceil((q.min + 1e-9) / step) * step; v < q.max - 1e-9; v += step) {
    // Skip a multiple that would sit on top of an endpoint label.
    if (v - q.min > step * 0.35 && q.max - v > step * 0.35) ticks.push(v);
  }
  ticks.push(q.max);

  for (const v of ticks) {
    const x = rangeX(q, v);
    cx.fillStyle = 'rgba(255,255,255,0.4)';
    cx.fillRect(x - 2, railY, 4, 20);
    cx.fillStyle = UI.paper;
    const label = v === q.max && q.unit ? `${fmtValue(v)} ${q.unit}` : fmtValue(v);
    // Endpoint labels (especially "160 bpm") can overhang the world edge —
    // shift them inward rather than letting the projector crop them.
    const half = cx.measureText(label).width / 2;
    cx.fillText(label, Math.max(half + 10, Math.min(WORLD_W - half - 10, x)), railY + 62);
  }
  cx.restore();
}

/**
 * The reveal for a range round: the surviving band glows, and the correct
 * interval is spelled out above the heads of whoever is still standing on it.
 * @param {CanvasRenderingContext2D} cx
 * @param {import('../../sim/collide.js').Platform} band
 * @param {import('../../sim/levels.js').RangeQuestion} q
 */
export function drawRangeReveal(cx, band, q) {
  cx.save();
  cx.fillStyle = 'rgba(61,220,154,0.25)';
  cx.fillRect(band.x, FLOOR_Y, band.w, WORLD_H - FLOOR_Y);
  cx.fillStyle = 'rgba(61,220,154,0.8)';
  cx.fillRect(band.x, FLOOR_Y, band.w, 14);

  const [lo, hi] = q.answer;
  const text = `${fmtValue(lo)}–${fmtValue(hi)}${q.unit ? ` ${q.unit}` : ''}`;
  // Clamp so a band at the edge of the line doesn't push the text off screen.
  const cxp = Math.max(180, Math.min(WORLD_W - 180, band.x + band.w / 2));
  const y = FLOOR_Y - 170;

  cx.textAlign = 'center';
  cx.textBaseline = 'alphabetic';
  cx.font = `800 54px ${FONT.display}`;
  cx.fillStyle = INK;
  cx.fillText(text, cxp + 3, y + 3);
  cx.fillStyle = UI.correct;
  cx.fillText(text, cxp, y);

  // Arrow from the text down toward the band, over the survivors' heads.
  cx.fillStyle = UI.correct;
  cx.beginPath();
  cx.moveTo(cxp, y + 52);
  cx.lineTo(cxp - 16, y + 24);
  cx.lineTo(cxp + 16, y + 24);
  cx.closePath();
  cx.fill();
  cx.restore();
}

/**
 * A tick spacing that yields a readable number of labels (roughly 6-10) for
 * any span, sticking to the steps people count in: 1, 2, 2.5, 5 x 10^k.
 * @param {number} span
 * @returns {number}
 */
export function tickStep(span) {
  const raw = span / 8;
  const pow = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (m * pow >= raw - 1e-9) return m * pow;
  }
  return 10 * pow;
}

/**
 * Trim float noise: 7.5 stays "7.5", 8.000000001 becomes "8".
 * @param {number} v
 * @returns {string}
 */
export function fmtValue(v) {
  return String(+v.toFixed(2));
}

/**
 * Largest weight-800 size in the range that fits the width.
 * @param {CanvasRenderingContext2D} cx
 * @param {string} text @param {number} maxW @param {number} max @param {number} min
 * @returns {string}
 */
export function fitFont(cx, text, maxW, max, min) {
  let size = max;
  for (; size > min; size--) {
    cx.font = `800 ${size}px ${FONT.display}`;
    if (cx.measureText(text).width <= maxW) break;
  }
  return `800 ${size}px ${FONT.display}`;
}

export { INK };

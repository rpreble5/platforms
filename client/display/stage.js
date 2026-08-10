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
import { ANSWER_H, ANSWER_SIGN_H, FLOOR_Y } from '../../sim/levels.js';
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

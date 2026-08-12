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
import { activeWay, drawTerrazzoSky, themeName } from './themes.js';

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
  if (themeName() === 'terrazzo') {
    drawTerrazzoSky(cx, WORLD_W, WORLD_H);
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
  // Terrazzo grounds the level in a very dark cut of the round's colourway —
  // it anchors the light field and makes the player colours pop hardest.
  const c = themeName() === 'terrazzo'
    ? { body: activeWay().fBody, top: activeWay().fTop, edge: activeWay().fEdge }
    : { body: STAGE.floorBody, top: STAGE.floorTop, edge: STAGE.floorEdge };
  cx.fillStyle = c.body;
  cx.fillRect(p.x, p.y, p.w, visibleH);
  cx.fillStyle = c.top;
  cx.fillRect(p.x, p.y, p.w, 14);
  cx.fillStyle = c.edge;
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
  const terrazzo = themeName() === 'terrazzo';
  const r = 10;

  if (has('platform')) {
    drawTileBox(cx, art.platform, p.x, y, p.w, ANSWER_SIGN_H);
  } else if (terrazzo) {
    const way = activeWay();
    cx.fillStyle = 'rgba(40,40,50,0.10)';
    cx.beginPath();
    cx.roundRect(p.x + 4, y + 6, p.w, ANSWER_SIGN_H, r);
    cx.fill();
    cx.fillStyle = way.edge;
    cx.beginPath();
    cx.roundRect(p.x, y, p.w, ANSWER_SIGN_H, r);
    cx.fill();
    cx.fillStyle = way.face;
    cx.beginPath();
    cx.roundRect(p.x + 5, y + 5, p.w - 10, ANSWER_SIGN_H - 12, r - 3);
    cx.fill();
    // The landing surface is the DARK band here — darker than the face, so it
    // reads as structure rather than shine. Radii are [tl, tr, br, bl].
    cx.fillStyle = way.top;
    cx.beginPath();
    cx.roundRect(p.x, y, p.w, ANSWER_H, [r, r, 4, 4]);
    cx.fill();
  } else {
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
    // Right/wrong is deliberately NOT a hue: the winner BRIGHTENS and gets a
    // bold outline, the losers fade dark and fall. Brightness plus the ✓/✕
    // icons read for everyone, including the ~8% of men who can't trust
    // red-vs-green, and they survive a projector eating saturation.
    cx.save();
    cx.globalCompositeOperation = 'source-atop';
    cx.fillStyle =
      state === 'correct'
        ? 'rgba(255,255,255,0.32)'
        : terrazzo ? 'rgba(20,14,26,0.38)' : 'rgba(20,14,26,0.55)';
    cx.fillRect(p.x - 4, y - 4, p.w + 8, ANSWER_SIGN_H + 8);
    cx.restore();
    if (state === 'correct') {
      cx.strokeStyle = terrazzo ? 'rgba(23,20,42,0.85)' : 'rgba(244,241,232,0.9)';
      cx.lineWidth = 6;
      cx.beginPath();
      cx.roundRect(p.x - 3, y - 3, p.w + 6, ANSWER_SIGN_H + 6, r + 3);
      cx.stroke();
    }
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
    // The icon IS the signal — no hue attached. Correct in full ink, wrong
    // dimmed like the rest of its fading board.
    cx.font = `800 40px ${FONT.display}`;
    if (themeName() === 'terrazzo') {
      cx.fillStyle = activeWay().text;
      cx.globalAlpha = state === 'correct' ? 1 : 0.55;
    } else {
      cx.fillStyle = state === 'correct' ? STAGE.platText : STAGE.platTextDim;
    }
    cx.fillText(state === 'correct' ? '✓' : '✕', p.x + 42, midY);
    cx.globalAlpha = 1;
  }

  cx.font = fitFont(cx, text, boxW, 46, 22);
  if (themeName() === 'terrazzo') {
    cx.fillStyle = activeWay().text;
    if (state === 'wrong') cx.globalAlpha = 0.55;
  } else {
    cx.fillStyle = state === 'wrong' ? STAGE.platTextDim : STAGE.platText;
  }
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
  if (themeName() === 'terrazzo') {
    const way = activeWay();
    cx.fillStyle = 'rgba(40,40,50,0.10)';
    cx.beginPath();
    cx.roundRect(p.x + 3, p.y + 5, p.w, h, 8);
    cx.fill();
    cx.fillStyle = way.edge;
    cx.beginPath();
    cx.roundRect(p.x, p.y, p.w, h, 8);
    cx.fill();
    cx.fillStyle = way.top;
    cx.beginPath();
    cx.roundRect(p.x + 3, p.y + 3, p.w - 6, ANSWER_H - 10, 6);
    cx.fill();
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

/** Where the range rail floats: above the tallest avatar and its name label. */
const RAIL_Y = FLOOR_Y - 210;

/**
 * The number line for a range round: a rail floating ABOVE the crowd, so it
 * stays readable however packed the floor gets. Each tick is a bead on the
 * rail with a little tag hanging under it carrying the number, and a faint
 * guide line drops to the floor so lining your feet up with a value never
 * means squinting across empty space.
 * @param {CanvasRenderingContext2D} cx
 * @param {import('../../sim/levels.js').RangeQuestion} q
 */
export function drawNumberLine(cx, q) {
  const x0 = rangeX(q, q.min);
  const x1 = rangeX(q, q.max);
  const terrazzo = themeName() === 'terrazzo';
  const way = activeWay();
  const railColor = terrazzo ? way.top : 'rgba(244,241,232,0.45)';
  const guideColor = terrazzo ? 'rgba(23,20,42,0.10)' : 'rgba(244,241,232,0.10)';
  const tagFace = terrazzo ? way.face : 'rgba(12,10,22,0.85)';
  const tagEdge = terrazzo ? way.edge : UI.panelEdge;
  const tagText = terrazzo ? way.text : UI.paper;

  cx.save();

  const step = tickStep(q.max - q.min);
  /** @type {number[]} */
  const ticks = [q.min];
  for (let v = Math.ceil((q.min + 1e-9) / step) * step; v < q.max - 1e-9; v += step) {
    // Skip a multiple that would sit on top of an endpoint label.
    if (v - q.min > step * 0.35 && q.max - v > step * 0.35) ticks.push(v);
  }
  ticks.push(q.max);

  // Guide lines first, so everything else draws over them.
  for (const v of ticks) {
    const x = rangeX(q, v);
    cx.fillStyle = guideColor;
    cx.fillRect(x - 1.5, RAIL_Y, 3, FLOOR_Y - RAIL_Y);
  }

  // The rail: a rounded bar with rounded end caps.
  cx.fillStyle = railColor;
  cx.beginPath();
  cx.roundRect(x0 - 6, RAIL_Y - 4, x1 - x0 + 12, 8, 4);
  cx.fill();

  cx.textAlign = 'center';
  cx.textBaseline = 'middle';
  cx.font = `800 27px ${FONT.display}`;

  for (const v of ticks) {
    const x = rangeX(q, v);
    const label = v === q.max && q.unit ? `${fmtValue(v)} ${q.unit}` : fmtValue(v);
    const tw = cx.measureText(label).width;
    const w = tw + 26;
    const h = 42;
    // Tags hang inside the world even at the endpoints.
    const tx = Math.max(w / 2 + 8, Math.min(WORLD_W - w / 2 - 8, x));

    // stem, then the tag
    cx.fillStyle = railColor;
    cx.fillRect(x - 2, RAIL_Y, 4, 14);
    cx.fillStyle = tagFace;
    cx.beginPath();
    cx.roundRect(tx - w / 2, RAIL_Y + 14, w, h, 12);
    cx.fill();
    cx.strokeStyle = tagEdge;
    cx.lineWidth = 3;
    cx.stroke();
    cx.fillStyle = tagText;
    cx.fillText(label, tx, RAIL_Y + 14 + h / 2 + 1);

    // the bead on the rail, drawn last so it caps the stem
    cx.fillStyle = railColor;
    cx.beginPath();
    cx.arc(x, RAIL_Y, 9, 0, Math.PI * 2);
    cx.fill();
  }
  cx.restore();
}

/**
 * The reveal for a range round — hue-free: the surviving band BRIGHTENS, and
 * the correct interval hangs off the rail as one big tag with an arrow down
 * to the floor. Brightness and position carry the answer, not a colour.
 * @param {CanvasRenderingContext2D} cx
 * @param {import('../../sim/collide.js').Platform} band
 * @param {import('../../sim/levels.js').RangeQuestion} q
 */
export function drawRangeReveal(cx, band, q) {
  const terrazzo = themeName() === 'terrazzo';
  const way = activeWay();
  cx.save();
  cx.fillStyle = 'rgba(255,255,255,0.20)';
  cx.fillRect(band.x, FLOOR_Y, band.w, WORLD_H - FLOOR_Y);
  cx.fillStyle = 'rgba(255,255,255,0.75)';
  cx.fillRect(band.x, FLOOR_Y, band.w, 14);

  const [lo, hi] = q.answer;
  const text = `${fmtValue(lo)}–${fmtValue(hi)}${q.unit ? ` ${q.unit}` : ''}`;
  const cxp = Math.max(200, Math.min(WORLD_W - 200, band.x + band.w / 2));
  const y = RAIL_Y - 74;

  cx.textAlign = 'center';
  cx.textBaseline = 'middle';
  cx.font = `800 44px ${FONT.display}`;
  const tw = cx.measureText(text).width;
  const w = tw + 44;
  const h = 66;

  cx.fillStyle = terrazzo ? way.face : 'rgba(12,10,22,0.92)';
  cx.beginPath();
  cx.roundRect(cxp - w / 2, y - h / 2, w, h, 16);
  cx.fill();
  cx.strokeStyle = terrazzo ? INK : 'rgba(244,241,232,0.9)';
  cx.lineWidth = 4;
  cx.stroke();
  cx.fillStyle = terrazzo ? way.text : UI.paper;
  cx.fillText(text, cxp, y + 1);

  // Arrow from the tag toward the surviving band.
  cx.fillStyle = terrazzo ? INK : 'rgba(244,241,232,0.9)';
  cx.beginPath();
  cx.moveTo(cxp, y + h / 2 + 30);
  cx.lineTo(cxp - 15, y + h / 2 + 6);
  cx.lineTo(cxp + 15, y + h / 2 + 6);
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

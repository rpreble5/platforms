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
import { ANSWER_H, FLAG_H, FLAG_POLE, FLOOR_Y, PLAQUE_GAP, PLAQUE_H, SLAB_H, rangeX } from '../../sim/levels.js';
import { SPRITES, art, drawTileBox, drawTiled, has } from './art.js';
import { FONT, INK, SKY, STAGE, UI } from './theme.js';
import { activeWay, drawFrostBlobs, drawGlassSky, drawTerrazzoSky, glassFam, glassFrost, themeName } from './themes.js';

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
  if (themeName() === 'glass') {
    drawGlassSky(cx, WORLD_W, WORLD_H, t);
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
    : themeName() === 'glass'
      ? { body: glassFam().floorBody, top: glassFam().floorTop, edge: glassFam().floorEdge }
      : { body: STAGE.floorBody, top: STAGE.floorTop, edge: STAGE.floorEdge };
  cx.fillStyle = c.body;
  cx.fillRect(p.x, p.y, p.w, visibleH);
  cx.fillStyle = c.top;
  cx.fillRect(p.x, p.y, p.w, 14);
  cx.fillStyle = c.edge;
  cx.fillRect(p.x, p.y + 14, p.w, 4);
}

/**
 * One answer board: a thin ink-outlined slab, with the answer TEXT floating
 * free — below the slab for the elevated layouts ('plaque' position), above
 * it on the flat row ('flag' position). No banner, pole or posts: the text
 * carries itself, and the verdict box materializes only at the reveal.
 * `dy` lets the reveal reuse this for debris — slab and text fall together.
 * @param {CanvasRenderingContext2D} cx
 * @param {Platform} p
 * @param {{state?: 'idle'|'correct'|'wrong', dy?: number}} [opts]
 */
export function drawSign(cx, p, opts = {}) {
  const dy = opts.dy ?? 0;
  const state = opts.state ?? 'idle';
  const y = p.y + dy;
  if (themeName() === 'glass') {
    drawGlassChunk(cx, p.x, y, p.w, GLASS_CHUNK_H, 20, state);
    return;
  }
  const terrazzo = themeName() === 'terrazzo';
  const way = terrazzo
    ? activeWay()
    : { face: STAGE.platFace, top: STAGE.platTop, edge: STAGE.platEdge };
  const ink = terrazzo ? 'rgba(23,20,42,0.9)' : 'rgba(3,5,9,0.8)';
  const r = 9;

  // The slab: face, ink outline, dark landing band on top.
  cx.save();
  cx.lineWidth = 3;
  cx.strokeStyle = ink;
  cx.fillStyle = way.face;
  cx.beginPath();
  cx.roundRect(p.x, y, p.w, SLAB_H, r);
  cx.fill();
  cx.stroke();
  cx.fillStyle = way.top;
  cx.beginPath();
  cx.roundRect(p.x + 2, y + 2, p.w - 4, 11, [r - 2, r - 2, 3, 3]);
  cx.fill();
  cx.restore();

  if (state === 'wrong') {
    // Losers dim and fall — hue-free, same as always.
    cx.save();
    cx.globalCompositeOperation = 'source-atop';
    cx.fillStyle = terrazzo ? 'rgba(20,14,26,0.38)' : 'rgba(20,14,26,0.55)';
    cx.fillRect(p.x - 2, y - 2, p.w + 4, SLAB_H + 4);
    cx.restore();
  }

  if (state === 'correct') {
    // The verdict MATERIALIZES: the floating text gets a bright plate and a
    // bold ink box only at the reveal — minimal while thinking, ceremony at
    // the answer. Still no hue: brightness and a border carry it.
    const t = signTextRect(p, dy);
    cx.save();
    cx.fillStyle = 'rgba(255,255,255,0.6)';
    cx.strokeStyle = terrazzo ? 'rgba(23,20,42,0.85)' : 'rgba(244,241,232,0.9)';
    cx.lineWidth = 5;
    cx.beginPath();
    cx.roundRect(t.x, t.y, t.w, t.h, 14);
    cx.fill();
    cx.stroke();
    cx.restore();
  }
}

/**
 * How tall a glass answer chunk is: the collision slab plus the whole text
 * zone, drawn as ONE block of glass with the answer inside it. Deliberately
 * equal to the plaque style's below-extent so it occupies exactly the space
 * the layouts (and the label-yield rule) already reserve.
 */
export const GLASS_CHUNK_H = SLAB_H + PLAQUE_GAP + PLAQUE_H;

/**
 * One glass panel: frosted body, diagonal sheen, a brighter landing strip on
 * top, and a light rim. Wrong answers dim behind a dark wash; the correct one
 * lights up — brighter body, hard rim, and an outer glow.
 * @param {CanvasRenderingContext2D} cx
 * @param {number} x @param {number} y @param {number} w @param {number} h
 * @param {number} r
 * @param {'idle'|'correct'|'wrong'} state
 */
function drawGlassChunk(cx, x, y, w, h, r, state) {
  const fam = glassFam();
  cx.save();
  cx.beginPath();
  cx.roundRect(x, y, w, h, r);
  // A soft drop shadow separates the glass from the field it echoes — on the
  // light frost family this is most of what says "panel" at all.
  cx.shadowColor = state === 'correct' ? 'rgba(255,255,255,0.9)' : 'rgba(4,6,24,0.30)';
  cx.shadowBlur = state === 'correct' ? 36 : 22;
  cx.shadowOffsetY = state === 'correct' ? 0 : 10;
  cx.fillStyle = state === 'correct' ? 'rgba(255,255,255,0.34)' : fam.glassFill;
  cx.fill();
  cx.shadowColor = 'rgba(0,0,0,0)';

  cx.clip();
  // The frosted backdrop: each panel is a window onto a heavily blurred,
  // colour-boosted copy of the sky, which is what actually reads as "thick
  // glass" — the flat white film alone never did. World-aligned, so falling
  // debris frosts whatever is currently behind it.
  const frost = glassFrost(WORLD_W, WORLD_H);
  if (frost) {
    cx.drawImage(frost, 0, 0);
    // The live half: today's blobs, at this frame's drift and hue, so the
    // glass keeps blurring the sky it actually stands in front of.
    drawFrostBlobs(cx, WORLD_W, WORLD_H);
    cx.fillStyle = state === 'correct' ? 'rgba(255,255,255,0.30)' : fam.glassFill;
    cx.fillRect(x, y, w, h);
  }
  // Diagonal sheen across the top-left: the one gradient that sells "glass".
  const sheen = cx.createLinearGradient(x, y, x + w * 0.7, y + h);
  sheen.addColorStop(0, 'rgba(255,255,255,0.18)');
  sheen.addColorStop(0.45, 'rgba(255,255,255,0.03)');
  sheen.addColorStop(1, 'rgba(255,255,255,0)');
  cx.fillStyle = sheen;
  cx.fillRect(x, y, w, h);

  // The landing strip: the surface players stand on stays legible as a
  // surface even though the whole chunk is translucent.
  cx.fillStyle = state === 'correct' ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.5)';
  cx.fillRect(x, y, w, 8);

  if (state === 'wrong') {
    cx.fillStyle = 'rgba(8,7,20,0.45)';
    cx.fillRect(x, y, w, h);
  }
  cx.restore();

  cx.save();
  cx.beginPath();
  cx.roundRect(x + 1, y + 1, w - 2, h - 2, r - 1);
  cx.strokeStyle = state === 'correct' ? 'rgba(255,255,255,0.95)' : fam.glassRim;
  cx.lineWidth = state === 'correct' ? 4 : 2;
  cx.stroke();
  cx.restore();
}

/**
 * Where a board's floating text lives — hanging space below the slab
 * ('plaque' position) or flying space above it ('flag' position). Also the
 * verdict box at the reveal and the label-yield zone (answers beat labels).
 *
 * The glass theme has no flying text at all: every answer sits INSIDE its
 * glass chunk, below the landing strip, whatever the layout — flags were
 * retired there on purpose.
 * @param {Platform} p @param {number} [dy]
 */
export function signTextRect(p, dy = 0) {
  if (themeName() === 'glass') {
    return { x: p.x + 14, y: p.y + dy + 18, w: p.w - 28, h: GLASS_CHUNK_H - 30 };
  }
  if (p.signStyle === 'flag') {
    return { x: p.x + 18, y: p.y + dy - FLAG_POLE, w: p.w - 36, h: FLAG_H };
  }
  return {
    x: p.x + 10,
    y: p.y + dy + SLAB_H + PLAQUE_GAP,
    w: p.w - 20,
    h: PLAQUE_H,
  };
}

/**
 * Answer text, set into the plaque (or the flag).
 * @param {CanvasRenderingContext2D} cx
 * @param {Platform} p
 * @param {string} text
 * @param {{state?: 'idle'|'correct'|'wrong', dy?: number}} [opts]
 */
export function drawSignText(cx, p, text, opts = {}) {
  const dy = opts.dy ?? 0;
  const state = opts.state ?? 'idle';
  const box = signTextRect(p, dy);
  const midY = box.y + box.h / 2;
  const boxW = box.w - 24;
  const boxH = box.h - 12;

  cx.save();
  cx.textAlign = 'center';
  cx.textBaseline = 'middle';

  if (themeName() === 'terrazzo') {
    cx.fillStyle = activeWay().text;
    if (state === 'wrong') cx.globalAlpha = 0.55;
  } else if (themeName() === 'glass') {
    if (state === 'correct') {
      // The verdict GLOWS: full-white lettering with a white halo, on every
      // family — the win moment trades the etched-ink look for light.
      cx.fillStyle = 'rgba(255,255,255,0.98)';
      cx.shadowColor = 'rgba(255,255,255,0.9)';
      cx.shadowBlur = 18;
    } else {
      cx.fillStyle = state === 'wrong' ? glassFam().textDim : glassFam().text;
    }
  } else {
    cx.fillStyle = state === 'wrong' ? STAGE.platTextDim : STAGE.platText;
  }

  // Long answers WRAP instead of spilling off the board. One line while it
  // stays big enough to read across a room; below that, two balanced lines;
  // and the size always scales down far enough that nothing ever overflows —
  // a cropped drug name is a wrong answer waiting to happen.
  cx.font = `800 54px ${FONT.display}`;
  const wRef = cx.measureText(text).width;
  const oneSize = Math.min(54, Math.floor((54 * boxW) / Math.max(1, wRef)));
  const cxp = box.x + box.w / 2;

  if (oneSize >= 30 || !text.includes(' ')) {
    cx.font = `800 ${Math.max(14, oneSize)}px ${FONT.display}`;
    cx.fillText(text, cxp, midY);
  } else {
    const words = text.split(' ');
    cx.font = `800 34px ${FONT.display}`;
    let best = { a: text, b: '', w: cx.measureText(text).width };
    for (let i = 1; i < words.length; i++) {
      const a = words.slice(0, i).join(' ');
      const b = words.slice(i).join(' ');
      const w = Math.max(cx.measureText(a).width, cx.measureText(b).width);
      if (w < best.w) best = { a, b, w };
    }
    const size = Math.max(
      12,
      Math.min(34, Math.floor((34 * boxW) / Math.max(1, best.w)), Math.floor((boxH - 6) / 2.15))
    );
    cx.font = `800 ${size}px ${FONT.display}`;
    const gap = size * 0.62;
    cx.fillText(best.a, cxp, midY - gap);
    cx.fillText(best.b, cxp, midY + gap);
  }
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
  const h = ANSWER_H + 8;
  if (has('platform')) {
    drawTileBox(cx, art.platform, p.x, p.y, p.w, h);
    return;
  }
  if (themeName() === 'glass') {
    // The same glass, one bite of it: rungs are small chunks in the identical
    // material so the ladders read as part of the set.
    drawGlassChunk(cx, p.x, p.y, p.w, h, h / 2, 'idle');
    return;
  }
  // An ink-outlined capsule with the colourway's landing band — the same
  // language as the answer slabs, so the ladders read as part of the set.
  const terrazzo = themeName() === 'terrazzo';
  const way = terrazzo
    ? activeWay()
    : { face: STAGE.platFace, top: STAGE.platTop };
  const r = h / 2;
  cx.save();
  cx.fillStyle = way.face;
  cx.strokeStyle = terrazzo ? 'rgba(23,20,42,0.9)' : 'rgba(3,5,9,0.8)';
  cx.lineWidth = 3;
  cx.beginPath();
  cx.roundRect(p.x, p.y, p.w, h, r);
  cx.fill();
  cx.stroke();
  cx.fillStyle = way.top;
  cx.beginPath();
  cx.roundRect(p.x + 2, p.y + 2, p.w - 4, 11, [r - 2, r - 2, 4, 4]);
  cx.fill();
  cx.restore();
}

/** Where the range rail floats: above the tallest avatar and its name label. */
const RAIL_Y = FLOOR_Y - 210;

/**
 * The number line for a range round: a subtle light line floating ABOVE the
 * crowd, numbers sitting above it, and a small single-colour triangle under
 * the line marking each exact value. Faint guide lines still drop to the
 * floor so lining your feet up with a value never means squinting across
 * empty space.
 * @param {CanvasRenderingContext2D} cx
 * @param {import('../../sim/levels.js').RangeQuestion} q
 */
export function drawNumberLine(cx, q) {
  const x0 = rangeX(q, q.min);
  const x1 = rangeX(q, q.max);
  // Ink-side on every light field: terrazzo, and the light glass families
  // (frost, cream) — paper-coloured rails vanish on a cream sky.
  const inky = themeName() === 'terrazzo' || (themeName() === 'glass' && Boolean(glassFam().light));
  const way = activeWay();
  const lineColor = inky ? 'rgba(23,20,42,0.18)' : 'rgba(244,241,232,0.30)';
  const guideColor = inky ? 'rgba(23,20,42,0.08)' : 'rgba(244,241,232,0.08)';
  const numColor = inky ? 'rgba(23,20,42,0.78)' : 'rgba(244,241,232,0.85)';
  const markColor = inky ? way.top : UI.paper;

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
    cx.fillRect(x - 1, RAIL_Y + 14, 2, FLOOR_Y - RAIL_Y - 14);
  }

  // The line itself: thin and quiet.
  cx.fillStyle = lineColor;
  cx.fillRect(x0 - 4, RAIL_Y - 1.5, x1 - x0 + 8, 3);

  cx.textAlign = 'center';
  cx.textBaseline = 'alphabetic';
  cx.font = `700 30px ${FONT.display}`;

  for (const v of ticks) {
    const x = rangeX(q, v);
    const label = v === q.max && q.unit ? `${fmtValue(v)} ${q.unit}` : fmtValue(v);
    // Numbers above the line, endpoints nudged inward so nothing crops.
    const half = cx.measureText(label).width / 2;
    cx.fillStyle = numColor;
    cx.fillText(label, Math.max(half + 10, Math.min(WORLD_W - half - 10, x)), RAIL_Y - 16);

    // The exact mark: one small triangle just below the line, one colour.
    cx.fillStyle = markColor;
    cx.beginPath();
    cx.moveTo(x - 7, RAIL_Y + 3);
    cx.lineTo(x + 7, RAIL_Y + 3);
    cx.lineTo(x, RAIL_Y + 14);
    cx.closePath();
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
  // Same ink-side rule as the number line: light glass families read like
  // terrazzo, not like the dark ones.
  const terrazzo =
    themeName() === 'terrazzo' || (themeName() === 'glass' && Boolean(glassFam().light));
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

/**
 * Arena layout. Pure — no DOM.
 *
 * All answer platforms sit at the same height directly above a full-width
 * floor, so every answer is reached the same way: run to it, jump straight up.
 *
 * That geometry is a fairness decision. If answers were at different heights or
 * distances, some would be harder to reach than others, and a player who wanted
 * the hard one would lose points to the layout rather than to their knowledge.
 * They'd be right to complain. Equal height, equal width, one jump each.
 */

import { PHYS, WORLD_H, WORLD_W } from '../shared/tuning.js';

/** @typedef {import('./collide.js').Platform} Platform */

/**
 * The tile grid, in display pixels. Answer boards are assembled from repeating
 * tiles rather than one stretched image, so every board dimension has to be a
 * whole number of tiles — which is also what makes boards of *different* sizes
 * free: any multiple of GRID is a legal width.
 */
export const GRID = 24;

/** Top of the floor. */
export const FLOOR_Y = WORLD_H - 100;
/**
 * Top of the answer platforms. The jump apex is ~220px, so a 160px rise leaves
 * roughly 37% slack — nobody should ever miss one of these, which is the point:
 * a game that never demands precision cannot be ruined by latency.
 */
export const ANSWER_Y = FLOOR_Y - 160;
/**
 * Collision height: the top tile row. Answer platforms are one-way and landing
 * uses a swept test, so a thin surface is safe — nobody can tunnel through it.
 */
export const ANSWER_H = GRID;
/**
 * How tall the answer platform is *drawn*, versus the one tile row it actually
 * collides with. The extra hangs below the surface and carries the answer
 * text, so the platform IS the signboard rather than having a label bolted
 * under it.
 *
 * Three tile rows. The ceiling on this number is the crowd: an avatar standing
 * on the floor at full size reaches y=924, and the platform surface is at 820,
 * so anything past ~100px would be covered by people's heads.
 */
export const ANSWER_SIGN_H = GRID * 3;

const EDGE_MARGIN = 70;
const MIN_GAP = 60;

/**
 * The platform id of the correct band in a range round. Starts with 'ans' so
 * everything keyed on "the answer platform" — arrivals, atBuzzer, scoring —
 * treats it exactly like a signboard platform.
 */
export const RANGE_ID = 'ansband';
/**
 * Never build a band narrower than this. A range like [9, 9.05] on a 0-100
 * scale would map to a strip thinner than a player; standing "in" it would be
 * luck. Two tiles is comfortably wider than one avatar.
 */
export const RANGE_MIN_W = GRID * 2;

/**
 * @typedef {object} RangeQuestion
 * @property {'range'} type
 * @property {string} text
 * @property {number} min left end of the number line
 * @property {number} max right end of the number line
 * @property {[number, number]} answer inclusive correct interval
 * @property {string} [unit] shown on the line's last label and the reveal
 */

/**
 * Where a value sits on screen. The line spans the same usable width the
 * answer boards do, so the mapping is shared by the arena builder and the
 * number-line renderer — one function, or the zone and its labels drift apart.
 * @param {{min: number, max: number}} q
 * @param {number} v
 * @returns {number} x in world pixels
 */
export function rangeX(q, v) {
  const usable = WORLD_W - EDGE_MARGIN * 2;
  return EDGE_MARGIN + ((v - q.min) / (q.max - q.min)) * usable;
}

/**
 * Arena for a range question: the floor itself is the answer, split into three
 * adjacent segments at the exact pixels where the correct interval starts and
 * ends. The middle segment carries the answer id, so the entire scoring
 * machine — first-touch arrivals, the buzzer snapshot, the settle — works on
 * it unchanged. At the reveal the two outer segments crumble like wrong
 * signboards do, and everyone standing on them goes down with the floor.
 *
 * The `pit` is an invisible ledge just below the visible world. Without it,
 * fallers cross KILL_Y, respawn at centre screen, fall again, and loop for the
 * whole scoreboard. With it they land once, out of sight, and stay there until
 * the next question respawns everyone.
 * @param {RangeQuestion} q
 * @returns {Platform[]}
 */
export function buildRangeArena(q) {
  let xa = rangeX(q, q.answer[0]);
  let xb = rangeX(q, q.answer[1]);
  if (xb - xa < RANGE_MIN_W) {
    const c = (xa + xb) / 2;
    xa = c - RANGE_MIN_W / 2;
    xb = c + RANGE_MIN_W / 2;
  }

  return [
    { id: 'floorL', x: -400, y: FLOOR_Y, w: xa + 400, h: 260 },
    { id: RANGE_ID, x: xa, y: FLOOR_Y, w: xb - xa, h: 260 },
    { id: 'floorR', x: xb, y: FLOOR_Y, w: WORLD_W + 400 - xb, h: 260 },
    { id: 'pit', x: -400, y: WORLD_H + 150, w: WORLD_W + 800, h: 60 },
  ];
}

/**
 * @param {number} n number of answers, 2-4
 * @returns {Platform[]}
 */
export function buildArena(n) {
  const count = Math.max(2, Math.min(4, n));

  /** @type {Platform[]} */
  const platforms = [
    { id: 'floor', x: -400, y: FLOOR_Y, w: WORLD_W + 800, h: 260 },
  ];

  const usable = WORLD_W - EDGE_MARGIN * 2;
  // Snap the board to whole tiles and give the remainder to the gaps. Gaps are
  // the right place for slack: they're empty air, so a few odd pixels there
  // cost nothing, while an odd pixel on a board is a half-drawn tile.
  const width = snapToGrid((usable - MIN_GAP * (count - 1)) / count);
  const gap = count > 1 ? Math.floor((usable - width * count) / (count - 1)) : 0;

  for (let i = 0; i < count; i++) {
    platforms.push({
      id: answerId(i),
      x: EDGE_MARGIN + i * (width + gap),
      y: ANSWER_Y,
      w: width,
      h: ANSWER_H,
      // Jump-through from below, so a crowd under a platform can still get up
      // onto it instead of bonking and blaming the game.
      oneWay: true,
    });
  }

  return platforms;
}

/**
 * Largest legal board width at or below `px` — a whole number of tiles, and
 * never zero. Anything that wants a board of a particular size goes through
 * here, so the rounding rule lives in exactly one place.
 * @param {number} px
 * @returns {number}
 */
export function snapToGrid(px) {
  return Math.max(GRID, Math.floor(px / GRID) * GRID);
}

/** @param {number} i @returns {string} */
export function answerId(i) {
  return `ans${i}`;
}

/**
 * Spawn positions along the floor, spread so 30 simultaneous joins don't stack,
 * and so nobody starts systematically closer to one answer than another.
 * @param {number} index
 * @returns {{x:number, y:number}}
 */
export function spawnFor(index) {
  const lanes = 24;
  const lane = index % lanes;
  // Past 24 players the lanes wrap, and without this offset the 25th player
  // starts on *exactly* the same pixel as the 1st. Two perfectly stacked
  // avatars are the worst case for telling anyone apart — the one on top hides
  // the other completely — so wrapped players sit half a lane over.
  const wrap = Math.floor(index / lanes) % 2;
  const x = EDGE_MARGIN + ((lane + 0.5 + wrap * 0.5) / lanes) * (WORLD_W - EDGE_MARGIN * 2);
  return { x: x - PHYS.PLAYER_W / 2, y: FLOOR_Y - PHYS.PLAYER_H - 4 };
}

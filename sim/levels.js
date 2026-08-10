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

/** Top of the floor. */
export const FLOOR_Y = WORLD_H - 100;
/**
 * Top of the answer platforms. The jump apex is ~220px, so a 160px rise leaves
 * roughly 37% slack — nobody should ever miss one of these, which is the point:
 * a game that never demands precision cannot be ruined by latency.
 */
export const ANSWER_Y = FLOOR_Y - 160;
export const ANSWER_H = 28;
/**
 * How tall the answer platform is *drawn*, versus the 28px it actually
 * collides with. The extra hangs below the surface and carries the answer
 * text, so the platform IS the signboard rather than having a label bolted
 * under it.
 *
 * The ceiling on this number is the crowd: an avatar standing on the floor at
 * full size reaches y=924, and the platform surface is at 820, so anything
 * past ~100px would be covered by people's heads. 76 leaves 28px of air.
 */
export const ANSWER_SIGN_H = 76;

const EDGE_MARGIN = 70;
const MIN_GAP = 60;

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
  const width = Math.floor((usable - MIN_GAP * (count - 1)) / count);
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
  const x = EDGE_MARGIN + ((lane + 0.5) / lanes) * (WORLD_W - EDGE_MARGIN * 2);
  return { x: x - PHYS.PLAYER_W / 2, y: FLOOR_Y - PHYS.PLAYER_H - 4 };
}

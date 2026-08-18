/**
 * AABB collision against static platforms. Pure — no DOM, no browser globals.
 *
 * X is resolved first, then Y with a swept test against the previous edge, so a
 * body can never tunnel through a platform at 120 Hz (max fall is 2200 px/s =
 * ~18 px/tick against platforms at least 20 px thick).
 */

import { PHYS } from '../shared/tuning.js';

/**
 * @typedef {object} Platform
 * @property {number} x left edge
 * @property {number} y top edge
 * @property {number} w
 * @property {number} h
 * @property {boolean} [oneWay] pass through from below and from the sides
 * @property {string} [id]
 * @property {string} [controlId] interactive control embedded in a solid floor
 * @property {'plaque'|'flag'} [signStyle] where the answer text rides, for answer boards
 */

/**
 * @typedef {object} VerticalImpact
 * @property {Platform} platform
 * @property {'top'|'bottom'} side top = landed from above; bottom = head-hit from below
 * @property {number} speed absolute vertical speed immediately before collision
 */

/**
 * @typedef {object} Body
 * @property {number} x @property {number} y
 * @property {number} w @property {number} h
 * @property {number} vx @property {number} vy
 * @property {boolean} onGround
 * @property {Platform | null} standingOn
 * @property {VerticalImpact[]} [verticalImpacts] impacts created by this move
 */

/**
 * @param {Body} b
 * @param {Platform} p
 * @returns {boolean}
 */
function overlaps(b, p) {
  return b.x < p.x + p.w && b.x + b.w > p.x && b.y < p.y + p.h && b.y + b.h > p.y;
}

/**
 * Move on X and push out of anything solid. One-way platforms are ignored here.
 * @param {Body} b
 * @param {readonly Platform[]} platforms
 * @param {number} dx
 */
export function moveX(b, platforms, dx) {
  b.x += dx;
  for (const p of platforms) {
    if (p.oneWay) continue;
    if (!overlaps(b, p)) continue;
    if (dx > 0) b.x = p.x - b.w;
    else if (dx < 0) b.x = p.x + p.w;
    b.vx = 0;
  }
}

/**
 * Move on Y with a swept test, corner correction on the way up, and one-way
 * platform support. Sets `onGround` / `standingOn`.
 * @param {Body} b
 * @param {readonly Platform[]} platforms
 * @param {number} dy
 */
export function moveY(b, platforms, dy) {
  const prevTop = b.y;
  const prevBottom = b.y + b.h;
  b.y += dy;
  b.onGround = false;
  b.standingOn = null;

  for (const p of platforms) {
    if (!overlaps(b, p)) continue;

    if (dy > 0) {
      // Falling. Land only if we were above the surface a moment ago — that is
      // what makes one-way platforms work and what prevents snapping up from
      // inside a solid one.
      if (prevBottom <= p.y + 1) {
        b.y = p.y - b.h;
        b.verticalImpacts?.push({ platform: p, side: 'top', speed: Math.abs(b.vy) });
        b.vy = 0;
        b.onGround = true;
        b.standingOn = p;
      }
      continue;
    }

    if (dy < 0) {
      if (p.oneWay) continue;
      if (prevTop < p.y + p.h - 1) continue; // already inside; don't fight it

      // Corner correction: clipping a corner by a few pixels nudges the body
      // past it instead of killing the whole jump. This is a feel fix, and it
      // matters more at 30 players where everyone is crowded near platform edges.
      const pokeFromLeft = b.x + b.w - p.x;
      const pokeFromRight = p.x + p.w - b.x;
      if (pokeFromLeft > 0 && pokeFromLeft <= PHYS.CORNER_CORRECT_PX) {
        b.x -= pokeFromLeft;
        continue;
      }
      if (pokeFromRight > 0 && pokeFromRight <= PHYS.CORNER_CORRECT_PX) {
        b.x += pokeFromRight;
        continue;
      }

      b.y = p.y + p.h;
      b.verticalImpacts?.push({ platform: p, side: 'bottom', speed: Math.abs(b.vy) });
      b.vy = 0;
    }
  }
}

/**
 * True when a solid surface is within `slop` pixels below the body. Used to
 * re-arm coyote time after a corner correction nudges the body sideways.
 * @param {Body} b
 * @param {readonly Platform[]} platforms
 * @param {number} [slop]
 * @returns {Platform | null}
 */
export function groundBelow(b, platforms, slop = 2) {
  for (const p of platforms) {
    if (b.x < p.x + p.w && b.x + b.w > p.x && b.y + b.h <= p.y + slop && b.y + b.h >= p.y - slop) {
      return p;
    }
  }
  return null;
}

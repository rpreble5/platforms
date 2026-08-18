/**
 * Per-player movement. Pure — no DOM, no browser globals, no imports outside
 * shared/. `node --test` runs this directly.
 *
 * This file is where perceived latency is actually won. The jump buffer and
 * coyote timers absorb the entire good-case network budget; shaving
 * milliseconds off the wire does not.
 */

import { FINDME_SHOW_MS, PHYS } from '../shared/tuning.js';
import { BTN_FINDME, BTN_JUMP, BTN_LEFT, BTN_RIGHT } from '../shared/protocol.js';
import { groundBelow, moveX, moveY } from './collide.js';

/**
 * @typedef {object} PlayerInput
 * @property {number} held authoritative current mask, overwritten by every packet
 * @property {number} pressEdge OR-accumulated 0->1 transitions, never overwritten
 * @property {number} releaseEdge OR-accumulated 1->0 transitions, never overwritten
 */

/** @typedef {import('./collide.js').Platform} Platform */

/**
 * @typedef {object} Player
 * @property {number} id
 * @property {number} x @property {number} y
 * @property {number} w @property {number} h
 * @property {number} vx @property {number} vy
 * @property {boolean} onGround
 * @property {Platform | null} standingOn
 * @property {Platform | null} lastStoodOn the surface you were most recently on,
 *   kept while airborne so a jump at the buzzer doesn't read as "nowhere"
 * @property {number} coyote ms of coyote time remaining
 * @property {number} jumpBuffer ms of buffered jump remaining
 * @property {number} facing -1 or 1
 * @property {number} findMeUntil world time (ms) until the find-me highlight expires
 * @property {boolean} connected
 * @property {number} respawns
 * @property {number} jumps
 * @property {import('./collide.js').VerticalImpact[]} verticalImpacts impacts from this tick only
 * @property {PlayerInput} input
 */

/**
 * @param {number} id
 * @param {number} x
 * @param {number} y
 * @returns {Player}
 */
export function createPlayer(id, x, y) {
  return {
    id,
    x,
    y,
    w: PHYS.PLAYER_W,
    h: PHYS.PLAYER_H,
    vx: 0,
    vy: 0,
    onGround: false,
    standingOn: null,
    lastStoodOn: null,
    coyote: 0,
    jumpBuffer: 0,
    facing: 1,
    findMeUntil: 0,
    connected: true,
    respawns: 0,
    jumps: 0,
    verticalImpacts: [],
    input: { held: 0, pressEdge: 0, releaseEdge: 0 },
  };
}

/**
 * Advance one player by one fixed tick.
 * @param {Player} p
 * @param {readonly Platform[]} platforms
 * @param {number} dtMs
 * @param {number} worldT world clock in ms, for findMeUntil
 */
export function stepPlayer(p, platforms, dtMs, worldT) {
  p.verticalImpacts = [];
  const dt = dtMs / 1000;
  const { held, pressEdge, releaseEdge } = p.input;

  // 1. Press edges. Consuming the accumulated edge (rather than reading `held`)
  //    is what guarantees a tap whose press AND release both landed inside this
  //    same 8.3ms window still produces a jump. Dropping it reads to the player
  //    as "the game ignored me", which is the worst failure mode here.
  if (pressEdge & BTN_JUMP) p.jumpBuffer = PHYS.JUMP_BUFFER_MS;
  if (pressEdge & BTN_FINDME) p.findMeUntil = worldT + FINDME_SHOW_MS;

  // 2. Release edges — variable jump height.
  if (releaseEdge & BTN_JUMP && p.vy < 0) p.vy *= PHYS.JUMP_CUT;

  // 3. Horizontal.
  const dir = (held & BTN_RIGHT ? 1 : 0) - (held & BTN_LEFT ? 1 : 0);
  if (dir !== 0) p.facing = dir;
  if (dir === 0) {
    const friction = (p.onGround ? PHYS.GROUND_FRICTION : PHYS.AIR_FRICTION) * dt;
    if (Math.abs(p.vx) <= friction) p.vx = 0;
    else p.vx -= Math.sign(p.vx) * friction;
  } else {
    const targetVx = dir * PHYS.RUN_SPEED;
    const accel = (p.onGround ? PHYS.GROUND_ACCEL : PHYS.AIR_ACCEL) * dt;
    if (p.vx < targetVx) p.vx = Math.min(p.vx + accel, targetVx);
    else if (p.vx > targetVx) p.vx = Math.max(p.vx - accel, targetVx);
  }

  // 4. Jump — a buffered press meets ground or the coyote window.
  if (p.jumpBuffer > 0 && (p.onGround || p.coyote > 0)) {
    p.vy = -PHYS.JUMP_VEL;
    p.jumpBuffer = 0;
    p.coyote = 0;
    p.onGround = false;
    p.standingOn = null;
    p.jumps++;
  }

  // 5. Gravity. Falling harder than rising reads as snappier at the same apex.
  const g = p.vy < 0 ? PHYS.RISE_GRAVITY : PHYS.FALL_GRAVITY;
  p.vy = Math.min(p.vy + g * dt, PHYS.MAX_FALL_SPEED);

  // 6. Integrate and resolve.
  moveX(p, platforms, p.vx * dt);
  moveY(p, platforms, p.vy * dt);
  if (!p.onGround && p.vy >= 0) {
    // Re-arm ground contact after a corner correction nudged us sideways.
    const under = groundBelow(p, platforms);
    if (under) {
      p.onGround = true;
      p.standingOn = under;
    }
  }

  if (p.standingOn) p.lastStoodOn = p.standingOn;

  // 7. Timers.
  if (p.onGround) p.coyote = PHYS.COYOTE_MS;
  else p.coyote = Math.max(0, p.coyote - dtMs);
  p.jumpBuffer = Math.max(0, p.jumpBuffer - dtMs);

  // 8. Clear the edges this tick consumed. `held` persists.
  p.input.pressEdge = 0;
  p.input.releaseEdge = 0;
}

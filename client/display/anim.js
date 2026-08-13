/**
 * Avatar animation: squash & stretch, lean, and live eyes.
 *
 * Render-only, by construction. The simulation's 40x56 collision box never
 * changes — this module only decides how the cached sprite is *drawn*, the
 * same rule that keeps the cohort heights cosmetic. Everything derives from
 * the player's velocity and a single remembered timestamp (last touchdown),
 * so there is no clock the sim has to know about and nothing to desync.
 *
 * Two conventions carry the whole effect:
 *  - anchor at the feet: a squash that lifts the feet off the floor reads as
 *    floating, so every transform pivots on the bottom-centre of the body;
 *  - preserve volume: width always compensates height (sx = sy^-1/2), which
 *    is what makes the deformation read as a soft body instead of a glitch.
 *
 * Kill switch: FX.avatarAnim in shared/tuning.js.
 */

import { PHYS } from '../../shared/tuning.js';

/** Fraction of height lost at the moment of touchdown. */
const LAND_SQUASH = 0.24;
/** The landing envelope is fully settled by here. */
export const LAND_RECOVER_MS = 420;
/** Airborne elongation at terminal speeds. */
const STRETCH_MAX = 0.14;
/** Lean into travel, radians at full run speed (~7 degrees). */
const LEAN_MAX = 0.12;
/** Pupil offset while moving, as a fraction of eye radius. */
const GAZE_MAX = 0.45;
/** Extra eye radius at terminal fall speed. */
const WIDE_MAX = 0.35;

/** @type {Map<number, {prevGround: boolean, landAt: number}>} */
const state = new Map();

/**
 * The landing recovery curve: 1 at touchdown, decaying with one soft
 * overshoot past zero (a brief stretch above rest height) before settling.
 * The overshoot is the "spring" — without it the squash reads as a stumble.
 * @param {number} t ms since landing
 * @returns {number} squash amount, 1 -> 0
 */
export function landEnvelope(t) {
  if (t < 0 || t >= LAND_RECOVER_MS) return 0;
  return Math.exp(-t / 80) * Math.cos(t / 50);
}

/**
 * Per-player draw transform for this frame. Also advances the tiny
 * landing-detection state machine, so call it exactly once per player per
 * frame.
 * @param {{id: number, onGround: boolean, vx: number, vy: number}} p
 * @param {number} t world time, ms
 * @returns {{sx: number, sy: number, lean: number,
 *            eye: {dx: number, dy: number, scale: number, openY: number}}}
 */
export function animFor(p, t) {
  let s = state.get(p.id);
  if (!s) {
    s = { prevGround: p.onGround, landAt: -1e9 };
    state.set(p.id, s);
  }
  if (p.onGround && !s.prevGround) s.landAt = t;
  s.prevGround = p.onGround;

  const fallN = Math.max(-1, Math.min(1, p.vy / PHYS.MAX_FALL_SPEED));
  let sy;
  if (p.onGround) {
    sy = 1 - LAND_SQUASH * landEnvelope(t - s.landAt);
  } else {
    // Stretch along the motion — rising or falling, speed is what elongates.
    sy = 1 + STRETCH_MAX * Math.abs(fallN);
  }
  const sx = 1 / Math.sqrt(sy);

  const runN = Math.max(-1, Math.min(1, p.vx / PHYS.RUN_SPEED));
  const lean = LEAN_MAX * runN;

  // Eyes: pupils track velocity, a fast fall widens them, and the landing
  // squash squints them for exactly as long as the body is compressed.
  const squint = p.onGround ? Math.max(0, landEnvelope(t - s.landAt)) : 0;
  return {
    sx,
    sy,
    lean,
    eye: {
      dx: GAZE_MAX * runN,
      dy: GAZE_MAX * 0.7 * fallN,
      scale: 1 + WIDE_MAX * (!p.onGround && fallN > 0 ? fallN : 0),
      // Squint with the squash, but never to a slit — at 30px a fully closed
      // eye reads as no eye at all.
      openY: Math.max(0.4, 1 - 0.6 * squint),
    },
  };
}

/**
 * Drop animation state for players no longer in the world, so an evening of
 * joins and leaves can't grow the map without bound.
 * @param {Map<number, unknown>} players the world's live player map
 */
export function pruneAnim(players) {
  for (const id of state.keys()) {
    if (!players.has(id)) state.delete(id);
  }
}

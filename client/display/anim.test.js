/**
 * Avatar animation envelopes. These are the guarantees that keep thirty
 * animated avatars readable rather than glitchy: deformation always settles
 * back to rest, volume is preserved, and every output is clamped.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { LAND_RECOVER_MS, animFor, landEnvelope, pruneAnim } from './anim.js';
import { PHYS } from '../../shared/tuning.js';

/** @param {Partial<{id:number,onGround:boolean,vx:number,vy:number}>} p */
const player = (p) => ({ id: 1, onGround: true, vx: 0, vy: 0, ...p });

test('the landing envelope starts at full squash and fully settles', () => {
  assert.equal(landEnvelope(0), 1);
  assert.equal(landEnvelope(LAND_RECOVER_MS), 0, 'exactly zero once recovered');
  assert.equal(landEnvelope(LAND_RECOVER_MS * 4), 0);
  assert.equal(landEnvelope(-5), 0, 'nothing before the landing');
  // The overshoot is the spring: somewhere in the recovery the body must
  // stretch past rest height, briefly.
  let overshoot = 0;
  for (let t = 0; t < LAND_RECOVER_MS; t += 5) overshoot = Math.min(overshoot, landEnvelope(t));
  assert.ok(overshoot < -0.01, `has a stretch phase (got ${overshoot.toFixed(3)})`);
});

test('a landing squashes, then returns to rest', () => {
  pruneAnim(new Map());
  // Airborne first, so the ground transition registers as a landing.
  animFor(player({ onGround: false, vy: 1500 }), 1000);
  const impact = animFor(player({ onGround: true }), 1016);
  assert.ok(impact.sy < 0.85, `squashes on impact (sy=${impact.sy.toFixed(2)})`);
  assert.ok(impact.sx > 1.05, 'and widens to match');
  assert.ok(impact.eye.openY < 0.7, 'eyes squint with the body');

  const rest = animFor(player({ onGround: true }), 1016 + LAND_RECOVER_MS);
  assert.equal(rest.sy, 1, 'back to rest height');
  assert.equal(rest.sx, 1);
  assert.equal(rest.eye.openY, 1);
});

test('airborne stretch scales with speed and is capped', () => {
  pruneAnim(new Map());
  const slow = animFor(player({ id: 2, onGround: false, vy: 200 }), 0);
  const fast = animFor(player({ id: 3, onGround: false, vy: PHYS.MAX_FALL_SPEED }), 0);
  const insane = animFor(player({ id: 4, onGround: false, vy: PHYS.MAX_FALL_SPEED * 5 }), 0);
  assert.ok(slow.sy > 1 && fast.sy > slow.sy, 'more speed, more stretch');
  assert.equal(insane.sy, fast.sy, 'capped at terminal speed');
  assert.ok(fast.sy < 1.2, 'never balloon-shaped');
  assert.ok(fast.eye.scale > 1, 'falling fast widens the eyes');
});

test('volume is preserved through every deformation', () => {
  pruneAnim(new Map());
  animFor(player({ id: 5, onGround: false, vy: 900 }), 500);
  for (const [p, t] of /** @type {const} */ ([
    [{ id: 5, onGround: true, vx: 0, vy: 0 }, 520],
    [{ id: 5, onGround: true, vx: 0, vy: 0 }, 580],
    [{ id: 6, onGround: false, vx: 300, vy: 2200 }, 0],
  ])) {
    const a = animFor(player(p), t);
    assert.ok(Math.abs(a.sx * a.sx * a.sy - 1) < 1e-9, `sx^2 * sy = 1 at sy=${a.sy.toFixed(3)}`);
  }
});

test('lean and gaze follow velocity and are clamped', () => {
  pruneAnim(new Map());
  const right = animFor(player({ id: 7, vx: PHYS.RUN_SPEED }), 0);
  const left = animFor(player({ id: 8, vx: -PHYS.RUN_SPEED * 9 }), 0);
  assert.ok(right.lean > 0 && right.eye.dx > 0, 'leans and looks the way it runs');
  assert.equal(left.lean, -right.lean, 'clamped symmetrically');
  assert.ok(Math.abs(left.lean) < 0.2, 'never past ~11 degrees');
});

test('pruning forgets a departed player entirely', () => {
  pruneAnim(new Map());
  animFor(player({ id: 9, onGround: false, vy: 1000 }), 100);
  animFor(player({ id: 9, onGround: true }), 116); // lands: squash state exists
  pruneAnim(new Map()); // world says nobody is here
  const fresh = animFor(player({ id: 9, onGround: true }), 130);
  assert.equal(fresh.sy, 1, 'no stale landing survives the prune');
});

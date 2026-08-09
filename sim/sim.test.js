/**
 * Determinism and physics regression.
 *
 * The sim is a pure module precisely so this can run headless in Node while the
 * identical files execute on the display's render thread. The forgiveness tests
 * below are the ones that matter: they encode the behaviour that makes the game
 * feel responsive at 90ms of latency, and they are easy to break by accident.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { BTN_JUMP, BTN_LEFT, BTN_RIGHT } from '../shared/protocol.js';
import { PHYS, STEP_MS } from '../shared/tuning.js';
import { addPlayer, createWorld, step } from './world.js';

/** @param {import('./world.js').World} w @param {number} n */
function run(w, n) {
  for (let i = 0; i < n; i++) step(w, STEP_MS);
}

/** A flat floor at y=500 and nothing else, so tests aren't level-dependent. */
function flatWorld() {
  const w = createWorld([{ id: 'floor', x: -1000, y: 500, w: 4000, h: 200 }]);
  w.spawn = { x: 400, y: 400 };
  return w;
}

/**
 * Add a player at an exact position. Spawn jitter is deliberate in the real
 * game but would make these assertions depend on it.
 * @param {import('./world.js').World} w @param {number} id
 * @param {number} x @param {number} y
 */
function join(w, id, x, y) {
  const p = addPlayer(w, id);
  p.x = x;
  p.y = y;
  return p;
}

/** @param {import('./world.js').World} w @param {number} id @param {number} mask */
function press(w, id, mask) {
  const p = /** @type {import('./player.js').Player} */ (w.players.get(id));
  p.input.pressEdge |= mask & ~p.input.held;
  p.input.held |= mask;
}

/** @param {import('./world.js').World} w @param {number} id @param {number} mask */
function release(w, id, mask) {
  const p = /** @type {import('./player.js').Player} */ (w.players.get(id));
  p.input.releaseEdge |= mask & p.input.held;
  p.input.held &= ~mask;
}

test('a player settles on the floor', () => {
  const w = flatWorld();
  join(w, 1, 400, 400);
  run(w, 200);
  const p = /** @type {any} */ (w.players.get(1));
  assert.equal(p.onGround, true);
  assert.equal(Math.round(p.y + p.h), 500);
});

test('a tap whose press and release both land inside one tick still jumps', () => {
  // This is THE case the OR-accumulated edges exist for. On a laggy link,
  // packets arrive in bursts after a retransmit, so a fast tap can have both
  // its press and its release delivered between two 8.3ms ticks. Deriving edges
  // by diffing the mask at tick time would silently drop it, and the player
  // would read that as the game ignoring them.
  const w = flatWorld();
  join(w, 1, 400, 400);
  run(w, 100);

  press(w, 1, BTN_JUMP);
  release(w, 1, BTN_JUMP);
  const p = /** @type {any} */ (w.players.get(1));
  assert.equal(p.input.held, 0, 'mask is back to zero before the tick runs');

  step(w, STEP_MS);
  assert.ok(p.jumps > 0, 'the tap produced a jump');
  assert.ok(p.vy < 0, 'and the player is moving upward');
});

test('coyote time: a jump pressed after walking off an edge still fires', () => {
  const w = createWorld([{ id: 'ledge', x: 0, y: 500, w: 300, h: 40 }]);
  w.spawn = { x: 250, y: 400 };
  join(w, 1, 250, 400);
  run(w, 120);

  const p = /** @type {any} */ (w.players.get(1));
  assert.equal(p.onGround, true);

  // Walk off the right edge.
  press(w, 1, BTN_RIGHT);
  for (let i = 0; i < 400 && p.onGround; i++) step(w, STEP_MS);
  assert.equal(p.onGround, false, 'left the ledge');
  release(w, 1, BTN_RIGHT);

  // Press jump one tick into the fall — comfortably inside the coyote window.
  step(w, STEP_MS);
  press(w, 1, BTN_JUMP);
  step(w, STEP_MS);
  assert.ok(p.jumps > 0, 'coyote time caught the late press');
});

test('coyote time expires', () => {
  const w = createWorld([{ id: 'ledge', x: 0, y: 500, w: 300, h: 40 }]);
  w.spawn = { x: 250, y: 400 };
  join(w, 1, 250, 400);
  run(w, 120);
  const p = /** @type {any} */ (w.players.get(1));

  press(w, 1, BTN_RIGHT);
  for (let i = 0; i < 400 && p.onGround; i++) step(w, STEP_MS);
  release(w, 1, BTN_RIGHT);

  run(w, Math.ceil(PHYS.COYOTE_MS / STEP_MS) + 4);
  const before = p.jumps;
  press(w, 1, BTN_JUMP);
  step(w, STEP_MS);
  assert.equal(p.jumps, before, 'too late to be forgiven');
});

test('jump buffering: a jump pressed before landing fires on touchdown', () => {
  const w = flatWorld();
  join(w, 1, 400, 400);
  run(w, 100);
  const p = /** @type {any} */ (w.players.get(1));

  press(w, 1, BTN_JUMP);
  step(w, STEP_MS);
  release(w, 1, BTN_JUMP);
  const firstJump = p.jumps;
  assert.equal(firstJump, 1);

  // Fall until we are within the buffer window of landing, then press early.
  while (p.vy < 0) step(w, STEP_MS);
  while (p.y + p.h < 500 - 60) step(w, STEP_MS);

  press(w, 1, BTN_JUMP);
  release(w, 1, BTN_JUMP);
  // Airborne, so nothing happens yet...
  step(w, STEP_MS);
  assert.equal(p.jumps, firstJump, 'no double jump');

  // ...but the moment we touch down, the buffered press fires.
  run(w, Math.ceil(PHYS.JUMP_BUFFER_MS / STEP_MS));
  assert.equal(p.jumps, firstJump + 1, 'buffered jump fired on landing');
});

test('variable jump height: releasing early cuts the rise', () => {
  const mk = /** @param {boolean} cut */ (cut) => {
    const w = flatWorld();
    join(w, 1, 400, 400);
    run(w, 100);
    const p = /** @type {any} */ (w.players.get(1));
    press(w, 1, BTN_JUMP);
    step(w, STEP_MS);
    if (cut) {
      release(w, 1, BTN_JUMP);
      step(w, STEP_MS);
    }
    let apex = p.y;
    while (p.vy < 0) {
      step(w, STEP_MS);
      apex = Math.min(apex, p.y);
    }
    return 500 - PHYS.PLAYER_H - apex;
  };
  const full = mk(false);
  const tapped = mk(true);
  assert.ok(tapped < full * 0.6, `tap ${tapped.toFixed(0)}px should be well under full ${full.toFixed(0)}px`);
});

test('full jump clears the design gap with slack', () => {
  // Level design is the highest-leverage latency work: if no jump ever demands
  // precision, latency cannot ruin one. Guard the margin.
  const w = flatWorld();
  join(w, 1, 400, 400);
  run(w, 100);
  const p = /** @type {any} */ (w.players.get(1));

  press(w, 1, BTN_RIGHT);
  run(w, 60); // reach top speed
  const x0 = p.x;
  press(w, 1, BTN_JUMP);
  step(w, STEP_MS);
  while (!p.onGround) step(w, STEP_MS);
  const reach = p.x - x0;
  assert.ok(reach > 250 * 1.35, `reach ${reach.toFixed(0)}px must clear a 250px gap with 35%+ slack`);
});

test('players do not collide with each other', () => {
  // No player-vs-player physics, on purpose: it makes iteration order matter
  // (a fairness bug) and turns crowding into something that can cost points.
  const w = flatWorld();
  const a = join(w, 1, 400, 400);
  const b = join(w, 2, 400, 400);
  run(w, 120);
  assert.equal(Math.round(a.x), Math.round(b.x), 'they occupy the same space, undisturbed');
});

test('simulation is deterministic and order-independent', () => {
  const build = /** @param {number[]} order */ (order) => {
    const w = flatWorld();
    for (const id of order) join(w, id, 200 + id * 60, 400);
    for (const id of order) press(w, id, id % 2 ? BTN_LEFT : BTN_RIGHT);
    for (let i = 0; i < 300; i++) {
      if (i === 40) for (const id of order) press(w, id, BTN_JUMP);
      if (i === 46) for (const id of order) release(w, id, BTN_JUMP);
      step(w, STEP_MS);
    }
    return [...w.players.values()]
      .sort((p, q) => p.id - q.id)
      .map((p) => `${p.id}:${p.x.toFixed(6)}:${p.y.toFixed(6)}`)
      .join('|');
  };
  assert.equal(build([1, 2, 3, 4]), build([1, 2, 3, 4]), 'same input, same output');
  assert.equal(build([4, 3, 2, 1]), build([1, 2, 3, 4]), 'insertion order must not matter');
});

test('falling out of the world respawns rather than deletes', () => {
  const w = createWorld([]);
  join(w, 1, 400, 400);
  const p = /** @type {any} */ (w.players.get(1));
  run(w, 400);
  assert.equal(p.respawns > 0, true);
  assert.equal(w.players.has(1), true);
});

test('a solid wall stops horizontal movement', () => {
  const w = createWorld([
    { id: 'floor', x: -1000, y: 500, w: 4000, h: 200 },
    { id: 'wall', x: 600, y: 380, w: 40, h: 120 },
  ]);
  w.spawn = { x: 400, y: 400 };
  join(w, 1, 400, 400);
  run(w, 100);
  press(w, 1, BTN_RIGHT);
  run(w, 400);
  const p = /** @type {any} */ (w.players.get(1));
  assert.ok(p.x + p.w <= 601, `stopped at the wall, got x=${p.x.toFixed(1)}`);
});

test('one-way platforms are entered from above only', () => {
  const w = createWorld([
    { id: 'floor', x: -1000, y: 700, w: 4000, h: 200 },
    { id: 'shelf', x: 300, y: 500, w: 300, h: 26, oneWay: true },
  ]);
  const p = join(w, 1, 400, 300);

  run(w, 200);
  assert.equal(Math.round(p.y + p.h), 500, 'landed on the shelf from above');

  // From underneath, a jump should pass straight through rather than bonk.
  p.y = 640;
  p.vy = 0;
  press(w, 1, BTN_JUMP);
  let apex = p.y;
  for (let i = 0; i < 60; i++) {
    step(w, STEP_MS);
    apex = Math.min(apex, p.y);
  }
  assert.ok(apex + p.h < 500, `passed up through the shelf (apex bottom ${(apex + p.h).toFixed(0)})`);
});

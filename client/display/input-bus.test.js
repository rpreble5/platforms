/**
 * The disallow branch of drainInto (control-turn spectators). The latched
 * held mask must SURVIVE the freeze: phones send only on change plus a slow
 * heartbeat, so zeroing the latch created a post-turn dead zone and then a
 * fabricated press edge when the heartbeat diffed against the forged zero.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { InputBus } from './input-bus.js';
import { BTN_JUMP, BTN_RIGHT } from '../../shared/protocol.js';
import { addPlayer, createWorld } from '../../sim/world.js';

test('a held button rides through a disallowed stretch without dead zone or phantom edge', () => {
  const bus = new InputBus();
  const world = createWorld([]);
  const p = addPlayer(world, 7);

  // The phone reports right+jump held (change packet), then goes quiet.
  bus.applyMask(7, BTN_RIGHT | BTN_JUMP);
  bus.drainInto(world);
  assert.equal(p.input.held, BTN_RIGHT | BTN_JUMP, 'input flows while allowed');
  p.input.pressEdge = 0;
  p.input.releaseEdge = 0;

  // A control turn starts and this player is a spectator for several ticks.
  for (let i = 0; i < 5; i++) {
    bus.drainInto(world, (id) => id !== 7);
    assert.equal(p.input.held, 0, 'input erased while gated');
    assert.equal(p.input.pressEdge, 0, 'no edges leak while gated');
  }

  // The turn ends. The very next tick must resume the still-held buttons —
  // no waiting for a heartbeat.
  bus.drainInto(world);
  assert.equal(p.input.held, BTN_RIGHT | BTN_JUMP, 'held mask resumes immediately');
  assert.equal(p.input.pressEdge, 0, 'resuming a hold is not a fresh press');

  // The phone's 400ms heartbeat repeats the unchanged mask: still no edge.
  p.input.pressEdge = 0;
  bus.applyMask(7, BTN_RIGHT | BTN_JUMP);
  bus.drainInto(world);
  assert.equal(p.input.pressEdge, 0, 'an unchanged heartbeat fabricates no press edge');
});

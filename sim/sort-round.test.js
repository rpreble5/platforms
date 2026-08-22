/**
 * Lightning sort: the per-item loop inside the ANSWER phase. Same pattern as
 * the control-round tests — tiny windows, real world, real physics.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PHASE,
  SORT_FLASH_MS,
  SORT_ITEM_POINTS,
  createGame,
  inputsLive,
  startGame,
  stepRound,
  targetIds,
} from './round.js';
import { STEP_MS } from '../shared/tuning.js';
import { addPlayer, createWorld } from './world.js';
import { answerId } from './levels.js';

const ITEM_MS = 200;

/** @returns {import('./round.js').Question} */
function sortQuestion() {
  return {
    type: 'sort',
    text: 'Sort the animals',
    buckets: ['Mammal', 'Bird', 'Reptile'],
    answers: ['Mammal', 'Bird', 'Reptile'],
    items: [
      { label: 'Bat', bucket: 0 },
      { label: 'Penguin', bucket: 1 },
      { label: 'Gecko', bucket: 2 },
    ],
    itemMs: ITEM_MS,
  };
}

function rig() {
  const world = createWorld([]);
  const game = createGame([sortQuestion()]);
  return { world, game };
}

/**
 * @param {import('./world.js').World} world
 * @param {import('./round.js').Game} game
 * @param {number} ms
 */
function run(world, game, ms) {
  const n = Math.round(ms / STEP_MS);
  for (let i = 0; i < n; i++) stepRound(game, world, STEP_MS);
}

/**
 * @param {import('./world.js').World} world
 * @param {number} id @param {number} bucket
 */
function standOn(world, id, bucket) {
  const plat = world.platforms.find((p) => p.id === answerId(bucket));
  assert.ok(plat, `bucket ${bucket} exists`);
  const p = /** @type {any} */ (world.players.get(id));
  p.x = plat.x + plat.w / 2 - p.w / 2;
  p.y = plat.y - p.h;
  p.vx = 0;
  p.vy = 0;
  p.onGround = true;
  p.standingOn = plat;
}

test('a sort round walks every item, paying per landed item', () => {
  const { world, game } = rig();
  addPlayer(world, 1);
  addPlayer(world, 2);
  startGame(game, world);
  assert.equal(game.phase, PHASE.INTRO);
  run(world, game, 3100); // into item 0's 'go'
  assert.equal(game.phase, PHASE.ANSWER);
  assert.equal(game.itemPhase, 'go');

  const items = /** @type {NonNullable<import('./round.js').Question['items']>} */ (
    game.questions[0].items
  );
  for (let i = 0; i < items.length; i++) {
    assert.equal(game.itemIndex, i);
    standOn(world, 1, items[i].bucket); // right every time
    standOn(world, 2, (items[i].bucket + 1) % 3); // wrong every time
    run(world, game, ITEM_MS + STEP_MS * 2); // to this item's mini-buzzer
    assert.equal(game.itemPhase, 'flash', `item ${i} judged`);
    assert.equal(game.itemHits.get(1), true);
    assert.equal(game.itemHits.get(2), false);
    run(world, game, SORT_FLASH_MS); // through the flash
  }

  // After the last flash the round rejoins LOCK → REVEAL with the tally.
  run(world, game, 900 + STEP_MS * 4);
  assert.equal(game.phase, PHASE.REVEAL);
  const r1 = game.results.find((r) => r.id === 1);
  const r2 = game.results.find((r) => r.id === 2);
  assert.ok(r1 && r2);
  assert.equal(r1.correct, true);
  assert.equal(r1.hits, 3);
  assert.ok(r1.points >= 3 * SORT_ITEM_POINTS, 'each landed item pays at least its base');
  assert.equal(r1.rank, 1);
  assert.equal(r2.correct, false);
  assert.equal(r2.hits, 0);
  assert.equal(r2.points, 0);
  assert.equal(game.scores.get(1), r1.points);
});

test('the buckets never crumble — no debris through reveal and score', () => {
  const { world, game } = rig();
  addPlayer(world, 1);
  startGame(game, world);
  run(world, game, 3100 + 3 * (ITEM_MS + SORT_FLASH_MS) + 900 + 200);
  assert.equal(game.phase, PHASE.REVEAL);
  assert.equal(game.debris.length, 0, 'nothing fell');
  for (let b = 0; b < 3; b++) {
    assert.ok(world.platforms.some((p) => p.id === answerId(b)), `bucket ${b} still standing`);
  }
  run(world, game, 2300); // into SCORE
  assert.equal(game.phase, PHASE.SCORE);
  assert.equal(game.debris.length, 0);
});

test('inputs die for the flash and come back for the next item', () => {
  const { world, game } = rig();
  const p = /** @type {any} */ (addPlayer(world, 1));
  startGame(game, world);
  run(world, game, 3100);
  assert.equal(inputsLive(game), true, 'live while answering');

  run(world, game, ITEM_MS + STEP_MS * 2);
  assert.equal(game.itemPhase, 'flash');
  assert.equal(inputsLive(game), false, 'dead during the flash');
  p.input.held = 1;
  run(world, game, STEP_MS);
  assert.equal(p.input.held, 0, 'held buttons are erased before physics');

  run(world, game, SORT_FLASH_MS);
  assert.equal(game.itemPhase, 'go');
  assert.equal(inputsLive(game), true, 'live again for the next item');
});

test('targetIds follows the item index', () => {
  const q = sortQuestion();
  assert.deepEqual([...targetIds(q, 0)], [answerId(0)]);
  assert.deepEqual([...targetIds(q, 1)], [answerId(1)]);
  assert.deepEqual([...targetIds(q, 2)], [answerId(2)]);
  assert.deepEqual([...targetIds(q, 99)], [], 'past the end targets nothing');
});

test('per-item arrivals reset: a late lander still scores the next item', () => {
  const { world, game } = rig();
  addPlayer(world, 1);
  startGame(game, world);
  run(world, game, 3100);

  // Miss item 0 entirely.
  run(world, game, ITEM_MS + STEP_MS * 2);
  assert.equal(game.itemHits.get(1), false);
  run(world, game, SORT_FLASH_MS);

  // Land item 1.
  const items = /** @type {any} */ (game.questions[0]).items;
  standOn(world, 1, items[1].bucket);
  run(world, game, ITEM_MS + STEP_MS * 2);
  assert.equal(game.itemHits.get(1), true);
  assert.equal(game.sortTally.get(1)?.hits, 1);
});

/**
 * The sudden-death machine. What matters: elimination is decided by the half
 * you settled on, the wrong floor actually drops its occupants, the mercy
 * rule keeps the mode from ending with nobody, and a victor ends it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { STEP_MS } from '../shared/tuning.js';
import { addPlayer, createWorld } from './world.js';
import { FLOOR_Y } from './levels.js';
import {
  FALSE_ID,
  SD_ANSWER_MS,
  SD_PHASE,
  SD_SHOW_MS,
  SD_REVEAL_MS,
  SPLIT_X,
  TRUE_ID,
  buildShowdownArena,
  createShowdown,
  sdInputsLive,
  sdSkip,
  stepShowdown,
} from './showdown.js';

/** @type {{text:string, answer:boolean}[]} */
const STATEMENTS = [
  { text: 'One', answer: true },
  { text: 'Two', answer: false },
  { text: 'Three', answer: true },
];

/** @param {number[]} ids */
function rig(ids) {
  const world = createWorld(buildShowdownArena());
  for (const id of ids) addPlayer(world, id);
  const s = createShowdown({ statements: STATEMENTS }, world, ids);
  return { world, s };
}

/**
 * @param {import('./world.js').World} world
 * @param {import('./showdown.js').Showdown} s
 * @param {number} ms
 */
function run(world, s, ms) {
  const n = Math.round(ms / STEP_MS);
  for (let i = 0; i < n; i++) stepShowdown(s, world, STEP_MS);
}

/**
 * Stand a player on the TRUE or FALSE half.
 * @param {import('./world.js').World} world
 * @param {number} id @param {boolean} side
 */
function standOn(world, id, side) {
  const p = /** @type {any} */ (world.players.get(id));
  p.x = side ? SPLIT_X / 2 : SPLIT_X + SPLIT_X / 2;
  p.y = FLOOR_Y - p.h;
  p.vx = 0;
  p.vy = 0;
}

test('the arena is two halves meeting at the split, plus the pit', () => {
  const plats = buildShowdownArena();
  const left = plats.find((p) => p.id === TRUE_ID);
  const right = plats.find((p) => p.id === FALSE_ID);
  assert.ok(left && right);
  assert.equal(left.x + left.w, right.x, 'halves meet exactly');
  assert.equal(right.x, SPLIT_X);
  assert.ok(plats.some((p) => p.id === 'pit'));
});

test('the wrong side is eliminated and falls with its floor', () => {
  const { world, s } = rig([1, 2]);
  run(world, s, SD_SHOW_MS + 100);
  assert.equal(s.phase, SD_PHASE.ANSWER);
  assert.equal(sdInputsLive(s), true);

  standOn(world, 1, true); // statement one is TRUE
  standOn(world, 2, false);
  run(world, s, SD_ANSWER_MS + 900); // through the buzzer and settle

  assert.equal(s.phase, SD_PHASE.REVEAL);
  assert.ok(s.alive.has(1), 'right side survives');
  assert.ok(!s.alive.has(2), 'wrong side is out');
  assert.equal(s.debris.length, 1, 'the wrong half is falling');
  assert.equal(s.debris[0].id, FALSE_ID);
  assert.equal(sdInputsLive(s), false, 'nobody steers during the reveal');

  run(world, s, 1500);
  const loser = /** @type {any} */ (world.players.get(2));
  assert.ok(loser.y > 1080, `the loser fell off screen (y=${loser.y.toFixed(0)})`);
});

test('one survivor ends it: VICTORY, then DONE', () => {
  const { world, s } = rig([1, 2]);
  run(world, s, SD_SHOW_MS + 100);
  standOn(world, 1, true);
  standOn(world, 2, false);
  run(world, s, SD_ANSWER_MS + 900 + SD_REVEAL_MS + 50);

  assert.equal(s.phase, SD_PHASE.VICTORY);
  assert.deepEqual(s.winners, [1]);
  run(world, s, 6100);
  assert.equal(s.phase, SD_PHASE.DONE);
});

test('a statement that would eliminate everyone eliminates no one', () => {
  const { world, s } = rig([1, 2]);
  run(world, s, SD_SHOW_MS + 100);
  standOn(world, 1, false); // both wrong: statement one is TRUE
  standOn(world, 2, false);
  run(world, s, SD_ANSWER_MS + 900);

  assert.equal(s.phase, SD_PHASE.REVEAL);
  assert.equal(s.freePass, true);
  assert.equal(s.alive.size, 2, 'mercy rule: everyone lives');
  assert.equal(s.debris.length, 0, 'no floor fell');

  run(world, s, SD_REVEAL_MS);
  assert.equal(s.phase, SD_PHASE.SHOW, 'on to the next statement');
  assert.equal(s.index, 1);
  assert.ok(world.platforms.some((p) => p.id === FALSE_ID), 'floor is whole');
});

test('survivors when the statements run out are co-champions', () => {
  const { world, s } = rig([1, 2]);
  for (let round = 0; round < STATEMENTS.length; round++) {
    run(world, s, SD_SHOW_MS + 100);
    const ans = STATEMENTS[round].answer;
    standOn(world, 1, ans); // both keep being right
    standOn(world, 2, ans);
    run(world, s, SD_ANSWER_MS + 900);
    if (s.phase === SD_PHASE.REVEAL) run(world, s, SD_REVEAL_MS + 50);
  }
  assert.equal(s.phase, SD_PHASE.VICTORY);
  assert.deepEqual([...s.winners].sort(), [1, 2]);
});

test('the floor comes back whole for the next statement', () => {
  const { world, s } = rig([1, 2, 3]);
  run(world, s, SD_SHOW_MS + 100);
  standOn(world, 1, true);
  standOn(world, 2, true);
  standOn(world, 3, false); // eliminated
  run(world, s, SD_ANSWER_MS + 900);
  assert.ok(!world.platforms.some((p) => p.id === FALSE_ID), 'half is gone during reveal');

  run(world, s, SD_REVEAL_MS + 50);
  assert.equal(s.phase, SD_PHASE.SHOW);
  assert.equal(s.index, 1);
  assert.ok(world.platforms.some((p) => p.id === FALSE_ID), 'and back for the next one');
  assert.equal(s.alive.size, 2);
});

test('the host skip advances without eliminating anyone', () => {
  const { world, s } = rig([1, 2]);
  run(world, s, SD_SHOW_MS + 100);
  sdSkip(s, world);
  assert.equal(s.index, 1);
  assert.equal(s.phase, SD_PHASE.SHOW);
  assert.equal(s.alive.size, 2);

  sdSkip(s, world);
  assert.equal(s.index, 2);
  sdSkip(s, world); // past the last statement
  assert.equal(s.phase, SD_PHASE.VICTORY);
  assert.deepEqual([...s.winners].sort(), [1, 2]);
});

test('pause freezes the machine', () => {
  const { world, s } = rig([1]);
  s.paused = true;
  run(world, s, 5000);
  assert.equal(s.phase, SD_PHASE.SHOW);
  assert.equal(s.phaseT, 0);
});

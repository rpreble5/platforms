/**
 * Designed levels: the sanitize/build pipeline and how the round machine
 * picks from the pool. The editor and the save endpoint both lean on
 * sanitizeLevelSpec, so garbage tolerance here is load-bearing.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ANSWER_H,
  FLOOR_Y,
  buildCustomArena,
  sanitizeLevelSpec,
  tierY,
} from './levels.js';
import { createGame, nextQuestion, startGame } from './round.js';
import { createWorld } from './world.js';

const LEVEL = {
  name: 'Twin Spires',
  boards: [[500, 3, 300], [1400, 3, 300]],
  rungs: [[960, 1, 400], [960, 2, 200]],
};

test('sanitizeLevelSpec passes a good level through and clamps a scruffy one', () => {
  const clean = sanitizeLevelSpec(LEVEL);
  assert.ok(clean);
  assert.equal(clean.name, 'Twin Spires');
  assert.deepEqual(clean.boards, LEVEL.boards);

  const scruffy = sanitizeLevelSpec({
    name: `  padded   ${'x'.repeat(60)}`,
    boards: [[500.4, 9, 300.2], [-4000, 0, 99999], ['nope', 1, 1], [700, 2, 100]],
    rungs: [[960, 1.4, 401]],
  });
  assert.ok(scruffy);
  assert.equal(scruffy.boards.length, 3, 'the non-numeric triple is dropped');
  for (const [, tier] of scruffy.boards) assert.ok(tier >= 1 && tier <= 4, 'tiers clamp to 1-4');
  assert.ok(scruffy.name.length <= 40);
});

test('sanitizeLevelSpec rejects non-levels', () => {
  assert.equal(sanitizeLevelSpec(null), null);
  assert.equal(sanitizeLevelSpec('hi'), null);
  assert.equal(sanitizeLevelSpec({ boards: [[1, 1, 1], [2, 2, 2]] }), null, 'no name');
  assert.equal(sanitizeLevelSpec({ name: 'one board', boards: [[500, 3, 300]] }), null);
  assert.ok(
    sanitizeLevelSpec({ name: 'six', boards: Array.from({ length: 6 }, (_, i) => [i * 300, 3, 200]) }),
    'six boards is legal — select-all rounds use them'
  );
  assert.equal(
    sanitizeLevelSpec({ name: 'seven', boards: Array.from({ length: 7 }, (_, i) => [i * 260, 3, 200]) }),
    null
  );
});

test('buildCustomArena produces the standard arena shape', () => {
  const plats = buildCustomArena(/** @type {any} */ (sanitizeLevelSpec(LEVEL)));
  const floor = plats.find((p) => p.id === 'floor');
  assert.ok(floor && floor.y === FLOOR_Y, 'standard floor');

  const boards = plats.filter((p) => p.id?.startsWith('ans'));
  assert.equal(boards.length, 2);
  assert.deepEqual(
    boards.map((p) => p.id),
    ['ans0', 'ans1']
  );
  for (const b of boards) {
    assert.equal(b.y, tierY(3));
    assert.equal(b.h, ANSWER_H);
    assert.equal(b.oneWay, true);
    assert.equal(b.signStyle, 'plaque');
  }
  assert.equal(boards[0].x, 500 - 150, 'x from centre and width');

  const rungs = plats.filter((p) => p.id?.startsWith('perch'));
  assert.equal(rungs.length, 2);
  assert.equal(rungs[0].y, tierY(1));
});

/** @param {number} n @param {string} [level] */
function q(n, level) {
  return {
    text: 'q',
    answers: Array.from({ length: n }, (_, i) => `a${i}`),
    correct: 0,
    ...(level ? { level } : {}),
  };
}

/**
 * @param {string} name @param {number} n boards
 * @returns {import('./levels.js').LevelSpec}
 */
function spec(name, n) {
  return {
    name,
    boards: Array.from({ length: n }, (_, i) => /** @type {[number, number, number]} */ ([200 + i * 350, 3, 240])),
    rungs: [],
  };
}

/** @param {number[][]} rows @returns {Array<[number, number, number]>} */
const triples = (rows) => /** @type {any} */ (rows);

/**
 * ans platform x positions identify which level got built
 * @param {import('./world.js').World} world
 */
function boardXs(world) {
  return world.platforms
    .filter((p) => p.id?.startsWith('ans'))
    .map((p) => p.x);
}

test('the round rotates pool levels of the matching count, deterministically', () => {
  const g = createGame([q(4), q(4), q(4)], 1000);
  const a = { ...spec('aaa', 4), boards: triples([[200, 3, 240], [600, 3, 240], [1000, 3, 240], [1400, 3, 240]]) };
  const b = { ...spec('bbb', 4), boards: triples([[300, 3, 240], [700, 3, 240], [1100, 3, 240], [1500, 3, 240]]) };
  g.levelPool = [a, b];
  const world = createWorld([]);

  startGame(g, world); // q0
  const first = boardXs(world);
  assert.deepEqual(first, a.boards.map(([c, , w]) => c - w / 2), 'q0 gets the first matching level');

  nextQuestion(g, world); // q1
  assert.deepEqual(boardXs(world), b.boards.map(([c, , w]) => c - w / 2), 'q1 rotates to the next');

  nextQuestion(g, world); // q2 wraps
  assert.deepEqual(boardXs(world), first, 'q2 wraps back around');

  const g2 = createGame([q(4), q(4)], 1000);
  g2.levelPool = [a, b];
  const w2 = createWorld([]);
  startGame(g2, w2);
  assert.deepEqual(boardXs(w2), first, 'same qIndex, same level — restarts replay identically');
});

test('questions with no matching level fall back to the shipped layouts', () => {
  const g = createGame([q(4)], 1000);
  g.levelPool = [spec('threes', 3)]; // pool exists, but nothing with 4 boards
  const world = createWorld([]);
  startGame(g, world);
  const boards = world.platforms.filter((p) => p.id?.startsWith('ans'));
  assert.equal(boards.length, 4, 'shipped islands table carried the round');
});

test('a question can pin a pool level by name, count permitting', () => {
  const four = spec('the one', 4);
  const g = createGame([q(4, 'the one')], 1000);
  g.levelPool = [spec('other', 4), four];
  const world = createWorld([]);
  startGame(g, world);
  assert.deepEqual(
    boardXs(world),
    four.boards.map(([c, , w]) => c - w / 2)
  );

  // Pin names a 3-board level under a 4-answer question: ignored, not fatal.
  const g2 = createGame([q(4, 'threes')], 1000);
  g2.levelPool = [spec('threes', 3), four];
  const w2 = createWorld([]);
  startGame(g2, w2);
  assert.equal(w2.platforms.filter((p) => p.id?.startsWith('ans')).length, 4);
});

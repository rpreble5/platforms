/**
 * Select-all-that-apply questions and teams mode.
 *
 * The mechanic: `correct` may be an array; any correct platform scores the
 * individual, and in teams mode a cohort that covers EVERY correct platform
 * at the buzzer pays TEAM_COVER_BONUS to each of its covering members.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildArena } from './levels.js';
import {
  BASE_POINTS,
  PHASE,
  TEAM_COVER_BONUS,
  correctIndexes,
  createGame,
  isMulti,
  startGame,
  stepRound,
  targetIds,
} from './round.js';
import { addPlayer, createWorld } from './world.js';

const MULTI_Q = {
  text: 'pick both',
  answers: ['right A', 'wrong', 'right B', 'also wrong'],
  correct: [0, 2],
};

test('correct helpers absorb single vs array', () => {
  assert.deepEqual(correctIndexes({ text: 'x', correct: 1 }), [1]);
  assert.deepEqual(correctIndexes({ text: 'x', correct: [0, 2] }), [0, 2]);
  assert.equal(isMulti({ text: 'x', correct: [0, 2] }), true);
  assert.equal(isMulti({ text: 'x', correct: 1 }), false);
  assert.deepEqual([...targetIds({ text: 'x', correct: [0, 2] })].sort(), ['ans0', 'ans2']);
});

test('six-answer questions get an arena', () => {
  const plats = buildArena(6);
  const boards = plats.filter((p) => p.id?.startsWith('ans'));
  assert.equal(boards.length, 6, 'row fallback carries six boards');
});

/**
 * Run one full question: place each player on the platform named for them,
 * then step through ANSWER, LOCK and into REVEAL.
 * @param {import('./round.js').Game} g
 * @param {import('./world.js').World} world
 * @param {Map<number, string|null>} placements playerId -> platform id
 */
function playRound(g, world, placements) {
  // through INTRO
  for (let t = 0; t < 100 && g.phase === PHASE.INTRO; t++) stepRound(g, world, 100);
  assert.equal(g.phase, PHASE.ANSWER);

  for (const [id, platId] of placements) {
    const p = world.players.get(id);
    const plat = world.platforms.find((pl) => pl.id === platId);
    assert.ok(p && (plat || platId === null));
    if (plat) {
      p.x = plat.x + plat.w / 2 - p.w / 2;
      p.y = plat.y - p.h - 1;
      p.vx = 0;
      p.vy = 0;
    }
  }
  for (let t = 0; t < 400 && /** @type {string} */ (g.phase) !== PHASE.REVEAL; t++) {
    stepRound(g, world, 100);
  }
  assert.equal(g.phase, PHASE.REVEAL);
}

test('solo: standing on ANY correct platform of a select-all scores', () => {
  const g = createGame([MULTI_Q], 2000);
  const world = createWorld([]);
  for (const id of [1, 2, 3]) addPlayer(world, id);
  startGame(g, world);

  playRound(g, world, new Map([[1, 'ans0'], [2, 'ans2'], [3, 'ans1']]));

  const byId = new Map(g.results.map((r) => [r.id, r]));
  assert.equal(byId.get(1)?.correct, true, 'first correct platform scores');
  assert.equal(byId.get(2)?.correct, true, 'second correct platform scores');
  assert.equal(byId.get(3)?.correct, false, 'wrong platform does not');
  assert.equal(g.coverage.size, 0, 'no coverage bookkeeping in solo mode');
});

test('teams: full coverage pays the bonus, partial coverage does not', () => {
  const g = createGame([MULTI_Q], 2000);
  g.mode = 'teams';
  // players 1,2 are team 0 (they will cover both answers); players 3,4 are
  // team 1 (both pile onto one answer — correct but uncovered).
  g.cohortOf = (id) => (id <= 2 ? 0 : id <= 4 ? 1 : -1);
  const world = createWorld([]);
  for (const id of [1, 2, 3, 4, 5]) addPlayer(world, id);
  startGame(g, world);

  playRound(
    g,
    world,
    new Map([
      [1, 'ans0'],
      [2, 'ans2'],
      [3, 'ans0'],
      [4, 'ans0'],
      [5, 'ans2'], // team -1: correct, but teamless — never a bonus
    ])
  );

  const byId = new Map(g.results.map((r) => [r.id, r]));
  assert.ok((byId.get(1)?.points ?? 0) > BASE_POINTS + TEAM_COVER_BONUS - 1, 'covering member 1 got the bonus');
  assert.ok((byId.get(2)?.points ?? 0) > BASE_POINTS + TEAM_COVER_BONUS - 1, 'covering member 2 got the bonus');
  assert.ok((byId.get(3)?.points ?? 0) < BASE_POINTS + TEAM_COVER_BONUS, 'uncovered team got no bonus');
  assert.ok((byId.get(5)?.points ?? 0) < BASE_POINTS + TEAM_COVER_BONUS, 'teamless player got no bonus');

  assert.equal(g.coverage.get(0), true);
  assert.equal(g.coverage.get(1), false);
});

test('teams mode leaves single-answer questions alone', () => {
  const g = createGame([{ text: 'plain', answers: ['a', 'b'], correct: 0 }], 2000);
  g.mode = 'teams';
  g.cohortOf = () => 0;
  const world = createWorld([]);
  addPlayer(world, 1);
  startGame(g, world);

  playRound(g, world, new Map([[1, 'ans0']]));
  const r = g.results.find((x) => x.id === 1);
  assert.ok(r?.correct);
  assert.ok((r?.points ?? 0) <= BASE_POINTS + 500, 'no coverage bonus on a normal question');
  assert.equal(g.coverage.size, 0);
});

test('the reveal keeps every correct platform and fells the rest', () => {
  const g = createGame([MULTI_Q], 2000);
  const world = createWorld([]);
  addPlayer(world, 1);
  startGame(g, world);
  playRound(g, world, new Map([[1, 'ans0']]));

  const standing = world.platforms.filter((p) => p.id?.startsWith('ans')).map((p) => p.id).sort();
  assert.deepEqual(standing, ['ans0', 'ans2'], 'both correct boards survive');
  const fallen = g.debris.map((p) => p.id).sort();
  assert.deepEqual(fallen, ['ans1', 'ans3'], 'both wrong boards fall');
});

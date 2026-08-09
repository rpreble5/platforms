/**
 * Round machine and scoring.
 *
 * The latency-fairness tests near the bottom are the point of this file. Speed
 * scoring is the one place where network conditions could leak into someone's
 * score, and the whole architecture exists to stop that happening.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { BTN_JUMP } from '../shared/protocol.js';
import { STEP_MS } from '../shared/tuning.js';
import { addPlayer, createWorld, step } from './world.js';
import { ANSWER_Y, FLOOR_Y, buildArena, answerId } from './levels.js';
import {
  BASE_POINTS,
  MAX_SPEED_BONUS,
  PHASE,
  createGame,
  speedBonus,
  standings,
  startGame,
  stepGame,
} from './round.js';

/** @type {import('./round.js').Question[]} */
const DECK = [
  { text: 'Q one', answers: ['a', 'b', 'c', 'd'], correct: 1 },
  { text: 'Q two', answers: ['x', 'y'], correct: 0 },
];

/**
 * The result row for a player. Throws rather than returning undefined so a
 * missing row fails loudly instead of tripping a downstream assertion.
 * @param {import('./round.js').Game} g @param {number} id
 * @returns {import('./round.js').Result}
 */
function resultFor(g, id) {
  const r = g.results.find((x) => x.id === id);
  assert.ok(r, `expected a result for player ${id}`);
  return r;
}

/** @param {import('./round.js').Game} g @param {number} id @returns {number} */
function scoreFor(g, id) {
  const s = g.scores.get(id);
  assert.ok(s !== undefined, `expected a score for player ${id}`);
  return s;
}

/**
 * @param {import('./round.js').Question[]} [deck]
 * @param {number} [answerMs]
 */
function rig(deck = DECK, answerMs = 12000) {
  const world = createWorld(buildArena(4));
  const game = createGame(deck, answerMs);
  return { world, game };
}

/**
 * Advance both world and game by `ms`.
 * @param {import('./world.js').World} world
 * @param {import('./round.js').Game} game
 * @param {number} ms
 */
function run(world, game, ms) {
  const n = Math.round(ms / STEP_MS);
  for (let i = 0; i < n; i++) {
    step(world, STEP_MS);
    stepGame(game, world, STEP_MS);
  }
}

/**
 * Teleport a player onto a given answer platform.
 * @param {import('./world.js').World} world
 * @param {number} id
 * @param {number} answerIndex
 */
function standOn(world, id, answerIndex) {
  const plat = world.platforms.find((/** @type {any} */ q) => q.id === answerId(answerIndex));
  assert.ok(plat, `platform ${answerIndex} exists`);
  const p = /** @type {any} */ (world.players.get(id));
  p.x = plat.x + plat.w / 2 - p.w / 2;
  p.y = plat.y - p.h;
  p.vx = 0;
  p.vy = 0;
  p.onGround = true;
  p.standingOn = plat;
}

test('a round runs LOBBY -> INTRO -> ANSWER -> LOCK -> REVEAL -> SCORE', () => {
  const { world, game } = rig();
  addPlayer(world, 1);
  assert.equal(game.phase, PHASE.LOBBY);

  startGame(game, world);
  assert.equal(game.phase, PHASE.INTRO);

  run(world, game, 3100);
  assert.equal(game.phase, PHASE.ANSWER);

  run(world, game, 12100);
  assert.equal(game.phase, PHASE.LOCK);

  run(world, game, 500);
  assert.equal(game.phase, PHASE.REVEAL);

  run(world, game, 2300);
  assert.equal(game.phase, PHASE.SCORE);

  run(world, game, 4100);
  assert.equal(game.phase, PHASE.INTRO, 'rolls into the next question');
  assert.equal(game.qIndex, 1);
});

test('arriving earlier scores more than arriving later', () => {
  const { world, game } = rig();
  addPlayer(world, 1);
  addPlayer(world, 2);
  startGame(game, world);
  run(world, game, 3100); // into ANSWER

  standOn(world, 1, 1);
  run(world, game, 1000);
  standOn(world, 2, 1);

  run(world, game, 11500); // out of ANSWER, through LOCK
  assert.equal(game.phase, PHASE.REVEAL);

  const early = resultFor(game, 1);
  const late = resultFor(game, 2);
  assert.ok(early.correct && late.correct, 'both were on the right platform');
  assert.ok(early.points > late.points, `${early.points} should beat ${late.points}`);
  assert.equal(early.rank, 1);
  assert.equal(late.rank, 2);
});

test('a wrong platform scores nothing, and so does the floor', () => {
  const { world, game } = rig();
  addPlayer(world, 1);
  addPlayer(world, 2);
  startGame(game, world);
  run(world, game, 3100);

  standOn(world, 1, 3); // wrong answer
  // player 2 just stands on the floor
  run(world, game, 12600);

  assert.equal(resultFor(game, 1).points, 0);
  assert.equal(resultFor(game, 2).points, 0);
  assert.equal(scoreFor(game, 1), 0);
});

test('leaving the correct platform before the lock forfeits the points', () => {
  // First-touch sets your time, but presence at the buzzer is what pays. That
  // keeps an accidental bounce off the edge cheap while making an early
  // touch-and-run strictly riskier than simply staying put.
  const { world, game } = rig();
  addPlayer(world, 1);
  startGame(game, world);
  run(world, game, 3100);

  standOn(world, 1, 1);
  run(world, game, 500);
  assert.ok(game.arrivals.has(1), 'arrival was recorded');

  standOn(world, 1, 0); // wander off to a wrong platform
  run(world, game, 12100);

  assert.equal(resultFor(game, 1).correct, false);
  assert.equal(scoreFor(game, 1), 0);
});

test('the lock grace still counts a landing just after the buzzer', () => {
  // A landing that misses the timer by less than one round trip must count,
  // or latency decides whether an answer registered.
  const { world, game } = rig();
  addPlayer(world, 1);
  startGame(game, world);
  run(world, game, 3100);

  run(world, game, 12050); // timer has expired; we are inside LOCK
  assert.equal(game.phase, PHASE.LOCK);
  standOn(world, 1, 1);
  run(world, game, 400);

  assert.equal(game.phase, PHASE.REVEAL);
  assert.equal(resultFor(game, 1).correct, true, 'grace landing counted');
});

test('wrong platforms stop being solid at the reveal', () => {
  const { world, game } = rig();
  addPlayer(world, 1);
  startGame(game, world);
  run(world, game, 3100);
  assert.equal(world.platforms.filter((p) => p.id?.startsWith('ans')).length, 4);

  run(world, game, 12600);
  const left = world.platforms.filter((p) => p.id?.startsWith('ans'));
  assert.equal(left.length, 1, 'only the correct platform survives');
  assert.equal(left[0].id, answerId(1));
  assert.equal(game.debris.length, 3, 'the rest are kept for drawing as they fall');
});

test('someone standing on a wrong platform falls when it goes', () => {
  const { world, game } = rig();
  addPlayer(world, 1);
  startGame(game, world);
  run(world, game, 3100);
  standOn(world, 1, 3);
  const yBefore = /** @type {any} */ (world.players.get(1)).y;

  run(world, game, 12600); // through the reveal
  run(world, game, 400);
  assert.ok(/** @type {any} */ (world.players.get(1)).y > yBefore + 40, 'the floor came out from under them');
});

test('scores accumulate across questions', () => {
  const { world, game } = rig();
  addPlayer(world, 1);
  startGame(game, world);

  run(world, game, 3100);
  standOn(world, 1, 1);
  run(world, game, 12600);
  const afterOne = scoreFor(game, 1);
  assert.ok(afterOne > BASE_POINTS);

  run(world, game, 2300 + 4100 + 3100); // reveal, score, next intro
  assert.equal(game.qIndex, 1);
  standOn(world, 1, 0); // correct for question two
  run(world, game, 12600);

  assert.ok(scoreFor(game, 1) > afterOne, 'total went up');
  assert.equal(standings(game)[0].id, 1);
});

test('the deck ends in GAME_OVER', () => {
  const { world, game } = rig();
  addPlayer(world, 1);
  startGame(game, world);
  for (let i = 0; i < DECK.length; i++) run(world, game, 3100 + 12600 + 2300 + 4100);
  assert.equal(game.phase, PHASE.GAME_OVER);
});

test('pause freezes the round', () => {
  const { world, game } = rig();
  addPlayer(world, 1);
  startGame(game, world);
  game.paused = true;
  const t = game.phaseT;
  run(world, game, 5000);
  assert.equal(game.phaseT, t, 'no time passed for the round');
  assert.equal(game.phase, PHASE.INTRO);
});

// ---------------------------------------------------------------- fairness

test('speed bonus decays linearly and is clamped at both ends', () => {
  assert.equal(speedBonus(0, 12000), MAX_SPEED_BONUS);
  assert.equal(speedBonus(12000, 12000), 0);
  assert.equal(speedBonus(6000, 12000), MAX_SPEED_BONUS / 2);
  assert.equal(speedBonus(-500, 12000), MAX_SPEED_BONUS, 'never more than the max');
  assert.equal(speedBonus(99999, 12000), 0, 'never negative');
});

test('a realistic latency gap is worth almost nothing', () => {
  // The whole reason scoring decays over time rather than ranking: 150ms of
  // extra lag must not be able to cost a player a meaningful number of points,
  // because it is not something they can do anything about.
  const window = 12000;
  const fair = speedBonus(3000, window);
  const laggy = speedBonus(3150, window);
  assert.ok(fair - laggy <= 10, `150ms cost ${fair - laggy} points, should be under 10`);
});

test('two players who arrive together score the same despite different lag', () => {
  // Ranking would split them; decay does not. Rank is display only.
  const window = 12000;
  assert.equal(speedBonus(4000, window), speedBonus(4000, window));
  const a = speedBonus(4000, window);
  const b = speedBonus(4020, window);
  assert.equal(a, b, 'a 20ms difference does not change the score at all');
});

test('a player can actually reach every answer platform by jumping', () => {
  // Layout guard. If a platform is ever placed out of reach, the game becomes
  // unfair in a way no amount of latency work can fix.
  for (const n of [2, 3, 4]) {
    for (let i = 0; i < n; i++) {
      const world = createWorld(buildArena(n));
      const p = addPlayer(world, 1);
      const plat = /** @type {any} */ (world.platforms.find((q) => q.id === answerId(i)));

      // Stand on the floor directly beneath the platform, then jump straight up.
      p.x = plat.x + plat.w / 2 - p.w / 2;
      p.y = FLOOR_Y - p.h;
      p.vy = 0;
      step(world, STEP_MS);
      assert.ok(p.onGround, 'starts on the floor');

      p.input.pressEdge |= BTN_JUMP;
      let landed = false;
      for (let k = 0; k < 240; k++) {
        step(world, STEP_MS);
        if (p.standingOn?.id === answerId(i)) {
          landed = true;
          break;
        }
      }
      assert.ok(landed, `${n} answers: platform ${i} is reachable with a plain jump`);
    }
  }
});

test('the jump clears an answer platform with real margin', () => {
  // Not just reachable — comfortably so. If this margin ever gets thin, a
  // laggy player starts missing jumps and blaming the game.
  const world = createWorld(buildArena(4));
  const p = addPlayer(world, 1);
  p.x = 900;
  p.y = FLOOR_Y - p.h;
  p.vy = 0;
  step(world, STEP_MS);

  p.input.pressEdge |= BTN_JUMP;
  let apex = p.y;
  for (let k = 0; k < 240; k++) {
    step(world, STEP_MS);
    apex = Math.min(apex, p.y);
    if (p.vy > 0 && p.onGround) break;
  }
  const rose = FLOOR_Y - p.h - apex;
  const needed = FLOOR_Y - ANSWER_Y;
  assert.ok(rose > needed * 1.25, `rose ${rose.toFixed(0)}px, needs ${needed} — want 25%+ slack`);
});

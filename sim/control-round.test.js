import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CONTROL_ITEM_POINTS,
  CONTROL_PERFECT_BONUS,
  PHASE,
  buildQuestionSchedule,
  configureControlRounds,
  createGame,
  currentQuestion,
  startGame,
  stepRound,
  teamStandings,
} from './round.js';
import { addPlayer, createWorld } from './world.js';

/** @param {string} text @returns {import('./round.js').Question} */
function controlQuestion(text) {
  return {
    type: 'control',
    text,
    context: 'context',
    answerMs: 200,
    controls: Array.from({ length: 8 }, (_, i) => ({
      label: `item ${i + 1}`,
      kind: 'toggle',
      initial: false,
      answer: i < 3,
    })),
  };
}

test('the hybrid scheduler gives every team one distinct, evenly spaced turn', () => {
  const standard = Array.from({ length: 8 }, (_, i) => ({ text: `Q${i}`, answers: ['a', 'b'], correct: 0 }));
  const pool = [controlQuestion('A'), controlQuestion('B'), controlQuestion('C')];
  const scheduled = buildQuestionSchedule(standard, pool, [0, 1, 2], 1);
  const controls = scheduled.filter((q) => q.type === 'control');

  assert.equal(scheduled.length, 11);
  assert.deepEqual(controls.map((q) => q.team).sort(), [0, 1, 2]);
  assert.deepEqual(controls.map((q) => q.text), ['A', 'B', 'C']);
  for (let i = 1; i < scheduled.length; i++) {
    assert.ok(!(scheduled[i - 1].type === 'control' && scheduled[i].type === 'control'));
  }
});

test('an incomplete case pool never gives one team an extra turn', () => {
  const standard = [{ text: 'plain', answers: ['a', 'b'], correct: 0 }];
  const scheduled = buildQuestionSchedule(standard, [controlQuestion('A'), controlQuestion('B')], [0, 1, 2], 1);
  assert.deepEqual(scheduled, standard);
});

test('standalone scheduling contains only assigned Control Room turns', () => {
  const pool = [controlQuestion('A'), controlQuestion('B')];
  const scheduled = buildQuestionSchedule([], pool, [0, 1], 1, true, 1);
  assert.deepEqual(scheduled.map((q) => q.team), [1, 0]);
  assert.ok(scheduled.every((q) => q.type === 'control'));
});

test('spectator input is erased while the active team can move', () => {
  const g = createGame([]);
  g.mode = 'teams';
  g.cohortOf = (id) => id - 1;
  g.activeTeams = [0, 1];
  configureControlRounds(g, { questions: [controlQuestion('A'), controlQuestion('B')], perTeam: 1, only: true });
  const world = createWorld([]);
  const active = addPlayer(world, 1);
  const spectator = addPlayer(world, 2);
  startGame(g, world);

  const team = currentQuestion(g)?.team;
  const activePlayer = team === 0 ? active : spectator;
  const waitingPlayer = team === 0 ? spectator : active;
  activePlayer.input.held = 2;
  waitingPlayer.input.held = 2;
  waitingPlayer.input.pressEdge = 2;
  stepRound(g, world, 10);

  assert.equal(activePlayer.input.held, 2);
  assert.equal(waitingPlayer.input.held, 0);
  assert.equal(waitingPlayer.input.pressEdge, 0);
});

test('the locked board scores once into the active team ledger', () => {
  const g = createGame([]);
  g.mode = 'teams';
  g.cohortOf = () => 0;
  g.activeTeams = [0];
  configureControlRounds(g, { questions: [controlQuestion('A')], perTeam: 1, only: true });
  const world = createWorld([]);
  addPlayer(world, 1);
  startGame(g, world);

  stepRound(g, world, 3000);
  assert.equal(g.phase, PHASE.ANSWER);
  assert.ok(g.controlArena);
  g.controlArena.controls.forEach((control, i) => {
    control.value = i < 3;
  });
  stepRound(g, world, 200);
  assert.equal(g.phase, PHASE.LOCK);
  stepRound(g, world, 800);

  assert.equal(g.phase, PHASE.REVEAL);
  assert.deepEqual(g.controlResult, {
    team: 0,
    correct: 8,
    total: 8,
    points: 8 * CONTROL_ITEM_POINTS + CONTROL_PERFECT_BONUS,
    perfect: true,
  });
  assert.equal(g.teamBonuses.get(0), 8 * CONTROL_ITEM_POINTS + CONTROL_PERFECT_BONUS);
  assert.equal(g.scores.get(1), 0, 'cooperative points never masquerade as individual points');

  const [standing] = teamStandings(g.scores, () => 0, 1, g.teamBonuses);
  assert.equal(standing.avg, 8 * CONTROL_ITEM_POINTS + CONTROL_PERFECT_BONUS);
});

test('at GAME_OVER after a control-only game, nobody is gated any more', async () => {
  const { activeControlTeam, freezeInactiveControlInputs, isControlQuestion } = await import('./round.js');
  const { BTN_RIGHT } = await import('../shared/protocol.js');

  const g = createGame([], 200);
  g.mode = 'teams';
  g.cohortOf = (id) => (id === 1 ? 0 : 1); // player 1 is team 0, player 2 team 1
  g.activeTeams = [0];
  configureControlRounds(g, { questions: [controlQuestion('A')], perTeam: 1, only: true });

  const world = createWorld([]);
  addPlayer(world, 1);
  addPlayer(world, 2);
  startGame(g, world);

  // During the turn the spectator (team 1) is gated…
  assert.equal(activeControlTeam(g), 0, 'team 0 owns the live turn');
  const spectator = /** @type {any} */ (world.players.get(2));
  spectator.input.held = BTN_RIGHT;
  freezeInactiveControlInputs(g, world);
  assert.equal(spectator.input.held, 0, 'spectator input erased during the turn');

  // …then the deck ends. The last control question is still "current", but
  // the game-over screen is free-run time for the whole room.
  for (let t = 0; t < 600 && g.phase !== PHASE.GAME_OVER; t++) stepRound(g, world, 100);
  assert.equal(g.phase, PHASE.GAME_OVER);
  assert.ok(isControlQuestion(currentQuestion(g)), 'the control question is still current at GAME_OVER');
  assert.equal(activeControlTeam(g), null, 'but nobody is gated');

  spectator.input.held = BTN_RIGHT;
  stepRound(g, world, 8);
  assert.equal(spectator.input.held & BTN_RIGHT, BTN_RIGHT, 'spectator input flows at GAME_OVER');
});

test('pack control labels get the same length cap as the fixtures', async () => {
  const { CONTROL_LABEL_MAX_CHARS } = await import('./control-boxes.js');
  const g = createGame([], 200);
  g.activeTeams = [0];
  const long = controlQuestion('A');
  /** @type {any} */ (long.controls)[0].label = 'x'.repeat(CONTROL_LABEL_MAX_CHARS + 20);
  configureControlRounds(g, { questions: [long], perTeam: 1, only: true });
  const world = createWorld([]);
  startGame(g, world);
  assert.ok(g.controlArena, 'control arena built');
  assert.ok(
    g.controlArena.controls[0].label.length <= CONTROL_LABEL_MAX_CHARS,
    `label capped (${g.controlArena.controls[0].label.length} chars)`
  );
});

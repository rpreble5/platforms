/**
 * Showdown: true/false sudden death. A SEPARATE mode, deliberately not wired
 * into quiz scoring — no points, no scoreboard, no team strip. The prize is
 * being the last one standing, and that's the whole prize.
 *
 * The floor is split in half: TRUE on the left, FALSE on the right. Each
 * statement gets a short answer window; at the buzzer the wrong half of the
 * floor collapses and takes its occupants with it. Eliminated players land in
 * the off-screen pit and spectate. Repeat until one player remains, or the
 * statements run out (everyone still up is a co-victor).
 *
 * One mercy rule: a statement that would eliminate EVERYONE eliminates no one
 * — the mode must end with a winner, not an empty room. The floor halves are
 * named floorL/floorR so the display's existing floor renderer and debris
 * slabs work unchanged.
 *
 * Pure like round.js — Node runs this directly in tests.
 */

import { WORLD_H, WORLD_W } from '../shared/tuning.js';
import { FLOOR_Y } from './levels.js';
import { LOCK_MS, DEBRIS_LIFE_MS, freezeInputs, respawnAll } from './round.js';
import { step } from './world.js';

/** @typedef {import('./collide.js').Platform} Platform */
/** @typedef {import('./world.js').World} World */

export const SD_PHASE = /** @type {const} */ ({
  SHOW: 'SHOW',
  ANSWER: 'ANSWER',
  LOCK: 'LOCK',
  REVEAL: 'REVEAL',
  VICTORY: 'VICTORY',
  DONE: 'DONE',
});

/** Time to read the statement before the window opens. */
export const SD_SHOW_MS = 1600;
/** Default answer window — short on purpose; the mode lives on pace. */
export const SD_ANSWER_MS = 6000;
export const SD_REVEAL_MS = 2200;
export const SD_VICTORY_MS = 6000;

export const TRUE_ID = 'floorL';
export const FALSE_ID = 'floorR';
/** Where the halves meet. */
export const SPLIT_X = WORLD_W / 2;

/**
 * @typedef {object} Statement
 * @property {string} text
 * @property {boolean} answer
 */

/**
 * @typedef {object} Showdown
 * @property {string} phase
 * @property {number} phaseT
 * @property {Statement[]} statements
 * @property {number} index
 * @property {number} answerMs
 * @property {Set<number>} alive
 * @property {number} startedWith
 * @property {number[]} winners empty until VICTORY
 * @property {boolean} freePass last reveal eliminated nobody because everyone was wrong
 * @property {Platform[]} debris
 * @property {number} debrisT
 * @property {boolean} paused
 */

/** @returns {Platform[]} */
export function buildShowdownArena() {
  return [
    { id: TRUE_ID, x: -400, y: FLOOR_Y, w: SPLIT_X + 400, h: 260 },
    { id: FALSE_ID, x: SPLIT_X, y: FLOOR_Y, w: WORLD_W + 400 - SPLIT_X, h: 260 },
    // Same pit as the range rounds: fallers land once, off screen, and stay.
    { id: 'pit', x: -400, y: WORLD_H + 150, w: WORLD_W + 800, h: 60 },
  ];
}

/**
 * @param {{statements: Statement[], answerMs?: number}} spec
 * @param {World} world
 * @param {number[]} playerIds who competes (the caller excludes the keyboard
 *   test player — an idle avatar surviving on luck could win the whole thing)
 * @returns {Showdown}
 */
export function createShowdown(spec, world, playerIds) {
  world.platforms = buildShowdownArena();
  respawnAll(world);
  return {
    phase: SD_PHASE.SHOW,
    phaseT: 0,
    statements: spec.statements,
    index: 0,
    answerMs: spec.answerMs ?? SD_ANSWER_MS,
    alive: new Set(playerIds),
    startedWith: playerIds.length,
    winners: [],
    freePass: false,
    debris: [],
    debrisT: 0,
    paused: false,
  };
}

/** @param {Showdown} s @returns {Statement | null} */
export function currentStatement(s) {
  return s.statements[s.index] ?? null;
}

/**
 * Inputs are live only while a statement can still be answered — same
 * commitment rule as the quiz: after the buzzer you stand where you stood.
 * Spectators in the pit keep their inputs; they can pace down there.
 * @param {Showdown} s
 * @returns {boolean}
 */
export function sdInputsLive(s) {
  return s.phase === SD_PHASE.SHOW || s.phase === SD_PHASE.ANSWER;
}

/**
 * One tick: freeze-then-physics-then-machine, the same load-bearing order as
 * stepRound. This is the only entry point.
 * @param {Showdown} s
 * @param {World} world
 * @param {number} dtMs
 */
export function stepShowdown(s, world, dtMs) {
  if (!sdInputsLive(s)) freezeInputs(world);
  step(world, dtMs);

  if (s.paused) return;
  s.phaseT += dtMs;

  if (s.debris.length) {
    s.debrisT += dtMs;
    if (s.debrisT > DEBRIS_LIFE_MS) s.debris = [];
  }

  switch (s.phase) {
    case SD_PHASE.SHOW:
      if (s.phaseT >= SD_SHOW_MS) enter(s, SD_PHASE.ANSWER);
      break;

    case SD_PHASE.ANSWER:
      if (s.phaseT >= s.answerMs) {
        freezeInputs(world);
        enter(s, SD_PHASE.LOCK);
      }
      break;

    case SD_PHASE.LOCK:
      if (s.phaseT >= LOCK_MS) {
        resolve(s, world);
        enter(s, SD_PHASE.REVEAL);
      }
      break;

    case SD_PHASE.REVEAL:
      if (s.phaseT >= SD_REVEAL_MS) {
        if (s.alive.size <= 1 || s.index + 1 >= s.statements.length) {
          s.winners = [...s.alive];
          enter(s, SD_PHASE.VICTORY);
        } else {
          s.index++;
          nextStatement(s, world);
        }
      }
      break;

    case SD_PHASE.VICTORY:
      if (s.phaseT >= SD_VICTORY_MS) enter(s, SD_PHASE.DONE);
      break;

    default:
      break;
  }
}

/**
 * Skip the current statement without eliminating anyone — the host's escape
 * hatch for a broken or contested question.
 * @param {Showdown} s
 * @param {World} world
 */
export function sdSkip(s, world) {
  if (s.phase === SD_PHASE.VICTORY || s.phase === SD_PHASE.DONE) {
    enter(s, SD_PHASE.DONE);
    return;
  }
  if (s.index + 1 >= s.statements.length) {
    s.winners = [...s.alive];
    enter(s, SD_PHASE.VICTORY);
    return;
  }
  s.index++;
  nextStatement(s, world);
}

/**
 * @param {Showdown} s
 * @param {string} phase
 */
function enter(s, phase) {
  s.phase = phase;
  s.phaseT = 0;
}

/** @param {Showdown} s @param {World} world */
function nextStatement(s, world) {
  // The floor comes back whole; survivors keep their positions, fallers stay
  // in the pit. No respawn between statements — pace is the mode.
  world.platforms = buildShowdownArena();
  s.debris = [];
  s.debrisT = 0;
  s.freePass = false;
  enter(s, SD_PHASE.SHOW);
}

/**
 * The buzzer. Everyone alive is judged by the half they settled on, the wrong
 * half of the floor stops being solid, and whoever it was holding goes down
 * with it.
 * @param {Showdown} s
 * @param {World} world
 */
function resolve(s, world) {
  const st = currentStatement(s);
  if (!st) return;
  const wrongId = st.answer ? FALSE_ID : TRUE_ID;

  /** @type {number[]} */
  const losers = [];
  for (const id of s.alive) {
    const p = world.players.get(id);
    if (!p) {
      losers.push(id); // left the game entirely mid-showdown
      continue;
    }
    const settled = (p.standingOn ?? p.lastStoodOn)?.id;
    if (settled !== (st.answer ? TRUE_ID : FALSE_ID)) losers.push(id);
  }

  // Mercy rule: a statement that fells the whole field fells nobody.
  if (losers.length >= s.alive.size) {
    s.freePass = true;
    return;
  }

  for (const id of losers) s.alive.delete(id);
  const doomed = world.platforms.filter((p) => p.id === wrongId);
  world.platforms = world.platforms.filter((p) => !doomed.includes(p));
  s.debris = doomed;
  s.debrisT = 0;
  s.freePass = false;
}

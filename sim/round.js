/**
 * Round state machine and scoring. Pure — Node runs this directly in tests.
 *
 * SCORING, and why it is shaped this way:
 *
 * Points decay smoothly with arrival time rather than being ranked. Ranking
 * would make the score depend on ordering, and at 30 players the gap between
 * adjacent arrivals is often tens of milliseconds — which is the same size as
 * the spread in network latency. Rank scoring would therefore quietly hand
 * points to whoever has the better phone and the better spot in the room.
 *
 * A linear decay over a 12-second window makes 100ms worth about four points
 * out of five hundred. So what actually gets rewarded is deciding fast, not
 * having a fast connection — which is the only version of "first gets more"
 * that's fair to run at a party.
 *
 * Rank is still shown on screen, because "you were 3rd!" is the fun part. It
 * just doesn't drive the maths.
 */

import { buildArena, answerId, spawnFor } from './levels.js';

export const PHASE = /** @type {const} */ ({
  LOBBY: 'LOBBY',
  INTRO: 'INTRO',
  ANSWER: 'ANSWER',
  LOCK: 'LOCK',
  REVEAL: 'REVEAL',
  SCORE: 'SCORE',
  GAME_OVER: 'GAME_OVER',
});

export const BASE_POINTS = 1000;
export const MAX_SPEED_BONUS = 500;

/** Question slides in and platforms rise. Inputs stay live throughout. */
export const INTRO_MS = 3000;
/**
 * Undocumented grace after the timer visually hits zero. A landing that misses
 * the buzzer by less than one round-trip still counts. Nobody is told about it;
 * it exists so latency never decides whether an answer registered.
 */
export const LOCK_MS = 400;
export const REVEAL_MS = 2200;
export const SCORE_MS = 4000;

/**
 * @typedef {object} Question
 * @property {string} text
 * @property {string[]} answers
 * @property {number} correct
 * @property {number} [answerMs]
 */

/**
 * @typedef {object} Result
 * @property {number} id
 * @property {boolean} correct
 * @property {number} points
 * @property {number} rank 1-based among correct answerers, 0 if wrong
 * @property {number} arrivalMs
 */

/**
 * @typedef {object} Game
 * @property {string} phase
 * @property {number} phaseT ms elapsed in the current phase
 * @property {Question[]} questions
 * @property {number} qIndex
 * @property {number} answerMs
 * @property {Map<number, number>} scores playerId -> total
 * @property {Map<number, number>} arrivals playerId -> ms after ANSWER started
 * @property {Result[]} results from the round just scored
 * @property {import('./collide.js').Platform[]} debris crumbled platforms, for drawing
 * @property {boolean} paused
 */

/**
 * @param {Question[]} questions
 * @param {number} [answerMs]
 * @returns {Game}
 */
export function createGame(questions, answerMs = 12000) {
  return {
    phase: PHASE.LOBBY,
    phaseT: 0,
    questions,
    qIndex: -1,
    answerMs,
    scores: new Map(),
    arrivals: new Map(),
    results: [],
    debris: [],
    paused: false,
  };
}

/** @param {Game} g @returns {Question | null} */
export function currentQuestion(g) {
  return g.questions[g.qIndex] ?? null;
}

/** @param {Game} g @returns {number} ms allowed for the current question */
export function answerWindow(g) {
  return currentQuestion(g)?.answerMs ?? g.answerMs;
}

/**
 * Advance the game one tick. Mutates both the game and the world (platforms
 * come and go between phases).
 * @param {Game} g
 * @param {import('./world.js').World} world
 * @param {number} dtMs
 */
export function stepGame(g, world, dtMs) {
  if (g.paused) return;
  g.phaseT += dtMs;

  switch (g.phase) {
    case PHASE.LOBBY:
      break;

    case PHASE.INTRO:
      if (g.phaseT >= INTRO_MS) enter(g, world, PHASE.ANSWER);
      break;

    case PHASE.ANSWER:
      recordArrivals(g, world);
      if (g.phaseT >= answerWindow(g)) enter(g, world, PHASE.LOCK);
      break;

    case PHASE.LOCK:
      // Arrivals still count here — that IS the grace window.
      recordArrivals(g, world, answerWindow(g));
      if (g.phaseT >= LOCK_MS) {
        score(g, world);
        enter(g, world, PHASE.REVEAL);
      }
      break;

    case PHASE.REVEAL:
      if (g.phaseT >= REVEAL_MS) enter(g, world, PHASE.SCORE);
      break;

    case PHASE.SCORE:
      if (g.phaseT >= SCORE_MS) {
        if (g.qIndex + 1 >= g.questions.length) enter(g, world, PHASE.GAME_OVER);
        else nextQuestion(g, world);
      }
      break;

    case PHASE.GAME_OVER:
      break;

    default:
      break;
  }
}

/**
 * @param {Game} g
 * @param {import('./world.js').World} world
 * @param {string} phase
 */
function enter(g, world, phase) {
  g.phase = phase;
  g.phaseT = 0;

  if (phase === PHASE.REVEAL) {
    // Wrong platforms stop being solid immediately; they keep being drawn as
    // debris for a moment. Inputs stay live, so you can leap off one as it goes.
    const q = currentQuestion(g);
    if (q) {
      const keep = answerId(q.correct);
      const doomed = world.platforms.filter((p) => p.id?.startsWith('ans') && p.id !== keep);
      world.platforms = world.platforms.filter((p) => !doomed.includes(p));
      g.debris = doomed;
    }
  }
}

/**
 * Start the deck from the beginning.
 * @param {Game} g @param {import('./world.js').World} world
 */
export function startGame(g, world) {
  g.scores.clear();
  g.qIndex = -1;
  nextQuestion(g, world);
}

/** @param {Game} g @param {import('./world.js').World} world */
export function nextQuestion(g, world) {
  g.qIndex++;
  const q = currentQuestion(g);
  if (!q) {
    enter(g, world, PHASE.GAME_OVER);
    return;
  }
  g.arrivals.clear();
  g.results = [];
  g.debris = [];
  world.platforms = buildArena(q.answers.length);
  respawnAll(world);
  enter(g, world, PHASE.INTRO);
}

/**
 * Skip whatever is happening and move straight to the next question.
 * @param {Game} g @param {import('./world.js').World} world
 */
export function skip(g, world) {
  if (g.qIndex + 1 >= g.questions.length) enter(g, world, PHASE.GAME_OVER);
  else nextQuestion(g, world);
}

/** @param {import('./world.js').World} world */
export function respawnAll(world) {
  let i = 0;
  for (const p of world.players.values()) {
    const s = spawnFor(p.id + i);
    p.x = s.x;
    p.y = s.y;
    p.vx = 0;
    p.vy = 0;
    p.jumpBuffer = 0;
    p.coyote = 0;
    i++;
  }
}

/**
 * Note the first moment each player touches the correct platform.
 *
 * First touch rather than continuous presence, because bouncing off an edge and
 * hopping back on shouldn't cost you your time. Presence at LOCK is still
 * required to score, so leaving early is strictly riskier than staying.
 * @param {Game} g
 * @param {import('./world.js').World} world
 * @param {number} [offset] ms to add (used during LOCK, past the window)
 */
function recordArrivals(g, world, offset = 0) {
  const q = currentQuestion(g);
  if (!q) return;
  const target = answerId(q.correct);
  for (const p of world.players.values()) {
    if (g.arrivals.has(p.id)) continue;
    if (p.standingOn?.id === target) g.arrivals.set(p.id, offset + g.phaseT);
  }
}

/**
 * @param {Game} g
 * @param {import('./world.js').World} world
 */
function score(g, world) {
  const q = currentQuestion(g);
  if (!q) return;
  const target = answerId(q.correct);
  const window = answerWindow(g);

  /** @type {Result[]} */
  const results = [];
  for (const p of world.players.values()) {
    const onTarget = p.standingOn?.id === target;
    if (!onTarget) {
      results.push({ id: p.id, correct: false, points: 0, rank: 0, arrivalMs: Infinity });
      continue;
    }
    const arrivalMs = g.arrivals.get(p.id) ?? window;
    results.push({
      id: p.id,
      correct: true,
      points: BASE_POINTS + speedBonus(arrivalMs, window),
      rank: 0,
      arrivalMs,
    });
  }

  // Rank is display only — it never feeds the maths, precisely so that a
  // photo-finish decided by someone's WiFi can't change anyone's score.
  results
    .filter((r) => r.correct)
    .sort((a, b) => a.arrivalMs - b.arrivalMs)
    .forEach((r, i) => {
      r.rank = i + 1;
    });

  for (const r of results) {
    g.scores.set(r.id, (g.scores.get(r.id) ?? 0) + r.points);
  }
  results.sort((a, b) => b.points - a.points || a.id - b.id);
  g.results = results;
}

/**
 * Linear decay across the answer window: arrive as it opens for the full bonus,
 * arrive as it closes for none.
 * @param {number} arrivalMs
 * @param {number} windowMs
 * @returns {number}
 */
export function speedBonus(arrivalMs, windowMs) {
  if (windowMs <= 0) return 0;
  const frac = Math.max(0, Math.min(1, arrivalMs / windowMs));
  return Math.round(MAX_SPEED_BONUS * (1 - frac));
}

/**
 * @param {Game} g
 * @returns {Array<{id:number, score:number}>} highest first
 */
export function standings(g) {
  return [...g.scores.entries()]
    .map(([id, s]) => ({ id, score: s }))
    .sort((a, b) => b.score - a.score || a.id - b.id);
}

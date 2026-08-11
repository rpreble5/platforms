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

import { RANGE_ID, buildArena, buildRangeArena, answerId, spawnFor } from './levels.js';
import { step } from './world.js';

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
 * The settle window, after the buzzer and before the reveal.
 *
 * Player input STOPS here, but physics keeps running. Two reasons, and both
 * were bugs before this existed:
 *
 *  - Anyone mid-jump when the timer ended had `standingOn === null` and scored
 *    nothing. A full jump arc is ~680ms, so this is long enough that everybody
 *    lands before anything is counted.
 *  - With inputs live through the reveal, the crowd kept milling about and you
 *    couldn't actually see where people had committed. Freezing makes the
 *    answer legible, which is the whole point of the moment.
 *
 * It doubles as the latency grace it used to be: a landing that misses the
 * buzzer by a round-trip still counts.
 */
export const LOCK_MS = 800;
export const REVEAL_MS = 2200;
export const SCORE_MS = 4000;
/** How long crumbled platforms keep falling before they're dropped. */
export const DEBRIS_LIFE_MS = 1600;

/**
 * Two kinds of question share one deck.
 *
 * Multiple choice (`type` absent): `answers` + `correct`, answered by standing
 * on a signboard platform.
 *
 * Range (`type: 'range'`): `min`/`max` describe a number line drawn along the
 * floor, `answer` is the inclusive correct interval, and players answer by
 * standing inside it. The floor is built in three segments with the correct
 * band carrying the answer id, so everything below `targetId` is shared.
 *
 * @typedef {object} Question
 * @property {string} text
 * @property {'range'} [type]
 * @property {string[]} [answers]
 * @property {number} [correct]
 * @property {import('./levels.js').Layout} [layout] choice arenas only; islands if absent
 * @property {number} [min]
 * @property {number} [max]
 * @property {[number, number]} [answer]
 * @property {string} [unit]
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
 * @property {number} debrisT ms since they started falling — its OWN clock, not
 *   phaseT, which resets between phases and made the fall replay
 * @property {Map<number, string|null>} atBuzzer playerId -> platform id they were
 *   on when the timer ended
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
    debrisT: 0,
    atBuzzer: new Map(),
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
 * The platform that counts as the correct answer — a signboard for multiple
 * choice, the floor band for a range. Everything that scores goes through
 * this, so neither the arrivals recorder nor the buzzer snapshot knows which
 * kind of round it is in.
 * @param {Question} q
 * @returns {string}
 */
export function targetId(q) {
  return q.type === 'range' ? RANGE_ID : answerId(q.correct ?? 0);
}

/**
 * One tick of everything, in the only order that is correct.
 *
 * The freeze has to happen BEFORE physics, or held buttons get one tick of
 * movement each frame and the crowd keeps drifting through the reveal. Leaving
 * that ordering to the caller is how it gets broken, so this is the entry point
 * both the display and the tests use.
 *
 * @param {Game} g
 * @param {import('./world.js').World} world
 * @param {number} dtMs
 */
export function stepRound(g, world, dtMs) {
  if (!inputsLive(g)) freezeInputs(world);
  step(world, dtMs);
  stepGame(g, world, dtMs);
}

/**
 * Advance the game one tick. Mutates both the game and the world (platforms
 * come and go between phases). Prefer `stepRound`, which also runs physics in
 * the right order relative to the input freeze.
 * @param {Game} g
 * @param {import('./world.js').World} world
 * @param {number} dtMs
 */
export function stepGame(g, world, dtMs) {
  if (g.paused) return;
  g.phaseT += dtMs;

  // Debris runs on its own clock so the fall doesn't restart when the phase
  // changes underneath it, and clears itself once it's off screen.
  if (g.debris.length) {
    g.debrisT += dtMs;
    if (g.debrisT > DEBRIS_LIFE_MS) g.debris = [];
  }

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

  if (phase === PHASE.LOCK) {
    // Freeze the answer at the buzzer. Someone mid-jump counts as being on the
    // platform they launched from — they committed before the timer ended, and
    // with inputs now dead they can't change it.
    g.atBuzzer = new Map();
    for (const p of world.players.values()) {
      g.atBuzzer.set(p.id, (p.standingOn ?? p.lastStoodOn)?.id ?? null);
    }
    freezeInputs(world);
  }

  if (phase === PHASE.REVEAL) {
    // Wrong platforms stop being solid immediately, and keep being drawn as
    // debris for a beat so the fall reads as consequence. Anyone standing on
    // one drops with it — inputs are already frozen, so there's no scrambling
    // off, which is what makes the moment legible.
    //
    // In a range round the "wrong platforms" are the floor itself: everything
    // outside the correct band falls away, and whoever guessed wrong falls
    // with the ground they chose to stand on.
    const q = currentQuestion(g);
    if (q) {
      const keep = targetId(q);
      const doomed = world.platforms.filter((p) =>
        q.type === 'range'
          ? p.id === 'floorL' || p.id === 'floorR'
          : p.id?.startsWith('ans') && p.id !== keep
      );
      world.platforms = world.platforms.filter((p) => !doomed.includes(p));
      g.debris = doomed;
      g.debrisT = 0;
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
  g.atBuzzer.clear();
  g.results = [];
  g.debris = [];
  g.debrisT = 0;
  world.platforms =
    q.type === 'range'
      ? buildRangeArena(/** @type {import('./levels.js').RangeQuestion} */ (q))
      : buildArena(q.answers?.length ?? 2, q.layout);
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

/**
 * Whether player input should reach the simulation.
 *
 * Dead from the buzzer until the next question: through the settle, the reveal
 * and the scoreboard, players stay exactly where they committed. Everywhere
 * else — lobby, question intro, the answer window, game over — they can run
 * around freely.
 * @param {Game} g
 * @returns {boolean}
 */
export function inputsLive(g) {
  return g.phase !== PHASE.LOCK && g.phase !== PHASE.REVEAL && g.phase !== PHASE.SCORE;
}

/**
 * Drop every held button and any buffered jump. Velocity is left alone — people
 * mid-jump finish their arc, which is what makes the settle look like physics
 * rather than a freeze-frame.
 * @param {import('./world.js').World} world
 */
export function freezeInputs(world) {
  for (const p of world.players.values()) {
    p.input.held = 0;
    p.input.pressEdge = 0;
    p.input.releaseEdge = 0;
    p.jumpBuffer = 0;
  }
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
    p.standingOn = null;
    p.lastStoodOn = null;
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
  const target = targetId(q);
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
  const target = targetId(q);
  const window = answerWindow(g);

  /** @type {Result[]} */
  const results = [];
  for (const p of world.players.values()) {
    // Credit either way round: you were on it when the timer ended, or you
    // landed on it during the settle. The union is deliberate — inputs are
    // dead after the buzzer, so there's nothing to game, and every way of
    // losing credit through no fault of your own is closed off.
    const settled = (p.standingOn ?? p.lastStoodOn)?.id;
    const onTarget = g.atBuzzer.get(p.id) === target || settled === target;
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
 * Team totals by training year.
 *
 * The number that matters is the AVERAGE, not the sum: the years are never
 * exactly the same size, and a team score that a cohort wins by simply having
 * more residents in the room isn't a rivalry, it's a headcount. `cohortOf`
 * returns a team index, or -1 to exclude (keyboard player, anyone who never
 * picked a year).
 *
 * @param {Map<number, number>} scores
 * @param {(id: number) => number} cohortOf
 * @param {number} [teamCount]
 * @returns {Array<{count:number, total:number, avg:number}>}
 */
export function teamStandings(scores, cohortOf, teamCount = 3) {
  const teams = Array.from({ length: teamCount }, () => ({ count: 0, total: 0, avg: 0 }));
  for (const [id, s] of scores) {
    const c = cohortOf(id);
    if (c < 0 || c >= teamCount) continue;
    teams[c].count++;
    teams[c].total += s;
  }
  for (const t of teams) t.avg = t.count ? Math.round(t.total / t.count) : 0;
  return teams;
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

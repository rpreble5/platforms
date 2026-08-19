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

import { RANGE_ID, buildArena, buildCustomArena, buildRangeArena, answerId, spawnFor } from './levels.js';
import { CONTROL_LABEL_MAX_CHARS, buildControlArena, stepControls } from './control-boxes.js';
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
/**
 * Paid to every covering member of a team that puts someone on EVERY correct
 * platform of a select-all question (teams mode only). Sized against
 * BASE_POINTS so coordination matters but a fast solo answer still beats a
 * sloppy covered one.
 */
export const TEAM_COVER_BONUS = 500;
/** Cooperative Control Room scoring goes straight to the team's ledger. */
export const CONTROL_ITEM_POINTS = 200;
export const CONTROL_PERFECT_BONUS = 600;

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
 * @property {'range'|'control'} [type]
 * @property {string[]} [answers]
 * @property {number | number[]} [correct] one index, or several for
 *   select-all-that-apply (any correct platform scores; in teams mode a
 *   cohort covering all of them earns TEAM_COVER_BONUS)
 * @property {import('./levels.js').Layout} [layout] choice arenas only; islands if absent
 * @property {string} [level] pin a designed level from the pool by name;
 *   ignored if its answer count doesn't match this question's
 * @property {number} [min]
 * @property {number} [max]
 * @property {[number, number]} [answer]
 * @property {string} [unit]
 * @property {number} [answerMs]
 * @property {string} [context] control questions only
 * @property {Array<{
 *   label:string,
 *   kind:'toggle'|'number',
 *   initial:boolean|number,
 *   answer:boolean|number,
 *   min?:number,
 *   max?:number,
 *   step?:number,
 *   unit?:string
 * }>} [controls]
 * @property {number} [team] assigned cohort for a scheduled control turn
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
 * @property {import('./levels.js').LevelSpec[]} levelPool designed levels; a
 *   choice question uses one whose board count matches, rotating by qIndex
 * @property {'solo'|'teams'} mode teams = cohort play: select-all questions
 *   pay a coverage bonus when a year covers every correct platform
 * @property {(id: number) => number} cohortOf team index for a player, or -1
 *   to exclude (keyboard player, anyone who never picked a year); supplied by
 *   the display, so the sim never knows about rosters
 * @property {Map<number, boolean>} coverage per-team full-coverage verdicts
 *   from the round just scored (empty outside teams-mode select-all rounds)
 * @property {Question[]} baseQuestions unscheduled standard deck
 * @property {Question[]} controlPool reusable control-question pool
 * @property {number} controlPerTeam requested turns for every active team
 * @property {boolean} controlOnly standalone Control Room playlist
 * @property {number[]} activeTeams frozen team set for this game
 * @property {number} controlStartOffset rotates the first team on replay
 * @property {Map<number, number>} teamBonuses cooperative points by team
 * @property {import('./control-boxes.js').ControlArena | null} controlArena
 * @property {{team:number, correct:number, total:number, points:number, perfect:boolean} | null} controlResult
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
    levelPool: [],
    mode: /** @type {'solo'|'teams'} */ ('solo'),
    cohortOf: () => -1,
    coverage: new Map(),
    baseQuestions: questions.slice(),
    controlPool: [],
    controlPerTeam: 0,
    controlOnly: false,
    activeTeams: [],
    controlStartOffset: 0,
    teamBonuses: new Map(),
    controlArena: null,
    controlResult: null,
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

/** @param {Question | null | undefined} q */
export function isControlQuestion(q) {
  return q?.type === 'control';
}

/**
 * The team whose turn is being gated RIGHT NOW, or null when nobody should
 * be gated. This is the one place that knows a control turn is only "live"
 * during its own phases: at GAME_OVER (and in the lobby) currentQuestion()
 * still returns the last question, and gating off the question alone left
 * every spectator frozen and invisible on the final-standings screen of a
 * control-only game. All three gates — input freeze, bus drain, and the
 * render filter — go through here.
 * @param {Game} g
 * @returns {number | null}
 */
export function activeControlTeam(g) {
  if (g.phase === PHASE.LOBBY || g.phase === PHASE.GAME_OVER) return null;
  const q = currentQuestion(g);
  if (!isControlQuestion(q)) return null;
  return q?.team ?? -1;
}

/**
 * Configure the reusable Control Room pool. Scheduling waits until startGame,
 * when the display has frozen the set of participating teams.
 * @param {Game} g
 * @param {{questions?:Question[], perTeam?:number, only?:boolean}} spec
 */
export function configureControlRounds(g, spec = {}) {
  g.controlPool = Array.isArray(spec.questions) ? spec.questions.slice() : [];
  g.controlPerTeam = Math.max(0, Math.floor(spec.perTeam ?? 0));
  g.controlOnly = Boolean(spec.only);
}

/**
 * Assign distinct cases evenly, then distribute them through the standard
 * deck. Incomplete rounds are deliberately omitted: one team never receives
 * an extra turn merely because a pack ran short of cases.
 * @param {Question[]} standard
 * @param {Question[]} pool
 * @param {number[]} teams
 * @param {number} perTeam
 * @param {boolean} [only]
 * @param {number} [startOffset]
 * @returns {Question[]}
 */
export function buildQuestionSchedule(standard, pool, teams, perTeam, only = false, startOffset = 0) {
  const active = [...new Set(teams.filter((t) => Number.isInteger(t) && t >= 0))].sort((a, b) => a - b);
  const requested = Math.max(0, Math.floor(perTeam));
  const fullRounds = active.length ? Math.min(requested, Math.floor(pool.length / active.length)) : 0;
  /** @type {Question[]} */
  const assigned = [];
  let poolIndex = 0;
  for (let round = 0; round < fullRounds; round++) {
    for (let seat = 0; seat < active.length; seat++) {
      const team = active[(seat + round + startOffset) % active.length];
      assigned.push({ ...pool[poolIndex++], type: 'control', team });
    }
  }

  if (only) return assigned;
  if (!assigned.length || !standard.length) return standard.slice();

  /** @type {Question[][]} */
  const after = Array.from({ length: standard.length }, () => []);
  assigned.forEach((q, i) => {
    const slot = Math.min(
      standard.length - 1,
      Math.floor(((i + 1) * standard.length) / (assigned.length + 1))
    );
    after[slot].push(q);
  });

  /** @type {Question[]} */
  const scheduled = [];
  standard.forEach((q, i) => {
    scheduled.push(q, ...after[i]);
  });
  return scheduled;
}

/**
 * Every correct answer index for a choice question. `correct` is a single
 * index for a normal question or an array for select-all-that-apply; this is
 * the one place that difference is absorbed.
 * @param {Question} q
 * @returns {number[]}
 */
export function correctIndexes(q) {
  return Array.isArray(q.correct) ? q.correct : [q.correct ?? 0];
}

/** @param {Question} q @returns {boolean} more than one platform is right */
export function isMulti(q) {
  return q.type !== 'range' && correctIndexes(q).length > 1;
}

/**
 * The platforms that count as correct — the floor band for a range, one or
 * several signboards for choice. Everything that scores goes through this,
 * so neither the arrivals recorder nor the buzzer snapshot knows which kind
 * of round it is in, or how many right answers it has.
 * @param {Question} q
 * @returns {Set<string>}
 */
export function targetIds(q) {
  return q.type === 'range' ? new Set([RANGE_ID]) : new Set(correctIndexes(q).map(answerId));
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
  const q = currentQuestion(g);
  if (!inputsLive(g)) freezeInputs(world);
  else if (activeControlTeam(g) !== null) freezeInactiveControlInputs(g, world);
  step(world, dtMs);
  if (isControlQuestion(q) && g.phase === PHASE.ANSWER && g.controlArena) {
    const team = q?.team ?? -1;
    const impacts = world.impacts.filter((hit) => g.cohortOf(hit.playerId) === team);
    stepControls(g.controlArena, impacts, world.t);
  }
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
    if (q && !isControlQuestion(q)) {
      const keep = targetIds(q);
      const doomed = world.platforms.filter((p) =>
        q.type === 'range'
          ? p.id === 'floorL' || p.id === 'floorR'
          : p.id?.startsWith('ans') && !keep.has(p.id)
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
  for (const p of world.players.values()) g.scores.set(p.id, 0);
  g.teamBonuses.clear();
  g.questions = buildQuestionSchedule(
    g.baseQuestions,
    g.controlPool,
    g.activeTeams,
    g.controlPerTeam,
    g.controlOnly,
    g.controlStartOffset
  );
  if (g.activeTeams.length) g.controlStartOffset = (g.controlStartOffset + 1) % g.activeTeams.length;
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
  g.controlResult = null;
  if (isControlQuestion(q)) {
    g.controlArena = buildControlQuestionArena(q);
    world.platforms = g.controlArena.platforms;
  } else {
    g.controlArena = null;
    world.platforms =
      q.type === 'range'
        ? buildRangeArena(/** @type {import('./levels.js').RangeQuestion} */ (q))
        : choiceArena(g, q);
  }
  respawnAll(world);
  enter(g, world, PHASE.INTRO);
}

/** @param {Question} q @returns {import('./control-boxes.js').ControlArena} */
function buildControlQuestionArena(q) {
  const specs = q.controls ?? [];
  const arena = buildControlArena(specs.length);
  arena.controls.forEach((control, index) => {
    const spec = specs[index];
    if (!spec) return;
    // Same cap the built-in fixtures get — a pack label must not overflow
    // its box on the projector.
    control.label =
      spec.label.length <= CONTROL_LABEL_MAX_CHARS
        ? spec.label
        : `${spec.label.slice(0, CONTROL_LABEL_MAX_CHARS - 1).trimEnd()}…`;
    control.kind = spec.kind;
    control.initial = spec.initial;
    control.value = spec.initial;
    control.min = spec.min;
    control.max = spec.max;
    control.step = spec.step;
    control.unit = spec.unit;
    control.lastSide = null;
    control.lastChangedAt = -Infinity;
    control.feedback = null;
  });
  return arena;
}

/**
 * The arena for a choice question. Designed levels win: a question can pin
 * one by name, otherwise the pool's levels with a matching board count
 * rotate by question index — deterministic, so a restart replays the same
 * levels in the same order, exactly like the colourway rotation. With no
 * matching level the shipped layout tables carry the round, so a pool of
 * seven levels never has to cover every answer count on day one.
 * @param {Game} g @param {Question} q
 * @returns {import('./collide.js').Platform[]}
 */
function choiceArena(g, q) {
  const n = q.answers?.length ?? 2;
  const fits = g.levelPool.filter((l) => l.boards.length === n);
  const named = q.level ? fits.find((l) => l.name === q.level) : null;
  const pick = named ?? (fits.length ? fits[g.qIndex % fits.length] : null);
  return pick ? buildCustomArena(pick) : buildArena(n, q.layout);
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

/**
 * Spectators remain in the world so roster/reconnect bookkeeping is untouched,
 * but their controls are erased before physics and their impacts are ignored.
 * @param {Game} g
 * @param {import('./world.js').World} world
 */
export function freezeInactiveControlInputs(g, world) {
  const team = currentQuestion(g)?.team ?? -1;
  for (const p of world.players.values()) {
    if (g.cohortOf(p.id) === team) continue;
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
  if (!q || isControlQuestion(q)) return;
  const targets = targetIds(q);
  for (const p of world.players.values()) {
    if (g.arrivals.has(p.id)) continue;
    const id = p.standingOn?.id;
    if (id && targets.has(id)) g.arrivals.set(p.id, offset + g.phaseT);
  }
}

/**
 * @param {Game} g
 * @param {import('./world.js').World} world
 */
function score(g, world) {
  const q = currentQuestion(g);
  if (!q) return;
  if (isControlQuestion(q)) {
    scoreControl(g, q);
    return;
  }
  const targets = targetIds(q);
  const window = answerWindow(g);

  /** where each player's answer counts: buzzer spot, else the settle spot */
  const spotOf = (/** @type {import('./player.js').Player} */ p) =>
    g.atBuzzer.get(p.id) ?? (p.standingOn ?? p.lastStoodOn)?.id;

  /** @type {Result[]} */
  const results = [];
  for (const p of world.players.values()) {
    // Credit either way round: you were on it when the timer ended, or you
    // landed on it during the settle. The union is deliberate — inputs are
    // dead after the buzzer, so there's nothing to game, and every way of
    // losing credit through no fault of your own is closed off.
    const settled = (p.standingOn ?? p.lastStoodOn)?.id;
    const buzzer = g.atBuzzer.get(p.id);
    const onTarget =
      (buzzer != null && targets.has(buzzer)) || (settled != null && targets.has(settled));
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

  // Team coverage, the whole point of a select-all round in teams mode: a
  // team whose members stand on EVERY correct platform at the buzzer earns
  // the bonus — paid to its members who were part of the coverage, so
  // standing on the floor cheering contributes nothing. Coverage is judged
  // with the same buzzer-or-settle union as individual credit.
  g.coverage = new Map();
  if (g.mode === 'teams' && isMulti(q)) {
    /** @type {Map<number, Set<string>>} team -> covered platform ids */
    const covered = new Map();
    for (const p of world.players.values()) {
      const team = g.cohortOf(p.id);
      if (team < 0) continue;
      const spot = spotOf(p);
      if (spot != null && targets.has(spot)) {
        let set = covered.get(team);
        if (!set) covered.set(team, (set = new Set()));
        set.add(spot);
      }
    }
    for (const [team, spots] of covered) {
      const full = spots.size === targets.size;
      g.coverage.set(team, full);
      if (!full) continue;
      for (const r of results) {
        if (r.correct && g.cohortOf(r.id) === team) r.points += TEAM_COVER_BONUS;
      }
    }
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

/** @param {Game} g @param {Question} q */
function scoreControl(g, q) {
  const specs = q.controls ?? [];
  const fixtures = g.controlArena?.controls ?? [];
  let correct = 0;
  for (let i = 0; i < specs.length; i++) {
    if (fixtures[i]?.value === specs[i].answer) correct++;
  }
  const total = specs.length;
  const perfect = total > 0 && correct === total;
  const points = correct * CONTROL_ITEM_POINTS + (perfect ? CONTROL_PERFECT_BONUS : 0);
  const team = q.team ?? -1;
  if (team >= 0) g.teamBonuses.set(team, (g.teamBonuses.get(team) ?? 0) + points);
  g.controlResult = { team, correct, total, points, perfect };
  g.results = [];
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
 * @param {Map<number, number>} [bonuses]
 * @returns {Array<{count:number, total:number, avg:number}>}
 */
export function teamStandings(scores, cohortOf, teamCount = 3, bonuses = new Map()) {
  const teams = Array.from({ length: teamCount }, () => ({ count: 0, total: 0, avg: 0 }));
  for (const [id, s] of scores) {
    const c = cohortOf(id);
    if (c < 0 || c >= teamCount) continue;
    teams[c].count++;
    teams[c].total += s;
  }
  for (let i = 0; i < teams.length; i++) {
    const t = teams[i];
    t.avg = (t.count ? Math.round(t.total / t.count) : 0) + (bonuses.get(i) ?? 0);
  }
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

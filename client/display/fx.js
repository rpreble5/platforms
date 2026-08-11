/**
 * Reveal effects. Rendering-only, by design: nothing in here touches the
 * simulation, so physics, scoring and determinism cannot be affected by a
 * visual flourish. Each effect has a kill switch in FX (shared/tuning.js).
 *
 * Confetti is the first one, and it follows the rules that keep juice from
 * looking cheap:
 *
 *  - Pieces are cards, not dots, and each one "flips" — its drawn height
 *    oscillates — which is what makes confetti read as paper instead of
 *    falling pixels.
 *  - Colours come from the game's own palette (the twelve player colours,
 *    plus gold and paper), never rainbow-random.
 *  - Motion is eased: a fast burst, hard drag into a slow flutter, and a
 *    fade that only starts in the last third of a piece's life.
 *  - It fires once, on the beat — the frame the reveal starts — and only
 *    when somebody actually got the answer. Nobody-got-it gets no party.
 *
 * A fixed pool, allocated once: frame time is a latency term in this game,
 * and a celebration that causes GC pauses is a net negative.
 */

import { FX } from '../../shared/tuning.js';
import { COLORS } from '../../shared/palette.js';
import { PHASE, currentQuestion, targetId } from '../../sim/round.js';

/** @typedef {import('../../sim/world.js').World} World */
/** @typedef {import('../../sim/round.js').Game} Game */

const PIECE_COLORS = [...COLORS.map((c) => c.hex), '#ffd93d', '#f4f1ff'];

const MAX_PIECES = 240;
/** Confetti outlives the burst but never the reveal-plus-scoreboard beat. */
const GRAVITY = 1150;
const MAX_FALL = 240; // paper falls slowly; the flutter does the work
const DRAG = 2.6; // 1/s — kills the burst velocity into a drift

const pool = Array.from({ length: MAX_PIECES }, () => ({
  active: false,
  x: 0, y: 0, vx: 0, vy: 0,
  age: 0, life: 0,
  w: 0, h: 0,
  rot: 0, vr: 0,
  flip: 0, vflip: 0,
  sway: 0, swayFreq: 0, swayPhase: 0,
  color: '',
}));

let lastClock = 0;
let revealSeen = -1;

/**
 * Launch a burst along the top edge of a platform — the whole board pops at
 * once, like the platform itself is celebrating.
 * @param {{x:number, y:number, w:number}} plat
 */
export function burstConfetti(plat) {
  const count = Math.round(Math.min(150, Math.max(70, plat.w / 4)));
  let spawned = 0;
  for (const p of pool) {
    if (spawned >= count) break;
    if (p.active) continue;
    spawned++;

    const t = Math.random();
    p.active = true;
    p.x = plat.x + t * plat.w;
    p.y = plat.y - 4;
    // Up and slightly outward from the board's centre, so the burst opens
    // like a fan instead of rising as a column.
    p.vx = (t - 0.5) * 2 * (120 + Math.random() * 240);
    p.vy = -(620 + Math.random() * 520);
    p.age = 0;
    p.life = 1.5 + Math.random() * 0.8;
    p.w = 9 + Math.random() * 6;
    p.h = 6 + Math.random() * 4;
    p.rot = Math.random() * Math.PI;
    p.vr = (Math.random() - 0.5) * 7;
    p.flip = Math.random() * Math.PI;
    p.vflip = 6 + Math.random() * 6;
    p.sway = 26 + Math.random() * 40;
    p.swayFreq = 2.2 + Math.random() * 2.2;
    p.swayPhase = Math.random() * Math.PI * 2;
    p.color = PIECE_COLORS[(Math.random() * PIECE_COLORS.length) | 0];
  }
}

/**
 * Per-frame entry point. Detects the reveal beat, then updates and draws.
 * Call between the world render and the round overlay, so confetti falls
 * over the stage but under the scoreboard panel.
 * @param {CanvasRenderingContext2D} cx
 * @param {Game} game
 * @param {World} world
 */
export function drawConfetti(cx, game, world) {
  if (!FX.confetti) return;

  // Fire exactly once per reveal, on its first frame, and only for a win.
  if (game.phase === PHASE.REVEAL && revealSeen !== game.qIndex) {
    revealSeen = game.qIndex;
    const q = currentQuestion(game);
    if (q && game.results.some((r) => r.correct)) {
      const plat = world.platforms.find((pl) => pl.id === targetId(q));
      if (plat) burstConfetti(plat);
    }
  }
  if (game.phase !== PHASE.REVEAL && game.phase !== PHASE.SCORE) revealSeen = -1;

  // Effects run on their own clock (they're not simulation), clamped so a
  // background-tab stall doesn't teleport every piece.
  const now = performance.now();
  const dt = Math.min(50, now - (lastClock || now)) / 1000;
  lastClock = now;
  const frozen = game.paused;

  let any = false;
  for (const p of pool) {
    if (!p.active) continue;
    any = true;

    if (!frozen) {
      p.age += dt;
      if (p.age >= p.life) {
        p.active = false;
        continue;
      }
      p.vx -= p.vx * DRAG * dt;
      p.vy = Math.min(MAX_FALL, p.vy + GRAVITY * dt);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      p.flip += p.vflip * dt;
    }

    // Sway fades IN so the burst flies straight, then flutters on the way down.
    const swayIn = Math.min(1, p.age / 0.5);
    const px = p.x + Math.sin(p.age * p.swayFreq + p.swayPhase) * p.sway * swayIn;

    const lifeFrac = p.age / p.life;
    cx.globalAlpha = lifeFrac < 0.66 ? 1 : 1 - (lifeFrac - 0.66) / 0.34;
    cx.save();
    cx.translate(px, p.y);
    cx.rotate(p.rot);
    // The card flip: apparent height collapses and recovers as the piece
    // tumbles. This one line is most of the difference between paper and dots.
    const h = p.h * (0.22 + 0.78 * Math.abs(Math.sin(p.flip)));
    cx.fillStyle = p.color;
    cx.fillRect(-p.w / 2, -h / 2, p.w, h);
    cx.restore();
  }
  cx.globalAlpha = 1;

  if (!any) lastClock = 0;
}

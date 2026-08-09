/**
 * Every physics and timing constant, in one place.
 *
 * Physics lives in the mutable `PHYS` object so the display's live-tweak
 * overlay (press T) can nudge values while the game is running and print a
 * paste-able block. Everything else is a plain const.
 *
 * These MUST be tuned over real WiFi, not localhost. The forgiveness values in
 * PHYS matter more to perceived responsiveness than anything in the transport.
 *
 * World units are 1:1 with render pixels at 1920x1080.
 */

// ------------------------------------------------------------------ simulation

/** Fixed sim rate. 120 Hz halves input-latch quantization vs 60 Hz (mean 8.3ms -> 4.2ms). */
export const STEP_HZ = 120;
export const STEP_MS = 1000 / STEP_HZ;
/** Max sim steps per rendered frame. Prevents a catch-up spiral after a tab stall. */
export const MAX_STEPS_PER_FRAME = 8;
/** Frame delta is clamped to this before entering the accumulator. */
export const MAX_FRAME_DT_MS = 250;

// ------------------------------------------------------------------ world

export const WORLD_W = 1920;
export const WORLD_H = 1080;
/** Below this y, a player has fallen out of the world. */
export const KILL_Y = WORLD_H + 200;

// ------------------------------------------------------------------ physics (live-tweakable)

export const PHYS = {
  PLAYER_W: 40,
  PLAYER_H: 56,

  RUN_SPEED: 520,
  /** Reach top speed in ~80ms on the ground. */
  GROUND_ACCEL: 6500,
  /** ~180ms in the air — enough control to correct a jump, not enough to feel weightless. */
  AIR_ACCEL: 2900,
  GROUND_FRICTION: 8000,
  AIR_FRICTION: 1200,

  JUMP_VEL: 1150,
  RISE_GRAVITY: 3000,
  /** Asymmetric gravity: falling faster than rising reads as snappier at the same apex. */
  FALL_GRAVITY: 5100,
  MAX_FALL_SPEED: 2200,
  /** Velocity retained when JUMP is released mid-rise (variable jump height). */
  JUMP_CUT: 0.45,

  /**
   * A jump pressed this long BEFORE landing still fires on touchdown.
   *
   * The player reacts to a frame already ~70ms old and their press takes another
   * ~70ms to arrive, so the world their jump lands in is ~150ms ahead of the one
   * they reacted to. That shows up in exactly two ways — pressing just after
   * walking off an edge, or just before landing — and these two values are the
   * fix for both. Together they absorb the entire good-case latency budget.
   */
  JUMP_BUFFER_MS: 150,
  /** A jump pressed this long AFTER walking off an edge still fires. */
  COYOTE_MS: 120,
  /** Head clipping a platform corner by up to this much nudges past instead of stalling. */
  CORNER_CORRECT_PX: 6,
};

/** Order shown in the live-tweak overlay, with per-press step size. */
export const TWEAKABLE = /** @type {const} */ ([
  ['RUN_SPEED', 10],
  ['JUMP_VEL', 10],
  ['RISE_GRAVITY', 50],
  ['FALL_GRAVITY', 50],
  ['JUMP_CUT', 0.05],
  ['JUMP_BUFFER_MS', 10],
  ['COYOTE_MS', 10],
  ['GROUND_ACCEL', 100],
  ['AIR_ACCEL', 100],
  ['GROUND_FRICTION', 100],
  ['AIR_FRICTION', 100],
  ['MAX_FALL_SPEED', 50],
  ['CORNER_CORRECT_PX', 1],
]);

// Derived from the defaults, for level design: apex ~220px, airtime ~0.68s,
// horizontal reach ~353px. Keep gaps under ~250px so every jump clears with
// ~40% slack. A game that never demands 50ms precision cannot be ruined by
// 90ms of latency — this is the highest-leverage latency work available.

// ------------------------------------------------------------------ networking

/** Resend the current mask after this long with no change. Guards the dropped-release bug. */
export const HEARTBEAT_MS = 400;
/** No packet for this long -> server forwards a synthetic mask 0. Third layer of the same guard. */
export const STALE_MS = 2000;
/** Ask for an RTT echo roughly this often (not on every packet — that doubles packet count). */
export const ECHO_EVERY_MS = 500;
/** Idle ping rate. Keeps the 802.11 association warm and the HUD live. */
export const IDLE_PING_MS = 1000;
/** Phone -> server rate limit. Excess is dropped. */
export const MAX_MSGS_PER_SEC = 120;
/** Phone reports its RTT percentiles this often (staggered per player). */
export const STATS_EVERY_MS = 2000;
/** Display -> server checkpoint rate. Off the hot path. */
export const CHECKPOINT_MS = 500;

// ------------------------------------------------------------------ presentation

export const FINDME_HOLD_MS = 400;
export const FINDME_SHOW_MS = 2000;

/**
 * Avatars shrink as the room fills so 30 of them still fit on one platform.
 * @param {number} count
 * @returns {number}
 */
export function avatarScale(count) {
  if (count <= 8) return 1;
  if (count <= 16) return 0.85;
  if (count <= 24) return 0.75;
  return 0.65;
}

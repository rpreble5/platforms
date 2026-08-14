/**
 * Landing notes: a soft synthesized pluck every time a player lands on a
 * platform, pitched by how high the platform is.
 *
 * Everything here is display-side Web Audio — the display machine is the one
 * plugged into speakers, and its sim already knows the exact frame of every
 * landing, so notes are sample-accurately in step with the squash animation.
 * No assets, no network messages, no phone audio (thirty phones chirping
 * with WiFi jitter is a horror, not a feature).
 *
 * Thirty players landing at random times is random notes played together,
 * which is why the scale is PENTATONIC: no combination of its notes is
 * dissonant. Pitch rises with tier, so climbing a ladder plays an ascending
 * run and stepping onto an answer board resolves one degree above its rungs.
 *
 * Crowd-proofing: floor landings are silent (constant background hopping),
 * a per-player cooldown stops bunny-hop machine-gunning, a voice cap bounds
 * the mix, and a compressor on the master bus keeps a mass landing from
 * clipping the PA.
 */

import { FX } from '../../shared/tuning.js';
import { FLOOR_Y, RANGE_ID, TIER } from '../../sim/levels.js';

/** C major pentatonic from C4 — any subset of these rings consonant. */
const SCALE = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.26, 783.99, 880.0];

/** Switchable timbres, cycled live with N so the winner is picked by ear. */
const VOICES = /** @type {const} */ (['pluck', 'chime', 'soft']);

const MAX_LIVE = 8;
const COOLDOWN_MS = 120;

/** @type {AudioContext | null} */
let ctx = null;
/** @type {GainNode | null} */
let master = null;
let muted = false;
let voiceIndex = 0;
let live = 0;
let played = 0;

/** Total notes actually scheduled — lets the browser smoke test hear for us. */
export function notesPlayed() {
  return played;
}

/** last note time per player id, ms of performance.now() */
const lastNote = new Map();
/** previous tick's onGround per player id */
const wasGrounded = new Map();

/**
 * Create/resume the AudioContext. Browsers refuse to start audio without a
 * user gesture, so this is called from every keydown/pointerdown — the host
 * pressing Enter to start the game unlocks sound as a side effect.
 */
export function unlockAudio() {
  if (!FX.sound) return;
  if (!ctx) {
    const AC = globalThis.AudioContext;
    if (!AC) return;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 6;
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(comp);
    comp.connect(ctx.destination);
  }
  // A blocked context rejects resume(); swallow it — the next gesture retries.
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
}

/** @returns {boolean} the new muted state */
export function toggleMuted() {
  muted = !muted;
  return muted;
}

/** @returns {string} the newly selected voice name */
export function cycleVoice() {
  voiceIndex = (voiceIndex + 1) % VOICES.length;
  return VOICES[voiceIndex];
}

/**
 * Once per frame: fire a note for every player that just landed on a
 * platform. Frame granularity is fine — ground contact persists for many
 * frames, and a landing missed inside a single frame doesn't exist.
 * @param {import('../../sim/world.js').World} world
 */
export function tickAudio(world) {
  if (!FX.sound) return;
  for (const p of world.players.values()) {
    const was = wasGrounded.get(p.id) ?? false;
    wasGrounded.set(p.id, p.onGround);
    if (!p.onGround || was) continue;

    const id = String(p.standingOn?.id ?? '');
    // Silent surfaces: the floor (and the range band, which is floor-height
    // ground in a costume) — landings there are constant background noise.
    const board = id.startsWith('ans') && id !== RANGE_ID;
    if (!board && !id.startsWith('perch')) continue;

    const now = performance.now();
    if (now - (lastNote.get(p.id) ?? -1e9) < COOLDOWN_MS) continue;
    lastNote.set(p.id, now);

    // Tier carries the melody: rungs play the even scale degrees ascending,
    // an answer board resolves one degree above the rungs of its tier.
    const tier = Math.max(1, Math.min(4, Math.round((FLOOR_Y - (p.standingOn?.y ?? FLOOR_Y)) / TIER)));
    const degree = Math.min((tier - 1) * 2 + (board ? 1 : 0), SCALE.length - 1);
    playNote(SCALE[degree], board ? 1 : 0.8);
  }

  // Forget departed players so the maps can't grow across a long night.
  if (wasGrounded.size > world.players.size + 8) {
    for (const id of wasGrounded.keys()) {
      if (!world.players.has(id)) {
        wasGrounded.delete(id);
        lastNote.delete(id);
      }
    }
  }
}

/**
 * @param {number} freq
 * @param {number} vel 0..1 accent — answer boards land a touch louder
 */
function playNote(freq, vel) {
  if (!ctx || !master || muted || ctx.state !== 'running' || live >= MAX_LIVE) return;
  const ac = ctx;
  const t = ac.currentTime;
  const voice = VOICES[voiceIndex];
  const gain = ac.createGain();
  gain.connect(master);
  live++;
  played++;

  /** @type {OscillatorNode[]} */
  const oscs = [];
  /** @param {OscillatorType} type @param {number} f @param {AudioNode} dest */
  const osc = (type, f, dest) => {
    const o = ac.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.connect(dest);
    oscs.push(o);
    return o;
  };

  let dur;
  if (voice === 'pluck') {
    // Triangle through a closing lowpass — kalimba-ish.
    dur = 0.24;
    const f = ac.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(freq * 6, t);
    f.frequency.exponentialRampToValueAtTime(freq * 1.5, t + 0.18);
    f.connect(gain);
    osc('triangle', freq, f);
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.exponentialRampToValueAtTime(0.45 * vel, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
  } else if (voice === 'chime') {
    // Sine plus a quiet third partial, longer ring — music-box-ish.
    dur = 0.45;
    osc('sine', freq, gain);
    const g2 = ac.createGain();
    g2.gain.value = 0.16;
    g2.connect(gain);
    osc('sine', freq * 3, g2);
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.exponentialRampToValueAtTime(0.4 * vel, t + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
  } else {
    // Soft: a plain gentle sine.
    dur = 0.3;
    osc('sine', freq, gain);
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.exponentialRampToValueAtTime(0.3 * vel, t + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
  }

  for (const o of oscs) {
    o.start(t);
    o.stop(t + dur);
  }
  oscs[0].onended = () => {
    live--;
    gain.disconnect();
  };
}

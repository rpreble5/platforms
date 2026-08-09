/**
 * Turns the stream of INPUT_FWD packets into per-player latched masks and
 * OR-accumulated press/release edges.
 *
 * The edge accumulation here is the single most important correctness detail in
 * the client. A press and its release can both arrive inside one 8.3ms tick
 * window — especially on a laggy link, where packets arrive in bursts after a
 * retransmit. If we derived edges by diffing the mask at tick time, that tap
 * would vanish, and the player would experience it as the game ignoring them.
 * So edges are OR'd in on arrival and only ever cleared by the tick that
 * consumes them.
 */

import { F_SYNTHETIC, decodeInputFwd, since16, t16 } from '../../shared/protocol.js';

/**
 * @typedef {object} Slot
 * @property {number} held
 * @property {number} pressEdge
 * @property {number} releaseEdge
 * @property {number} lastSeq
 * @property {number} packets
 * @property {number} outOfOrder
 * @property {number} synthetic
 * @property {number} firstPendingAt performance.now() of the oldest undrained packet
 * @property {number} relayMs last measured server->display delay
 */

export class InputBus {
  constructor() {
    /** @type {Map<number, Slot>} */
    this.slots = new Map();
    /**
     * Timed samples of server->display relay delay (same machine, same wall
     * clock, so the subtraction is meaningful).
     * @type {Array<{t:number, v:number}>}
     */
    this.relaySamples = [];
    /**
     * Timed samples of packet-arrival -> consuming-tick delay.
     * @type {Array<{t:number, v:number}>}
     */
    this.queueSamples = [];
    this.packets = 0;
    this.windowStart = performance.now();
    this.windowPackets = 0;
    this.msgsPerSec = 0;
  }

  /** @param {number} id @returns {Slot} */
  #slot(id) {
    let s = this.slots.get(id);
    if (!s) {
      s = {
        held: 0,
        pressEdge: 0,
        releaseEdge: 0,
        lastSeq: -1,
        packets: 0,
        outOfOrder: 0,
        synthetic: 0,
        firstPendingAt: 0,
        relayMs: 0,
      };
      this.slots.set(id, s);
    }
    return s;
  }

  /**
   * @param {DataView} view a whole INPUT_FWD frame
   */
  onPacket(view) {
    const pkt = decodeInputFwd(view);
    const s = this.#slot(pkt.playerId);
    const now = performance.now();

    s.packets++;
    this.packets++;
    this.windowPackets++;
    if (now - this.windowStart >= 1000) {
      this.msgsPerSec = (this.windowPackets * 1000) / (now - this.windowStart);
      this.windowStart = now;
      this.windowPackets = 0;
    }

    if (pkt.flags & F_SYNTHETIC) s.synthetic++;
    if (s.lastSeq >= 0 && !(pkt.flags & F_SYNTHETIC)) {
      const d = (((pkt.seq - s.lastSeq) & 0xffff) ^ 0x8000) - 0x8000;
      if (d <= 0) s.outOfOrder++;
    }
    s.lastSeq = pkt.seq;

    // Server and display share a machine and a wall clock, so this subtraction
    // is meaningful even though the phone's clock is never synced to anything.
    const relay = since16(pkt.recv16, t16(Date.now()));
    if (relay < 1000) {
      s.relayMs = relay;
      push(this.relaySamples, now, relay);
    }

    this.applyMask(pkt.playerId, pkt.buttons);
  }

  /**
   * Latch a new mask and accumulate its edges. Shared by the network path and
   * the display's local keyboard test player, so both get identical semantics.
   * @param {number} id
   * @param {number} buttons
   */
  applyMask(id, buttons) {
    const s = this.#slot(id);
    s.pressEdge |= buttons & ~s.held;
    s.releaseEdge |= ~buttons & s.held & 0xff;
    s.held = buttons;
    if (!s.firstPendingAt) s.firstPendingAt = performance.now();
  }

  /**
   * Merge pending state into the world's players. Called INSIDE the fixed-step
   * loop, not once per frame, so a packet that lands mid-frame is consumed by
   * the very next tick rather than waiting for the next paint.
   * @param {import('../../sim/world.js').World} world
   */
  drainInto(world) {
    const now = performance.now();
    for (const [id, s] of this.slots) {
      const p = world.players.get(id);
      if (!p) continue;
      p.input.held = s.held;
      p.input.pressEdge |= s.pressEdge;
      p.input.releaseEdge |= s.releaseEdge;
      if (s.firstPendingAt) {
        push(this.queueSamples, now, now - s.firstPendingAt);
        s.firstPendingAt = 0;
      }
      s.pressEdge = 0;
      s.releaseEdge = 0;
    }
  }

  /** @param {number} id */
  forget(id) {
    this.slots.delete(id);
  }

  /** @param {number} id */
  stats(id) {
    return this.slots.get(id);
  }
}

/**
 * How far back the HUD looks. Input is event-driven, so with a quiet room a
 * count-bounded window can be minutes long — which means one bad sample from
 * page-load jank sits in the p95 forever and the operator reads a stale number
 * as a live one. Time-bounding is what makes the HUD say something about NOW.
 */
export const SAMPLE_WINDOW_MS = 10000;

/**
 * @param {Array<{t:number, v:number}>} arr
 * @param {number} t @param {number} v
 */
function push(arr, t, v) {
  arr.push({ t, v });
  const cutoff = t - SAMPLE_WINDOW_MS;
  let drop = 0;
  while (drop < arr.length && arr[drop].t < cutoff) drop++;
  if (drop) arr.splice(0, drop);
  // Hard cap as a memory backstop under a packet flood.
  if (arr.length > 2000) arr.splice(0, arr.length - 2000);
}

/**
 * Values from the last `windowMs`, newest-inclusive.
 * @param {Array<{t:number, v:number}>} arr
 * @param {number} [windowMs]
 * @returns {number[]}
 */
export function recent(arr, windowMs = SAMPLE_WINDOW_MS) {
  const cutoff = performance.now() - windowMs;
  /** @type {number[]} */
  const out = [];
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i].t < cutoff) break;
    out.push(arr[i].v);
  }
  return out;
}

/**
 * @param {number[]} arr
 * @param {number} q 0..1
 * @returns {number}
 */
export function percentile(arr, q) {
  if (!arr.length) return 0;
  const s = arr.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * q))];
}

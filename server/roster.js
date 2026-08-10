/**
 * Identity, and only identity.
 *
 * Node is authoritative for token -> playerId -> name/color/hat. The display is
 * authoritative for physics and round logic. No overlap, so there is never a
 * "which one is right" question.
 */

import { randomUUID } from 'node:crypto';
import {
  ACCESSORIES,
  COLORS,
  DEFAULT_COHORT,
  POOL_SIZE,
  clampCohort,
  identityFor,
  lookName,
  poolFor,
} from '../shared/palette.js';

const MAX_PLAYERS = 40;
const NAME_MAX = 12;

/** Control characters, zero-width joiners, and bidi overrides. */
const NAME_STRIP = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u202a-\\u202e\\ufeff]', 'g');

/**
 * @typedef {object} PlayerRecord
 * @property {number} id dense, stable for the life of the process
 * @property {string} token
 * @property {string} name
 * @property {boolean} named whether the player typed that name themselves
 * @property {string} color
 * @property {string} hat
 * @property {number} colorIndex
 * @property {number} hatIndex global accessory index; its range implies the cohort
 * @property {number} cohortIndex
 * @property {boolean} cohortSet whether the player has actually chosen a year
 * @property {number} joinIndex
 * @property {boolean} connected
 * @property {number} lastSeen
 * @property {{rttP50:number, rttP95:number, loss:number}} net
 */

export class Roster {
  constructor() {
    /** @type {Map<string, PlayerRecord>} */
    this.byToken = new Map();
    /** @type {Map<number, PlayerRecord>} */
    this.byId = new Map();
    this.nextId = 1;
    this.joinCount = 0;
  }

  /**
   * Resolve an incoming HELLO. An unknown or absent token mints a new player;
   * a known one resumes the same avatar and look.
   * @param {string | undefined} token
   * @param {string | undefined} name
   * @returns {{ok: true, record: PlayerRecord, isNew: boolean} | {ok: false, error: string}}
   */
  resolve(token, name) {
    if (token) {
      const existing = this.byToken.get(token);
      if (existing) {
        existing.connected = true;
        existing.lastSeen = Date.now();
        const renamed = sanitizeName(name ?? '');
        if (renamed) {
          existing.name = renamed;
          existing.named = true;
        }
        return { ok: true, record: existing, isNew: false };
      }
    }

    if (this.byId.size >= MAX_PLAYERS) {
      // Over an evening, people close tabs and rejoin from a new browser, and
      // every one of those leaves a dead record behind. Without eviction the
      // roster silently fills up and real players start getting turned away
      // mid-party. Reclaim the longest-gone disconnected slot first.
      if (!this.#evictOldestDisconnected()) {
        return { ok: false, error: `Game is full (${MAX_PLAYERS} players).` };
      }
    }

    const joinIndex = this.joinCount++;
    const typed = sanitizeName(name ?? '');
    const seed = identityFor(joinIndex, DEFAULT_COHORT);
    /** @type {PlayerRecord} */
    const record = {
      id: this.nextId++,
      token: randomUUID(),
      name: typed,
      named: Boolean(typed),
      color: COLORS[0].hex,
      hat: ACCESSORIES[0].key,
      colorIndex: 0,
      hatIndex: 0,
      // A placeholder until they pick. `cohortSet` is what tells the phone
      // whether the card still has a question to ask.
      cohortIndex: DEFAULT_COHORT,
      cohortSet: false,
      joinIndex,
      connected: true,
      lastSeen: Date.now(),
      net: { rttP50: 0, rttP95: 0, loss: 0 },
    };
    this.byToken.set(record.token, record);
    this.byId.set(record.id, record);
    // Spread the auto-assignment the way identityFor always has, but route it
    // through the same claim path a player's pick uses, so an auto-assigned look
    // can never collide with one somebody chose.
    this.#assign(record, seed.colorIndex, seed.hatIndex);
    return { ok: true, record, isNew: true };
  }

  /**
   * Apply a player's chosen name, year, colour and accessory.
   *
   * All of it is a request, not a command. The server resolves collisions and
   * the record ends up holding what the player actually got — and it is that,
   * never the request, that goes back to the phone.
   *
   * @param {number} id
   * @param {{name?: string, colorIndex?: number, hatIndex?: number, cohortIndex?: number}} want
   * @returns {PlayerRecord | null}
   */
  setLook(id, want) {
    const r = this.byId.get(id);
    if (!r) return null;

    if (typeof want.name === 'string') {
      const clean = sanitizeName(want.name);
      r.named = Boolean(clean);
      r.name = clean;
    }

    const movedYear = Number.isInteger(want.cohortIndex) && want.cohortIndex !== r.cohortIndex;
    if (Number.isInteger(want.cohortIndex)) {
      r.cohortIndex = clampCohort(/** @type {number} */ (want.cohortIndex));
      r.cohortSet = true;
    }

    // A year change always re-runs assignment, because the accessory they were
    // wearing does not exist in the new year's pool.
    if (movedYear || Number.isInteger(want.colorIndex) || Number.isInteger(want.hatIndex)) {
      this.#assign(
        r,
        Number.isInteger(want.colorIndex) ? /** @type {number} */ (want.colorIndex) : r.colorIndex,
        Number.isInteger(want.hatIndex) ? /** @type {number} */ (want.hatIndex) : r.hatIndex
      );
    } else if (!r.named) {
      r.name = lookName(r.colorIndex, r.hatIndex);
    }
    return r;
  }

  /**
   * Free accessory slots per colour, within one year's pool. The phone greys
   * out anything at zero, which is what stops a player picking a colour that is
   * about to be refused.
   * @param {number} cohortIndex
   * @returns {number[]}
   */
  freeByColor(cohortIndex) {
    const pool = new Set(poolFor(cohortIndex));
    const free = COLORS.map(() => POOL_SIZE);
    for (const r of this.byId.values()) {
      if (pool.has(r.hatIndex)) free[r.colorIndex]--;
    }
    return free.map((n) => Math.max(0, n));
  }

  /**
   * Resolve a look request to a free (colour, accessory) pair.
   *
   * Colour is tried first and accessory second: a 30x42 block of hue is the
   * stronger signal at the back of the room, so when the exact pair is taken it
   * is better to keep the colour and move the accessory than the reverse. Only
   * once all four of a colour's slots are gone does the colour move, and then
   * only to the nearest one with room.
   *
   * @param {PlayerRecord} record
   * @param {number} wantColor
   * @param {number} wantHat
   */
  #assign(record, wantColor, wantHat) {
    /** @type {Set<string>} */
    const taken = new Set();
    for (const r of this.byId.values()) {
      if (r !== record) taken.add(`${r.colorIndex}:${r.hatIndex}`);
    }

    // The requested accessory first, then the rest of this year's pool.
    const pool = poolFor(record.cohortIndex);
    const hats = pool.includes(wantHat) ? [wantHat, ...pool.filter((h) => h !== wantHat)] : pool;

    const start = ((wantColor % COLORS.length) + COLORS.length) % COLORS.length;
    for (let step = 0; step < COLORS.length; step++) {
      const c = (start + step) % COLORS.length;
      for (const h of hats) {
        if (taken.has(`${c}:${h}`)) continue;
        record.colorIndex = c;
        record.hatIndex = h;
        record.color = COLORS[c].hex;
        record.hat = ACCESSORIES[h].key;
        if (!record.named) record.name = lookName(c, h);
        return;
      }
    }
    // 48 slots per year against a 40-player cap, so this is unreachable — but
    // leaving the record on an accessory from the wrong year would be worse.
    record.hatIndex = pool[0];
    record.hat = ACCESSORIES[pool[0]].key;
    if (!record.named) record.name = lookName(record.colorIndex, record.hatIndex);
  }

  /**
   * @returns {boolean} whether a slot was reclaimed
   */
  #evictOldestDisconnected() {
    /** @type {PlayerRecord | null} */
    let oldest = null;
    for (const r of this.byId.values()) {
      if (r.connected) continue;
      if (!oldest || r.lastSeen < oldest.lastSeen) oldest = r;
    }
    if (!oldest) return false;
    this.byId.delete(oldest.id);
    this.byToken.delete(oldest.token);
    return true;
  }

  /**
   * Mark a player gone. Keeps the record — they should get their avatar and
   * look back on reconnect — but timestamps it so it can be reclaimed if the
   * roster ever fills.
   * @param {number} id
   */
  disconnect(id) {
    const r = this.byId.get(id);
    if (!r) return;
    r.connected = false;
    r.lastSeen = Date.now();
  }

  /** @param {number} id */
  get(id) {
    return this.byId.get(id);
  }

  /** Everything except the secret token. @returns {Array<Omit<PlayerRecord, 'token'>>} */
  publicList() {
    return [...this.byId.values()].map((r) => {
      const { token, ...rest } = r;
      void token;
      return rest;
    });
  }
}

/**
 * @param {string} raw
 * @returns {string}
 */
export function sanitizeName(raw) {
  return raw.replace(NAME_STRIP, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
}

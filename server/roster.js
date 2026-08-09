/**
 * Identity, and only identity.
 *
 * Node is authoritative for token -> playerId -> name/color/hat. The display is
 * authoritative for physics and round logic. No overlap, so there is never a
 * "which one is right" question.
 */

import { randomUUID } from 'node:crypto';
import { defaultName, identityFor } from '../shared/palette.js';

const MAX_PLAYERS = 40;
const NAME_MAX = 12;

/** Control characters, zero-width joiners, and bidi overrides. */
const NAME_STRIP = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u202a-\\u202e\\ufeff]', 'g');

/**
 * @typedef {object} PlayerRecord
 * @property {number} id dense, stable for the life of the process
 * @property {string} token
 * @property {string} name
 * @property {string} color
 * @property {string} hat
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
        if (name) existing.name = sanitizeName(name) || existing.name;
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
    const look = identityFor(joinIndex);
    /** @type {PlayerRecord} */
    const record = {
      id: this.nextId++,
      token: randomUUID(),
      name: sanitizeName(name ?? '') || defaultName(joinIndex),
      color: look.color,
      hat: look.hat,
      joinIndex,
      connected: true,
      lastSeen: Date.now(),
      net: { rttP50: 0, rttP95: 0, loss: 0 },
    };
    this.byToken.set(record.token, record);
    this.byId.set(record.id, record);
    return { ok: true, record, isNew: true };
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

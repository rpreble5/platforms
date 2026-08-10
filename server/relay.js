/**
 * The relay. Deliberately dumb: it owns identity and forwarding, nothing else.
 *
 * Three things in here are load-bearing for latency and easy to get wrong:
 *   1. `setNoDelay` is applied on the HTTP server's `connection` event, before
 *      the WebSocket upgrade, so no code path can miss it. Browsers already set
 *      TCP_NODELAY on their own sockets, so server -> phone is the direction
 *      Nagle actually bites: our 6-byte echo frames are exactly the small-write
 *      case it delays by up to 40ms.
 *   2. `perMessageDeflate: false`. Compressing a 7-byte frame costs CPU and
 *      latency to save nothing.
 *   3. Input is forwarded the instant it arrives. Never batched to a timer —
 *      coalescing is precisely the "optimization" that adds the latency we are
 *      trying to remove. 30 players x ~5 events/s is ~150 msg/s over loopback.
 */

import { WebSocketServer } from 'ws';
import {
  F_HEARTBEAT,
  F_SYNTHETIC,
  F_REQ_ECHO,
  T_INPUT,
  T_JSON,
  T_PING,
  encodeEcho,
  encodeFeedback,
  encodeInputFwd,
  encodeJson,
  decodeInput,
  t16,
} from '../shared/protocol.js';
import { MAX_MSGS_PER_SEC, STALE_MS } from '../shared/tuning.js';
import { Roster, sanitizeName } from './roster.js';

/** @typedef {import('ws').WebSocket} WS */
/** @typedef {import('./roster.js').PlayerRecord} PlayerRecord */

/**
 * @typedef {object} Conn
 * @property {WS} ws
 * @property {'phone' | 'display' | 'host' | 'pending'} role
 * @property {PlayerRecord | null} player
 * @property {number} lastInputAt
 * @property {number} lastMask
 * @property {boolean} staleFired
 * @property {number} msgWindowStart
 * @property {number} msgCount
 */

export class Relay {
  /** Set when colour availability changes; flushed on the watchdog tick. */
  #looksDirty = false;

  /**
   * @param {import('node:http').Server} httpServer
   */
  constructor(httpServer) {
    // (1) Before the upgrade — covers phones, the display, and plain HTTP alike.
    httpServer.on('connection', (socket) => socket.setNoDelay(true));

    this.wss = new WebSocketServer({
      server: httpServer,
      path: '/ws',
      perMessageDeflate: false, // (2)
      maxPayload: 1024, // free DoS guard; nothing legitimate is near this
    });

    this.roster = new Roster();
    /** @type {Set<Conn>} */
    this.conns = new Set();
    /** @type {Map<number, Conn>} */
    this.phoneByPlayerId = new Map();
    /** @type {Set<Conn>} */
    this.displays = new Set();
    /** @type {unknown} */
    this.checkpoint = null;
    this.checkpointAt = 0;
    this.#looksDirty = false;

    this.wss.on('connection', (/** @type {WS} */ ws, /** @type {import('node:http').IncomingMessage} */ req) => this.#onConnection(ws, req));

    // Staleness watchdog. Third and last layer of the dropped-release guard:
    // full mask in every packet, a 400ms phone heartbeat, and this.
    this.watchdog = setInterval(() => {
      this.#sweep();
      this.#flushLooks();
    }, 250);
    this.watchdog.unref?.();
  }

  /**
   * @param {WS} ws
   * @param {import('node:http').IncomingMessage} req
   */
  #onConnection(ws, req) {
    ws.binaryType = 'nodebuffer';
    const url = new URL(req.url ?? '/', 'http://x');
    const requestedRole = url.searchParams.get('role');

    /** @type {Conn} */
    const conn = {
      ws,
      role: requestedRole === 'display' ? 'display' : requestedRole === 'host' ? 'host' : 'pending',
      player: null,
      lastInputAt: Date.now(),
      lastMask: 0,
      staleFired: false,
      msgWindowStart: Date.now(),
      msgCount: 0,
    };
    this.conns.add(conn);
    if (conn.role === 'display') {
      this.displays.add(conn);
      this.#send(conn, encodeJson({ type: 'ROSTER', players: this.roster.publicList() }));
    }

    ws.on('message', (/** @type {import('ws').RawData} */ data, /** @type {boolean} */ isBinary) =>
      this.#onMessage(conn, data, isBinary)
    );
    ws.on('close', () => this.#onClose(conn));
    ws.on('error', () => ws.terminate());
  }

  /**
   * @param {Conn} conn
   * @param {import('ws').RawData} data
   * @param {boolean} isBinary
   */
  #onMessage(conn, data, isBinary) {
    void isBinary;
    const now = Date.now();

    // Per-connection rate limit. Excess is dropped, not disconnected — a phone
    // with a stuck finger shouldn't lose its player.
    if (now - conn.msgWindowStart >= 1000) {
      conn.msgWindowStart = now;
      conn.msgCount = 0;
    }
    if (++conn.msgCount > MAX_MSGS_PER_SEC) return;

    const buf = /** @type {Buffer} */ (Array.isArray(data) ? Buffer.concat(data) : Buffer.from(/** @type {any} */ (data)));
    if (buf.length === 0) return;
    const type = buf[0];

    if (type === T_JSON) {
      let msg;
      try {
        msg = JSON.parse(buf.subarray(1).toString('utf8'));
      } catch {
        return;
      }
      this.#onJson(conn, msg);
      return;
    }

    if (type === T_INPUT || type === T_PING) {
      if (buf.length < 7 || !conn.player) return;
      const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
      const pkt = decodeInput(v);

      conn.lastInputAt = now;
      conn.staleFired = false;

      if (type === T_INPUT) {
        conn.lastMask = pkt.buttons;
        // (3) Forward immediately.
        const fwd = encodeInputFwd(conn.player.id, pkt.buttons, pkt.flags, pkt.seq, t16(now));
        this.#broadcastDisplays(fwd);
      }

      if (pkt.flags & F_REQ_ECHO) {
        this.#send(conn, encodeEcho(pkt.seq, pkt.stamp16, pkt.flags & F_HEARTBEAT));
      }
    }
  }

  /**
   * @param {Conn} conn
   * @param {any} msg
   */
  #onJson(conn, msg) {
    switch (msg?.type) {
      case 'HELLO': {
        const res = this.roster.resolve(
          typeof msg.token === 'string' ? msg.token : undefined,
          typeof msg.name === 'string' ? sanitizeName(msg.name) : undefined
        );
        if (!res.ok) {
          this.#send(conn, encodeJson({ type: 'KICK', reason: res.error }));
          conn.ws.close();
          return;
        }
        const record = res.record;

        // Takeover, never a duplicate avatar: an older socket for this token is
        // closed rather than left racing with the new one.
        const prior = this.phoneByPlayerId.get(record.id);
        if (prior && prior !== conn) {
          this.#send(prior, encodeJson({ type: 'KICK', reason: 'Reconnected on another tab.' }));
          prior.player = null;
          prior.ws.close();
        }

        conn.role = 'phone';
        conn.player = record;
        this.phoneByPlayerId.set(record.id, conn);

        this.#send(conn, this.#identityFrame('HELLO_ACK', record, res.isNew));
        this.#broadcastRoster();
        this.#looksDirty = true;
        this.#broadcastDisplays(
          encodeJson({ type: res.isNew ? 'PLAYER_JOIN' : 'PLAYER_REJOIN', playerId: record.id })
        );
        break;
      }

      case 'SET_LOOK': {
        if (!conn.player) return;
        const record = this.roster.setLook(conn.player.id, {
          name: typeof msg.name === 'string' ? msg.name : undefined,
          colorIndex: Number.isInteger(msg.colorIndex) ? msg.colorIndex : undefined,
        });
        if (!record) return;
        // Echo the resolved look back, always. The player may not have got the
        // colour they asked for, and the phone is the thing they'll be looking
        // at when they try to find themselves on screen.
        this.#send(conn, this.#identityFrame('LOOK', record, false));
        this.#broadcastRoster();
        this.#looksDirty = true;
        break;
      }

      case 'STATS': {
        if (!conn.player) return;
        conn.player.net = {
          rttP50: num(msg.rttP50),
          rttP95: num(msg.rttP95),
          loss: num(msg.loss),
        };
        this.#broadcastDisplays(
          encodeJson({ type: 'NET_STATS', playerId: conn.player.id, ...conn.player.net })
        );
        break;
      }

      case 'DISPLAY_HELLO': {
        conn.role = 'display';
        this.displays.add(conn);
        this.#send(conn, encodeJson({ type: 'ROSTER', players: this.roster.publicList() }));
        break;
      }

      case 'CHECKPOINT': {
        if (conn.role !== 'display') return;
        this.checkpoint = msg.state;
        this.checkpointAt = Date.now();
        break;
      }

      case 'FEEDBACK_REQ': {
        if (conn.role !== 'display') return;
        const target = this.phoneByPlayerId.get(msg.playerId);
        if (target) this.#send(target, encodeFeedback(msg.code));
        break;
      }

      case 'ROSTER_REQ': {
        this.#send(conn, encodeJson({ type: 'ROSTER', players: this.roster.publicList() }));
        break;
      }

      default:
        break;
    }
  }

  /** @param {Conn} conn */
  #onClose(conn) {
    this.conns.delete(conn);
    this.displays.delete(conn);
    if (conn.player) {
      const held = this.phoneByPlayerId.get(conn.player.id);
      if (held === conn) {
        this.phoneByPlayerId.delete(conn.player.id);
        this.roster.disconnect(conn.player.id);
        // A disconnect must release the buttons, or the avatar runs forever.
        this.#broadcastDisplays(
          encodeInputFwd(conn.player.id, 0, F_SYNTHETIC, 0, t16(Date.now()))
        );
        this.#broadcastDisplays(encodeJson({ type: 'PLAYER_LEAVE', playerId: conn.player.id }));
        this.#broadcastRoster();
      }
    }
  }

  /**
   * Force a mask-0 release for any phone that has gone quiet. iOS can suspend a
   * backgrounded tab between a press and its release, which TCP cannot fix.
   */
  #sweep() {
    const now = Date.now();
    for (const conn of this.conns) {
      if (conn.role !== 'phone' || !conn.player) continue;
      if (conn.staleFired || conn.lastMask === 0) continue;
      if (now - conn.lastInputAt < STALE_MS) continue;
      conn.staleFired = true;
      conn.lastMask = 0;
      this.#broadcastDisplays(encodeInputFwd(conn.player.id, 0, F_SYNTHETIC, 0, t16(now)));
    }
  }

  /**
   * The player's own identity, as resolved by the server. Sent on join and
   * again after every change.
   * @param {string} type
   * @param {PlayerRecord} r
   * @param {boolean} isNew
   * @returns {Uint8Array}
   */
  #identityFrame(type, r, isNew) {
    return encodeJson({
      type,
      isNew,
      playerId: r.id,
      token: r.token,
      name: r.name,
      named: r.named,
      color: r.color,
      hat: r.hat,
      colorIndex: r.colorIndex,
      hatIndex: r.hatIndex,
      free: this.roster.freeByColor(),
    });
  }

  #broadcastRoster() {
    this.#broadcastDisplays(encodeJson({ type: 'ROSTER', players: this.roster.publicList() }));
  }

  /**
   * Colour availability, to every phone with the picker open.
   *
   * Coalesced onto the watchdog tick rather than sent per change: during the
   * join rush this is 30 phones x 30 joins, and nine hundred tiny frames spread
   * over the exact minute everyone is contending for airtime is a bad trade for
   * a picker that nobody is looking at that closely.
   */
  #flushLooks() {
    if (!this.#looksDirty) return;
    this.#looksDirty = false;
    const frame = encodeJson({ type: 'LOOKS', free: this.roster.freeByColor() });
    for (const conn of this.phoneByPlayerId.values()) this.#send(conn, frame);
  }

  /** @param {Uint8Array} bytes */
  #broadcastDisplays(bytes) {
    for (const d of this.displays) this.#send(d, bytes);
  }

  /**
   * @param {Conn} conn
   * @param {Uint8Array} bytes
   */
  #send(conn, bytes) {
    if (conn.ws.readyState !== 1) return;
    // Don't pile onto a socket that is already behind; a stale echo is worthless.
    if (conn.ws.bufferedAmount > 4096) return;
    conn.ws.send(bytes, { binary: true });
  }

  stats() {
    return {
      players: this.roster.byId.size,
      connectedPhones: this.phoneByPlayerId.size,
      displays: this.displays.size,
    };
  }
}

/** @param {unknown} x @returns {number} */
function num(x) {
  return typeof x === 'number' && Number.isFinite(x) ? x : 0;
}

/**
 * Relay integration: a real HTTP server, real WebSockets, real framing.
 *
 * The watchdog test at the bottom is the important one. A dropped release is
 * the worst bug in this game — the avatar runs off the level forever — and the
 * guard against it is three independent layers (full mask per packet, a phone
 * heartbeat, and this server-side sweep). TCP cannot save us from the case that
 * actually happens: iOS suspending a backgrounded tab between press and release.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { WebSocket } from 'ws';

import { Relay } from './relay.js';
import {
  BTN_JUMP,
  BTN_RIGHT,
  F_REQ_ECHO,
  F_SYNTHETIC,
  T_ECHO,
  T_INPUT,
  T_INPUT_FWD,
  T_JSON,
  decodeInputFwd,
  encodeInput,
  encodeJson,
  t16,
} from '../shared/protocol.js';
import { STALE_MS } from '../shared/tuning.js';

/** Spin up a relay on an ephemeral port. */
async function boot() {
  const server = http.createServer((_req, res) => res.writeHead(404).end());
  const relay = new Relay(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
  /** @type {WebSocket[]} */
  const clients = [];
  return {
    port,
    relay,
    /** @param {string} [role] */
    async open(role) {
      const c = await open(port, role);
      clients.push(c.ws);
      return c;
    },
    async close() {
      // Live sockets keep `server.close()` pending forever, so tear the
      // connections down explicitly rather than waiting on them.
      clearInterval(relay.watchdog);
      for (const c of clients) c.terminate();
      for (const c of relay.wss.clients) c.terminate();
      relay.wss.close();
      server.closeAllConnections();
      server.close();
      await once(server, 'close').catch(() => {});
    },
  };
}

/**
 * A socket that records every frame it receives, so tests can await a predicate
 * instead of sleeping and hoping.
 * @param {number} port @param {string} [role]
 */
async function open(port, role) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws${role ? `?role=${role}` : ''}`);
  ws.binaryType = 'arraybuffer';
  /** @type {Uint8Array[]} */
  const frames = [];
  ws.on('message', (/** @type {any} */ d) => frames.push(new Uint8Array(d)));
  await once(ws, 'open');

  return {
    ws,
    frames,
    /** @param {(f: Uint8Array[]) => boolean} pred @param {number} [ms] */
    async until(pred, ms = 3000) {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        if (pred(frames)) return true;
        await new Promise((r) => setTimeout(r, 10));
      }
      return false;
    },
    /** @param {unknown} o */
    json(o) {
      ws.send(encodeJson(o));
    },
    close() {
      ws.close();
    },
  };
}

/** @param {Uint8Array[]} frames */
function jsonMsgs(frames) {
  return frames
    .filter((f) => f[0] === T_JSON)
    .map((f) => JSON.parse(new TextDecoder().decode(f.subarray(1))));
}

/** @param {Uint8Array[]} frames */
function fwds(frames) {
  return frames
    .filter((f) => f[0] === T_INPUT_FWD)
    .map((f) => decodeInputFwd(new DataView(f.buffer, f.byteOffset, f.byteLength)));
}

test('a phone joins, and its input reaches the display', { timeout: 15000 }, async (t) => {
  const rig = await boot();
  t.after(() => rig.close());

  const display = await rig.open('display');
  const phone = await rig.open();

  phone.json({ type: 'HELLO', name: 'tester' });
  assert.ok(await phone.until((f) => jsonMsgs(f).some((m) => m.type === 'HELLO_ACK')), 'got HELLO_ACK');

  const ack = jsonMsgs(phone.frames).find((m) => m.type === 'HELLO_ACK');
  assert.ok(ack.token, 'issued a token');
  assert.equal(ack.name, 'tester');
  assert.match(ack.color, /^#[0-9a-f]{6}$/i);

  assert.ok(
    await display.until((f) => jsonMsgs(f).some((m) => m.type === 'ROSTER' && m.players.length === 1)),
    'display saw the roster'
  );

  phone.ws.send(encodeInput(T_INPUT, BTN_RIGHT | BTN_JUMP, 0, 1, t16(performance.now())));
  assert.ok(await display.until((f) => fwds(f).length > 0), 'display got the input');

  const fwd = fwds(display.frames)[0];
  assert.equal(fwd.playerId, ack.playerId);
  assert.equal(fwd.buttons, BTN_RIGHT | BTN_JUMP);
});

test('REQ_ECHO round-trips the phone stamp untouched', { timeout: 15000 }, async (t) => {
  const rig = await boot();
  t.after(() => rig.close());

  const phone = await rig.open();
  phone.json({ type: 'HELLO' });
  await phone.until((f) => jsonMsgs(f).some((m) => m.type === 'HELLO_ACK'));

  const stamp = 0xbeef;
  phone.ws.send(encodeInput(T_INPUT, 0, F_REQ_ECHO, 77, stamp));
  assert.ok(await phone.until((f) => f.some((x) => x[0] === T_ECHO)), 'got an echo');

  const echo = /** @type {Uint8Array} */ (phone.frames.find((x) => x[0] === T_ECHO));
  const v = new DataView(echo.buffer, echo.byteOffset, echo.byteLength);
  assert.equal(v.getUint16(1, true), 77, 'seq echoed');
  assert.equal(v.getUint16(3, true), stamp, 'stamp echoed verbatim — the phone times against its own clock');
});

test('reconnecting with a token takes over instead of duplicating', { timeout: 15000 }, async (t) => {
  const rig = await boot();
  t.after(() => rig.close());

  const display = await rig.open('display');
  const first = await rig.open();
  first.json({ type: 'HELLO', name: 'ghost' });
  await first.until((f) => jsonMsgs(f).some((m) => m.type === 'HELLO_ACK'));
  const token = jsonMsgs(first.frames).find((m) => m.type === 'HELLO_ACK').token;

  const second = await rig.open();
  second.json({ type: 'HELLO', token });
  const ack2 = await second.until((f) => jsonMsgs(f).some((m) => m.type === 'HELLO_ACK'));
  assert.ok(ack2);

  assert.ok(await first.until((f) => jsonMsgs(f).some((m) => m.type === 'KICK')), 'old socket was kicked');
  assert.equal(rig.relay.roster.byId.size, 1, 'still exactly one player');

  const rosters = jsonMsgs(display.frames).filter((m) => m.type === 'ROSTER');
  assert.equal(rosters[rosters.length - 1].players.length, 1, 'no duplicate avatar');
});

test('the staleness watchdog releases the buttons of a phone that goes quiet', { timeout: 15000 }, async (t) => {
  const rig = await boot();
  t.after(() => rig.close());

  const display = await rig.open('display');
  const phone = await rig.open();
  phone.json({ type: 'HELLO' });
  await phone.until((f) => jsonMsgs(f).some((m) => m.type === 'HELLO_ACK'));

  // Hold right, then go silent — the exact shape of an iOS tab suspending
  // between a press and its release.
  phone.ws.send(encodeInput(T_INPUT, BTN_RIGHT, 0, 1, t16(performance.now())));
  assert.ok(await display.until((f) => fwds(f).some((x) => x.buttons === BTN_RIGHT)));

  const released = await display.until(
    (f) => fwds(f).some((x) => x.buttons === 0 && x.flags & F_SYNTHETIC),
    STALE_MS + 1500
  );
  assert.ok(released, 'watchdog forwarded a synthetic mask-0');
});

test('a disconnect immediately releases the buttons', { timeout: 15000 }, async (t) => {
  const rig = await boot();
  t.after(() => rig.close());

  const display = await rig.open('display');
  const phone = await rig.open();
  phone.json({ type: 'HELLO' });
  await phone.until((f) => jsonMsgs(f).some((m) => m.type === 'HELLO_ACK'));

  phone.ws.send(encodeInput(T_INPUT, BTN_RIGHT, 0, 1, t16(performance.now())));
  await display.until((f) => fwds(f).some((x) => x.buttons === BTN_RIGHT));

  phone.close();
  assert.ok(
    await display.until((f) => fwds(f).some((x) => x.buttons === 0 && x.flags & F_SYNTHETIC)),
    'closing the socket released the buttons'
  );
});

test('input from an unauthenticated socket is ignored', { timeout: 15000 }, async (t) => {
  const rig = await boot();
  t.after(() => rig.close());

  const display = await rig.open('display');
  const stranger = await rig.open();

  // No HELLO — this socket has no player.
  stranger.ws.send(encodeInput(T_INPUT, BTN_JUMP, 0, 1, t16(performance.now())));
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(fwds(display.frames).length, 0, 'nothing forwarded');
});

test('the display can push feedback to a specific phone', { timeout: 15000 }, async (t) => {
  const rig = await boot();
  t.after(() => rig.close());

  const display = await rig.open('display');
  const phone = await rig.open();
  phone.json({ type: 'HELLO' });
  await phone.until((f) => jsonMsgs(f).some((m) => m.type === 'HELLO_ACK'));
  const id = jsonMsgs(phone.frames).find((m) => m.type === 'HELLO_ACK').playerId;

  display.json({ type: 'FEEDBACK_REQ', playerId: id, code: 3 });
  assert.ok(await phone.until((f) => f.some((x) => x[0] === 0x04 && x[1] === 3)), 'phone got the cue');
});

test('a full roster reclaims the longest-gone disconnected slot', { timeout: 20000 }, async (t) => {
  const rig = await boot();
  t.after(() => rig.close());

  // Fill to the cap with players who then leave. Without eviction these dead
  // records would block real players from joining later in the evening.
  const CAP = 40;
  for (let i = 0; i < CAP; i++) {
    const c = await rig.open();
    c.json({ type: 'HELLO', name: `p${i}` });
    await c.until((f) => jsonMsgs(f).some((m) => m.type === 'HELLO_ACK'));
    c.ws.terminate();
  }
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(rig.relay.roster.byId.size, CAP, 'roster is full of dead records');

  const late = await rig.open();
  late.json({ type: 'HELLO', name: 'latecomer' });
  const joined = await late.until((f) => jsonMsgs(f).some((m) => m.type === 'HELLO_ACK'));
  assert.ok(joined, 'a new player still gets in');
  assert.ok(!jsonMsgs(late.frames).some((m) => m.type === 'KICK'), 'and is not turned away');
  assert.equal(rig.relay.roster.byId.size, CAP, 'roster stays at the cap');
});

test('a connected player is never evicted to make room', { timeout: 20000 }, async (t) => {
  const rig = await boot();
  t.after(() => rig.close());

  const CAP = 40;
  /** @type {any[]} */
  const live = [];
  for (let i = 0; i < CAP; i++) {
    const c = await rig.open();
    c.json({ type: 'HELLO', name: `p${i}` });
    await c.until((f) => jsonMsgs(f).some((m) => m.type === 'HELLO_ACK'));
    live.push(c);
  }
  assert.equal(rig.relay.roster.byId.size, CAP);

  const late = await rig.open();
  late.json({ type: 'HELLO', name: 'toolate' });
  assert.ok(
    await late.until((f) => jsonMsgs(f).some((m) => m.type === 'KICK')),
    'with everyone present, the cap is enforced rather than someone being kicked out'
  );
  assert.equal(rig.relay.roster.byId.size, CAP);
});

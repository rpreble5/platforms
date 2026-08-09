/**
 * Wire protocol. Imported unchanged by the Node server and the display page,
 * and *inlined* into the single-file phone page at boot (see server/http.js,
 * which strips the `export ` keywords). So: this file must have NO imports and
 * no reliance on anything outside plain ES2022.
 *
 * All multi-byte fields are little-endian. Byte 0 is always the packet type.
 *
 * Binary is used for the hot input path only. Everything cold (join, roster,
 * host commands) is JSON behind type byte 0x00 — don't bit-pack the lobby.
 */

// ---------------------------------------------------------------- packet types

export const T_JSON = 0x00; // followed by UTF-8 JSON
export const T_INPUT = 0x01; // phone -> server
export const T_ECHO = 0x03; // server -> phone (RTT)
export const T_FEEDBACK = 0x04; // server -> phone (haptic/flash cue)
export const T_PING = 0x07; // phone -> server (idle keepalive, same layout as INPUT)
export const T_INPUT_FWD = 0x11; // server -> display

// ---------------------------------------------------------------- button bits

export const BTN_LEFT = 1 << 0;
export const BTN_RIGHT = 1 << 1;
export const BTN_JUMP = 1 << 2;
export const BTN_FINDME = 1 << 3;

// ---------------------------------------------------------------- flag bits

export const F_REQ_ECHO = 1 << 0; // phone wants this packet echoed back for RTT
export const F_HEARTBEAT = 1 << 1; // resend of an unchanged mask
export const F_PAGE_HIDDEN = 1 << 2; // phone is backgrounding; mask should be 0
export const F_SYNTHETIC = 1 << 3; // server-generated (staleness watchdog release)

// ---------------------------------------------------------------- feedback codes

export const FB_LANDED_CORRECT = 1;
export const FB_LANDED_WRONG = 2;
export const FB_ELIMINATED = 3;
export const FB_ROUND_START = 4;
export const FB_SCORED = 5;

// ---------------------------------------------------------------- sizes

export const SZ_INPUT = 7;
export const SZ_ECHO = 6;
export const SZ_FEEDBACK = 2;
export const SZ_INPUT_FWD = 9;

/**
 * Low 16 bits of a millisecond clock. Both ends only ever compare a t16 against
 * *their own* clock, so there is no clock sync anywhere in this system.
 * @param {number} ms
 * @returns {number}
 */
export function t16(ms) {
  return Math.round(ms) & 0xffff;
}

/**
 * Elapsed ms between two t16 stamps from the same clock, handling wraparound.
 * Valid for intervals under 65536 ms.
 * @param {number} then
 * @param {number} now
 * @returns {number}
 */
export function since16(then, now) {
  return (now - then) & 0xffff;
}

/**
 * Signed 16-bit sequence comparison, wraparound-safe.
 * @param {number} a
 * @param {number} b
 * @returns {number} > 0 when a is newer than b
 */
export function seqDiff(a, b) {
  return (((a - b) & 0xffff) ^ 0x8000) - 0x8000;
}

// ---------------------------------------------------------------- encode / decode

/**
 * Phone -> server. 7 bytes.
 * @param {number} type T_INPUT or T_PING
 * @param {number} buttons full bitmask, always — loss is self-healing
 * @param {number} flags
 * @param {number} seq
 * @param {number} stamp16
 * @returns {Uint8Array<ArrayBuffer>}
 */
export function encodeInput(type, buttons, flags, seq, stamp16) {
  const b = new Uint8Array(SZ_INPUT);
  const v = new DataView(b.buffer);
  v.setUint8(0, type);
  v.setUint8(1, buttons & 0xff);
  v.setUint8(2, flags & 0xff);
  v.setUint16(3, seq & 0xffff, true);
  v.setUint16(5, stamp16 & 0xffff, true);
  return b;
}

/**
 * @param {DataView} v
 * @returns {{type:number, buttons:number, flags:number, seq:number, stamp16:number}}
 */
export function decodeInput(v) {
  return {
    type: v.getUint8(0),
    buttons: v.getUint8(1),
    flags: v.getUint8(2),
    seq: v.getUint16(3, true),
    stamp16: v.getUint16(5, true),
  };
}

/**
 * Server -> display. 9 bytes. Forwarded immediately, never coalesced.
 * @param {number} playerId
 * @param {number} buttons
 * @param {number} flags
 * @param {number} seq
 * @param {number} recv16 server receive time, for relay+queue delay accounting
 * @returns {Uint8Array<ArrayBuffer>}
 */
export function encodeInputFwd(playerId, buttons, flags, seq, recv16) {
  const b = new Uint8Array(SZ_INPUT_FWD);
  const v = new DataView(b.buffer);
  v.setUint8(0, T_INPUT_FWD);
  v.setUint8(1, buttons & 0xff);
  v.setUint8(2, flags & 0xff);
  v.setUint16(3, playerId & 0xffff, true);
  v.setUint16(5, seq & 0xffff, true);
  v.setUint16(7, recv16 & 0xffff, true);
  return b;
}

/**
 * @param {DataView} v
 * @returns {{playerId:number, buttons:number, flags:number, seq:number, recv16:number}}
 */
export function decodeInputFwd(v) {
  return {
    buttons: v.getUint8(1),
    flags: v.getUint8(2),
    playerId: v.getUint16(3, true),
    seq: v.getUint16(5, true),
    recv16: v.getUint16(7, true),
  };
}

/**
 * Server -> phone. 6 bytes. Echoes the phone's own seq and stamp straight back.
 * @param {number} seq
 * @param {number} stamp16
 * @param {number} flags
 * @returns {Uint8Array<ArrayBuffer>}
 */
export function encodeEcho(seq, stamp16, flags) {
  const b = new Uint8Array(SZ_ECHO);
  const v = new DataView(b.buffer);
  v.setUint8(0, T_ECHO);
  v.setUint16(1, seq & 0xffff, true);
  v.setUint16(3, stamp16 & 0xffff, true);
  v.setUint8(5, flags & 0xff);
  return b;
}

/**
 * @param {DataView} v
 * @returns {{seq:number, stamp16:number, flags:number}}
 */
export function decodeEcho(v) {
  return { seq: v.getUint16(1, true), stamp16: v.getUint16(3, true), flags: v.getUint8(5) };
}

/**
 * @param {number} code
 * @returns {Uint8Array<ArrayBuffer>}
 */
export function encodeFeedback(code) {
  const b = new Uint8Array(SZ_FEEDBACK);
  b[0] = T_FEEDBACK;
  b[1] = code & 0xff;
  return b;
}

/**
 * JSON frame: type byte 0x00 followed by UTF-8.
 * @param {unknown} obj
 * @returns {Uint8Array<ArrayBuffer>}
 */
export function encodeJson(obj) {
  const body = new TextEncoder().encode(JSON.stringify(obj));
  const b = new Uint8Array(body.length + 1);
  b[0] = T_JSON;
  b.set(body, 1);
  return b;
}

/**
 * @param {Uint8Array} bytes whole frame including the leading 0x00
 * @returns {any}
 */
export function decodeJson(bytes) {
  return JSON.parse(new TextDecoder().decode(bytes.subarray(1)));
}

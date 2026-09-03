/**
 * Synthetic load. Scale before features — if 30 clients break the AP, every
 * line of quiz logic written first is wasted work.
 *
 * HONEST CAVEAT, and it matters: run this from a laptop that is ON THE WIFI so
 * the packets are really in the air. Even then, one radio is not thirty radios.
 * This validates server CPU, the AP's client table, and your own protocol under
 * volume. It does NOT reproduce true airtime contention — only 30 real phones
 * spread around a room do that. Use it to find the cliff, then confirm with
 * however many real handsets you can borrow.
 *
 *   node tools/loadgen.js --url http://192.168.1.20:8080 --clients 30
 *   node tools/loadgen.js --url http://192.168.1.20:8080 --clients 10,20,30 --hold 30
 */

import { WebSocket } from 'ws';
import {
  BTN_JUMP,
  BTN_LEFT,
  BTN_RIGHT,
  F_HEARTBEAT,
  F_REQ_ECHO,
  T_ECHO,
  T_INPUT,
  T_JSON,
  encodeInput,
  encodeJson,
  since16,
  t16,
} from '../shared/protocol.js';
import { ECHO_EVERY_MS, HEARTBEAT_MS } from '../shared/tuning.js';

const args = parseArgs(process.argv.slice(2));
const baseUrl = args.url ?? 'http://localhost:8080';
const steps = String(args.clients ?? '30')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => n > 0);
const holdSec = Number(args.hold ?? 20);

const wsBase = baseUrl.replace(/^http/, 'ws').replace(/\/+$/, '') + '/ws';

/** A synthetic phone: bursty taps, held runs, idle gaps. Not a metronome — a
 *  uniform packet cadence is exactly the load pattern that hides contention. */
class FakePhone {
  /** @param {number} i */
  constructor(i) {
    this.i = i;
    this.seq = 0;
    this.mask = 0;
    this.lastSend = 0;
    this.lastEcho = 0;
    this.nextChange = 0;
    /** @type {number[]} */
    this.rtts = [];
    this.asked = 0;
    this.got = 0;
    this.connected = false;
    /** @type {WebSocket | null} */
    this.ws = null;
    // Stagger, exactly as the real phone does — otherwise every client syncs on
    // second boundaries and we manufacture contention that wouldn't exist.
    this.phase = (i * 137) % HEARTBEAT_MS;
  }

  start() {
    const ws = new WebSocket(wsBase);
    this.ws = ws;
    ws.binaryType = 'arraybuffer';
    ws.on('open', () => {
      this.connected = true;
      ws.send(encodeJson({ type: 'HELLO', name: `bot${this.i}` }));
    });
    ws.on('message', (/** @type {any} */ data) => {
      const b = new Uint8Array(data);
      if (!b.length) return;
      if (b[0] === T_ECHO) {
        const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
        const stamp = v.getUint16(3, true);
        const rtt = since16(stamp, t16(performance.now()));
        if (rtt < 5000) {
          this.got++;
          this.rtts.push(rtt);
          if (this.rtts.length > 400) this.rtts.shift();
        }
      } else if (b[0] === T_JSON) {
        /* HELLO_ACK etc. — not needed for load */
      }
    });
    ws.on('error', () => {});
    ws.on('close', () => {
      this.connected = false;
    });
  }

  /** @param {number} now */
  tick(now) {
    if (!this.ws || this.ws.readyState !== 1) return;

    let changed = false;
    if (now >= this.nextChange) {
      // Roughly: 45% run, 25% jump, 30% idle — with jumps often overlapping a run.
      const r = Math.random();
      if (r < 0.45) this.mask = Math.random() < 0.5 ? BTN_LEFT : BTN_RIGHT;
      else if (r < 0.7) this.mask = (this.mask & (BTN_LEFT | BTN_RIGHT)) | BTN_JUMP;
      else this.mask = 0;
      this.nextChange = now + 90 + Math.random() * 700;
      changed = true;
    }

    const due = now - this.lastSend >= HEARTBEAT_MS + this.phase % 60;
    if (!changed && !due) return;

    let flags = changed ? 0 : F_HEARTBEAT;
    if (now - this.lastEcho >= ECHO_EVERY_MS) {
      flags |= F_REQ_ECHO;
      this.lastEcho = now;
      this.asked++;
    }
    this.seq = (this.seq + 1) & 0xffff;
    this.ws.send(encodeInput(T_INPUT, this.mask, flags, this.seq, t16(now)));
    this.lastSend = now;
  }

  stop() {
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
  }
}

/**
 * @param {number} n
 * @param {number} seconds
 */
async function runStep(n, seconds) {
  const phones = Array.from({ length: n }, (_, i) => new FakePhone(i));
  // Ramp joins over 3s. Thirty simultaneous WebSocket handshakes is itself a
  // realistic worst case, but a instantaneous storm isn't what a real room does.
  for (let i = 0; i < n; i++) {
    phones[i].start();
    if (i % 5 === 4) await sleep(500);
  }
  await sleep(1500);

  const timer = setInterval(() => {
    const now = performance.now();
    for (const p of phones) p.tick(now);
  }, 15);

  const started = Date.now();
  const progress = setInterval(() => {
    const left = Math.max(0, seconds - Math.round((Date.now() - started) / 1000));
    process.stdout.write(`\r  ${n} clients · ${left}s remaining   `);
  }, 1000);

  await sleep(seconds * 1000);
  clearInterval(timer);
  clearInterval(progress);
  process.stdout.write('\r');

  /** @type {number[]} */
  const all = [];
  let asked = 0;
  let got = 0;
  let live = 0;
  for (const p of phones) {
    all.push(...p.rtts);
    asked += p.asked;
    got += p.got;
    if (p.connected) live++;
    p.stop();
  }
  await sleep(300);

  const s = all.sort((a, b) => a - b);
  const q = /** @param {number} f */ (f) => (s.length ? s[Math.min(s.length - 1, Math.floor(s.length * f))] : NaN);
  return {
    clients: n,
    live,
    samples: s.length,
    p50: q(0.5),
    p95: q(0.95),
    p99: q(0.99),
    max: s.length ? s[s.length - 1] : NaN,
    loss: asked ? 1 - got / asked : 0,
  };
}

const results = [];
console.log(`\n  target ${wsBase}\n`);
for (const n of steps) {
  results.push(await runStep(n, holdSec));
}

console.log('  clients  live  samples   p50    p95    p99    max    loss');
console.log('  ------------------------------------------------------------');
for (const r of results) {
  console.log(
    `  ${pad(r.clients, 7)}  ${pad(r.live, 4)}  ${pad(r.samples, 7)}  ${pad(fmt(r.p50), 5)}  ${pad(
      fmt(r.p95),
      5
    )}  ${pad(fmt(r.p99), 5)}  ${pad(fmt(r.max), 5)}  ${(r.loss * 100).toFixed(2)}%`
  );
}

// The triggers from the plan, evaluated for you rather than left as a judgement
// call at the venue.
const worst = results[results.length - 1];
console.log('');

// A silently short client count invalidates the whole reading — and it is easy
// to miss in a table of otherwise healthy numbers.
for (const r of results) {
  if (r.live < r.clients) {
    console.log(
      `  \x1b[33m!\x1b[0m  only ${r.live}/${r.clients} clients stayed connected — that row is not a ${r.clients}-client measurement.`
    );
  }
}
if (worst.p99 > 150 || worst.loss > 0.01) {
  console.log('  \x1b[33m!\x1b[0m  p99 > 150ms or loss > 1% at full load.');
  console.log('     This is the "bring the old router" trigger. Re-run on a standalone');
  console.log('     island AP (no WAN, non-DFS channel, 40MHz, host on Ethernet).');
} else if (results.length > 1 && worst.p95 > results[0].p95 * 3) {
  console.log('  \x1b[33m!\x1b[0m  p95 degrades sharply as clients scale — AP or airtime saturation.');
  console.log('     It will only be worse with a real crowd. Bring the router.');
} else {
  console.log('  Within budget. Remember this does not test true airtime contention —');
  console.log('  confirm with as many real phones as you can borrow.');
}
console.log('');
process.exit(0);

/** @param {number} ms */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
/** @param {number} n */
function fmt(n) {
  return Number.isFinite(n) ? n.toFixed(0) : '—';
}
/** @param {string|number} s @param {number} n */
function pad(s, n) {
  return String(s).padStart(n, ' ');
}
/** @param {string[]} argv @returns {Record<string,string>} */
function parseArgs(argv) {
  /** @type {Record<string,string>} */
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) out[a.slice(2)] = argv[i + 1]?.startsWith('--') ? 'true' : argv[++i];
  }
  return out;
}

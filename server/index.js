/**
 * Boot: HTTP + WebSocket on one port, then print the join URL and a QR for it.
 *
 * One port matters — the QR code has to point somewhere, and asking 30 people
 * to type a URL with a port number is how a party stalls for ten minutes.
 */

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

import { qrToTerminal } from '../shared/qr.js';
import { createHandler } from './http.js';
import { Relay } from './relay.js';
import { bestLanAddress, lanAddresses } from './net.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '0.0.0.0';
const dev = process.argv.includes('--watch') || process.env.NODE_ENV !== 'production';

const lanAddr = bestLanAddress();
const joinUrl = lanAddr ? `http://${lanAddr.address}:${PORT}/` : `http://localhost:${PORT}/`;

// The host key gates the remote-control page. Four characters from an
// unambiguous alphabet: it lives in a URL fragment the host taps once, and
// the only attacker is a resident who peeked at the QR — not the internet.
const HOST_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const hostKey =
  process.env.HOST_KEY ??
  [...randomBytes(4)].map((b) => HOST_ALPHABET[b % HOST_ALPHABET.length]).join('');
const hostUrl = `${joinUrl}host#${hostKey}`;

/** @type {Relay} */
let relay;

const server = http.createServer(
  createHandler({
    root,
    dev,
    getCheckpoint: () => relay?.checkpoint ?? null,
    getJoinUrl: () => joinUrl,
  })
);
relay = new Relay(server, { hostKey });

// Mirror the display's checkpoint to disk so a Node restart doesn't lose it.
const stateDir = path.join(root, 'state');
setInterval(() => {
  if (!relay.checkpoint) return;
  try {
    if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      path.join(stateDir, 'checkpoint.json'),
      JSON.stringify({ at: relay.checkpointAt, state: relay.checkpoint })
    );
  } catch {
    /* a failed checkpoint write must never take the game down */
  }
}, 5000).unref();

server.listen(PORT, HOST, () => {
  const addr = lanAddr;

  console.log('');
  console.log(qrToTerminal(joinUrl));
  console.log('');
  console.log(`  players   ${bold(joinUrl)}`);
  console.log(`  display   ${bold(`http://localhost:${PORT}/display/`)}`);
  console.log(`  host      ${bold(hostUrl)}  (keep the key to yourself)`);
  console.log('');

  const others = lanAddresses().filter((a) => a.address !== addr?.address);
  if (others.length) {
    console.log(`  other addresses: ${others.map((a) => `${a.address} (${a.iface})`).join(', ')}`);
  }

  if (!addr) {
    warn('No LAN address found. Phones will not be able to reach this machine.');
  } else if (addr.maybeWireless) {
    warn(
      `Serving on ${addr.iface}, which looks like a wireless interface.\n` +
        '    On a home/party AP, wire the host to the AP instead — it takes the host\n' +
        '    off the air entirely. On corporate WiFi the opposite is often true:\n' +
        '    wired and wireless are separate VLANs, so same-SSID may be the only\n' +
        '    thing phones can reach. Test both, and record which worked.'
    );
  }

  console.log('  Before you measure anything: put the TV in Game Mode. Motion smoothing');
  console.log('  costs ~100ms, more than this entire software pipeline. HDMI only —');
  console.log('  Chromecast/AirPlay add 100-500ms.');
  console.log('');
});

/** @param {string} s */
function bold(s) {
  return `\x1b[1m${s}\x1b[0m`;
}

/** @param {string} s */
function warn(s) {
  console.log(`  \x1b[33m!\x1b[0m  ${s}`);
  console.log('');
}

for (const sig of /** @type {const} */ (['SIGINT', 'SIGTERM'])) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  });
}

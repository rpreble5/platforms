/**
 * Boot: HTTP + WebSocket on one port, then print the join URL and a QR for it.
 *
 * One port matters — the QR code has to point somewhere, and asking 30 people
 * to type a URL with a port number is how a party stalls for ten minutes.
 */

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

import { qrToTerminal } from '../shared/qr.js';
import { createHandler } from './http.js';
import { Relay } from './relay.js';
import { bestLanAddress, lanAddresses } from './net.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '0.0.0.0';
const dev = process.argv.includes('--watch') || process.env.NODE_ENV !== 'production';

// A cloud test instance (e.g. Render) fronts this server with HTTPS on a
// public hostname — the LAN address in the QR would be meaningless there.
// PUBLIC_URL (or Render's injected RENDER_EXTERNAL_URL) wins when present;
// a session on a laptop sets neither and keeps the LAN behavior.
const publicUrl = process.env.PUBLIC_URL ?? process.env.RENDER_EXTERNAL_URL;
const lanAddr = bestLanAddress();
const joinUrl = publicUrl
  ? publicUrl.replace(/\/*$/, '/')
  : lanAddr ? `http://${lanAddr.address}:${PORT}/` : `http://localhost:${PORT}/`;

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

// Mirror the display's checkpoint AND the roster to disk so a Node restart
// doesn't lose them. The roster is the one that matters: it holds the
// token -> player mapping every phone's reconnect depends on. Restarting Node
// mid-party without it would mint every returning phone a brand-new player
// and orphan the scores the display is still holding.
const stateDir = path.join(root, 'state');
const rosterFile = path.join(stateDir, 'roster.json');
// A snapshot older than this is last session's crowd, not a mid-party
// restart — resurrecting it would fill the lobby with 30 ghost avatars.
const ROSTER_MAX_AGE_MS = 6 * 60 * 60 * 1000;

try {
  if (existsSync(rosterFile)) {
    const saved = JSON.parse(readFileSync(rosterFile, 'utf8'));
    if (Date.now() - (saved.at ?? 0) <= ROSTER_MAX_AGE_MS) {
      const n = relay.roster.hydrate(saved.roster);
      if (n) console.log(`  restored ${n} player identit${n === 1 ? 'y' : 'ies'} from state/roster.json`);
    }
  }
} catch {
  /* a corrupt snapshot means a fresh roster, never a failed boot */
}

function saveState() {
  try {
    if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });
    if (relay.checkpoint) {
      writeFileSync(
        path.join(stateDir, 'checkpoint.json'),
        JSON.stringify({ at: relay.checkpointAt, state: relay.checkpoint })
      );
    }
    if (relay.roster.byId.size) {
      writeFileSync(rosterFile, JSON.stringify({ at: Date.now(), roster: relay.roster.serialize() }));
    }
  } catch {
    /* a failed state write must never take the game down */
  }
}
setInterval(saveState, 5000).unref();

// A taken port is the most common way this fails to start (usually an older
// `npm run dev` still running in another window) — say so, instead of dying
// with a stack trace.
server.on('error', (/** @type {NodeJS.ErrnoException} */ err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('');
    console.error(`  port ${PORT} is already in use — another server is probably still running`);
    console.error('  (an old `npm run dev` window?). Close it, or start on another port:');
    console.error(`    PORT=${PORT + 1} npm run dev        (Windows: set PORT=${PORT + 1} && npm run dev)`);
    console.error('');
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, HOST, () => {
  const addr = lanAddr;

  console.log('');
  console.log(qrToTerminal(joinUrl));
  console.log('');
  console.log(`  players   ${bold(joinUrl)}`);
  console.log(`  display   ${bold(publicUrl ? `${joinUrl}display/` : `http://localhost:${PORT}/display/`)}`);
  console.log(`  host      ${bold(hostUrl)}  (keep the key to yourself)`);
  console.log(`  studio    ${bold(publicUrl ? `${joinUrl}builder` : `http://localhost:${PORT}/builder`)}  (write question packs)`);
  console.log(`  training  ${bold(publicUrl ? `${joinUrl}training` : `http://localhost:${PORT}/training`)}  (question writer's guide)`);
  console.log(`  levels    ${bold(`http://localhost:${PORT}/levels`)}`);
  console.log('');

  // Behind a public URL the container's interface list is noise, and the
  // wireless warnings below are about the venue's LAN quality — skip both.
  if (publicUrl) return;

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
    // Ctrl-C is exactly the restart the roster mirror exists for — flush it
    // now rather than losing whoever joined since the last 5s tick.
    saveState();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  });
}

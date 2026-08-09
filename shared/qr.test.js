/**
 * Round-trip the vendored QR encoder through a real decoder.
 *
 * This exists because a QR that renders but does not scan is invisible until
 * thirty people are standing in a room pointing their cameras at it. The
 * decoder is a devDependency and is skipped if absent — it never ships.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeQR } from './qr.js';

/** @type {any} */
let jsQR = null;
try {
  jsQR = (await import('jsqr')).default;
} catch {
  /* devDependency not installed */
}

/**
 * Rasterise a matrix to RGBA the way a camera would see it: black modules on a
 * white field with a quiet zone.
 * @param {{size:number, modules:Uint8Array[]}} qr
 * @param {number} scale
 * @param {number} quiet
 */
function raster(qr, scale = 6, quiet = 4) {
  const n = (qr.size + quiet * 2) * scale;
  const data = new Uint8ClampedArray(n * n * 4).fill(255);
  for (let r = 0; r < qr.size; r++) {
    for (let c = 0; c < qr.size; c++) {
      if (!qr.modules[r][c]) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const i = (((r + quiet) * scale + dy) * n + (c + quiet) * scale + dx) * 4;
          data[i] = data[i + 1] = data[i + 2] = 0;
        }
      }
    }
  }
  return { data, n };
}

const CASES = [
  'http://a.bc/', // version 1
  'http://10.0.0.7:8080/',
  'http://192.168.1.20:8080/',
  'http://192.168.100.100:8080/',
  'http://172.16.254.199:65535/join',
  // Comfortably longer than any join URL, to exercise the larger versions.
  'http://192.168.100.100:8080/join?room=ABCDEF&v=1&hint=connect-to-the-party-ssid',
];

test('every join URL round-trips through a real QR decoder', { skip: !jsQR && 'jsqr not installed' }, () => {
  for (const url of CASES) {
    const qr = encodeQR(url);
    const { data, n } = raster(qr);
    const res = jsQR(data, n, n);
    assert.ok(res, `no decode for ${url} (v${(qr.size - 17) / 4})`);
    assert.equal(res.data, url);
  }
});

test('matrix geometry is well formed', () => {
  const qr = encodeQR('http://192.168.1.20:8080/');
  const { size, modules } = qr;
  assert.equal(size, 25, 'this URL should pick version 2');

  // Finder patterns: dark ring, light gap, dark 3x3 core.
  for (const [r0, c0] of [
    [0, 0],
    [0, size - 7],
    [size - 7, 0],
  ]) {
    assert.equal(modules[r0][c0], 1, 'finder outer corner is dark');
    assert.equal(modules[r0 + 1][c0 + 1], 0, 'finder gap is light');
    assert.equal(modules[r0 + 3][c0 + 3], 1, 'finder core is dark');
  }

  // Timing patterns alternate.
  for (let i = 8; i < size - 8; i++) {
    assert.equal(modules[6][i], i % 2 === 0 ? 1 : 0, `row timing at ${i}`);
    assert.equal(modules[i][6], i % 2 === 0 ? 1 : 0, `col timing at ${i}`);
  }

  // The dark module is mandatory and must survive format-info placement.
  assert.equal(modules[size - 8][8], 1, 'dark module');
});

test('an over-long payload is rejected rather than silently truncated', () => {
  assert.throws(() => encodeQR('x'.repeat(200)), /too long/);
});

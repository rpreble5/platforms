/**
 * Writes a throwaway 3x3 platform tilesheet, for checking the tiling before
 * there's any real art — or for checking new art against a known-good file.
 *
 *   npm run testsheet        # writes assets/platform.png
 *
 * Deliberately ugly. Every cell is distinguishable, the four outer corners have
 * square notches bitten out of them, and each repeating middle cell has a dot
 * in it, so stretched corners, seams and tile drift are all obvious at a glance.
 * Delete assets/platform.png to go back to the procedural placeholder.
 *
 * No dependencies: the PNG is assembled by hand at the bottom of the file.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const CELL = 64;
const N = CELL * 3;
const px = Buffer.alloc(N * N * 4); // RGBA, all zero = transparent

/** @typedef {readonly [number, number, number]} RGB */

/** @param {number} x @param {number} y @param {RGB} rgb */
const set = (x, y, [r, g, b]) => {
  if (x < 0 || y < 0 || x >= N || y >= N) return;
  const i = (y * N + x) * 4;
  px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
};

/** @type {RGB[]} */
const ROW = [[240, 200, 130], [200, 150, 90], [150, 105, 60]];
/** @type {RGB} */
const INK = [30, 20, 10];
/** @type {RGB} */
const DOT = [255, 60, 120];

for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    const row = Math.floor(y / CELL);
    const col = Math.floor(x / CELL);
    const cx = x % CELL;
    const cy = y % CELL;

    // Bite a notch out of each outer corner. If the sheet is tiled correctly
    // these stay square 12x12 notches at exactly four places.
    const outerL = col === 0 && cx < 12;
    const outerR = col === 2 && cx >= CELL - 12;
    const outerT = row === 0 && cy < 12;
    const outerB = row === 2 && cy >= CELL - 12;
    if ((outerL || outerR) && (outerT || outerB)) continue;

    set(x, y, ROW[row]);

    // Outline on the outside edges only, so the board reads as one object.
    if ((col === 0 && cx < 5) || (col === 2 && cx >= CELL - 5)) set(x, y, INK);
    if ((row === 0 && cy < 5) || (row === 2 && cy >= CELL - 5)) set(x, y, INK);

    // A dot in the centre of every middle-column cell: counts the repeats and
    // makes drift between board widths obvious.
    if (col === 1) {
      const dx = cx - CELL / 2;
      const dy = cy - CELL / 2;
      if (dx * dx + dy * dy < 49) set(x, y, DOT);
    }
  }
}

// Minimal PNG writer: signature, IHDR, IDAT, IEND.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
/** @param {Buffer} buf @returns {number} */
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
/** @param {string} type @param {Buffer} data @returns {Buffer} */
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(N, 0);
ihdr.writeUInt32BE(N, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 6;  // colour type RGBA
const raw = Buffer.alloc((N * 4 + 1) * N);
for (let y = 0; y < N; y++) {
  raw[y * (N * 4 + 1)] = 0; // filter: none
  px.copy(raw, y * (N * 4 + 1) + 1, y * N * 4, (y + 1) * N * 4);
}

const out = process.argv[2] ?? 'assets/platform.png';
writeFileSync(out, Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]));
console.log(`wrote ${out} — ${N}x${N} sheet, ${CELL}px cells`);

/**
 * Minimal QR encoder — byte mode, versions 1-5, single ECC block.
 *
 * Vendored rather than npm'd because it is used in two places (the terminal at
 * boot and the display canvas) and `ws` is meant to be the only dependency.
 * Restricted to single-block versions on purpose: it removes the block
 * interleaving step entirely, and v5-L holds 106 bytes — a join URL is ~28.
 *
 * Returns a boolean matrix; callers decide how to paint it.
 */

// ------------------------------------------------------------- GF(256), poly 0x11d

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}

/** @param {number} a @param {number} b @returns {number} */
function gmul(a, b) {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

/** @param {Uint8Array} a @param {Uint8Array} b @returns {Uint8Array<ArrayBuffer>} */
function polyMul(a, b) {
  const r = new Uint8Array(a.length + b.length - 1);
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) r[i + j] ^= gmul(a[i], b[j]);
  }
  return r;
}

/** Generator polynomial for `n` ECC codewords. @param {number} n @returns {Uint8Array<ArrayBuffer>} */
function rsGenPoly(n) {
  let g = /** @type {Uint8Array<ArrayBuffer>} */ (Uint8Array.of(1));
  for (let i = 0; i < n; i++) g = polyMul(g, Uint8Array.of(1, EXP[i]));
  return g;
}

/** @param {Uint8Array} data @param {number} eccLen @returns {Uint8Array<ArrayBuffer>} */
function rsEncode(data, eccLen) {
  const g = rsGenPoly(eccLen);
  const buf = new Uint8Array(data.length + eccLen);
  buf.set(data);
  for (let i = 0; i < data.length; i++) {
    const c = buf[i];
    if (c === 0) continue;
    for (let j = 1; j < g.length; j++) buf[i + j] ^= gmul(g[j], c);
  }
  return buf.slice(data.length);
}

// ------------------------------------------------------------- capacity table

/**
 * Single-block versions only. [version, eccLevelBits, dataCodewords, eccCodewords].
 * ECC level bits for format info: L=0b01, M=0b00.
 */
const VERSIONS = /** @type {const} */ ([
  [1, 0b00, 16, 10], // 1-M
  [2, 0b00, 28, 16], // 2-M
  [3, 0b00, 44, 26], // 3-M
  [4, 0b01, 80, 20], // 4-L
  [5, 0b01, 108, 26], // 5-L
]);

/** Second alignment-pattern coordinate per version (versions 2-5 have exactly one). */
const ALIGN_AT = /** @type {Record<number, number>} */ ({ 2: 18, 3: 22, 4: 26, 5: 30 });

// ------------------------------------------------------------- format info

/** @param {number} eccBits @param {number} mask @returns {number} */
function formatInfo(eccBits, mask) {
  const d = (eccBits << 3) | mask;
  let v = d << 10;
  for (let i = 4; i >= 0; i--) {
    if (v & (1 << (i + 10))) v ^= 0x537 << i;
  }
  return ((d << 10) | v) ^ 0x5412;
}

// ------------------------------------------------------------- masks

/** @type {Array<(r:number,c:number)=>boolean>} */
const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

// ------------------------------------------------------------- penalty

const FIND_A = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
const FIND_B = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];

/** @param {Uint8Array[]} m @returns {number} */
function penalty(m) {
  const n = m.length;
  let score = 0;

  // Rule 1: runs of 5+ in a row or column.
  for (let i = 0; i < n; i++) {
    let runR = 1;
    let runC = 1;
    for (let j = 1; j < n; j++) {
      runR = m[i][j] === m[i][j - 1] ? runR + 1 : 1;
      if (runR === 5) score += 3;
      else if (runR > 5) score += 1;
      runC = m[j][i] === m[j - 1][i] ? runC + 1 : 1;
      if (runC === 5) score += 3;
      else if (runC > 5) score += 1;
    }
  }

  // Rule 2: 2x2 blocks of one colour.
  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n - 1; c++) {
      const v = m[r][c];
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
    }
  }

  // Rule 3: finder-lookalike 1:1:3:1:1 with four light modules on one side.
  for (let i = 0; i < n; i++) {
    for (let j = 0; j + 10 < n; j++) {
      let aR = true;
      let bR = true;
      let aC = true;
      let bC = true;
      for (let k = 0; k < 11; k++) {
        const hv = m[i][j + k];
        const vv = m[j + k][i];
        if (hv !== FIND_A[k]) aR = false;
        if (hv !== FIND_B[k]) bR = false;
        if (vv !== FIND_A[k]) aC = false;
        if (vv !== FIND_B[k]) bC = false;
      }
      if (aR) score += 40;
      if (bR) score += 40;
      if (aC) score += 40;
      if (bC) score += 40;
    }
  }

  // Rule 4: deviation from a 50/50 dark ratio.
  let dark = 0;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) dark += m[r][c];
  const pct = (dark * 100) / (n * n);
  score += Math.floor(Math.abs(pct - 50) / 5) * 10;

  return score;
}

// ------------------------------------------------------------- encoder

/**
 * Encode text as a QR matrix.
 * @param {string} text
 * @returns {{size:number, modules:Uint8Array[]}} modules[row][col], 1 = dark
 */
export function encodeQR(text) {
  const bytes = new TextEncoder().encode(text);

  const spec = VERSIONS.find(([, , dataCw]) => bytes.length <= dataCw - 2);
  if (!spec) {
    throw new Error(`QR payload too long: ${bytes.length} bytes (max ${VERSIONS[VERSIONS.length - 1][2] - 2})`);
  }
  const [version, eccBits, dataCw, eccCw] = spec;
  const size = 17 + 4 * version;

  // ---- bitstream: mode 0100, 8-bit length (versions 1-9), payload, terminator, pad
  /** @type {number[]} */
  const bits = [];
  /** @param {number} value @param {number} len */
  const push = (value, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, 8);
  for (const b of bytes) push(b, 8);
  for (let i = 0; i < 4 && bits.length < dataCw * 8; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const data = new Uint8Array(dataCw);
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let k = 0; k < 8; k++) v = (v << 1) | bits[i + k];
    data[i / 8] = v;
  }
  for (let i = bits.length / 8, alt = 0; i < dataCw; i++, alt++) {
    data[i] = alt % 2 === 0 ? 0xec : 0x11;
  }

  const codewords = new Uint8Array(dataCw + eccCw);
  codewords.set(data);
  codewords.set(rsEncode(data, eccCw), dataCw);

  // ---- function patterns
  const base = /** @type {Uint8Array[]} */ (Array.from({ length: size }, () => new Uint8Array(size)));
  const reserved = /** @type {Uint8Array[]} */ (Array.from({ length: size }, () => new Uint8Array(size)));

  /** @param {number} r @param {number} c @param {number} v */
  const put = (r, c, v) => {
    base[r][c] = v;
    reserved[r][c] = 1;
  };

  /** 7x7 finder plus its separator ring. @param {number} r0 @param {number} c0 */
  const finder = (r0, c0) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const r1 = r0 + r;
        const c1 = c0 + c;
        if (r1 < 0 || r1 >= size || c1 < 0 || c1 >= size) continue;
        const inRing = r >= 0 && r <= 6 && c >= 0 && c <= 6;
        const dark =
          inRing &&
          (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
        put(r1, c1, dark ? 1 : 0);
      }
    }
  };
  finder(0, 0);
  finder(0, size - 7);
  finder(size - 7, 0);

  // timing patterns
  for (let i = 8; i < size - 8; i++) {
    put(6, i, i % 2 === 0 ? 1 : 0);
    put(i, 6, i % 2 === 0 ? 1 : 0);
  }

  // the single alignment pattern (versions 2+)
  const ac = ALIGN_AT[version];
  if (ac !== undefined) {
    for (let r = -2; r <= 2; r++) {
      for (let c = -2; c <= 2; c++) {
        const dark = Math.max(Math.abs(r), Math.abs(c)) !== 1;
        put(ac + r, ac + c, dark ? 1 : 0);
      }
    }
  }

  // dark module, and reserve the format-info strips
  put(size - 8, 8, 1);
  for (let i = 0; i <= 8; i++) {
    if (!reserved[8][i]) put(8, i, 0);
    if (!reserved[i][8]) put(i, 8, 0);
  }
  for (let i = 0; i < 8; i++) {
    if (!reserved[8][size - 1 - i]) put(8, size - 1 - i, 0);
    if (!reserved[size - 1 - i][8]) put(size - 1 - i, 8, 0);
  }

  // ---- data placement: upward/downward zigzag over 2-wide columns, skipping column 6
  const dataBits = /** @type {number[]} */ ([]);
  for (const cw of codewords) for (let i = 7; i >= 0; i--) dataBits.push((cw >> i) & 1);

  let idx = 0;
  let up = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col = 5;
    for (let n = 0; n < size; n++) {
      const row = up ? size - 1 - n : n;
      for (let k = 0; k < 2; k++) {
        const c = col - k;
        if (reserved[row][c]) continue;
        base[row][c] = idx < dataBits.length ? dataBits[idx++] : 0;
      }
    }
    up = !up;
  }

  // ---- pick the lowest-penalty mask
  let best = /** @type {Uint8Array[] | null} */ (null);
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const m = base.map((row) => row.slice());
    const fn = MASKS[mask];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!reserved[r][c] && fn(r, c)) m[r][c] ^= 1;
      }
    }
    // Format info, twice. Both copies read bit 0 first, and the two copies run
    // in opposite orientations — copy 1 starts down column 8 and turns along
    // row 8, copy 2 starts along row 8 and turns down column 8.
    const fmt = formatInfo(eccBits, mask);
    for (let i = 0; i < 15; i++) {
      const bit = (fmt >> i) & 1;
      // copy 1, wrapped around the top-left finder
      if (i < 6) m[i][8] = bit;
      else if (i === 6) m[7][8] = bit;
      else if (i === 7) m[8][8] = bit;
      else if (i === 8) m[8][7] = bit;
      else m[8][14 - i] = bit;
      // copy 2, split between the top-right and bottom-left finders
      if (i < 8) m[8][size - 1 - i] = bit;
      else m[size - 15 + i][8] = bit;
    }
    // The dark module is not part of the format strings and must survive them.
    m[size - 8][8] = 1;
    const s = penalty(m);
    if (s < bestScore) {
      bestScore = s;
      best = m;
    }
  }

  return { size, modules: /** @type {Uint8Array[]} */ (best) };
}

/**
 * Render a QR to ANSI half-block characters for a terminal. Uses two matrix rows
 * per text row so the code stays square in a normal terminal cell aspect.
 * @param {string} text
 * @param {number} [quiet] quiet-zone width in modules
 * @returns {string}
 */
export function qrToTerminal(text, quiet = 2) {
  const { size, modules } = encodeQR(text);
  const n = size + quiet * 2;
  /** @param {number} r @param {number} c */
  const dark = (r, c) => {
    const rr = r - quiet;
    const cc = c - quiet;
    if (rr < 0 || cc < 0 || rr >= size || cc >= size) return false;
    return modules[rr][cc] === 1;
  };
  // Dark modules must render as the *dark* half-block on a light field.
  const WHITE = '\x1b[47m';
  const RESET = '\x1b[0m';
  const out = [];
  for (let r = 0; r < n; r += 2) {
    let line = WHITE;
    for (let c = 0; c < n; c++) {
      const top = dark(r, c);
      const bot = dark(r + 1, c);
      // Foreground is black-on-white: ▀ paints the top half dark.
      line += top && bot ? '\x1b[30m█' : top ? '\x1b[30m▀' : bot ? '\x1b[30m▄' : ' ';
    }
    out.push(line + RESET);
  }
  return out.join('\n');
}

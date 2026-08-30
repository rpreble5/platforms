#!/usr/bin/env node
/**
 * SVG -> accessory painter. Turns a Figma export drawn on
 * assets/accessories/TEMPLATE.svg into the same kind of hand-written canvas
 * painter the built-in accessories use — plain code to paste into the repo,
 * NO runtime loading of anything.
 *
 *   node tools/accessory-svg.js myhat.svg myhat
 *
 * prints two snippets: a painter for ACCESSORY_PAINTERS (shared/avatar.js)
 * and a registration line for ACCESSORIES (shared/palette.js).
 *
 * Understands the SVG Figma actually emits for flat artwork: <path> (all
 * commands, arcs included — they become cubics), <rect>, <circle>,
 * <ellipse>, <line>, <polygon>, <polyline>, with fill / stroke /
 * stroke-width / opacity / fill-opacity as attributes or inline style. A
 * <g id="guides"> group is ignored, so forgetting to delete the template's
 * guides costs nothing. Anything fancier (gradients, filters, masks,
 * images, live text) is rejected by name — outline text and flatten
 * effects in Figma first.
 *
 * Coordinates are emitted as fractions of the bean's body box (the
 * template's 16..76 x 16..108 rect), exactly how the hand-written painters
 * are built, so the result scales onto every body shape and sprite size.
 */

import { readFileSync } from 'node:fs';

// The template's geometry: frame 92x124, body box 60x92 at (16,16).
const BODY = { x: 16, y: 16, w: 60, h: 92 };

// ---------------------------------------------------------------- SVG bits

/** @param {string} src @returns {Array<Record<string, string> & {tag: string}>} */
export function parseElements(src) {
  // Drop the guides group wholesale, then read leaf elements in order.
  const cleaned = src.replace(/<g[^>]*id=["']guides["'][\s\S]*?<\/g>/g, '');
  for (const bad of ['linearGradient', 'radialGradient', 'filter', 'mask', 'clipPath', '<image', '<text', '<use']) {
    if (cleaned.includes(bad)) {
      throw new Error(`unsupported SVG feature: ${bad.replace('<', '')} — flatten/outline it in Figma first`);
    }
  }
  /** @type {Array<Record<string, string> & {tag: string}>} */
  const out = [];
  const re = /<(path|rect|circle|ellipse|line|polygon|polyline)\b([^>]*?)\/?>/g;
  let m;
  while ((m = re.exec(cleaned))) {
    /** @type {Record<string, string> & {tag: string}} */
    const el = { tag: m[1] };
    const attrs = m[2];
    const are = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*"([^"]*)"/g;
    let a;
    while ((a = are.exec(attrs))) el[a[1]] = a[2];
    // Figma sometimes writes style="fill:#abc;stroke:none"
    if (el.style) {
      for (const part of el.style.split(';')) {
        const [k, v] = part.split(':').map((s) => s?.trim());
        if (k && v && el[k] === undefined) el[k] = v;
      }
    }
    out.push(el);
  }
  if (!out.length) throw new Error('no drawable elements found in the SVG');
  return out;
}

/**
 * Parse an SVG path `d` into absolute segments of only M/L/C/Z — arcs and
 * every shorthand are resolved here, so the emitter stays trivial.
 * @param {string} d
 * @returns {Array<['M'|'L'|'C'|'Z', ...number[]]>}
 */
export function parsePathData(d) {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d*\.\d+|\d+)(?:e-?\d+)?/g) ?? [];
  /** @type {Array<['M'|'L'|'C'|'Z', ...number[]]>} */
  const segs = [];
  let i = 0;
  let cmd = '';
  let x = 0, y = 0;       // current point
  let sx = 0, sy = 0;     // subpath start
  let pcx = 0, pcy = 0;   // previous control point, for S/T reflection
  let prev = '';
  const num = () => {
    const t = tokens[i++];
    const n = Number(t);
    if (!Number.isFinite(n)) throw new Error(`bad number "${t}" in path data`);
    return n;
  };
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase() && cmd !== 'z' && cmd !== 'Z';
    const C = cmd.toUpperCase();
    switch (C) {
      case 'M': {
        const nx = num() + (rel ? x : 0);
        const ny = num() + (rel ? y : 0);
        segs.push(['M', nx, ny]);
        x = sx = nx; y = sy = ny;
        cmd = rel ? 'l' : 'L'; // subsequent pairs are implicit linetos
        break;
      }
      case 'L': {
        const nx = num() + (rel ? x : 0);
        const ny = num() + (rel ? y : 0);
        segs.push(['L', nx, ny]);
        x = nx; y = ny;
        break;
      }
      case 'H': {
        const nx = num() + (rel ? x : 0);
        segs.push(['L', nx, y]);
        x = nx;
        break;
      }
      case 'V': {
        const ny = num() + (rel ? y : 0);
        segs.push(['L', x, ny]);
        y = ny;
        break;
      }
      case 'C': {
        const c1x = num() + (rel ? x : 0), c1y = num() + (rel ? y : 0);
        const c2x = num() + (rel ? x : 0), c2y = num() + (rel ? y : 0);
        const nx = num() + (rel ? x : 0), ny = num() + (rel ? y : 0);
        segs.push(['C', c1x, c1y, c2x, c2y, nx, ny]);
        pcx = c2x; pcy = c2y; x = nx; y = ny;
        break;
      }
      case 'S': {
        const c1x = /[CS]/.test(prev) ? 2 * x - pcx : x;
        const c1y = /[CS]/.test(prev) ? 2 * y - pcy : y;
        const c2x = num() + (rel ? x : 0), c2y = num() + (rel ? y : 0);
        const nx = num() + (rel ? x : 0), ny = num() + (rel ? y : 0);
        segs.push(['C', c1x, c1y, c2x, c2y, nx, ny]);
        pcx = c2x; pcy = c2y; x = nx; y = ny;
        break;
      }
      case 'Q': case 'T': {
        let qx, qy;
        if (C === 'Q') {
          qx = num() + (rel ? x : 0); qy = num() + (rel ? y : 0);
        } else {
          qx = /[QT]/.test(prev) ? 2 * x - pcx : x;
          qy = /[QT]/.test(prev) ? 2 * y - pcy : y;
        }
        const nx = num() + (rel ? x : 0), ny = num() + (rel ? y : 0);
        // quadratic -> cubic
        segs.push(['C', x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y),
          nx + (2 / 3) * (qx - nx), ny + (2 / 3) * (qy - ny), nx, ny]);
        pcx = qx; pcy = qy; x = nx; y = ny;
        break;
      }
      case 'A': {
        const rx = num(), ry = num(), rot = num(), laf = num(), sf = num();
        const nx = num() + (rel ? x : 0), ny = num() + (rel ? y : 0);
        for (const c of arcToCubics(x, y, rx, ry, rot, laf, sf, nx, ny)) segs.push(c);
        x = nx; y = ny;
        break;
      }
      case 'Z': {
        segs.push(['Z']);
        x = sx; y = sy;
        break;
      }
      default:
        throw new Error(`unsupported path command "${cmd}"`);
    }
    prev = C;
  }
  return segs;
}

/**
 * Endpoint-parameterised SVG arc -> cubic beziers (the standard F.6.5
 * conversion, split into <=90° slices).
 * @param {number} x1 @param {number} y1 @param {number} rx @param {number} ry
 * @param {number} rotDeg @param {number} largeArc @param {number} sweep
 * @param {number} x2 @param {number} y2
 * @returns {Array<['C', number, number, number, number, number, number]>}
 */
function arcToCubics(x1, y1, rx, ry, rotDeg, largeArc, sweep, x2, y2) {
  if (rx === 0 || ry === 0 || (x1 === x2 && y1 === y2)) {
    return [['C', x1, y1, x2, y2, x2, y2]];
  }
  const phi = (rotDeg * Math.PI) / 180;
  const cosP = Math.cos(phi), sinP = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cosP * dx + sinP * dy;
  const y1p = -sinP * dx + cosP * dy;
  rx = Math.abs(rx); ry = Math.abs(ry);
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) { const s = Math.sqrt(lam); rx *= s; ry *= s; }
  const sign = largeArc !== sweep ? 1 : -1;
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const co = sign * Math.sqrt(Math.max(0, num / den));
  const cxp = (co * rx * y1p) / ry;
  const cyp = (-co * ry * x1p) / rx;
  const cx = cosP * cxp - sinP * cyp + (x1 + x2) / 2;
  const cy = sinP * cxp + cosP * cyp + (y1 + y2) / 2;
  const ang = (/** @type {number} */ ux, /** @type {number} */ uy,
    /** @type {number} */ vx, /** @type {number} */ vy) => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    let a = Math.acos(Math.max(-1, Math.min(1, dot / len)));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const th1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dth = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dth > 0) dth -= 2 * Math.PI;
  if (sweep && dth < 0) dth += 2 * Math.PI;

  const slices = Math.max(1, Math.ceil(Math.abs(dth) / (Math.PI / 2)));
  const delta = dth / slices;
  const t = (4 / 3) * Math.tan(delta / 4);
  /** @type {Array<['C', number, number, number, number, number, number]>} */
  const out = [];
  let th = th1;
  const pt = (/** @type {number} */ a) => {
    const px = rx * Math.cos(a), py = ry * Math.sin(a);
    return [cosP * px - sinP * py + cx, sinP * px + cosP * py + cy];
  };
  const drv = (/** @type {number} */ a) => {
    const px = -rx * Math.sin(a), py = ry * Math.cos(a);
    return [cosP * px - sinP * py, sinP * px + cosP * py];
  };
  for (let s = 0; s < slices; s++) {
    const th2 = th + delta;
    const [p1x, p1y] = pt(th);
    const [p2x, p2y] = pt(th2);
    const [d1x, d1y] = drv(th);
    const [d2x, d2y] = drv(th2);
    out.push(['C', p1x + t * d1x, p1y + t * d1y, p2x - t * d2x, p2y - t * d2y, p2x, p2y]);
    th = th2;
  }
  return out;
}

// ---------------------------------------------------------------- emitter

const fx = (/** @type {number} */ v) => {
  const u = (v - BODY.x) / BODY.w;
  return Math.abs(u) < 1e-4 ? '0' : `w * ${u.toFixed(4)}`;
};
const fy = (/** @type {number} */ v) => {
  const u = (v - BODY.y) / BODY.h;
  return Math.abs(u) < 1e-4 ? '0' : `h * ${u.toFixed(4)}`;
};

/** @param {Record<string, string> & {tag: string}} el @returns {string[]} path-building lines */
function shapeLines(el) {
  switch (el.tag) {
    case 'path': {
      return parsePathData(el.d ?? '').map((s) => {
        if (s[0] === 'M') return `g.moveTo(${fx(s[1])}, ${fy(s[2])});`;
        if (s[0] === 'L') return `g.lineTo(${fx(s[1])}, ${fy(s[2])});`;
        if (s[0] === 'C') {
          return `g.bezierCurveTo(${fx(s[1])}, ${fy(s[2])}, ${fx(s[3])}, ${fy(s[4])}, ${fx(s[5])}, ${fy(s[6])});`;
        }
        return 'g.closePath();';
      });
    }
    case 'rect': {
      const x = Number(el.x ?? 0), y = Number(el.y ?? 0);
      const w = Number(el.width), h = Number(el.height);
      const r = Number(el.rx ?? el.ry ?? 0);
      const rr = r ? `, w * ${(r / BODY.w).toFixed(4)}` : '';
      return [`g.roundRect(${fx(x)}, ${fy(y)}, w * ${(w / BODY.w).toFixed(4)}, h * ${(h / BODY.h).toFixed(4)}${rr});`];
    }
    case 'circle': case 'ellipse': {
      const cx = Number(el.cx ?? 0), cy = Number(el.cy ?? 0);
      const rx = Number(el.tag === 'circle' ? el.r : el.rx);
      const ry = Number(el.tag === 'circle' ? el.r : el.ry);
      return [`g.ellipse(${fx(cx)}, ${fy(cy)}, w * ${(rx / BODY.w).toFixed(4)}, h * ${(ry / BODY.h).toFixed(4)}, 0, 0, Math.PI * 2);`];
    }
    case 'line': {
      return [
        `g.moveTo(${fx(Number(el.x1 ?? 0))}, ${fy(Number(el.y1 ?? 0))});`,
        `g.lineTo(${fx(Number(el.x2 ?? 0))}, ${fy(Number(el.y2 ?? 0))});`,
      ];
    }
    case 'polygon': case 'polyline': {
      const pts = (el.points ?? '').match(/-?[\d.]+/g)?.map(Number) ?? [];
      /** @type {string[]} */
      const lines = [];
      for (let i = 0; i + 1 < pts.length; i += 2) {
        lines.push(`g.${i === 0 ? 'moveTo' : 'lineTo'}(${fx(pts[i])}, ${fy(pts[i + 1])});`);
      }
      if (el.tag === 'polygon') lines.push('g.closePath();');
      return lines;
    }
    default:
      return [];
  }
}

/**
 * @param {string} src the SVG text
 * @param {string} key the accessory key to generate
 * @returns {string} the painter function source
 */
export function convert(src, key) {
  if (!/^[a-z][a-z0-9]*$/.test(key)) {
    throw new Error('key must be lowercase letters/digits, starting with a letter');
  }
  const els = parseElements(src);
  /** @type {string[]} */
  const body = [];
  for (const el of els) {
    const fill = el.fill && el.fill !== 'none' ? el.fill : null;
    const strokeC = el.stroke && el.stroke !== 'none' ? el.stroke : null;
    if (!fill && !strokeC) continue;
    body.push('g.beginPath();');
    body.push(...shapeLines(el));
    const alpha = Number(el.opacity ?? 1) * Number(el['fill-opacity'] ?? 1);
    if (fill) {
      if (alpha < 1) body.push(`g.globalAlpha = ${alpha.toFixed(3)};`);
      body.push(`g.fillStyle = '${fill}';`, 'g.fill();');
      if (alpha < 1) body.push('g.globalAlpha = 1;');
    }
    if (strokeC) {
      const sw = Number(el['stroke-width'] ?? 1);
      body.push(
        `g.lineWidth = Math.max(1.5, w * ${(sw / BODY.w).toFixed(4)});`,
        "g.lineJoin = 'round';",
        `g.strokeStyle = '${strokeC}';`,
        'g.stroke();'
      );
    }
  }
  if (!body.length) throw new Error('nothing visible: every element had fill="none" and no stroke');
  return `  ${key}(g, w, h) {\n    ${body.join('\n    ')}\n  },`;
}

// ---------------------------------------------------------------- CLI

const [, , file, key] = process.argv;
if (file && key) {
  const painter = convert(readFileSync(file, 'utf8'), key);
  const label = key[0].toUpperCase() + key.slice(1);
  console.log('— paste into ACCESSORY_PAINTERS in shared/avatar.js —\n');
  console.log(painter);
  console.log('\n— paste into ACCESSORIES in shared/palette.js —\n');
  console.log(`  { key: '${key}', label: '${label}' },`);
  console.log('\nThen check it on /client/display/sprites-preview.html and run npm test.');
} else if (file || key) {
  console.error('usage: node tools/accessory-svg.js <file.svg> <key>');
  process.exit(1);
}

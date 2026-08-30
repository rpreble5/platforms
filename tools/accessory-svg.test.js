/**
 * The SVG -> painter converter: the "just a way to do it" pipeline for
 * accessories authored in Figma. These pin the parts that would silently
 * mangle artwork: path parsing (arcs included), coordinate mapping into
 * body-box fractions, the guides group being ignored, and the generated
 * code actually running as a DOM-free painter.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { convert, parseElements, parsePathData } from './accessory-svg.js';

const WRAP = (/** @type {string} */ inner) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 92 124">${inner}</svg>`;

test('the guides group is ignored wholesale', () => {
  const src = WRAP(
    '<g id="guides"><rect x="0" y="0" width="92" height="124" fill="#fff"/></g>' +
    '<circle cx="46" cy="16" r="6" fill="#e04f4f"/>'
  );
  const els = parseElements(src);
  assert.equal(els.length, 1);
  assert.equal(els[0].tag, 'circle');
});

test('path data resolves shorthands, relatives and arcs to M/L/C/Z', () => {
  const segs = parsePathData('m10 10 h20 v10 q5 5 10 0 a5 5 0 0 1 10 0 s5 10 10 10 t10 0 z');
  assert.ok(segs.every((s) => ['M', 'L', 'C', 'Z'].includes(s[0])));
  assert.deepEqual(segs[0], ['M', 10, 10]);
  assert.deepEqual(segs[1], ['L', 30, 10]);
  assert.equal(segs.at(-1)?.[0], 'Z');
  // the arc became at least one cubic that lands on its endpoint
  const cubics = segs.filter((s) => s[0] === 'C');
  assert.ok(cubics.length >= 4, 'quadratic, arc slices, S and T all became cubics');
});

test('an arc lands exactly on its endpoint after conversion', () => {
  const segs = parsePathData('M10 50 A20 20 0 0 1 50 50');
  const last = segs.at(-1);
  assert.ok(last && last[0] === 'C');
  assert.ok(Math.abs(/** @type {number} */ (last[5]) - 50) < 1e-6);
  assert.ok(Math.abs(/** @type {number} */ (last[6]) - 50) < 1e-6);
});

test('coordinates map into body-box fractions', () => {
  // body box x 16..76: an x of 46 is the exact centre -> w * 0.5
  const out = convert(WRAP('<circle cx="46" cy="16" r="6" fill="#abc"/>'), 'dot');
  assert.match(out, /ellipse\(w \* 0\.5000, 0,/);
  assert.match(out, /fillStyle = '#abc'/);
});

test('the generated painter runs against a bare recording stub', () => {
  const out = convert(WRAP(
    '<path d="M25 31 C19 22 19 10 27 3 Z" fill="#e04f4f" stroke="#2a2440" stroke-width="2.5"/>' +
    '<rect x="30" y="40" width="10" height="6" rx="2" fill="none" stroke="#111"/>'
  ), 'proto');
  /** @type {string[]} */
  const calls = [];
  const g = new Proxy({}, {
    get: (_t, p) => (/** @type {unknown[]} */ ...a) => { calls.push(String(p)); void a; },
    set: (_t, p) => { calls.push(`set:${String(p)}`); return true; },
  });
  // eslint-disable-next-line no-new-func
  const painter = new Function('return {' + out + '};')().proto;
  painter(g, 40, 56);
  assert.ok(calls.includes('bezierCurveTo'));
  assert.ok(calls.includes('fill'));
  assert.ok(calls.includes('roundRect'));
  assert.ok(calls.filter((c) => c === 'stroke').length >= 2);
});

test('gradients and live text are refused by name', () => {
  assert.throws(() => parseElements(WRAP('<linearGradient id="g"/><rect width="5" height="5"/>')),
    /flatten|outline/i);
  assert.throws(() => parseElements(WRAP('<text x="1" y="1">hi</text>')), /flatten|outline/i);
});

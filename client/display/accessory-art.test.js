/**
 * Accessory art data.
 *
 * These are cheap structural checks, and the reason they exist is that the
 * failure mode they catch is invisible: a typo in a key, or a fill role that
 * doesn't exist, produces an avatar with nothing on its head rather than an
 * error. Nobody notices until someone is squinting at a screen across a room
 * wondering where their crown went.
 *
 * The art module is deliberately DOM-free so it can be imported here at all.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { ACCESSORY_ART, ARTBOARD, FILL_ROLES } from './accessory-art.js';
import { ACCESSORIES } from '../../shared/palette.js';

test('every accessory in the palette has art, and vice versa', () => {
  const named = ACCESSORIES.map((a) => a.key).sort();
  const drawn = Object.keys(ACCESSORY_ART).sort();
  assert.deepEqual(drawn, named, 'palette and art disagree about which accessories exist');
});

test('every part declares a known fill role', () => {
  for (const [key, art] of Object.entries(ACCESSORY_ART)) {
    assert.ok(art.parts.length > 0, `${key} draws nothing`);
    for (const part of art.parts) {
      assert.ok(part.fill in FILL_ROLES, `${key}: unknown fill role "${part.fill}"`);
    }
  }
});

test('every path is plausible SVG path data', () => {
  // Not a full parser — just enough to catch a truncated paste or a stray
  // character, which otherwise fails silently inside Path2D.
  for (const [key, art] of Object.entries(ACCESSORY_ART)) {
    for (const part of art.parts) {
      assert.match(part.d, /^M[\s-]*[\d.]/, `${key}: path does not start with a moveto`);
      assert.match(part.d, /Z\s*$/i, `${key}: path is not closed`);
      assert.ok(
        !/[^MmLlHhVvCcSsQqTtAaZz0-9.,\s-]/.test(part.d),
        `${key}: path contains an illegal character`
      );
    }
  }
});

test('reach is declared, and matches which way the art points', () => {
  for (const [key, art] of Object.entries(ACCESSORY_ART)) {
    for (const side of ['top', 'left', 'right']) {
      const v = /** @type {any} */ (art.reach)[side];
      assert.equal(typeof v, 'number', `${key}: reach.${side} is not a number`);
      assert.ok(v >= 0, `${key}: reach.${side} is negative`);
    }

    // Bracket the declared reach between two bounds, because neither alone is
    // right. `onCurve` is how far the path definitely goes up, so declaring
    // less than that is an under-report and the clipping warning would miss it.
    // `hull` includes curve control points and arc radii, which the curve never
    // actually touches — so exceeding it means the number was guessed.
    const bounds = art.parts.map((p) => upwardBounds(p.d));
    const onCurve = Math.max(0, ...bounds.map((b) => b.onCurve));
    const hull = Math.max(0, ...bounds.map((b) => b.hull));
    assert.ok(
      art.reach.top >= onCurve - 0.5,
      `${key}: reach.top is ${art.reach.top} but the path reaches ${onCurve}`
    );
    assert.ok(
      art.reach.top <= hull + 0.5,
      `${key}: reach.top is ${art.reach.top}, beyond any point the art can reach (${hull})`
    );
  }
});

test('nothing is drawn so far off the artboard that it must be a mistake', () => {
  for (const [key, art] of Object.entries(ACCESSORY_ART)) {
    assert.ok(art.reach.top <= ARTBOARD, `${key} reaches ${art.reach.top} above the head`);
    assert.ok(art.reach.left <= ARTBOARD / 2, `${key} reaches ${art.reach.left} to the left`);
    assert.ok(art.reach.right <= ARTBOARD / 2, `${key} reaches ${art.reach.right} to the right`);
  }
});

/**
 * How far above y=0 a path goes, by two measures.
 *
 * `onCurve` counts only points the path actually passes through — segment
 * endpoints. `hull` also counts quadratic control points and arc radii, which
 * bound the curve without ever being reached. The true extreme sits between
 * them, which is enough to bracket a declared `reach` without implementing a
 * full curve solver.
 *
 * Only the commands the art actually uses are handled; anything else would be
 * caught by the illegal-character check above.
 *
 * @param {string} d
 * @returns {{onCurve: number, hull: number}}
 */
function upwardBounds(d) {
  const tokens = d.match(/[MmLlCcSsQqTtAaHhVvZz]|-?[\d.]+/g) ?? [];
  let top = 0;
  let hullTop = 0;
  /** @param {number} y */
  const onCurve = (y) => {
    top = Math.min(top, y);
    hullTop = Math.min(hullTop, y);
  };
  /** @param {number} y */
  const control = (y) => {
    hullTop = Math.min(hullTop, y);
  };

  let cmd = '';
  /** @type {number[]} */
  let args = [];
  const flush = () => {
    const n = args.length;
    if (cmd === 'M' || cmd === 'L' || cmd === 'T') {
      for (let i = 1; i < n; i += 2) onCurve(args[i]);
    } else if (cmd === 'V') {
      for (let i = 0; i < n; i += 1) onCurve(args[i]);
    } else if (cmd === 'Q') {
      for (let i = 0; i + 3 < n; i += 4) {
        control(args[i + 1]);
        onCurve(args[i + 3]);
      }
    } else if (cmd === 'C') {
      for (let i = 0; i + 5 < n; i += 6) {
        control(args[i + 1]);
        control(args[i + 3]);
        onCurve(args[i + 5]);
      }
    } else if (cmd === 'A') {
      // rx ry rot large sweep x y — the sweep can bulge by up to ry past the
      // endpoint, so that is the hull bound.
      for (let i = 0; i + 6 < n; i += 7) {
        onCurve(args[i + 6]);
        control(args[i + 6] - Math.abs(args[i + 1]));
      }
    }
    args = [];
  };

  for (const t of tokens) {
    if (/[A-Za-z]/.test(t)) {
      flush();
      cmd = t.toUpperCase();
      if (t !== cmd) throw new Error(`relative path command "${t}" is not supported`);
    } else {
      args.push(Number(t));
    }
  }
  flush();
  return { onCurve: -top, hull: -hullTop };
}

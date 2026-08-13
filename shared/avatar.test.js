/**
 * The shared bean renderer. It must stay importable OUTSIDE a browser — the
 * phone inlines it and the display imports it, and this test is what keeps
 * anyone from accidentally reaching for a DOM global inside it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { AVATAR_INK, EYES, avatarBodyPath, drawBean, shade } from './avatar.js';

/** A recording stub for CanvasRenderingContext2D — calls and style sets. */
function stubCtx() {
  /** @type {string[]} */
  const calls = [];
  /** @type {string[]} */
  const strokes = [];
  const ctx = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'calls') return calls;
        if (prop === 'strokes') return strokes;
        return (/** @type {unknown[]} */ ...a) => {
          calls.push(String(prop));
          void a;
        };
      },
      set(_t, prop, v) {
        calls.push(`set:${String(prop)}`);
        if (prop === 'strokeStyle') strokes.push(String(v));
        return true;
      },
    }
  );
  return /** @type {any} */ (ctx);
}

test('drawBean runs without any DOM, for every shape and finish', () => {
  for (const shape of ['egg', 'pill', 'loaf']) {
    for (const finish of ['flat', 'pastel']) {
      const cx = stubCtx();
      drawBean(cx, '#2fc98d', finish, 40, 56, shape);
      assert.ok(cx.calls.includes('fill'), `${shape}/${finish} fills`);
      assert.ok(cx.calls.includes('stroke'), `${shape}/${finish} strokes`);
      assert.ok(cx.calls.includes('arc'), `${shape}/${finish} has eyes`);
    }
  }
});

test('the two finishes are genuinely different renderings', () => {
  const flat = stubCtx();
  drawBean(flat, '#2fc98d', 'flat', 40, 56, 'pill');
  const pastel = stubCtx();
  drawBean(pastel, '#2fc98d', 'pastel', 40, 56, 'pill');

  assert.equal(flat.strokes[0], AVATAR_INK, 'flat outlines in theme ink');
  assert.notEqual(pastel.strokes[0], AVATAR_INK, 'pastel outlines in its own deep hue');
  assert.ok(pastel.calls.includes('clip'), 'pastel has the grounding shade');
  assert.ok(!flat.calls.includes('clip'), 'flat is one fill and one line');
  assert.ok(
    pastel.calls.filter((/** @type {string} */ c) => c === 'ellipse').length >= 3,
    'pastel draws the blush'
  );
});

test('eyes can be omitted for callers that draw them live', () => {
  const cx = stubCtx();
  drawBean(cx, '#2fc98d', 'flat', 40, 56, 'pill', false);
  assert.ok(!cx.calls.includes('arc'), 'no baked eyes');
});

test('bodyPath accepts any shape string without throwing', () => {
  for (const shape of ['egg', 'pill', 'loaf', 'mystery', '']) {
    const cx = stubCtx();
    avatarBodyPath(cx, 40, 56, shape);
    assert.ok(cx.calls.includes('closePath'), `${shape || '(empty)'} closes its path`);
  }
});

test('shade clamps and mixes in both directions', () => {
  assert.equal(shade('#000000', 1), 'rgb(255,255,255)');
  assert.equal(shade('#ffffff', -1), 'rgb(0,0,0)');
  assert.equal(shade('#2fc98d', 0), 'rgb(47,201,141)');
  assert.equal(EYES.color, AVATAR_INK, 'eye ink matches the theme ink');
});

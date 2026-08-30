/**
 * The shared bean renderer. It must stay importable OUTSIDE a browser — the
 * phone inlines it and the display imports it, and this test is what keeps
 * anyone from accidentally reaching for a DOM global inside it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { AVATAR_INK, EYES, accessoryHidesEyes, avatarBodyPath, drawAccessory, drawBean, shade } from './avatar.js';
import { ACCESSORIES, FINISHES } from './palette.js';

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
    for (const { key: finish } of FINISHES) {
      const cx = stubCtx();
      drawBean(cx, '#2fc98d', finish, 40, 56, shape);
      assert.ok(cx.calls.includes('fill'), `${shape}/${finish} fills`);
      assert.ok(cx.calls.includes('stroke'), `${shape}/${finish} strokes`);
      assert.ok(cx.calls.includes('arc'), `${shape}/${finish} has eyes`);
    }
  }
});

test('every finish is a genuinely different rendering', () => {
  // Signature = the full ordered trace of calls and stroke styles; if two
  // finishes produce identical traces, one of them is dead weight.
  const sig = (/** @type {string} */ finish) => {
    const cx = stubCtx();
    drawBean(cx, '#2fc98d', finish, 40, 56, 'pill');
    return JSON.stringify([cx.calls, cx.strokes]);
  };
  const seen = new Map();
  for (const { key } of FINISHES) {
    const s = sig(key);
    assert.ok(!seen.has(s), `${key} renders identically to ${seen.get(s)}`);
    seen.set(s, key);
  }

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

  const ghost = stubCtx();
  drawBean(ghost, '#2fc98d', 'ghost', 40, 56, 'pill');
  assert.notEqual(ghost.strokes[0], AVATAR_INK, 'ghost carries identity in its outline');
  const dipped = stubCtx();
  drawBean(dipped, '#2fc98d', 'dipped', 40, 56, 'pill');
  assert.ok(dipped.calls.includes('clip'), 'dipped clips the dunk band inside the body');
  assert.ok(dipped.calls.includes('fillRect'), 'dipped paints a hard band');
  const glow = stubCtx();
  drawBean(glow, '#2fc98d', 'glow', 40, 56, 'pill');
  assert.ok(glow.calls.includes('set:shadowBlur'), 'glow bakes an aura');
  assert.ok(glow.calls.includes('restore'), 'glow cleans its shadow state up');
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

test('every accessory in the palette has a painter, and it runs DOM-free', () => {
  for (const { key } of ACCESSORIES) {
    const cx = stubCtx();
    drawBean(cx, '#2fc98d', 'flat', 40, 56, 'pill', true, key);
    assert.ok(cx.calls.includes('fill'), `${key} draws`);
    if (key !== 'none') {
      // The painter actually painted something beyond the body: body+eyes
      // alone produce exactly two fills (body, eyes).
      const fills = cx.calls.filter((/** @type {string} */ c) => c === 'fill').length;
      assert.ok(fills > 2 || cx.calls.filter((/** @type {string} */ c) => c === 'stroke').length > 1,
        `${key} adds pixels beyond the bare bean`);
    }
  }
});

test('only the eye-covering accessories suppress the baked eyes', () => {
  // Shades cover the eyes; the bandit mask paints its own paper pair on
  // the band. Everything else leaves the standard eyes alone.
  const covering = ['sunglasses', 'bandit'];
  for (const key of covering) assert.ok(accessoryHidesEyes(key), `${key} hides eyes`);
  for (const { key } of ACCESSORIES) {
    if (!covering.includes(key)) assert.ok(!accessoryHidesEyes(key), `${key} leaves eyes alone`);
  }
});

test('drawAccessory ignores unknown keys instead of crashing', () => {
  const cx = stubCtx();
  drawAccessory(cx, 'jetpack', 40, 56);
  assert.equal(cx.calls.length, 0, 'nothing drawn, nothing thrown');
});

test('shade clamps and mixes in both directions', () => {
  assert.equal(shade('#000000', 1), 'rgb(255,255,255)');
  assert.equal(shade('#ffffff', -1), 'rgb(0,0,0)');
  assert.equal(shade('#2fc98d', 0), 'rgb(47,201,141)');
  assert.equal(EYES.color, AVATAR_INK, 'eye ink matches the theme ink');
});

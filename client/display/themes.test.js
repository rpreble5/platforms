/**
 * Theme data sanity. The drawing is judged by eye on /display; what a test
 * can hold still is the data contract and the rotation policy.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { GLASS_FAMILIES, WAYS, activeWay, glassFam, setRound, setTheme, themeName, wayFor } from './themes.js';

const HEX = /^#[0-9a-f]{6}$/;

test('every colourway is complete, valid, and distinct', () => {
  const fields = /** @type {const} */ (['edge', 'face', 'top', 'text', 'fBody', 'fTop', 'fEdge']);
  const keys = new Set();
  for (const w of WAYS) {
    keys.add(w.key);
    for (const f of fields) {
      assert.match(/** @type {any} */ (w)[f], HEX, `${w.key}.${f}`);
    }
  }
  assert.equal(keys.size, WAYS.length, 'no duplicate colourway keys');
});

test('rotation is deterministic, cycles the table, and rests on teal', () => {
  assert.equal(wayFor(0), WAYS[0]);
  assert.equal(wayFor(1), WAYS[1]);
  assert.equal(wayFor(WAYS.length), WAYS[0], 'wraps around');
  assert.equal(wayFor(7), wayFor(7), 'same question, same colours — restarts replay identically');
  assert.equal(wayFor(-1).key, 'teal', 'lobby and showdown rest on teal');

  setRound(2);
  assert.equal(activeWay(), WAYS[2]);
  setRound(-1);
  assert.equal(activeWay().key, 'teal');
});

test('unknown themes fall back to glass, the default', () => {
  setTheme('dusk');
  assert.equal(themeName(), 'dusk');
  setTheme('terrazzo');
  assert.equal(themeName(), 'terrazzo');
  setTheme('lava-lamp');
  assert.equal(themeName(), 'glass');
  setTheme(undefined);
  assert.equal(themeName(), 'glass');
});

test('every glass family name is a theme alias and ordinary glass resets to blanc', () => {
  for (const family of Object.keys(GLASS_FAMILIES)) {
    if (family === 'dusk') continue; // dusk names the night THEME, not an alias
    setTheme(family);
    assert.equal(themeName(), 'glass', family);
    assert.equal(glassFam().key, family);
  }
  setTheme('glass');
  assert.equal(glassFam().key, 'blanc', 'blanc is the resting family');
});

test('palette families bound their hue drift; rainbow families leave it open', () => {
  for (const key of ['sorbet', 'lagoon', 'highlighter', 'duotone']) {
    const f = GLASS_FAMILIES[key];
    assert.ok(f, key);
    const drift = f.hueDrift ?? 0;
    assert.ok(drift > 0 && drift < 180, `${key} holds its palette in a band`);
    assert.ok(f.light, `${key} is a light family (ink text)`);
  }
  assert.equal(GLASS_FAMILIES.blanc.hueDrift, undefined, 'blanc rides the full rainbow');
  assert.equal(GLASS_FAMILIES.noir.hueDrift, undefined, 'noir rides the full rainbow');
});

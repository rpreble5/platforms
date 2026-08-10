/**
 * Identity assignment. The invariant under test throughout: every player has a
 * distinct (colour, hat) pair, no matter what anyone asks for. That pair is the
 * only way a player finds themselves on a screen with thirty avatars on it, so
 * a duplicate is not a cosmetic bug.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { Roster, sanitizeName } from './roster.js';
import { COLORS, HATS } from '../shared/palette.js';

/** @param {Roster} r @param {number} n */
function joinMany(r, n) {
  return Array.from({ length: n }, () => {
    const res = r.resolve(undefined, undefined);
    assert.ok(res.ok);
    return /** @type {any} */ (res).record;
  });
}

/** @param {Roster} r */
function looks(r) {
  return [...r.byId.values()].map((p) => `${p.colorIndex}:${p.hatIndex}`);
}

test('auto-assigned looks are all distinct, right up to the cap', () => {
  const r = new Roster();
  joinMany(r, 40);
  assert.equal(new Set(looks(r)).size, 40);
});

test('the first twelve players get twelve different colours', () => {
  const r = new Roster();
  const players = joinMany(r, COLORS.length);
  assert.equal(new Set(players.map((p) => p.colorIndex)).size, COLORS.length);
});

test('a chosen colour is honoured, and the hat comes from the server', () => {
  const r = new Roster();
  const [a, b] = joinMany(r, 2);

  r.setLook(a.id, { name: 'Ada', colorIndex: 5 });
  r.setLook(b.id, { name: 'Ben', colorIndex: 5 });

  assert.equal(a.colorIndex, 5);
  assert.equal(b.colorIndex, 5, 'both got the colour they asked for');
  assert.notEqual(a.hatIndex, b.hatIndex, 'and were separated by hat');
});

test('a colour whose hats are all taken pushes the next player to a neighbour', () => {
  const r = new Roster();
  const players = joinMany(r, HATS.length + 1);
  for (const p of players) r.setLook(p.id, { colorIndex: 3 });

  const got = players.map((p) => p.colorIndex);
  assert.equal(got.filter((c) => c === 3).length, HATS.length, 'four fit in one colour');
  assert.notEqual(got[HATS.length], 3, 'the fifth was moved');
  assert.equal(new Set(looks(r)).size, players.length);
});

test('freeByColor reports what the picker greys out', () => {
  const r = new Roster();
  const players = joinMany(r, HATS.length);
  for (const p of players) r.setLook(p.id, { colorIndex: 7 });

  const free = r.freeByColor();
  assert.equal(free.length, COLORS.length);
  assert.equal(free[7], 0, 'the exhausted colour reads as full');
  assert.ok(free.every((n) => n >= 0));
  assert.equal(
    free.reduce((a, b) => a + b, 0),
    COLORS.length * HATS.length - players.length
  );
});

test('changing colour releases the old slot', () => {
  const r = new Roster();
  const [a] = joinMany(r, 1);
  r.setLook(a.id, { colorIndex: 2 });
  const before = r.freeByColor();
  r.setLook(a.id, { colorIndex: 9 });
  const after = r.freeByColor();

  assert.equal(after[2], before[2] + 1, 'the colour they left has a slot back');
  assert.equal(after[9], before[9] - 1);
});

test('an untyped name follows the look; a typed one does not', () => {
  const r = new Roster();
  const [a, b] = joinMany(r, 2);

  r.setLook(a.id, { colorIndex: 4 });
  assert.equal(a.name, 'Jade', 'auto name tracks the colour');
  r.setLook(a.id, { colorIndex: 0 });
  assert.equal(a.name, 'Ember');

  r.setLook(b.id, { name: 'Ada', colorIndex: 4 });
  assert.equal(b.name, 'Ada');
  r.setLook(b.id, { colorIndex: 6 });
  assert.equal(b.name, 'Ada', 'a chosen name survives a colour change');
});

test('clearing the name field goes back to an automatic one', () => {
  const r = new Roster();
  const [a] = joinMany(r, 1);
  r.setLook(a.id, { name: 'Ada' });
  r.setLook(a.id, { name: '   ' });
  assert.equal(a.named, false);
  assert.ok(a.name.length > 0, 'never left blank');
});

test('reconnecting with the same token keeps the look and the name', () => {
  const r = new Roster();
  const first = r.resolve(undefined, undefined);
  assert.ok(first.ok);
  const rec = /** @type {any} */ (first).record;
  r.setLook(rec.id, { name: 'Ada', colorIndex: 8 });
  r.disconnect(rec.id);

  const again = r.resolve(rec.token, undefined);
  assert.ok(again.ok);
  const back = /** @type {any} */ (again).record;
  assert.equal(back.id, rec.id);
  assert.equal(back.name, 'Ada');
  assert.equal(back.colorIndex, 8);
  assert.equal(back.connected, true);
});

test('a disconnected player keeps their slot reserved', () => {
  const r = new Roster();
  const [a] = joinMany(r, 1);
  const before = r.freeByColor()[a.colorIndex];
  r.disconnect(a.id);
  assert.equal(r.freeByColor()[a.colorIndex], before, 'still theirs to come back to');
});

test('setLook on an unknown player is a no-op, not a crash', () => {
  const r = new Roster();
  assert.equal(r.setLook(999, { name: 'nobody' }), null);
});

test('names are trimmed, capped, and stripped of control characters', () => {
  assert.equal(sanitizeName('  Ada  Lovelace  '), 'Ada Lovelace');
  assert.equal(sanitizeName('Ada‮evil'), 'Adaevil');
  assert.equal(sanitizeName('x'.repeat(40)).length, 12);
});

test('publicList exposes the look but never the token', () => {
  const r = new Roster();
  const [a] = joinMany(r, 1);
  const [row] = r.publicList();
  assert.equal(row.id, a.id);
  assert.equal(row.color, a.color);
  assert.equal(/** @type {any} */ (row).token, undefined);
});

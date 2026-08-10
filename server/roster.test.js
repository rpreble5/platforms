/**
 * Identity assignment. The invariant under test throughout: every player has a
 * distinct (colour, accessory) pair, no matter what anyone asks for. That pair
 * is the only way a player finds themselves on a screen with thirty avatars on
 * it, so a duplicate is not a cosmetic bug.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { Roster, sanitizeName } from './roster.js';
import { COHORTS, COLORS, POOL_SIZE, poolFor } from '../shared/palette.js';

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

test('looks stay unique with all three years in the room', () => {
  const r = new Roster();
  const players = joinMany(r, 36);
  players.forEach((p, i) => r.setLook(p.id, { cohortIndex: i % COHORTS.length }));
  assert.equal(new Set(looks(r)).size, 36);
  for (const p of players) {
    assert.ok(poolFor(p.cohortIndex).includes(p.hatIndex), 'accessory is inside its own year');
  }
});

test('a chosen colour is honoured, and the accessory moves instead', () => {
  const r = new Roster();
  const [a, b] = joinMany(r, 2);

  r.setLook(a.id, { name: 'Ada', cohortIndex: 0, colorIndex: 5, hatIndex: poolFor(0)[2] });
  r.setLook(b.id, { name: 'Ben', cohortIndex: 0, colorIndex: 5, hatIndex: poolFor(0)[2] });

  assert.equal(a.hatIndex, poolFor(0)[2], 'first player got exactly what they asked for');
  assert.equal(a.colorIndex, 5);
  assert.equal(b.colorIndex, 5, 'the second kept the colour, which is the stronger signal');
  assert.notEqual(b.hatIndex, a.hatIndex, 'and gave up the accessory instead');
});

test('a colour whose accessories are all taken pushes the next player to a neighbour', () => {
  const r = new Roster();
  const players = joinMany(r, POOL_SIZE + 1);
  for (const p of players) r.setLook(p.id, { cohortIndex: 1, colorIndex: 3 });

  const got = players.map((p) => p.colorIndex);
  assert.equal(got.filter((c) => c === 3).length, POOL_SIZE, 'four fit in one colour');
  assert.notEqual(got[POOL_SIZE], 3, 'the fifth was moved');
  assert.equal(new Set(looks(r)).size, players.length);
});

test('changing year swaps the accessory for one that exists in the new pool', () => {
  const r = new Roster();
  const [a] = joinMany(r, 1);
  r.setLook(a.id, { cohortIndex: 0 });
  assert.ok(poolFor(0).includes(a.hatIndex));

  r.setLook(a.id, { cohortIndex: 2 });
  assert.equal(a.cohortIndex, 2);
  assert.ok(poolFor(2).includes(a.hatIndex), 'no PGY1 accessory left on a PGY3');
});

test('freeByColor is scoped to one year', () => {
  const r = new Roster();
  const players = joinMany(r, POOL_SIZE);
  for (const p of players) r.setLook(p.id, { cohortIndex: 0, colorIndex: 7 });

  assert.equal(r.freeByColor(0)[7], 0, 'that colour is full for PGY1');
  assert.equal(r.freeByColor(2)[7], POOL_SIZE, 'and untouched for PGY3');
  assert.equal(r.freeByColor(0).length, COLORS.length);
  assert.ok(r.freeByColor(0).every((n) => n >= 0));
});

test('changing colour releases the old slot', () => {
  const r = new Roster();
  const [a] = joinMany(r, 1);
  r.setLook(a.id, { cohortIndex: 1, colorIndex: 2 });
  const before = r.freeByColor(1);
  r.setLook(a.id, { colorIndex: 9 });
  const after = r.freeByColor(1);

  assert.equal(after[2], before[2] + 1, 'the colour they left has a slot back');
  assert.equal(after[9], before[9] - 1);
});

test('an untyped name follows the look; a typed one does not', () => {
  const r = new Roster();
  const [a, b] = joinMany(r, 2);

  r.setLook(a.id, { cohortIndex: 2, colorIndex: 4, hatIndex: poolFor(2)[0] });
  assert.equal(a.name, 'Jade Crown', 'auto name tracks the look');
  r.setLook(a.id, { colorIndex: 0 });
  assert.equal(a.name, 'Ember Crown');

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

test('a new player has no year until they pick one', () => {
  const r = new Roster();
  const [a] = joinMany(r, 1);
  assert.equal(a.cohortSet, false, 'the phone needs to know the card still has a question');
  r.setLook(a.id, { cohortIndex: 0 });
  assert.equal(a.cohortSet, true);
});

test('reconnecting with the same token keeps the whole look', () => {
  const r = new Roster();
  const first = r.resolve(undefined, undefined);
  assert.ok(first.ok);
  const rec = /** @type {any} */ (first).record;
  r.setLook(rec.id, { name: 'Ada', cohortIndex: 2, colorIndex: 8, hatIndex: poolFor(2)[1] });
  r.disconnect(rec.id);

  const again = r.resolve(rec.token, undefined);
  assert.ok(again.ok);
  const back = /** @type {any} */ (again).record;
  assert.equal(back.id, rec.id);
  assert.equal(back.name, 'Ada');
  assert.equal(back.colorIndex, 8);
  assert.equal(back.cohortIndex, 2);
  assert.equal(back.hatIndex, poolFor(2)[1]);
  assert.equal(back.cohortSet, true, 'not made to pick their year again');
  assert.equal(back.connected, true);
});

test('a disconnected player keeps their slot reserved', () => {
  const r = new Roster();
  const [a] = joinMany(r, 1);
  const before = r.freeByColor(a.cohortIndex)[a.colorIndex];
  r.disconnect(a.id);
  assert.equal(r.freeByColor(a.cohortIndex)[a.colorIndex], before, 'still theirs to come back to');
});

test('a nonsense year or accessory is clamped, not obeyed', () => {
  const r = new Roster();
  const [a] = joinMany(r, 1);
  r.setLook(a.id, { cohortIndex: 99, hatIndex: 999 });
  assert.ok(a.cohortIndex >= 0 && a.cohortIndex < COHORTS.length);
  assert.ok(poolFor(a.cohortIndex).includes(a.hatIndex));
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
  assert.equal(row.cohortIndex, a.cohortIndex);
  assert.equal(/** @type {any} */ (row).token, undefined);
});

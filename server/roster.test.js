/**
 * Identity assignment. The invariant under test throughout: every player has a
 * distinct (colour, accessory) pair, no matter what anyone asks for. That pair
 * is the only way a player finds themselves on a screen with thirty avatars on
 * it, so a duplicate is not a cosmetic bug.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { Roster, sanitizeName } from './roster.js';
import { COHORTS, COLORS, PATTERNS, POOL_SIZE, SLOTS_PER_COLOR, poolFor } from '../shared/palette.js';

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
  return [...r.byId.values()].map((p) => `${p.colorIndex}:${p.hatIndex}:${p.patternIndex}`);
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

test('an uncontested request comes back exactly as asked', () => {
  const r = new Roster();
  const [a] = joinMany(r, 1);
  r.setLook(a.id, { cohortIndex: 0, colorIndex: 5, hatIndex: poolFor(0)[2], patternIndex: 3 });
  assert.equal(a.colorIndex, 5);
  assert.equal(a.hatIndex, poolFor(0)[2]);
  assert.equal(a.patternIndex, 3);
});

test('a collision gives up the pattern first, keeping colour and accessory', () => {
  const r = new Roster();
  const [a, b] = joinMany(r, 2);
  const want = { cohortIndex: 0, colorIndex: 5, hatIndex: poolFor(0)[2], patternIndex: 1 };

  r.setLook(a.id, { name: 'Ada', ...want });
  r.setLook(b.id, { name: 'Ben', ...want });

  assert.equal(b.colorIndex, 5, 'colour survives — the strongest signal');
  assert.equal(b.hatIndex, poolFor(0)[2], 'accessory survives too');
  assert.notEqual(b.patternIndex, a.patternIndex, 'the pattern is what moved');
});

test('the accessory only moves once every pattern in that pair is gone', () => {
  const r = new Roster();
  const players = joinMany(r, PATTERNS.length + 1);
  const want = { cohortIndex: 0, colorIndex: 5, hatIndex: poolFor(0)[2] };
  for (const p of players) r.setLook(p.id, want);

  const sameHat = players.filter((p) => p.hatIndex === want.hatIndex);
  assert.equal(sameHat.length, PATTERNS.length, 'four patterns fit on one accessory');
  assert.equal(players[PATTERNS.length].colorIndex, 5, 'and the colour still held');
  assert.notEqual(players[PATTERNS.length].hatIndex, want.hatIndex, 'the accessory moved');
  assert.equal(new Set(looks(r)).size, players.length);
});

test('the colour moves only when a whole colour is exhausted', () => {
  // Phrased against however many slots a colour actually holds, and capped at
  // the roster limit — POOL_SIZE is expected to grow to 12, which would put
  // SLOTS_PER_COLOR above the 40-player cap and make a literal
  // "fill it then add one more" test impossible to run.
  const r = new Roster();
  const want = Math.min(SLOTS_PER_COLOR + 1, 40);
  const players = joinMany(r, want);
  for (const p of players) r.setLook(p.id, { cohortIndex: 1, colorIndex: 3 });

  const inColour = players.filter((p) => p.colorIndex === 3).length;
  assert.equal(
    inColour,
    Math.min(SLOTS_PER_COLOR, want),
    'everyone who fits in the colour got it'
  );
  if (want > SLOTS_PER_COLOR) {
    assert.notEqual(players[SLOTS_PER_COLOR].colorIndex, 3, 'the one that did not fit moved');
  }
  assert.equal(new Set(looks(r)).size, players.length);
});

test('a full room of one colour and one accessory still has no duplicates', () => {
  const r = new Roster();
  const players = joinMany(r, 40);
  for (const p of players) r.setLook(p.id, { cohortIndex: 2, colorIndex: 0, hatIndex: poolFor(2)[0] });
  assert.equal(new Set(looks(r)).size, 40, 'the worst case anyone can actually cause');
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
  const players = joinMany(r, SLOTS_PER_COLOR);
  for (const p of players) r.setLook(p.id, { cohortIndex: 0, colorIndex: 7 });

  assert.equal(r.freeByColor(0)[7], 0, 'that colour is full for PGY1');
  assert.equal(r.freeByColor(2)[7], SLOTS_PER_COLOR, 'and untouched for PGY3');
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

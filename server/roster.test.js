/**
 * Identity assignment. The invariant under test throughout: every player has a
 * distinct (colour, accessory) pair, no matter what anyone asks for. That pair
 * is the only way a player finds themselves on a screen with thirty avatars on
 * it, so a duplicate is not a cosmetic bug.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { Roster, sanitizeName } from './roster.js';
import { COHORTS, COLORS, FINISHES, LOOK_COUNT, SLOTS_PER_COLOR } from '../shared/palette.js';

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
  return [...r.byId.values()].map((p) => `${p.cohortIndex}:${p.colorIndex}:${p.finishIndex}`);
}

test('auto-assigned looks are all distinct while the cohort has capacity', () => {
  // 12 colours x 2 finishes = 24 looks per cohort. Every player up to that
  // point must be unique; past it, joins still succeed as duplicates rather
  // than turning anyone away — 25+ players of one single year is beyond any
  // realistic room, and name labels + find-me carry identity from there.
  const r = new Roster();
  joinMany(r, LOOK_COUNT);
  assert.equal(new Set(looks(r)).size, LOOK_COUNT, 'every look distinct at capacity');

  joinMany(r, 40 - LOOK_COUNT);
  assert.equal(r.byId.size, 40, 'nobody is refused past capacity');
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
});

test('an uncontested request comes back exactly as asked', () => {
  const r = new Roster();
  const [a] = joinMany(r, 1);
  r.setLook(a.id, { cohortIndex: 0, colorIndex: 5, finishIndex: 1 });
  assert.equal(a.colorIndex, 5);
  assert.equal(a.finishIndex, 1);
  assert.equal(a.finish, 'pastel');
});

test('a collision gives up the finish first, keeping the colour', () => {
  const r = new Roster();
  const [a, b] = joinMany(r, 2);
  const want = { cohortIndex: 0, colorIndex: 5, finishIndex: 1 };

  r.setLook(a.id, { name: 'Ada', ...want });
  r.setLook(b.id, { name: 'Ben', ...want });

  assert.equal(b.colorIndex, 5, 'colour survives — the strongest signal');
  assert.notEqual(b.finishIndex, a.finishIndex, 'the finish is what moved');
});

test('the colour moves only when both its finishes are gone', () => {
  const r = new Roster();
  const players = joinMany(r, FINISHES.length + 1);
  const want = { cohortIndex: 0, colorIndex: 5 };
  for (const p of players) r.setLook(p.id, want);

  const inColour = players.filter((p) => p.colorIndex === 5);
  assert.equal(inColour.length, FINISHES.length, 'both finishes fit in the colour');
  assert.notEqual(players[FINISHES.length].colorIndex, 5, 'the one that did not fit moved');
  assert.equal(new Set(looks(r)).size, players.length);
});

test('the same colour and finish is free to players in different years', () => {
  // Cross-year, the body shape already separates the pair — an egg and a loaf
  // in jade pastel are not confusable — so only same-year players contend.
  const r = new Roster();
  const [a, b] = joinMany(r, 2);
  r.setLook(a.id, { cohortIndex: 0, colorIndex: 4, finishIndex: 1 });
  r.setLook(b.id, { cohortIndex: 2, colorIndex: 4, finishIndex: 1 });
  assert.equal(a.colorIndex, 4);
  assert.equal(b.colorIndex, 4, 'no contention across years');
  assert.equal(b.finishIndex, 1);
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

  r.setLook(a.id, { cohortIndex: 2, colorIndex: 4 });
  assert.equal(a.name, 'Jade Loaf', 'auto name tracks colour and year');
  r.setLook(a.id, { colorIndex: 0 });
  assert.equal(a.name, 'Ember Loaf');
  r.setLook(a.id, { cohortIndex: 0 });
  assert.equal(a.name, 'Ember Egg', 'and follows a year change');

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
  r.setLook(rec.id, { name: 'Ada', cohortIndex: 2, colorIndex: 8, finishIndex: 1 });
  r.disconnect(rec.id);

  const again = r.resolve(rec.token, undefined);
  assert.ok(again.ok);
  const back = /** @type {any} */ (again).record;
  assert.equal(back.id, rec.id);
  assert.equal(back.name, 'Ada');
  assert.equal(back.colorIndex, 8);
  assert.equal(back.cohortIndex, 2);
  assert.equal(back.finishIndex, 1);
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

test('a nonsense year or finish is clamped, not obeyed', () => {
  const r = new Roster();
  const [a] = joinMany(r, 1);
  r.setLook(a.id, { cohortIndex: 99, finishIndex: 999 });
  assert.ok(a.cohortIndex >= 0 && a.cohortIndex < COHORTS.length);
  assert.ok(a.finishIndex >= 0 && a.finishIndex < FINISHES.length);
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

test('a serialize/hydrate round trip survives a server restart', () => {
  // The reconnect story across a Node restart: the phone still has its token,
  // the display still has scores under the old player ids, and the rebooted
  // roster has to reconnect the two.
  const r = new Roster();
  const [a, b] = joinMany(r, 2);
  r.setLook(a.id, { name: 'Ada', cohortIndex: 2, colorIndex: 8, finishIndex: 1 });

  const fresh = new Roster();
  assert.equal(fresh.hydrate(JSON.parse(JSON.stringify(r.serialize()))), 2);

  for (const rec of fresh.byId.values()) {
    assert.equal(rec.connected, false, 'a snapshot cannot vouch for a live connection');
  }

  const back = fresh.resolve(a.token, undefined);
  assert.ok(back.ok);
  const rec = /** @type {any} */ (back).record;
  assert.equal(rec.id, a.id, 'same id, so the display-side score still belongs to them');
  assert.equal(rec.name, 'Ada');
  assert.equal(rec.colorIndex, 8);
  assert.equal(rec.cohortIndex, 2);
  assert.equal(rec.cohortSet, true, 'not made to pick their year again');
  assert.equal(rec.connected, true);
  assert.equal(/** @type {any} */ (back).isNew, false, 'a rejoin, not a new player');
  assert.ok(fresh.byId.has(b.id), 'the player who has not rejoined yet keeps their slot');
});

test('a hydrated roster never re-issues a restored id or look', () => {
  const r = new Roster();
  const players = joinMany(r, 3);

  const fresh = new Roster();
  fresh.hydrate(JSON.parse(JSON.stringify(r.serialize())));

  const nova = fresh.resolve(undefined, undefined);
  assert.ok(nova.ok);
  const rec = /** @type {any} */ (nova).record;
  assert.ok(
    players.every((p) => p.id !== rec.id),
    'a brand-new join must not collide with a restored id'
  );
  assert.equal(new Set(looks(fresh)).size, 4, 'restored looks stay claimed');
});

test('hydrate degrades to an empty roster on garbage, never a crash', () => {
  for (const junk of [null, 42, 'nope', {}, { players: 'x' }, { players: [null, { id: 'a' }, { id: 1 }] }]) {
    const r = new Roster();
    assert.equal(r.hydrate(junk), 0, `restored nothing from ${JSON.stringify(junk)}`);
    const res = r.resolve(undefined, undefined);
    assert.ok(res.ok, 'and the roster still works');
  }
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

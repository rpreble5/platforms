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

test('auto-assigned colours are all distinct while the cohort has capacity', () => {
  // One claim per colour per year, twelve per cohort. Every player up to
  // that point gets a unique colour; past it, joins still succeed as
  // duplicates rather than turning anyone away — a 13th player of one single
  // year is beyond the real room, and name labels + find-me carry identity
  // from there.
  const r = new Roster();
  const players = joinMany(r, LOOK_COUNT);
  assert.equal(
    new Set(players.map((p) => p.colorIndex)).size,
    LOOK_COUNT,
    'every colour distinct at capacity'
  );

  joinMany(r, 40 - LOOK_COUNT);
  assert.equal(r.byId.size, 40, 'nobody is refused past capacity');
});

test('the first twelve players get twelve different colours', () => {
  const r = new Roster();
  const players = joinMany(r, COLORS.length);
  assert.equal(new Set(players.map((p) => p.colorIndex)).size, COLORS.length);
});

test('colours stay unique within every year with all three in the room', () => {
  const r = new Roster();
  const players = joinMany(r, 36);
  players.forEach((p, i) => r.setLook(p.id, { cohortIndex: i % COHORTS.length }));
  for (let c = 0; c < COHORTS.length; c++) {
    const inYear = players.filter((p) => p.cohortIndex === c);
    assert.equal(
      new Set(inYear.map((p) => p.colorIndex)).size,
      inYear.length,
      `every ${COHORTS[c].label} colour distinct`
    );
  }
});

test('an uncontested request comes back exactly as asked', () => {
  const r = new Roster();
  const [a] = joinMany(r, 1);
  r.setLook(a.id, { cohortIndex: 0, colorIndex: 5, finishIndex: 1 });
  assert.equal(a.colorIndex, 5);
  assert.equal(a.finishIndex, 1);
  assert.equal(a.finish, 'pastel');
});

test('a contested colour slides to a free hue; the finish is never touched', () => {
  const r = new Roster();
  const [a, b] = joinMany(r, 2);
  const want = { cohortIndex: 0, colorIndex: 5, finishIndex: 1 };

  r.setLook(a.id, { name: 'Ada', ...want });
  r.setLook(b.id, { name: 'Ben', ...want });

  assert.notEqual(b.colorIndex, 5, 'one jade PGY1, full stop — the colour moved');
  assert.equal(b.finishIndex, 1, 'the style they picked is theirs regardless');
  assert.equal(new Set(looks(r)).size, 2);
});

test('a player who has not picked a year cannot block a colour', () => {
  // A whole room joins before anyone commits to a year; those placeholders
  // wear auto colours in the default cohort but hold no claim on them.
  const r = new Roster();
  const [a, b] = joinMany(r, 2);
  r.setLook(b.id, { colorIndex: 5 }); // b picks a colour but never a year
  assert.equal(b.cohortSet, false);

  r.setLook(a.id, { cohortIndex: 1, colorIndex: 5 });
  assert.equal(a.colorIndex, 5, 'the committed player takes the colour');
  assert.equal(r.freeByColor(1)[5], 0, 'and only now is it counted as claimed');
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

test('a nonsense year, finish or accessory is clamped, not obeyed', () => {
  const r = new Roster();
  const [a] = joinMany(r, 1);
  r.setLook(a.id, { cohortIndex: 99, finishIndex: 999, accessoryIndex: -3 });
  assert.ok(a.cohortIndex >= 0 && a.cohortIndex < COHORTS.length);
  assert.ok(a.finishIndex >= 0 && a.finishIndex < FINISHES.length);
  assert.equal(a.accessoryIndex, 0, 'nonsense accessory falls back to none');
});

test('accessories are pure charm: everyone can wear the same one', () => {
  const r = new Roster();
  const players = joinMany(r, 5);
  for (const p of players) r.setLook(p.id, { cohortIndex: 0, accessoryIndex: 10 });
  assert.ok(
    players.every((p) => p.accessory === 'propeller'),
    'no collision logic ever touches an accessory'
  );
  // And it survives a reconnect like everything else.
  r.disconnect(players[0].id);
  const back = r.resolve(players[0].token, undefined);
  assert.ok(back.ok && /** @type {any} */ (back).record.accessory === 'propeller');
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

test('remove() drops the record, frees the colour, and forgets the token', () => {
  const roster = new Roster();
  const a = /** @type {any} */ (roster.resolve(undefined, 'Kickme')).record;
  roster.setLook(a.id, { colorIndex: 3, cohortIndex: 1 });

  assert.equal(roster.remove(a.id), true);
  assert.equal(roster.byId.has(a.id), false, 'record gone');
  assert.equal(roster.byToken.has(a.token), false, 'reconnect token gone');
  assert.equal(roster.remove(a.id), false, 'second remove is a no-op');

  // The colour is claimable again by the same year.
  const b = /** @type {any} */ (roster.resolve(undefined, 'Next')).record;
  roster.setLook(b.id, { colorIndex: 3, cohortIndex: 1 });
  assert.equal(roster.byId.get(b.id)?.colorIndex, 3, 'freed colour re-claimed');

  // A rejoin with the kicked token starts fresh instead of resurrecting.
  const c = /** @type {any} */ (roster.resolve(a.token, 'Back')).record;
  assert.notEqual(c.id, a.id, 'kicked token does not resurrect the old id');
});

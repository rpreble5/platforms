import test from 'node:test';
import assert from 'node:assert/strict';

import { BTN_JUMP, BTN_RIGHT } from '../shared/protocol.js';
import { PHYS, WORLD_W } from '../shared/tuning.js';
import {
  CONTROL_LABEL_MAX_CHARS,
  CONTROL_COOLDOWN_MS,
  CONTROL_DECK_YS,
  CONTROL_GROUND_Y,
  buildControlArena,
  resetControlArena,
  stepControls,
} from './control-boxes.js';
import { addPlayer, createWorld, step } from './world.js';

/** @param {ReturnType<typeof buildControlArena>} arena @param {string} id */
function control(arena, id) {
  const found = arena.controls.find((c) => c.id === id);
  assert.ok(found, `control ${id} exists`);
  return found;
}

test('the arena family supports 6-8 controls on three decks with crowd-width openings', () => {
  assert.equal(buildControlArena(9).controls.length, 8, 'requests above the maximum clamp to eight controls');
  for (let count = 6; count <= 8; count++) {
    const arena = buildControlArena(count);
    assert.equal(arena.controls.length, count);
    assert.equal(arena.openings.length, 5, 'the top deck has one route and the lower decks have two');
    assert.deepEqual(
      [...new Set(arena.openings.map((opening) => opening.y))]
        .map((y) => arena.openings.filter((opening) => opening.y === y).length),
      [2, 2, 1]
    );
    assert.ok(arena.openings.every((opening) => opening.w === 120), 'openings fit three character widths');
    assert.ok(arena.platforms.some((p) => p.id === 'control-ground'));
    for (const c of arena.controls) {
      assert.ok(c.label.length <= CONTROL_LABEL_MAX_CHARS, `${c.label} stays within the single-line content cap`);
      const platform = arena.platforms.find((p) => p.controlId === c.id);
      assert.ok(platform, `${c.id} replaces a real piece of floor`);
      assert.equal(platform.x, c.x);
      assert.equal(platform.y, c.y);
    }
  }
});

test('every layout reaches the edges and leaves two character widths on both sides of controls', () => {
  for (let count = 6; count <= 8; count++) {
    const arena = buildControlArena(count);
    const floorYs = [...new Set(arena.platforms.map((p) => p.y))];
    for (const y of floorYs) {
      const row = arena.platforms.filter((p) => p.y === y);
      assert.equal(Math.min(...row.map((p) => p.x)), 0, `floor at ${y} reaches left edge`);
      assert.equal(Math.max(...row.map((p) => p.x + p.w)), WORLD_W, `floor at ${y} reaches right edge`);
    }

    for (const c of arena.controls) {
      assert.ok(c.labelX >= 0 && c.labelX + c.labelW <= WORLD_W, `${c.label} label stays on screen`);
      const previousOpening = arena.openings
        .filter((opening) => opening.y === c.y && opening.x + opening.w <= c.x)
        .sort((a, b) => b.x - a.x)[0];
      const nextOpening = arena.openings
        .filter((opening) => opening.y === c.y && opening.x >= c.x + c.w)
        .sort((a, b) => a.x - b.x)[0];
      const previousEdge = previousOpening ? previousOpening.x + previousOpening.w : 0;
      const nextEdge = nextOpening?.x ?? WORLD_W;
      assert.ok(
        c.x - previousEdge >= PHYS.PLAYER_W * 2,
        `${count} controls: ${c.label} leaves two character widths to its left`
      );
      assert.ok(
        nextEdge - (c.x + c.w) >= PHYS.PLAYER_W * 2,
        `${count} controls: ${c.label} leaves two character widths to its right`
      );
    }
  }
});

test('buttons neither stack vertically nor sit directly above or below openings', () => {
  for (let count = 6; count <= 8; count++) {
    const arena = buildControlArena(count);
    for (let i = 0; i < arena.controls.length; i++) {
      const a = arena.controls[i];
      for (let j = i + 1; j < arena.controls.length; j++) {
        const b = arena.controls[j];
        if (a.y === b.y) continue;
        assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x, `${a.label} and ${b.label} do not stack vertically`);
      }
      for (const opening of arena.openings) {
        if (opening.y === a.y) continue;
        assert.ok(
          a.x + a.w <= opening.x || opening.x + opening.w <= a.x,
          `${a.label} is not directly above or below an opening`
        );
      }
    }
  }
});

test('openings are staggered rather than forming vertical shafts', () => {
  const arena = buildControlArena(8);
  for (let i = 0; i < arena.openings.length; i++) {
    const a = arena.openings[i];
    for (let j = i + 1; j < arena.openings.length; j++) {
      const b = arena.openings[j];
      if (a.y === b.y) continue;
      assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x, `openings at ${a.y} and ${b.y} are horizontally staggered`);
    }
  }
});

test('the maximum layout uses the requested middle and right-edge spacing', () => {
  const arena = buildControlArena(8);
  const middleControls = arena.controls.filter((c) => c.y === CONTROL_DECK_YS[1]).sort((a, b) => a.x - b.x);
  const topControls = arena.controls.filter((c) => c.y === CONTROL_DECK_YS[2]).sort((a, b) => a.x - b.x);
  const lowerSecond = control(arena, 'cultures');
  const middleFirstOpening = arena.openings
    .filter((opening) => opening.y === CONTROL_DECK_YS[1])
    .sort((a, b) => a.x - b.x)[0];
  const topLast = topControls.at(-1);

  assert.ok(topLast);
  assert.ok(middleFirstOpening);
  assert.deepEqual(middleControls.map((c) => c.x), [80, 1000]);
  assert.equal(topLast.x + topLast.w, WORLD_W - PHYS.PLAYER_W * 2);
  assert.ok(middleFirstOpening.x >= lowerSecond.labelX);
  assert.ok(middleFirstOpening.x + middleFirstOpening.w <= lowerSecond.labelX + lowerSecond.labelW);
});

test('the top layout separates its last controls and opens above the middle-row label', () => {
  const arena = buildControlArena(8);
  const topControls = arena.controls.filter((c) => c.y === CONTROL_DECK_YS[2]).sort((a, b) => a.x - b.x);
  const topOpening = arena.openings.find((opening) => opening.y === CONTROL_DECK_YS[2]);
  const middleSecond = control(arena, 'vanc');

  assert.ok(topOpening);
  assert.deepEqual(topControls.map((c) => c.x), [392, 760, 1728]);
  assert.equal(topOpening.x, 1200);
  assert.ok(topControls[1].labelX > topControls[1].x + topControls[1].w);
  assert.ok(topOpening.x >= middleSecond.labelX);
  assert.ok(topOpening.x + topOpening.w <= middleSecond.labelX + middleSecond.labelW);
});

test('world physics reports deliberate top and bottom control impacts', () => {
  const platform = { id: 'control-test', controlId: 'test', x: 100, y: 500, w: 160, h: 64 };

  const above = createWorld([platform]);
  const faller = addPlayer(above, 1);
  faller.x = 140;
  faller.y = 500 - faller.h;
  faller.vy = 600;
  step(above);
  assert.equal(above.impacts.length, 1);
  assert.equal(above.impacts[0].side, 'top');
  assert.ok(above.impacts[0].speed >= 600);

  const below = createWorld([platform]);
  const jumper = addPlayer(below, 2);
  jumper.x = 140;
  jumper.y = platform.y + platform.h;
  jumper.vy = -800;
  step(below);
  assert.equal(below.impacts.length, 1);
  assert.equal(below.impacts[0].side, 'bottom');
  assert.ok(below.impacts[0].speed > 700);
});

test('every control underside is reachable by a plain jump from the floor below', () => {
  const arena = buildControlArena();
  for (const c of arena.controls) {
    const supportY = Math.min(...arena.platforms.filter((p) => p.y > c.y).map((p) => p.y));
    const world = createWorld(arena.platforms);
    const player = addPlayer(world, 1);
    player.x = c.x + c.w / 2 - player.w / 2;
    player.y = supportY - player.h;
    player.onGround = true;
    player.input.pressEdge = BTN_JUMP;
    let hit = false;
    for (let i = 0; i < 90; i++) {
      step(world);
      if (world.impacts.some((impact) => impact.controlId === c.id && impact.side === 'bottom')) {
        hit = true;
        break;
      }
    }
    assert.ok(hit, `${c.label} can be hit from the deck below`);
  }
});

test('a held jump can climb through every widened opening and land on the next floor', () => {
  const arena = buildControlArena(8);
  const surfaces = [...CONTROL_DECK_YS, CONTROL_GROUND_Y];

  for (const opening of arena.openings) {
    const supportY = Math.min(...surfaces.filter((y) => y > opening.y));
    const world = createWorld(arena.platforms);
    const player = addPlayer(world, 1);
    player.x = opening.x + opening.w / 2 - player.w / 2;
    player.y = supportY - player.h;
    player.vx = 0;
    player.vy = 0;
    step(world);
    assert.ok(player.onGround, `starts below the opening at ${opening.x}, ${opening.y}`);

    player.input.pressEdge |= BTN_JUMP;
    let landed = false;
    for (let i = 0; i < 240; i++) {
      // Rise through the centre first, then drift onto the platform beside it.
      if (i === 28) player.input.held |= BTN_RIGHT;
      step(world);
      if (player.standingOn?.y === opening.y) {
        landed = true;
        break;
      }
    }
    assert.ok(landed, `opening at ${opening.x}, ${opening.y} supports a forgiving climb`);
  }
});

test('numeric boxes increase from below, decrease from above, and respect bounds', () => {
  const arena = buildControlArena();
  const dose = control(arena, 'vanc');
  assert.equal(dose.value, 15);

  let events = stepControls(arena, [{ playerId: 1, controlId: 'vanc', side: 'bottom', speed: 800 }], 1000);
  assert.equal(dose.value, 20);
  assert.equal(events[0].delta, 5);
  assert.equal(dose.feedback?.from, 15);
  assert.equal(dose.feedback?.to, 20);

  // Cooldown absorbs a crowd pile-up instead of adding once per avatar.
  events = stepControls(arena, [{ playerId: 2, controlId: 'vanc', side: 'bottom', speed: 900 }], 1001);
  assert.equal(events.length, 0);
  assert.equal(dose.value, 20);

  stepControls(arena, [{ playerId: 3, controlId: 'vanc', side: 'top', speed: 700 }], 1000 + CONTROL_COOLDOWN_MS);
  assert.equal(dose.value, 15);

  dose.value = 30;
  stepControls(arena, [{ playerId: 4, controlId: 'vanc', side: 'bottom', speed: 700 }], 1000 + CONTROL_COOLDOWN_MS * 2);
  assert.equal(dose.value, 30, 'clamps at configured maximum');
});

test('toggle boxes only change when accepted hits alternate sides', () => {
  const arena = buildControlArena();
  const cbc = control(arena, 'cbc');

  let events = stepControls(arena, [{ playerId: 1, controlId: 'cbc', side: 'bottom', speed: 700 }], 1000);
  assert.equal(cbc.value, true);
  assert.equal(events[0].accepted, true);
  assert.equal(cbc.feedback?.from, false);
  assert.equal(cbc.feedback?.to, true);

  events = stepControls(arena, [{ playerId: 2, controlId: 'cbc', side: 'bottom', speed: 900 }], 1000 + CONTROL_COOLDOWN_MS);
  assert.equal(cbc.value, true);
  assert.equal(events[0].accepted, false);
  assert.equal(cbc.feedback?.from, true);
  assert.equal(cbc.feedback?.to, true);

  events = stepControls(arena, [{ playerId: 3, controlId: 'cbc', side: 'top', speed: 650 }], 1000 + CONTROL_COOLDOWN_MS + 1);
  assert.equal(cbc.value, false);
  assert.equal(events[0].accepted, true);
  assert.equal(cbc.lastSide, 'top');
});

test('the strongest simultaneous impact wins regardless of input order', () => {
  /** @type {import('./control-boxes.js').ControlImpact[]} */
  const impacts = [
    { playerId: 9, controlId: 'duration', side: 'bottom', speed: 600 },
    { playerId: 2, controlId: 'duration', side: 'top', speed: 900 },
  ];
  const a = buildControlArena();
  const b = buildControlArena();
  const ea = stepControls(a, impacts, 1000);
  const eb = stepControls(b, [...impacts].reverse(), 1000);
  assert.deepEqual(ea, eb);
  assert.equal(control(a, 'duration').value, 4, 'stronger top impact decremented once');
});

test('reset restores values, alternation, cooldown, and feedback', () => {
  const arena = buildControlArena();
  stepControls(arena, [{ playerId: 1, controlId: 'cbc', side: 'top', speed: 700 }], 1000);
  resetControlArena(arena);
  const cbc = control(arena, 'cbc');
  assert.equal(cbc.value, cbc.initial);
  assert.equal(cbc.lastSide, null);
  assert.equal(cbc.lastChangedAt, -Infinity);
  assert.equal(cbc.feedback, null);
});

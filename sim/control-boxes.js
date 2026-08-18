/**
 * Shared-input control boxes and their four-floor interaction arena.
 *
 * This is deliberately NOT a game mode. It owns only physical fixtures and
 * deterministic state changes, so question flow and scoring can be designed
 * later without baking those decisions into collision code.
 */

import { WORLD_W } from '../shared/tuning.js';

export const CONTROL_FLOOR_H = 64;
export const CONTROL_BOX_W = 112;
export const CONTROL_IMPACT_SPEED = 260;
export const CONTROL_COOLDOWN_MS = 220;
export const CONTROL_LABEL_MAX_CHARS = 32;
export const CONTROL_GROUND_Y = 980;
export const CONTROL_DECK_GAP = 190;
export const CONTROL_DECK_YS = Object.freeze([
  CONTROL_GROUND_Y - CONTROL_DECK_GAP,
  CONTROL_GROUND_Y - CONTROL_DECK_GAP * 2,
  CONTROL_GROUND_Y - CONTROL_DECK_GAP * 3,
]);

/** @typedef {'toggle'|'number'} ControlKind */

/**
 * @typedef {object} ControlFixture
 * @property {string} id
 * @property {string} label
 * @property {ControlKind} kind
 * @property {boolean | number} value
 * @property {boolean | number} initial
 * @property {number} x @property {number} y @property {number} w @property {number} h
 * @property {number} labelX @property {number} labelW
 * @property {number} [min] @property {number} [max] @property {number} [step]
 * @property {string} [unit]
 * @property {'top'|'bottom'|null} lastSide last accepted side for alternating toggles
 * @property {number} lastChangedAt
 * @property {{at:number, side:'top'|'bottom', accepted:boolean, delta:number, playerId:number, from:boolean|number, to:boolean|number} | null} feedback
 */

/**
 * @typedef {object} ControlArena
 * @property {import('./collide.js').Platform[]} platforms
 * @property {ControlFixture[]} controls
 * @property {{y:number, x:number, w:number}[]} openings
 */

/**
 * @typedef {object} ControlImpact
 * @property {number} playerId
 * @property {string} controlId
 * @property {'top'|'bottom'} side
 * @property {number} speed
 */

/**
 * @typedef {object} ControlEvent
 * @property {string} controlId
 * @property {number} playerId
 * @property {'top'|'bottom'} side
 * @property {boolean} accepted
 * @property {number} delta
 * @property {boolean | number} value
 */

const DECKS = [
  {
    y: CONTROL_DECK_YS[0],
    holes: [[520, 640], [1320, 1440]],
    cells: [
      { boxX: 280, labelX: 56, labelW: 212, id: 'cbc', label: 'CBC', kind: 'toggle', initial: false },
      { boxX: 880, labelX: 640, labelW: 228, id: 'cultures', label: 'Blood cultures', kind: 'toggle', initial: false },
      { boxX: 1580, labelX: 1312, labelW: 256, id: 'fluids', label: 'IV fluids', kind: 'toggle', initial: false },
    ],
  },
  {
    y: CONTROL_DECK_YS[1],
    holes: [[640, 760], [1440, 1560]],
    cells: [
      { boxX: 80, labelX: 216, labelW: 400, id: 'ct', label: 'CT abdomen / pelvis', kind: 'toggle', initial: false },
      { boxX: 1000, labelX: 1136, labelW: 280, id: 'vanc', label: 'Vancomycin dose', kind: 'number', initial: 15, min: 0, max: 30, step: 5, unit: 'mg/kg' },
    ],
  },
  {
    y: CONTROL_DECK_YS[2],
    holes: [[1200, 1320]],
    cells: [
      { boxX: 392, labelX: 156, labelW: 212, id: 'pressor', label: 'Vasopressor', kind: 'toggle', initial: false },
      { boxX: 760, labelX: 896, labelW: 320, id: 'steroid', label: 'Steroid dose', kind: 'number', initial: 4, min: 0, max: 20, step: 2, unit: 'mg' },
      { boxX: 1728, labelX: 1484, labelW: 220, id: 'duration', label: 'Treatment duration', kind: 'number', initial: 5, min: 1, max: 14, step: 1, unit: 'days' },
    ],
  },
];

/** Which of the three slots on each deck are occupied at each option count. */
const ACTIVE_SLOTS = {
  6: [[0, 2], [0, 1], [0, 2]],
  7: [[0, 2], [0, 1], [0, 1, 2]],
  8: [[0, 1, 2], [0, 1], [0, 1, 2]],
};

/** @param {any} cell @param {number} y @returns {ControlFixture} */
function fixture(cell, y) {
  const x = cell.boxX;
  const rawLabel = String(cell.label).trim();
  const label = rawLabel.length <= CONTROL_LABEL_MAX_CHARS
    ? rawLabel
    : `${rawLabel.slice(0, CONTROL_LABEL_MAX_CHARS - 1).trimEnd()}…`;
  return {
    id: cell.id,
    label,
    kind: cell.kind,
    value: cell.initial,
    initial: cell.initial,
    x,
    y,
    w: CONTROL_BOX_W,
    h: CONTROL_FLOOR_H,
    labelX: cell.labelX,
    labelW: cell.labelW ?? 180,
    min: cell.min,
    max: cell.max,
    step: cell.step,
    unit: cell.unit,
    lastSide: null,
    lastChangedAt: -Infinity,
    feedback: null,
  };
}

/**
 * Fill one deck with solid floor sections around its openings and controls.
 * No collision rectangles overlap: a control genuinely replaces that piece
 * of floor instead of being painted over an invisible ordinary platform.
 * @param {number} y
 * @param {Array<[number, number]>} holes
 * @param {ControlFixture[]} controls
 * @param {number} deckIndex
 * @returns {import('./collide.js').Platform[]}
 */
function buildDeck(y, holes, controls, deckIndex) {
  const left = 0;
  const right = WORLD_W;
  const blocks = [
    ...holes.map(([x, end]) => ({ x, end, type: 'hole', control: /** @type {ControlFixture | null} */ (null) })),
    ...controls.map((control) => ({ x: control.x, end: control.x + control.w, type: 'control', control })),
  ].sort((a, b) => a.x - b.x);
  /** @type {import('./collide.js').Platform[]} */
  const platforms = [];
  let cursor = left;
  let segment = 0;
  for (const block of blocks) {
    if (block.x > cursor) {
      platforms.push({ id: `control-floor-${deckIndex}-${segment++}`, x: cursor, y, w: block.x - cursor, h: CONTROL_FLOOR_H });
    }
    if (block.type === 'control' && block.control) {
      platforms.push({
        id: `control-${block.control.id}`,
        controlId: block.control.id,
        x: block.control.x,
        y,
        w: block.control.w,
        h: CONTROL_FLOOR_H,
      });
    }
    cursor = Math.max(cursor, block.end);
  }
  if (cursor < right) {
    platforms.push({ id: `control-floor-${deckIndex}-${segment}`, x: cursor, y, w: right - cursor, h: CONTROL_FLOOR_H });
  }
  return platforms;
}

/**
 * @param {number} [optionCount] supported layouts have 6-8 controls
 * @returns {ControlArena}
 */
export function buildControlArena(optionCount = 8) {
  const count = Math.max(6, Math.min(8, Math.round(optionCount)));
  const slots = ACTIVE_SLOTS[/** @type {6|7|8} */ (count)];
  /** @type {ControlFixture[]} */
  const controls = [];
  /** @type {import('./collide.js').Platform[]} */
  const platforms = [{ id: 'control-ground', x: 0, y: CONTROL_GROUND_Y, w: WORLD_W, h: 180 }];
  /** @type {{y:number, x:number, w:number}[]} */
  const openings = [];

  DECKS.forEach((deck, i) => {
    const deckControls = slots[i].map((slot) => fixture(deck.cells[slot], deck.y));
    controls.push(...deckControls);
    platforms.push(...buildDeck(deck.y, /** @type {Array<[number, number]>} */ (deck.holes), deckControls, i));
    for (const [x, end] of deck.holes) openings.push({ y: deck.y, x, w: end - x });
  });

  return { platforms, controls, openings };
}

/** @param {ControlArena} arena */
export function resetControlArena(arena) {
  for (const control of arena.controls) {
    control.value = control.initial;
    control.lastSide = null;
    control.lastChangedAt = -Infinity;
    control.feedback = null;
  }
}

/**
 * Apply at most one accepted state change per control per tick. The strongest
 * impact wins, with player id and side as stable tie-breakers, so adding
 * players in a different order cannot change the outcome.
 * @param {ControlArena} arena
 * @param {ControlImpact[]} impacts
 * @param {number} now
 * @returns {ControlEvent[]}
 */
export function stepControls(arena, impacts, now) {
  /** @type {ControlEvent[]} */
  const events = [];
  for (const control of arena.controls) {
    if (now - control.lastChangedAt < CONTROL_COOLDOWN_MS) continue;
    const candidates = impacts
      .filter((hit) => hit.controlId === control.id && hit.speed >= CONTROL_IMPACT_SPEED)
      .sort((a, b) => b.speed - a.speed || a.playerId - b.playerId || (a.side === b.side ? 0 : a.side === 'top' ? -1 : 1));
    if (!candidates.length) continue;

    let hit = candidates[0];
    if (control.kind === 'toggle' && control.lastSide !== null) {
      const alternating = candidates.find((candidate) => candidate.side !== control.lastSide);
      if (!alternating) {
        control.feedback = {
          at: now,
          side: hit.side,
          accepted: false,
          delta: 0,
          playerId: hit.playerId,
          from: control.value,
          to: control.value,
        };
        events.push({ controlId: control.id, playerId: hit.playerId, side: hit.side, accepted: false, delta: 0, value: control.value });
        continue;
      }
      hit = alternating;
    }

    const before = control.value;
    let delta = 0;
    if (control.kind === 'toggle') {
      control.value = !control.value;
      control.lastSide = hit.side;
      delta = control.value ? 1 : -1;
    } else {
      const direction = hit.side === 'bottom' ? 1 : -1;
      const next = Number(control.value) + direction * (control.step ?? 1);
      control.value = Math.max(control.min ?? -Infinity, Math.min(control.max ?? Infinity, next));
      delta = Number(control.value) - Number(before);
    }

    control.lastChangedAt = now;
    control.feedback = {
      at: now,
      side: hit.side,
      accepted: true,
      delta,
      playerId: hit.playerId,
      from: before,
      to: control.value,
    };
    events.push({ controlId: control.id, playerId: hit.playerId, side: hit.side, accepted: true, delta, value: control.value });
  }
  return events;
}

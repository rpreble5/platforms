/**
 * The world and its fixed-timestep body. Pure — Node imports this directly for
 * determinism tests; the display page imports the identical file.
 */

import { KILL_Y, STEP_MS, WORLD_H, WORLD_W } from '../shared/tuning.js';
import { createPlayer, stepPlayer } from './player.js';

/** @typedef {import('./collide.js').Platform} Platform */
/** @typedef {import('./player.js').Player} Player */

/**
 * @typedef {object} World
 * @property {number} t ms since world creation
 * @property {number} tick
 * @property {Platform[]} platforms
 * @property {Map<number, Player>} players
 * @property {{x:number, y:number}} spawn
 */

/**
 * M0/M2 test level: a wide floor plus a spread of platforms at reachable
 * heights, sized so every gap clears with slack. Real answer-platform layout
 * comes later — this exists to make jump feel measurable.
 * @returns {Platform[]}
 */
export function testLevel() {
  const floorY = WORLD_H - 90;
  /** @type {Platform[]} */
  const platforms = [
    { id: 'floor', x: -200, y: floorY, w: WORLD_W + 400, h: 200 },
    { id: 'p1', x: 180, y: floorY - 190, w: 340, h: 26, oneWay: true },
    { id: 'p2', x: 700, y: floorY - 330, w: 340, h: 26, oneWay: true },
    { id: 'p3', x: 1220, y: floorY - 190, w: 340, h: 26, oneWay: true },
    { id: 'p4', x: 760, y: floorY - 600, w: 220, h: 26, oneWay: true },
    // A pair of solid blocks, so corner correction and wall stops get exercised.
    { id: 'w1', x: 560, y: floorY - 120, w: 40, h: 120 },
    { id: 'w2', x: 1130, y: floorY - 120, w: 40, h: 120 },
  ];
  return platforms;
}

/**
 * @param {Platform[]} [platforms]
 * @returns {World}
 */
export function createWorld(platforms = testLevel()) {
  return {
    t: 0,
    tick: 0,
    platforms,
    players: new Map(),
    spawn: { x: WORLD_W / 2, y: WORLD_H - 260 },
  };
}

/**
 * Spread spawns so 30 simultaneous joins don't stack into one column.
 *
 * Derived from the player id, NOT from how many players happen to be in the
 * map at the time. Insertion order must not be able to influence the
 * simulation — otherwise two hosts replaying the same inputs diverge, and a
 * reconnecting player reappears somewhere new.
 * @param {number} id
 * @returns {number}
 */
function spawnOffset(id) {
  return (((id * 97) % 21) - 10) * 18;
}

/**
 * @param {World} world
 * @param {number} id
 * @returns {Player}
 */
export function addPlayer(world, id) {
  const existing = world.players.get(id);
  if (existing) {
    existing.connected = true;
    return existing;
  }
  const p = createPlayer(id, world.spawn.x + spawnOffset(id), world.spawn.y);
  world.players.set(id, p);
  return p;
}

/**
 * @param {World} world
 * @param {number} id
 */
export function removePlayer(world, id) {
  world.players.delete(id);
}

/**
 * @param {World} world
 * @param {Player} p
 */
function respawn(world, p) {
  p.x = world.spawn.x + spawnOffset(p.id);
  p.y = world.spawn.y;
  p.vx = 0;
  p.vy = 0;
  p.jumpBuffer = 0;
  p.coyote = 0;
  p.respawns++;
}

/**
 * Advance the world by exactly one fixed tick. Callers drive this from an
 * accumulator; never pass a variable dt.
 * @param {World} world
 * @param {number} [dtMs]
 */
export function step(world, dtMs = STEP_MS) {
  world.t += dtMs;
  world.tick++;
  for (const p of world.players.values()) {
    stepPlayer(p, world.platforms, dtMs, world.t);
    if (p.y > KILL_Y) respawn(world, p);
  }
}

/**
 * Player identity: 12 colors x 4 hat silhouettes = 48 unique identities.
 *
 * Never color alone. At 30 players on one screen, hue alone is not separable —
 * across a room, under projector gamma, and for colorblind players. The hat is
 * the disambiguator, and the phone shows both fullscreen so "look at your phone,
 * then find that on screen" is the actual mechanism.
 *
 * Colors avoid adjacent saturated red/blue pairs and anything that muddies when
 * a projector crushes saturation.
 */

export const COLORS = [
  { name: 'ember', hex: '#ff5a3c' },
  { name: 'amber', hex: '#ffa62b' },
  { name: 'gold', hex: '#ffd93d' },
  { name: 'lime', hex: '#a7e04a' },
  { name: 'jade', hex: '#2fc98d' },
  { name: 'teal', hex: '#26c6da' },
  { name: 'sky', hex: '#4aa8ff' },
  { name: 'indigo', hex: '#7c72ff' },
  { name: 'violet', hex: '#b168ff' },
  { name: 'magenta', hex: '#ff5fd2' },
  { name: 'rose', hex: '#ff7a9c' },
  { name: 'bone', hex: '#e8e2d4' },
];

/** Hat silhouettes, drawn as simple shapes so they read at 28px. */
export const HATS = /** @type {const} */ (['none', 'cap', 'horns', 'antenna']);

/**
 * Deterministic identity for a player index, so reconnects keep their look and
 * the first 12 players all get distinct colors before any hat repeats.
 * @param {number} index
 * @returns {{colorIndex:number, hatIndex:number, color:string, hat:string}}
 */
export function identityFor(index) {
  const colorIndex = index % COLORS.length;
  const hatIndex = Math.floor(index / COLORS.length) % HATS.length;
  return {
    colorIndex,
    hatIndex,
    color: COLORS[colorIndex].hex,
    hat: HATS[hatIndex],
  };
}

/**
 * A readable name for an unnamed player, e.g. "Jade Cap".
 * @param {number} index
 * @returns {string}
 */
export function defaultName(index) {
  const { colorIndex, hatIndex } = identityFor(index);
  const c = COLORS[colorIndex].name;
  const h = HATS[hatIndex];
  const cap = /** @param {string} s */ (s) => s[0].toUpperCase() + s.slice(1);
  return hatIndex === 0 ? cap(c) : `${cap(c)} ${cap(h)}`;
}

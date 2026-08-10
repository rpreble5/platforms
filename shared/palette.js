/**
 * Player identity: 12 colors x 4 hat silhouettes = 48 unique identities.
 *
 * Never color alone. At 30 players on one screen, hue alone is not separable —
 * across a room, under projector gamma, and for colorblind players. The hat is
 * the disambiguator, and the phone shows both fullscreen so "look at your phone,
 * then find that on screen" is the actual mechanism.
 *
 * Players pick their color; the server assigns the hat. That split is what lets
 * people choose without breaking the uniqueness the identity system depends on —
 * four players can all be jade, and they get four different hats.
 *
 * Colors avoid adjacent saturated red/blue pairs and anything that muddies when
 * a projector crushes saturation.
 *
 * NO IMPORTS: this file is inlined into the phone page with its `export`
 * keywords stripped (see server/http.js), the same way the protocol is.
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

/** How each hat is shown on the phone, where there is no canvas to draw on. */
export const HAT_GLYPH = /** @type {const} */ ({
  none: '●',
  cap: '🧢',
  horns: '🤘',
  antenna: '📡',
});

/** Total distinct looks. Deliberately above MAX_PLAYERS, so nobody is turned away. */
export const LOOK_COUNT = 48;

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
 * A readable name for a look, e.g. "Jade Cap". Used for anyone who hasn't typed
 * their own, and it follows them if they change colour.
 * @param {number} colorIndex
 * @param {number} hatIndex
 * @returns {string}
 */
export function lookName(colorIndex, hatIndex) {
  const c = COLORS[colorIndex % COLORS.length].name;
  const h = HATS[hatIndex % HATS.length];
  const cap = /** @param {string} s */ (s) => s[0].toUpperCase() + s.slice(1);
  return hatIndex % HATS.length === 0 ? cap(c) : `${cap(c)} ${cap(h)}`;
}

/**
 * A readable name for an unnamed player at a join index.
 * @param {number} index
 * @returns {string}
 */
export function defaultName(index) {
  const { colorIndex, hatIndex } = identityFor(index);
  return lookName(colorIndex, hatIndex);
}

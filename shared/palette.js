/**
 * Player identity: three axes — cohort, colour, accessory.
 *
 * The budget this is all designed against: at 30 players an avatar is drawn
 * around 30x42 px and viewed from five metres. A feature needs roughly 3px to
 * be noticed at all, which is 10% of the body width. So the rule every shape
 * here obeys is that it must **break the outline**. The eye reads silhouette
 * first, and a blob above the head sits against open sky rather than against a
 * busy body. Anything drawn inside the outline — face detail, a badge, fine
 * pattern — is invisible across a room and is not worth the pixels.
 *
 * Never colour alone, either. Twelve hues are not separable at that size across
 * a room, under projector gamma, or for a colourblind player. The accessory is
 * the disambiguator, and the phone shows both so "look at your phone, then find
 * that on screen" is the actual mechanism.
 *
 * Who chooses what:
 *   - The player picks cohort, colour, accessory and body pattern.
 *   - The server resolves collisions, giving up the weakest signal first:
 *     pattern yields, then accessory, and the colour moves only as a last
 *     resort. A 30x42 block of hue is the strongest thing on the avatar.
 * That order is what lets people choose without breaking the uniqueness the
 * whole identity system depends on — and with the pattern absorbing most
 * collisions, players now usually get the exact colour and accessory they
 * asked for.
 *
 * Colours avoid adjacent saturated red/blue pairs and anything that muddies
 * when a projector crushes saturation.
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

/**
 * Training years.
 *
 * `height` scales how tall the avatar is DRAWN. It never touches the collision
 * box — see render.js and the fairness test in sim/round.test.js. Cohort is a
 * costume, never a gameplay difference.
 *
 * Height is a comparative cue: a clump of PGY1s beside a clump of PGY3s is
 * obvious, one PGY2 alone on a platform is not. That's the right shape for a
 * coarse three-state signal, and it's why the accessory pools carry the load
 * as well.
 *
 * The 0.85–1.15 spread is wider than it first looks like it needs to be. A
 * tighter 0.9–1.1 got swamped: accessory silhouettes vary the total height of a
 * sprite by about as much again, so the cohort signal has to clear that noise
 * to be readable at all. Headroom is fine either way — at the largest size the
 * tallest avatar's head still sits ~23px below the signboards.
 */
export const COHORTS = [
  { key: 'pgy1', label: 'PGY1', height: 0.85 },
  { key: 'pgy2', label: 'PGY2', height: 1.0 },
  { key: 'pgy3', label: 'PGY3', height: 1.15 },
];

/** Accessories per cohort. Fixed at four so 12 colours x 4 = 48 slots per year. */
export const POOL_SIZE = 4;

/**
 * Twelve accessories in cohort order: indices 0-3 are PGY1, 4-7 PGY2, 8-11
 * PGY3. Because the pools are disjoint index ranges, two cohorts can never
 * contend for the same (colour, accessory) pair — the partition falls out of
 * the numbering rather than needing to be enforced.
 *
 * Every one of these sits above or beside the head. `shades` is the weakest of
 * the twelve and is drawn overhanging the head sides for that reason; it earns
 * its place on the phone more than at five metres.
 */
export const ACCESSORIES = [
  { key: 'bow', label: 'Bow', glyph: '🎀' },
  { key: 'bonnet', label: 'Bonnet', glyph: '👒' },
  { key: 'ears', label: 'Ears', glyph: '🐰' },
  { key: 'curl', label: 'Curl', glyph: '🌱' },

  { key: 'cap', label: 'Cap', glyph: '🧢' },
  { key: 'visor', label: 'Visor', glyph: '🥽' },
  { key: 'antenna', label: 'Antenna', glyph: '📡' },
  { key: 'tuft', label: 'Tuft', glyph: '⚡' },

  { key: 'crown', label: 'Crown', glyph: '👑' },
  { key: 'phones', label: 'Phones', glyph: '🎧' },
  { key: 'horns', label: 'Horns', glyph: '🤘' },
  { key: 'shades', label: 'Shades', glyph: '🕶️' },
];

/**
 * Body patterns.
 *
 * These are deliberately bold rather than subtle. A pattern a couple of shades
 * off the body colour is invisible at 30x42 from five metres — that difference
 * is exactly what a projector's gamma crushes first — so each of these is a
 * large, high-contrast shape covering a good fraction of the body. Small or
 * low-contrast markings are charm, not identity, and this axis is doing
 * identity work.
 *
 * Four is on purpose. The point of another axis is not more combinations —
 * 12 x 4 was already far more than 30 people need. It is more *separation*:
 * a fourth well-separated state beats a fortieth indistinguishable one.
 */
export const PATTERNS = [
  { key: 'solid', label: 'Solid' },
  { key: 'dots', label: 'Dots' },
  { key: 'band', label: 'Band' },
  { key: 'sash', label: 'Sash' },
];

/** Distinct looks available in one colour, within one year. */
export const SLOTS_PER_COLOR = POOL_SIZE * PATTERNS.length;

/** Total distinct looks. Far above MAX_PLAYERS, so nobody is turned away. */
export const LOOK_COUNT = COLORS.length * ACCESSORIES.length * PATTERNS.length;

/** @param {number} i @returns {number} */
export function clampPattern(i) {
  return Number.isInteger(i) && i >= 0 && i < PATTERNS.length ? i : 0;
}

/** The middle year. What a player holds before they've chosen. */
export const DEFAULT_COHORT = 1;

/**
 * The accessory indices a cohort may use.
 * @param {number} cohortIndex
 * @returns {number[]}
 */
export function poolFor(cohortIndex) {
  const c = clampCohort(cohortIndex);
  return Array.from({ length: POOL_SIZE }, (_, i) => c * POOL_SIZE + i);
}

/** @param {number} hatIndex @returns {number} which cohort an accessory belongs to */
export function cohortOfAccessory(hatIndex) {
  return Math.floor(clampHat(hatIndex) / POOL_SIZE);
}

/** @param {number} i @returns {number} */
export function clampCohort(i) {
  return Number.isInteger(i) && i >= 0 && i < COHORTS.length ? i : DEFAULT_COHORT;
}

/** @param {number} i @returns {number} */
export function clampHat(i) {
  return Number.isInteger(i) && i >= 0 && i < ACCESSORIES.length ? i : 0;
}

/**
 * Deterministic starting identity for a player index, so the first twelve
 * joiners all get distinct colours before any accessory repeats.
 * @param {number} index
 * @param {number} [cohortIndex]
 * @returns {{colorIndex:number, hatIndex:number, color:string, hat:string}}
 */
export function identityFor(index, cohortIndex = DEFAULT_COHORT) {
  const colorIndex = ((index % COLORS.length) + COLORS.length) % COLORS.length;
  const slot = Math.floor(Math.abs(index) / COLORS.length) % POOL_SIZE;
  const hatIndex = clampCohort(cohortIndex) * POOL_SIZE + slot;
  return {
    colorIndex,
    hatIndex,
    color: COLORS[colorIndex].hex,
    hat: ACCESSORIES[hatIndex].key,
  };
}

/**
 * A readable name for a look, e.g. "Jade Crown". Used for anyone who hasn't
 * typed their own, and it follows them if they change anything.
 * @param {number} colorIndex
 * @param {number} hatIndex
 * @returns {string}
 */
export function lookName(colorIndex, hatIndex) {
  const c = COLORS[((colorIndex % COLORS.length) + COLORS.length) % COLORS.length].name;
  const a = ACCESSORIES[clampHat(hatIndex)].label;
  return `${c[0].toUpperCase() + c.slice(1)} ${a}`;
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

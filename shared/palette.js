/**
 * Player identity: three axes — cohort (body shape + height), colour, finish.
 *
 * The budget this is all designed against: at 30 players an avatar is drawn
 * around 30x42 px and viewed from five metres, and a projector crushes
 * saturation before anything else. Colour is the strongest signal, the cohort
 * silhouette (egg / pill / loaf) the second, and the finish — the same hue
 * rendered saturated-flat or soft-pastel — the tiebreaker between two players
 * who share both.
 *
 * Who chooses what:
 *   - The player picks cohort, colour and finish.
 *   - The server resolves collisions, giving up the weakest signal first:
 *     finish yields, and the colour moves only as a last resort. A 30x42
 *     block of hue is the strongest thing on the avatar.
 *
 * Accessories are RETIRED for now: the hat pools, pool partitioning and the
 * phone's accessory picker are gone from the identity system, though the art
 * (accessory-art.js) is kept dormant in case they return.
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
 * Training years — the bean family, growing up.
 *
 * `height` scales how tall the avatar is DRAWN and `shape` picks the body
 * outline. Neither touches the collision box — see render.js and the fairness
 * test in sim/round.test.js. Cohort is a costume, never a gameplay difference.
 *
 * Height is a comparative cue: a clump of PGY1s beside a clump of PGY3s is
 * obvious, one PGY2 alone on a platform is not. The 0.75–1.4 spread is wide
 * because narrower ones got swamped.
 *
 * Shape is a second channel pointing the same way — redundant coding, which
 * survives occlusion and a bad projector better than one channel does. The
 * three outlines are one species aging: the egg (narrow shoulders, full base)
 * grows into the upright pill and finally the square-shouldered loaf. Round
 * top vs domed top vs flat top still separates at true crowd size.
 *
 * `noun` feeds the automatic names ("Jade Egg", "Sky Loaf") — the phone shows
 * your name and colour, and "look at your phone, then find that on screen" is
 * the mechanism for picking yourself out of 30 avatars.
 */
export const COHORTS = [
  { key: 'pgy1', label: 'PGY1', height: 0.75, shape: 'egg', noun: 'Egg' },
  { key: 'pgy2', label: 'PGY2', height: 1.0, shape: 'pill', noun: 'Pill' },
  { key: 'pgy3', label: 'PGY3', height: 1.4, shape: 'loaf', noun: 'Loaf' },
];

/**
 * DORMANT — accessories are retired from the identity system for now. The
 * table and the art in client/display/accessory-art.js are kept so they can
 * come back without archaeology, but nothing assigns, renders or picks them.
 */
export const POOL_SIZE = 4;

/** Dormant, like POOL_SIZE above. */
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
 * Finishes: the same hue rendered two ways. `flat` is the saturated colour
 * with a bold ink outline; `pastel` is the colour washed toward white with a
 * deep same-hue outline and a blush. Both belong to the terrazzo stage, and
 * players simply pick which they like — the server only overrides a pick when
 * two players in one cohort would otherwise be identical.
 */
export const FINISHES = [
  { key: 'flat', label: 'Flat' },
  { key: 'pastel', label: 'Pastel' },
];

/** Distinct looks available in one colour, within one year. */
export const SLOTS_PER_COLOR = FINISHES.length;

/**
 * Distinct looks per cohort (a look is colour x finish; the cohort's shape
 * makes the same pair distinct across years). 24 per year covers a realistic
 * room; if more than 24 players of ONE year ever join, the roster starts
 * allowing duplicates rather than turning anyone away.
 */
export const LOOK_COUNT = COLORS.length * FINISHES.length;

/** @param {number} i @returns {number} */
export function clampFinish(i) {
  return Number.isInteger(i) && i >= 0 && i < FINISHES.length ? i : 0;
}

/** The middle year. What a player holds before they've chosen. */
export const DEFAULT_COHORT = 1;

/**
 * DORMANT — the accessory indices a cohort may use, kept for the dormant
 * accessory art.
 * @param {number} cohortIndex
 * @returns {number[]}
 */
export function poolFor(cohortIndex) {
  const c = clampCohort(cohortIndex);
  return Array.from({ length: POOL_SIZE }, (_, i) => c * POOL_SIZE + i);
}

/** @param {number} i @returns {number} */
export function clampCohort(i) {
  return Number.isInteger(i) && i >= 0 && i < COHORTS.length ? i : DEFAULT_COHORT;
}

/**
 * Deterministic starting identity for a player index, so the first twelve
 * joiners all get distinct colours before any finish repeats.
 * @param {number} index
 * @returns {{colorIndex:number, finishIndex:number, color:string, finish:string}}
 */
export function identityFor(index) {
  const colorIndex = ((index % COLORS.length) + COLORS.length) % COLORS.length;
  const finishIndex = Math.floor(Math.abs(index) / COLORS.length) % FINISHES.length;
  return {
    colorIndex,
    finishIndex,
    color: COLORS[colorIndex].hex,
    finish: FINISHES[finishIndex].key,
  };
}

/**
 * A readable name for a look, e.g. "Jade Egg". Used for anyone who hasn't
 * typed their own, and it follows them if they change anything.
 * @param {number} colorIndex
 * @param {number} cohortIndex
 * @returns {string}
 */
export function lookName(colorIndex, cohortIndex) {
  const c = COLORS[((colorIndex % COLORS.length) + COLORS.length) % COLORS.length].name;
  return `${c[0].toUpperCase() + c.slice(1)} ${COHORTS[clampCohort(cohortIndex)].noun}`;
}

/**
 * A readable name for an unnamed player at a join index.
 * @param {number} index
 * @param {number} [cohortIndex]
 * @returns {string}
 */
export function defaultName(index, cohortIndex = DEFAULT_COHORT) {
  return lookName(identityFor(index).colorIndex, cohortIndex);
}

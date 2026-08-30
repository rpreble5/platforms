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
 *   - The COLOUR is the claim, unique within a year: taken colours grey out
 *     on the phone, and a contested request slides to the nearest free hue.
 *     The finish is a pure preference and is never taken away.
 *
 * Accessories exist but do NO identity work: they are a free pick with no
 * collision logic, painted by shared/avatar.js in the bean design language.
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
 * Accessories: pure charm, zero identity work. Colour carries uniqueness, so
 * these are a free pick — no pools, no collision resolution, wear what you
 * like. Every key has a painter in shared/avatar.js; the phone previews them
 * on a mini bean in the player's own colour.
 */
export const ACCESSORIES = [
  { key: 'none', label: 'None' },
  { key: 'flower', label: 'Flower' },
  { key: 'sunglasses', label: 'Shades' },
  { key: 'crown', label: 'Crown' },
  { key: 'sprout', label: 'Sprout' },
  { key: 'fangs', label: 'Fangs' },
  { key: 'moustache', label: 'Moustache' },
  { key: 'monocle', label: 'Monocle' },
  { key: 'beret', label: 'Beret' },
  { key: 'party', label: 'Party hat' },
  { key: 'propeller', label: 'Propeller' },
  { key: 'tophat', label: 'Top hat' },
  { key: 'cowboy', label: 'Cowboy' },
  { key: 'beanie', label: 'Beanie' },
  { key: 'halo', label: 'Halo' },
  { key: 'catears', label: 'Cat ears' },
];

/** @param {number} i @returns {number} */
export function clampAccessory(i) {
  return Number.isInteger(i) && i >= 0 && i < ACCESSORIES.length ? i : 0;
}

/**
 * Finishes: the same hue rendered different ways. `flat` is the saturated
 * colour with a bold ink outline; `pastel` is the colour washed toward white
 * with a deep same-hue outline and a blush; `ghost` is near-white porcelain
 * with the identity moved into a thick same-hue outline; `dipped` is flat
 * with the bottom third dunked in a deeper shade; `glow` is flat with a soft
 * same-colour aura. All read on every stage theme, and players simply pick
 * which they like — a pure preference, never overridden, because the colour
 * alone carries uniqueness.
 */
export const FINISHES = [
  { key: 'flat', label: 'Flat' },
  { key: 'pastel', label: 'Pastel' },
  { key: 'ghost', label: 'Ghost' },
  { key: 'dipped', label: 'Dipped' },
  { key: 'glow', label: 'Glow' },
  { key: 'neon', label: 'Neon' },
  { key: 'jelly', label: 'Jelly' },
  { key: 'snow', label: 'Snow' },
];

/** Free slots per colour within one year: a colour is claimed whole. */
export const SLOTS_PER_COLOR = 1;

/**
 * One accent per training year, indexed like COHORTS — the colour a team's
 * name is written in wherever the year itself is the actor (Control Room
 * banners, team scoreboards). Kept here so a re-theme or a fourth cohort is
 * one edit, not a hunt for inline hex triples.
 */
export const TEAM_COLORS = ['#4aa8ff', '#b168ff', '#ffd93d'];

/**
 * Distinct claims per cohort — one per colour (the cohort's shape makes the
 * same colour distinct across years). Twelve per year covers a residency
 * class; if a thirteenth same-year player ever joins, the roster grants
 * duplicates rather than turning anyone away.
 */
export const LOOK_COUNT = COLORS.length;

/** @param {number} i @returns {number} */
export function clampFinish(i) {
  return Number.isInteger(i) && i >= 0 && i < FINISHES.length ? i : 0;
}

/** The middle year. What a player holds before they've chosen. */
export const DEFAULT_COHORT = 1;


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

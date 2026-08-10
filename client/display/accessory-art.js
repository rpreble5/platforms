/**
 * Accessory shapes, as SVG path data.
 *
 * This file is DATA. No canvas, no DOM, no imports — so it can be validated by
 * a Node test, and so adding an accessory is a table edit rather than writing
 * drawing code.
 *
 * ## The artboard
 *
 * Draw on a **100 x 100 board** that maps onto the avatar's body box:
 *
 *   x = 0    left edge of the body        y = 0    top of the head
 *   x = 100  right edge                   y = 36   the eye line
 *                                         y = 100  the feet
 *
 * Negative y is **above the head**, which is where nearly everything belongs:
 * that is the part of the outline seen against open background, and at 30x42 a
 * feature needs about 3px — 10% of the body width — to register at all.
 * Anything drawn inside the body silhouette is invisible from five metres.
 *
 * x may go outside 0-100 freely; `visor` reaches 124 and `phones` spans -14 to
 * 114. Breaking the outline sideways survives being half-occluded in a crowd.
 *
 * **The board stretches.** The body is taller than it is wide, so a circle
 * drawn on the square board comes out as an ellipse on screen — by a factor of
 * 1.05 on a PGY1 and 1.96 on a PGY3. That is deliberate (it is what the code
 * this replaced did) but it does mean you should check your shape on the
 * preview page at `/sprites` rather than trusting the vector tool.
 *
 * ## Adding one
 *
 *   1. Draw it on a 100x100 artboard, export the path, paste it as `d`.
 *   2. Pick a `fill` role — never a literal colour, or it stops matching the
 *      player. See FILL_ROLES below.
 *   3. Declare `reach`: how far outside the body box the art goes, in artboard
 *      units. Nothing sizes off it yet, but the preview page warns when a shape
 *      overflows the sprite canvas and gets silently clipped.
 *   4. Add a matching entry to ACCESSORIES in shared/palette.js, in the index
 *      range of the year that should have it.
 *
 * Parts are drawn in order, each filled and then outlined with the 3px ink
 * stroke; `stroke: false` opts out.
 *
 * @typedef {{d: string, fill: string, stroke?: boolean}} Part
 * @typedef {{reach: {top: number, left: number, right: number}, parts: Part[]}} Art
 */

/**
 * Fill roles, resolved against the player's colour at draw time. Using roles
 * rather than hex is what keeps an accessory recognisably *yours* across all
 * twelve palette colours.
 *
 * The numbers are arguments to `shade()` in sprites.js; `ink` and `glass` are
 * flat because they read as material rather than as body colour.
 */
export const FILL_ROLES = /** @type {const} */ ({
  light: 0.45,
  bright: 0.55,
  dark: -0.35,
  ink: 'rgba(10,12,20,0.92)',
  glass: 'rgba(255,255,255,0.5)',
});

/**
 * Transcribed from the canvas code this replaced. Two kinds of value could not
 * survive the move to a resolution-independent path, both by fractions of a
 * pixel at the sizes in use:
 *
 *   - Absolute pixel constants (`cap`'s 2px lip, `antenna`'s 4px stem,
 *     `shades`' 2px corner) are baked in. They are evaluated at the CROWDED
 *     size rather than at full size: they only existed as pixels in the first
 *     place to protect thin detail on a shrunken avatar, so the size worth
 *     matching is the one where the room is full.
 *   - `Math.max(n, ...)` floors are gone. Most were inactive at every size
 *     drawn; `bonnet`'s brim was the exception — its floor was active
 *     throughout, so the floor became the value.
 *
 * A few numbers look arbitrary because they are cross-axis: `bow`'s loop radius
 * and `antenna`'s ball came from the body *width* and are used vertically, so
 * they carry a w/h factor. That ratio is fixed per year — pools are
 * cohort-locked and both axes scale together — so it bakes in exactly.
 *
 * @type {Record<string, Art>}
 */
export const ACCESSORY_ART = {
  // ---------------------------------------------------------------- PGY1
  bow: {
    reach: { top: 38.14, left: 0, right: 2.1 },
    parts: [
      { fill: 'light',
        d: 'M66 -11 Q29.9 -38.14 33.7 -12.81 Q35.6 8.9 66 -11 Z' },
      { fill: 'light',
        d: 'M66 -11 Q102.1 -38.14 98.3 -12.81 Q96.4 8.9 66 -11 Z' },
      { fill: 'dark',
        d: 'M56.5 -13.71 A9.5 9.05 0 1 1 75.5 -13.71 A9.5 9.05 0 1 1 56.5 -13.71 Z' },
    ],
  },
  bonnet: {
    reach: { top: 26, left: 22, right: 22 },
    parts: [
      { fill: 'light',
        d: 'M-2 0 A52 26 0 0 1 102 0 Z' },
      { fill: 'dark',
        d: 'M-22 0 A72 7.94 0 1 1 122 0 A72 7.94 0 1 1 -22 0 Z' },
    ],
  },
  ears: {
    reach: { top: 54, left: 0, right: 0 },
    parts: [
      { fill: 'light',
        d: 'M15 -26 A13 28 0 1 1 41 -26 A13 28 0 1 1 15 -26 Z' },
      { fill: 'light',
        d: 'M59 -26 A13 28 0 1 1 85 -26 A13 28 0 1 1 59 -26 Z' },
    ],
  },
  curl: {
    reach: { top: 34, left: 0, right: 0 },
    parts: [
      { fill: 'light',
        d: 'M50 0 Q34 -24 60 -30 Q82 -34 66 -14 Q60 -6 50 0 Z' },
    ],
  },

  // ---------------------------------------------------------------- PGY2
  cap: {
    reach: { top: 22, left: 12, right: 2 },
    parts: [
      { fill: 'dark',
        d: 'M-12 -3.57 L102 -3.57 L90 -22 L10 -22 Z' },
    ],
  },
  visor: {
    reach: { top: 15, left: 0, right: 24 },
    parts: [
      { fill: 'light',
        d: 'M8 -2 L124 -6 L120 -15 L8 -14 Z' },
    ],
  },
  antenna: {
    reach: { top: 43.29, left: 0, right: 0 },
    parts: [
      { fill: 'dark',
        d: 'M43.33 -30 L56.67 -30 L56.67 0 L43.33 0 Z' },
      { fill: 'bright',
        d: 'M37 -34 A13 9.29 0 1 1 63 -34 A13 9.29 0 1 1 37 -34 Z' },
    ],
  },
  tuft: {
    reach: { top: 36, left: 0, right: 0 },
    parts: [
      { fill: 'light',
        d: 'M12 0 L26 -30 L40 -8 L52 -36 L64 -8 L78 -26 L88 0 Z' },
    ],
  },

  // ---------------------------------------------------------------- PGY3
  crown: {
    reach: { top: 32, left: 0, right: 0 },
    parts: [
      { fill: 'bright',
        d: 'M6 0 L6 -20 L28 -8 L50 -32 L72 -8 L94 -20 L94 0 Z' },
    ],
  },
  phones: {
    reach: { top: 18, left: 14, right: 14 },
    parts: [
      { fill: 'dark',
        d: 'M-14 10 L-14 -2 Q50 -34 114 -2 L114 10 Q50 -20 -14 10 Z' },
      { fill: 'light',
        d: 'M-29 14 A15 13 0 1 1 1 14 A15 13 0 1 1 -29 14 Z' },
      { fill: 'light',
        d: 'M99 14 A15 13 0 1 1 129 14 A15 13 0 1 1 99 14 Z' },
    ],
  },
  horns: {
    reach: { top: 30, left: 10, right: 10 },
    parts: [
      { fill: 'light',
        d: 'M12 0 Q-10 -18 12 -30 Q18 -16 12 0 Z' },
      { fill: 'light',
        d: 'M88 0 Q110 -18 88 -30 Q82 -16 88 0 Z' },
    ],
  },
  shades: {
    reach: { top: 0, left: 10, right: 10 },
    parts: [
      { fill: 'ink',
        d: 'M-4 22 L104 22 A6 3.06 0 0 1 110 25.06 L110 34.94 A6 3.06 0 0 1 104 38 L-4 38 A6 3.06 0 0 1 -10 34.94 L-10 25.06 A6 3.06 0 0 1 -4 22 Z' },
      { fill: 'glass', stroke: false,
        d: 'M4.67 25 L25.33 25 A6.67 3.4 0 0 1 32 28.4 L32 28.6 A6.67 3.4 0 0 1 25.33 32 L4.67 32 A6.67 3.4 0 0 1 -2 28.6 L-2 28.4 A6.67 3.4 0 0 1 4.67 25 Z' },
    ],
  },
};

/** The artboard is this many units across the body box, in both axes. */
export const ARTBOARD = 100;

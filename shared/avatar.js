/**
 * The bean renderer — the one function that knows what a player looks like.
 *
 * Shared between the display (client/display/sprites.js caches its output
 * per colour x finish x shape x size) and the phone's setup-card preview,
 * which is the whole reason it lives here: one source of truth means the
 * preview a player picks from can never drift from what the projector draws.
 *
 * NO IMPORTS, and no DOM globals — the canvas context comes in as an
 * argument. This file is inlined into the phone page with its `export`
 * keywords stripped (see server/http.js), the same way palette.js is.
 */

/** The theme's ink — the same near-black the stage uses for text and lines. */
export const AVATAR_INK = 'rgba(23,20,42,0.9)';

/**
 * Eye geometry as fractions of the body box — shared by the eyes baked here
 * and the live eyes the display draws when avatar animation is on, so
 * toggling FX.avatarAnim never moves anyone's face.
 */
export const EYES = { x1: 0.33, x2: 0.67, y: 0.36, r: 0.075, rMin: 2.5, color: AVATAR_INK };

/**
 * @param {string} hex #rrggbb
 * @param {number} amt -1..1, toward white above zero and black below
 * @returns {string}
 */
export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const mix = /** @param {number} c */ (c) =>
    Math.max(0, Math.min(255, Math.round(amt >= 0 ? c + (255 - c) * amt : c * (1 + amt))));
  return `rgb(${mix((n >> 16) & 255)},${mix((n >> 8) & 255)},${mix(n & 255)})`;
}

/**
 * The body outline, one per training year — the bean family, one species
 * growing up: egg (PGY1), pill (PGY2), loaf (PGY3). Adds a path to the
 * current one — the caller owns `beginPath`, so fill, clip and stroke can
 * never drift apart.
 *
 * All three occupy exactly the same w x h box. Only the outline changes, so
 * nothing downstream — the eye line, the blush — has to know which shape it
 * is sitting on. Round top vs domed top vs flat top is what still separates
 * them at true crowd size.
 *
 * @param {CanvasRenderingContext2D} cx
 * @param {number} w @param {number} h
 * @param {string} shape 'egg' | 'pill' | 'loaf'
 */
export function avatarBodyPath(cx, w, h, shape) {
  if (shape === 'egg') {
    // Narrow shoulders, full base — the youngest, roundest of the family.
    cx.moveTo(w * 0.5, 0);
    cx.bezierCurveTo(w * 0.8, 0, w * 0.95, h * 0.3, w * 0.98, h * 0.6);
    cx.bezierCurveTo(w * 1.01, h * 0.88, w * 0.8, h, w * 0.5, h);
    cx.bezierCurveTo(w * 0.2, h, w * -0.01, h * 0.88, w * 0.02, h * 0.6);
    cx.bezierCurveTo(w * 0.05, h * 0.3, w * 0.2, 0, w * 0.5, 0);
    cx.closePath();
    return;
  }
  if (shape === 'loaf') {
    // Square shoulders, rounded base — the tallest and sturdiest, and the
    // flat top is where future headgear sits properly.
    const r = w * 0.14;
    cx.moveTo(r, 0);
    cx.lineTo(w - r, 0);
    cx.bezierCurveTo(w * 0.97, 0, w * 0.98, h * 0.06, w * 0.98, h * 0.1);
    cx.lineTo(w * 0.98, h * 0.78);
    cx.bezierCurveTo(w * 0.98, h * 0.95, w * 0.8, h, w * 0.5, h);
    cx.bezierCurveTo(w * 0.2, h, w * 0.02, h * 0.95, w * 0.02, h * 0.78);
    cx.lineTo(w * 0.02, h * 0.1);
    cx.bezierCurveTo(w * 0.02, h * 0.06, w * 0.03, 0, r, 0);
    cx.closePath();
    return;
  }
  // pill: upright and even-sided, softly domed both ends.
  cx.moveTo(w * 0.5, 0);
  cx.bezierCurveTo(w * 0.86, 0, w * 0.97, h * 0.16, w * 0.97, h * 0.34);
  cx.lineTo(w * 0.97, h * 0.68);
  cx.bezierCurveTo(w * 0.97, h * 0.92, w * 0.8, h, w * 0.5, h);
  cx.bezierCurveTo(w * 0.2, h, w * 0.03, h * 0.92, w * 0.03, h * 0.68);
  cx.lineTo(w * 0.03, h * 0.34);
  cx.bezierCurveTo(w * 0.03, h * 0.16, w * 0.14, 0, w * 0.5, 0);
  cx.closePath();
}

/**
 * Draw one bean at the context's origin, w x h. Everything a player is:
 * colour, finish, and their year's body shape.
 *
 * @param {CanvasRenderingContext2D} cx
 * @param {string} color the palette hex
 * @param {string} finish 'flat' (saturated hue, ink outline) or 'pastel'
 *   (hue washed toward white, deep same-hue outline, blush)
 * @param {number} w @param {number} h
 * @param {string} shape 'egg' | 'pill' | 'loaf'
 * @param {boolean} [eyes] false when the caller draws live eyes itself
 */
export function drawBean(cx, color, finish, w, h, shape, eyes = true) {
  const pastel = finish === 'pastel';

  // Body fill: flat keeps the hue nearly full strength; pastel washes it.
  // Both are FLAT fills — no gloss gradient; that belonged to a different
  // game than the terrazzo stage.
  cx.beginPath();
  avatarBodyPath(cx, w, h, shape);
  cx.fillStyle = shade(color, pastel ? 0.45 : 0.12);
  cx.fill();

  if (pastel) {
    // Grounding: a soft same-hue shade pooled at the base, inside the line.
    cx.save();
    cx.beginPath();
    avatarBodyPath(cx, w, h, shape);
    cx.clip();
    cx.globalAlpha = 0.35;
    cx.fillStyle = shade(color, -0.12);
    cx.beginPath();
    cx.ellipse(w / 2, h * 1.06, w * 0.62, h * 0.24, 0, 0, Math.PI * 2);
    cx.fill();
    cx.restore();
  }

  // One confident outline: theme ink on flat, a deep tone of the body's own
  // hue on pastel — never a gray-black.
  cx.beginPath();
  avatarBodyPath(cx, w, h, shape);
  cx.lineWidth = 3;
  cx.strokeStyle = pastel ? shade(color, -0.45) : AVATAR_INK;
  cx.stroke();

  if (pastel) {
    // Blush, the same hue a step deeper. Charm at close range; invisible in
    // a crowd, which is fine — it isn't doing identity work.
    cx.globalAlpha = 0.55;
    cx.fillStyle = shade(color, -0.08);
    cx.beginPath();
    cx.ellipse(w * 0.2, h * 0.47, w * 0.085, h * 0.045, 0, 0, Math.PI * 2);
    cx.ellipse(w * 0.8, h * 0.47, w * 0.085, h * 0.045, 0, 0, Math.PI * 2);
    cx.fill();
    cx.globalAlpha = 1;
  }

  if (eyes) {
    const er = Math.max(EYES.rMin, w * EYES.r);
    cx.fillStyle = EYES.color;
    cx.beginPath();
    cx.arc(w * EYES.x1, h * EYES.y, er, 0, Math.PI * 2);
    cx.arc(w * EYES.x2, h * EYES.y, er, 0, Math.PI * 2);
    cx.fill();
  }
}

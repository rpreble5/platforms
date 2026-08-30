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
 * Accessories that cover the eye zone — the renderer (and the display's
 * live-eye pass) suppress the eyes underneath them.
 * @param {string} key
 * @returns {boolean}
 */
export function accessoryHidesEyes(key) {
  return key === 'sunglasses';
}

/**
 * Draw one bean at the context's origin, w x h. Everything a player is:
 * colour, finish, their year's body shape, and their accessory.
 *
 * @param {CanvasRenderingContext2D} cx
 * @param {string} color the palette hex
 * @param {string} finish a key from palette FINISHES: 'flat' (saturated hue,
 *   ink outline), 'pastel' (hue washed toward white, deep same-hue outline,
 *   blush), 'ghost' (porcelain body, identity in a thick same-hue outline),
 *   'dipped' (flat with the base dunked in a deeper shade), 'glow' (flat
 *   with a soft same-colour aura), 'neon' (near-ink body, the identity in a
 *   luminous same-hue outline — the only dark-bodied finish, so its eyes go
 *   paper: see eyeColorFor), 'jelly' (translucent gummy: washed body, a
 *   deeper same-hue core floating inside, one hard gloss chip), 'snow' (a
 *   cream cap with a wavy hem, like fresh snow on a roof)
 * @param {number} w @param {number} h
 * @param {string} shape 'egg' | 'pill' | 'loaf'
 * @param {boolean} [eyes] false when the caller draws live eyes itself
 * @param {string} [accessory] a key from palette ACCESSORIES; 'none' skips
 */
export function drawBean(cx, color, finish, w, h, shape, eyes = true, accessory = 'none') {
  const pastel = finish === 'pastel';
  const ghost = finish === 'ghost';
  const neon = finish === 'neon';
  const jelly = finish === 'jelly';

  // Body fill: flat keeps the hue nearly full strength; pastel washes it;
  // ghost bleaches it almost to porcelain. All FLAT fills — no gloss
  // gradient; that belonged to a different game than the terrazzo stage.
  cx.beginPath();
  avatarBodyPath(cx, w, h, shape);
  if (finish === 'glow') {
    // The aura: a same-colour shadow baked into the sprite. The cache's
    // 18px pad absorbs the spread.
    cx.save();
    cx.shadowColor = color;
    cx.shadowBlur = 10;
    cx.fillStyle = shade(color, 0.12);
    cx.fill();
    cx.restore();
  } else if (neon) {
    // Night mode: the body goes almost to ink and the COLOUR moves into
    // the outline, with glow's aura underneath. The only dark-bodied
    // finish — instantly findable in a crowd of light beans.
    cx.save();
    cx.shadowColor = color;
    cx.shadowBlur = 12;
    cx.fillStyle = shade(color, -0.62);
    cx.fill();
    cx.restore();
  } else {
    cx.fillStyle = shade(color, ghost ? 0.78 : jelly ? 0.5 : pastel ? 0.45 : 0.12);
    cx.fill();
  }

  if (jelly) {
    // The gummy read is two clipped marks: a deeper same-hue CORE floating
    // low in the body (the bean within the bean), and one hard-edged gloss
    // chip up top — flat white, not a gradient, per the house rule.
    cx.save();
    cx.beginPath();
    avatarBodyPath(cx, w, h, shape);
    cx.clip();
    cx.globalAlpha = 0.55;
    cx.fillStyle = shade(color, -0.05);
    cx.save();
    cx.translate(w * 0.2, h * 0.42);
    cx.scale(0.6, 0.55);
    cx.beginPath();
    avatarBodyPath(cx, w, h, shape);
    cx.fill();
    cx.restore();
    cx.globalAlpha = 1;
    cx.fillStyle = 'rgba(255,255,255,0.55)';
    cx.beginPath();
    cx.ellipse(w * 0.32, h * 0.16, w * 0.2, h * 0.1, -0.5, 0, Math.PI * 2);
    cx.fill();
    cx.restore();
  }

  if (finish === 'snow') {
    // A cream cap with a wavy hem — fresh snowfall on the bean's roof.
    // Same clip technique as dipped, on the other end of the body.
    cx.save();
    cx.beginPath();
    avatarBodyPath(cx, w, h, shape);
    cx.clip();
    cx.fillStyle = shade(color, 0.72);
    cx.beginPath();
    cx.moveTo(-4, -4);
    cx.lineTo(w + 4, -4);
    const hem = h * 0.34;
    cx.lineTo(w + 4, hem);
    for (let i = 4; i >= 0; i--) {
      const x = (i / 4) * w;
      cx.quadraticCurveTo(x + w * 0.1, hem + (i % 2 ? -h * 0.05 : h * 0.07), x, hem);
    }
    cx.closePath();
    cx.fill();
    cx.restore();
  }

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

  if (finish === 'dipped') {
    // The dunk: a hard band of the deeper shade across the base, inside the
    // outline — same clip technique as the pastel grounding, no soft edge.
    cx.save();
    cx.beginPath();
    avatarBodyPath(cx, w, h, shape);
    cx.clip();
    cx.fillStyle = shade(color, -0.32);
    cx.fillRect(0, h * 0.66, w, h * 0.34);
    cx.restore();
  }

  // One confident outline: theme ink on flat, a deep tone of the body's own
  // hue on pastel — never a gray-black. Ghost inverts the deal: the outline
  // IS the colour, thick enough to carry identity on its own.
  cx.beginPath();
  avatarBodyPath(cx, w, h, shape);
  cx.lineWidth = ghost || neon ? 4 : 3;
  if (neon) {
    // The luminous line IS the neon: the tube, with its own soft spill.
    cx.save();
    cx.shadowColor = color;
    cx.shadowBlur = 8;
    cx.strokeStyle = shade(color, 0.15);
    cx.stroke();
    cx.restore();
  } else {
    cx.strokeStyle = ghost ? shade(color, -0.1)
      : pastel ? shade(color, -0.45)
        : jelly ? shade(color, -0.4)
          : AVATAR_INK;
    cx.stroke();
  }

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

  if (eyes && !accessoryHidesEyes(accessory)) {
    const er = Math.max(EYES.rMin, w * EYES.r);
    cx.fillStyle = eyeColorFor(finish);
    cx.beginPath();
    cx.arc(w * EYES.x1, h * EYES.y, er, 0, Math.PI * 2);
    cx.arc(w * EYES.x2, h * EYES.y, er, 0, Math.PI * 2);
    cx.fill();
  }

  drawAccessory(cx, accessory, w, h);
}

/**
 * Eye ink for a finish: the standard ink everywhere, paper on neon — ink
 * eyes vanish on neon's near-ink body. Shared with the display's live
 * blinking eyes (render.js), so the sprite and the live pair can never
 * disagree.
 * @param {string} finish @returns {string}
 */
export function eyeColorFor(finish) {
  return finish === 'neon' ? '#f4f1e8' : EYES.color;
}

/**
 * The accessory painters — pure charm in the bean language: flat fills, the
 * theme ink line, positions as body-box fractions so every piece sits right
 * on all three shapes. All of them stay inside the sprite cache's 18px pad.
 *
 * @param {CanvasRenderingContext2D} cx
 * @param {string} key
 * @param {number} w @param {number} h
 */
export function drawAccessory(cx, key, w, h) {
  const p = ACCESSORY_PAINTERS[key];
  if (p) p(cx, w, h);
}

/** @type {Record<string, (g: CanvasRenderingContext2D, w: number, h: number) => void>} */
const ACCESSORY_PAINTERS = {
  flower(g, w, h) {
    const cx = w * 0.84, cy = h * 0.04, R = w * 0.14;
    g.lineWidth = 2.2;
    g.strokeStyle = AVATAR_INK;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
      g.fillStyle = '#f7b8c8';
      g.beginPath();
      g.ellipse(cx + Math.cos(a) * R, cy + Math.sin(a) * R, R * 0.72, R * 0.72, 0, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    g.fillStyle = '#ffd93d';
    g.beginPath();
    g.arc(cx, cy, R * 0.52, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  },

  sunglasses(g, w, h) {
    const y = h * EYES.y, r = w * 0.16;
    g.lineWidth = 2.4;
    g.strokeStyle = AVATAR_INK;
    g.fillStyle = '#241f3d';
    for (const fx of [EYES.x1, EYES.x2]) {
      g.beginPath();
      g.roundRect(w * fx - r, y - r * 0.85, r * 2, r * 1.7, r * 0.55);
      g.fill();
      g.stroke();
    }
    g.beginPath();
    g.moveTo(w * EYES.x1 + r, y - r * 0.3);
    g.lineTo(w * EYES.x2 - r, y - r * 0.3);
    g.stroke();
    g.beginPath();
    g.moveTo(w * EYES.x1 - r, y - r * 0.3);
    g.lineTo(w * 0.02, y - r * 0.55);
    g.stroke();
    g.beginPath();
    g.moveTo(w * EYES.x2 + r, y - r * 0.3);
    g.lineTo(w * 0.98, y - r * 0.55);
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.5)';
    g.lineWidth = 1.6;
    for (const fx of [EYES.x1, EYES.x2]) {
      g.beginPath();
      g.moveTo(w * fx - r * 0.4, y + r * 0.45);
      g.lineTo(w * fx + r * 0.15, y - r * 0.45);
      g.stroke();
    }
  },

  crown(g, w, h) {
    const s = w * 0.3;
    g.lineWidth = 2.2;
    g.strokeStyle = AVATAR_INK;
    g.fillStyle = '#ffd93d';
    g.beginPath();
    g.moveTo(w * 0.24, 1);
    g.lineTo(w * 0.2, -s * 0.75);
    g.lineTo(w * 0.36, -s * 0.3);
    g.lineTo(w * 0.5, -s * 0.95);
    g.lineTo(w * 0.64, -s * 0.3);
    g.lineTo(w * 0.8, -s * 0.75);
    g.lineTo(w * 0.76, 1);
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = '#d64f63';
    g.beginPath();
    g.arc(w * 0.5, -s * 0.28, w * 0.045, 0, Math.PI * 2);
    g.fill();
  },

  sprout(g, w, h) {
    const cx = w * 0.5;
    g.lineWidth = 2.4;
    g.strokeStyle = AVATAR_INK;
    g.beginPath();
    g.moveTo(cx, 1);
    g.quadraticCurveTo(cx + w * 0.02, -w * 0.12, cx + w * 0.04, -w * 0.18);
    g.stroke();
    g.fillStyle = '#7fc98f';
    g.lineWidth = 2;
    g.beginPath();
    g.ellipse(cx - w * 0.09, -w * 0.2, w * 0.11, w * 0.055, -0.5, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.beginPath();
    g.ellipse(cx + w * 0.16, -w * 0.24, w * 0.11, w * 0.055, 0.45, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  },

  fangs(g, w, h) {
    const cy = h * 0.5, cx = w * 0.5;
    g.strokeStyle = AVATAR_INK;
    g.lineWidth = 2.2;
    g.beginPath();
    g.moveTo(cx - w * 0.14, cy);
    g.quadraticCurveTo(cx, cy + h * 0.02, cx + w * 0.14, cy);
    g.stroke();
    g.lineWidth = 1.6;
    for (const d of [-1, 1]) {
      const fx = cx + d * w * 0.09;
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.moveTo(fx - w * 0.045, cy + h * 0.004);
      g.lineTo(fx + w * 0.045, cy + h * 0.004);
      g.lineTo(fx, cy + h * 0.075);
      g.closePath();
      g.fill();
      g.stroke();
    }
  },

  moustache(g, w, h) {
    const cy = h * 0.485, cx = w * 0.5;
    g.fillStyle = '#241f3d';
    for (const d of [-1, 1]) {
      g.beginPath();
      g.moveTo(cx, cy);
      g.quadraticCurveTo(cx + d * w * 0.13, cy - h * 0.045, cx + d * w * 0.26, cy - h * 0.012);
      g.quadraticCurveTo(cx + d * w * 0.33, cy + h * 0.006, cx + d * w * 0.31, cy - h * 0.045);
      g.quadraticCurveTo(cx + d * w * 0.38, cy + h * 0.02, cx + d * w * 0.24, cy + h * 0.05);
      g.quadraticCurveTo(cx + d * w * 0.1, cy + h * 0.055, cx, cy + h * 0.02);
      g.closePath();
      g.fill();
    }
  },

  monocle(g, w, h) {
    const ex = w * EYES.x2, ey = h * EYES.y, r = w * 0.15;
    g.strokeStyle = AVATAR_INK;
    g.lineWidth = 2.6;
    g.beginPath();
    g.arc(ex, ey, r, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = 'rgba(210,225,245,0.35)';
    g.beginPath();
    g.arc(ex, ey, r - 1.3, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(ex + r * 0.7, ey + r * 0.7);
    g.quadraticCurveTo(ex + r * 1.4, ey + r * 2.2, ex + r * 0.9, ey + r * 3.1);
    g.stroke();
  },

  beret(g, w, h) {
    g.fillStyle = '#d64f63';
    g.strokeStyle = AVATAR_INK;
    g.lineWidth = 2.2;
    g.beginPath();
    g.ellipse(w * 0.42, h * 0.015, w * 0.34, w * 0.13, -0.12, Math.PI, 0);
    g.closePath();
    g.fill();
    g.stroke();
    g.beginPath();
    g.arc(w * 0.42, -w * 0.13, w * 0.045, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  },

  party(g, w, h) {
    const ht = w * 0.42, half = w * 0.19;
    g.save();
    g.translate(w * 0.5, h * 0.02);
    g.rotate(-0.08);
    g.fillStyle = '#5fb8a5';
    g.strokeStyle = AVATAR_INK;
    g.lineWidth = 2.2;
    g.beginPath();
    g.moveTo(-half, 0);
    g.lineTo(half, 0);
    g.lineTo(0, -ht);
    g.closePath();
    g.fill();
    g.stroke();
    g.save();
    g.beginPath();
    g.moveTo(-half, 0);
    g.lineTo(half, 0);
    g.lineTo(0, -ht);
    g.closePath();
    g.clip();
    g.fillStyle = '#f7b8c8';
    g.beginPath();
    g.moveTo(-half * 0.9, -ht * 0.28);
    g.lineTo(half * 0.9, -ht * 0.52);
    g.lineTo(half * 0.9, -ht * 0.34);
    g.lineTo(-half * 0.9, -ht * 0.1);
    g.closePath();
    g.fill();
    g.restore();
    g.fillStyle = '#ffd93d';
    g.beginPath();
    g.arc(0, -ht, w * 0.055, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.restore();
  },

  propeller(g, w, h) {
    const cx = w * 0.5, y0 = h * 0.02;
    g.fillStyle = '#d64f63';
    g.strokeStyle = AVATAR_INK;
    g.lineWidth = 2.2;
    g.beginPath();
    g.ellipse(cx, y0 + 1, w * 0.3, w * 0.17, 0, Math.PI, 0);
    g.closePath();
    g.fill();
    g.stroke();
    g.beginPath();
    g.moveTo(cx, y0 - w * 0.16);
    g.lineTo(cx, y0 - w * 0.26);
    g.stroke();
    for (const d of [-1, 1]) {
      g.fillStyle = d < 0 ? '#ffd93d' : '#4aa8ff';
      g.beginPath();
      g.ellipse(cx + d * w * 0.14, y0 - w * 0.27, w * 0.13, w * 0.05, d * 0.12, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    g.fillStyle = '#241f3d';
    g.beginPath();
    g.arc(cx, y0 - w * 0.27, w * 0.028, 0, Math.PI * 2);
    g.fill();
  },

  tophat(g, w, h) {
    const cx = w * 0.5, y0 = h * 0.015;
    g.fillStyle = '#241f3d';
    g.strokeStyle = AVATAR_INK;
    g.lineWidth = 2.2;
    g.beginPath();
    g.roundRect(cx - w * 0.3, y0 - w * 0.045, w * 0.6, w * 0.075, w * 0.03);
    g.fill();
    g.stroke();
    g.beginPath();
    g.roundRect(cx - w * 0.19, y0 - w * 0.42, w * 0.38, w * 0.39, [w * 0.04, w * 0.04, 0, 0]);
    g.fill();
    g.stroke();
    g.fillStyle = '#d64f63';
    g.fillRect(cx - w * 0.19 + 1.1, y0 - w * 0.14, w * 0.38 - 2.2, w * 0.075);
  },

  cowboy(g, w, h) {
    const cx = w * 0.5, y0 = h * 0.015;
    g.fillStyle = '#c9a26b';
    g.strokeStyle = AVATAR_INK;
    g.lineWidth = 2.2;
    g.beginPath();
    g.ellipse(cx, y0 - w * 0.1, w * 0.17, w * 0.15, 0, Math.PI, 0);
    g.closePath();
    g.fill();
    g.stroke();
    g.beginPath();
    g.moveTo(cx - w * 0.34, y0 - w * 0.06);
    g.quadraticCurveTo(cx - w * 0.38, y0 + w * 0.05, cx - w * 0.24, y0 + w * 0.03);
    g.quadraticCurveTo(cx, y0 + w * 0.085, cx + w * 0.24, y0 + w * 0.03);
    g.quadraticCurveTo(cx + w * 0.38, y0 + w * 0.05, cx + w * 0.34, y0 - w * 0.06);
    g.quadraticCurveTo(cx + w * 0.12, y0 - w * 0.02, cx, y0 - w * 0.02);
    g.quadraticCurveTo(cx - w * 0.12, y0 - w * 0.02, cx - w * 0.34, y0 - w * 0.06);
    g.closePath();
    g.fill();
    g.stroke();
  },

  beanie(g, w, h) {
    const cx = w * 0.5, y0 = h * 0.03;
    g.fillStyle = '#4a6da8';
    g.strokeStyle = AVATAR_INK;
    g.lineWidth = 2.2;
    g.beginPath();
    g.ellipse(cx, y0, w * 0.31, w * 0.24, 0, Math.PI, 0);
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = '#3c5a8c';
    g.beginPath();
    g.roundRect(cx - w * 0.32, y0 - w * 0.02, w * 0.64, w * 0.09, w * 0.03);
    g.fill();
    g.stroke();
    g.fillStyle = '#f6f1ea';
    g.beginPath();
    g.arc(cx, y0 - w * 0.26, w * 0.07, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  },

  halo(g, w, h) {
    // A floating ring: ink edging first, gold over it, and a visible gap of
    // air between ring and crown — the gap is what reads at distance.
    const cx = w * 0.5, cy = -w * 0.28;
    g.strokeStyle = AVATAR_INK;
    g.lineWidth = 6;
    g.beginPath();
    g.ellipse(cx, cy, w * 0.24, w * 0.085, 0, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = '#ffd93d';
    g.lineWidth = 3.4;
    g.beginPath();
    g.ellipse(cx, cy, w * 0.24, w * 0.085, 0, 0, Math.PI * 2);
    g.stroke();
  },

  catears(g, w, h) {
    g.lineWidth = 2.2;
    g.strokeStyle = AVATAR_INK;
    for (const d of [-1, 1]) {
      const bx = w * (0.5 + d * 0.24);
      g.fillStyle = '#5a5266';
      g.beginPath();
      g.moveTo(bx - d * w * 0.15, h * 0.03);
      g.lineTo(bx + d * w * 0.09, -w * 0.24);
      g.lineTo(bx + d * w * 0.14, h * 0.06);
      g.closePath();
      g.fill();
      g.stroke();
      g.fillStyle = '#f7b8c8';
      g.beginPath();
      g.moveTo(bx - d * w * 0.06, h * 0.025);
      g.lineTo(bx + d * w * 0.075, -w * 0.15);
      g.lineTo(bx + d * w * 0.1, h * 0.04);
      g.closePath();
      g.fill();
    }
  },
};

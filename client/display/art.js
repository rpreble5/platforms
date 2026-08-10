/**
 * Sprite loading and the two drawing helpers a game engine would give you for
 * free: 3-slice and tiling.
 *
 * Everything here degrades. If an asset is missing the loader records it and
 * carries on, and every call site has a procedural fallback — so the game runs
 * with an empty assets/ directory, and you can drop files in one at a time and
 * see each one appear. That matters more than usual here: the thing must still
 * start on a laptop at a party even if someone deleted a PNG.
 */

/** @type {Record<string, HTMLImageElement>} */
export const art = {};

export const artState = {
  loaded: false,
  /** @type {string[]} names that failed to load — drawn procedurally instead */
  missing: [],
};

/**
 * Display-space geometry for each sprite. Source files are authored at 2x
 * these numbers; see docs/ART-SPEC.md, which is generated from this table.
 */
export const SPRITES = /** @type {const} */ ({
  // Full-screen backdrop. No alpha needed.
  bg: { url: '/assets/bg.png', w: 1920, h: 1080 },
  // The answer signboard: 3-slice horizontally, fixed height, variable width.
  // `cap` is in SOURCE pixels — the fixed end pieces that must not stretch.
  platform: { url: '/assets/platform.png', h: 76, cap: 128 },
  // Ground. Tiles horizontally; only the top ~100px is ever on screen.
  floor: { url: '/assets/floor.png', w: 256, h: 120 },
});

/**
 * Load everything, tolerating gaps. Await this before the first frame so text
 * metrics and sprites are settled — otherwise the first cached label is
 * measured in the fallback font and stays wrong forever.
 */
export async function loadArt() {
  artState.missing = [];
  await Promise.all(
    Object.entries(SPRITES).map(async ([name, spec]) => {
      try {
        const img = new Image();
        img.src = spec.url;
        await img.decode();
        art[name] = img;
      } catch {
        artState.missing.push(name);
      }
    })
  );
  artState.loaded = true;
  return artState;
}

/** @param {string} name @returns {boolean} */
export function has(name) {
  return art[name] !== undefined;
}

/**
 * Horizontal 3-slice — what Unity calls a Sliced sprite, restricted to the one
 * axis that varies here. The end caps draw at their authored size so corners
 * and bevels keep their shape; only the middle stretches.
 *
 * Answer platforms are 400px wide with four answers and 860 with two, so the
 * middle stretches between about 4x and 11x. That is invisible on a flat fill
 * and very visible on a texture — keep detail in the caps.
 *
 * @param {CanvasRenderingContext2D} cx
 * @param {HTMLImageElement} img
 * @param {number} capSrc width of each end cap, in SOURCE pixels
 * @param {number} x @param {number} y @param {number} w @param {number} h
 */
export function draw3Slice(cx, img, capSrc, x, y, w, h) {
  const sh = img.naturalHeight;
  const sw = img.naturalWidth;
  const scale = h / sh;
  // Cap width in destination pixels, never more than half the target.
  const cap = Math.min(capSrc * scale, w / 2);
  const midSrc = Math.max(1, sw - capSrc * 2);
  const midDst = Math.max(0, w - cap * 2);

  cx.drawImage(img, 0, 0, capSrc, sh, x, y, cap, h);
  if (midDst > 0) cx.drawImage(img, capSrc, 0, midSrc, sh, x + cap, y, midDst, h);
  cx.drawImage(img, sw - capSrc, 0, capSrc, sh, x + w - cap, y, cap, h);
}

/** @type {Map<string, CanvasPattern>} */
const patterns = new Map();

/**
 * Repeat a tile across a rect.
 *
 * The translate matters: canvas patterns anchor to the canvas origin, not to
 * the rect you're filling, so without it the tile seams land wherever they
 * happen to land rather than at the edge of your shape.
 *
 * @param {CanvasRenderingContext2D} cx
 * @param {HTMLImageElement} img
 * @param {number} x @param {number} y @param {number} w @param {number} h
 * @param {number} [tileW] display width of one tile; scales the pattern
 */
export function drawTiled(cx, img, x, y, w, h, tileW) {
  const key = `${img.src}|${tileW ?? 0}`;
  let pat = patterns.get(key);
  if (!pat) {
    const made = cx.createPattern(img, 'repeat');
    if (!made) return;
    pat = made;
    patterns.set(key, pat);
  }
  const scale = tileW ? tileW / img.naturalWidth : 1;
  cx.save();
  cx.translate(x, y);
  if (scale !== 1) cx.scale(scale, scale);
  cx.fillStyle = pat;
  cx.fillRect(0, 0, w / (scale || 1), h / (scale || 1));
  cx.restore();
}

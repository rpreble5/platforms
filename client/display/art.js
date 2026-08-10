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
 * Where each sprite lives, and the only display-space numbers the *game* owns
 * rather than the file. Everything else — cell size, aspect, source
 * dimensions — is read off the image at load time, so any resolution works and
 * a new file never needs a matching code change.
 */
export const SPRITES = /** @type {const} */ ({
  // Full-screen backdrop, 16:9, stretched to fill.
  bg: { url: '/assets/bg.png' },
  // A 3x3 tilesheet. Corners placed once, middle column repeated across.
  platform: { url: '/assets/platform.png' },
  // One square tile, repeated horizontally at this display width.
  floor: { url: '/assets/floor.png', w: 256 },
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
 * Draw a box of any width from a 3x3 tilesheet: corners placed once, the middle
 * column repeated across to fill.
 *
 * Repeating rather than stretching is the whole point. A stretched sprite
 * smears anything that isn't a flat fill, and it pins every board to one shape;
 * a tiled one renders any width at native resolution, which is what makes
 * boards of different sizes free.
 *
 * Nothing here assumes a particular file size — the cell is a third of whatever
 * was loaded, so a 192px sheet and a 768px sheet both just work.
 *
 * @param {CanvasRenderingContext2D} cx
 * @param {HTMLImageElement} img 3x3 sheet, square
 * @param {number} x @param {number} y @param {number} w @param {number} h
 */
export function drawTileBox(cx, img, x, y, w, h) {
  const cell = img.naturalWidth / 3;
  if (!cell || w <= 0 || h <= 0) return;

  const rowH = h / 3;
  const scale = rowH / cell;
  // End cells keep their aspect, but never eat more than half the box — a board
  // narrower than two tiles is better as two squeezed ends than as an end and
  // a hole.
  const capW = Math.min(cell * scale, w / 2);
  const midW = Math.max(0, w - capW * 2);

  for (let row = 0; row < 3; row++) {
    const sy = row * cell;
    const dy = y + row * rowH;

    cx.drawImage(img, 0, sy, cell, cell, x, dy, capW, rowH);
    cx.drawImage(img, 2 * cell, sy, cell, cell, x + w - capW, dy, capW, rowH);

    if (midW <= 0) continue;
    const pat = middlePattern(cx, img, row, cell);
    if (!pat) continue;
    cx.save();
    // Half a pixel of overlap under each end cell. The canvas is scaled to the
    // screen, so a butt joint between fill and cap lands on a fractional device
    // pixel and shows as a hairline of background. Tucking the fill under the
    // caps hides it without touching the rounded outer corners.
    cx.beginPath();
    cx.rect(x + capW - 0.5, dy, midW + 1, rowH);
    cx.clip();
    cx.translate(x + capW - 0.5, dy);
    cx.scale(scale, scale);
    cx.fillStyle = pat;
    cx.fillRect(0, 0, (midW + 1) / scale, cell);
    cx.restore();
  }
}

/** @type {Map<string, CanvasPattern|null>} */
const cellPatterns = new Map();

/**
 * A repeating pattern built from one middle-column cell. Going through a
 * pattern rather than a drawImage loop leaves the repetition to the browser, so
 * there are no seams between copies however the canvas is scaled.
 *
 * @param {CanvasRenderingContext2D} cx
 * @param {HTMLImageElement} img @param {number} row @param {number} cell
 * @returns {CanvasPattern|null}
 */
function middlePattern(cx, img, row, cell) {
  const key = `${img.src}|${row}`;
  const hit = cellPatterns.get(key);
  if (hit !== undefined) return hit;

  const off = document.createElement('canvas');
  off.width = cell;
  off.height = cell;
  const ocx = off.getContext('2d');
  let pat = null;
  if (ocx) {
    ocx.drawImage(img, cell, row * cell, cell, cell, 0, 0, cell, cell);
    pat = cx.createPattern(off, 'repeat');
  }
  cellPatterns.set(key, pat);
  return pat;
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

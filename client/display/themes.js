/**
 * Level themes. A theme is a package — sky, floor, boards, perches and reveal
 * treatment designed together — never just a background swap.
 *
 * The default is `terrazzo`: a warm off-white field with sparse pastel chips,
 * pale board faces, and the structural surfaces (landing tops and the ground)
 * cut dark in the level's hue. The board colourway ROTATES per question —
 * same geometry, fresh level feel each round, at zero cost. Rotation is
 * deterministic from the question index so a restart replays identically.
 *
 * `dusk` is the original night look, kept whole; packs opt in with
 * `"theme": "dusk"`.
 *
 * Light backgrounds won on purpose: projectors in half-lit rooms render
 * bright fields far better than dark ones (dark exposes their weak black
 * levels), and the twelve saturated player colours pop hardest against the
 * dark floor cut. The chips are STATIC — the celebration confetti is the only
 * confetti-shaped thing that ever moves.
 */

/**
 * @typedef {object} Way a board colourway plus its dark floor cut
 * @property {string} key
 * @property {string} edge board rim
 * @property {string} face board face (carries the answer text)
 * @property {string} top landing surface — darker than the face, on purpose
 * @property {string} text ink for answer text on the face
 * @property {string} fBody floor body
 * @property {string} fTop floor's top strip
 * @property {string} fEdge floor's shadow line
 */

/**
 * Ordered so neighbouring questions never land on similar hues.
 * @type {Way[]}
 */
export const WAYS = [
  { key: 'red', edge: '#cf8080', face: '#f4c2c2', top: '#a85555', text: '#4a2c2c',
    fBody: '#452323', fTop: '#5c3030', fEdge: '#341a1a' },
  { key: 'teal', edge: '#7cb0aa', face: '#c1e0dc', top: '#54857f', text: '#2a403c',
    fBody: '#1e332f', fTop: '#2a4540', fEdge: '#152622' },
  { key: 'amber', edge: '#cfa868', face: '#f2dcae', top: '#a37f42', text: '#483a20',
    fBody: '#3c2f18', fTop: '#524022', fEdge: '#2d2311' },
  { key: 'violet', edge: '#a48cc4', face: '#dacdec', top: '#7c649e', text: '#3a3048',
    fBody: '#2e2540', fTop: '#3e3254', fEdge: '#221b30' },
  { key: 'green', edge: '#85b58c', face: '#c6e2ca', top: '#5e8f66', text: '#2c4032',
    fBody: '#22331f', fTop: '#31452c', fEdge: '#192717' },
  { key: 'blue', edge: '#83a3cc', face: '#c4d8ee', top: '#5c7ba3', text: '#2c3a4e',
    fBody: '#20293c', fTop: '#2c3a52', fEdge: '#181f2e' },
];

export const TERRAZZO_BG = '#f6f2ea';

/** Chip tints for the terrazzo field. */
const CHIPS = [
  'rgba(242,170,170,0.5)',
  'rgba(150,204,188,0.5)',
  'rgba(158,182,226,0.45)',
  'rgba(240,208,140,0.5)',
  'rgba(196,170,214,0.45)',
];

/**
 * The `glass` theme: a smooth colour-field gradient with big soft light blobs,
 * and every platform drawn as a chunk of frosted glass with the answer INSIDE
 * it. Canvas has no backdrop-filter, but blurring a smooth gradient is a
 * visual no-op — so translucent white panels over this sky read as real glass
 * at zero per-frame cost.
 *
 * @typedef {object} GlassFamily
 * @property {string} key
 * @property {[string, string, string]} stops gradient top → mid → bottom
 * @property {Array<{x:number, y:number, r:number, c:string}>} blobs
 *   pre-blurred light shapes: fractional centre/radius, centre colour
 *   (fades to its own zero-alpha, never to grey)
 * @property {string} glassFill panel body
 * @property {string} glassRim panel border
 * @property {string} text answer ink on the glass
 * @property {string} textDim wrong-answer ink
 * @property {string} floorBody
 * @property {string} floorTop
 * @property {string} floorEdge
 */

/** @type {Record<string, GlassFamily>} */
export const GLASS_FAMILIES = {
  dusk: {
    key: 'dusk',
    stops: ['#3b2670', '#63307f', '#1d1546'],
    blobs: [
      { x: 0.2, y: 0.3, r: 0.32, c: 'rgba(255,140,180,0.22)' },
      { x: 0.79, y: 0.2, r: 0.28, c: 'rgba(122,162,255,0.24)' },
      { x: 0.55, y: 0.74, r: 0.4, c: 'rgba(168,96,228,0.18)' },
    ],
    glassFill: 'rgba(255,255,255,0.13)',
    glassRim: 'rgba(255,255,255,0.45)',
    text: 'rgba(255,255,255,0.96)',
    textDim: 'rgba(255,255,255,0.45)',
    floorBody: '#171038',
    floorTop: '#241a4e',
    floorEdge: 'rgba(255,255,255,0.22)',
  },
  ocean: {
    key: 'ocean',
    stops: ['#0d3f66', '#127a86', '#071f3c'],
    blobs: [
      { x: 0.24, y: 0.26, r: 0.32, c: 'rgba(120,235,255,0.20)' },
      { x: 0.76, y: 0.34, r: 0.3, c: 'rgba(90,255,190,0.16)' },
      { x: 0.5, y: 0.78, r: 0.42, c: 'rgba(80,150,255,0.18)' },
    ],
    glassFill: 'rgba(255,255,255,0.13)',
    glassRim: 'rgba(255,255,255,0.45)',
    text: 'rgba(255,255,255,0.96)',
    textDim: 'rgba(255,255,255,0.45)',
    floorBody: '#081a30',
    floorTop: '#0e2a45',
    floorEdge: 'rgba(255,255,255,0.22)',
  },
  frost: {
    key: 'frost',
    stops: ['#e6eefa', '#f3ecf6', '#c8d7ec'],
    blobs: [
      { x: 0.22, y: 0.3, r: 0.34, c: 'rgba(255,170,190,0.30)' },
      { x: 0.76, y: 0.22, r: 0.3, c: 'rgba(140,180,255,0.30)' },
      { x: 0.52, y: 0.76, r: 0.42, c: 'rgba(170,140,235,0.22)' },
    ],
    // Light field: the glass needs more body and a hard rim or it vanishes.
    glassFill: 'rgba(255,255,255,0.42)',
    glassRim: 'rgba(255,255,255,0.95)',
    text: 'rgba(35,32,66,0.95)',
    textDim: 'rgba(35,32,66,0.45)',
    floorBody: '#39406a',
    floorTop: '#4a5280',
    floorEdge: 'rgba(255,255,255,0.35)',
  },
};

let glassFamilyKey = 'dusk';

/** @param {string | undefined} key unknown keys fall back to dusk */
export function setGlassFamily(key) {
  glassFamilyKey = key && key in GLASS_FAMILIES ? key : 'dusk';
}

/** @returns {GlassFamily} */
export function glassFam() {
  return GLASS_FAMILIES[glassFamilyKey];
}

/**
 * The glass sky: one smooth diagonal gradient plus a few big radial light
 * blobs. Static, like the terrazzo chips — the blobs already look blurred,
 * which is the whole trick.
 * @param {CanvasRenderingContext2D} cx
 * @param {number} w @param {number} h
 */
export function drawGlassSky(cx, w, h) {
  const f = glassFam();
  const g = cx.createLinearGradient(0, 0, w * 0.22, h);
  g.addColorStop(0, f.stops[0]);
  g.addColorStop(0.55, f.stops[1]);
  g.addColorStop(1, f.stops[2]);
  cx.fillStyle = g;
  cx.fillRect(0, 0, w, h);

  for (const b of f.blobs) {
    const r = b.r * w;
    const rg = cx.createRadialGradient(b.x * w, b.y * h, 0, b.x * w, b.y * h, r);
    rg.addColorStop(0, b.c);
    // Fade to the same hue at zero alpha — fading to transparent black greys
    // the midfield out.
    rg.addColorStop(1, b.c.replace(/[\d.]+\)$/, '0)'));
    cx.fillStyle = rg;
    cx.fillRect(b.x * w - r, b.y * h - r, r * 2, r * 2);
  }
}

const THEMES = /** @type {const} */ (['terrazzo', 'dusk', 'glass']);

let themeKey = 'terrazzo';
let way = WAYS[1]; // teal: the lobby/showdown resting colourway

/** @param {string | undefined} key unknown keys fall back to terrazzo */
export function setTheme(key) {
  themeKey = THEMES.includes(/** @type {any} */ (key)) ? /** @type {string} */ (key) : 'terrazzo';
}

/** @returns {string} */
export function themeName() {
  return themeKey;
}

/**
 * The colourway for a round. -1 (lobby, showdown) rests on teal; question
 * indexes rotate through the table.
 * @param {number} qIndex
 * @returns {Way}
 */
export function wayFor(qIndex) {
  return qIndex < 0 ? WAYS[1] : WAYS[qIndex % WAYS.length];
}

/**
 * Set the active colourway for this frame. Called once per frame by the main
 * loop so every stage draw call agrees on the round's colours without
 * threading a parameter through all of them.
 * @param {number} qIndex
 */
export function setRound(qIndex) {
  way = wayFor(qIndex);
}

/** @returns {Way} */
export function activeWay() {
  return way;
}

/**
 * The terrazzo field: warm off-white with a deterministic scatter of pastel
 * chips. Static by design — a calm surface, not a screensaver.
 * @param {CanvasRenderingContext2D} cx
 * @param {number} w @param {number} h
 */
export function drawTerrazzoSky(cx, w, h) {
  cx.fillStyle = TERRAZZO_BG;
  cx.fillRect(0, 0, w, h);

  for (let i = 0; i < 46; i++) {
    const x = (i * 419) % w;
    const y = ((i * 731) % (h - 220)) + 30;
    const r = 6 + ((i * 37) % 12);
    cx.save();
    cx.translate(x, y);
    cx.rotate(((i * 53) % 180) * 0.0175);
    cx.fillStyle = CHIPS[i % CHIPS.length];
    if (i % 4 === 0) {
      cx.beginPath();
      cx.moveTo(-r, r * 0.6);
      cx.lineTo(0, -r);
      cx.lineTo(r, r * 0.4);
      cx.closePath();
      cx.fill();
    } else {
      cx.beginPath();
      cx.roundRect(-r, -r * 0.7, r * 2, r * 1.4, r * 0.5);
      cx.fill();
    }
    cx.restore();
  }
}

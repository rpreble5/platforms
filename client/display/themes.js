/**
 * Level themes. A theme is a package — sky, floor, boards, perches and reveal
 * treatment designed together — never just a background swap.
 *
 * The default is `glass`: a smooth gradient field with big soft light blobs,
 * every platform a chunk of frosted glass with its answer inside, and subtle
 * reflections of the players standing on it (see GLASS_FAMILIES below).
 *
 * `terrazzo` is the light alternative — a warm off-white field with sparse
 * pastel chips, pale board faces, and the structural surfaces cut dark in the
 * level's hue, ROTATING per question. It exists because projectors in
 * half-lit rooms render bright fields far better than dark ones; if the venue
 * projector washes the glass gradients out, packs switch with
 * `"theme": "terrazzo"`. `dusk` is the original night look, kept whole.
 *
 * Decoration is STATIC, with one deliberate exception: the glass sky
 * BREATHES — its blobs drift and glow on ~20s cycles (FX.skyBreathe), slow
 * enough to feel, too slow to watch. The frosted panels track it: their
 * blurred base is static but the live blobs composite into every panel clip
 * (drawFrostBlobs), so the glass keeps "blurring" the sky it stands in
 * front of. Everything else holds still; the celebration confetti is the
 * only confetti-shaped thing that ever moves.
 */

import { FX } from '../../shared/tuning.js';

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
 * @property {boolean} [light] a light field: ink-side text everywhere the
 *   dark families use paper, and more veil/body on the glass
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
    stops: ['#06152f', '#073b58', '#061128'],
    blobs: [
      { x: 0.08, y: 0.14, r: 0.42, c: 'rgba(40,215,255,0.23)' },
      { x: 0.88, y: 0.1, r: 0.4, c: 'rgba(41,102,255,0.21)' },
      { x: 0.82, y: 0.88, r: 0.46, c: 'rgba(23,225,170,0.19)' },
      { x: 0.2, y: 0.86, r: 0.44, c: 'rgba(84,66,235,0.18)' },
    ],
    glassFill: 'rgba(255,255,255,0.13)',
    glassRim: 'rgba(255,255,255,0.45)',
    text: 'rgba(255,255,255,0.96)',
    textDim: 'rgba(255,255,255,0.45)',
    floorBody: '#081a30',
    floorTop: '#0e2a45',
    floorEdge: 'rgba(255,255,255,0.22)',
  },
  aurora: {
    key: 'aurora',
    stops: ['#090d2b', '#17204a', '#140b32'],
    blobs: [
      { x: 0.06, y: 0.18, r: 0.43, c: 'rgba(20,233,193,0.23)' },
      { x: 0.88, y: 0.12, r: 0.42, c: 'rgba(73,103,255,0.24)' },
      { x: 0.9, y: 0.9, r: 0.48, c: 'rgba(213,63,250,0.19)' },
      { x: 0.16, y: 0.9, r: 0.46, c: 'rgba(58,128,241,0.18)' },
    ],
    glassFill: 'rgba(255,255,255,0.13)',
    glassRim: 'rgba(214,242,255,0.48)',
    text: 'rgba(255,255,255,0.96)',
    textDim: 'rgba(255,255,255,0.45)',
    floorBody: '#080d29',
    floorTop: '#131b43',
    floorEdge: 'rgba(188,235,255,0.24)',
  },
  berry: {
    key: 'berry',
    stops: ['#210a2f', '#521638', '#170b2b'],
    blobs: [
      { x: 0.08, y: 0.12, r: 0.43, c: 'rgba(255,92,119,0.23)' },
      { x: 0.9, y: 0.12, r: 0.42, c: 'rgba(255,171,71,0.20)' },
      { x: 0.88, y: 0.9, r: 0.46, c: 'rgba(177,62,235,0.23)' },
      { x: 0.12, y: 0.88, r: 0.45, c: 'rgba(231,45,153,0.19)' },
    ],
    glassFill: 'rgba(255,245,250,0.13)',
    glassRim: 'rgba(255,226,235,0.46)',
    text: 'rgba(255,250,252,0.97)',
    textDim: 'rgba(255,235,240,0.46)',
    floorBody: '#180a19',
    floorTop: '#311328',
    floorEdge: 'rgba(255,214,224,0.23)',
  },
  frost: {
    key: 'frost',
    light: true,
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
  noir: {
    key: 'noir',
    // Near-black field, colour only as glow: saturated blooms hug the edges
    // and the bottom at alphas well above the other dark families, so the
    // breathe's rainbow reads as neon light bleeding into a dark room while
    // the top of the frame stays black. Modelled on the phone-wallpaper
    // look: black up top, prism low.
    stops: ['#020204', '#0a0c1e', '#040308'],
    blobs: [
      { x: 0.0, y: 0.46, r: 0.38, c: 'rgba(35,90,255,0.4)' },
      { x: 0.04, y: 0.78, r: 0.4, c: 'rgba(0,225,160,0.42)' },
      { x: 0.98, y: 0.52, r: 0.46, c: 'rgba(255,35,125,0.44)' },
      { x: 0.48, y: 1.06, r: 0.52, c: 'rgba(255,165,25,0.4)' },
    ],
    glassFill: 'rgba(255,255,255,0.10)',
    glassRim: 'rgba(255,255,255,0.42)',
    text: 'rgba(255,255,255,0.96)',
    textDim: 'rgba(255,255,255,0.45)',
    floorBody: '#0a0a12',
    floorTop: '#16161f',
    floorEdge: 'rgba(255,255,255,0.2)',
  },
  blanc: {
    key: 'blanc',
    light: true,
    // noir's twin: the same saturated blooms in the same places, but poured
    // over a near-white field — colour as candy wash instead of neon glow.
    // Alphas sit a notch under noir's; on white the pigment tints rather
    // than glows, and full strength swallowed the ink text.
    stops: ['#fdfdfe', '#f7f6f9', '#eef0f4'],
    blobs: [
      { x: 0.0, y: 0.46, r: 0.38, c: 'rgba(35,90,255,0.30)' },
      { x: 0.04, y: 0.78, r: 0.4, c: 'rgba(0,205,150,0.32)' },
      { x: 0.98, y: 0.52, r: 0.46, c: 'rgba(255,35,125,0.32)' },
      { x: 0.48, y: 1.06, r: 0.52, c: 'rgba(255,160,25,0.30)' },
    ],
    glassFill: 'rgba(255,255,255,0.5)',
    glassRim: 'rgba(255,255,255,0.95)',
    text: 'rgba(38,36,48,0.95)',
    textDim: 'rgba(38,36,48,0.45)',
    floorBody: '#2c2c34',
    floorTop: '#3c3c46',
    floorEdge: 'rgba(255,255,255,0.35)',
  },
  cream: {
    key: 'cream',
    light: true,
    // A warm off-white field — terrazzo's daylight temperature with the
    // glass language, built for the breathing rainbow: the saturated blobs
    // wash the cream like light through a window.
    stops: ['#f8f2e5', '#f4e9d8', '#ecdfc9'],
    blobs: [
      { x: 0.18, y: 0.26, r: 0.36, c: 'rgba(255,145,155,0.34)' },
      { x: 0.8, y: 0.2, r: 0.34, c: 'rgba(135,175,255,0.32)' },
      { x: 0.58, y: 0.76, r: 0.42, c: 'rgba(255,190,105,0.30)' },
      { x: 0.1, y: 0.84, r: 0.38, c: 'rgba(120,215,180,0.28)' },
    ],
    glassFill: 'rgba(255,255,255,0.5)',
    glassRim: 'rgba(255,255,255,0.95)',
    text: 'rgba(64,50,40,0.95)',
    textDim: 'rgba(64,50,40,0.45)',
    floorBody: '#40382e',
    floorTop: '#51473b',
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
 * blobs — the blobs already look blurred, which is the whole trick. (A
 * "rich" style with ribbons, bokeh dust, vignette and film grain was built,
 * previewed and cut — classic plus the breathe is the look.)
 * @param {CanvasRenderingContext2D} cx
 * @param {number} w @param {number} h
 */
export function drawGlassSky(cx, w, h, t = 0) {
  // The module sky clock: the sky is the first thing drawn each frame, so
  // everything that composites live blobs later in the same frame (the
  // frosted panels, via drawFrostBlobs) agrees on this t without threading
  // a parameter through every panel call site — same pattern as setRound().
  skyT = t;
  const f = glassFam();
  const g = cx.createLinearGradient(0, 0, w * 0.22, h);
  g.addColorStop(0, f.stops[0]);
  g.addColorStop(0.55, f.stops[1]);
  g.addColorStop(1, f.stops[2]);
  cx.fillStyle = g;
  cx.fillRect(0, 0, w, h);
  drawGlassBlobs(cx, w, h, f, t);
}

/** World time of the current frame's sky, recorded by drawGlassSky. */
let skyT = 0;

const TAU = Math.PI * 2;

/**
 * Blob colours parsed once per distinct rgba string — the per-frame path
 * only does arithmetic and template strings.
 * @type {Map<string, {h:number, s:number, l:number, a:number}>}
 */
const HSLA_CACHE = new Map();

/** @param {string} rgba @returns {{h:number, s:number, l:number, a:number}} */
function hslaOf(rgba) {
  let v = HSLA_CACHE.get(rgba);
  if (v) return v;
  const m = rgba.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
  const r = (m ? +m[1] : 255) / 255;
  const g = (m ? +m[2] : 255) / 255;
  const b = (m ? +m[3] : 255) / 255;
  const a = m && m[4] !== undefined ? +m[4] : 1;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  v = { h, s: s * 100, l: l * 100, a };
  HSLA_CACHE.set(rgba, v);
  return v;
}

/**
 * The big soft light blobs. With a world time they BREATHE: each drifts a
 * few dozen pixels, swells/dims a touch, and — the colour part — its hue
 * RIDES THE FULL RAINBOW, one lap a minute plus a small per-blob wobble, so
 * the lights slowly wander the spectrum while the family's base gradient
 * keeps the scene's identity anchored. All the periods are offset and share
 * no common multiple, so the pattern never visibly repeats. t=0 (or
 * FX.skyBreathe off) is exactly the family's own static colours — which is
 * also what the frost blur and the node tests see.
 * @param {CanvasRenderingContext2D} cx
 * @param {number} w @param {number} h
 * @param {GlassFamily} f
 * @param {number} [t] world time in ms
 * @param {{widen?: number, boost?: number}} [opts] the frost look: wider and
 *   brighter stands in for "this blob, blurred" (see drawFrostBlobs)
 */
function drawGlassBlobs(cx, w, h, f, t = 0, opts = {}) {
  const widen = opts.widen ?? 1;
  const boost = opts.boost ?? 1;
  const live = FX.skyBreathe && t > 0;
  const hueSpin = live ? (t / 60000) * 360 : 0;
  f.blobs.forEach((b, i) => {
    const phase = i * 2.4;
    const dx = live ? Math.sin((t / 18000) * TAU + phase) * 34 : 0;
    const dy = live ? Math.cos((t / 23000) * TAU + phase * 1.3) * 22 : 0;
    // Slightly brighter than rest while live, so the travelling hues carry —
    // at the family's resting alpha the rainbow read as a rumour.
    const glow = live ? 1.12 + 0.18 * Math.sin((t / 16000) * TAU + phase * 0.7) : 1;
    const wobble = live ? 14 * Math.sin((t / 29000) * TAU + phase) : 0;

    const c = hslaOf(b.c);
    const hue = (((c.h + hueSpin + wobble) % 360) + 360) % 360;
    const x = b.x * w + dx;
    const y = b.y * h + dy;
    const r = b.r * w * widen;
    const rg = cx.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, `hsla(${hue}, ${c.s}%, ${c.l}%, ${Math.min(1, c.a * glow * boost)})`);
    // Fade to the same hue at zero alpha — fading to transparent black greys
    // the midfield out.
    rg.addColorStop(1, `hsla(${hue}, ${c.s}%, ${c.l}%, 0)`);
    cx.fillStyle = rg;
    cx.fillRect(x - r, y - r, r * 2, r * 2);
  });
}

/**
 * The live half of the frosted glass. glassFrost() is only the blurred
 * gradient base; this draws the CURRENT frame's blobs — same drift, glow and
 * hue as the open sky — into whatever clip the caller has set. Wider and
 * brighter than the sky's own blobs because that is what a heavy blur does
 * to a smooth radial gradient (spreads it) and what real frosted glass does
 * to the lights behind it (they glow harder than the wall — the boost
 * replaces the old cache's doubled-blob pass). Costs a few clipped gradient
 * fills per panel; no blur runs at runtime.
 * @param {CanvasRenderingContext2D} cx clipped to the panel being drawn
 * @param {number} w @param {number} h world size
 */
export function drawFrostBlobs(cx, w, h) {
  drawGlassBlobs(cx, w, h, glassFam(), skyT, { widen: 1.18, boost: 1.7 });
}

/** @type {HTMLCanvasElement | null} */
let frostCanvas = null;
let frostKey = '';

/**
 * The frosted backdrop the glass panels window into — the STATIC half only.
 * Canvas has no backdrop-filter, so the fake comes in two layers: this is
 * the sky WITHOUT its blobs (just the gradient), heavily blurred by the
 * classic downscale/upscale trick — no ctx.filter dependency, works in
 * every browser — built once per family and cached. The blobs are deliberately excluded: they breathe and hue-shift
 * per frame, so consumers composite them live with drawFrostBlobs() after
 * blitting this base. (A blurred smooth radial gradient is just the same
 * gradient a little wider, so the live composite matches what a true
 * re-blur would produce — without ever blurring at runtime.)
 * @param {number} w @param {number} h world size, from the caller so this
 *   module stays free of tuning imports
 * @returns {HTMLCanvasElement | null} null outside a DOM (tests, node)
 */
export function glassFrost(w, h) {
  if (frostCanvas && frostKey === glassFamilyKey) return frostCanvas;
  if (typeof document === 'undefined') return null;
  const f = glassFam();

  const src = document.createElement('canvas');
  src.width = w;
  src.height = h;
  const sc = /** @type {CanvasRenderingContext2D} */ (src.getContext('2d'));
  const g = sc.createLinearGradient(0, 0, w * 0.22, h);
  g.addColorStop(0, f.stops[0]);
  g.addColorStop(0.55, f.stops[1]);
  g.addColorStop(1, f.stops[2]);
  sc.fillStyle = g;
  sc.fillRect(0, 0, w, h);

  const small = document.createElement('canvas');
  small.width = Math.max(1, Math.round(w / 24));
  small.height = Math.max(1, Math.round(h / 24));
  const smc = /** @type {CanvasRenderingContext2D} */ (small.getContext('2d'));
  smc.drawImage(src, 0, 0, small.width, small.height);

  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const oc = /** @type {CanvasRenderingContext2D} */ (out.getContext('2d'));
  oc.imageSmoothingEnabled = true;
  oc.imageSmoothingQuality = 'high';
  oc.drawImage(small, 0, 0, w, h);

  frostCanvas = out;
  frostKey = glassFamilyKey;
  return out;
}

const THEMES = /** @type {const} */ (['terrazzo', 'dusk', 'glass']);

let themeKey = 'glass';
let way = WAYS[1]; // teal: the lobby/showdown resting colourway

/** @param {string | undefined} key unknown keys fall back to glass */
export function setTheme(key) {
  if (key === 'aurora' || key === 'berry' || key === 'ocean' || key === 'frost' || key === 'cream' || key === 'noir' || key === 'blanc') {
    themeKey = 'glass';
    setGlassFamily(key);
    return;
  }
  themeKey = THEMES.includes(/** @type {any} */ (key)) ? /** @type {string} */ (key) : 'glass';
  if (themeKey === 'glass') setGlassFamily('dusk');
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

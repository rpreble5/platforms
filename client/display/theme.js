/**
 * The environment palette, and the procedural fallbacks that draw the stage
 * when no sprites are present.
 *
 * ONE RULE governs every colour here: **the environment is desaturated, and
 * players own the saturated range.** Twelve bright player hues have to pop off
 * this backdrop at 26px from five metres away. Any scenery colour that competes
 * with them is a bug, however nice it looks in isolation.
 *
 * Beyond that it's warm-over-cool: the sky is cool and recedes, the stage is
 * warm and advances. That separation does more for readability than contrast
 * alone, and it survives a projector crushing the gamma.
 */

export const INK = '#17142a';

export const SKY = {
  top: '#1b1730',
  bottom: '#332a52',
  hill: '#3d3363',
  hillFar: '#2c2547',
};

export const STAGE = {
  /** The landing surface — the brightest thing down there, because it's what you aim at. */
  platTop: '#f0c07a',
  platFace: '#d2934f',
  platEdge: '#8f5f2e',
  /** Dark ink on warm sand: the highest-contrast text pairing on screen. */
  platText: '#2b1c0c',
  platTextDim: '#7a6446',

  floorTop: '#7b6450',
  floorBody: '#4c3f34',
  floorEdge: '#2f2620',
};

export const UI = {
  paper: '#f4f1e8',
  dim: '#9aa0b4',
  faint: '#5f6478',
  panel: 'rgba(12,10,22,0.9)',
  panelEdge: 'rgba(160,150,190,0.28)',
  correct: '#3ddc9a',
  wrong: '#ff6a4d',
  warn: '#ffc247',
  gold: '#ffd86b',
};

/**
 * Fonts. `display` is Fredoka (variable, OFL — assets/fonts/display.woff2 +
 * OFL-Fredoka.txt), served by the @font-face in client/display/index.html;
 * the system stack is only the fallback for the first frames before it
 * loads. Fredoka's weight axis tops out at 700, so the 800s in draw code
 * clamp there — intentional, it keeps one file serving every weight.
 */
export const FONT = {
  display: '"PlatformsDisplay", ui-rounded, "SF Pro Rounded", system-ui, sans-serif',
  ui: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};

/**
 * Procedural sky, used until assets/bg.png exists — and worth keeping even
 * after, as the layer that reacts to game state. A painted PNG can't shift with
 * the round timer; this can.
 * @param {CanvasRenderingContext2D} cx
 * @param {number} w @param {number} h
 */
export function drawProceduralSky(cx, w, h) {
  const g = cx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, SKY.top);
  g.addColorStop(1, SKY.bottom);
  cx.fillStyle = g;
  cx.fillRect(0, 0, w, h);

  // Two bands of low, flat hills. Deliberately dull and deliberately low —
  // nothing above y=600 competes with the question, nothing below y=980
  // competes with the crowd.
  cx.fillStyle = SKY.hillFar;
  hills(cx, w, h * 0.72, 260, 5, 0.6);
  cx.fillStyle = SKY.hill;
  hills(cx, w, h * 0.80, 200, 3, 1.4);
}

/**
 * @param {CanvasRenderingContext2D} cx
 * @param {number} w @param {number} baseY @param {number} r
 * @param {number} count @param {number} phase
 */
function hills(cx, w, baseY, r, count, phase) {
  cx.beginPath();
  cx.moveTo(-r, baseY + r);
  for (let i = 0; i <= count; i++) {
    const x = (i / count) * (w + r * 2) - r;
    const rr = r * (0.7 + 0.3 * Math.sin(i * 1.7 + phase));
    cx.arc(x, baseY + r * 0.6, rr, Math.PI, 0);
  }
  cx.lineTo(w + r, baseY + r * 2);
  cx.lineTo(-r, baseY + r * 2);
  cx.closePath();
  cx.fill();
}

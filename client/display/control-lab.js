/**
 * Standalone interaction sandbox for shared control boxes. No questions,
 * scoring, networking or game-mode decisions live here.
 */

import { BTN_JUMP, BTN_LEFT, BTN_RIGHT } from '../../shared/protocol.js';
import { MAX_FRAME_DT_MS, MAX_STEPS_PER_FRAME, PHYS, STEP_MS, WORLD_H, WORLD_W } from '../../shared/tuning.js';
import { addPlayer, createWorld, step } from '../../sim/world.js';
import { CONTROL_GROUND_Y, buildControlArena, resetControlArena, stepControls } from '../../sim/control-boxes.js';
import { getAvatar } from './sprites.js';
import { drawGlassSky, setTheme } from './themes.js';
import { getControlLabScenario } from './control-lab-scenarios.js';

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('stage'));
const cx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d', { alpha: false }));
const themeSelect = /** @type {HTMLSelectElement} */ (document.getElementById('theme'));
const layoutSelect = /** @type {HTMLSelectElement} */ (document.getElementById('layout'));

let activeScenario = getControlLabScenario(layoutSelect.value);
let arena = buildScenarioArena(activeScenario);
let world = createWorld(arena.platforms);
world.spawn = { x: 100, y: CONTROL_GROUND_Y - PHYS.PLAYER_H - 2 };
let player = addPlayer(world, 0);
player.x = world.spawn.x;
player.y = world.spawn.y;

setTheme('aurora');
themeSelect.addEventListener('change', () => setTheme(themeSelect.value));
layoutSelect.addEventListener('change', () => loadScenario(layoutSelect.value));
document.getElementById('reset')?.addEventListener('click', reset);

/** @type {Array<{at:number, text:string, accepted:boolean}>} */
const feed = [];
let mask = 0;

/** @param {ReturnType<typeof getControlLabScenario>} scenario */
function buildScenarioArena(scenario) {
  const nextArena = buildControlArena(8);
  nextArena.controls.forEach((control, index) => {
    const spec = scenario.controls[index];
    control.label = spec.label;
    control.kind = spec.kind;
    control.initial = spec.initial;
    control.value = spec.initial;
    control.min = spec.min;
    control.max = spec.max;
    control.step = spec.step;
    control.unit = spec.unit;
  });
  return nextArena;
}

/** @param {string} key */
function loadScenario(key) {
  activeScenario = getControlLabScenario(key);
  arena = buildScenarioArena(activeScenario);
  world = createWorld(arena.platforms);
  world.spawn = { x: 100, y: CONTROL_GROUND_Y - PHYS.PLAYER_H - 2 };
  player = addPlayer(world, 0);
  player.x = world.spawn.x;
  player.y = world.spawn.y;
  player.input.held = mask;
  feed.length = 0;
}

function reset() {
  resetControlArena(arena);
  player.x = world.spawn.x;
  player.y = world.spawn.y;
  player.vx = 0;
  player.vy = 0;
  player.onGround = false;
  player.standingOn = null;
  player.lastStoodOn = null;
  feed.length = 0;
}

/** @param {number} bit @param {boolean} down */
function setButton(bit, down) {
  const before = mask;
  mask = down ? mask | bit : mask & ~bit;
  player.input.held = mask;
  player.input.pressEdge |= (~before & mask) & bit;
  player.input.releaseEdge |= (before & ~mask) & bit;
}

/** @param {KeyboardEvent} e @param {boolean} down */
function onKey(e, down) {
  const key = e.key.toLowerCase();
  if (key === 'a' || key === 'arrowleft') setButton(BTN_LEFT, down);
  else if (key === 'd' || key === 'arrowright') setButton(BTN_RIGHT, down);
  else if (key === ' ' || key === 'w' || key === 'arrowup') setButton(BTN_JUMP, down);
  else if (down && key === 'r' && !e.repeat) reset();
  else return;
  e.preventDefault();
}
window.addEventListener('keydown', (e) => onKey(e, true));
window.addEventListener('keyup', (e) => onKey(e, false));
window.addEventListener('blur', () => {
  mask = 0;
  player.input.held = 0;
});

/** @param {boolean | number} value @param {string} [unit] */
function displayValue(value, unit = '') {
  if (typeof value === 'boolean') return value ? 'YES' : 'NO';
  return unit ? `${value} ${unit}` : String(value);
}

/**
 * Use the largest single-line label treatment that fits its stretch of floor.
 * @param {string} text
 * @param {number} maxWidth
 * @returns {number}
 */
function fitFloorLabel(text, maxWidth) {
  for (let size = 32; size >= 19; size--) {
    cx.font = `800 ${size}px PlatformsDisplay, ui-sans-serif, system-ui, sans-serif`;
    if (cx.measureText(text).width <= maxWidth) return size;
  }
  return 19;
}

/** @param {string} text @param {number} maxWidth */
function fitHeaderTitle(text, maxWidth) {
  for (let size = 52; size >= 34; size--) {
    cx.font = `900 ${size}px PlatformsDisplay, ui-sans-serif, system-ui, sans-serif`;
    if (cx.measureText(text).width <= maxWidth) return size;
  }
  return 34;
}

/** @param {import('../../sim/collide.js').Platform} p */
function drawFloorSection(p) {
  const g = cx.createLinearGradient(0, p.y, 0, p.y + p.h);
  g.addColorStop(0, 'rgba(37,48,88,0.98)');
  g.addColorStop(1, 'rgba(12,17,43,0.98)');
  cx.fillStyle = g;
  cx.beginPath();
  cx.roundRect(p.x, p.y, p.w, p.h, 5);
  cx.fill();
  cx.fillStyle = 'rgba(190,230,255,0.48)';
  cx.beginPath();
  cx.roundRect(p.x, p.y, p.w, 4, 2);
  cx.fill();
  cx.fillStyle = 'rgba(255,255,255,0.06)';
  cx.fillRect(p.x, p.y + 8, p.w, 1);
}

/** @param {number} value */
function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

/** @param {number} value */
function easeOutCubic(value) {
  return 1 - Math.pow(1 - clamp01(value), 3);
}

/** @param {number} playerId @param {number} alpha */
function playerImpactColor(playerId, alpha) {
  const hue = (185 + playerId * 137.508) % 360;
  return `hsla(${hue}, 90%, 72%, ${clamp01(alpha)})`;
}

/**
 * @param {string} text
 * @param {import('../../sim/control-boxes.js').ControlKind} kind
 * @param {number} width
 */
function fitControlValue(text, kind, width) {
  let size = kind === 'toggle' ? 27 : 23;
  do {
    cx.font = `900 ${size}px PlatformsDisplay, ui-sans-serif, system-ui, sans-serif`;
    size--;
  } while (size > 15 && cx.measureText(text).width > width - 12);
  return size + 1;
}

/** @param {import('../../sim/control-boxes.js').ControlFixture} c */
function drawControl(c) {
  const feedback = c.feedback;
  const age = feedback ? Math.max(0, world.t - feedback.at) : Infinity;
  const rejected = Boolean(feedback && !feedback.accepted);
  const limited = Boolean(feedback?.accepted && c.kind === 'number' && feedback.delta === 0);
  const compression = age < 80 ? Math.sin(Math.PI * age / 80) : 0;
  const settleAge = age - 80;
  const spring = settleAge >= 0 && settleAge < 700
    ? Math.exp(-settleAge / 175) * Math.sin(settleAge / 34)
    : 0;
  const direction = feedback?.side === 'bottom' ? -1 : 1;
  let dx = 0;
  let dy = 0;
  let scaleX = 1;
  let scaleY = 1;

  if (feedback) {
    if (rejected) {
      const shakeFade = Math.pow(1 - clamp01(age / 300), 2);
      dx = Math.sin(age / 12) * 8 * shakeFade;
      scaleX = 1 + compression * 0.025;
      scaleY = 1 - compression * 0.05;
    } else {
      const strength = limited ? 0.58 : 1;
      dy = direction * (compression * 5 + spring * 3) * strength;
      scaleX = 1 + compression * 0.065 - spring * 0.018;
      scaleY = 1 - compression * 0.13 + spring * 0.035;
    }
  }

  if (feedback && age < 560) {
    const ringT = clamp01(age / 560);
    const ringFade = Math.pow(1 - ringT, 2);
    const spread = (rejected ? 3 : 4) + easeOutCubic(ringT) * (rejected ? 7 : 21);
    const ringColor = rejected
      ? `rgba(255,112,126,${ringFade * 0.68})`
      : limited
        ? `rgba(255,196,92,${ringFade * 0.7})`
        : playerImpactColor(feedback.playerId, ringFade * 0.7);
    cx.save();
    cx.strokeStyle = ringColor;
    cx.lineWidth = rejected ? 2.5 : 3.2 - ringT * 1.6;
    cx.beginPath();
    cx.roundRect(c.x - spread, c.y + 3 - spread, c.w + spread * 2, c.h - 6 + spread * 2, 12 + spread / 2);
    cx.stroke();
    cx.restore();
  }

  const yes = c.kind === 'toggle' && c.value === true;
  const base = yes ? '#1bbf91' : c.kind === 'toggle' ? '#b33a6f' : '#496ee8';
  const centerX = c.x + c.w / 2;
  const centerY = c.y + c.h / 2;
  const glow = feedback ? Math.exp(-age / 210) : 0;
  const glowColor = rejected
    ? `rgba(255,104,120,${0.86 * glow})`
    : limited
      ? `rgba(255,192,82,${0.9 * glow})`
      : feedback
        ? playerImpactColor(feedback.playerId, 0.9 * glow)
        : 'rgba(4,8,24,0.55)';

  cx.save();
  cx.translate(centerX + dx, centerY + dy);
  cx.scale(scaleX, scaleY);
  cx.translate(-centerX, -centerY);
  cx.shadowColor = 'rgba(4,8,24,0.55)';
  cx.shadowBlur = 16;
  cx.fillStyle = base;
  cx.beginPath();
  cx.roundRect(c.x, c.y + 3, c.w, c.h - 6, 12);
  cx.fill();
  cx.shadowColor = glowColor;
  cx.shadowBlur = glow * 32;
  cx.fill();
  cx.shadowColor = 'transparent';
  const sheen = cx.createLinearGradient(c.x, c.y, c.x + c.w, c.y + c.h);
  sheen.addColorStop(0, 'rgba(255,255,255,0.32)');
  sheen.addColorStop(0.5, 'rgba(255,255,255,0.05)');
  sheen.addColorStop(1, 'rgba(255,255,255,0)');
  cx.fillStyle = sheen;
  cx.fill();
  cx.strokeStyle = `rgba(255,255,255,${0.72 + glow * 0.22})`;
  cx.lineWidth = 2;
  cx.stroke();

  cx.textAlign = 'center';
  cx.textBaseline = 'middle';

  /** @param {boolean|number} value @param {number} offsetY @param {number} alpha @param {number} scale */
  const paintValue = (value, offsetY, alpha, scale = 1) => {
    const text = displayValue(value, c.unit);
    const size = fitControlValue(text, c.kind, c.w);
    cx.save();
    cx.globalAlpha = clamp01(alpha);
    cx.fillStyle = '#fff';
    cx.font = `900 ${size}px PlatformsDisplay, ui-sans-serif, system-ui, sans-serif`;
    cx.translate(centerX, centerY + 1 + offsetY);
    cx.scale(scale, scale);
    cx.fillText(text, 0, 0);
    cx.restore();
  };

  const changing = Boolean(feedback?.accepted && feedback.from !== feedback.to && age < 250);
  if (changing && feedback) {
    const valueT = easeOutCubic(age / 250);
    const pulse = 1 + Math.sin(Math.PI * valueT) * 0.09;
    if (c.kind === 'number') {
      const travelDirection = feedback.delta > 0 ? -1 : 1;
      paintValue(feedback.from, travelDirection * 22 * valueT, 1 - valueT, 1 - valueT * 0.08);
      paintValue(feedback.to, -travelDirection * 22 * (1 - valueT), valueT, pulse);
    } else {
      paintValue(feedback.from, 0, 1 - valueT, 1 - valueT * 0.18);
      paintValue(feedback.to, 0, valueT, 0.82 + valueT * 0.18 + Math.sin(Math.PI * valueT) * 0.08);
    }
  } else {
    const limitPulse = limited && age < 260 ? 1 + Math.sin(Math.PI * clamp01(age / 260)) * 0.08 : 1;
    paintValue(c.value, 0, 1, limitPulse);
  }
  cx.restore();

  // Labels point toward their control and stay on one line. Their different
  // lengths are intentional; only the type size adapts to the available run.
  const labelSize = fitFloorLabel(c.label, c.labelW);
  const controlIsRight = c.labelX < c.x;
  cx.fillStyle = 'rgba(255,255,255,0.96)';
  cx.textAlign = controlIsRight ? 'right' : 'left';
  cx.textBaseline = 'middle';
  cx.font = `800 ${labelSize}px PlatformsDisplay, ui-sans-serif, system-ui, sans-serif`;
  cx.shadowColor = 'rgba(0,0,0,0.62)';
  cx.shadowBlur = 4;
  cx.shadowOffsetY = 2;
  const labelEdge = controlIsRight ? c.labelX + c.labelW : c.labelX;
  cx.fillText(c.label, labelEdge, c.y + c.h / 2);
  cx.shadowColor = 'transparent';
  cx.shadowBlur = 0;
  cx.shadowOffsetY = 0;

  // The faces advertise direction. Binary controls highlight only the side
  // that can produce the next toggle; numeric controls always show both.
  const topEligible = c.kind === 'number' || c.lastSide !== 'top';
  const bottomEligible = c.kind === 'number' || c.lastSide !== 'bottom';
  cx.textAlign = 'center';
  cx.font = c.kind === 'number'
    ? '900 25px ui-sans-serif, system-ui, sans-serif'
    : '900 18px ui-sans-serif, system-ui, sans-serif';

  /** @param {'top'|'bottom'} side @param {boolean} eligible @param {number} y */
  const paintDirectionCue = (side, eligible, y) => {
    const idlePulse = (Math.sin(world.t / 180 + c.x * 0.01) + 1) / 2;
    const handoff = feedback?.accepted ? Math.exp(-age / 260) : 0;
    const hitSide = feedback?.side === side && age < 340;
    const alpha = c.kind === 'number' ? 0.92 : eligible ? 0.7 + idlePulse * 0.22 + handoff * 0.08 : 0.2;
    let color = `rgba(248,244,255,${clamp01(alpha)})`;
    if (hitSide && rejected) color = `rgba(255,118,132,${0.45 + Math.exp(-age / 180) * 0.5})`;
    else if (hitSide && limited) color = `rgba(255,202,105,${0.5 + Math.exp(-age / 180) * 0.45})`;
    cx.fillStyle = color;
    cx.fillText(c.kind === 'number' ? (side === 'top' ? '−' : '+') : (side === 'top' ? '▼' : '▲'), centerX, y);
  };

  paintDirectionCue('top', topEligible, c.y - 12);
  paintDirectionCue('bottom', bottomEligible, c.y + c.h + 17);
  cx.textAlign = 'left';
  cx.textBaseline = 'alphabetic';
}

function drawPlayer() {
  const sprite = getAvatar('#f6b94b', 'pastel', player.w, player.h, 'pill', true, 'none');
  cx.drawImage(sprite, player.x - 8, player.y - 8);
}

function drawHeader() {
  const h = 150;
  cx.fillStyle = 'rgba(10,8,20,0.90)';
  cx.fillRect(0, 0, WORLD_W, h);

  cx.textBaseline = 'alphabetic';
  cx.textAlign = 'center';
  cx.fillStyle = '#fff';
  const titleSize = fitHeaderTitle(activeScenario.title, WORLD_W - 320);
  cx.font = `900 ${titleSize}px PlatformsDisplay, ui-sans-serif, system-ui, sans-serif`;
  cx.fillText(activeScenario.title, WORLD_W / 2, 76);

  cx.textAlign = 'left';
  cx.fillStyle = 'rgba(255,255,255,0.70)';
  cx.font = '800 20px PlatformsDisplay, ui-sans-serif, system-ui, sans-serif';
  cx.fillText('CONTROL LAB', 40, 42);

  cx.textAlign = 'center';
  cx.fillStyle = 'rgba(255,255,255,0.76)';
  cx.font = '750 22px PlatformsDisplay, ui-sans-serif, system-ui, sans-serif';
  cx.fillText(
    feed[0]?.text ?? activeScenario.context,
    WORLD_W / 2,
    118
  );

  cx.fillStyle = 'rgba(255,255,255,0.08)';
  cx.fillRect(0, h - 14, WORLD_W, 14);
  cx.fillStyle = '#54dba7';
  cx.fillRect(0, h - 14, WORLD_W, 14);
  cx.textAlign = 'left';
}

function render() {
  drawGlassSky(cx, WORLD_W, WORLD_H);
  drawHeader();
  for (const platform of world.platforms) {
    if (!platform.controlId) drawFloorSection(platform);
  }
  for (const control of arena.controls) drawControl(control);
  drawPlayer();
}

let last = performance.now();
let acc = 0;
/** @param {number} now */
function frame(now) {
  requestAnimationFrame(frame);
  acc += Math.min(now - last, MAX_FRAME_DT_MS);
  last = now;
  let steps = 0;
  while (acc >= STEP_MS && steps < MAX_STEPS_PER_FRAME) {
    step(world, STEP_MS);
    const events = stepControls(arena, world.impacts, world.t);
    for (const event of events) {
      const c = arena.controls.find((item) => item.id === event.controlId);
      if (!c) continue;
      const direction = event.side === 'bottom' ? 'from below' : 'from above';
      const result = event.accepted ? `→ ${displayValue(event.value, c.unit)}` : '— opposite side required';
      feed.unshift({ at: world.t, accepted: event.accepted, text: `${c.label}: ${direction} ${result}` });
      if (feed.length > 4) feed.length = 4;
    }
    acc -= STEP_MS;
    steps++;
  }
  render();
}
requestAnimationFrame(frame);

/** Main-display rendering for the shared Control Room fixtures. */

/** @param {boolean|number} value @param {string} [unit] */
function displayValue(value, unit = '') {
  if (typeof value === 'boolean') return value ? 'YES' : 'NO';
  return unit ? `${value} ${unit}` : String(value);
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

/** @param {CanvasRenderingContext2D} cx @param {string} text @param {number} maxWidth */
function fitFloorLabel(cx, text, maxWidth) {
  for (let size = 32; size >= 19; size--) {
    cx.font = `800 ${size}px PlatformsDisplay, ui-sans-serif, system-ui, sans-serif`;
    if (cx.measureText(text).width <= maxWidth) return size;
  }
  return 19;
}

/**
 * @param {CanvasRenderingContext2D} cx
 * @param {string} text
 * @param {import('../../sim/control-boxes.js').ControlKind} kind
 * @param {number} width
 */
function fitControlValue(cx, text, kind, width) {
  let size = kind === 'toggle' ? 27 : 23;
  do {
    cx.font = `900 ${size}px PlatformsDisplay, ui-sans-serif, system-ui, sans-serif`;
    size--;
  } while (size > 15 && cx.measureText(text).width > width - 12);
  return size + 1;
}

/** @param {CanvasRenderingContext2D} cx @param {import('../../sim/collide.js').Platform} p */
function drawFloorSection(cx, p) {
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

/**
 * @param {CanvasRenderingContext2D} cx
 * @param {import('../../sim/control-boxes.js').ControlFixture} c
 * @param {number} now
 * @param {boolean} revealing
 * @param {boolean} correct
 */
function drawControl(cx, c, now, revealing, correct) {
  const feedback = c.feedback;
  const age = feedback ? Math.max(0, now - feedback.at) : Infinity;
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
      const fade = Math.pow(1 - clamp01(age / 300), 2);
      dx = Math.sin(age / 12) * 8 * fade;
      scaleX = 1 + compression * 0.025;
      scaleY = 1 - compression * 0.05;
    } else {
      const strength = limited ? 0.58 : 1;
      dy = direction * (compression * 5 + spring * 3) * strength;
      scaleX = 1 + compression * 0.065 - spring * 0.018;
      scaleY = 1 - compression * 0.13 + spring * 0.035;
    }
  }

  if (feedback && age < 560 && !revealing) {
    const ringT = clamp01(age / 560);
    const ringFade = Math.pow(1 - ringT, 2);
    const spread = (rejected ? 3 : 4) + easeOutCubic(ringT) * (rejected ? 7 : 21);
    cx.save();
    cx.strokeStyle = rejected
      ? `rgba(255,112,126,${ringFade * 0.68})`
      : limited
        ? `rgba(255,196,92,${ringFade * 0.7})`
        : playerImpactColor(feedback.playerId, ringFade * 0.7);
    cx.lineWidth = rejected ? 2.5 : 3.2 - ringT * 1.6;
    cx.beginPath();
    cx.roundRect(c.x - spread, c.y + 3 - spread, c.w + spread * 2, c.h - 6 + spread * 2, 12 + spread / 2);
    cx.stroke();
    cx.restore();
  }

  const yes = c.kind === 'toggle' && c.value === true;
  const base = revealing
    ? correct ? '#159a70' : '#bd3f5a'
    : yes ? '#1bbf91' : c.kind === 'toggle' ? '#b33a6f' : '#496ee8';
  const centerX = c.x + c.w / 2;
  const centerY = c.y + c.h / 2;
  const glow = feedback ? Math.exp(-age / 210) : 0;

  cx.save();
  cx.translate(centerX + dx, centerY + dy);
  cx.scale(scaleX, scaleY);
  cx.translate(-centerX, -centerY);
  cx.shadowColor = revealing
    ? correct ? 'rgba(84,219,167,0.9)' : 'rgba(255,86,110,0.85)'
    : feedback ? playerImpactColor(feedback.playerId, 0.9 * glow) : 'rgba(4,8,24,0.55)';
  cx.shadowBlur = revealing ? 28 : 16 + glow * 22;
  cx.fillStyle = base;
  cx.beginPath();
  cx.roundRect(c.x, c.y + 3, c.w, c.h - 6, 12);
  cx.fill();
  cx.shadowColor = 'transparent';
  const sheen = cx.createLinearGradient(c.x, c.y, c.x + c.w, c.y + c.h);
  sheen.addColorStop(0, 'rgba(255,255,255,0.32)');
  sheen.addColorStop(0.5, 'rgba(255,255,255,0.05)');
  sheen.addColorStop(1, 'rgba(255,255,255,0)');
  cx.fillStyle = sheen;
  cx.fill();
  cx.strokeStyle = 'rgba(255,255,255,0.82)';
  cx.lineWidth = revealing ? 3 : 2;
  cx.stroke();

  cx.textAlign = 'center';
  cx.textBaseline = 'middle';
  const text = displayValue(c.value, c.unit);
  const size = fitControlValue(cx, text, c.kind, c.w);
  cx.fillStyle = '#fff';
  cx.font = `900 ${size}px PlatformsDisplay, ui-sans-serif, system-ui, sans-serif`;
  cx.fillText(text, centerX, centerY + 1);
  cx.restore();

  const labelSize = fitFloorLabel(cx, c.label, c.labelW);
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

  if (revealing) {
    cx.textAlign = 'center';
    cx.textBaseline = 'middle';
    cx.font = '900 28px PlatformsDisplay, ui-sans-serif, system-ui, sans-serif';
    cx.fillStyle = correct ? '#7dffd1' : '#ff8297';
    cx.fillText(correct ? '✓' : '×', centerX, c.y - 18);
  } else {
    const topEligible = c.kind === 'number' || c.lastSide !== 'top';
    const bottomEligible = c.kind === 'number' || c.lastSide !== 'bottom';
    cx.textAlign = 'center';
    cx.font = c.kind === 'number'
      ? '900 25px ui-sans-serif, system-ui, sans-serif'
      : '900 18px ui-sans-serif, system-ui, sans-serif';
    cx.fillStyle = `rgba(248,244,255,${topEligible ? 0.9 : 0.2})`;
    cx.fillText(c.kind === 'number' ? '−' : '▼', centerX, c.y - 12);
    cx.fillStyle = `rgba(248,244,255,${bottomEligible ? 0.9 : 0.2})`;
    cx.fillText(c.kind === 'number' ? '+' : '▲', centerX, c.y + c.h + 17);
  }
  cx.textAlign = 'left';
  cx.textBaseline = 'alphabetic';
}

/**
 * @param {CanvasRenderingContext2D} cx
 * @param {import('../../sim/world.js').World} world
 * @param {import('../../sim/control-boxes.js').ControlArena} arena
 * @param {import('../../sim/round.js').Question} question
 * @param {boolean} revealing
 */
export function drawControlStage(cx, world, arena, question, revealing) {
  for (const platform of world.platforms) {
    if (!platform.controlId) drawFloorSection(cx, platform);
  }
  const specs = question.controls ?? [];
  arena.controls.forEach((control, index) => {
    drawControl(cx, control, world.t, revealing, control.value === specs[index]?.answer);
  });
}

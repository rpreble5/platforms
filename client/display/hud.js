/**
 * The measurement HUD. This is the actual deliverable of M0 — you cannot tune
 * what you cannot see, and in-app RTT alone hides the two terms that dominate
 * (touch sampling and TV processing), so the HUD's job is to decompose
 * everything that IS visible and make the invisible part obvious by omission.
 *
 * Frame-time p95 is on here for a reason: if it exceeds ~20ms you are dropping
 * frames, and your renderer — not your network — is the latency problem.
 */

import { STEP_HZ } from '../../shared/tuning.js';
import { percentile, recent } from './input-bus.js';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

/**
 * @typedef {object} HudModel
 * @property {import('./input-bus.js').InputBus} bus
 * @property {Map<number, {name:string, color:string, connected:boolean}>} roster
 * @property {Map<number, {rttP50:number, rttP95:number, loss:number}>} net
 * @property {number[]} frameSamples
 * @property {number} steps last frame's sim step count
 * @property {number} players
 * @property {boolean} detail
 * @property {string} note
 */

/**
 * @param {CanvasRenderingContext2D} cx
 * @param {HudModel} m
 */
export function drawHud(cx, m) {
  const frameP50 = percentile(m.frameSamples, 0.5);
  const frameP95 = percentile(m.frameSamples, 0.95);
  // Both windows are time-bounded, so these describe the last few seconds
  // rather than everything since the page loaded.
  const relayP95 = percentile(recent(m.bus.relaySamples), 0.95);
  const queueP95 = percentile(recent(m.bus.queueSamples), 0.95);

  // Aggregate air RTT across all reporting phones.
  /** @type {number[]} */
  const airP50 = [];
  /** @type {number[]} */
  const airP95 = [];
  let worstLoss = 0;
  for (const s of m.net.values()) {
    if (s.rttP50) airP50.push(s.rttP50);
    if (s.rttP95) airP95.push(s.rttP95);
    worstLoss = Math.max(worstLoss, s.loss);
  }

  const rows = [
    ['players', String(m.players)],
    ['msg/s', m.bus.msgsPerSec.toFixed(0)],
    ['air rtt p50', airP50.length ? `${median(airP50).toFixed(0)} ms` : '—'],
    ['air rtt p95', airP95.length ? `${Math.max(...airP95).toFixed(0)} ms` : '—'],
    ['loss (worst)', `${(worstLoss * 100).toFixed(1)} %`],
    ['relay p95', `${relayP95.toFixed(1)} ms`],
    ['queue->tick p95', `${queueP95.toFixed(1)} ms`],
    ['frame p50/p95', `${frameP50.toFixed(1)} / ${frameP95.toFixed(1)} ms`],
    ['sim', `${STEP_HZ} Hz · ${m.steps} step${m.steps === 1 ? '' : 's'}`],
  ];

  // Below the question banner, which owns the top 150px during a round.
  const top = 170;
  const w = 330;
  const h = 34 + rows.length * 26 + (m.note ? 30 : 0);
  panel(cx, 24, top, w, h);

  cx.font = `700 15px ${MONO}`;
  cx.fillStyle = '#7fd8a8';
  cx.fillText('LATENCY', 40, top + 26);
  cx.fillStyle = '#5a6478';
  cx.fillText('H detail · T tune · F flash', 128, top + 26);

  cx.font = `500 15px ${MONO}`;
  let y = top + 52;
  for (const [k, v] of rows) {
    cx.fillStyle = '#7c879b';
    cx.fillText(k, 40, y);
    cx.fillStyle = warnColor(k, v, frameP95, worstLoss);
    cx.textAlign = 'right';
    cx.fillText(v, 24 + w - 16, y);
    cx.textAlign = 'left';
    y += 26;
  }

  if (m.note) {
    cx.fillStyle = '#ffd93d';
    cx.font = `600 14px ${MONO}`;
    cx.fillText(m.note, 40, y + 4);
  }

  if (m.detail) drawPerPlayer(cx, m);
}

/**
 * @param {CanvasRenderingContext2D} cx
 * @param {HudModel} m
 */
function drawPerPlayer(cx, m) {
  const ids = [...m.roster.keys()].sort((a, b) => a - b);
  if (!ids.length) return;

  const rowH = 24;
  const w = 460;
  const h = 44 + ids.length * rowH;
  const x = 24;
  const y = 1080 - h - 24;
  panel(cx, x, y, w, Math.min(h, 1080 - 48));

  cx.font = `700 14px ${MONO}`;
  cx.fillStyle = '#7c879b';
  cx.fillText('player', x + 16, y + 28);
  cx.textAlign = 'right';
  cx.fillText('p50', x + 250, y + 28);
  cx.fillText('p95', x + 310, y + 28);
  cx.fillText('loss', x + 372, y + 28);
  cx.fillText('ooo', x + 432, y + 28);
  cx.textAlign = 'left';

  cx.font = `500 14px ${MONO}`;
  let ry = y + 52;
  for (const id of ids) {
    if (ry > 1080 - 30) break;
    const look = m.roster.get(id);
    const net = m.net.get(id);
    const s = m.bus.stats(id);
    if (!look) continue;

    cx.fillStyle = look.connected ? look.color : '#4c5566';
    cx.fillText(`${String(id).padStart(2, ' ')} ${look.name}`.slice(0, 22), x + 16, ry);

    cx.textAlign = 'right';
    cx.fillStyle = net && net.rttP95 > 150 ? '#ff8b6b' : '#9aa4b6';
    cx.fillText(net ? String(Math.round(net.rttP50)) : '—', x + 250, ry);
    cx.fillText(net ? String(Math.round(net.rttP95)) : '—', x + 310, ry);
    cx.fillStyle = net && net.loss > 0.01 ? '#ff8b6b' : '#9aa4b6';
    cx.fillText(net ? `${(net.loss * 100).toFixed(1)}%` : '—', x + 372, ry);
    cx.fillStyle = s && s.outOfOrder ? '#ffd93d' : '#4c5566';
    cx.fillText(s ? String(s.outOfOrder) : '0', x + 432, ry);
    cx.textAlign = 'left';
    ry += rowH;
  }
}

/**
 * @param {CanvasRenderingContext2D} cx
 * @param {number} x @param {number} y @param {number} w @param {number} h
 */
function panel(cx, x, y, w, h) {
  cx.fillStyle = 'rgba(8,11,18,0.82)';
  cx.beginPath();
  cx.roundRect(x, y, w, h, 12);
  cx.fill();
  cx.strokeStyle = 'rgba(90,104,130,0.35)';
  cx.lineWidth = 1;
  cx.stroke();
}

/**
 * @param {string} key @param {string} value
 * @param {number} frameP95 @param {number} loss
 * @returns {string}
 */
function warnColor(key, value, frameP95, loss) {
  if (key === 'frame p50/p95' && frameP95 > 20) return '#ff8b6b';
  if (key === 'loss (worst)' && loss > 0.005) return '#ff8b6b';
  if (key === 'air rtt p95') {
    const n = parseFloat(value);
    if (Number.isFinite(n) && n > 150) return '#ff8b6b';
  }
  return '#e2e8f2';
}

/** @param {number[]} a @returns {number} */
function median(a) {
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)] ?? 0;
}

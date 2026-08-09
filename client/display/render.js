/**
 * World rendering. Draws the LATEST tick directly — no interpolation, no lerp,
 * no render-one-tick-in-the-past. That is the whole reason the sim lives in
 * this page rather than in Node: the standard split forces an interpolation
 * buffer worth 16-33ms of deliberate added latency, and co-locating deletes it.
 */

import { RENDER_PUSH_APART, WORLD_H, WORLD_W, avatarScale } from '../../shared/tuning.js';
import { AVATAR_PAD, getAvatar, getLabel, shade } from './sprites.js';
import { drawAnswerPlates, drawDebris } from './round-ui.js';

/** @typedef {import('../../sim/world.js').World} World */
/** @typedef {import('../../sim/player.js').Player} Player */

/**
 * @typedef {object} Look
 * @property {string} name
 * @property {string} color
 * @property {string} hat
 * @property {boolean} connected
 */

/**
 * Optional visual-only fan-out between overlapping avatars, off by default.
 *
 * Players have no collision with each other in the simulation — never have —
 * so this only ever moved the *drawn* positions, on a copy. It is off because
 * it looks like shoving, and an apparent interaction the game doesn't actually
 * model is worse than a crowded pile: people attribute it to lag, or to each
 * other. See RENDER_PUSH_APART in shared/tuning.js.
 * @param {Array<{x:number, y:number, w:number, p:Player}>} items
 */
function separate(items) {
  for (let iter = 0; iter < 2; iter++) {
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i];
        const b = items[j];
        if (Math.abs(a.y - b.y) > 40) continue;
        const dx = b.x - a.x;
        const min = (a.w + b.w) * RENDER_PUSH_APART;
        const d = Math.abs(dx);
        if (d >= min) continue;
        const push = (min - d) * 0.5;
        const dir = dx === 0 ? (i % 2 ? 1 : -1) : Math.sign(dx);
        a.x -= push * dir;
        b.x += push * dir;
      }
    }
  }
}

/**
 * @param {CanvasRenderingContext2D} cx
 * @param {World} world
 * @param {Map<number, Look>} roster
 * @param {import('../../sim/round.js').Game} game
 * @param {{qr: {size:number, modules:Uint8Array[]} | null, joinUrl: string}} opts
 */
export function render(cx, world, roster, game, opts) {
  cx.fillStyle = '#05070c';
  cx.fillRect(0, 0, WORLD_W, WORLD_H);

  drawBackdrop(cx);

  // platforms
  for (const p of world.platforms) {
    const top = p.oneWay ? '#2c3550' : '#39435f';
    cx.fillStyle = top;
    cx.beginPath();
    cx.roundRect(p.x, p.y, p.w, p.h, p.oneWay ? 8 : 6);
    cx.fill();
    cx.fillStyle = p.oneWay ? '#4d5b85' : '#5a688f';
    cx.fillRect(p.x + 4, p.y, p.w - 8, 4);
  }

  // Debris first (behind everything), then the answer plates, then avatars —
  // so a crowd standing on a platform never hides the answer it represents.
  drawDebris(cx, game);
  drawAnswerPlates(cx, world, game);

  const count = world.players.size;
  const scale = avatarScale(count);

  /** @type {Array<{x:number, y:number, w:number, p:Player}>} */
  const items = [];
  for (const p of world.players.values()) {
    items.push({ x: p.x, y: p.y, w: p.w * scale, p });
  }
  if (RENDER_PUSH_APART > 0) separate(items);

  // Draw back-to-front by y so overlapping avatars read as depth. Sorting by
  // id as the tiebreak keeps the stacking order stable when two avatars sit at
  // the same height — otherwise a pile flickers as sort order churns.
  items.sort((a, b) => a.y - b.y || a.p.id - b.p.id);

  const anyFindMe = items.some((it) => it.p.findMeUntil > world.t);

  for (const it of items) {
    const p = it.p;
    const look = roster.get(p.id) ?? { name: `#${p.id}`, color: '#8892a6', hat: 'none', connected: true };
    const w = p.w * scale;
    const h = p.h * scale;
    const findMe = p.findMeUntil > world.t;

    cx.globalAlpha = !look.connected ? 0.35 : anyFindMe && !findMe ? 0.55 : 1;

    if (findMe) drawFindMe(cx, it.x + w / 2, it.y + h / 2, w, world.t, look.color);

    const sprite = getAvatar(look.color, look.hat, Math.round(w), Math.round(h));
    cx.drawImage(sprite, Math.round(it.x - AVATAR_PAD), Math.round(it.y - AVATAR_PAD));

    // Labels auto-hide once the room is crowded — 30 overlapping names is worse
    // than none. Find-me always keeps its own label.
    if (scale > 0.7 || findMe || count <= 20) {
      const label = getLabel(look.name, findMe ? '#ffffff' : shade(look.color, 0.55));
      cx.drawImage(label, Math.round(it.x + w / 2 - label.width / 2), Math.round(it.y - 40));
    }
  }
  cx.globalAlpha = 1;

  if (opts.qr) drawJoin(cx, opts.qr, opts.joinUrl, count);
}

/** @param {CanvasRenderingContext2D} cx */
function drawBackdrop(cx) {
  const g = cx.createLinearGradient(0, 0, 0, WORLD_H);
  g.addColorStop(0, '#0a1020');
  g.addColorStop(1, '#05070c');
  cx.fillStyle = g;
  cx.fillRect(0, 0, WORLD_W, WORLD_H);
}

/**
 * Find-me: the highest-value feature for a 30-player room, and about thirty
 * lines. Everyone else dims; you get a ring and a bouncing arrow.
 * @param {CanvasRenderingContext2D} cx
 * @param {number} cxp @param {number} cyp @param {number} w
 * @param {number} t @param {string} color
 */
function drawFindMe(cx, cxp, cyp, w, t, color) {
  const pulse = (Math.sin(t / 120) + 1) / 2;
  cx.save();
  cx.strokeStyle = color;
  cx.globalAlpha = 0.35 + pulse * 0.45;
  cx.lineWidth = 5;
  cx.beginPath();
  cx.arc(cxp, cyp, w * (1.1 + pulse * 0.5), 0, Math.PI * 2);
  cx.stroke();

  const bob = Math.sin(t / 140) * 10;
  cx.globalAlpha = 1;
  cx.fillStyle = color;
  cx.beginPath();
  cx.moveTo(cxp, cyp - w * 1.5 + bob + 26);
  cx.lineTo(cxp - 18, cyp - w * 1.5 + bob);
  cx.lineTo(cxp + 18, cyp - w * 1.5 + bob);
  cx.closePath();
  cx.fill();
  cx.restore();
}

/**
 * @param {CanvasRenderingContext2D} cx
 * @param {{size:number, modules:Uint8Array[]}} qr
 * @param {string} url
 * @param {number} count
 */
function drawJoin(cx, qr, url, count) {
  const quiet = 3;
  // Size the code to a fixed on-screen box rather than a fixed module size, so
  // a longer URL (a bigger QR version) doesn't shrink it below scannable.
  const box = 300;
  const cell = Math.floor(box / (qr.size + quiet * 2));
  const px = (qr.size + quiet * 2) * cell;
  const margin = 40;
  const x = WORLD_W - px - margin;
  const y = margin;

  cx.fillStyle = '#ffffff';
  cx.beginPath();
  cx.roundRect(x, y, px, px, 12);
  cx.fill();

  cx.fillStyle = '#000000';
  for (let r = 0; r < qr.size; r++) {
    for (let c = 0; c < qr.size; c++) {
      if (qr.modules[r][c]) {
        cx.fillRect(x + (c + quiet) * cell, y + (r + quiet) * cell, cell, cell);
      }
    }
  }

  // The URL must fit the panel: it is the fallback for anyone whose camera
  // won't scan, and a URL running off the edge of the screen is useless.
  const maxW = px + margin - 8;
  let size = 30;
  cx.textAlign = 'center';
  do {
    cx.font = `700 ${size}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    size -= 1;
  } while (size > 13 && cx.measureText(url).width > maxW);

  const cxp = Math.min(x + px / 2, WORLD_W - maxW / 2 - 8);
  cx.fillStyle = '#dbe3f0';
  cx.fillText(url, cxp, y + px + 38);
  cx.font = '500 20px ui-sans-serif, system-ui, sans-serif';
  cx.fillStyle = '#7c879b';
  cx.fillText(`${count} player${count === 1 ? '' : 's'} connected`, cxp, y + px + 68);
  cx.textAlign = 'left';
}

/**
 * World rendering. Draws the LATEST tick directly — no interpolation, no lerp,
 * no render-one-tick-in-the-past. That is the whole reason the sim lives in
 * this page rather than in Node: the standard split forces an interpolation
 * buffer worth 16-33ms of deliberate added latency, and co-locating deletes it.
 */

import { FX, RENDER_PUSH_APART, WORLD_H, WORLD_W, avatarScale } from '../../shared/tuning.js';
import { COHORTS, clampCohort } from '../../shared/palette.js';
import { accessoryHidesEyes } from '../../shared/avatar.js';
import { ANSWER_H, FLAG_H, FLAG_POLE, RANGE_ID, signBelowExtent } from '../../sim/levels.js';
import { PHASE, activeControlTeam, currentQuestion, isControlQuestion } from '../../sim/round.js';
import { animFor, pruneAnim } from './anim.js';
import { drawControlStage } from './control-stage.js';
import { themeName } from './themes.js';
import { AVATAR_PAD, EYES, getAvatar, getLabel, shade } from './sprites.js';
import { drawDebris, drawSigns, lobbyVeil, panel } from './round-ui.js';
import { GLASS_CHUNK_H, drawFloor, drawPerch, drawSky } from './stage.js';
import { FONT, UI } from './theme.js';

/** @typedef {import('../../sim/world.js').World} World */
/** @typedef {import('../../sim/player.js').Player} Player */

/**
 * @typedef {object} Look
 * @property {string} name
 * @property {string} color
 * @property {string} [finish] 'flat' | 'pastel'
 * @property {string} [accessory] palette ACCESSORIES key
 * @property {number} [cohortIndex]
 * @property {boolean} [cohortSet]
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
  drawSky(cx, world.t);
  const question = currentQuestion(game);
  const controlTurn = Boolean(isControlQuestion(question) && game.controlArena);

  // Debris behind, then the floor, then the signboards, then avatars. The
  // answer text sits in the signboard's skirt, below the landing surface, so a
  // crowd standing on a platform never covers the answer it represents.
  if (controlTurn && question && game.controlArena) {
    const revealing = game.phase === PHASE.REVEAL || game.phase === PHASE.SCORE;
    drawControlStage(cx, world, game.controlArena, question, revealing);
  } else {
    drawDebris(cx, game);
    for (const p of world.platforms) {
      // A range round's floor comes in three pieces (plus the off-screen pit,
      // which is never drawn); each piece is rendered exactly like the floor.
      if (p.id === 'floor' || p.id === 'floorL' || p.id === 'floorR' || p.id === RANGE_ID) {
        drawFloor(cx, p);
      } else if (p.id?.startsWith('perch')) {
        drawPerch(cx, p);
      }
    }
    drawSigns(cx, world, game);
  }

  // Spectators hide only while a control turn is actually LIVE. At GAME_OVER
  // the last control question is still "current" and its set is still drawn,
  // but the whole room comes back for the free-run over the final standings.
  const gatedTeam = activeControlTeam(game);
  const visiblePlayers = [...world.players.values()].filter(
    (p) => gatedTeam === null || game.cohortOf(p.id) === gatedTeam
  );
  const count = visiblePlayers.length;
  const scale = avatarScale(count);
  if (FX.avatarAnim) pruneAnim(world.players);

  /** @type {Array<{x:number, y:number, w:number, coh:number, p:Player}>} */
  const items = [];
  for (const p of visiblePlayers) {
    const coh = clampCohort(roster.get(p.id)?.cohortIndex ?? -1);
    items.push({ x: p.x, y: p.y, w: p.w * scale, coh, p });
  }
  if (RENDER_PUSH_APART > 0) separate(items);

  // Seniority is the depth layer: PGY3 loaves in the back, PGY2 pills in the
  // middle, PGY1 eggs up front — the tall silhouettes peek over the short
  // ones instead of hiding them, theatre-riser style. Within a layer it's
  // back-to-front by y, with id as the tiebreak so a pile doesn't flicker as
  // sort order churns.
  items.sort((a, b) => b.coh - a.coh || a.y - b.y || a.p.id - b.p.id);

  const anyFindMe = items.some((it) => it.p.findMeUntil > world.t);

  // Answer text always beats a name label. The layouts keep standing surfaces
  // away from the space under the boards, but a player mid-jump (or crowding a
  // ladder right beside a board) can still put their label across a skirt —
  // when that happens the label simply skips a frame rather than covering the
  // answer 30 people are trying to read.
  /** @type {Array<{x:number, y:number, w:number, h:number}>} */
  const skirts = [];
  const glass = themeName() === 'glass';
  for (const p of world.platforms) {
    if (!p.id?.startsWith('ans') || p.id === RANGE_ID) continue;
    if (glass) {
      // Glass answers live inside the chunk below the surface, whatever the
      // layout says about flags — the yield zone follows the text.
      skirts.push({ x: p.x, y: p.y + ANSWER_H, w: p.w, h: GLASS_CHUNK_H - ANSWER_H });
    } else if (p.signStyle === 'flag') {
      skirts.push({ x: p.x, y: p.y - FLAG_POLE, w: p.w, h: FLAG_H });
    } else {
      skirts.push({ x: p.x, y: p.y + ANSWER_H, w: p.w, h: signBelowExtent(p) - ANSWER_H });
    }
  }

  if (glass) drawGlassReflections(cx, items, roster, world, scale);

  for (const it of items) {
    const p = it.p;
    const look = roster.get(p.id) ?? { name: `#${p.id}`, color: '#8892a6', finish: 'flat', connected: true };
    const w = p.w * scale;
    const h = p.h * scale;
    const findMe = p.findMeUntil > world.t;

    cx.globalAlpha = !look.connected ? 0.35 : anyFindMe && !findMe ? 0.55 : 1;

    if (findMe) drawFindMe(cx, it.x + w / 2, it.y + h / 2, w, world.t, look.color);

    // Training year is a DRAWN height and outline only. The collision box above
    // is the same 40x56 for everybody, so the jump arc and the landing pixel are
    // identical across cohorts and the year can never be a gameplay advantage.
    // The sprite grows upward from the feet, which is also what makes the
    // difference legible: baseline-aligned heights are trivial to compare,
    // free-floating ones are not.
    const cohort = COHORTS[clampCohort(look.cohortIndex ?? -1)];
    const drawnH = h * cohort.height;
    const top = it.y + h - drawnH;

    const sprite = getAvatar(
      look.color,
      look.finish ?? 'flat',
      Math.round(w),
      Math.round(drawnH),
      cohort.shape,
      false, // eyes are drawn live below, so they can look around
      look.accessory ?? 'none'
    );

    // Squash, stretch and lean, all anchored at the feet — a deformation that
    // breaks floor contact reads as floating, so the bottom-centre is the one
    // point that never moves. Render-only: the collision box is untouched.
    const a = FX.avatarAnim ? animFor(p, world.t) : null;
    cx.save();
    cx.translate(it.x + w / 2, it.y + h);
    if (a) {
      cx.rotate(a.lean);
      cx.scale(a.sx, a.sy);
    }
    cx.drawImage(sprite, -w / 2 - AVATAR_PAD, -drawnH - AVATAR_PAD);

    // Live eyes, in the same transformed space so they deform with the body.
    // Skipped under an accessory that covers them — shades don't gaze.
    if (!accessoryHidesEyes(look.accessory ?? 'none')) {
      const er = Math.max(EYES.rMin, w * EYES.r) * (a?.eye.scale ?? 1);
      const ey = -drawnH + drawnH * EYES.y + (a ? a.eye.dy * er : 0);
      cx.fillStyle = EYES.color;
      cx.beginPath();
      for (const fx of [EYES.x1, EYES.x2]) {
        const ex = -w / 2 + w * fx + (a ? a.eye.dx * er : 0);
        cx.ellipse(ex, ey, er, er * (a?.eye.openY ?? 1), 0, 0, Math.PI * 2);
      }
      cx.fill();
    }
    cx.restore();

    // Labels auto-hide once the room is crowded — 30 overlapping names is worse
    // than none. Find-me always keeps its own label.
    //
    // Keyed on the player count, not on `scale`, so the two can be tuned
    // separately: raising the scale floor below should not silently switch
    // thirty names back on. Raise this number if the room reads fine with them.
    if (count <= 24 || findMe) {
      const label = getLabel(look.name, findMe ? '#ffffff' : shade(look.color, 0.55));
      const lx = Math.round(it.x + w / 2 - label.width / 2);
      const ly = Math.round(top - 40);
      const onSkirt = skirts.some(
        (s) => lx < s.x + s.w && lx + label.width > s.x && ly < s.y + s.h && ly + label.height > s.y
      );
      if (!onSkirt) cx.drawImage(label, lx, ly);
    }
  }
  cx.globalAlpha = 1;

  if (opts.qr) drawJoin(cx, opts.qr, opts.joinUrl, count);
}

/**
 * Subtle reflections of the players standing on glass: each grounded avatar is
 * mirrored across the surface it stands on, at low alpha, clipped inside the
 * chunk. Cheap — the sprites are already cached canvases, and only players
 * whose feet rest exactly on a panel top qualify. Drawn before the avatar
 * pass so every reflection sits under every body.
 * @param {CanvasRenderingContext2D} cx
 * @param {Array<{x:number, y:number, w:number, p:Player}>} items
 * @param {Map<number, Look>} roster
 * @param {World} world
 * @param {number} scale
 */
function drawGlassReflections(cx, items, roster, world, scale) {
  /** @type {Array<{x:number, y:number, w:number, h:number, r:number}>} */
  const panels = [];
  for (const p of world.platforms) {
    if (p.id === RANGE_ID) continue;
    if (p.id?.startsWith('ans')) {
      panels.push({ x: p.x, y: p.y, w: p.w, h: GLASS_CHUNK_H, r: 20 });
    } else if (p.id?.startsWith('perch')) {
      const h = ANSWER_H + 8;
      panels.push({ x: p.x, y: p.y, w: p.w, h, r: h / 2 });
    }
  }
  if (!panels.length) return;

  for (const it of items) {
    const p = it.p;
    const w = p.w * scale;
    const h = p.h * scale;
    // Grounding is judged on the COLLISION box (p.h, unscaled): the sim rests
    // feet at platform tops in that space, while the drawn height shrinks
    // with the crowd.
    const feetY = it.y + p.h;
    const midX = it.x + w / 2;
    const panel = panels.find(
      (s) => Math.abs(feetY - s.y) < 3 && midX > s.x - 6 && midX < s.x + s.w + 6
    );
    if (!panel) continue;

    const look = roster.get(p.id) ?? { name: `#${p.id}`, color: '#8892a6', finish: 'flat', connected: true };
    const cohort = COHORTS[clampCohort(look.cohortIndex ?? -1)];
    const drawnH = h * cohort.height;
    const sprite = getAvatar(
      look.color,
      look.finish ?? 'flat',
      Math.round(w),
      Math.round(drawnH),
      cohort.shape,
      true, // static eyes are fine at reflection alpha
      look.accessory ?? 'none'
    );

    cx.save();
    cx.beginPath();
    // Clip starts below the landing strip so the reflection never brightens it.
    cx.roundRect(panel.x, panel.y + 8, panel.w, panel.h - 8, Math.min(panel.r, (panel.h - 8) / 2));
    cx.clip();
    cx.globalAlpha = look.connected ? 0.08 : 0.03;
    cx.translate(midX, panel.y);
    cx.scale(1, -1);
    cx.drawImage(sprite, -w / 2 - AVATAR_PAD, -drawnH - AVATAR_PAD);
    cx.restore();
  }
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
  // One self-contained "get in here" card on the right edge: title, code,
  // URL and headcount together, instead of a bare QR floating in the corner
  // and a "Scan to join" headline half a screen away.
  const w = 384;
  const x0 = WORLD_W - w - 40;
  const y0 = 118;
  const h = 508;
  // Same lighter veil as the setup card opposite — the QR sits on its own
  // solid white box, so the glass around it can afford to show the sky.
  panel(cx, x0, y0, w, h, undefined, { veil: lobbyVeil() });

  cx.textAlign = 'center';
  cx.textBaseline = 'alphabetic';
  cx.font = `800 36px ${FONT.display}`;
  cx.fillStyle = themeName() === 'terrazzo' ? '#333a4a' : '#ffffff';
  cx.fillText('Scan to join', x0 + w / 2, y0 + 56);

  const quiet = 3;
  // Size the code to a fixed on-screen box rather than a fixed module size, so
  // a longer URL (a bigger QR version) doesn't shrink it below scannable.
  const box = 292;
  const cell = Math.floor(box / (qr.size + quiet * 2));
  const px = (qr.size + quiet * 2) * cell;
  const qx = x0 + (w - px) / 2;
  const qy = y0 + 84;

  cx.fillStyle = '#ffffff';
  cx.beginPath();
  cx.roundRect(qx, qy, px, px, 12);
  cx.fill();

  cx.fillStyle = '#000000';
  for (let r = 0; r < qr.size; r++) {
    for (let c = 0; c < qr.size; c++) {
      if (qr.modules[r][c]) {
        cx.fillRect(qx + (c + quiet) * cell, qy + (r + quiet) * cell, cell, cell);
      }
    }
  }

  // The URL must fit the card: it is the fallback for anyone whose camera
  // won't scan, and a URL running off the edge of the card is useless.
  const maxW = w - 32;
  let size = 28;
  do {
    cx.font = `700 ${size}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    size -= 1;
  } while (size > 13 && cx.measureText(url).width > maxW);

  cx.fillStyle = themeName() === 'terrazzo' ? '#333a4a' : UI.paper;
  cx.fillText(url, x0 + w / 2, qy + px + 46);
  cx.font = '500 20px ui-sans-serif, system-ui, sans-serif';
  cx.fillStyle = UI.dim;
  cx.fillText(`${count} player${count === 1 ? '' : 's'} connected`, x0 + w / 2, qy + px + 78);
  cx.textAlign = 'left';
}

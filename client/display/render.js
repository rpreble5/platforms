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
import { PHASE, activeControlTeam, currentQuestion, isControlQuestion, standings } from '../../sim/round.js';
import { has } from './art.js';
import { animFor, pruneAnim } from './anim.js';
import { drawControlStage } from './control-stage.js';
import { themeName } from './themes.js';
import { AVATAR_PAD, EYES, eyeColorFor, getAvatar, getLabel, shade } from './sprites.js';
import { drawDebris, drawPodiumBlock, drawSigns, inkPanel, lobbyVeil, panel } from './round-ui.js';
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
      if (p.id?.startsWith('perch')) drawPerch(cx, p);
      else if (p.id?.startsWith('podium:')) drawPodiumBlock(cx, p);
    }
    // A range round's floor comes in three physics pieces split at the exact
    // answer boundaries — but those are fractional pixels, and two opaque
    // fills abutting at a fractional x leave an antialiased seam: a faint
    // vertical line telegraphing the band before the reveal. So contiguous
    // pieces are DRAWN as one merged run; the split only becomes visible
    // when the wrong pieces genuinely fall away.
    for (const run of floorRuns(world.platforms)) drawFloor(cx, run);
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

  // At the finale the three champions get their names back — floating over
  // their own live beans on the podium, lobby-label style. Teams mode stays
  // nameless: the podium belongs to the years, not to individuals.
  const champs =
    game.phase === PHASE.GAME_OVER && game.mode !== 'teams'
      ? new Set(standings(game).slice(0, 3).map((s) => s.id))
      : null;

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
  drawFloorReflections(cx, items, roster, world, scale);
  drawContactShadows(cx, items, roster, world, scale, anyFindMe);

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
      // Paper eyes on neon's dark body; the sprite and the live pair share
      // the rule through eyeColorFor.
      cx.fillStyle = eyeColorFor(look.finish ?? 'flat');
      cx.beginPath();
      for (const fx of [EYES.x1, EYES.x2]) {
        const ex = -w / 2 + w * fx + (a ? a.eye.dx * er : 0);
        cx.ellipse(ex, ey, er, er * (a?.eye.openY ?? 1), 0, 0, Math.PI * 2);
      }
      cx.fill();
    }
    cx.restore();

    // Name labels are lobby furniture: that's where "find yourself on screen"
    // happens. During a round they're clutter over the boards, and each phone
    // now wears its own bean on the JUMP button as the in-game reference —
    // so they draw in LOBBY only. Find-me keeps its label in any phase; the
    // whole point of the gesture is putting a name over a body.
    //
    // The crowd cap stays keyed on the player count, not on `scale`, so the
    // two can be tuned separately: raising the scale floor below should not
    // silently switch thirty names back on.
    if ((game.phase === PHASE.LOBBY && count <= 24) || findMe || champs?.has(p.id)) {
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
    // Mirror geometry, same as the floor: the nearest panel top at or below
    // the feet is the mirror plane, and the reflection sits `gap` below it.
    // A jumping bean's twin slides down through the chunk and out of the
    // clip instead of blinking off the moment its feet leave the surface.
    /** @type {{x:number, y:number, w:number, h:number, r:number} | null} */
    let panel = null;
    for (const s of panels) {
      if (midX < s.x - 6 || midX > s.x + s.w + 6) continue;
      if (s.y < feetY - 4) continue;
      if (!panel || s.y < panel.y) panel = s;
    }
    if (!panel) continue;
    const gap = Math.max(0, panel.y - feetY);
    if (gap > panel.h) continue; // the twin is already fully below the clip

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
    cx.translate(midX, panel.y + gap);
    cx.scale(1, -1);
    cx.drawImage(sprite, -w / 2 - AVATAR_PAD, -drawnH - AVATAR_PAD);
    cx.restore();
  }
}

/**
 * Contiguous floor pieces merged into visual runs. A range round's floor is
 * three physics pieces split at fractional answer-boundary pixels; drawing
 * (or clipping) at those seams paints a faint vertical line that gives the
 * band away. Pieces are merged when they touch; once the reveal removes the
 * wrong ones, the survivors become separate runs and the gap is real.
 * @param {readonly import('../../sim/collide.js').Platform[]} platforms
 * @returns {Array<{id: string, x: number, y: number, w: number, h: number}>}
 */
function floorRuns(platforms) {
  const floors = platforms
    .filter((p) => p.id === 'floor' || p.id === 'floorL' || p.id === 'floorR' || p.id === RANGE_ID)
    .sort((a, b) => a.x - b.x);
  /** @type {Array<{id: string, x: number, y: number, w: number, h: number}>} */
  const runs = [];
  for (const p of floors) {
    const last = runs[runs.length - 1];
    if (last && p.x - (last.x + last.w) < 1 && p.y === last.y) {
      last.w = Math.max(last.w, p.x + p.w - last.x);
    } else {
      runs.push({ id: 'floor', x: p.x, y: p.y, w: p.w, h: p.h });
    }
  }
  return runs;
}

// One soft elliptical blob, rendered once and stamped scaled per shadow —
// soft edges with no per-frame gradient allocation, and one place to tune
// the ink. Deep violet-ink rather than black: it sits on every family's
// palette, and on the near-black noir floor it simply disappears, which is
// correct — the reflections carry that theme.
const SHADOW_SPRITE = (() => {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 40;
  const g = c.getContext('2d');
  if (g) {
    g.translate(64, 20);
    g.scale(1, 40 / 128);
    const r = g.createRadialGradient(0, 0, 0, 0, 0, 64);
    r.addColorStop(0, 'rgba(20,16,40,0.85)');
    r.addColorStop(0.55, 'rgba(20,16,40,0.5)');
    r.addColorStop(1, 'rgba(20,16,40,0)');
    g.fillStyle = r;
    g.fillRect(-64, -64, 128, 128);
  }
  return c;
})();

/** Beans fade their shadows out entirely by this many px above the surface —
 *  matched to the ~220px jump apex, so leaving the ground visibly detaches
 *  the shadow and it rushes back up to meet the landing. */
const SHADOW_RANGE = 220;
const SHADOW_ALPHA = 0.5;

/**
 * Contact shadows: each bean casts a soft ellipse on the highest landable
 * surface below it — boards, perches, floor runs, the lobby furniture. The
 * gap to that surface drives size and strength, which turns the shadow into
 * a landing sight: mid-jump it marks the platform you are going to hit.
 * Clipped to the surface span, so overhanging an edge casts only the sliver
 * that fits. Floor pieces are merged through floorRuns first — a shadow
 * clipped at a range round's fractional seam would leak the band all over
 * again. Alpha follows the body's own dimming (disconnect, find-me) so
 * shadows never look orphaned from their owners.
 * @param {CanvasRenderingContext2D} cx
 * @param {Array<{x:number, y:number, w:number, p:Player}>} items
 * @param {Map<number, Look>} roster
 * @param {World} world
 * @param {number} scale
 * @param {boolean} anyFindMe
 */
function drawContactShadows(cx, items, roster, world, scale, anyFindMe) {
  // `r` is the surface's top-corner rounding, so the clip below can follow
  // the drawn silhouette: floor runs are square, everything else (boards,
  // perches, furniture, podium steps) rounds its shoulders at ~18-20px. One
  // constant tracks them all closely enough that no shadow lands on sky.
  /** @type {Array<{x:number, y:number, w:number, r:number}>} */
  const surfaces = [];
  for (const run of floorRuns(world.platforms)) surfaces.push({ x: run.x, y: run.y, w: run.w, r: 0 });
  for (const p of world.platforms) {
    if (!p.id) continue;
    if (p.id === 'floor' || p.id === 'floorL' || p.id === 'floorR' || p.id === RANGE_ID) continue;
    if (p.id === 'pit' || p.y >= WORLD_H) continue;
    surfaces.push({ x: p.x, y: p.y, w: p.w, r: 18 });
  }

  for (const it of items) {
    const p = it.p;
    const w = p.w * scale;
    // Feet in COLLISION space — the sim rests feet at platform tops there.
    const feetY = it.y + p.h;
    const midX = it.x + w / 2;

    // The highest surface at or below the feet, under the bean's midpoint.
    /** @type {{x:number, y:number, w:number, r:number} | null} */
    let surf = null;
    for (const s of surfaces) {
      if (midX < s.x - 2 || midX > s.x + s.w + 2) continue;
      if (s.y < feetY - 4) continue;
      if (!surf || s.y < surf.y) surf = s;
    }
    if (!surf) continue;

    const gap = Math.max(0, surf.y - feetY);
    if (gap >= SHADOW_RANGE) continue;
    const k = 1 - gap / SHADOW_RANGE;

    const look = roster.get(p.id) ?? { name: `#${p.id}`, color: '#8892a6', finish: 'flat', connected: true };
    const findMe = p.findMeUntil > world.t;
    const dim = !look.connected ? 0.35 : anyFindMe && !findMe ? 0.55 : 1;

    // Clipped to the platform's own rounded silhouette, starting AT the
    // surface line: only the below-line half shows (a contact shadow is
    // occlusion under the feet) and near a corner the shadow ends where the
    // shoulder curves away — it bends with the shape because the clip IS
    // the shape, no geometry of its own.
    const sw = w * 1.08 * (0.6 + 0.4 * k);
    const sh = sw * 0.24;
    cx.save();
    cx.beginPath();
    cx.roundRect(surf.x, surf.y, surf.w, 64, [surf.r, surf.r, 0, 0]);
    cx.clip();
    cx.globalAlpha = SHADOW_ALPHA * k * k * dim;
    cx.drawImage(SHADOW_SPRITE, midX - sw / 2, surf.y - sh / 2, sw, sh);
    cx.restore();
  }
  cx.globalAlpha = 1;
}

/**
 * The glossy floor mirrors the beans near it, every theme: a bean standing
 * on the deck grows a faint upside-down twin, and a jump makes the twin
 * sink away — the mirror plane is the floor surface, so the reflection
 * drops as the body rises. Deliberately quieter than the glass panels'
 * 0.08: the floor is a stage, not a showcase. Skipped when a custom floor
 * tile is installed — no gloss assumption on someone else's artwork.
 * Works on merged floor runs, never raw pieces — see floorRuns.
 * @param {CanvasRenderingContext2D} cx
 * @param {Array<{x:number, y:number, w:number, p:Player}>} items
 * @param {Map<number, Look>} roster
 * @param {World} world
 * @param {number} scale
 */
function drawFloorReflections(cx, items, roster, world, scale) {
  if (has('floor')) return;
  const floors = floorRuns(world.platforms);
  if (!floors.length) return;

  for (const it of items) {
    const p = it.p;
    const w = p.w * scale;
    const h = p.h * scale;
    // Feet in COLLISION space (p.h, unscaled) — same convention as the
    // glass panels: the sim rests feet at platform tops in that space.
    const feetY = it.y + p.h;
    const midX = it.x + w / 2;
    const f = floors.find((s) => midX > s.x - 6 && midX < s.x + s.w + 6);
    if (!f) continue;
    const gap = f.y - feetY;
    // The visible band is ~100px tall, so a bean more than ~110px up has a
    // reflection that is entirely below the frame — don't pay for it.
    if (gap < -4 || gap > 110) continue;

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
    // Clip starts under the specular lip so the reflection never brightens it.
    cx.rect(f.x, f.y + 2, f.w, WORLD_H - f.y);
    cx.clip();
    cx.globalAlpha = look.connected ? 0.055 : 0.02;
    // Mirror across the surface: reflected feet sit `gap` below the plane.
    cx.translate(midX, f.y + gap);
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
  // Geometry mirrored by LOBBY.join in round-ui.js (its roof is a
  // platform) — change both together.
  const w = 384;
  const x0 = WORLD_W - w - 40;
  const y0 = 118;
  const h = 508;
  // The same opaque ink panel as the lobby furniture opposite: one card
  // treatment for the whole screen, readable on every theme's sky.
  inkPanel(cx, x0, y0, w, h);

  cx.textAlign = 'center';
  cx.textBaseline = 'alphabetic';
  cx.font = `800 36px ${FONT.display}`;
  cx.fillStyle = '#ffffff';
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

  cx.fillStyle = '#ffffff';
  cx.fillText(url, x0 + w / 2, qy + px + 46);
  cx.font = '500 20px ui-sans-serif, system-ui, sans-serif';
  cx.fillStyle = 'rgba(255,255,255,0.62)';
  cx.fillText(`${count} player${count === 1 ? '' : 's'} connected`, x0 + w / 2, qy + px + 78);
  cx.textAlign = 'left';
}

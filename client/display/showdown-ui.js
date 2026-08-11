/**
 * Everything the showdown draws: TRUE/FALSE floor labels, the statement
 * banner, the collapse, the alive counter, and the victory card. Kept out of
 * round-ui.js because the modes are deliberately separate — the showdown has
 * no scores, so none of the scoreboard machinery belongs anywhere near it.
 */

import { WORLD_H, WORLD_W } from '../../shared/tuning.js';
import { FLOOR_Y } from '../../sim/levels.js';
import {
  FALSE_ID,
  SD_PHASE,
  SD_SHOW_MS,
  SPLIT_X,
  TRUE_ID,
  currentStatement,
} from '../../sim/showdown.js';
import { drawFloor, fitFont } from './stage.js';
import { FONT, UI } from './theme.js';

/** @typedef {import('../../sim/showdown.js').Showdown} Showdown */
/** @typedef {import('../../sim/world.js').World} World */

/**
 * Falling floor half. Same look as the range round's collapse, minus the
 * question — a shim through round-ui's drawDebris would drag quiz types in
 * here, and the slab drawing is four lines.
 * @param {CanvasRenderingContext2D} cx
 * @param {Showdown} s
 */
function drawSdDebris(cx, s) {
  if (!s.debris.length) return;
  const t = s.debrisT / 1000;
  const fall = 0.5 * 2600 * t * t;
  const tilt = Math.min(0.22, s.debrisT / 5000) * 0.35;

  for (const p of s.debris) {
    cx.save();
    cx.globalAlpha = Math.max(0, 1 - fall / 900);
    cx.translate(p.x + p.w / 2, p.y + fall);
    cx.rotate((p.x + p.w / 2 > WORLD_W / 2 ? 1 : -1) * tilt);
    cx.translate(-(p.x + p.w / 2), -p.y);
    drawFloor(cx, p);
    cx.restore();
  }
}

/**
 * The half-labels live on the floor face, below everyone's feet — same spot
 * as the range round's number line, unblockable by the crowd. Colour-coded
 * because that reads from the back of a room; both halves are equally loud,
 * so the colour is a label, not a hint.
 * @param {CanvasRenderingContext2D} cx
 * @param {World} world
 * @param {Showdown} s
 */
function drawHalves(cx, world, s) {
  const revealing = s.phase === SD_PHASE.REVEAL || s.phase === SD_PHASE.VICTORY;
  const st = currentStatement(s);
  const correctId = st?.answer ? TRUE_ID : FALSE_ID;

  for (const [id, label, color, midX] of /** @type {const} */ ([
    [TRUE_ID, 'TRUE', '#3ddc9a', SPLIT_X / 2],
    [FALSE_ID, 'FALSE', '#ff6b6b', SPLIT_X + SPLIT_X / 2],
  ])) {
    const plat = world.platforms.find((p) => p.id === id);
    if (!plat) continue; // mid-collapse: the fallen half is debris now

    if (revealing && st && id === correctId && !s.freePass) {
      cx.fillStyle = 'rgba(61,220,154,0.25)';
      cx.fillRect(plat.x, FLOOR_Y, plat.w, WORLD_H - FLOOR_Y);
      cx.fillStyle = 'rgba(61,220,154,0.8)';
      cx.fillRect(plat.x, FLOOR_Y, plat.w, 14);
    }

    cx.textAlign = 'center';
    cx.textBaseline = 'alphabetic';
    cx.font = `800 64px ${FONT.display}`;
    cx.fillStyle = color;
    cx.fillText(`${id === TRUE_ID ? '✓ ' : '✕ '}${label}`, midX, FLOOR_Y + 78);
  }

  // The dividing line, so nobody argues about straddling it.
  cx.fillStyle = 'rgba(255,255,255,0.35)';
  cx.fillRect(SPLIT_X - 2, FLOOR_Y, 4, WORLD_H - FLOOR_Y);
  cx.textAlign = 'left';
}

/**
 * @param {CanvasRenderingContext2D} cx
 * @param {Showdown} s
 * @param {World} world
 * @param {Map<number, {name:string, color:string}>} roster
 */
export function drawShowdown(cx, s, world, roster) {
  drawSdDebris(cx, s);
  drawHalves(cx, world, s);

  const st = currentStatement(s);

  // Banner. Dark strip like the quiz question, but titled SUDDEN DEATH so
  // nobody mistakes this for a scored round.
  const h = 150;
  cx.fillStyle = 'rgba(10,8,20,0.9)';
  cx.fillRect(0, 0, WORLD_W, h);

  cx.textBaseline = 'alphabetic';
  cx.textAlign = 'left';
  cx.font = `800 24px ${FONT.mono}`;
  cx.fillStyle = UI.wrong;
  cx.fillText('SUDDEN DEATH', 40, 56);
  cx.fillStyle = UI.faint;
  cx.font = `700 24px ${FONT.mono}`;
  cx.fillText(`${s.index + 1}/${s.statements.length}`, 40, 90);

  cx.textAlign = 'right';
  cx.font = `800 30px ${FONT.display}`;
  cx.fillStyle = s.alive.size <= 3 ? UI.wrong : UI.correct;
  cx.fillText(`${s.alive.size} alive`, WORLD_W - 40, 60);
  cx.textAlign = 'center';

  if (st && s.phase !== SD_PHASE.VICTORY) {
    cx.fillStyle = UI.paper;
    cx.font = fitFont(cx, st.text, WORLD_W - 560, 62, 30);
    cx.fillText(st.text, WORLD_W / 2, 96);
  }

  // Timer bar, quiz-style.
  const frac =
    s.phase === SD_PHASE.ANSWER
      ? Math.max(0, 1 - s.phaseT / s.answerMs)
      : s.phase === SD_PHASE.SHOW
        ? 1
        : 0;
  const barY = h - 14;
  cx.fillStyle = 'rgba(255,255,255,0.08)';
  cx.fillRect(0, barY, WORLD_W, 14);
  cx.fillStyle = frac * s.answerMs <= 2000 ? UI.wrong : UI.correct;
  cx.fillRect(0, barY, WORLD_W * frac, 14);

  if (s.phase === SD_PHASE.SHOW && s.index === 0) {
    cx.font = `700 26px ${FONT.ui}`;
    cx.fillStyle = UI.dim;
    cx.fillText('last one standing wins — wrong side of the floor falls', WORLD_W / 2, 128);
  }

  if (s.phase === SD_PHASE.LOCK) {
    cx.font = `800 30px ${FONT.display}`;
    cx.fillStyle = UI.warn;
    cx.fillText("TIME'S UP", WORLD_W / 2, 130);
  }

  if (s.phase === SD_PHASE.REVEAL && s.freePass) {
    cx.font = `800 44px ${FONT.display}`;
    cx.fillStyle = UI.warn;
    cx.fillText('EVERYONE IS WRONG — free pass', WORLD_W / 2, 320);
  }

  if (s.phase === SD_PHASE.VICTORY) drawVictory(cx, s, roster);
  cx.textAlign = 'left';
}

/**
 * @param {CanvasRenderingContext2D} cx
 * @param {Showdown} s
 * @param {Map<number, {name:string, color:string}>} roster
 */
function drawVictory(cx, s, roster) {
  const names = s.winners.map((id) => roster.get(id) ?? { name: `#${id}`, color: UI.paper });
  const w = 860;
  const h = 210 + names.length * 54;
  const x = (WORLD_W - w) / 2;
  const y = 260;

  cx.fillStyle = UI.panel;
  cx.beginPath();
  cx.roundRect(x, y, w, h, 20);
  cx.fill();
  cx.strokeStyle = UI.gold;
  cx.lineWidth = 3;
  cx.stroke();

  cx.textAlign = 'center';
  cx.font = `800 52px ${FONT.display}`;
  cx.fillStyle = UI.gold;
  cx.fillText(
    names.length === 0
      ? 'Nobody survived?!'
      : names.length === 1
        ? 'LAST ONE STANDING'
        : 'CO-CHAMPIONS',
    WORLD_W / 2,
    y + 80
  );

  let ry = y + 156;
  for (const n of names) {
    cx.font = `800 44px ${FONT.display}`;
    cx.fillStyle = n.color;
    cx.fillText(n.name.slice(0, 16), WORLD_W / 2, ry);
    ry += 54;
  }

  cx.font = `600 22px ${FONT.ui}`;
  cx.fillStyle = UI.dim;
  cx.fillText(`outlasted ${Math.max(0, s.startedWith - s.winners.length)} others · back to the lobby in a moment`, WORLD_W / 2, y + h - 34);
  cx.textAlign = 'left';
}

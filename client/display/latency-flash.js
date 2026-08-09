/**
 * Glass-to-glass measurement rig.
 *
 * Everything else in this project measures a *part* of the latency. This
 * measures the whole thing, including the two terms that dominate and that no
 * amount of in-app instrumentation can see: the phone's touch digitizer, and
 * the TV's own picture processing.
 *
 * How to use it:
 *   1. TV in Game Mode. HDMI cable, never Chromecast/AirPlay.
 *   2. Enable flash mode on the phone (the flag in its status bar).
 *   3. With a SECOND phone, film in 240fps slow-motion so that the player's
 *      thumb AND this white square are both in frame.
 *   4. Count frames from thumb contact to the square appearing. /240 = seconds.
 *      At 240fps each frame is 4.17ms.
 *
 * The phone's own white flash is a convenience marker, not the reference: the
 * phone's display pipeline delays it by ~20-40ms. THUMB -> square is the true
 * number; phone-flash -> square is a lower bound.
 *
 * Run the whole thing four times — TV Game Mode on/off, host wired/wireless.
 * The Game Mode delta alone usually settles every architecture argument.
 */

import { BTN_JUMP } from '../../shared/protocol.js';
import { WORLD_W } from '../../shared/tuning.js';

const SIZE = 240;
/** Two frames at 60Hz — long enough for a 240fps camera to catch 8 of them. */
const HOLD_FRAMES = 2;

export class LatencyFlash {
  constructor() {
    this.enabled = true;
    this.remaining = 0;
    this.count = 0;
    /** Sim tick at which the most recent flash fired, for the on-screen counter. */
    this.lastTick = 0;
  }

  /**
   * Called inside the sim loop, right after inputs are drained, so the flash is
   * armed by the same tick that acts on the jump. Anything later would add a
   * tick of measurement error.
   * @param {import('../../sim/world.js').World} world
   */
  observe(world) {
    if (!this.enabled) return;
    for (const p of world.players.values()) {
      if (p.input.pressEdge & BTN_JUMP) {
        this.remaining = HOLD_FRAMES;
        this.count++;
        this.lastTick = world.tick;
        return;
      }
    }
  }

  /** @param {CanvasRenderingContext2D} cx */
  draw(cx) {
    if (!this.enabled) return;

    // A permanent dim target so the camera can be framed and focused before any
    // input happens; it goes full white only on a jump.
    const x = WORLD_W - SIZE - 24;
    const y = 1080 - SIZE - 24;

    if (this.remaining > 0) {
      this.remaining--;
      cx.fillStyle = '#ffffff';
      cx.fillRect(x, y, SIZE, SIZE);
    } else {
      cx.fillStyle = 'rgba(255,255,255,0.06)';
      cx.fillRect(x, y, SIZE, SIZE);
      cx.strokeStyle = 'rgba(255,255,255,0.22)';
      cx.lineWidth = 2;
      cx.strokeRect(x + 1, y + 1, SIZE - 2, SIZE - 2);
      cx.fillStyle = 'rgba(255,255,255,0.35)';
      cx.font = '600 15px ui-monospace, SFMono-Regular, Menlo, monospace';
      cx.textAlign = 'center';
      cx.fillText('FLASH TARGET', x + SIZE / 2, y + SIZE / 2 - 8);
      cx.fillText(`${this.count} jumps`, x + SIZE / 2, y + SIZE / 2 + 14);
      cx.textAlign = 'left';
    }
  }
}

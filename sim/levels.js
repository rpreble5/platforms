/**
 * Arena layout. Pure — no DOM.
 *
 * Two choice layouts share one fairness rule: within a layout, every answer
 * sits at the same height and costs the same number of jumps. If answers were
 * at different heights or hop counts, some would be harder to reach than
 * others, and a player who wanted the hard one would lose points to the layout
 * rather than to their knowledge. They'd be right to complain.
 *
 *  - `row` — the original: answers one jump above the floor. Run, jump, done.
 *  - `islands` (default) — answers two jumps up, out of direct reach from the
 *    floor, with a tier of non-answer perches between. Every answer is one
 *    diagonal hop from an adjacent perch, and every perch one jump from the
 *    floor: exactly two committed jumps per answer, whichever answer it is.
 *  - `pyramid` / `reverse-pyramid` — answers at DIFFERENT heights, stacked
 *    into a peak (or a valley). These deliberately trade the equal-effort
 *    rule for shape and drama, which is why they are opt-in per question
 *    rather than a default: the deck author is choosing the spice. Both are
 *    left-right symmetric, and every hop is the same 160px rise as always.
 */

import { PHYS, WORLD_H, WORLD_W } from '../shared/tuning.js';

/** @typedef {import('./collide.js').Platform} Platform */

/**
 * The tile grid, in display pixels. Answer boards are assembled from repeating
 * tiles rather than one stretched image, so every board dimension has to be a
 * whole number of tiles — which is also what makes boards of *different* sizes
 * free: any multiple of GRID is a legal width.
 */
export const GRID = 24;

/** Top of the floor. */
export const FLOOR_Y = WORLD_H - 100;
/**
 * Top of the answer platforms. The jump apex is ~220px, so a 160px rise leaves
 * roughly 37% slack — nobody should ever miss one of these, which is the point:
 * a game that never demands precision cannot be ruined by latency.
 */
export const ANSWER_Y = FLOOR_Y - 160;
/**
 * Collision height: the top tile row. Answer platforms are one-way and landing
 * uses a swept test, so a thin surface is safe — nobody can tunnel through it.
 */
export const ANSWER_H = GRID;
/**
 * How tall the answer platform is *drawn*, versus the one tile row it actually
 * collides with. The extra hangs below the surface and carries the answer
 * text, so the platform IS the signboard rather than having a label bolted
 * under it.
 *
 * Four tile rows, sized for two lines of readable answer text. In the
 * elevated layouts (boards at 660 and above) the air below is empty, so the
 * deeper skirt costs nothing. In the flat row layout the skirt bottom now
 * reaches y=916, inside the tallest floor-stander's head zone (~902+) — but
 * avatars draw OVER boards, the overlap is a few px at the board's edge, and
 * it only occurs at full avatar scale in a near-empty room. Bigger answer
 * text every round beats a cosmetic brush in the rare case.
 */
export const ANSWER_SIGN_H = GRID * 4;

const EDGE_MARGIN = 70;
const MIN_GAP = 60;

/**
 * The platform id of the correct band in a range round. Starts with 'ans' so
 * everything keyed on "the answer platform" — arrivals, atBuzzer, scoring —
 * treats it exactly like a signboard platform.
 */
export const RANGE_ID = 'ansband';
/**
 * Never build a band narrower than this. A range like [9, 9.05] on a 0-100
 * scale would map to a strip thinner than a player; standing "in" it would be
 * luck. Two tiles is comfortably wider than one avatar.
 */
export const RANGE_MIN_W = GRID * 2;

/**
 * @typedef {object} RangeQuestion
 * @property {'range'} type
 * @property {string} text
 * @property {number} min left end of the number line
 * @property {number} max right end of the number line
 * @property {[number, number]} answer inclusive correct interval
 * @property {string} [unit] shown on the line's last label and the reveal
 */

/**
 * Where a value sits on screen. The line spans the same usable width the
 * answer boards do, so the mapping is shared by the arena builder and the
 * number-line renderer — one function, or the zone and its labels drift apart.
 * @param {{min: number, max: number}} q
 * @param {number} v
 * @returns {number} x in world pixels
 */
export function rangeX(q, v) {
  const usable = WORLD_W - EDGE_MARGIN * 2;
  return EDGE_MARGIN + ((v - q.min) / (q.max - q.min)) * usable;
}

/**
 * Arena for a range question: the floor itself is the answer, split into three
 * adjacent segments at the exact pixels where the correct interval starts and
 * ends. The middle segment carries the answer id, so the entire scoring
 * machine — first-touch arrivals, the buzzer snapshot, the settle — works on
 * it unchanged. At the reveal the two outer segments crumble like wrong
 * signboards do, and everyone standing on them goes down with the floor.
 *
 * The `pit` is an invisible ledge just below the visible world. Without it,
 * fallers cross KILL_Y, respawn at centre screen, fall again, and loop for the
 * whole scoreboard. With it they land once, out of sight, and stay there until
 * the next question respawns everyone.
 * @param {RangeQuestion} q
 * @returns {Platform[]}
 */
export function buildRangeArena(q) {
  let xa = rangeX(q, q.answer[0]);
  let xb = rangeX(q, q.answer[1]);
  if (xb - xa < RANGE_MIN_W) {
    const c = (xa + xb) / 2;
    xa = c - RANGE_MIN_W / 2;
    xb = c + RANGE_MIN_W / 2;
  }

  return [
    { id: 'floorL', x: -400, y: FLOOR_Y, w: xa + 400, h: 260 },
    { id: RANGE_ID, x: xa, y: FLOOR_Y, w: xb - xa, h: 260 },
    { id: 'floorR', x: xb, y: FLOOR_Y, w: WORLD_W + 400 - xb, h: 260 },
    { id: 'pit', x: -400, y: WORLD_H + 150, w: WORLD_W + 800, h: 60 },
  ];
}

/**
 * Perch tier: same rise as the row layout's answers, so it's the same proven
 * jump. Island tier doubles it — 320px is beyond the ~220px apex, which is
 * what makes the perches mandatory rather than decorative.
 */
export const PERCH_Y = FLOOR_Y - 160;
export const ISLAND_Y = FLOOR_Y - 320;
/** Perches are stepping stones, not destinations — big enough to land on with slack. */
export const PERCH_W = GRID * 9;
/**
 * Elevated answer boards are capped so they read as islands rather than
 * shelves. 20 tiles; the 2-answer row layout would otherwise produce 840px
 * monsters half a screen wide.
 */
const ISLAND_MAX_W = GRID * 20;

/** One hop of height. Every tier in every layout is a multiple of this. */
export const TIER = FLOOR_Y - PERCH_Y;

/** @param {number} t @returns {number} y of a platform surface t hops up */
export function tierY(t) {
  return FLOOR_Y - TIER * t;
}

/** @typedef {'row'|'islands'|'pyramid'|'reverse-pyramid'} Layout */

/**
 * @param {number} n number of answers, 2-5
 * @param {Layout} [layout]
 * @returns {Platform[]}
 */
export function buildArena(n, layout = 'islands') {
  if (layout === 'row') return buildRowArena(n);
  if (layout === 'pyramid' || layout === 'reverse-pyramid') {
    return buildTieredArena(n, layout);
  }
  return buildIslandArena(n);
}

/**
 * The original single-jump row. Kept for question packs that want the plain
 * sprint (`"layout": "row"`), and as the geometry the physics comments in
 * tuning.js were derived against.
 * @param {number} n
 * @returns {Platform[]}
 */
export function buildRowArena(n) {
  const count = Math.max(2, Math.min(5, n));

  /** @type {Platform[]} */
  const platforms = [
    { id: 'floor', x: -400, y: FLOOR_Y, w: WORLD_W + 800, h: 260 },
  ];

  const usable = WORLD_W - EDGE_MARGIN * 2;
  // Snap the board to whole tiles and give the remainder to the gaps. Gaps are
  // the right place for slack: they're empty air, so a few odd pixels there
  // cost nothing, while an odd pixel on a board is a half-drawn tile.
  const width = snapToGrid((usable - MIN_GAP * (count - 1)) / count);
  const gap = count > 1 ? Math.floor((usable - width * count) / (count - 1)) : 0;

  for (let i = 0; i < count; i++) {
    platforms.push({
      id: answerId(i),
      x: EDGE_MARGIN + i * (width + gap),
      y: ANSWER_Y,
      w: width,
      h: ANSWER_H,
      // Jump-through from below, so a crowd under a platform can still get up
      // onto it instead of bonking and blaming the game.
      oneWay: true,
    });
  }

  return platforms;
}

/**
 * Answers as high islands, perches between them.
 *
 * Answers sit centred in `n` equal slots; perches sit at the slot boundaries,
 * one tier down. Placing perches at the boundaries guarantees each answer
 * horizontally overlaps (or nearly touches) an adjacent perch, so the final
 * hop is a near-vertical jump — reachable with the same slack as everything
 * else in this game. The 2-answer arena adds a perch at each outer edge so
 * both flanks have a route and the middle perch isn't a single choke point.
 *
 * The perch count changing with the answer count (3, 2, 3, 4 for n=2..5) is
 * what makes each arena feel like a different level without any layout being
 * harder than another.
 * @param {number} n
 * @returns {Platform[]}
 */
export function buildIslandArena(n) {
  const count = Math.max(2, Math.min(5, n));

  /** @type {Platform[]} */
  const platforms = [
    { id: 'floor', x: -400, y: FLOOR_Y, w: WORLD_W + 800, h: 260 },
  ];

  const usable = WORLD_W - EDGE_MARGIN * 2;
  const spacing = usable / count;
  const width = Math.min(snapToGrid(spacing - MIN_GAP), ISLAND_MAX_W);

  for (let i = 0; i < count; i++) {
    const center = EDGE_MARGIN + (i + 0.5) * spacing;
    platforms.push({
      id: answerId(i),
      x: center - width / 2,
      y: ISLAND_Y,
      w: width,
      h: ANSWER_H,
      oneWay: true,
    });
  }

  let perch = 0;
  for (let j = 0; j < count - 1; j++) {
    platforms.push({
      id: `perch${perch++}`,
      x: EDGE_MARGIN + (j + 1) * spacing - PERCH_W / 2,
      y: PERCH_Y,
      w: PERCH_W,
      h: ANSWER_H,
      oneWay: true,
    });
  }
  if (count === 2) {
    for (const x of [EDGE_MARGIN, WORLD_W - EDGE_MARGIN - PERCH_W]) {
      platforms.push({
        id: `perch${perch++}`,
        x,
        y: PERCH_Y,
        w: PERCH_W,
        h: ANSWER_H,
        oneWay: true,
      });
    }
  }

  return platforms;
}

/** Board width in the tiered layouts: 14 tiles, small enough to stack. */
const TIER_BOARD_W = GRID * 14;

/**
 * Hand-placed tier maps for the stacked layouts, one per answer count.
 * `ans` and `perch` are [centerX, tier] pairs; answers keep deck order left
 * to right. Placements obey two rules the reachability test enforces:
 * every board is reachable from the floor through hops that rise exactly one
 * TIER with at most a small horizontal gap, and nothing on a shared tier
 * touches. Highest surface is tier 4 (y=340) — any higher collides with the
 * question banner.
 *
 * @type {Record<string, Record<number, {ans: number[][], perch: number[][]}>>}
 */
const TIERED = {
  pyramid: {
    2: { ans: [[630, 2], [1290, 2]], perch: [[350, 1], [960, 1], [1570, 1], [960, 3]] },
    3: { ans: [[550, 2], [960, 3], [1370, 2]], perch: [[250, 1], [960, 1], [1670, 1]] },
    4: {
      ans: [[430, 2], [745, 3], [1175, 3], [1490, 2]],
      perch: [[178, 1], [960, 1], [1742, 1], [960, 2]],
    },
    5: {
      ans: [[350, 2], [655, 3], [960, 4], [1265, 3], [1570, 2]],
      perch: [[178, 1], [960, 1], [1742, 1], [960, 2]],
    },
  },
  'reverse-pyramid': {
    2: { ans: [[250, 3], [1670, 3]], perch: [[400, 1], [1520, 1], [178, 2], [1742, 2]] },
    3: { ans: [[250, 3], [960, 1], [1670, 3]], perch: [[400, 1], [1520, 1], [178, 2], [1742, 2]] },
    4: {
      ans: [[250, 3], [745, 1], [1175, 1], [1670, 3]],
      perch: [[400, 1], [1520, 1], [178, 2], [1742, 2]],
    },
    5: {
      ans: [[250, 3], [605, 2], [960, 1], [1315, 2], [1670, 3]],
      perch: [[350, 1], [1570, 1], [178, 2], [1742, 2]],
    },
  },
};

/**
 * A stacked arena from a tier map: pyramid rises toward the centre, reverse
 * pyramid toward the edges. The 5-answer pyramid is the full ziggurat —
 * adjacent answer boards overlap slightly in x, one tier apart, so the
 * pyramid face itself is climbable step by step.
 * @param {number} n
 * @param {'pyramid'|'reverse-pyramid'} layout
 * @returns {Platform[]}
 */
export function buildTieredArena(n, layout) {
  const count = Math.max(2, Math.min(5, n));
  const spec = TIERED[layout][count];

  /** @type {Platform[]} */
  const platforms = [
    { id: 'floor', x: -400, y: FLOOR_Y, w: WORLD_W + 800, h: 260 },
  ];

  spec.ans.forEach(([center, tier], i) => {
    platforms.push({
      id: answerId(i),
      x: center - TIER_BOARD_W / 2,
      y: tierY(tier),
      w: TIER_BOARD_W,
      h: ANSWER_H,
      oneWay: true,
    });
  });
  spec.perch.forEach(([center, tier], j) => {
    platforms.push({
      id: `perch${j}`,
      x: center - PERCH_W / 2,
      y: tierY(tier),
      w: PERCH_W,
      h: ANSWER_H,
      oneWay: true,
    });
  });

  return platforms;
}

/**
 * Largest legal board width at or below `px` — a whole number of tiles, and
 * never zero. Anything that wants a board of a particular size goes through
 * here, so the rounding rule lives in exactly one place.
 * @param {number} px
 * @returns {number}
 */
export function snapToGrid(px) {
  return Math.max(GRID, Math.floor(px / GRID) * GRID);
}

/** @param {number} i @returns {string} */
export function answerId(i) {
  return `ans${i}`;
}

/**
 * Spawn positions along the floor, spread so 30 simultaneous joins don't stack,
 * and so nobody starts systematically closer to one answer than another.
 * @param {number} index
 * @returns {{x:number, y:number}}
 */
export function spawnFor(index) {
  const lanes = 24;
  const lane = index % lanes;
  // Past 24 players the lanes wrap, and without this offset the 25th player
  // starts on *exactly* the same pixel as the 1st. Two perfectly stacked
  // avatars are the worst case for telling anyone apart — the one on top hides
  // the other completely — so wrapped players sit half a lane over.
  const wrap = Math.floor(index / lanes) % 2;
  const x = EDGE_MARGIN + ((lane + 0.5 + wrap * 0.5) / lanes) * (WORLD_W - EDGE_MARGIN * 2);
  return { x: x - PHYS.PLAYER_W / 2, y: FLOOR_Y - PHYS.PLAYER_H - 4 };
}

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
 *  - `islands` (default) — answers three jumps up on tall signboards, reached
 *    by ladder columns of non-answer rungs that climb through the gaps (or up
 *    the flanks when the boards leave no room between them). The final move
 *    onto an answer is always a flat same-tier hop, which is the load-bearing
 *    detail: a player standing one tier below a board would have their name
 *    label drawn straight across its text, and with 30 people playing the
 *    answers would disappear behind names. Climbing happens beside the boards,
 *    never under them. At 4-5 answers the inner boards cost one or two extra
 *    flat hops (you cross the outer boards to reach them) — a smaller fairness
 *    trade than pyramid makes, and horizontal hops are the cheapest move in
 *    the game.
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
 * How the answer text attaches to a platform. The platform itself is now a
 * thin slab everywhere; the text rides in one of two places, chosen per
 * layout:
 *
 *  - 'plaque' — a signboard hanging BELOW the slab on two short posts. Used
 *    by the elevated layouts (islands, pyramid, reverse-pyramid): a crowd on
 *    the slab can never cover text beneath it, and a flag above a stacked
 *    board would spear the board one tier up. THE LAYOUT RULE still applies:
 *    name labels are ~190px wide and sit ~118px above a standing surface, so
 *    no surface one tier below a board may come near its footprint.
 *  - 'flag' — a banner ABOVE the slab on a pole, tall enough to clear the
 *    heads and name labels of players standing on it. Used by the flat row
 *    layout, where a hanging plaque would dangle straight into the floor
 *    crowd's name labels — the constraint that used to force the row's text
 *    small. Flags finally give the row big text.
 *
 * Drawn geometry (the sim collides with none of this; only ANSWER_H is real):
 */
export const SLAB_H = ANSWER_H + 4;
export const PLAQUE_GAP = 14;
export const PLAQUE_H = 88;
export const FLAG_POLE = 200;
export const FLAG_H = 76;

/** @typedef {'plaque'|'flag'} SignStyle */

/**
 * The drawn extent below a board's surface — the zone a name label must not
 * cover (answers beat labels; see render.js).
 * @param {import('./collide.js').Platform} p
 * @returns {number}
 */
export function signBelowExtent(p) {
  return p.signStyle === 'plaque' ? SLAB_H + PLAQUE_GAP + PLAQUE_H : SLAB_H;
}

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
 * jump. Island boards sit three tiers up — well beyond the ~220px jump apex,
 * which is what makes the ladder columns mandatory rather than decorative,
 * and high enough that the floor crowd's name labels can never reach the
 * signboard text.
 */
export const PERCH_Y = FLOOR_Y - 160;
export const ISLAND_Y = FLOOR_Y - 480;
/** Perches are stepping stones, not destinations — big enough to land on with slack. */
export const PERCH_W = GRID * 9;

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
      // Text flies ABOVE the row's boards: below them is the floor crowd.
      signStyle: 'flag',
    });
  }

  return platforms;
}

/**
 * Hand-designed island maps, one per answer count — built for THIRTY people
 * moving at once:
 *
 *  - MULTIPLE PATHS: every board is approachable from both sides — a ladder
 *    in every inter-board gap AND on both flanks — so no single column ever
 *    has to carry the room, and picking the far answer never means joining
 *    the same climb as everyone else.
 *  - MAXIMUM SPACING: ladders spread across the full width, so the crowd
 *    distributes instead of piling into one visual knot.
 *  - BIG SCAFFOLDING: tier-1 bases are the widest surfaces in the arena
 *    (240-576px) — the first jump from the floor is the one everyone makes
 *    at the same moment, so it gets the most landing room. Bases may run
 *    under the boards (two tiers below, labels clear the text by ~106px);
 *    tier-2 rungs sit strictly in the gaps and flanks — one tier below a
 *    board, a name label would cross its plaque, so their footprints never
 *    overlap (the layout test enforces it).
 *
 * `boards`: [centerX, width]. `rungs`: [centerX, tier, width], tiers 1-2-3;
 * jump straight up through each one-way rung, then a flat hop onto a board.
 * Boards gave back some width versus the old formula layouts to pay for the
 * gap ladders — worth it: the ladders are where the crowd lives.
 *
 * @type {Record<number, {boards: number[][], rungs: number[][]}>}
 */
const ISLANDS = {
  2: {
    boards: [[515, 480], [1405, 480]],
    rungs: [
      [960, 1, 576], [960, 2, 384], [960, 3, 384],
      [140, 1, 264], [195, 2, 144], [195, 3, 144],
      [1780, 1, 264], [1725, 2, 144], [1725, 3, 144],
    ],
  },
  3: {
    boards: [[367, 432], [960, 432], [1553, 432]],
    rungs: [
      [663, 1, 336], [663, 2, 144], [663, 3, 144],
      [1257, 1, 336], [1257, 2, 144], [1257, 3, 144],
      [128, 1, 240], [95, 2, 96], [95, 3, 96],
      [1792, 1, 240], [1825, 2, 96], [1825, 3, 96],
    ],
  },
  4: {
    boards: [[292, 312], [738, 312], [1182, 312], [1628, 312]],
    rungs: [
      [515, 1, 336], [515, 2, 96], [515, 3, 96],
      [960, 1, 336], [960, 2, 96], [960, 3, 96],
      [1405, 1, 336], [1405, 2, 96], [1405, 3, 96],
      [140, 1, 264], [80, 2, 96], [80, 3, 96],
      [1780, 1, 264], [1840, 2, 96], [1840, 3, 96],
    ],
  },
  5: {
    boards: [[248, 240], [604, 240], [960, 240], [1316, 240], [1672, 240]],
    rungs: [
      [426, 2, 96], [426, 3, 96],
      [782, 1, 288], [782, 2, 96], [782, 3, 96],
      [1138, 1, 288], [1138, 2, 96], [1138, 3, 96],
      [1494, 2, 96], [1494, 3, 96],
      [140, 1, 264], [72, 2, 96], [72, 3, 96],
      [1780, 1, 264], [1848, 2, 96], [1848, 3, 96],
    ],
  },
};

/**
 * @param {number} n
 * @returns {Platform[]}
 */
export function buildIslandArena(n) {
  const count = Math.max(2, Math.min(5, n));
  const spec = ISLANDS[count];

  /** @type {Platform[]} */
  const platforms = [
    { id: 'floor', x: -400, y: FLOOR_Y, w: WORLD_W + 800, h: 260 },
  ];

  spec.boards.forEach(([center, w], i) => {
    platforms.push({
      id: answerId(i),
      x: center - w / 2,
      y: ISLAND_Y,
      w,
      h: ANSWER_H,
      oneWay: true,
      signStyle: 'plaque',
    });
  });
  spec.rungs.forEach(([center, tier, w], j) => {
    platforms.push({
      id: `perch${j}`,
      x: center - w / 2,
      y: tierY(tier),
      w,
      h: ANSWER_H,
      oneWay: true,
    });
  });

  return platforms;
}

/** Board width in the tiered layouts: 14 tiles, small enough to stack. */
const TIER_BOARD_W = GRID * 14;

/**
 * Hand-placed tier maps for the stacked layouts, one per answer count.
 * `ans` entries are [centerX, tier]; `perch` entries are
 * [centerX, tier, width=PERCH_W] — tier-1 bases run wide where the label
 * rule allows, because the first climb is the one the whole room makes at
 * once. Answers keep deck order left to right. Placements obey two rules the reachability test enforces:
 * every board is reachable from the floor through hops that rise exactly one
 * TIER with at most a small horizontal gap, and nothing on a shared tier
 * touches. Highest surface is tier 4 (y=340) — any higher collides with the
 * question banner.
 *
 * @type {Record<string, Record<number, {ans: number[][], perch: number[][]}>>}
 */
const TIERED = {
  pyramid: {
    2: { ans: [[630, 2], [1290, 2]], perch: [[350, 1, 288], [960, 1, 288], [1570, 1, 288], [960, 3]] },
    3: { ans: [[550, 2], [960, 3], [1370, 2]], perch: [[250, 1, 240], [960, 1, 288], [1670, 1, 240]] },
    4: {
      ans: [[430, 2], [745, 3], [1175, 3], [1490, 2]],
      perch: [[140, 1], [960, 1, 288], [1780, 1], [960, 2]],
    },
    5: {
      ans: [[350, 2], [655, 3], [960, 4], [1265, 3], [1570, 2]],
      perch: [[178, 1], [960, 1, 288], [1742, 1], [960, 2]],
    },
  },
  'reverse-pyramid': {
    2: { ans: [[250, 3], [1670, 3]], perch: [[400, 1, 288], [1520, 1, 288], [178, 2], [1742, 2]] },
    3: { ans: [[250, 3], [960, 1], [1670, 3]], perch: [[400, 1, 288], [1520, 1, 288], [178, 2], [1742, 2]] },
    4: {
      ans: [[250, 3], [745, 1], [1175, 1], [1670, 3]],
      perch: [[400, 1, 288], [1520, 1, 288], [178, 2], [1742, 2]],
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
      signStyle: 'plaque',
    });
  });
  spec.perch.forEach(([center, tier, w = PERCH_W], j) => {
    platforms.push({
      id: `perch${j}`,
      x: center - w / 2,
      y: tierY(tier),
      w,
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

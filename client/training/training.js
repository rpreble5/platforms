/**
 * The question writer's guide: arena diagrams drawn FROM THE REAL LEVEL
 * CODE (sim/levels.js, sim/control-boxes.js) so they track the game, and
 * limits quoted from the SAME module the loader enforces them with
 * (shared/pack-validate.js LIMITS). Relative imports, like the Studio, so
 * the page works from the game server, Render, or GitHub Pages alike.
 */

import { WORLD_W, WORLD_H } from '../../shared/tuning.js';
import { LIMITS } from '../../shared/pack-validate.js';
import { FLOOR_Y, buildArena, buildRangeArena, buildRowArena, answerId } from '../../sim/levels.js';
import { buildControlArena } from '../../sim/control-boxes.js';

// ------------------------------------------------------------------ drawing

const INK = {
  floor: '#d9d9e0',
  plat: '#b9b9c4',
  answer: '#059669',
  answerFill: '#05966922',
  label: '#26262e',
  dim: '#8a8a96',
  band: '#059669',
  image: '#ffffff',
  pit: '#e6e6ec',
};

/**
 * @param {HTMLCanvasElement} c
 * @param {any[]} platforms real platforms from sim/levels.js builders
 * @param {{labels?: string[], image?: boolean, controls?: any[], band?: boolean}} [opts]
 */
function drawArena(c, platforms, opts = {}) {
  c.width = 640;
  c.height = 360;
  const cx = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  cx.scale(c.width / WORLD_W, c.height / WORLD_H);

  let ansIx = 0;
  for (const p of platforms) {
    const isAnswer = p.id.startsWith('ans');
    cx.fillStyle = p.id === 'pit' ? INK.pit
      : isAnswer ? (opts.band && p.id === 'ansband' ? INK.band : INK.answerFill)
      : p.id.startsWith('floor') || p.id.includes('ground') ? INK.floor
      : INK.plat;
    cx.beginPath();
    cx.roundRect(p.x, p.y, p.w, Math.max(p.h, 14), 8);
    cx.fill();
    if (isAnswer && !opts.band) {
      cx.strokeStyle = INK.answer;
      cx.lineWidth = 4;
      cx.stroke();
      const label = opts.labels?.[ansIx] ?? String.fromCharCode(65 + ansIx);
      cx.fillStyle = INK.label;
      cx.font = `800 44px ui-sans-serif, system-ui, sans-serif`;
      cx.textAlign = 'center';
      cx.fillText(label, p.x + p.w / 2, p.y - 18);
      cx.textAlign = 'left';
      ansIx++;
    }
  }

  // control fixtures: little switch boxes on their decks
  for (const f of opts.controls ?? []) {
    cx.fillStyle = INK.answerFill;
    cx.strokeStyle = INK.answer;
    cx.lineWidth = 3;
    cx.beginPath();
    cx.roundRect(f.x, f.y, f.w, f.h, 8);
    cx.fill();
    cx.stroke();
  }

  if (opts.band) {
    cx.fillStyle = INK.dim;
    cx.font = `700 34px ui-sans-serif, system-ui, sans-serif`;
    cx.fillText('min', 60, FLOOR_Y - 40);
    cx.textAlign = 'right';
    cx.fillText('max', WORLD_W - 60, FLOOR_Y - 40);
    cx.textAlign = 'center';
    cx.fillStyle = INK.answer;
    const band = platforms.find((p) => p.id === 'ansband');
    if (band) cx.fillText('the answer band', band.x + band.w / 2, band.y - 24);
    cx.textAlign = 'left';
  }

  if (opts.image) {
    // the picture questions' airspace: a matte above the row
    const w = 780, h = 420, x = (WORLD_W - w) / 2, y = 190;
    cx.fillStyle = INK.image;
    cx.beginPath();
    cx.roundRect(x, y, w, h, 14);
    cx.fill();
    cx.strokeStyle = '#d8d8e0';
    cx.lineWidth = 3;
    cx.stroke();
    cx.fillStyle = INK.dim;
    cx.font = `700 40px ui-sans-serif, system-ui, sans-serif`;
    cx.textAlign = 'center';
    cx.fillText('your image', x + w / 2, y + h / 2 + 14);
    cx.textAlign = 'left';
  }

  // question text position hint
  cx.fillStyle = INK.dim;
  cx.font = `800 46px ui-sans-serif, system-ui, sans-serif`;
  cx.textAlign = 'center';
  cx.fillText(opts.image ? '' : 'your question sits up here', WORLD_W / 2, 110);
  cx.textAlign = 'left';
}

// ------------------------------------------------------------------ arena cards

/** @type {Array<{title:string, tag:string, body:string, build: () => {platforms:any[], opts?:any}}>} */
const ARENAS = [
  {
    title: 'Islands', tag: 'choice · default',
    body: `The default for multiple choice: floating boards, one per answer (${LIMITS.answers[0]}-${LIMITS.answers[1]} of them). The game also rotates hand-designed variations of this arena, so repeat questions still feel fresh.`,
    build: () => ({ platforms: buildArena(4, 'islands') }),
  },
  {
    title: 'Row', tag: 'layout: row',
    body: 'Everything on one line at ground level — the easiest arena to read and reach. Good for warmups and two-option questions.',
    build: () => ({ platforms: buildArena(4, 'row') }),
  },
  {
    title: 'Pyramid', tag: 'layout: pyramid',
    body: 'Answers climb toward the middle. A little platforming challenge — save it for when the room has warmed up.',
    build: () => ({ platforms: buildArena(5, 'pyramid') }),
  },
  {
    title: 'Reverse pyramid', tag: 'layout: reverse-pyramid',
    body: 'High on the outside, low in the middle. Same skill bump as the pyramid, opposite shape.',
    build: () => ({ platforms: buildArena(5, 'reverse-pyramid') }),
  },
  {
    title: 'Picture question', tag: 'image on any type',
    body: 'Attach an EKG, a rash, an X-ray — the image hangs in the airspace and the platforms drop to a ground row so nothing blocks it. Landscape images read best on a projector.',
    build: () => ({ platforms: buildArena(4, 'row'), opts: { image: true } }),
  },
  {
    title: 'Range', tag: 'number line',
    body: 'The whole floor becomes a number line from your min to your max; players stand where they believe the answer is, and the correct band is revealed. Great for doses, percentages, and "how many…" estimates.',
    build: () => ({
      platforms: buildRangeArena(/** @type {any} */ ({ min: 0, max: 160, answer: [60, 100] })),
      opts: { band: true },
    }),
  },
  {
    title: 'Lightning sort', tag: 'rapid fire',
    body: `${LIMITS.buckets[0]}-${LIMITS.buckets[1]} category buckets stay up while ${LIMITS.items[0]}-${LIMITS.items[1]} items flash past, ${LIMITS.sortItemSeconds[0]}-${LIMITS.sortItemSeconds[1]} seconds each — players dash to the right bucket for every item. Items play in shuffled order.`,
    build: () => ({ platforms: buildRowArena(3), opts: { labels: ['Bucket A', 'Bucket B', 'Bucket C'] } }),
  },
  {
    title: 'Control Room', tag: 'teams only',
    body: `A wall of ${LIMITS.controls[0]}-${LIMITS.controls[1]} switches and dials one team must set together against the clock (${LIMITS.controlSeconds[0]}-${LIMITS.controlSeconds[1]} s). Each case is one clinical decision moment — first-hour orders are the sweet spot.`,
    build: () => {
      const a = buildControlArena(8);
      return { platforms: a.platforms, opts: { controls: a.controls } };
    },
  },
];

const arenaHolder = /** @type {HTMLElement} */ (document.getElementById('arenas'));
for (const spec of ARENAS) {
  const card = document.createElement('div');
  card.className = 'card';
  const h = document.createElement('h3');
  h.textContent = spec.title;
  const tag = document.createElement('span');
  tag.className = 'tag';
  tag.textContent = spec.tag;
  h.appendChild(tag);
  const p = document.createElement('p');
  p.textContent = spec.body;
  const canvas = document.createElement('canvas');
  card.append(h, p, canvas);
  arenaHolder.appendChild(card);
  const { platforms, opts } = spec.build();
  drawArena(canvas, platforms, opts);
}

// ------------------------------------------------------------------ fit checker

const FITS = [
  { label: 'Question text', limit: LIMITS.questionChars, sample: 'Which was invented first?', why: 'painted across the top of the arena' },
  { label: 'An answer', limit: LIMITS.answerChars, sample: 'The stethoscope', why: 'painted on a platform sign' },
  { label: 'A sort bucket or item', limit: LIMITS.sortLabelChars, sample: 'Gram positive', why: 'flashes for a few seconds — shortest wins' },
  { label: 'A control label', limit: LIMITS.controlLabelChars, sample: 'Blood cultures', why: 'sits on a switch in the Control Room wall' },
  { label: 'A showdown statement', limit: LIMITS.statementChars, sample: 'An octopus has three hearts', why: 'read at speed in the finale' },
];

const fitHolder = /** @type {HTMLElement} */ (document.getElementById('fit'));
for (const f of FITS) {
  const wrap = document.createElement('div');
  const label = document.createElement('label');
  label.textContent = `${f.label} — up to ${f.limit} characters (${f.why})`;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = f.sample;
  const meter = document.createElement('div');
  meter.className = 'meter';
  const bar = document.createElement('div');
  meter.appendChild(bar);
  const note = document.createElement('div');
  note.className = 'fitnote';
  const update = () => {
    const n = input.value.length;
    bar.style.width = `${Math.min(100, (n / f.limit) * 100)}%`;
    meter.classList.toggle('over', n > f.limit);
    note.textContent = n > f.limit
      ? `${n}/${f.limit} — still plays, but it will shrink small on the projector`
      : `${n}/${f.limit}`;
  };
  input.oninput = update;
  update();
  wrap.append(label, input, meter, note);
  fitHolder.appendChild(wrap);
}

// ------------------------------------------------------------------ numbers

const NUMBERS = [
  ['Answers per choice question', `${LIMITS.answers[0]} – ${LIMITS.answers[1]}`],
  ['Select-all: correct answers', '2 or more, and at least one wrong answer must remain'],
  ['Sort buckets', `${LIMITS.buckets[0]} – ${LIMITS.buckets[1]}`],
  ['Sort items', `${LIMITS.items[0]} – ${LIMITS.items[1]}, each assigned to one bucket`],
  ['Seconds per sort item', `${LIMITS.sortItemSeconds[0]} – ${LIMITS.sortItemSeconds[1]} (default 6)`],
  ['Controls per Control Room case', `${LIMITS.controls[0]} – ${LIMITS.controls[1]} (toggles and numeric dials)`],
  ['Control Room cases per pack', 'at least one per team — 3 PGY teams need 3+ cases'],
  ['Seconds per control turn', `${LIMITS.controlSeconds[0]} – ${LIMITS.controlSeconds[1]} (default 40)`],
  ['Seconds per standard question', 'the pack sets it (default 12)'],
  ['Range question', 'numeric min < max, answer band [low, high] inside them'],
  ['Images', 'png / jpg / webp / svg, one per question, sent along with the pack'],
];

const table = /** @type {HTMLElement} */ (document.getElementById('numbers'));
table.innerHTML = '<tr><th>what</th><th>the rule</th></tr>';
for (const [what, rule] of NUMBERS) {
  const tr = document.createElement('tr');
  const a = document.createElement('td');
  a.textContent = what;
  const b = document.createElement('td');
  b.className = 'num';
  b.style.whiteSpace = 'normal';
  b.textContent = rule;
  tr.append(a, b);
  table.appendChild(tr);
}

/**
 * The Pack Studio: zero-install pack authoring for faculty.
 *
 * Everything runs in the browser. Validation is the SAME module the game
 * server uses (shared/pack-validate.js), and the preview is the ACTUAL game
 * engine drawing into a canvas — what faculty see is what the room gets.
 * Nothing leaves this page until Download/Copy; drafts autosave locally.
 *
 * All imports are RELATIVE so the page works from any base path: the game
 * server serves it at /builder, and GitHub Pages serves it straight from
 * the repository for people who have nothing installed.
 */

import { PACK_THEMES, validatePack } from '../../shared/pack-validate.js';
import { STEP_MS, MAX_FRAME_DT_MS, MAX_STEPS_PER_FRAME } from '../../shared/tuning.js';
import { createWorld } from '../../sim/world.js';
import { PHASE, configureControlRounds, createGame, startGame, stepRound } from '../../sim/round.js';
import { createShowdown, stepShowdown } from '../../sim/showdown.js';
import { setTheme } from '../display/themes.js';
import { render } from '../display/render.js';
import { drawConfetti } from '../display/fx.js';
import { drawRoundOverlay, registerPreviewImage } from '../display/round-ui.js';
import { drawShowdown } from '../display/showdown-ui.js';

// ------------------------------------------------------------------ state

const DRAFT_KEY = 'packstudio-draft';

/** The authored model — plain pack JSON, exactly what export writes. */
/** @type {any} */
let model = {
  pack: 'New pack',
  theme: 'blanc',
  answerMs: 12000,
  order: 'authored',
  questions: [],
  controlRoom: { perTeam: 1, answerMs: 40000, questions: [] },
  showdown: { answerMs: 6000, statements: [] },
};

/** @type {'deck'|'control'|'showdown'} */
let tab = 'deck';
/** Selected index per bucket. */
const selIx = { deck: -1, control: -1, showdown: -1 };
/** Local image files chosen this session, filename -> object URL. */
const localImages = new Map();

const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));

/** @returns {any[]} */
function bucketList() {
  return tab === 'deck' ? model.questions
    : tab === 'control' ? model.controlRoom.questions
    : model.showdown.statements;
}

// ------------------------------------------------------------ new items

/** @returns {any} */
function newDeckQuestion(/** @type {string} */ kind) {
  if (kind === 'range') {
    return { type: 'range', text: 'New range question?', min: 0, max: 100, answer: [40, 60], unit: '' };
  }
  if (kind === 'sort') {
    return {
      type: 'sort', text: 'Sort each item', buckets: ['Bucket A', 'Bucket B'],
      items: [{ label: 'Item 1', bucket: 0 }, { label: 'Item 2', bucket: 1 }], itemMs: 6000,
    };
  }
  return { text: 'New question?', answers: ['Answer 1', 'Answer 2', 'Answer 3'], correct: 0 };
}

function newControlCase() {
  return {
    text: 'New case: set the controls',
    context: '',
    controls: Array.from({ length: 6 }, (_, i) => ({
      label: `Control ${i + 1}`, kind: 'toggle', initial: false, answer: i % 2 === 0,
    })),
  };
}

const newStatement = () => ({ text: 'A true statement', answer: true });

// ------------------------------------------------------------ validation

/** Validate a deep clone (validatePack normalizes in place). */
function validated() {
  return validatePack(structuredClone(exportable()));
}

/** The exportable pack: authored model minus empty optional buckets. */
function exportable() {
  /** @type {any} */
  const out = {
    pack: model.pack,
    theme: model.theme,
    answerMs: model.answerMs,
    questions: structuredClone(model.questions),
  };
  if (model.order !== 'authored') out.order = model.order;
  if (model.controlRoom.questions.length) out.controlRoom = structuredClone(model.controlRoom);
  if (model.showdown.statements.length) out.showdown = structuredClone(model.showdown);
  return out;
}

function refreshProblems() {
  const { problems } = validated();
  const el = $('problems');
  if (!problems.length) {
    el.className = 'ok';
    el.textContent = 'No problems — this pack loads clean.';
  } else {
    el.className = '';
    el.textContent = problems.join('\n');
  }
}

// ------------------------------------------------------------------ list UI

function refreshList() {
  const list = bucketList();
  const holder = $('qlist');
  holder.replaceChildren();
  const { problems } = validated();
  list.forEach((/** @type {any} */ q, /** @type {number} */ i) => {
    const row = document.createElement('div');
    row.className = 'qrow' + (i === selIx[tab] ? ' on' : '');
    const where = tab === 'deck' ? `Q${i + 1}` : tab === 'control' ? `control #${i + 1}` : `showdown #${i + 1}`;
    if (problems.some((m) => m.startsWith(where + ':') || m.startsWith(where + ' '))) row.classList.add('bad');
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = tab !== 'deck' ? (tab === 'control' ? 'case' : 't/f')
      : q.type === 'range' ? 'range'
      : q.type === 'sort' ? 'sort'
      : Array.isArray(q.correct) ? 'multi'
      : q.image ? 'pic' : 'choice';
    const t = document.createElement('span');
    t.className = 't';
    t.textContent = q.text || '(untitled)';
    row.append(badge, t);
    row.onclick = () => { selIx[tab] = i; refreshAll(); };
    holder.appendChild(row);
  });
  $('bucketHint').textContent =
    tab === 'deck' ? 'Plays in free-for-all AND teams. Types: choice, select-all, range, sort — any with a picture.'
    : tab === 'control' ? 'Teams only: cases play as team turns between questions, or as the standalone Control Room.'
    : 'The finale mode: true/false, no points, last one standing.';
}

// ------------------------------------------------------------------ editor

function refreshEditor() {
  const list = bucketList();
  const q = list[selIx[tab]];
  const body = $('editorBody');
  body.replaceChildren();
  if (!q) {
    $('editorTitle').textContent = 'Question';
    body.innerHTML = '<span class="hint">Add or select an item on the left.</span>';
    return;
  }
  $('editorTitle').textContent =
    tab === 'deck' ? 'Deck question' : tab === 'control' ? 'Control Room case' : 'Showdown statement';

  const text = field(body, 'Text', q.text ?? '', (v) => { q.text = v; });
  text.focus?.();

  if (tab === 'showdown') {
    check(body, 'Statement is TRUE', q.answer === true, (v) => { q.answer = v; });
    return;
  }

  if (tab === 'control') {
    field(body, 'Context (subtitle for the room)', q.context ?? '', (v) => { q.context = v; });
    numField(body, 'Turn length (seconds, 10-90)', (q.answerMs ?? model.controlRoom.answerMs) / 1000, (v) => { q.answerMs = Math.round(v * 1000); });
    const h = document.createElement('label');
    h.textContent = `Controls (${q.controls.length}) — 6 to 8 required`;
    body.appendChild(h);
    q.controls.forEach((/** @type {any} */ c, /** @type {number} */ ci) => {
      const box = document.createElement('div');
      box.className = 'card';
      box.style.padding = '10px';
      box.style.marginBottom = '8px';
      inlineField(box, 'Label', c.label, (v) => { c.label = v; });
      const kindSel = document.createElement('select');
      for (const k of ['toggle', 'number']) {
        const o = document.createElement('option');
        o.value = k; o.textContent = k; if (c.kind === k) o.selected = true;
        kindSel.appendChild(o);
      }
      kindSel.onchange = () => {
        c.kind = kindSel.value;
        if (c.kind === 'number' && !Number.isFinite(c.min)) {
          Object.assign(c, { initial: 0, answer: 2, min: 0, max: 10, step: 1, unit: '' });
        }
        if (c.kind === 'toggle') { c.initial = false; c.answer = true; }
        refreshAll();
      };
      box.appendChild(kindSel);
      if (c.kind === 'toggle') {
        check(box, 'Starts ON', c.initial === true, (v) => { c.initial = v; });
        check(box, 'Correct answer is ON', c.answer === true, (v) => { c.answer = v; });
      } else {
        const grid = document.createElement('div');
        grid.className = 'row';
        box.appendChild(grid);
        for (const key of ['initial', 'answer', 'min', 'max', 'step']) {
          const cell = document.createElement('div');
          grid.appendChild(cell);
          numField(cell, key, c[key] ?? 0, (v) => { c[key] = v; });
        }
        inlineField(box, 'Unit', c.unit ?? '', (v) => { c.unit = v; });
      }
      const del = document.createElement('button');
      del.className = 'small danger';
      del.textContent = 'Remove control';
      del.onclick = () => { q.controls.splice(ci, 1); refreshAll(); };
      box.appendChild(del);
      body.appendChild(box);
    });
    const add = document.createElement('button');
    add.className = 'small';
    add.textContent = '+ Add control';
    add.onclick = () => {
      q.controls.push({ label: `Control ${q.controls.length + 1}`, kind: 'toggle', initial: false, answer: true });
      refreshAll();
    };
    body.appendChild(add);
    return;
  }

  // ---- deck question
  const typeSel = document.createElement('select');
  for (const [v, label] of [['choice', 'multiple choice'], ['range', 'range (number line)'], ['sort', 'lightning sort']]) {
    const o = document.createElement('option');
    o.value = v; o.textContent = label;
    if ((q.type ?? 'choice') === v) o.selected = true;
    typeSel.appendChild(o);
  }
  const tl = document.createElement('label');
  tl.textContent = 'Type';
  body.append(tl, typeSel);
  typeSel.onchange = () => {
    const fresh = newDeckQuestion(typeSel.value === 'choice' ? 'choice' : typeSel.value);
    fresh.text = q.text;
    if (q.image) fresh.image = q.image;
    list[selIx[tab]] = fresh;
    refreshAll();
  };

  if (q.type === 'range') {
    const grid = document.createElement('div');
    grid.className = 'row';
    body.appendChild(grid);
    const cells = [];
    for (const key of ['min', 'max']) {
      const cell = document.createElement('div');
      grid.appendChild(cell); cells.push(cell);
      numField(cell, key, q[key], (v) => { q[key] = v; });
    }
    const grid2 = document.createElement('div');
    grid2.className = 'row';
    body.appendChild(grid2);
    const lo = document.createElement('div'); const hi = document.createElement('div'); const un = document.createElement('div');
    grid2.append(lo, hi, un);
    numField(lo, 'answer low', q.answer?.[0] ?? 0, (v) => { q.answer = [v, q.answer?.[1] ?? v]; });
    numField(hi, 'answer high', q.answer?.[1] ?? 0, (v) => { q.answer = [q.answer?.[0] ?? v, v]; });
    inlineField(un, 'Unit', q.unit ?? '', (v) => { q.unit = v; });
  } else if (q.type === 'sort') {
    listEditor(body, 'Buckets (2-4)', q.buckets, () => 'New bucket', (arr) => { q.buckets = arr; });
    const h = document.createElement('label');
    h.textContent = `Items (${q.items.length}) — 2 to 12, each lands on a bucket`;
    body.appendChild(h);
    q.items.forEach((/** @type {any} */ it, /** @type {number} */ ii) => {
      const rowEl = document.createElement('div');
      rowEl.className = 'arow answers';
      const inp = document.createElement('input');
      inp.type = 'text'; inp.value = it.label;
      inp.oninput = () => { it.label = inp.value; softRefresh(); };
      const bsel = document.createElement('select');
      q.buckets.forEach((/** @type {string} */ b, /** @type {number} */ bi) => {
        const o = document.createElement('option');
        o.value = String(bi); o.textContent = b || `bucket ${bi + 1}`;
        if (it.bucket === bi) o.selected = true;
        bsel.appendChild(o);
      });
      bsel.onchange = () => { it.bucket = Number(bsel.value); softRefresh(); };
      const del = document.createElement('button');
      del.className = 'small danger'; del.textContent = '✕';
      del.onclick = () => { q.items.splice(ii, 1); refreshAll(); };
      rowEl.append(inp, bsel, del);
      body.appendChild(rowEl);
    });
    const add = document.createElement('button');
    add.className = 'small'; add.textContent = '+ Add item';
    add.onclick = () => { q.items.push({ label: `Item ${q.items.length + 1}`, bucket: 0 }); refreshAll(); };
    body.appendChild(add);
    numField(body, 'Seconds per item (3-15)', (q.itemMs ?? 6000) / 1000, (v) => { q.itemMs = Math.round(v * 1000); });
  } else {
    // choice
    const multi = Array.isArray(q.correct);
    const h = document.createElement('label');
    h.textContent = `Answers (2-6) — tick the correct one${multi ? 's' : ''}`;
    body.appendChild(h);
    const wrap = document.createElement('div');
    wrap.className = 'answers';
    body.appendChild(wrap);
    q.answers.forEach((/** @type {string} */ a, /** @type {number} */ ai) => {
      const rowEl = document.createElement('div');
      rowEl.className = 'arow';
      const tick = document.createElement('input');
      tick.type = multi ? 'checkbox' : 'radio';
      tick.name = 'correct';
      tick.checked = multi ? q.correct.includes(ai) : q.correct === ai;
      tick.onchange = () => {
        if (multi) {
          const set = new Set(q.correct);
          tick.checked ? set.add(ai) : set.delete(ai);
          q.correct = [...set].sort((x, y) => x - y);
        } else q.correct = ai;
        softRefresh();
      };
      const inp = document.createElement('input');
      inp.type = 'text'; inp.value = a;
      inp.oninput = () => { q.answers[ai] = inp.value; softRefresh(); };
      const del = document.createElement('button');
      del.className = 'small danger'; del.textContent = '✕';
      del.onclick = () => {
        q.answers.splice(ai, 1);
        if (multi) q.correct = q.correct.filter((/** @type {number} */ c) => c !== ai).map((/** @type {number} */ c) => (c > ai ? c - 1 : c));
        else if (q.correct >= q.answers.length) q.correct = 0;
        refreshAll();
      };
      rowEl.append(tick, inp, del);
      wrap.appendChild(rowEl);
    });
    const add = document.createElement('button');
    add.className = 'small'; add.textContent = '+ Add answer';
    add.onclick = () => { q.answers.push(`Answer ${q.answers.length + 1}`); refreshAll(); };
    body.appendChild(add);
    check(body, 'Select-all-that-apply (2+ correct answers)', multi, (v) => {
      q.correct = v ? [typeof q.correct === 'number' ? q.correct : 0] : (Array.isArray(q.correct) ? q.correct[0] ?? 0 : 0);
      refreshAll();
    });
    const laySel = document.createElement('select');
    for (const l of ['islands', 'row', 'pyramid', 'reverse-pyramid']) {
      const o = document.createElement('option');
      o.value = l; o.textContent = l;
      if ((q.layout ?? 'islands') === l) o.selected = true;
      laySel.appendChild(o);
    }
    laySel.onchange = () => {
      if (laySel.value === 'islands') delete q.layout;
      else q.layout = laySel.value;
      softRefresh();
    };
    const ll = document.createElement('label');
    ll.textContent = 'Layout (picture questions always play the row)';
    body.append(ll, laySel);
  }

  // ---- picture, on any deck type
  const pl = document.createElement('label');
  pl.textContent = 'Picture (optional — EKGs, rashes…)';
  body.appendChild(pl);
  const prow = document.createElement('div');
  prow.className = 'row';
  body.appendChild(prow);
  const fileBtn = document.createElement('button');
  fileBtn.className = 'small';
  fileBtn.textContent = q.image ? `🖼 ${q.image}` : 'Attach image…';
  fileBtn.onclick = async () => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.png,.jpg,.jpeg,.webp,.svg';
    inp.onchange = () => {
      const f = inp.files?.[0];
      if (!f) return;
      q.image = f.name;
      const url = URL.createObjectURL(f);
      localImages.set(f.name, url);
      registerPreviewImage(f.name, url);
      refreshAll();
    };
    inp.click();
  };
  prow.appendChild(fileBtn);
  if (q.image) {
    const clear = document.createElement('button');
    clear.className = 'small danger';
    clear.textContent = 'Remove';
    clear.onclick = () => { delete q.image; refreshAll(); };
    prow.appendChild(clear);
  }
  const note = document.createElement('div');
  note.className = 'hint';
  note.textContent = 'The exported pack references the FILENAME only — send the image file along; the host drops it in questions/images/.';
  body.appendChild(note);
}

// small form helpers -------------------------------------------------------

function field(/** @type {HTMLElement} */ into, /** @type {string} */ label, /** @type {string} */ value, /** @type {(v:string)=>void} */ set) {
  const l = document.createElement('label');
  l.textContent = label;
  const i = document.createElement('input');
  i.type = 'text';
  i.value = value;
  i.oninput = () => { set(i.value); softRefresh(); };
  into.append(l, i);
  return i;
}
const inlineField = field;

function numField(/** @type {HTMLElement} */ into, /** @type {string} */ label, /** @type {number} */ value, /** @type {(v:number)=>void} */ set) {
  const l = document.createElement('label');
  l.textContent = label;
  const i = document.createElement('input');
  i.type = 'number';
  i.value = String(value);
  i.oninput = () => { const v = Number(i.value); if (Number.isFinite(v)) { set(v); softRefresh(); } };
  into.append(l, i);
}

function check(/** @type {HTMLElement} */ into, /** @type {string} */ label, /** @type {boolean} */ value, /** @type {(v:boolean)=>void} */ set) {
  const line = document.createElement('div');
  line.className = 'checkline';
  const i = document.createElement('input');
  i.type = 'checkbox';
  i.checked = value;
  i.onchange = () => { set(i.checked); softRefresh(); };
  const s = document.createElement('span');
  s.textContent = label;
  line.append(i, s);
  into.appendChild(line);
}

function listEditor(/** @type {HTMLElement} */ into, /** @type {string} */ label, /** @type {string[]} */ arr, /** @type {()=>string} */ blank, /** @type {(a:string[])=>void} */ set) {
  const l = document.createElement('label');
  l.textContent = label;
  into.appendChild(l);
  arr.forEach((v, i) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'arow answers';
    const inp = document.createElement('input');
    inp.type = 'text'; inp.value = v;
    inp.oninput = () => { arr[i] = inp.value; softRefresh(); };
    const del = document.createElement('button');
    del.className = 'small danger'; del.textContent = '✕';
    del.onclick = () => { arr.splice(i, 1); set(arr); refreshAll(); };
    rowEl.append(inp, del);
    into.appendChild(rowEl);
  });
  const add = document.createElement('button');
  add.className = 'small'; add.textContent = '+ Add';
  add.onclick = () => { arr.push(blank()); set(arr); refreshAll(); };
  into.appendChild(add);
}

// ------------------------------------------------------------------ preview

const canvas = $('preview');
const cx = canvas.getContext('2d');
/** @type {import('../../sim/world.js').World} */
let pvWorld = createWorld([]);
/** @type {import('../../sim/round.js').Game} */
let pvGame = createGame([]);
/** @type {import('../../sim/showdown.js').Showdown | null} */
let pvShowdown = null;
const emptyRoster = new Map();

/** Rebuild the preview run from the currently selected item. */
function restartPreview() {
  pvShowdown = null;
  pvWorld = createWorld([]);
  const { pack } = validated();
  setTheme(pack.theme);

  if (tab === 'showdown') {
    const st = model.showdown.statements[selIx.showdown];
    if (!st || typeof st.answer !== 'boolean') { pvGame = createGame([]); return; }
    pvShowdown = createShowdown(
      { statements: [structuredClone(st)], answerMs: model.showdown.answerMs },
      pvWorld,
      []
    );
    return;
  }

  if (tab === 'control') {
    const src = model.controlRoom.questions[selIx.control];
    const vetted = validatePack({ questions: [], controlRoom: { perTeam: 1, questions: src ? [structuredClone(src)] : [] } });
    const cq = vetted.pack.controlRoom?.questions[0];
    pvGame = createGame([]);
    if (!cq) return;
    pvGame.mode = 'teams';
    pvGame.activeTeams = [0];
    configureControlRounds(pvGame, { questions: [cq], perTeam: 1, only: true });
    startGame(pvGame, pvWorld);
    return;
  }

  const src = model.questions[selIx.deck];
  const vetted = validatePack({ questions: src ? [structuredClone(src)] : [] });
  const q = vetted.pack.questions[0];
  pvGame = createGame(q ? [q] : [], model.answerMs);
  if (q) startGame(pvGame, pvWorld);
}

let lastT = performance.now();
let acc = 0;
function frame(/** @type {number} */ now) {
  const dt = Math.min(MAX_FRAME_DT_MS, now - lastT);
  lastT = now;
  acc += dt;
  let steps = 0;
  while (acc >= STEP_MS && steps < MAX_STEPS_PER_FRAME) {
    if (pvShowdown) stepShowdown(pvShowdown, pvWorld, STEP_MS);
    else if (pvGame.questions.length || pvGame.controlOnly) stepRound(pvGame, pvWorld, STEP_MS);
    acc -= STEP_MS;
    steps++;
  }
  if (steps === MAX_STEPS_PER_FRAME) acc = 0;

  render(cx, pvWorld, emptyRoster, pvGame, { qr: null, joinUrl: '' });
  if (pvShowdown) {
    drawShowdown(cx, pvShowdown, pvWorld, emptyRoster);
  } else {
    drawConfetti(cx, pvGame, pvWorld);
    drawRoundOverlay(cx, pvGame, emptyRoster, 0, null);
    // A finished one-question run restarts itself after a beat, so the
    // preview is a loop, not a dead screen.
    if (pvGame.phase === PHASE.GAME_OVER && pvGame.phaseT > 2500) restartPreview();
  }
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ IO

function save() {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(model)); } catch { /* full/blocked: drafts are a convenience */ }
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) { adoptImport(JSON.parse(raw)); return true; }
  } catch { /* unreadable draft: start fresh */ }
  return false;
}

/** @param {any} raw imported pack JSON, shaped into the model */
function adoptImport(raw) {
  model = {
    pack: typeof raw?.pack === 'string' ? raw.pack : 'Imported pack',
    theme: typeof raw?.theme === 'string' ? raw.theme : 'blanc',
    answerMs: Number.isFinite(raw?.answerMs) ? raw.answerMs : 12000,
    order: raw?.order === 'suggested' ? 'suggested' : 'authored',
    questions: Array.isArray(raw?.questions) ? raw.questions : [],
    controlRoom: {
      perTeam: Number.isFinite(raw?.controlRoom?.perTeam) ? raw.controlRoom.perTeam : 1,
      answerMs: Number.isFinite(raw?.controlRoom?.answerMs) ? raw.controlRoom.answerMs : 40000,
      questions: Array.isArray(raw?.controlRoom?.questions) ? raw.controlRoom.questions : [],
    },
    showdown: {
      answerMs: Number.isFinite(raw?.showdown?.answerMs) ? raw.showdown.answerMs : 6000,
      statements: Array.isArray(raw?.showdown?.statements) ? raw.showdown.statements : [],
    },
  };
  selIx.deck = model.questions.length ? 0 : -1;
  selIx.control = model.controlRoom.questions.length ? 0 : -1;
  selIx.showdown = model.showdown.statements.length ? 0 : -1;
}

const SAMPLE = {
  pack: 'Sample night',
  theme: 'blanc',
  answerMs: 12000,
  questions: [
    { text: 'Which planet has the most moons?', answers: ['Jupiter', 'Saturn', 'Uranus'], correct: 1 },
    { text: 'Select every gas giant', answers: ['Jupiter', 'Mars', 'Saturn', 'Venus'], correct: [0, 2] },
    { type: 'range', text: 'Normal resting heart rate?', min: 0, max: 160, answer: [60, 100], unit: 'bpm' },
    { type: 'sort', text: 'Sort each animal by class', buckets: ['Mammal', 'Bird'], items: [
      { label: 'Bat', bucket: 0 }, { label: 'Penguin', bucket: 1 }, { label: 'Dolphin', bucket: 0 }] },
  ],
  controlRoom: { perTeam: 1, answerMs: 40000, questions: [newControlCase()] },
  showdown: { answerMs: 6000, statements: [{ text: 'An octopus has three hearts', answer: true }] },
};

// ------------------------------------------------------------------ wiring

function refreshAll() {
  $('packName').value = model.pack;
  $('packAnswerMs').value = String(Math.round(model.answerMs / 1000));
  $('packOrder').value = model.order;
  refreshList();
  refreshEditor();
  refreshProblems();
  restartPreview();
  save();
}

/** Field-level changes: refresh checks + preview, but do NOT rebuild the
 *  form that currently has keyboard focus. */
function softRefresh() {
  refreshList();
  refreshProblems();
  restartPreview();
  save();
}

function setTab(/** @type {'deck'|'control'|'showdown'} */ t) {
  tab = t;
  for (const id of ['deck', 'control', 'showdown']) {
    $(`tab-${id}`).classList.toggle('on', id === t);
  }
  refreshAll();
}

$('tab-deck').onclick = () => setTab('deck');
$('tab-control').onclick = () => setTab('control');
$('tab-showdown').onclick = () => setTab('showdown');

$('addQ').onclick = () => {
  const list = bucketList();
  list.push(tab === 'deck' ? newDeckQuestion('choice') : tab === 'control' ? newControlCase() : newStatement());
  selIx[tab] = list.length - 1;
  refreshAll();
};
$('dupQ').onclick = () => {
  const list = bucketList();
  const q = list[selIx[tab]];
  if (!q) return;
  list.splice(selIx[tab] + 1, 0, structuredClone(q));
  selIx[tab]++;
  refreshAll();
};
$('delQ').onclick = () => {
  const list = bucketList();
  if (selIx[tab] < 0) return;
  list.splice(selIx[tab], 1);
  selIx[tab] = Math.min(selIx[tab], list.length - 1);
  refreshAll();
};
$('upQ').onclick = () => moveSel(-1);
$('downQ').onclick = () => moveSel(1);
function moveSel(/** @type {number} */ d) {
  const list = bucketList();
  const i = selIx[tab];
  const j = i + d;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  selIx[tab] = j;
  refreshAll();
}

$('packName').oninput = () => { model.pack = $('packName').value; softRefresh(); };
$('packAnswerMs').oninput = () => {
  const v = Number($('packAnswerMs').value);
  if (Number.isFinite(v)) { model.answerMs = Math.round(v * 1000); softRefresh(); }
};
$('packOrder').onchange = () => { model.order = $('packOrder').value; softRefresh(); };

const themeSel = $('packTheme');
for (const t of PACK_THEMES) {
  const o = document.createElement('option');
  o.value = t; o.textContent = t;
  themeSel.appendChild(o);
}
themeSel.onchange = () => { model.theme = themeSel.value; softRefresh(); };

$('download').onclick = () => {
  const blob = new Blob([JSON.stringify(exportable(), null, 2) + '\n'], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const safe = model.pack.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'pack';
  a.download = `${safe}.json`;
  a.click();
};
$('copyJson').onclick = async () => {
  await navigator.clipboard.writeText(JSON.stringify(exportable(), null, 2));
  $('copyJson').textContent = 'Copied ✓';
  setTimeout(() => { $('copyJson').textContent = 'Copy JSON'; }, 1200);
};
$('openFile').onclick = () => {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.json';
  inp.onchange = async () => {
    const f = inp.files?.[0];
    if (!f) return;
    try { adoptImport(JSON.parse(await f.text())); refreshAll(); } catch { alert('Not valid JSON'); }
  };
  inp.click();
};
$('pasteJson').onclick = () => $('pasteDlg').showModal();
$('pasteCancel').onclick = () => $('pasteDlg').close();
$('pasteGo').onclick = () => {
  try {
    adoptImport(JSON.parse($('pasteBox').value));
    $('pasteDlg').close();
    refreshAll();
  } catch { alert('Not valid JSON'); }
};
$('loadSample').onclick = () => { adoptImport(structuredClone(SAMPLE)); refreshAll(); };
$('replay').onclick = () => restartPreview();

// boot
themeSel.value = model.theme;
if (!loadDraft()) adoptImport(structuredClone(SAMPLE));
refreshAll();
requestAnimationFrame((t) => { lastT = t; requestAnimationFrame(frame); });

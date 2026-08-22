/**
 * The Pack Studio: text-first pack authoring for faculty.
 *
 * The document IS the pack. Everything on this page — the gutter checks,
 * the detail panel, the add buttons — works by rewriting the text in the
 * middle column; the playable pack is always parseDoc(text) run through
 * the same shared/pack-validate.js the game server uses, and the preview
 * is the ACTUAL game engine drawing into a canvas. Nothing leaves this
 * page until Download/Copy; the raw text autosaves locally.
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
import {
  parseDoc, serializeDoc, toggleCheck, setVerdict, setStartsOn,
  setLineFields, setDirective, setBlockType, insertTemplate, removeBlock,
} from './pack-text.js';

// ------------------------------------------------------------------ state

const DOC_KEY = 'packstudio-doc';
const OLD_DRAFT_KEY = 'packstudio-draft'; // the form-era JSON draft, migrated once

const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));
/** @type {HTMLTextAreaElement} */
const doc = $('doc');

/** The document — the single source of truth. */
let docText = '';
/** @type {ReturnType<typeof parseDoc>} */
let parsed = parseDoc('');
/** Block index the caret sits in (-1 = none). */
let caretIx = -1;
/** Caret line (0-based), for line-scoped panel fields. */
let caretLn = -1;
/** Local image files chosen this session, filename -> object URL. */
const localImages = new Map();

/** Validate a deep clone (validatePack normalizes in place). */
function validated() {
  return validatePack(structuredClone(parsed.raw));
}

/** The exportable pack: exactly what the text says. */
function exportable() {
  return structuredClone(parsed.raw);
}

// --------------------------------------------------------------- text I/O

/**
 * Replace the document text. Uses execCommand so the textarea's undo
 * history survives gutter clicks (falls back to plain assignment). Panel
 * inputs keep their focus: the undo-preserving path needs the textarea
 * focused, so it only runs when no other field is being typed in.
 * @param {string} next
 * @param {{caret?: number, line?: number, keepPanel?: boolean}} [opts]
 */
function setText(next, opts = {}) {
  if (next !== doc.value) {
    const active = /** @type {any} */ (document.activeElement);
    const fieldFocused = active && active !== doc &&
      ['INPUT', 'SELECT', 'TEXTAREA'].includes(active.tagName);
    const scroll = doc.scrollTop;
    let done = false;
    if (!fieldFocused) {
      const cur = doc.value;
      let s = 0;
      while (s < cur.length && s < next.length && cur[s] === next[s]) s++;
      let e = 0;
      while (e < cur.length - s && e < next.length - s && cur[cur.length - 1 - e] === next[next.length - 1 - e]) e++;
      doc.focus();
      doc.setSelectionRange(s, cur.length - e);
      const ins = next.slice(s, next.length - e);
      try {
        done = ins
          ? document.execCommand('insertText', false, ins)
          : document.execCommand('delete');
      } catch { done = false; }
      if (done && doc.value !== next) done = false;
    }
    if (!done) doc.value = next;
    doc.scrollTop = scroll;
  }
  docText = doc.value;
  if (opts.caret !== undefined) doc.setSelectionRange(opts.caret, opts.caret);
  if (opts.line !== undefined) caretToLine(opts.line);
  refresh({ keepPanel: !!opts.keepPanel });
}

/** Move the caret to the start of a line and scroll it into view. */
function caretToLine(/** @type {number} */ line) {
  const upTo = docText.split('\n').slice(0, line).join('\n');
  const pos = line === 0 ? 0 : upTo.length + 1;
  doc.focus();
  doc.setSelectionRange(pos, pos);
  const y = lineTops[line] ?? 0;
  if (y < doc.scrollTop + 20 || y > doc.scrollTop + doc.clientHeight - 60) {
    doc.scrollTop = Math.max(0, y - doc.clientHeight * 0.3);
  }
}

function caretLine() {
  return docText.slice(0, doc.selectionStart).split('\n').length - 1;
}

function blockAt(/** @type {number} */ line) {
  return parsed.blocks.findIndex((b) => line >= b.startLine && line <= b.endLine);
}

// ----------------------------------------------------------- measurement
// The mirror reproduces the textarea's wrapping (same font, width and
// padding, one block div per line), so each line's y survives soft wraps.

/** @type {number[]} */
let lineTops = [];
/** @type {number[]} */
let lineHeights = [];

function measure() {
  const mirror = $('mirror');
  mirror.style.width = `${doc.clientWidth}px`;
  mirror.replaceChildren();
  const srcLines = docText.split('\n');
  for (const l of srcLines) {
    const d = document.createElement('div');
    d.textContent = l || ' ';
    mirror.appendChild(d);
  }
  lineTops = [];
  lineHeights = [];
  for (const child of mirror.children) {
    lineTops.push(/** @type {HTMLElement} */ (child).offsetTop);
    lineHeights.push(/** @type {HTMLElement} */ (child).offsetHeight);
  }
}

// ---------------------------------------------------------------- gutter

/** Which validate problems hit a block, by its bucket-local prefix. */
function blockWhere(/** @type {import('./pack-text.js').BlockInfo} */ b) {
  return b.bucket === 'deck' ? `Q${b.ix + 1}` : b.bucket === 'control' ? `control #${b.ix + 1}` : `showdown #${b.ix + 1}`;
}

/** @param {string[]} vproblems */
function blockBad(/** @type {import('./pack-text.js').BlockInfo} */ b, vproblems) {
  const where = blockWhere(b);
  return vproblems.some((m) => m.startsWith(`${where}:`) || m.startsWith(`${where} `))
    || parsed.problems.some((p) => p.line !== null && p.line - 1 >= b.startLine && p.line - 1 <= b.endLine);
}

/** @param {string[]} vproblems */
function renderGutter(vproblems) {
  const inner = $('gutterInner');
  inner.replaceChildren();
  $('gutter').style.height = `${doc.clientHeight}px`;

  parsed.lines.forEach((l, i) => {
    if (!['answer', 'statement', 'toggle'].includes(l.kind)) return;
    const g = document.createElement('div');
    g.className = 'g';
    g.style.top = `${(lineTops[i] ?? 0) + 2}px`;
    const mk = (/** @type {string} */ label, /** @type {string} */ cls, /** @type {() => void} */ fn) => {
      const b = document.createElement('button');
      b.textContent = label;
      if (cls) b.className = cls;
      b.tabIndex = -1;
      b.onmousedown = (ev) => ev.preventDefault(); // keep textarea focus
      b.onclick = fn;
      g.appendChild(b);
    };
    if (l.kind === 'answer') {
      mk(l.checked ? '✓' : '☐', l.checked ? 'on' : '', () => setText(toggleCheck(docText, i)));
    } else if (l.kind === 'statement') {
      mk('T', l.verdict === true ? 'on' : '', () => setText(setVerdict(docText, i, 'statement', true)));
      mk('F', l.verdict === false ? 'off' : '', () => setText(setVerdict(docText, i, 'statement', false)));
    } else {
      mk('on', l.verdict === true ? 'on' : '', () => setText(setVerdict(docText, i, 'toggle', true)));
      mk('off', l.verdict === false ? 'off' : '', () => setText(setVerdict(docText, i, 'toggle', false)));
    }
    inner.appendChild(g);
  });

  const chips = $('chipInner');
  chips.replaceChildren();
  for (const b of parsed.blocks) {
    if (b.bucket === 'showdown') continue; // the T/F pill says it all
    const c = document.createElement('span');
    c.className = 'chip' + (blockBad(b, vproblems) ? ' bad' : '');
    c.textContent = b.bucket === 'control' ? 'case' : b.type + (b.img ? ' · pic' : '');
    c.style.top = `${(lineTops[b.headLine] ?? 0) + 4}px`;
    chips.appendChild(c);
  }
  syncScroll();
}

function syncScroll() {
  const t = `translateY(${-doc.scrollTop}px)`;
  $('gutterInner').style.transform = t;
  $('chipInner').style.transform = t;
}

// --------------------------------------------------------------- outline

/** @param {string[]} vproblems */
function renderOutline(vproblems) {
  const holder = $('outline');
  holder.replaceChildren();
  /** @type {string|null} */
  let lastBucket = null;
  for (const [bi, b] of parsed.blocks.entries()) {
    if (b.bucket !== lastBucket) {
      lastBucket = b.bucket;
      const s = document.createElement('div');
      s.className = 'qrow section';
      s.textContent = b.bucket === 'deck' ? 'Deck' : b.bucket === 'control' ? 'Control Room' : 'Showdown';
      holder.appendChild(s);
    }
    const row = document.createElement('div');
    row.className = 'qrow' + (bi === caretIx ? ' on' : '') + (blockBad(b, vproblems) ? ' bad' : '');
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = b.bucket === 'control' ? 'case' : b.bucket === 'showdown' ? 't/f' : b.type;
    const t = document.createElement('span');
    t.className = 't';
    t.textContent = b.text || '(untitled)';
    row.append(badge, t);
    row.onclick = () => { caretToLine(b.headLine); refresh({ keepPanel: false }); };
    holder.appendChild(row);
  }
  if (!parsed.blocks.length) {
    const s = document.createElement('span');
    s.className = 'hint';
    s.textContent = 'Type # and a question in the doc, or use the buttons below.';
    holder.appendChild(s);
  }
}

// -------------------------------------------------------------- problems

/** @param {string[]} vproblems */
function renderProblems(vproblems) {
  const el = $('problems');
  el.replaceChildren();
  if (!parsed.problems.length && !vproblems.length) {
    el.className = 'ok';
    el.textContent = 'No problems — this pack loads clean.';
    return;
  }
  el.className = '';
  for (const p of parsed.problems) {
    const d = document.createElement('div');
    if (p.line !== null) {
      const a = document.createElement('span');
      a.className = 'jump';
      a.textContent = `line ${p.line}`;
      const ln = p.line - 1;
      a.onclick = () => { caretToLine(ln); refresh({ keepPanel: false }); };
      d.append(a, `: ${p.msg}`);
    } else {
      d.textContent = p.msg;
    }
    el.appendChild(d);
  }
  for (const m of vproblems) {
    const d = document.createElement('div');
    d.textContent = m;
    el.appendChild(d);
  }
}

// ------------------------------------------------------------ detail panel

function renderPanel() {
  const body = $('detailBody');
  body.replaceChildren();
  const b = parsed.blocks[caretIx];
  if (!b) {
    $('detailTitle').textContent = 'Details';
    body.innerHTML = '<span class="hint">Click into a question in the doc.</span>';
    return;
  }
  $('detailTitle').textContent =
    b.bucket === 'deck' ? 'Deck question' : b.bucket === 'control' ? 'Control Room case' : 'Showdown statement';

  if (b.bucket === 'showdown') {
    const h = document.createElement('div');
    h.className = 'hint';
    h.textContent = 'Mark it with the T / F buttons beside the line.';
    body.appendChild(h);
    dangerDelete(body, b, 'Delete statement');
    return;
  }

  if (b.bucket === 'control') {
    numField(body, 'Turn length (seconds, 10-90)', directiveSeconds(b, 'time', 40), (v) => {
      setText(setDirective(docText, b, 'time', `${v}s`), { keepPanel: true });
    });
    renderLineFields(body, b);
    const h = document.createElement('div');
    h.className = 'hint';
    h.style.marginTop = '8px';
    h.textContent = 'Each line is a control: mark toggles on/off beside the line; type "Label = 8" for a number control and set its range here.';
    body.appendChild(h);
    dangerDelete(body, b, 'Delete case');
    return;
  }

  // ---- deck question
  const typeSel = document.createElement('select');
  for (const [v, label] of [['choice', 'multiple choice'], ['range', 'range (number line)'], ['sort', 'lightning sort']]) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = label;
    if ((b.type === 'multi' ? 'choice' : b.type) === v) o.selected = true;
    typeSel.appendChild(o);
  }
  const tl = document.createElement('label');
  tl.textContent = 'Type';
  body.append(tl, typeSel);
  typeSel.onchange = () => {
    const t = /** @type {'choice'|'range'|'sort'} */ (typeSel.value);
    if (t !== (b.type === 'multi' ? 'choice' : b.type)) setText(setBlockType(docText, b, t));
  };

  if (b.type === 'choice' || b.type === 'multi') {
    const laySel = document.createElement('select');
    for (const l of ['islands', 'row', 'pyramid', 'reverse-pyramid']) {
      const o = document.createElement('option');
      o.value = l;
      o.textContent = l;
      if ((b.directives.layout?.value ?? 'islands') === l) o.selected = true;
      laySel.appendChild(o);
    }
    laySel.onchange = () => {
      setText(setDirective(docText, b, 'layout', laySel.value === 'islands' ? null : laySel.value), { keepPanel: true });
    };
    const ll = document.createElement('label');
    ll.textContent = 'Layout (picture questions always play the row)';
    body.append(ll, laySel);
  }

  if (b.type === 'sort') {
    numField(body, 'Seconds per item (3-15)', directiveSeconds(b, 'pace', 6), (v) => {
      setText(setDirective(docText, b, 'pace', v === 6 ? null : `${v}s`), { keepPanel: true });
    });
  }

  if (b.type === 'range') renderLineFields(body, b, true);

  // ---- picture, on any deck type
  const pl = document.createElement('label');
  pl.textContent = 'Picture (optional — EKGs, rashes…)';
  body.appendChild(pl);
  const prow = document.createElement('div');
  prow.className = 'row';
  body.appendChild(prow);
  const fileBtn = document.createElement('button');
  fileBtn.className = 'small';
  fileBtn.textContent = b.img ? `🖼 ${b.img}` : 'Attach image…';
  fileBtn.onclick = () => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.png,.jpg,.jpeg,.webp,.svg';
    inp.onchange = () => {
      const f = inp.files?.[0];
      if (!f) return;
      const url = URL.createObjectURL(f);
      localImages.set(f.name, url);
      registerPreviewImage(f.name, url);
      setText(setDirective(docText, b, 'img', f.name));
    };
    inp.click();
  };
  prow.appendChild(fileBtn);
  if (b.img) {
    const clear = document.createElement('button');
    clear.className = 'small danger';
    clear.textContent = 'Remove';
    clear.onclick = () => setText(setDirective(docText, b, 'img', null));
    prow.appendChild(clear);
  }
  const note = document.createElement('div');
  note.className = 'hint';
  note.textContent = 'The exported pack references the FILENAME only — send the image file along; the host drops it in questions/images/.';
  body.appendChild(note);

  dangerDelete(body, b, 'Delete question');
}

/**
 * Caret-line fields for structured lines: the range: line of a range
 * question, or a number control's range/step/start/unit. For range
 * questions the line is unique, so it renders regardless of the caret.
 * @param {HTMLElement} body @param {import('./pack-text.js').BlockInfo} b
 * @param {boolean} [anyLine]
 */
function renderLineFields(body, b, anyLine = false) {
  let ln = -1;
  if (anyLine) {
    ln = parsed.lines.findIndex((l, i) => l.kind === 'range' && i >= b.startLine && i <= b.endLine);
  } else if (caretLn >= b.startLine && caretLn <= b.endLine && parsed.lines[caretLn]) {
    const k = parsed.lines[caretLn].kind;
    if (k === 'number' || k === 'toggle') ln = caretLn;
  }
  if (ln < 0) return;
  const info = parsed.lines[ln];

  if (info.kind === 'toggle') {
    const line = ln;
    const wrap = document.createElement('div');
    wrap.className = 'checkline';
    const i = document.createElement('input');
    i.type = 'checkbox';
    i.checked = info.startsOn === true;
    i.onchange = () => setText(setStartsOn(docText, line, i.checked), { keepPanel: true });
    const s = document.createElement('span');
    s.textContent = 'This toggle starts ON';
    wrap.append(i, s);
    body.appendChild(wrap);
    return;
  }

  const f = info.kind === 'range'
    ? { lo: info.fields.answer[0], hi: info.fields.answer[1], min: info.fields.min, max: info.fields.max, unit: info.fields.unit ?? '' }
    : { ...info.fields };
  const line = ln;
  const kind = /** @type {'range'|'number'} */ (info.kind === 'range' ? 'range' : 'number');
  const write = () => setText(setLineFields(docText, line, kind, f), { keepPanel: true });

  const h = document.createElement('label');
  h.textContent = info.kind === 'range' ? 'The number line' : `"${f.label}" (number control)`;
  body.appendChild(h);
  const grid = document.createElement('div');
  grid.className = 'row';
  body.appendChild(grid);
  const keys = info.kind === 'range' ? ['lo', 'hi', 'min', 'max'] : ['answer', 'min', 'max', 'step', 'initial'];
  for (const key of keys) {
    const cell = document.createElement('div');
    grid.appendChild(cell);
    numField(cell, key === 'initial' ? 'start' : key, f[key] ?? 0, (v) => { f[key] = v; write(); });
  }
  const un = document.createElement('div');
  body.appendChild(un);
  const l = document.createElement('label');
  l.textContent = 'Unit';
  const i = document.createElement('input');
  i.type = 'text';
  i.value = f.unit ?? '';
  i.oninput = () => { f.unit = i.value.trim(); write(); };
  un.append(l, i);
}

/** @param {import('./pack-text.js').BlockInfo} b */
function directiveSeconds(b, /** @type {string} */ key, /** @type {number} */ dflt) {
  const v = b.directives[key]?.value;
  const n = v ? Number(v.replace(/s$/i, '')) : NaN;
  return Number.isFinite(n) ? n : dflt;
}

function dangerDelete(/** @type {HTMLElement} */ body, /** @type {import('./pack-text.js').BlockInfo} */ b, /** @type {string} */ label) {
  const del = document.createElement('button');
  del.className = 'small danger';
  del.style.marginTop = '12px';
  del.textContent = label;
  del.onclick = () => setText(removeBlock(docText, b));
  body.appendChild(del);
}

function numField(/** @type {HTMLElement} */ into, /** @type {string} */ label, /** @type {number} */ value, /** @type {(v:number)=>void} */ set) {
  const l = document.createElement('label');
  l.textContent = label;
  const i = document.createElement('input');
  i.type = 'number';
  i.value = String(value);
  i.oninput = () => { const v = Number(i.value); if (Number.isFinite(v)) set(v); };
  into.append(l, i);
}

// -------------------------------------------------------------- pack card

/** @param {any} pack the validated pack */
function syncPackCard(pack) {
  const set = (/** @type {string} */ id, /** @type {string} */ v) => {
    const el = $(id);
    if (document.activeElement !== el) el.value = v;
  };
  set('packName', pack.pack);
  set('packTheme', pack.theme);
  set('packAnswerMs', String(Math.round(pack.answerMs / 1000)));
  set('packOrder', parsed.raw.order === 'suggested' ? 'suggested' : 'authored');
}

// ------------------------------------------------------------------ refresh

/** @param {{keepPanel?: boolean}} [opts] */
function refresh(opts = {}) {
  parsed = parseDoc(docText);
  caretLn = document.activeElement === doc ? caretLine() : caretLn;
  caretIx = blockAt(caretLn);
  const { pack, problems: vproblems } = validated();
  measure();
  renderGutter(vproblems);
  renderOutline(vproblems);
  renderProblems(vproblems);
  syncPackCard(pack);
  if (!opts.keepPanel) renderPanel();
  restartPreview();
  save();
}

/** Caret moved without a text change: retarget the panel and preview. */
function caretMoved() {
  const ln = caretLine();
  if (ln === caretLn) return;
  caretLn = ln;
  const ix = blockAt(ln);
  const lineScoped = parsed.lines[ln]?.kind === 'number' || parsed.lines[ln]?.kind === 'toggle';
  if (ix !== caretIx || lineScoped) {
    const changed = ix !== caretIx;
    caretIx = ix;
    renderPanel();
    renderOutline(validated().problems);
    if (changed) restartPreview();
  }
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

/** Rebuild the preview run from the caret block (first deck question otherwise). */
function restartPreview() {
  pvShowdown = null;
  pvWorld = createWorld([]);
  const { pack } = validated();
  setTheme(pack.theme);

  const b = parsed.blocks[caretIx]
    ?? parsed.blocks.find((x) => x.bucket === 'deck')
    ?? parsed.blocks[0];
  if (!b) { pvGame = createGame([]); return; }

  if (b.bucket === 'showdown') {
    const st = parsed.raw.showdown?.statements[b.ix];
    pvGame = createGame([]);
    if (!st || typeof st.answer !== 'boolean') return;
    pvShowdown = createShowdown(
      { statements: [structuredClone(st)], answerMs: parsed.raw.showdown.answerMs },
      pvWorld,
      []
    );
    return;
  }

  if (b.bucket === 'control') {
    const src = parsed.raw.controlRoom?.questions[b.ix];
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

  const src = parsed.raw.questions[b.ix];
  const vetted = validatePack({ questions: src ? [structuredClone(src)] : [] });
  const q = vetted.pack.questions[0];
  pvGame = createGame(q ? [q] : [], parsed.raw.answerMs);
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
  try { localStorage.setItem(DOC_KEY, docText); } catch { /* full/blocked: drafts are a convenience */ }
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(DOC_KEY);
    if (raw !== null) return raw;
    // One-time migration from the form era: the old draft was pack JSON.
    const old = localStorage.getItem(OLD_DRAFT_KEY);
    if (old) return serializeDoc(JSON.parse(old));
  } catch { /* unreadable draft: start fresh */ }
  return null;
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
  controlRoom: {
    perTeam: 1,
    answerMs: 40000,
    questions: [{
      text: 'New case: set the controls',
      controls: Array.from({ length: 6 }, (_, i) => ({
        label: `Control ${i + 1}`, kind: 'toggle', initial: false, answer: i % 2 === 0,
      })),
    }],
  },
  showdown: { answerMs: 6000, statements: [{ text: 'An octopus has three hearts', answer: true }] },
};

// ------------------------------------------------------------------ wiring

doc.addEventListener('input', () => { docText = doc.value; refresh({ keepPanel: false }); });
doc.addEventListener('scroll', syncScroll);
document.addEventListener('selectionchange', () => {
  if (document.activeElement === doc) caretMoved();
});
window.addEventListener('resize', () => refresh({ keepPanel: true }));

$('addQ').onclick = () => addBlock('deck');
$('addC').onclick = () => addBlock('control');
$('addS').onclick = () => addBlock('showdown');
function addBlock(/** @type {'deck'|'control'|'showdown'} */ bucket) {
  const { text, line } = insertTemplate(docText, parsed, bucket);
  setText(text, { line });
}

$('packName').oninput = () => setText(setDirective(docText, null, 'pack', $('packName').value), { keepPanel: true });
$('packAnswerMs').oninput = () => {
  const v = Number($('packAnswerMs').value);
  if (Number.isFinite(v) && v > 0) setText(setDirective(docText, null, 'time', `${v}s`), { keepPanel: true });
};
$('packOrder').onchange = () => {
  setText(setDirective(docText, null, 'order', $('packOrder').value === 'suggested' ? 'suggested' : null), { keepPanel: true });
};
const themeSel = $('packTheme');
for (const t of PACK_THEMES) {
  const o = document.createElement('option');
  o.value = t;
  o.textContent = t;
  themeSel.appendChild(o);
}
themeSel.onchange = () => setText(setDirective(docText, null, 'theme', themeSel.value), { keepPanel: true });

$('download').onclick = () => {
  const blob = new Blob([JSON.stringify(exportable(), null, 2) + '\n'], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const safe = String(parsed.raw.pack).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'pack';
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
    try { setText(serializeDoc(JSON.parse(await f.text())), { caret: 0 }); } catch { alert('Not valid JSON'); }
  };
  inp.click();
};
$('pasteJson').onclick = () => $('pasteDlg').showModal();
$('pasteCancel').onclick = () => $('pasteDlg').close();
$('pasteGo').onclick = () => {
  try {
    const next = serializeDoc(JSON.parse($('pasteBox').value));
    $('pasteDlg').close();
    setText(next, { caret: 0 });
  } catch { alert('Not valid JSON'); }
};
$('loadSample').onclick = () => setText(serializeDoc(SAMPLE), { caret: 0 });
$('replay').onclick = () => restartPreview();

// boot
doc.value = loadDraft() ?? serializeDoc(SAMPLE);
docText = doc.value;
refresh();
requestAnimationFrame((t) => { lastT = t; requestAnimationFrame(frame); });

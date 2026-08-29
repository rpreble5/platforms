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

import { LIMITS, PACK_THEMES, validatePack } from '../../shared/pack-validate.js';
import { STEP_MS, MAX_FRAME_DT_MS, MAX_STEPS_PER_FRAME } from '../../shared/tuning.js';
import { createWorld } from '../../sim/world.js';
import { buildCustomArena } from '../../sim/levels.js';
import { PHASE, configureControlRounds, createGame, startGame, stepRound } from '../../sim/round.js';
import { createShowdown, stepShowdown } from '../../sim/showdown.js';
import { setTheme } from '../display/themes.js';
import { render } from '../display/render.js';
import { drawConfetti } from '../display/fx.js';
import { drawRoundOverlay, registerPreviewImage } from '../display/round-ui.js';
import { drawShowdown } from '../display/showdown-ui.js';
import {
  parseDoc, serializeDoc, extractFrontMatter, toggleCheck, setVerdict, setStartsOn,
  setLineFields, setDirective, setBlockType, setLabel, insertTemplate, removeBlock, moveBlock,
  splitSections, setOnlyCheck, extractLevels,
} from './pack-text.js';

// ------------------------------------------------------------------ state

const DOC_KEY = 'packstudio-doc';
const META_KEY = 'packstudio-meta';
const CARRIED_KEY = 'packstudio-carried';
const LEVELS_KEY = 'packstudio-levels';
const OLD_DRAFT_KEY = 'packstudio-draft'; // the form-era JSON draft, migrated once

const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));
/** @type {HTMLTextAreaElement} */
const doc = $('doc');

/** The document — the single source of truth for the QUESTIONS. */
let docText = '';
/** The always-there pack settings live in the pack bar, never the doc.
 *  order has no UI — an imported pack's value survives the round trip. */
let meta = { pack: 'New pack', theme: 'blanc', answerMs: 12000, order: 'authored', mode: 'solo' };
/**
 * Control Room cases and Showdown statements belonging to a pack that was
 * opened here. The Studio authors decks only, so they never enter the
 * document — they ride along and are re-attached on export, so editing a
 * pack that has them and downloading it again gives the pack back whole.
 * @type {{controlRoom?: any, showdown?: any}}
 */
let carried = {};
/**
 * The arena each question is pinned to, keyed by question text. Chosen with
 * the thumbnail buttons in Details, never typed — so it lives here instead
 * of in the document, and is re-attached on export.
 * @type {Record<string, string>}
 */
let levels = {};
/** @type {ReturnType<typeof parseDoc>} */
let parsed = parseDoc('');
/** Block index the caret sits in (-1 = none). */
let caretIx = -1;
/** Caret line (0-based), for line-scoped panel fields. */
let caretLn = -1;
/** Local image files chosen this session, filename -> object URL. */
const localImages = new Map();
/** Designed levels from /api/levels: the preview rotates through these for
 *  choice questions exactly like the game (choiceArena picks by board
 *  count). Empty when no server is reachable (e.g. GitHub Pages). */
/** @type {any[]} */
let levelPool = [];

/** Validate a fresh copy (validatePack normalizes in place). */
function validated() {
  return validatePack(exportable());
}

/** The exportable pack: the Pack panel's settings plus what the text says. */
function exportable() {
  const raw = structuredClone(parsed.raw);
  /** @type {any} */
  const out = {
    pack: meta.pack,
    theme: meta.theme,
    answerMs: meta.answerMs,
    questions: raw.questions,
  };
  out.mode = meta.mode === 'teams' ? 'teams' : 'solo';
  if (meta.order === 'suggested') out.order = 'suggested';
  for (const q of out.questions) {
    const pin = levels[q.text];
    // A pinned arena only applies to a choice question without a picture —
    // the same rule the parser used when level: was a line.
    if (pin && !q.image && (q.type === undefined || q.type === 'choice')) q.level = pin;
  }
  // The doc holds deck questions only; anything the opened pack carried is
  // put back exactly as it came in.
  const cr = raw.controlRoom ?? carried.controlRoom;
  const sd = raw.showdown ?? carried.showdown;
  if (cr) out.controlRoom = cr;
  if (sd) out.showdown = sd;
  return out;
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

/** The active-block highlight rect. Held here because measure() clears the
 *  mirror on every keystroke and re-appends it. */
const hi = $('blockHi');

/** Split a bucket line into [name, separator, items], arrow or legacy colon. */
function splitBucket(/** @type {string} */ t) {
  const m = /^(.{1,40}?)(\s*(?:→|->)\s*)([\s\S]*)$/.exec(t) ?? /^([^:]{1,40})(:\s*)([\s\S]*)$/.exec(t);
  return m ? { name: m[1], sep: m[2], items: m[3] } : null;
}

function span(/** @type {string} */ t, /** @type {string} */ cls) {
  const s = document.createElement('span');
  s.textContent = t;
  if (cls) s.className = cls;
  return s;
}

/**
 * One styled mirror line. The mirror is also the VISIBLE text -- the
 * textarea over it is transparent and shows only the caret and selection --
 * so each line is colored by its parsed role. Styling is color/background
 * ONLY: any metric change (weight, size, italics) would break the
 * glyph-for-glyph alignment. The spans' text concatenates to EXACTLY the
 * source line, so wrapping matches the textarea character for character.
 * @param {string} l @param {import('./pack-text.js').LineInfo|undefined} info
 */
function paintLine(l, info) {
  const d = document.createElement('div');
  if (!l) { d.textContent = ' '; return d; }
  const kind = info?.kind;
  const put = (/** @type {[string, string][]} */ ...parts) => {
    for (const [t, c] of parts) if (t) d.appendChild(span(t, c));
  };
  /** @type {RegExpExecArray|null} */
  let m;
  if (kind === 'section') {
    d.className = 'sec';
    d.textContent = l;
  } else if (kind === 'head' && (m = /^(\s*#\w*\s*)([\s\S]*)$/.exec(l))) {
    put([m[1], 'mk'], [m[2], 'mh']);
  } else if (kind === 'answer' && (m = /^(\s*[✓*]\s*)([\s\S]*)$/.exec(l))) {
    put([m[1], 'mk'], [m[2], 'mchk']);
  } else if (kind === 'statement' && (m = /^(\s*(true|false)\s*:\s*)([\s\S]*)$/i.exec(l))) {
    put([m[1], m[2].toLowerCase() === 'true' ? 'mk' : 'mko'], [m[3], '']);
  } else if (kind === 'toggle' && (m = /^(\s*\[(on|off)\]\s*)([\s\S]*)$/i.exec(l))) {
    const tail = /^([\s\S]*?)(\s*\(starts?\s+on\)\s*)$/i.exec(m[3]);
    put(
      [m[1], m[2].toLowerCase() === 'on' ? 'mk' : 'mko'],
      [tail ? tail[1] : m[3], ''],
      [tail ? tail[2] : '', 'md']
    );
  } else if (kind === 'number' && (m = /^([\s\S]*?=\s*-?[\d.]+\s*)(\([\s\S]*\))?([\s\S]*)$/.exec(l))) {
    put([m[1], 'mb'], [m[2] ?? '', 'md'], [m[3] ?? '', '']);
  } else if (kind === 'range' && (m = /^(\s*range\s*:)([\s\S]*)$/i.exec(l))) {
    put([m[1], 'md'], [m[2], '']);
  } else if (kind === 'bucket' && splitBucket(l)) {
    const bk = /** @type {any} */ (splitBucket(l));
    put([bk.name, 'mb'], [bk.sep, 'mk'], [bk.items, '']);
  } else if (kind === 'directive') {
    d.appendChild(span(l, 'md'));
  } else if (kind === 'unknown' || kind === 'front') {
    d.appendChild(span(l, 'me'));
  } else {
    d.textContent = l;
  }
  return d;
}

/**
 * Park the highlight rect behind the block the caret sits in — one shape
 * spanning the whole question, sized from the measured line tops.
 */
function paintActiveBlock() {
  const b = parsed.blocks[caretIx];
  const top = b ? lineTops[b.startLine] : undefined;
  const last = b ? lineTops[b.endLine] : undefined;
  if (!b || top === undefined || last === undefined) {
    hi.classList.remove('on');
    return;
  }
  hi.style.top = `${top - 3}px`;
  hi.style.height = `${last + (lineHeights[b.endLine] ?? 0) - top + 6}px`;
  hi.classList.add('on');
}

function measure() {
  const mirror = $('mirror');
  mirror.style.width = `${doc.clientWidth}px`;
  mirror.replaceChildren(hi);
  const srcLines = docText.split('\n');
  /** @type {HTMLElement[]} */
  const lineEls = [];
  for (let i = 0; i < srcLines.length; i++) {
    const el = paintLine(srcLines[i], parsed.lines[i]);
    mirror.appendChild(el);
    lineEls.push(el);
  }
  lineTops = [];
  lineHeights = [];
  for (const el of lineEls) {
    lineTops.push(el.offsetTop);
    lineHeights.push(el.offsetHeight);
  }
  paintActiveBlock();
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

/** Block index being dragged by its gutter number (-1 = none). */
let dragBlockIx = -1;

function clearDropHints() {
  for (const el of document.querySelectorAll('#gutterInner .g.dropHint')) el.classList.remove('dropHint');
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
      // Select-all is a teams question, so in a free-for-all deck the checks
      // behave like radio buttons: marking one clears the rest, and a second
      // correct answer simply cannot be produced by clicking.
      mk(l.checked ? '✓' : '☐', l.checked ? 'on' : '', () => setText(
        meta.mode === 'teams' ? toggleCheck(docText, i) : setOnlyCheck(docText, parsed, i)
      ));
    } else if (l.kind === 'statement') {
      mk('T', l.verdict === true ? 'on' : '', () => setText(setVerdict(docText, i, 'statement', true)));
      mk('F', l.verdict === false ? 'off' : '', () => setText(setVerdict(docText, i, 'statement', false)));
    } else {
      mk('on', l.verdict === true ? 'on' : '', () => setText(setVerdict(docText, i, 'toggle', true)));
      mk('off', l.verdict === false ? 'off' : '', () => setText(setVerdict(docText, i, 'toggle', false)));
    }
    inner.appendChild(g);
  });

  // Type chips ride the head line's margin row (it carries no checkbox).
  // For deck questions the chip IS the type toggle — a tiny select. The
  // number in front is the drag handle: drop it on another number in the
  // same section and the whole block moves there.
  for (const [bi, b] of parsed.blocks.entries()) {
    if (b.bucket === 'showdown') continue; // the T/F pill says it all
    const g = document.createElement('div');
    g.className = 'g';
    g.style.top = `${(lineTops[b.headLine] ?? 0) + 2}px`;
    const bad = blockBad(b, vproblems) ? ' bad' : '';

    const num = document.createElement('span');
    num.className = 'qnum';
    num.textContent = String(b.ix + 1);
    num.title = 'drag to reorder';
    num.draggable = true;
    num.ondragstart = (ev) => {
      dragBlockIx = bi;
      if (ev.dataTransfer) {
        ev.dataTransfer.effectAllowed = 'move';
        ev.dataTransfer.setData('text/plain', String(bi));
      }
    };
    num.ondragend = () => { dragBlockIx = -1; clearDropHints(); };
    g.appendChild(num);

    // The whole margin row accepts a drop from a same-section number.
    g.ondragover = (ev) => {
      if (dragBlockIx < 0 || dragBlockIx === bi) return;
      if (parsed.blocks[dragBlockIx]?.bucket !== b.bucket) return;
      ev.preventDefault();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
      g.classList.add('dropHint');
    };
    g.ondragleave = () => g.classList.remove('dropHint');
    g.ondrop = (ev) => {
      ev.preventDefault();
      const from = dragBlockIx;
      dragBlockIx = -1;
      clearDropHints();
      if (from < 0 || from === bi) return;
      const { text, line } = moveBlock(docText, parsed, from, bi);
      if (text !== docText) setText(text, { line });
    };

    if (b.bucket === 'control') {
      const c = document.createElement('span');
      c.className = 'chip' + bad;
      c.textContent = 'case';
      g.appendChild(c);
    } else {
      const sel = document.createElement('select');
      sel.className = 'chip' + bad;
      sel.title = 'question type';
      // A 2+-check question is "cover them all" only in a teams deck; one
      // player has one body, so in a free-for-all any correct platform pays.
      const multiLabel = meta.mode === 'teams' ? 'all' : 'multi';
      for (const [v, label] of [['choice', b.type === 'multi' ? multiLabel : 'choice'], ['range', 'range'], ['sort', 'sort']]) {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = label + (b.img && v === (b.type === 'multi' ? 'choice' : b.type) ? ' 🖼' : '');
        if ((b.type === 'multi' ? 'choice' : b.type) === v) o.selected = true;
        sel.appendChild(o);
      }
      sel.onchange = () => {
        const t = /** @type {'choice'|'range'|'sort'} */ (sel.value);
        sel.blur(); // hand focus back so the rewrite lands on the undo stack
        if (t !== (b.type === 'multi' ? 'choice' : b.type)) setText(setBlockType(docText, b, t));
      };
      g.appendChild(sel);
    }
    inner.appendChild(g);
  }
  syncScroll();
}

function syncScroll() {
  const t = `translateY(${-doc.scrollTop}px)`;
  $('gutterInner').style.transform = t;
  $('sugInner').style.transform = t;
  $('mirror').style.transform = t;
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

  if (b.type === 'multi') {
    const n = parsed.raw.questions[b.ix]?.correct?.length ?? 2;
    const h = document.createElement('div');
    h.className = 'hint';
    h.style.marginTop = '8px';
    h.textContent = meta.mode === 'teams'
      ? `${n} answers are marked correct. A player scores by standing on any one of them; a team that covers all ${n} at the buzzer earns a bonus on top — that is what makes "select every" worth asking.`
      : `${n} answers are marked correct, but select-all is a teams question — one player has one body. Leave a single check, or set the deck to Teams.`;
    body.appendChild(h);
    if (meta.mode !== 'teams') {
      const fix = document.createElement('button');
      fix.className = 'small';
      fix.style.marginTop = '8px';
      fix.textContent = 'Keep only the first correct answer';
      fix.onclick = () => {
        const first = parsed.lines.findIndex((l, i) =>
          l.kind === 'answer' && l.checked && i >= b.startLine && i <= b.endLine);
        if (first >= 0) setText(setOnlyCheck(docText, parsed, first, { force: true }));
      };
      body.appendChild(fix);
    }
  }

  if (b.type === 'choice' || b.type === 'multi') renderLevelPicker(body, b);

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
 * A tiny painting of a designed level: the floor, the answer boards in
 * green, the stepping-stone rungs in gray — enough to pick a shape at a
 * glance. Drawn at 2x for crisp text-size rendering.
 * @param {any} spec @returns {HTMLCanvasElement}
 */
function levelThumb(spec) {
  const c = document.createElement('canvas');
  c.width = 168;
  c.height = 94;
  const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  const sx = c.width / 1920;
  const sy = c.height / 1080;
  g.fillStyle = '#eef1f5';
  g.fillRect(0, 0, c.width, c.height);
  for (const p of buildCustomArena(spec)) {
    const ans = String(p.id).startsWith('ans');
    g.fillStyle = p.id === 'floor' ? '#d8dde4' : ans ? '#059669' : '#a8b1be';
    g.fillRect(p.x * sx, p.y * sy, Math.max(2, p.w * sx), Math.max(ans ? 3 : 2, p.h * sy));
  }
  return c;
}

/**
 * The arena picker for a choice question: Auto (the game rotates through
 * every designed level with a matching board count) plus one toggle per
 * matching level from the library. Picking one writes a `level:` line into
 * the block; Auto removes it. When the library has nothing for this answer
 * count, the old generated layouts are offered instead.
 * @param {HTMLElement} body @param {import('./pack-text.js').BlockInfo} b
 */
function renderLevelPicker(body, b) {
  const ll = document.createElement('label');
  ll.textContent = 'Layout';
  body.appendChild(ll);

  if (b.img) {
    const h = document.createElement('div');
    h.className = 'hint';
    h.textContent = 'Picture questions always play the flat row — the image needs the airspace.';
    body.appendChild(h);
    return;
  }

  const n = parsed.raw.questions[b.ix]?.answers?.length ?? 0;
  const fits = levelPool.filter((l) => l.boards.length === n);
  const cur = levels[b.text] ?? null;

  // The pin lives beside the document, not in it — picking one never edits
  // the author's text.
  const write = (/** @type {string|null} */ name) => {
    if (name) levels[b.text] = name;
    else delete levels[b.text];
    const t = setDirective(docText, b, 'layout', null); // legacy line, if any
    if (t !== docText) setText(t);
    else { save(); refresh(); }
  };

  if (!fits.length) {
    // No designed level has this board count (or no server): the generated
    // layout tables carry the round, so offer those.
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
    body.appendChild(laySel);
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'lvlgrid';
  body.appendChild(grid);

  const auto = document.createElement('button');
  auto.className = 'lvlbtn autol' + (cur === null ? ' on' : '');
  auto.textContent = 'Auto';
  auto.title = 'the game rotates through every layout shown here';
  auto.onclick = () => write(null);
  grid.appendChild(auto);

  for (const spec of fits) {
    const btn = document.createElement('button');
    btn.className = 'lvlbtn' + (cur === spec.name ? ' on' : '');
    btn.title = `this question always plays "${spec.name}"`;
    btn.appendChild(levelThumb(spec));
    const t = document.createElement('span');
    t.textContent = spec.name;
    btn.appendChild(t);
    btn.onclick = () => write(cur === spec.name ? null : spec.name);
    grid.appendChild(btn);
  }

  if (cur && !fits.some((l) => l.name === cur)) {
    const h = document.createElement('div');
    h.className = 'hint';
    h.textContent = `"${cur}" is not a ${n}-answer layout, so the game falls back to Auto — pick one above or change the answer count.`;
    body.appendChild(h);
  }
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

// ------------------------------------------------------------ plays strip

/**
 * One line under the pack fields: what this deck is and how it plays.
 *
 * Free-for-all vs teams is now the deck's own setting (exported as
 * pack.mode, which the display reads when the pack loads), so faculty
 * make that call once, here, instead of someone remembering at game time.
 *
 * The Control Room and Showdown sections still parse, still export and
 * still play — the builder just does not offer to create them any more.
 * A pack opened with those sections says so quietly, so nothing a faculty
 * member loaded looks like it silently vanished.
 */
function renderPlays() {
  const holder = $('plays');
  holder.replaceChildren();
  const deck = parsed.raw.questions.length;
  const cases = carried.controlRoom?.questions.length ?? 0;
  const sd = carried.showdown?.statements.length ?? 0;
  const s = (/** @type {number} */ n) => (n === 1 ? '' : 's');

  const note = document.createElement('p');
  note.className = 'pnote';
  const extra = [
    cases ? `${cases} Control Room case${s(cases)}` : '',
    sd ? `${sd} showdown statement${s(sd)}` : '',
  ].filter(Boolean).join(' and ');
  note.textContent =
    `${deck} question${s(deck)} — ` +
    (meta.mode === 'teams'
      ? 'players pick a team on their phone and score together; select-all questions need the team to cover every right answer.'
      : 'everyone plays every question for themselves.') +
    (extra ? ` This pack also carries ${extra} — kept in the file and exported with it, edited elsewhere.` : '');
  holder.appendChild(note);
}

// -------------------------------------------------------------- pack card

function syncPackCard() {
  const set = (/** @type {string} */ id, /** @type {string} */ v) => {
    const el = $(id);
    if (document.activeElement !== el) el.value = v;
  };
  set('packName', meta.pack);
  set('packTheme', meta.theme);
  set('packAnswerMs', String(Math.round(meta.answerMs / 1000)));
  const teams = meta.mode === 'teams';
  $('modeSolo').classList.toggle('on', !teams);
  $('modeTeams').classList.toggle('on', teams);
}

// ------------------------------------------------------------------ refresh

/** @param {{keepPanel?: boolean}} [opts] */
function refresh(opts = {}) {
  parsed = parseDoc(docText, { frontMatter: false });
  // When the textarea is not focused the caret line is whatever it last was,
  // which can now point past a document that got shorter — clamp it, or the
  // Details panel goes blank until the next click.
  caretLn = document.activeElement === doc
    ? caretLine()
    : Math.max(0, Math.min(caretLn, docText.split('\n').length - 1));
  caretIx = blockAt(caretLn);
  const { problems: vproblems } = validated();
  // Inline suggestions are addressed by line number; any edit that changes
  // the line count would misalign them, so they clear themselves.
  if (sugs.length && docText.split('\n').length !== sugsLineCount) sugs = [];
  // The rail borrows right margin from the doc — set BEFORE measuring, so
  // the mirror wraps exactly like the padded textarea.
  $('editorArea').classList.toggle('withSugs', sugs.length > 0);
  measure();
  renderGutter(vproblems);
  renderSugRail();
  renderProblems(vproblems);
  renderPlays();
  syncPackCard();
  $('aiShorten').disabled = !parsed.blocks.length;
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
    paintActiveBlock();
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
  const pinned = src && levels[b.text] && !src.image && (src.type === undefined || src.type === 'choice')
    ? { ...structuredClone(src), level: levels[b.text] }
    : src && structuredClone(src);
  const vetted = validatePack({ questions: pinned ? [pinned] : [] });
  const q = vetted.pack.questions[0];
  pvGame = createGame(q ? [q] : [], meta.answerMs);
  pvGame.levelPool = levelPool;
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
  try {
    localStorage.setItem(DOC_KEY, docText);
    localStorage.setItem(META_KEY, JSON.stringify(meta));
    localStorage.setItem(CARRIED_KEY, JSON.stringify(carried));
    localStorage.setItem(LEVELS_KEY, JSON.stringify(levels));
  } catch { /* full/blocked: drafts are a convenience */ }
  saveDraftEntry();
}

function loadDraft() {
  try {
    const m = localStorage.getItem(META_KEY);
    if (m) Object.assign(meta, JSON.parse(m));
    const c = localStorage.getItem(CARRIED_KEY);
    if (c) carried = JSON.parse(c) ?? {};
    const lv = localStorage.getItem(LEVELS_KEY);
    if (lv) levels = JSON.parse(lv) ?? {};
    const raw = localStorage.getItem(DOC_KEY);
    if (raw !== null) return raw;
    // One-time migration from the form era: the old draft was pack JSON.
    const old = localStorage.getItem(OLD_DRAFT_KEY);
    if (old) return serializeDoc(JSON.parse(old));
  } catch { /* unreadable draft: start fresh */ }
  return null;
}

/**
 * Adopt a document wholesale (boot, Open, Paste, Load sample): any
 * front-matter block on top is absorbed into the Pack panel and stripped,
 * so the doc itself only ever shows questions.
 * @param {string} t @param {{boot?: boolean}} [opts]
 */
function adoptDoc(t, opts = {}) {
  const { meta: fm, text: whole } = extractFrontMatter(t);
  const { text: deckText, carried: found } = splitSections(whole);
  const restoredPins = levels; // loadDraft() filled these in before boot
  const { text, levels: pins } = extractLevels(deckText);
  // On boot the restored document is already deck-only, so keep whatever
  // was carried alongside it; every other load replaces it.
  if (!opts.boot || Object.keys(found).length) carried = found;
  // A saved document has no level: lines in it — its pins came back from
  // storage, so boot keeps those; every other load takes the pack's own.
  levels = Object.keys(pins).length || !opts.boot ? pins : restoredPins;
  Object.assign(meta, fm);
  if (meta.order !== 'suggested') meta.order = 'authored';
  // The mode always comes from the pack being opened, never from whatever
  // was open before. When the pack does not say, select-all decides it:
  // only a teams deck can hold one, so a pack using them was written for
  // teams — inferring that beats opening it as a free-for-all of complaints.
  if (opts.boot) {
    // Restoring your own document: the mode you chose came back with the
    // saved meta, so nothing is inferred over the top of it.
    if (meta.mode !== 'teams') meta.mode = 'solo';
  } else if (fm.mode === undefined) {
    const hasMulti = parseDoc(text, { frontMatter: false })
      .raw.questions.some((/** @type {any} */ q) => Array.isArray(q.correct));
    meta.mode = hasMulti ? 'teams' : 'solo';
  } else if (meta.mode !== 'teams') {
    meta.mode = 'solo';
  }
  if (opts.boot) {
    doc.value = text;
    docText = text;
    refresh();
  } else {
    setText(text, { caret: 0 });
  }
}

/**
 * The starter: three questions, one of each type a free-for-all deck can
 * hold — multiple choice, lightning sort, range. It is what the Studio
 * opens with, what "Sample night" loads, and what New starts you from, so
 * there is one starter to know rather than several.
 *
 * Select-all is absent on purpose: it is a teams question (covering every
 * correct platform is a team act), and a new deck is a free-for-all.
 *
 * Deliberately no Control Room and no Showdown either. Those are whole
 * sections with their own syntax, and carrying them in the starter meant
 * everyone opening the Studio had two blocks to delete before writing
 * anything of their own.
 */
const SAMPLE = {
  pack: 'Sample night',
  theme: 'blanc',
  answerMs: 12000,
  questions: [
    { text: 'Which planet has the most moons?', answers: ['Jupiter', 'Saturn', 'Uranus'], correct: 1 },
    { type: 'sort', text: 'Sort each animal by class', buckets: ['Mammal', 'Bird'], items: [
      { label: 'Bat', bucket: 0 }, { label: 'Penguin', bucket: 1 }, { label: 'Dolphin', bucket: 0 }] },
    { type: 'range', text: 'Normal resting heart rate?', min: 0, max: 160, answer: [60, 100], unit: 'bpm' },
  ],
};

// ------------------------------------------------------------------ wiring

doc.addEventListener('input', () => { docText = doc.value; refresh({ keepPanel: false }); });
doc.addEventListener('scroll', syncScroll);
document.addEventListener('selectionchange', () => {
  if (document.activeElement === doc) caretMoved();
});
window.addEventListener('resize', () => refresh({ keepPanel: true }));

$('addQ').onclick = () => addBlock('deck', 'choice');
$('addRange').onclick = () => addBlock('deck', 'range');
$('addSort').onclick = () => addBlock('deck', 'sort');
/** @param {'deck'|'control'|'showdown'} bucket @param {'choice'|'range'|'sort'} [kind] */
function addBlock(bucket, kind) {
  const { text, line } = insertTemplate(docText, parsed, bucket, kind);
  setText(text, { line });
}

// The Pack panel edits meta directly — these settings never touch the doc.
function metaChanged() {
  refresh({ keepPanel: true });
}
$('packName').oninput = () => { meta.pack = $('packName').value; metaChanged(); };
// Not metaChanged(): the Details panel explains select-all in terms of the
// deck's mode, so switching mode has to redraw it, and a button click has no
// text field to steal focus from.
const setMode = (/** @type {'solo'|'teams'} */ m) => {
  meta.mode = m;
  refresh();
  if (m !== 'solo') return;
  const multis = parsed.raw.questions.filter((/** @type {any} */ q) => Array.isArray(q.correct)).length;
  if (multis) {
    toast(`${multis} question${multis === 1 ? ' has' : 's have'} more than one correct answer. Select-all is a teams question — each one now needs a single check, or switch back to Teams.`);
  }
};
$('modeSolo').onclick = () => setMode('solo');
$('modeTeams').onclick = () => setMode('teams');
$('packAnswerMs').oninput = () => {
  const v = Number($('packAnswerMs').value);
  if (Number.isFinite(v) && v > 0) { meta.answerMs = Math.round(v * 1000); metaChanged(); }
};
const themeSel = $('packTheme');
for (const t of PACK_THEMES) {
  const o = document.createElement('option');
  o.value = t;
  o.textContent = t;
  themeSel.appendChild(o);
}
themeSel.onchange = () => { meta.theme = themeSel.value; metaChanged(); };

$('download').onclick = () => {
  const blob = new Blob([JSON.stringify(exportable(), null, 2) + '\n'], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const safe = String(meta.pack).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'pack';
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
    try { adoptDoc(serializeDoc(JSON.parse(await f.text()))); } catch { alert('Not valid JSON'); }
  };
  inp.click();
};
$('pasteJson').onclick = () => $('pasteDlg').showModal();
$('pasteCancel').onclick = () => $('pasteDlg').close();
$('pasteGo').onclick = () => {
  try {
    const next = serializeDoc(JSON.parse($('pasteBox').value));
    $('pasteDlg').close();
    adoptDoc(next);
  } catch { alert('Not valid JSON'); }
};
// ---------------------------------------------------------------- packs
// The library: every pack you have touched in this browser (keyed by its
// name), the packs on the game server, and the built-in sample.

const DRAFTS_KEY = 'packstudio-drafts';

/** @returns {Record<string, {doc: string, meta: any, carried?: any, levels?: any, at: number}>} */
function loadDrafts() {
  try { return JSON.parse(localStorage.getItem(DRAFTS_KEY) ?? '{}') ?? {}; } catch { return {}; }
}

function saveDraftEntry() {
  const name = String(meta.pack ?? '').trim();
  if (!name) return;
  try {
    const drafts = loadDrafts();
    drafts[name] = { doc: docText, meta: { ...meta }, carried, levels, at: Date.now() };
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
  } catch { /* full/blocked: drafts are a convenience */ }
}

async function openPacksDlg() {
  const draftsHolder = $('packsDrafts');
  const serverHolder = $('packsServer');
  draftsHolder.replaceChildren();
  serverHolder.replaceChildren();

  const row = (/** @type {HTMLElement} */ into, /** @type {string} */ title, /** @type {string} */ sub, /** @type {() => void} */ open, /** @type {(() => void) | null} */ del) => {
    const r = document.createElement('div');
    r.className = 'packrow';
    const t = document.createElement('span');
    t.className = 't';
    t.textContent = title;
    const su = document.createElement('span');
    su.className = 'sub';
    su.textContent = sub;
    const b = document.createElement('button');
    b.className = 'small primary';
    b.textContent = 'Open';
    b.onclick = () => { open(); $('packsDlg').close(); };
    r.append(t, su, b);
    if (del) {
      const d = document.createElement('button');
      d.className = 'small danger';
      d.textContent = '✕';
      d.title = 'delete this draft from this browser';
      d.onclick = () => { if (window.confirm(`Delete the draft "${title}" from this browser?`)) { del(); void openPacksDlg(); } };
      r.appendChild(d);
    }
    into.appendChild(r);
  };

  const head = (/** @type {HTMLElement} */ into, /** @type {string} */ text) => {
    const h = document.createElement('div');
    h.className = 'packsHead';
    h.textContent = text;
    into.appendChild(h);
  };

  head(draftsHolder, 'Your drafts (this browser)');
  const drafts = loadDrafts();
  const names = Object.keys(drafts).sort((a, b) => (drafts[b].at ?? 0) - (drafts[a].at ?? 0));
  if (!names.length) {
    const s = document.createElement('div');
    s.className = 'hint';
    s.textContent = 'Nothing yet — everything you write is saved here automatically, under its pack name.';
    draftsHolder.appendChild(s);
  }
  for (const name of names) {
    const d = drafts[name];
    const current = name === String(meta.pack ?? '').trim();
    row(draftsHolder, name, `${current ? 'open now · ' : ''}${new Date(d.at).toLocaleString()}`, () => {
      saveDraftEntry();
      meta = { ...d.meta };
      const { text: deckOnly, carried: found } = splitSections(d.doc);
      const { text, levels: pins } = extractLevels(deckOnly);
      carried = Object.keys(found).length ? found : (d.carried ?? {});
      levels = Object.keys(pins).length ? pins : (d.levels ?? {});
      setText(text, { caret: 0 });
    }, () => {
      const all = loadDrafts();
      delete all[name];
      try { localStorage.setItem(DRAFTS_KEY, JSON.stringify(all)); } catch { /* ignore */ }
    });
  }

  head(serverHolder, 'On the game server');
  try {
    const packs = await fetch('/api/packs').then((r) => r.ok ? r.json() : Promise.reject());
    for (const pk of Array.isArray(packs) ? packs : []) {
      row(serverHolder, pk.name, `${pk.questions} questions — opens as a local draft`, async () => {
        try {
          const pack = await fetch(`/api/questions?pack=${encodeURIComponent(pk.file)}`).then((r) => r.json());
          saveDraftEntry();
          adoptDoc(serializeDoc(pack));
          toast(`Opened "${pk.name}" from the server — your edits stay in this browser until you download and send the file.`);
        } catch { toast('Could not load that pack from the server.'); }
      }, null);
    }
  } catch {
    const s = document.createElement('div');
    s.className = 'hint';
    s.textContent = 'No game server reachable from this page.';
    serverHolder.appendChild(s);
  }
  row(serverHolder, 'Sample night', 'the built-in starter — one of each question type', () => {
    saveDraftEntry();
    adoptDoc(serializeDoc(SAMPLE));
  }, null);

  $('packsDlg').showModal();
}

$('packsBtn').onclick = () => void openPacksDlg();
$('packsClose').onclick = () => $('packsDlg').close();

$('newPack').onclick = () => {
  if (!window.confirm('Start a new pack? The current one stays available under Packs…')) return;
  saveDraftEntry();
  // Three worked questions to edit over beats an empty page: adoptDoc
  // resets the arena pins and carried sections along the way.
  adoptDoc(serializeDoc({ ...SAMPLE, pack: 'New pack' }));
};
// The preview, near-fullscreen: the canvas already renders at 1920x1080,
// so scaling up is free sharpness. Esc or the backdrop closes.
$('pvExpand').onclick = () => {
  const big = $('previewCard').classList.toggle('big');
  $('pvBackdrop').classList.toggle('on', big);
  $('pvExpand').textContent = big ? '✕' : '⛶';
  $('pvExpand').title = big ? 'close (Esc)' : 'expand the preview (Esc closes)';
};
$('pvBackdrop').onclick = () => $('pvExpand').click();
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('previewCard').classList.contains('big')) {
    $('pvExpand').click();
    e.preventDefault();
  }
});

$('replay').onclick = () => {
  // Rotate the designed-level pool so replays show the variety the game has.
  if (levelPool.length > 1) levelPool.push(levelPool.shift());
  restartPreview();
};

// ------------------------------------------------------------------ AI drafting
// Notes -> the doc format, via the server's /api/ai-draft (Claude). The AI
// is a drafter: its output lands in the editor as ordinary text and goes
// through the same parse/validate/preview as anything typed. Answers it was
// not sure about arrive unchecked, which the gutter already flags.

const AI_CODE_KEY = 'packstudio-ai-code';

/** A dismissible notice that outlives the dialog (click to close). */
/** @type {any} */
let toastTimer = 0;
function toast(/** @type {string} */ msg) {
  const el = $('toast');
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.display = 'none'; }, 12000);
  el.onclick = () => { el.style.display = 'none'; };
}

/** @param {any} body @returns {Promise<{ok: boolean, status: number, json: any}>} */
async function callAi(body) {
  let code = '';
  try { code = localStorage.getItem(AI_CODE_KEY) ?? ''; } catch { /* no store */ }
  try {
    const r = await fetch('/api/ai-draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-ai-passcode': code },
      body: JSON.stringify(body),
    });
    return { ok: r.ok, status: r.status, json: await r.json().catch(() => ({})) };
  } catch {
    return { ok: false, status: 0, json: { error: 'no server reachable — drafting runs on the game server or the test instance, not on a static copy of this page' } };
  }
}

/** Merge two docs section by section, so an appended draft's Control Room
 *  and Showdown join the existing ones instead of nesting inside them. */
function mergeDocs(/** @type {string} */ a, /** @type {string} */ b) {
  const split = (/** @type {string} */ t) => {
    /** @type {{deck: string[], control: string[], showdown: string[]}} */
    const parts = { deck: [], control: [], showdown: [] };
    let cur = /** @type {'deck'|'control'|'showdown'} */ ('deck');
    for (const l of t.split('\n')) {
      const m = /^##\s*(.*)$/.exec(l.trim());
      if (m) {
        const n = m[1].toLowerCase();
        if (n.startsWith('control')) { cur = 'control'; continue; }
        if (n.startsWith('showdown')) { cur = 'showdown'; continue; }
      }
      parts[cur].push(l);
    }
    return parts;
  };
  const A = split(a);
  const B = split(b);
  const join = (/** @type {string[]} */ x, /** @type {string[]} */ y) =>
    [...x, '', ...y].join('\n').replace(/\n{3,}/g, '\n\n').trim();
  let out = join(A.deck, B.deck);
  const control = join(A.control, B.control);
  if (control) out += '\n\n## Control Room\n\n' + control;
  const showdown = join(A.showdown, B.showdown);
  if (showdown) out += '\n\n## Showdown\n\n' + showdown;
  return out + '\n';
}

$('aiDraft').onclick = () => {
  $('aiStatus').textContent = '';
  $('aiDlg').showModal();
};
$('aiCancel').onclick = () => $('aiDlg').close();
$('aiGo').onclick = async () => {
  const notes = $('aiNotes').value;
  if (!notes.trim()) { $('aiStatus').textContent = 'Paste some notes first.'; return; }
  const typedCode = $('aiCode').value.trim();
  if (typedCode) { try { localStorage.setItem(AI_CODE_KEY, typedCode); } catch { /* no store */ } }
  $('aiGo').disabled = true;
  $('aiStatus').textContent = 'Drafting… (a few seconds)';
  const r = await callAi({
    mode: 'draft', notes, instructions: $('aiInstructions').value, deckMode: meta.mode,
  });
  $('aiGo').disabled = false;
  if (!r.ok) {
    if (r.status === 401) $('aiCodeRow').style.display = '';
    $('aiStatus').textContent = r.json.error ?? `drafting failed (${r.status})`;
    return;
  }
  const doc = String(r.json.doc ?? '');
  $('aiDlg').close();
  if ($('aiAppend').checked) setText(mergeDocs(docText, doc), { caret: 0 });
  else adoptDoc(doc);
  toast('✨ Drafted — click the answer checks the AI left blank, and verify every key before use.');
};

/** Inline shorter-phrasing suggestions: chips to the RIGHT of each line,
 *  click to replace. Addressed by line (+ item index inside bucket lines);
 *  setLabel never changes the line count, so picks keep the rest aligned,
 *  and any edit that does change the line count clears the rail. */
/** @type {{line:number, itemIx?:number, kind:string, original:string, options:string[]}[]} */
let sugs = [];
let sugsLineCount = 0;
let sugsBusy = false;

/** The author text at an address, exactly as suggestibleItems() saw it. */
function extractLabel(/** @type {number} */ lineIx, /** @type {number|undefined} */ itemIx) {
  const t = (docText.split('\n')[lineIx] ?? '').trim();
  const kind = parsed.lines[lineIx]?.kind;
  if (kind === 'head') return parsed.blocks[parsed.lines[lineIx].block ?? -1]?.text ?? null;
  if (kind === 'answer') return t.replace(/^[✓*]\s*/, '').trim();
  if (kind === 'statement') return parsed.blocks[parsed.lines[lineIx].block ?? -1]?.text ?? null;
  if (kind === 'toggle') return t.replace(/^\[(on|off)\]\s*/i, '').replace(/\s*\(starts?\s+on\)\s*$/i, '').trim();
  if (kind === 'number') return t.split('=')[0].trim();
  if (kind === 'bucket') {
    const bk = splitBucket(t);
    if (!bk) return null;
    if (itemIx === undefined) return bk.name.trim();
    const items = bk.items.split(',').map((x) => x.trim()).filter(Boolean);
    return items[itemIx] ?? null;
  }
  return null;
}

/** Every piece of author text a shorter phrasing could help. */
function suggestibleItems() {
  /** @type {{id:string, kind:string, text:string, limit:number, line:number, itemIx?:number}[]} */
  const items = [];
  const src = docText.split('\n');
  parsed.lines.forEach((l, i) => {
    if (l.kind === 'head') {
      const text = extractLabel(i, undefined);
      if (text) items.push({ id: `h${i}`, kind: 'question', text, limit: LIMITS.questionChars, line: i });
    } else if (l.kind === 'answer') {
      const text = extractLabel(i, undefined);
      if (text) items.push({ id: `a${i}`, kind: 'answer', text, limit: LIMITS.answerChars, line: i });
    } else if (l.kind === 'statement') {
      const text = extractLabel(i, undefined);
      if (text) items.push({ id: `s${i}`, kind: 'statement', text, limit: LIMITS.statementChars, line: i });
    } else if (l.kind === 'toggle' || l.kind === 'number') {
      const text = extractLabel(i, undefined);
      if (text) items.push({ id: `t${i}`, kind: 'control', text, limit: LIMITS.controlLabelChars, line: i });
    } else if (l.kind === 'bucket') {
      const name = extractLabel(i, undefined);
      if (name) items.push({ id: `b${i}`, kind: 'bucket', text: name, limit: LIMITS.sortLabelChars, line: i });
      const bk = splitBucket((src[i] ?? '').trim());
      if (bk) {
        bk.items.split(',').map((x) => x.trim()).filter(Boolean).forEach((it, j) => {
          items.push({ id: `i${i}_${j}`, kind: 'item', text: it, limit: LIMITS.sortLabelChars, line: i, itemIx: j });
        });
      }
    }
  });
  return items;
}

/**
 * Character-limit meters: a small "len/limit" pill on any line whose text
 * is at 80%+ of its game limit, red once it's over. Rides the suggestion
 * rail (suggestion chips take over that space while they're up).
 * @param {HTMLElement} inner
 */
function renderMeters(inner) {
  /** @type {Map<number, ReturnType<typeof suggestibleItems>[number]>} */
  const worst = new Map();
  for (const it of suggestibleItems()) {
    const cur = worst.get(it.line);
    if (!cur || it.text.length / it.limit > cur.text.length / cur.limit) worst.set(it.line, it);
  }
  for (const it of worst.values()) {
    const len = it.text.length;
    if (len < it.limit * 0.8) continue;
    const d = document.createElement('div');
    d.className = 'meter' + (len > it.limit ? ' over' : '');
    d.textContent = `${len}/${it.limit}`;
    d.title = len > it.limit
      ? `"${it.text}" is ${len - it.limit} character${len - it.limit === 1 ? '' : 's'} over the limit for a ${it.kind} — it will be cut off in the game`
      : `${it.limit - len} character${it.limit - len === 1 ? '' : 's'} left for this ${it.kind}`;
    d.style.top = `${(lineTops[it.line] ?? 0) + 4}px`;
    inner.appendChild(d);
  }
}

function renderSugRail() {
  const inner = $('sugInner');
  inner.replaceChildren();
  if (!sugs.length) renderMeters(inner);
  $('aiShorten').textContent = sugs.length ? '✕ Clear suggestions' : '✨ Shorter phrasings…';
  for (const sg of sugs) {
    const row = document.createElement('div');
    row.className = 'sugrow';
    row.style.top = `${(lineTops[sg.line] ?? 0) + 2}px`;
    for (const opt of sg.options) {
      const b = document.createElement('button');
      b.textContent = opt;
      b.title = `replace "${sg.original}" (${sg.original.length} chars) with "${opt}" (${opt.length})`;
      b.onmousedown = (ev) => ev.preventDefault(); // keep textarea focus
      b.onclick = () => {
        // The author may have edited this line since the suggestions came
        // back — never clobber text that no longer matches.
        if (extractLabel(sg.line, sg.itemIx) !== sg.original) {
          sugs = sugs.filter((x) => x !== sg);
          renderSugRail();
          return;
        }
        sugs = sugs.filter((x) => x !== sg);
        setText(setLabel(docText, parsed, sg.line, opt, sg.itemIx), { keepPanel: true });
      };
      row.appendChild(b);
    }
    inner.appendChild(row);
  }
  syncScroll();
}

$('aiShorten').onclick = async () => {
  if (sugs.length) { // acting as "✕ Clear suggestions"
    sugs = [];
    refresh({ keepPanel: true });
    return;
  }
  if (sugsBusy) return;
  const btn = $('aiShorten');
  sugsBusy = true;
  btn.disabled = true;
  btn.textContent = '✨ Thinking…';
  const items = suggestibleItems();
  const payload = { mode: 'suggest', items: items.map(({ id, kind, text, limit }) => ({ id, kind, text, limit })) };
  let r = await callAi(payload);
  if (r.status === 401) {
    const code = window.prompt('Drafting passcode (ask the host):');
    if (code) {
      try { localStorage.setItem(AI_CODE_KEY, code.trim()); } catch { /* no store */ }
      r = await callAi(payload);
    }
  }
  sugsBusy = false;
  btn.disabled = false;
  if (!r.ok) {
    btn.textContent = '✨ Shorter phrasings…';
    toast(r.json.error ?? `suggestions failed (${r.status})`);
    return;
  }
  const byId = new Map(items.map((it) => [it.id, it]));
  sugs = (Array.isArray(r.json.suggestions) ? r.json.suggestions : [])
    .filter((/** @type {any} */ sg) => byId.has(sg.id))
    .map((/** @type {any} */ sg) => {
      const it = /** @type {any} */ (byId.get(sg.id));
      return { line: it.line, itemIx: it.itemIx, kind: it.kind, original: it.text, options: sg.options.slice(0, 3) };
    });
  sugsLineCount = docText.split('\n').length;
  if (!sugs.length) {
    btn.textContent = '✨ Shorter phrasings…';
    toast('No shorter suggestions — your text is already tight.');
    return;
  }
  toast(`✨ ${sugs.length} suggestion${sugs.length === 1 ? '' : 's'} beside your text — click one to use it, ✕ to clear the rest.`);
  refresh({ keepPanel: true });
};

// boot
adoptDoc(loadDraft() ?? serializeDoc(SAMPLE), { boot: true });
void fetch('/api/levels')
  .then((r) => (r.ok ? r.json() : Promise.reject()))
  .then((list) => {
    if (Array.isArray(list) && list.length) {
      levelPool = list;
      // Both the first preview AND the first Details panel were built before
      // the library arrived — without this the panel keeps showing the
      // no-designed-levels fallback until you click another question.
      refresh({ keepPanel: false });
    }
  })
  .catch(() => { /* no server (GitHub Pages): generated arenas only */ });
// Debug handle for harnesses — mirrors the display's __platforms.
Object.defineProperty(globalThis, '__studio', {
  value: {
    get pvGame() { return pvGame; },
    get pvWorld() { return pvWorld; },
    get levelPool() { return levelPool; },
    // What Download/Copy would write — the doc plus everything carried
    // beside it (arena pins, Control Room, Showdown).
    get pack() { return exportable(); },
  },
});
requestAnimationFrame((t) => { lastT = t; requestAnimationFrame(frame); });

/**
 * The pack document: text-first authoring for the Pack Studio.
 *
 * The raw document string IS the pack — every Studio affordance (gutter
 * clicks, the detail panel, add/remove buttons) works by rewriting the
 * text, and the playable pack is always parseDoc(text).raw run through
 * shared/pack-validate.js. There is no second model to keep in sync.
 *
 * Format, by example:
 *
 *   pack: Cardiology review       <- front matter before the first '#'
 *   theme: blanc                     (pack / theme / time / order)
 *   time: 12s
 *
 *   # Which planet has the most moons?
 *   Jupiter
 *   ✓ Saturn                      <- '✓' or '*' prefix marks correct;
 *   Uranus                           two or more checks = select-all
 *
 *   # Normal resting heart rate?
 *   range: 60-100 of 0-160 bpm    <- answer lo-hi of min-max [unit]
 *
 *   # Sort each animal by class
 *   Mammal → Bat, Dolphin         <- two or more arrow lines ARE a sort
 *   Bird → Penguin                   block; every type is inferred from
 *   pace: 6s                         the body, none is declared
 *
 *   ## Control Room               <- section headers split the buckets
 *   # Post-op: set the vent
 *   context: The room is yours
 *   [on] Suction ready            <- toggle: answer ON
 *   [off] Alarms muted (starts on)
 *   PEEP = 8 (0-20, step 1, cmH2O)
 *
 *   ## Showdown
 *   true: An octopus has three hearts
 *
 * NO IMPORTS, no DOM — pure text in, structure out, so it runs in node
 * tests and in the browser alike. Line numbers in problems are 1-based
 * (for humans); every other line index in this module is 0-based.
 */

const CHECK_RE = /^[✓*]\s*/;
const SECTION_RE = /^##\s*(.*)$/;
const HEAD_RE = /^#(?!#)\s*(.*)$/;
const HEAD_TAG_RE = /^#(choice|range|sort)\b\s*(.*)$/i;
const RANGE_RE = /^range\s*:\s*(-?[\d.]+)\s*[-–]\s*(-?[\d.]+)\s+of\s+(-?[\d.]+)\s*[-–]\s*(-?[\d.]+)\s*(.*)$/i;
const TOGGLE_RE = /^\[(on|off)\]\s*(.*)$/i;
const STARTS_ON_RE = /\s*\(starts?\s+on\)\s*$/i;
const NUMBER_RE = /^(.+?)\s*=\s*(-?[\d.]+)\s*(?:\((.*)\))?\s*$/;
const STATEMENT_RE = /^(true|false)\s*:\s*(.*)$/i;
const BUCKET_RE = /^([^:]{1,40}):\s*(.*)$/;
/** "Mammal → Bat, Dolphin" — the arrow makes a sort block self-declaring. */
const BUCKET_ARROW_RE = /^(.{1,40}?)\s*(?:→|->)\s*(.*)$/;
const DIRECTIVE_RE = /^(img|image|layout|level|type|pace|time|context|turns)\s*:\s*(.*)$/i;

/** Directive keys that make sense per location; anything else is flagged. */
const FRONT_KEYS = ['pack', 'theme', 'time', 'order', 'mode', 'cover'];

/** @param {string} v e.g. "12s", "12", "6.5s" @returns {number|null} ms */
function parseSeconds(v) {
  const m = /^(-?[\d.]+)\s*s?$/.exec(v.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? Math.round(n * 1000) : null;
}

const fmtSeconds = (/** @type {number} */ ms) => `${ms / 1000}s`;

/**
 * @typedef {{
 *   kind: 'blank'|'front'|'section'|'head'|'answer'|'range'|'bucket'|
 *         'toggle'|'number'|'directive'|'statement'|'unknown',
 *   block: number|null,
 *   checked?: boolean,
 *   verdict?: boolean|null,
 *   startsOn?: boolean,
 *   fields?: any,
 * }} LineInfo
 *
 * @typedef {{
 *   bucket: 'deck'|'control'|'showdown',
 *   ix: number,
 *   type: 'choice'|'multi'|'range'|'sort'|'case'|'statement',
 *   text: string,
 *   headLine: number, startLine: number, endLine: number,
 *   img: string|null,
 *   directives: Record<string, {line:number, value:string}>,
 * }} BlockInfo
 */

/**
 * Pull the pack meta (pack/theme/time/order/mode/cover) off the top of a document
 * and return it alongside the stripped text. The Studio runs this at
 * every LOAD — boot, Open, Paste, Load sample — so serialized imports
 * and drafts from the front-matter era migrate into the Pack panel and
 * the doc itself holds only questions.
 * @param {string} text
 * @returns {{ meta: {pack?:string, theme?:string, answerMs?:number, order?:string, mode?:string, cover?:string}, text: string }}
 */
export function extractFrontMatter(text) {
  const lines = text.split('\n');
  /** @type {{pack?:string, theme?:string, answerMs?:number, order?:string, mode?:string, cover?:string}} */
  const meta = {};
  let i = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (!t) { i++; continue; } // leading/interleaved blanks go with the block
    const m = /^(pack|theme|time|order|mode|cover)\s*:\s*(.*)$/i.exec(t);
    if (!m) break;
    const key = m[1].toLowerCase();
    const v = m[2].trim();
    if (key === 'pack') meta.pack = v;
    else if (key === 'theme') meta.theme = v;
    else if (key === 'order') meta.order = v;
    else if (key === 'mode') meta.mode = v;
    else if (key === 'cover') meta.cover = v;
    else {
      const ms = parseSeconds(v);
      if (ms !== null) meta.answerMs = ms;
    }
    i++;
  }
  return { meta, text: lines.slice(i).join('\n') };
}

/**
 * Split a document into the deck part and whatever lives in the
 * '## Control Room' / '## Showdown' sections.
 *
 * The Studio authors decks only, so it loads the deck text and carries the
 * rest as DATA — invisible in the editor, still attached on export, never
 * lost. The syntax itself is untouched: these sections still parse, still
 * validate and still play; the editor simply does not show them.
 *
 * @param {string} text
 * @returns {{ text: string, carried: {controlRoom?: any, showdown?: any} }}
 */
export function splitSections(text) {
  const { raw } = parseDoc(text, { frontMatter: false });
  /** @type {{controlRoom?: any, showdown?: any}} */
  const carried = {};
  if (raw.controlRoom) carried.controlRoom = raw.controlRoom;
  if (raw.showdown) carried.showdown = raw.showdown;
  if (!raw.controlRoom && !raw.showdown && !/^##\s*(control|showdown)/im.test(text)) {
    return { text, carried };
  }
  const kept = [];
  let dropping = false;
  for (const line of text.split('\n')) {
    const sec = SECTION_RE.exec(line.trim());
    if (sec) {
      const name = sec[1].trim().toLowerCase();
      dropping = name.startsWith('control') || name === 'showdown';
      if (dropping) continue;
    }
    if (!dropping) kept.push(line);
  }
  return { text: kept.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '\n'), carried };
}

/**
 * Pull 'level:' lines out of a document, keyed by the question they belong
 * to. The arena a question plays on is picked with the thumbnail buttons in
 * the Details panel, so it has no business being typed — it rides beside the
 * text and is re-attached on export, exactly like the Control Room and
 * Showdown sections. Keyed by question TEXT so reordering questions keeps
 * every pin; rewriting a question's words drops its pin back to Auto, which
 * is the game's own default.
 * @param {string} text
 * @returns {{ text: string, levels: Record<string, string> }}
 */
export function extractLevels(text) {
  /** @type {Record<string, string>} */
  const levels = {};
  if (!/^\s*level\s*:/im.test(text)) return { text, levels };
  /** @type {string[]} */
  const kept = [];
  let head = null;
  for (const line of text.split('\n')) {
    const t = line.trim();
    const h = HEAD_RE.exec(t);
    if (h && !SECTION_RE.test(t)) {
      const tag = HEAD_TAG_RE.exec(t);
      head = (tag ? tag[2] : h[1]).trim();
      kept.push(line);
      continue;
    }
    const lvl = /^level\s*:\s*(.*)$/i.exec(t);
    if (lvl && head) {
      if (lvl[1].trim()) levels[head] = lvl[1].trim();
      continue; // the line itself never reaches the editor
    }
    kept.push(line);
  }
  return { text: kept.join('\n'), levels };
}

/**
 * Parse the document into the raw pack (for validatePack) plus the line
 * and block maps the Studio UI hangs its gutter, outline and panel on.
 *
 * opts.frontMatter: pass false when the pack meta lives OUTSIDE the text
 * (the Studio's Pack panel) — typed pack/theme/time/order lines are then
 * flagged instead of absorbed, so nothing is silently ignored.
 *
 * @param {string} text
 * @param {{frontMatter?: boolean}} [opts]
 * @returns {{ raw: any, blocks: BlockInfo[], lines: LineInfo[],
 *             problems: {line:number|null, msg:string}[] }}
 */
export function parseDoc(text, { frontMatter = true } = {}) {
  const src = text.split('\n');
  /** @type {LineInfo[]} */
  const lines = src.map(() => ({ kind: 'blank', block: null }));
  /** @type {BlockInfo[]} */
  const blocks = [];
  /** @type {{line:number|null, msg:string}[]} */
  const problems = [];

  /** @type {any} */
  const raw = { pack: 'New pack', theme: 'blanc', answerMs: 12000, questions: [] };
  /** @type {any} */
  const control = { perTeam: 1, answerMs: 40000, questions: [] };
  /** @type {any} */
  const showdown = { answerMs: 6000, statements: [] };

  /** @type {'front'|'deck'|'control'|'showdown'} */
  let section = 'front';

  // Current deck/control block accumulator.
  /** @type {any} */
  let cur = null;

  const flag = (/** @type {number} */ i, /** @type {string} */ msg) =>
    problems.push({ line: i + 1, msg });

  function finishBlock() {
    if (!cur) return;
    const b = cur;
    cur = null;
    if (b.bucket === 'deck') finishDeck(b);
    else finishControl(b);
  }

  /** @param {any} b */
  function finishDeck(b) {
    /** @type {any} */
    const q = { text: b.text };
    if (b.directives.img) q.image = b.directives.img.value;
    if (b.directives.layout) q.layout = b.directives.layout.value;
    let type = b.tag ?? null;

    // Two or more arrow lines ARE a sort block — the type needs no line of
    // its own in the document.
    if (!type && b.arrowLines.length >= 2) {
      type = 'sort';
      b.bucketLines = b.arrowLines;
      const onArrow = new Set(b.arrowLines.map((/** @type {any} */ a) => a.line));
      b.answers = b.answers.filter((/** @type {any} */ a) => !onArrow.has(a.line));
    }
    if (!type && b.rangeLine !== undefined) type = 'range';
    if (type === 'sort') {
      q.type = 'sort';
      // A "type: sort" line placed BELOW the buckets means those lines were
      // read as answers; re-read them as buckets so line order never
      // changes the meaning of a block.
      if (!b.bucketLines.length && b.answers.length) {
        for (const a of b.answers) {
          const bm = BUCKET_RE.exec(a.label);
          if (!bm) continue;
          b.bucketLines.push({
            line: a.line, name: bm[1].trim(),
            items: bm[2].split(',').map((/** @type {string} */ s) => s.trim()).filter(Boolean),
          });
        }
        b.answers = b.answers.filter((/** @type {any} */ a) => !b.bucketLines.some((/** @type {any} */ bl) => bl.line === a.line));
      }
      /** @type {string[]} */
      const buckets = [];
      /** @type {{label:string, bucket:number}[]} */
      const items = [];
      for (const bl of b.bucketLines) {
        const bi = buckets.length;
        buckets.push(bl.name);
        for (const label of bl.items) items.push({ label, bucket: bi });
        lines[bl.line] = { kind: 'bucket', block: blocks.length };
      }
      q.buckets = buckets;
      q.items = items;
      if (b.directives.pace) {
        const ms = parseSeconds(b.directives.pace.value);
        if (ms === null) flag(b.directives.pace.line, `pace "${b.directives.pace.value}" is not a number of seconds`);
        else q.itemMs = ms;
      }
      for (const a of b.answers) {
        flag(a.line, 'sort blocks list buckets as "Bucket: item, item" — this line was ignored');
        lines[a.line] = { kind: 'unknown', block: blocks.length };
      }
      if (b.rangeLine !== undefined) flag(b.rangeLine, 'a range: line in a sort block was ignored');
      if (b.directives.level) flag(b.directives.level.line, 'level picks a choice-question arena — sort plays its own');
    } else if (type === 'range') {
      q.type = 'range';
      if (b.rangeLine === undefined) {
        flag(b.headLine, 'range question needs a "range: LO-HI of MIN-MAX [unit]" line');
      } else {
        Object.assign(q, b.range);
        lines[b.rangeLine] = { kind: 'range', block: blocks.length, fields: { ...b.range } };
      }
      for (const a of b.answers) {
        flag(a.line, 'range questions have no answer list — this line was ignored');
        lines[a.line] = { kind: 'unknown', block: blocks.length };
      }
      if (b.directives.pace) flag(b.directives.pace.line, 'pace applies to sort questions only');
      if (b.directives.level) flag(b.directives.level.line, 'level picks a choice-question arena — range plays the number line');
    } else {
      // choice / select-all
      type = 'choice';
      q.answers = b.answers.map((/** @type {any} */ a) => a.label);
      const checked = b.answers
        .map((/** @type {any} */ a, /** @type {number} */ i) => (a.checked ? i : -1))
        .filter((/** @type {number} */ i) => i >= 0);
      if (checked.length === 0 && b.answers.length) {
        flag(b.headLine, 'click the check on the correct answer (or type "✓ " / "* " before it)');
      }
      q.correct = checked.length >= 2 ? checked : checked[0];
      if (checked.length >= 2) type = 'multi';
      for (const a of b.answers) {
        lines[a.line] = { kind: 'answer', block: blocks.length, checked: !!a.checked };
      }
      if (b.rangeLine !== undefined && b.tag === 'choice') flag(b.rangeLine, 'a range: line in a choice block was ignored');
      if (b.directives.pace) flag(b.directives.pace.line, 'pace applies to sort questions only');
      if (b.directives.level) {
        if (q.image) flag(b.directives.level.line, 'picture questions play the flat row — the level is ignored');
        else q.level = b.directives.level.value;
      }
    }
    if (b.directives.time) flag(b.directives.time.line, 'time is set for the whole deck in the front matter (time: 12s)');
    if (b.directives.context) flag(b.directives.context.line, 'context is a Control Room setting');

    blocks.push({
      bucket: 'deck', ix: raw.questions.length, type: /** @type {any} */ (type),
      text: b.text, headLine: b.headLine, startLine: b.startLine, endLine: b.endLine,
      img: q.image ?? null, directives: b.directives,
    });
    lines[b.headLine] = { kind: 'head', block: blocks.length - 1 };
    for (const [, d] of Object.entries(b.directives)) {
      if (lines[d.line].kind === 'blank') lines[d.line] = { kind: 'directive', block: blocks.length - 1 };
    }
    raw.questions.push(q);
  }

  /** @param {any} b */
  function finishControl(b) {
    /** @type {any} */
    const q = { text: b.text, controls: b.controls.map((/** @type {any} */ c) => c.control) };
    if (b.directives.context) q.context = b.directives.context.value;
    if (b.directives.time) {
      const ms = parseSeconds(b.directives.time.value);
      if (ms === null) flag(b.directives.time.line, `time "${b.directives.time.value}" is not a number of seconds`);
      else q.answerMs = ms;
    }
    if (b.directives.img) flag(b.directives.img.line, 'pictures are a standard-deck feature');
    if (b.directives.level) flag(b.directives.level.line, 'level is a deck-question setting — cases play the control room');
    if (b.directives.type) flag(b.directives.type.line, 'type is a deck-question setting — every Control Room block is a case');
    blocks.push({
      bucket: 'control', ix: control.questions.length, type: 'case',
      text: b.text, headLine: b.headLine, startLine: b.startLine, endLine: b.endLine,
      img: null, directives: b.directives,
    });
    lines[b.headLine] = { kind: 'head', block: blocks.length - 1 };
    for (const c of b.controls) {
      lines[c.line] = {
        kind: c.kind, block: blocks.length - 1,
        verdict: c.verdict, startsOn: c.control.initial === true,
        fields: c.kind === 'number' ? { ...c.control } : undefined,
      };
      if (c.kind === 'toggle' && c.verdict === null) {
        flag(c.line, `click ON or OFF for "${c.control.label}" (or type [on] / [off] before it)`);
      }
    }
    for (const [, d] of Object.entries(b.directives)) {
      if (lines[d.line].kind === 'blank') lines[d.line] = { kind: 'directive', block: blocks.length - 1 };
    }
    control.questions.push(q);
  }

  for (let i = 0; i < src.length; i++) {
    const line = src[i].trimEnd();
    const t = line.trim();
    if (!t) continue;

    // ---- section headers
    const sec = SECTION_RE.exec(t);
    if (sec) {
      finishBlock();
      const name = sec[1].trim().toLowerCase();
      if (name === 'control room' || name === 'control') section = 'control';
      else if (name === 'showdown') section = 'showdown';
      else if (name === 'deck' || name === 'questions') section = 'deck';
      else {
        flag(i, `unknown section "## ${sec[1].trim()}" — use ## Control Room or ## Showdown`);
        lines[i] = { kind: 'unknown', block: null };
        continue;
      }
      lines[i] = { kind: 'section', block: null };
      continue;
    }

    // ---- block heads (deck + control sections)
    const isHead = HEAD_RE.test(t) || HEAD_TAG_RE.test(t);
    if (isHead) {
      if (section === 'front') section = 'deck';
      if (section === 'showdown') {
        flag(i, 'showdown entries are plain statements — no # needed');
        lines[i] = { kind: 'unknown', block: null };
        continue;
      }
      finishBlock();
      const tag = HEAD_TAG_RE.exec(t);
      cur = {
        bucket: section,
        tag: tag ? tag[1].toLowerCase() : null,
        text: (tag ? tag[2] : /** @type {RegExpExecArray} */ (HEAD_RE.exec(t))[1]).trim(),
        headLine: i, startLine: i, endLine: i,
        directives: {}, answers: [], bucketLines: [], arrowLines: [], controls: [],
        rangeLine: undefined, range: undefined,
      };
      if (cur.tag && section === 'control') {
        flag(i, `#${cur.tag} is a deck tag — control cases are plain # lines`);
        cur.tag = null;
      }
      continue;
    }

    // ---- front matter
    if (section === 'front') {
      const m = /^(\w[\w-]*)\s*:\s*(.*)$/.exec(t);
      if (m && FRONT_KEYS.includes(m[1].toLowerCase())) {
        if (!frontMatter) {
          flag(i, 'name, theme, time, mode, cover and order live in the bar above the document — this line is ignored');
          lines[i] = { kind: 'unknown', block: null };
          continue;
        }
        const key = m[1].toLowerCase();
        const v = m[2].trim();
        if (key === 'pack') raw.pack = v;
        else if (key === 'theme') raw.theme = v;
        else if (key === 'order') raw.order = v;
        else if (key === 'mode') raw.mode = v;
        else if (key === 'cover') raw.cover = v;
        else {
          const ms = parseSeconds(v);
          if (ms === null) flag(i, `time "${v}" is not a number of seconds (try: time: 12s)`);
          else raw.answerMs = ms;
        }
        lines[i] = { kind: 'front', block: null };
      } else {
        flag(i, frontMatter
          ? 'before the first # question, only pack: / theme: / time: / order: / mode: lines are recognized'
          : 'this line belongs to no question — start one with #');
        lines[i] = { kind: 'unknown', block: null };
      }
      continue;
    }

    // ---- showdown statements + section-level directives
    if (section === 'showdown') {
      const d = DIRECTIVE_RE.exec(t);
      if (d && d[1].toLowerCase() === 'time') {
        const ms = parseSeconds(d[2]);
        if (ms === null) flag(i, `time "${d[2]}" is not a number of seconds`);
        else showdown.answerMs = ms;
        lines[i] = { kind: 'directive', block: null };
        continue;
      }
      const st = STATEMENT_RE.exec(t);
      const verdict = st ? st[1].toLowerCase() === 'true' : null;
      const textPart = st ? st[2].trim() : t;
      blocks.push({
        bucket: 'showdown', ix: showdown.statements.length, type: 'statement',
        text: textPart, headLine: i, startLine: i, endLine: i, img: null, directives: {},
      });
      lines[i] = { kind: 'statement', block: blocks.length - 1, verdict };
      if (verdict === null) flag(i, 'click TRUE or FALSE for this statement (or start the line with true: / false:)');
      showdown.statements.push({ text: textPart, answer: verdict ?? undefined });
      continue;
    }

    // ---- inside a deck/control block (or section preamble)
    if (!cur) {
      // Control-section preamble: time/turns before the first case.
      if (section === 'control') {
        const d = DIRECTIVE_RE.exec(t);
        if (d && d[1].toLowerCase() === 'time') {
          const ms = parseSeconds(d[2]);
          if (ms === null) flag(i, `time "${d[2]}" is not a number of seconds`);
          else control.answerMs = ms;
          lines[i] = { kind: 'directive', block: null };
          continue;
        }
        if (d && d[1].toLowerCase() === 'turns') {
          const n = Number(d[2]);
          if (Number.isFinite(n)) control.perTeam = n;
          else flag(i, `turns "${d[2]}" is not a number`);
          lines[i] = { kind: 'directive', block: null };
          continue;
        }
      }
      flag(i, 'this line belongs to no question — start one with #');
      lines[i] = { kind: 'unknown', block: null };
      continue;
    }

    cur.endLine = i;

    // Directives are a fixed keyword set, so answers containing ':' stay answers.
    const d = DIRECTIVE_RE.exec(t);
    if (d) {
      const key = d[1].toLowerCase() === 'image' ? 'img' : d[1].toLowerCase();
      if (key === 'turns') { flag(i, 'turns is a Control Room section setting — put it right under ## Control Room'); lines[i] = { kind: 'unknown', block: null }; continue; }
      // "type: sort" is the LEGACY way to declare a sort block (documents
      // written before arrow buckets). Still honoured on the way in; the
      // Studio never writes one.
      if (key === 'type' && cur.bucket === 'deck') {
        const v = d[2].trim().toLowerCase();
        if (['choice', 'range', 'sort'].includes(v)) cur.tag = v;
        else flag(i, `unknown type "${d[2].trim()}" — every type is inferred from the lines beneath the question`);
      }
      cur.directives[key] = { line: i, value: d[2].trim() };
      continue; // line kind assigned when the block finishes
    }

    if (cur.bucket === 'deck') {
      const r = RANGE_RE.exec(t);
      if (r) {
        cur.rangeLine = i;
        cur.range = {
          answer: [Number(r[1]), Number(r[2])],
          min: Number(r[3]), max: Number(r[4]),
          ...(r[5].trim() ? { unit: r[5].trim() } : {}),
        };
        continue;
      }
      if (cur.tag === 'sort') {
        const bm = BUCKET_RE.exec(t);
        if (bm) {
          cur.bucketLines.push({
            line: i, name: bm[1].trim(),
            items: bm[2].split(',').map((s) => s.trim()).filter(Boolean),
          });
          continue;
        }
      }
      // Arrow lines are remembered as candidates AND kept as answers: two or
      // more of them make the block a sort (see finishDeck), one on its own
      // is just an answer that happens to contain an arrow.
      const am = BUCKET_ARROW_RE.exec(t);
      if (am && !CHECK_RE.test(t)) {
        cur.arrowLines.push({
          line: i, name: am[1].trim(),
          items: am[2].split(',').map((s) => s.trim()).filter(Boolean),
        });
      }
      const checked = CHECK_RE.test(t);
      cur.answers.push({ line: i, checked, label: t.replace(CHECK_RE, '').trim() });
      continue;
    }

    // control case body: toggles and numbers
    const tg = TOGGLE_RE.exec(t);
    const rest = tg ? tg[2] : t;
    const nm = tg ? null : NUMBER_RE.exec(t);
    if (nm) {
      const label = nm[1].trim();
      const answer = Number(nm[2]);
      /** @type {any} */
      const c = { label, kind: 'number', answer, step: 1, unit: '' };
      c.min = Math.min(0, Math.floor(answer));
      c.max = Math.max(10, Math.ceil(answer * 2));
      c.initial = c.min;
      for (const tok of (nm[3] ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
        const range = /^(-?[\d.]+)\s*[-–]\s*(-?[\d.]+)$/.exec(tok);
        const step = /^step\s+(-?[\d.]+)$/i.exec(tok);
        const start = /^start\s+(-?[\d.]+)$/i.exec(tok);
        if (range) { c.min = Number(range[1]); c.max = Number(range[2]); if (c.initial < c.min || c.initial > c.max) c.initial = c.min; }
        else if (step) c.step = Number(step[1]);
        else if (start) c.initial = Number(start[1]);
        else c.unit = tok;
      }
      cur.controls.push({ line: i, kind: 'number', verdict: undefined, control: c });
      continue;
    }
    const startsOn = STARTS_ON_RE.test(rest);
    const label = rest.replace(STARTS_ON_RE, '').trim();
    cur.controls.push({
      line: i, kind: 'toggle',
      verdict: tg ? tg[1].toLowerCase() === 'on' : null,
      control: { label, kind: 'toggle', initial: startsOn, answer: tg ? tg[1].toLowerCase() === 'on' : undefined },
    });
  }
  finishBlock();

  if (control.questions.length) raw.controlRoom = control;
  if (showdown.statements.length) raw.showdown = showdown;
  return { raw, blocks, lines, problems };
}

// --------------------------------------------------------------- serialize

/**
 * Render pack JSON as a document — used for JSON import, Load sample, and
 * migrating the old form-era localStorage draft. Tolerant of raw imports.
 * @param {any} p @returns {string}
 */
export function serializeDoc(p) {
  /** @type {string[]} */
  const out = [];
  out.push(`pack: ${typeof p?.pack === 'string' ? p.pack : 'New pack'}`);
  out.push(`theme: ${typeof p?.theme === 'string' ? p.theme : 'blanc'}`);
  out.push(`time: ${fmtSeconds(Number.isFinite(p?.answerMs) ? p.answerMs : 12000)}`);
  if (p?.mode === 'solo' || p?.mode === 'teams') out.push(`mode: ${p.mode}`);
  if (typeof p?.cover === 'string' && p.cover) out.push(`cover: ${p.cover}`);
  if (p?.order === 'suggested') out.push('order: suggested');
  out.push('');

  for (const q of Array.isArray(p?.questions) ? p.questions : []) {
    if (q?.type === 'sort') {
      out.push(`# ${q.text ?? ''}`);
      if (q.image) out.push(`img: ${q.image}`);
      const buckets = Array.isArray(q.buckets) ? q.buckets : [];
      buckets.forEach((/** @type {string} */ b, /** @type {number} */ bi) => {
        const items = (Array.isArray(q.items) ? q.items : [])
          .filter((/** @type {any} */ it) => it.bucket === bi)
          .map((/** @type {any} */ it) => it.label);
        out.push(`${b} → ${items.join(', ')}`);
      });
      if (Number.isFinite(q.itemMs) && q.itemMs !== 6000) out.push(`pace: ${fmtSeconds(q.itemMs)}`);
    } else if (q?.type === 'range') {
      out.push(`# ${q.text ?? ''}`);
      if (q.image) out.push(`img: ${q.image}`);
      const [lo, hi] = Array.isArray(q.answer) ? q.answer : [0, 0];
      out.push(`range: ${lo}-${hi} of ${q.min}-${q.max}${q.unit ? ` ${q.unit}` : ''}`);
    } else {
      out.push(`# ${q?.text ?? ''}`);
      if (q?.image) out.push(`img: ${q.image}`);
      if (typeof q?.level === 'string' && q.level && !q.image) out.push(`level: ${q.level}`);
      if (q?.layout && q.layout !== 'islands' && !(q.image && q.layout === 'row')) out.push(`layout: ${q.layout}`);
      const correct = new Set(Array.isArray(q?.correct) ? q.correct : [q?.correct]);
      (Array.isArray(q?.answers) ? q.answers : []).forEach((/** @type {any} */ a, /** @type {number} */ ai) => {
        out.push(`${correct.has(ai) ? '✓ ' : ''}${a}`);
      });
    }
    out.push('');
  }

  const cq = p?.controlRoom?.questions;
  if (Array.isArray(cq) && cq.length) {
    out.push('## Control Room');
    const blockMs = Number.isFinite(p.controlRoom.answerMs) ? p.controlRoom.answerMs : 40000;
    if (Number.isFinite(p.controlRoom.perTeam) && p.controlRoom.perTeam !== 1) out.push(`turns: ${p.controlRoom.perTeam}`);
    if (blockMs !== 40000) out.push(`time: ${fmtSeconds(blockMs)}`);
    out.push('');
    for (const q of cq) {
      out.push(`# ${q?.text ?? ''}`);
      if (q?.context) out.push(`context: ${q.context}`);
      if (Number.isFinite(q?.answerMs) && q.answerMs !== blockMs) out.push(`time: ${fmtSeconds(q.answerMs)}`);
      for (const c of Array.isArray(q?.controls) ? q.controls : []) {
        if (c?.kind === 'number') out.push(numberLine(c));
        else out.push(`[${c?.answer ? 'on' : 'off'}] ${c?.label ?? ''}${c?.initial ? ' (starts on)' : ''}`);
      }
      out.push('');
    }
  }

  const st = p?.showdown?.statements;
  if (Array.isArray(st) && st.length) {
    out.push('## Showdown');
    if (Number.isFinite(p.showdown.answerMs) && p.showdown.answerMs !== 6000) out.push(`time: ${fmtSeconds(p.showdown.answerMs)}`);
    out.push('');
    for (const s of st) out.push(`${s?.answer === false ? 'false' : 'true'}: ${s?.text ?? ''}`);
    out.push('');
  }

  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n') + '\n';
}

/** Canonical text for a number control line. @param {any} c */
function numberLine(c) {
  const parts = [`${c.min}-${c.max}`];
  if (Number.isFinite(c.step) && c.step !== 1) parts.push(`step ${c.step}`);
  if (Number.isFinite(c.initial) && c.initial !== 0) parts.push(`start ${c.initial}`);
  if (c.unit) parts.push(String(c.unit));
  return `${c.label} = ${c.answer} (${parts.join(', ')})`;
}

// ---------------------------------------------------------- text surgery
// Every helper returns NEW text; the caller re-parses. Line indexes are
// 0-based, straight from parseDoc's lines array.

/** @param {string} text @param {number} i */
export function toggleCheck(text, i) {
  const lines = text.split('\n');
  const t = lines[i] ?? '';
  lines[i] = CHECK_RE.test(t.trim())
    ? t.replace(/^(\s*)[✓*]\s*/, '$1')
    : t.replace(/^(\s*)/, '$1✓ ');
  return lines.join('\n');
}

/**
 * Mark line i as the ONE correct answer in its block, clearing every other
 * check there — the free-for-all rule, where select-all does not exist.
 * Clicking the answer that is already checked still clears it, so a wrong
 * key can be undone; it just can never produce a second check. Pass
 * force:true to mean "make this the answer" regardless — used by the fix
 * that turns a stray select-all back into a single-answer question.
 * @param {string} text @param {ReturnType<typeof parseDoc>} parsed
 * @param {number} i @param {{force?: boolean}} [opts]
 */
export function setOnlyCheck(text, parsed, i, opts = {}) {
  const block = parsed.lines[i]?.block;
  if (block === null || block === undefined) return toggleCheck(text, i);
  const wasChecked = !opts.force && parsed.lines[i]?.checked === true;
  const lines = text.split('\n');
  parsed.lines.forEach((l, j) => {
    if (l.kind !== 'answer' || l.block !== block) return;
    const want = j === i && !wasChecked;
    const bare = lines[j].replace(/^(\s*)[✓*]\s*/, '$1');
    lines[j] = want ? bare.replace(/^(\s*)/, '$1✓ ') : bare;
  });
  return lines.join('\n');
}

/**
 * Set the verdict a gutter pill controls: TRUE/FALSE on a showdown
 * statement, ON/OFF on a control toggle.
 * @param {string} text @param {number} i
 * @param {'statement'|'toggle'} kind @param {boolean} value
 */
export function setVerdict(text, i, kind, value) {
  const lines = text.split('\n');
  const t = (lines[i] ?? '').trim();
  if (kind === 'statement') {
    lines[i] = `${value ? 'true' : 'false'}: ${t.replace(STATEMENT_RE, '$2').trim()}`;
  } else {
    lines[i] = `[${value ? 'on' : 'off'}] ${t.replace(TOGGLE_RE, '$2').trim()}`;
  }
  return lines.join('\n');
}

/** Add/remove the "(starts on)" suffix on a control toggle line. */
export function setStartsOn(/** @type {string} */ text, /** @type {number} */ i, /** @type {boolean} */ on) {
  const lines = text.split('\n');
  const t = (lines[i] ?? '').replace(STARTS_ON_RE, '');
  lines[i] = on ? `${t} (starts on)` : t;
  return lines.join('\n');
}

/**
 * Rewrite a structured line from panel fields.
 * kind 'range': {lo, hi, min, max, unit} — the range: line.
 * kind 'number': {label, answer, min, max, step, initial, unit}.
 * @param {string} text @param {number} i
 * @param {'range'|'number'} kind @param {any} f
 */
export function setLineFields(text, i, kind, f) {
  const lines = text.split('\n');
  lines[i] = kind === 'range'
    ? `range: ${f.lo}-${f.hi} of ${f.min}-${f.max}${f.unit ? ` ${f.unit}` : ''}`
    : numberLine(f);
  return lines.join('\n');
}

/**
 * Set/replace/remove a directive line. block = a BlockInfo, or null for
 * the front matter. value null removes the line.
 * @param {string} text @param {import('./pack-text.js').BlockInfo|null} block
 * @param {string} key @param {string|null} value
 */
export function setDirective(text, block, key, value) {
  const lines = text.split('\n');
  const re = new RegExp(`^\\s*(${key === 'img' ? 'img|image' : key})\\s*:`, 'i');
  const from = block ? block.startLine : 0;
  const to = block ? block.endLine : frontMatterEnd(lines);
  let found = -1;
  for (let i = from; i <= to && i < lines.length; i++) {
    if (re.test(lines[i])) { found = i; break; }
  }
  if (value === null) {
    if (found >= 0) lines.splice(found, 1);
  } else if (found >= 0) {
    lines[found] = `${key}: ${value}`;
  } else if (block) {
    lines.splice(block.headLine + 1, 0, `${key}: ${value}`);
  } else {
    lines.splice(to + 1, 0, `${key}: ${value}`);
  }
  return lines.join('\n');
}

/** Last line index of the front matter region (before any #/##/content). */
function frontMatterEnd(/** @type {string[]} */ lines) {
  let last = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue;
    if (t.startsWith('#')) break;
    if (!/^(pack|theme|time|order|mode|cover)\s*:/i.test(t)) break;
    last = i;
  }
  return last;
}

/**
 * Change a deck block's type: rewrites the # tag and re-templates the body
 * lines that don't translate, keeping the question text and any image.
 * @param {string} text @param {import('./pack-text.js').BlockInfo} block
 * @param {'choice'|'range'|'sort'} type
 */
export function setBlockType(text, block, type) {
  const lines = text.split('\n');
  const head = `# ${block.text}`;
  const body = type === 'range' ? ['range: 40-60 of 0-100']
    : type === 'sort' ? ['Bucket A → Item 1', 'Bucket B → Item 2']
    : ['✓ Answer 1', 'Answer 2', 'Answer 3'];
  const img = block.img ? [`img: ${block.img}`] : [];
  lines.splice(block.startLine, block.endLine - block.startLine + 1, head, ...img, ...body);
  return lines.join('\n');
}

const TEMPLATES = {
  deck: {
    choice: '# New question?\n✓ Answer 1\nAnswer 2\nAnswer 3',
    range: '# New range question?\nrange: 40-60 of 0-100',
    sort: '# New sort question?\nBucket A → Item 1, Item 2\nBucket B → Item 3',
  },
  control: '# New case: set the controls\n'
    + Array.from({ length: 6 }, (_, i) => `[${i % 2 ? 'off' : 'on'}] Control ${i + 1}`).join('\n'),
  showdown: 'true: A true statement',
};

/**
 * Append a fresh block to a bucket's section, creating the ## header when
 * the section doesn't exist yet. Returns the new text and the line index
 * of the inserted block's first line (for focusing).
 * @param {string} text @param {ReturnType<typeof parseDoc>} parsed
 * @param {'deck'|'control'|'showdown'} bucket
 * @param {'choice'|'range'|'sort'} [kind] deck template flavour
 * @returns {{text: string, line: number}}
 */
export function insertTemplate(text, parsed, bucket, kind = 'choice') {
  const lines = text.split('\n');
  const sectionBlocks = parsed.blocks.filter((b) => b.bucket === bucket);

  /** @type {number} insertion point (line index to splice at) */
  let at;
  /** @type {string[]} */
  let prefix = [];
  if (sectionBlocks.length) {
    at = sectionBlocks[sectionBlocks.length - 1].endLine + 1;
  } else if (bucket === 'deck') {
    // after front matter, before any ## section
    const firstSection = parsed.lines.findIndex((l) => l.kind === 'section');
    at = firstSection >= 0 ? firstSection : lines.length;
  } else {
    const sectionAt = (/** @type {RegExp} */ re) =>
      parsed.lines.findIndex((l, i) => l.kind === 'section' && re.test(lines[i].trim()));
    const existing = sectionAt(bucket === 'control' ? /^##\s*control/i : /^##\s*showdown/i);
    if (existing >= 0) {
      // The section header exists but holds no blocks yet: insert right
      // after it, skipping blanks and section-level directives.
      at = existing + 1;
      while (at < lines.length && (!lines[at].trim() || parsed.lines[at]?.kind === 'directive')) at++;
    } else {
      // A new Control Room section must come BEFORE an existing Showdown
      // section; a new Showdown section goes at the very end.
      const sd = bucket === 'control' ? sectionAt(/^##\s*showdown/i) : -1;
      at = sd >= 0 ? sd : lines.length;
      const header = bucket === 'control' ? '## Control Room' : '## Showdown';
      prefix = (lines[at - 1] ?? '').trim() ? ['', header, ''] : [header, ''];
    }
  }

  const body = (bucket === 'deck' ? TEMPLATES.deck[kind] : TEMPLATES[bucket]).split('\n');
  if (!prefix.length && (lines[at - 1] ?? '').trim()) prefix = [''];
  lines.splice(at, 0, ...prefix, ...body, '');
  return { text: lines.join('\n'), line: at + prefix.length };
}

/**
 * Replace just the LABEL of a line while preserving its structure: the ✓ on
 * an answer, the # (or a legacy #sort tag) on a head, the [on]/[off] and
 * "(starts on)" on
 * a toggle, the true:/false: prefix on a statement, the "= N (…)" tail on a
 * number control, the item list after a bucket name — or one ITEM inside a
 * bucket line when itemIx is given. Used by the shorter-phrasings picker.
 * @param {string} text @param {ReturnType<typeof parseDoc>} parsed
 * @param {number} lineIx @param {string} newLabel @param {number} [itemIx]
 */
export function setLabel(text, parsed, lineIx, newLabel, itemIx) {
  const lines = text.split('\n');
  const t = (lines[lineIx] ?? '').trim();
  const kind = parsed.lines[lineIx]?.kind;
  const label = newLabel.trim();

  if (kind === 'head') {
    const tag = HEAD_TAG_RE.exec(t);
    lines[lineIx] = tag ? `#${tag[1].toLowerCase()} ${label}` : `# ${label}`;
  } else if (kind === 'answer') {
    lines[lineIx] = CHECK_RE.test(t) ? `✓ ${label}` : label;
  } else if (kind === 'statement') {
    const st = STATEMENT_RE.exec(t);
    lines[lineIx] = st ? `${st[1].toLowerCase()}: ${label}` : label;
  } else if (kind === 'toggle') {
    const tg = TOGGLE_RE.exec(t);
    const startsOn = STARTS_ON_RE.test(t);
    const prefix = tg ? `[${tg[1].toLowerCase()}] ` : '';
    lines[lineIx] = `${prefix}${label}${startsOn ? ' (starts on)' : ''}`;
  } else if (kind === 'number') {
    lines[lineIx] = t.replace(/^.+?(\s*=)/, `${label}$1`);
  } else if (kind === 'bucket') {
    const arrow = BUCKET_ARROW_RE.exec(t);
    const bm = arrow ?? BUCKET_RE.exec(t);
    const sep = arrow ? ' → ' : ': ';
    if (bm) {
      const items = bm[2].split(',').map((s) => s.trim()).filter(Boolean);
      if (itemIx === undefined) {
        lines[lineIx] = `${label}${sep}${items.join(', ')}`;
      } else if (itemIx >= 0 && itemIx < items.length) {
        items[itemIx] = label;
        lines[lineIx] = `${bm[1].trim()}${sep}${items.join(', ')}`;
      }
    }
  } else {
    return text; // not a labelled line — leave the doc untouched
  }
  return lines.join('\n');
}

/**
 * Move a block to another block's position within the SAME bucket — the
 * gutter's drag-to-reorder. Dragging up inserts before the target; dragging
 * down inserts after it, so the dragged block always lands where the target
 * sat. Cross-bucket moves are refused (the sections have different syntax).
 * Returns the new text plus the moved block's new head line (for focusing).
 * @param {string} text @param {ReturnType<typeof parseDoc>} parsed
 * @param {number} fromIx @param {number} toIx block indexes
 * @returns {{text: string, line: number}}
 */
export function moveBlock(text, parsed, fromIx, toIx) {
  const a = parsed.blocks[fromIx];
  const b = parsed.blocks[toIx];
  if (!a || !b || a === b || a.bucket !== b.bucket) {
    return { text, line: a?.headLine ?? 0 };
  }
  const lines = text.split('\n');
  const span = (/** @type {BlockInfo} */ blk) => {
    let end = blk.endLine;
    if (end + 1 < lines.length && !lines[end + 1].trim()) end++; // its blank separator travels with it
    return end;
  };
  const aEnd = span(a);
  const chunk = lines.splice(a.startLine, aEnd - a.startLine + 1);
  // Multi-line blocks keep a blank between neighbours even when the moved
  // one had none (e.g. it was the last block in the doc).
  if (a.bucket !== 'showdown' && chunk[chunk.length - 1].trim()) chunk.push('');
  const removed = aEnd - a.startLine + 1;
  let at;
  if (fromIx < toIx) {
    // Moving DOWN: the target's lines shifted up by the removal.
    let tEnd = b.endLine - removed;
    if (tEnd + 1 < lines.length && !lines[tEnd + 1].trim()) tEnd++;
    at = tEnd + 1;
  } else {
    at = b.startLine;
  }
  lines.splice(at, 0, ...chunk);
  return { text: lines.join('\n'), line: at + (a.headLine - a.startLine) };
}

/**
 * Remove a block (and the blank line that followed it, if doubling up).
 * @param {string} text @param {import('./pack-text.js').BlockInfo} block
 */
export function removeBlock(text, block) {
  const lines = text.split('\n');
  let end = block.endLine;
  if (end + 1 < lines.length && !lines[end + 1].trim()) end++;
  lines.splice(block.startLine, end - block.startLine + 1);
  return lines.join('\n');
}

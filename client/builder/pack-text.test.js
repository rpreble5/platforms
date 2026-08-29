import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePack } from '../../shared/pack-validate.js';
import {
  parseDoc, serializeDoc, extractFrontMatter, toggleCheck, setVerdict, setStartsOn,
  setLineFields, setDirective, setBlockType, setLabel, insertTemplate, removeBlock, moveBlock,
} from './pack-text.js';

/** A pack exercising every type, matching what the Studio exports. */
const FULL_PACK = {
  pack: 'Round trip',
  theme: 'sorbet',
  answerMs: 15000,
  order: 'suggested',
  questions: [
    { text: 'Which planet has the most moons?', answers: ['Jupiter', 'Saturn', 'Uranus'], correct: 1 },
    { text: 'Select every gas giant', answers: ['Jupiter', 'Mars', 'Saturn'], correct: [0, 2] },
    { type: 'range', text: 'Normal resting heart rate?', min: 0, max: 160, answer: [60, 100], unit: 'bpm' },
    { type: 'sort', text: 'Sort each animal by class', buckets: ['Mammal', 'Bird'], itemMs: 8000,
      items: [{ label: 'Bat', bucket: 0 }, { label: 'Penguin', bucket: 1 }, { label: 'Dolphin', bucket: 0 }] },
    { text: 'How many sides?', image: 'shape.png', answers: ['Five', 'Six'], correct: 1 },
  ],
  controlRoom: {
    perTeam: 2, answerMs: 50000,
    questions: [{
      text: 'Set the vent', context: 'The room is yours',
      controls: [
        { label: 'Suction', kind: 'toggle', initial: false, answer: true },
        { label: 'Alarms', kind: 'toggle', initial: true, answer: false },
        { label: 'PEEP', kind: 'number', initial: 0, answer: 8, min: 0, max: 20, step: 2, unit: 'cmH2O' },
        { label: 'Rate', kind: 'number', initial: 12, answer: 16, min: 8, max: 30, step: 1, unit: '' },
        { label: 'Lights', kind: 'toggle', initial: false, answer: true },
        { label: 'Door', kind: 'toggle', initial: false, answer: false },
      ],
    }],
  },
  showdown: {
    answerMs: 7000,
    statements: [
      { text: 'An octopus has three hearts', answer: true },
      { text: 'Sound travels faster in air than water', answer: false },
    ],
  },
};

test('serializeDoc -> parseDoc round-trips every type through validatePack', () => {
  const text = serializeDoc(FULL_PACK);
  const { raw, problems: parseProblems } = parseDoc(text);
  assert.deepEqual(parseProblems, []);

  const fromText = validatePack(structuredClone(raw));
  const fromJson = validatePack(structuredClone(FULL_PACK));
  assert.deepEqual(fromText.problems, []);
  assert.deepEqual(fromJson.problems, []);
  // The doc format groups sort items by bucket, so item ORDER is not part
  // of the round-trip contract (the sim shuffles items at round start
  // anyway) — compare with items canonically sorted.
  const canon = (/** @type {any} */ p) => {
    for (const q of p.questions) {
      if (q.type === 'sort') q.items.sort((/** @type {any} */ a, /** @type {any} */ b) => a.label.localeCompare(b.label));
    }
    return p;
  };
  assert.deepEqual(canon(fromText.pack), canon(fromJson.pack));
});

test('type inference: checks, star alias, range line, sort tag', () => {
  const { raw, blocks, problems } = parseDoc([
    '# Single?',
    'a',
    '✓ b',
    '',
    '# Multi?',
    '* a',
    'b',
    '✓ c',
    '',
    '# How many?',
    'range: 4-6 of 0-10 things',
    '',
    '#sort Sort these',
    'Left: one, two',
    'Right: three',
  ].join('\n'));
  assert.deepEqual(problems, []);
  assert.equal(raw.questions[0].correct, 1);
  assert.deepEqual(raw.questions[1].correct, [0, 2]);
  assert.deepEqual(raw.questions[2], { text: 'How many?', type: 'range', answer: [4, 6], min: 0, max: 10, unit: 'things' });
  assert.deepEqual(raw.questions[3].buckets, ['Left', 'Right']);
  assert.deepEqual(raw.questions[3].items, [
    { label: 'one', bucket: 0 }, { label: 'two', bucket: 0 }, { label: 'three', bucket: 1 },
  ]);
  assert.deepEqual(blocks.map((b) => b.type), ['choice', 'multi', 'range', 'sort']);
  assert.deepEqual(validatePack(raw).problems, []);
});

test('front matter, sections, control parens and showdown verdicts parse', () => {
  const doc = [
    'pack: Night one',        // 1
    'theme: noir',            // 2
    'time: 9s',               // 3
    '',                       // 4
    '# Warmup?',              // 5
    '✓ yes',                  // 6
    'no',                     // 7
    '',                       // 8
    '## Control Room',        // 9
    'turns: 2',               // 10
    'time: 45s',              // 11
    '',                       // 12
    '# The case',             // 13
    'context: go',            // 14
    '[on] A',                 // 15
    '[off] B (starts on)',    // 16
    'PEEP = 8 (0-20, step 2, start 0, cmH2O)', // 17
    'Rate = 16 (8-30)',       // 18
    '[on] C',                 // 19
    '[off] D',                // 20
    '',                       // 21
    '## Showdown',            // 22
    'time: 5s',               // 23
    'true: Yes it is',        // 24
    'false: No it is not',    // 25
  ].join('\n');
  const { raw, lines, problems } = parseDoc(doc);
  assert.deepEqual(problems, []);
  assert.equal(raw.pack, 'Night one');
  assert.equal(raw.theme, 'noir');
  assert.equal(raw.answerMs, 9000);
  assert.equal(raw.controlRoom.perTeam, 2);
  assert.equal(raw.controlRoom.answerMs, 45000);
  const c = raw.controlRoom.questions[0];
  assert.equal(c.context, 'go');
  assert.deepEqual(c.controls[1], { label: 'B', kind: 'toggle', initial: true, answer: false });
  assert.deepEqual(c.controls[2], { label: 'PEEP', kind: 'number', answer: 8, min: 0, max: 20, step: 2, initial: 0, unit: 'cmH2O' });
  const rate = c.controls[3];
  assert.equal(rate.min, 8);
  assert.equal(rate.max, 30);
  assert.equal(rate.initial, 8); // clamped up to min when no start given
  assert.equal(raw.showdown.answerMs, 5000);
  assert.deepEqual(raw.showdown.statements.map((/** @type {any} */ s) => s.answer), [true, false]);
  // line roles the gutter hangs on (0-based)
  assert.equal(lines[5].kind, 'answer');
  assert.equal(lines[5].checked, true);
  assert.equal(lines[14].kind, 'toggle');
  assert.equal(lines[14].verdict, true);
  assert.equal(lines[15].startsOn, true);
  assert.equal(lines[16].kind, 'number');
  assert.equal(lines[23].kind, 'statement');
  assert.deepEqual(validatePack(raw).problems, []);
});

test('extractFrontMatter absorbs the meta block and strips it from the doc', () => {
  const { meta, text } = extractFrontMatter('pack: A\ntheme: noir\ntime: 9s\norder: suggested\n\n# Q?\n✓ a\nb');
  assert.deepEqual(meta, { pack: 'A', theme: 'noir', answerMs: 9000, order: 'suggested' });
  assert.equal(text, '# Q?\n✓ a\nb');

  // no front matter: nothing absorbed, doc untouched (leading blanks aside)
  const plain = extractFrontMatter('# Q?\na\nb');
  assert.deepEqual(plain.meta, {});
  assert.equal(plain.text, '# Q?\na\nb');

  // a stray non-meta first line stops the scan without eating anything
  const stray = extractFrontMatter('hello\npack: A');
  assert.deepEqual(stray.meta, {});
  assert.equal(stray.text, 'hello\npack: A');
});

test('parseDoc with frontMatter:false flags typed meta lines instead of absorbing', () => {
  const { raw, problems } = parseDoc('theme: noir\n\n# Q?\n✓ a\nb', { frontMatter: false });
  assert.equal(raw.theme, 'blanc'); // the default — the typed line was NOT absorbed
  assert.ok(problems.some((p) => p.line === 1 && /Pack panel/.test(p.msg)));
});

test('unmarked verdicts and stray lines produce 1-based line problems', () => {
  const doc = [
    '# Pick one',   // 1
    'a',            // 2
    'b',            // 3 (no check anywhere -> problem at head, line 1)
    '',             // 4
    'floating',     // 5 -> belongs to no question? no — inside block (blank lines do not end blocks)
    '',             // 6
    '## Showdown',  // 7
    'No verdict',   // 8 -> problem
  ].join('\n');
  const { problems } = parseDoc(doc);
  assert.ok(problems.some((p) => p.line === 1 && /check/.test(p.msg)));
  assert.ok(problems.some((p) => p.line === 8 && /TRUE or FALSE/.test(p.msg)));

  const stray = parseDoc('pack: x\n\nwhat is this');
  assert.ok(stray.problems.some((p) => p.line === 3));
});

test('text surgery: checks, verdicts, starts-on, structured lines', () => {
  assert.equal(toggleCheck('# Q?\na\nb', 1), '# Q?\n✓ a\nb');
  assert.equal(toggleCheck('# Q?\n✓ a\nb', 1), '# Q?\na\nb');
  assert.equal(toggleCheck('# Q?\n* a\nb', 1), '# Q?\na\nb');

  assert.equal(setVerdict('Statement here', 0, 'statement', true), 'true: Statement here');
  assert.equal(setVerdict('false: Statement here', 0, 'statement', true), 'true: Statement here');
  assert.equal(setVerdict('Suction ready', 0, 'toggle', true), '[on] Suction ready');
  assert.equal(setVerdict('[on] Suction ready', 0, 'toggle', false), '[off] Suction ready');

  assert.equal(setStartsOn('[off] B', 0, true), '[off] B (starts on)');
  assert.equal(setStartsOn('[off] B (starts on)', 0, false), '[off] B');

  assert.equal(
    setLineFields('range: 1-2 of 0-9', 0, 'range', { lo: 60, hi: 100, min: 0, max: 160, unit: 'bpm' }),
    'range: 60-100 of 0-160 bpm'
  );
  assert.equal(
    setLineFields('x', 0, 'number', { label: 'PEEP', answer: 8, min: 0, max: 20, step: 2, initial: 0, unit: 'cmH2O' }),
    'PEEP = 8 (0-20, step 2, cmH2O)'
  );
  // round-trips through the parser
  const p = parseDoc('## Control Room\n# c\nPEEP = 8 (0-20, step 2, cmH2O)\n[on] A\n[on] B\n[on] C\n[on] D\n[on] E');
  assert.deepEqual(p.raw.controlRoom.questions[0].controls[0], {
    label: 'PEEP', kind: 'number', answer: 8, min: 0, max: 20, step: 2, initial: 0, unit: 'cmH2O',
  });
});

test('setDirective edits front matter and blocks', () => {
  const doc = 'pack: A\ntheme: blanc\n\n# Q?\n✓ a\nb';
  assert.match(setDirective(doc, null, 'theme', 'noir'), /theme: noir/);
  assert.match(setDirective(doc, null, 'order', 'suggested').split('\n')[2], /order: suggested/);

  const { blocks } = parseDoc(doc);
  const withImg = setDirective(doc, blocks[0], 'img', 'ekg.png');
  assert.equal(withImg.split('\n')[4], 'img: ekg.png');
  const { blocks: b2 } = parseDoc(withImg);
  assert.equal(b2[0].img, 'ekg.png');
  const removed = setDirective(withImg, b2[0], 'img', null);
  assert.equal(removed, doc);
});

test('setBlockType re-templates the body but keeps text and image', () => {
  const doc = '# The question?\nimg: pic.png\n✓ a\nb';
  const { blocks } = parseDoc(doc);
  const asRange = setBlockType(doc, blocks[0], 'range');
  assert.equal(asRange, '# The question?\nimg: pic.png\nrange: 40-60 of 0-100');
  const asSort = setBlockType(doc, blocks[0], 'sort');
  assert.match(asSort, /^#sort The question\?/);
  const backToChoice = setBlockType(asRange, parseDoc(asRange).blocks[0], 'choice');
  assert.equal(backToChoice, '# The question?\nimg: pic.png\n✓ Answer 1\nAnswer 2\nAnswer 3');
});

test('insertTemplate appends to sections, creating headers in order', () => {
  const base = 'pack: A\n\n# Q?\n✓ a\nb\n';
  const deck = insertTemplate(base, parseDoc(base), 'deck');
  assert.match(deck.text.split('\n')[deck.line], /^# New question\?/);
  assert.ok(parseDoc(deck.text).raw.questions.length === 2);

  const show = insertTemplate(base, parseDoc(base), 'showdown');
  assert.match(show.text, /## Showdown\n\ntrue: A true statement/);

  // a new Control Room lands BEFORE the existing Showdown section
  const ctrl = insertTemplate(show.text, parseDoc(show.text), 'control');
  const ci = ctrl.text.indexOf('## Control Room');
  assert.ok(ci >= 0 && ci < ctrl.text.indexOf('## Showdown'));
  const parsed = parseDoc(ctrl.text);
  assert.equal(parsed.raw.controlRoom.questions.length, 1);
  assert.equal(parsed.raw.showdown.statements.length, 1);
  assert.match(ctrl.text.split('\n')[ctrl.line], /^# New case/);
});

test('setLabel swaps just the label, preserving line structure', () => {
  const doc = [
    '#sort Sort each bug by stain',   // 0 head with tag
    'Gram positive: Staph aureus, Listeria', // 1 bucket
    '',                               // 2
    '# Which nerve?',                 // 3 head
    '✓ Spinal accessory',             // 4 checked answer
    'Vagus',                          // 5 plain answer
    '',                               // 6
    '## Control Room',                // 7
    '# Case',                         // 8
    '[off] Alarms muted (starts on)', // 9 toggle
    'NS bolus = 1 (0-3, L)',          // 10 number
    '## Showdown',                    // 11
    'true: An octopus has three hearts', // 12 statement
  ].join('\n');
  const p = () => parseDoc(doc);
  const line = (/** @type {string} */ s, /** @type {number} */ i) => s.split('\n')[i];

  assert.equal(line(setLabel(doc, p(), 1, 'Gram +'), 1), 'Gram +: Staph aureus, Listeria');
  assert.equal(line(setLabel(doc, p(), 1, 'Staph', 0), 1), 'Gram positive: Staph, Listeria');
  assert.equal(line(setLabel(doc, p(), 0, 'Sort by stain'), 0), '#sort Sort by stain');
  assert.equal(line(setLabel(doc, p(), 4, 'CN XI'), 4), '✓ CN XI');
  assert.equal(line(setLabel(doc, p(), 5, 'CN X'), 5), 'CN X');
  assert.equal(line(setLabel(doc, p(), 9, 'Alarms off'), 9), '[off] Alarms off (starts on)');
  assert.equal(line(setLabel(doc, p(), 10, 'NS (L)'), 10), 'NS (L) = 1 (0-3, L)');
  assert.equal(line(setLabel(doc, p(), 12, 'Octopus: 3 hearts'), 12), 'true: Octopus: 3 hearts');
  // a non-label line is left alone
  assert.equal(setLabel(doc, p(), 2, 'nope'), doc);
});

test('insertTemplate deck kinds: range and sort bodies', () => {
  const base = '# Q?\n✓ a\nb\n';
  const range = insertTemplate(base, parseDoc(base), 'deck', 'range');
  const rp = parseDoc(range.text);
  assert.equal(rp.raw.questions[1].type, 'range');
  assert.match(range.text.split('\n')[range.line], /^# New range question\?/);

  const sort = insertTemplate(base, parseDoc(base), 'deck', 'sort');
  const sp = parseDoc(sort.text);
  assert.equal(sp.raw.questions[1].type, 'sort');
  assert.deepEqual(sp.raw.questions[1].buckets, ['Bucket A', 'Bucket B']);
});

test('moveBlock reorders within a bucket and refuses cross-bucket moves', () => {
  const doc = [
    '# One?',          // block 0
    '✓ a',
    'b',
    '',
    '# Two?',          // block 1
    'range: 4-6 of 0-10',
    '',
    '# Three?',        // block 2
    '✓ c',
    'd',
    '',
    '## Showdown',
    'true: First statement',   // block 3
    'false: Second statement', // block 4
  ].join('\n');
  const p = () => parseDoc(doc);

  // drag Three up onto One: it takes One's position
  const up = moveBlock(doc, p(), 2, 0);
  const upQ = parseDoc(up.text).raw.questions.map((/** @type {any} */ q) => q.text);
  assert.deepEqual(upQ, ['Three?', 'One?', 'Two?']);
  assert.equal(up.text.split('\n')[up.line], '# Three?');
  assert.equal(parseDoc(up.text).problems.length, 0);
  // the range line and checks travelled intact
  assert.deepEqual(parseDoc(up.text).raw.questions[2], { text: 'Two?', type: 'range', answer: [4, 6], min: 0, max: 10 });

  // drag One down onto Two: it lands after Two
  const down = moveBlock(doc, p(), 0, 1);
  assert.deepEqual(parseDoc(down.text).raw.questions.map((/** @type {any} */ q) => q.text), ['Two?', 'One?', 'Three?']);
  assert.equal(parseDoc(down.text).problems.length, 0);

  // showdown statements reorder too, without gaining blank lines
  const st = moveBlock(doc, p(), 4, 3);
  assert.deepEqual(parseDoc(st.text).raw.showdown.statements.map((/** @type {any} */ s) => s.text),
    ['Second statement', 'First statement']);
  assert.equal(st.text.split('\n').length, doc.split('\n').length);

  // cross-bucket: refused, text unchanged
  assert.equal(moveBlock(doc, p(), 3, 0).text, doc);
  assert.equal(moveBlock(doc, p(), 0, 0).text, doc);
});

test('moveBlock: last block (no trailing blank) moves up cleanly', () => {
  const doc = '# One?\n✓ a\nb\n\n# Two?\n✓ c\nd';
  const moved = moveBlock(doc, parseDoc(doc), 1, 0);
  const q = parseDoc(moved.text).raw.questions.map((/** @type {any} */ x) => x.text);
  assert.deepEqual(q, ['Two?', 'One?']);
  assert.equal(parseDoc(moved.text).problems.length, 0);
});

test('removeBlock deletes the block and its trailing blank', () => {
  const doc = '# One?\n✓ a\nb\n\n# Two?\n✓ c\nd';
  const { blocks } = parseDoc(doc);
  assert.equal(removeBlock(doc, blocks[0]), '# Two?\n✓ c\nd');
  assert.equal(removeBlock(doc, blocks[1]), '# One?\n✓ a\nb\n');
});

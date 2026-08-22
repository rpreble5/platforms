import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { listPacks, loadQuestions } from './http.js';

/** @returns {string} */
function rootWithPack() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'control-pack-'));
  fs.mkdirSync(path.join(root, 'questions'));
  fs.writeFileSync(path.join(root, 'questions', 'test.json'), JSON.stringify({
    pack: 'Control test',
    questions: [{ text: 'plain', answers: ['a', 'b'], correct: 0 }],
    controlRoom: {
      perTeam: 1,
      answerMs: 42000,
      questions: [{
        text: 'case',
        context: 'details',
        controls: [
          { label: 'A', kind: 'toggle', initial: false, answer: true },
          { label: 'B', kind: 'toggle', initial: false, answer: false },
          { label: 'C', kind: 'toggle', initial: true, answer: true },
          { label: 'D', kind: 'toggle', initial: false, answer: false },
          { label: 'E', kind: 'toggle', initial: false, answer: true },
          { label: 'Dose', kind: 'number', initial: 0, answer: 2, min: 0, max: 4, step: 1, unit: 'mg' },
        ],
      }],
    },
  }));
  return root;
}

test('question loading preserves a valid Control Room pool', () => {
  const root = rootWithPack();
  const pack = loadQuestions(root, 'test.json');
  assert.equal(pack.controlRoom?.perTeam, 1);
  assert.equal(pack.controlRoom?.answerMs, 42000);
  assert.equal(pack.controlRoom?.questions.length, 1);
  assert.equal(pack.controlRoom?.questions[0].type, 'control');
  assert.equal(pack.controlRoom?.questions[0].answerMs, 42000);
  assert.equal(pack.controlRoom?.questions[0].controls[5].answer, 2);
});

test('pack metadata advertises standalone Control Room content', () => {
  const [pack] = listPacks(rootWithPack());
  assert.equal(pack.controlRoom, 1);
});

/** @param {any} mutate applied to the base pack before writing */
function rootWithMutatedPack(/** @type {(pack: any) => void} */ mutate) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'control-pack-'));
  fs.mkdirSync(path.join(root, 'questions'));
  const pack = {
    pack: 'Control test',
    questions: [{ text: 'plain', answers: ['a', 'b'], correct: 0 }],
    controlRoom: {
      perTeam: 1,
      answerMs: 42000,
      questions: [{
        text: 'case',
        context: 'details',
        controls: [
          { label: 'A', kind: 'toggle', initial: false, answer: true },
          { label: 'B', kind: 'toggle', initial: false, answer: false },
          { label: 'C', kind: 'toggle', initial: true, answer: true },
          { label: 'D', kind: 'toggle', initial: false, answer: false },
          { label: 'E', kind: 'toggle', initial: false, answer: true },
          { label: 'Dose', kind: 'number', initial: 0, answer: 2, min: 0, max: 4, step: 1, unit: 'mg' },
        ],
      }],
    },
  };
  mutate(pack);
  fs.writeFileSync(path.join(root, 'questions', 'test.json'), JSON.stringify(pack));
  return root;
}

test('a numeric answer unreachable from initial via step is rejected, not left unscoreable', () => {
  const root = rootWithMutatedPack((/** @type {any} */ pack) => {
    // {0,5,10,15,20} can never equal 12 — the item could never score.
    pack.controlRoom.questions[0].controls[5] =
      { label: 'Dose', kind: 'number', initial: 0, answer: 12, min: 0, max: 20, step: 5, unit: 'mg' };
  });
  const pack = loadQuestions(root, 'test.json');
  // The case is skipped (with a console warning naming the reason), so the
  // whole block is ignored rather than shipping an unwinnable item.
  assert.equal(pack.controlRoom, null);
});

test('fractional steps still validate reachable answers (12.5mg dosing)', () => {
  const root = rootWithMutatedPack((/** @type {any} */ pack) => {
    pack.controlRoom.questions[0].controls[5] =
      { label: 'Dose', kind: 'number', initial: 12.5, answer: 37.5, min: 0, max: 50, step: 12.5, unit: 'mg' };
  });
  const pack = loadQuestions(root, 'test.json');
  assert.equal(pack.controlRoom?.questions.length, 1, 'two steps up from 12.5 is fine');
});

test('a per-question control answerMs is clamped like the block-level one', () => {
  const root = rootWithMutatedPack((/** @type {any} */ pack) => {
    pack.controlRoom.questions[0].answerMs = 500; // an unplayable half second
  });
  const pack = loadQuestions(root, 'test.json');
  assert.equal(pack.controlRoom?.questions[0].answerMs, 10000, 'clamped up to the 10s floor');
});

// ------------------------------------------------------------- lightning sort

/** @param {any} q @returns {string} a temp root whose pack holds just q */
function rootWithSortQuestion(q) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sort-pack-'));
  fs.mkdirSync(path.join(root, 'questions'));
  fs.writeFileSync(
    path.join(root, 'questions', 'test.json'),
    JSON.stringify({ pack: 'Sort test', questions: [q] })
  );
  return root;
}

const SORT_Q = {
  type: 'sort',
  text: 'Sort the animals',
  buckets: ['Mammal', 'Bird', 'Reptile'],
  items: [
    { label: 'Bat', bucket: 0 },
    { label: 'Penguin', bucket: 1 },
    { label: 'Gecko', bucket: 2 },
  ],
  itemMs: 5000,
};

test('a valid sort question loads, with buckets mirrored into answers', () => {
  const pack = loadQuestions(rootWithSortQuestion(SORT_Q), 'test.json');
  assert.equal(pack.questions.length, 1);
  const q = pack.questions[0];
  assert.equal(q.type, 'sort');
  assert.deepEqual(q.answers, q.buckets);
  assert.equal(q.itemMs, 5000);
});

test('sort itemMs is clamped to the 3-15s band, defaulting to 6s', () => {
  const fast = loadQuestions(rootWithSortQuestion({ ...SORT_Q, itemMs: 500 }), 'test.json');
  assert.equal(fast.questions[0].itemMs, 3000);
  const slow = loadQuestions(rootWithSortQuestion({ ...SORT_Q, itemMs: 60000 }), 'test.json');
  assert.equal(slow.questions[0].itemMs, 15000);
  const unset = loadQuestions(rootWithSortQuestion({ ...SORT_Q, itemMs: undefined }), 'test.json');
  assert.equal(unset.questions[0].itemMs, 6000);
});

test('a sort item pointing at a bucket that does not exist skips the question', () => {
  const bad = { ...SORT_Q, items: [...SORT_Q.items, { label: 'Ghost', bucket: 7 }] };
  const pack = loadQuestions(rootWithSortQuestion(bad), 'test.json');
  assert.equal(pack.questions.length, 0);
});

test('sort bucket and item counts are enforced', () => {
  const oneBucket = loadQuestions(
    rootWithSortQuestion({ ...SORT_Q, buckets: ['Only'] }),
    'test.json'
  );
  assert.equal(oneBucket.questions.length, 0);
  const oneItem = loadQuestions(
    rootWithSortQuestion({ ...SORT_Q, items: [{ label: 'Bat', bucket: 0 }] }),
    'test.json'
  );
  assert.equal(oneItem.questions.length, 0);
});

// ---------------------------------------------------------- question images

/** @param {any} q @param {boolean} withFile @returns {string} */
function rootWithImageQuestion(q, withFile) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'img-pack-'));
  fs.mkdirSync(path.join(root, 'questions'));
  if (withFile) {
    fs.mkdirSync(path.join(root, 'questions', 'images'));
    fs.writeFileSync(path.join(root, 'questions', 'images', 'ekg.png'), 'png');
  }
  fs.writeFileSync(
    path.join(root, 'questions', 'test.json'),
    JSON.stringify({ pack: 'Image test', questions: [q] })
  );
  return root;
}

const IMG_Q = { text: 'What rhythm is this?', image: 'ekg.png', answers: ['AF', 'VT'], correct: 1 };

test('an image question keeps its image and is forced onto the row layout', () => {
  const pack = loadQuestions(rootWithImageQuestion({ ...IMG_Q, layout: 'islands' }, true), 'test.json');
  assert.equal(pack.questions[0].image, 'ekg.png');
  assert.equal(pack.questions[0].layout, 'row', 'tall layouts would collide with the picture');
});

test('a traversal-shaped image name is dropped, never resolved', () => {
  const bad = { ...IMG_Q, image: '../test.json' };
  const pack = loadQuestions(rootWithImageQuestion(bad, true), 'test.json');
  assert.equal(pack.questions.length, 1, 'the question still plays');
  assert.equal(pack.questions[0].image, undefined, 'without the image');
});

test('a missing image file is dropped with a note, question kept', () => {
  const pack = loadQuestions(rootWithImageQuestion(IMG_Q, false), 'test.json');
  assert.equal(pack.questions.length, 1);
  assert.equal(pack.questions[0].image, undefined);
});

// ------------------------------------------------- bucket boundaries + order

/** @param {any[]} questions @param {any} [extra] top-level pack extras */
function rootWithDeck(questions, extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bucket-pack-'));
  fs.mkdirSync(path.join(root, 'questions'));
  fs.writeFileSync(
    path.join(root, 'questions', 'test.json'),
    JSON.stringify({ pack: 'Buckets', questions, ...extra })
  );
  return root;
}

test('mode-specific content is turned away from the standard deck by name', () => {
  const pack = loadQuestions(rootWithDeck([
    { text: 'plain', answers: ['a', 'b'], correct: 0 },
    { type: 'control', text: 'case', controls: [] },          // controlRoom bucket
    { text: 'An octopus has three hearts', answer: true },    // showdown bucket
  ]), 'test.json');
  assert.equal(pack.questions.length, 1, 'only the standard question survives');
  assert.equal(pack.questions[0].text, 'plain');
});

test('pictures are stripped from control cases and showdown statements', () => {
  const packRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bucket-pack-'));
  fs.mkdirSync(path.join(packRoot, 'questions'));
  fs.writeFileSync(path.join(packRoot, 'questions', 'test.json'), JSON.stringify({
    pack: 'Buckets',
    questions: [{ text: 'plain', answers: ['a', 'b'], correct: 0 }],
    controlRoom: { perTeam: 1, questions: [{
      text: 'case', image: 'x.png',
      controls: Array.from({ length: 6 }, (_, i) => ({ label: `c${i}`, kind: 'toggle', initial: false, answer: true })),
    }] },
    showdown: { statements: [{ text: 'true thing', answer: true, image: 'y.png' }] },
  }));
  const pack = loadQuestions(packRoot, 'test.json');
  assert.equal(pack.controlRoom?.questions[0].image, undefined);
  assert.equal(pack.showdown?.statements[0].image, undefined);
});

test('order "suggested" arranges the house program, stable within groups', () => {
  const deck = [
    { type: 'sort', text: 's1', buckets: ['A', 'B'], items: [{ label: 'x', bucket: 0 }, { label: 'y', bucket: 1 }] },
    { text: 'multi', answers: ['a', 'b', 'c'], correct: [0, 1] },
    { text: 'warm1', answers: ['a', 'b'], correct: 0 },
    { type: 'range', text: 'r1', min: 0, max: 10, answer: [2, 4] },
    { text: 'warm2', answers: ['a', 'b'], correct: 1 },
  ];
  const pack = loadQuestions(rootWithDeck(deck, { order: 'suggested' }), 'test.json');
  assert.deepEqual(
    pack.questions.map((/** @type {any} */ q) => q.text),
    ['warm1', 'warm2', 'r1', 'multi', 's1'],
    'singles, then ranges, then select-alls, sorts last — authored order inside each group'
  );
});

test('an unknown order value plays as authored', () => {
  const deck = [
    { type: 'range', text: 'r1', min: 0, max: 10, answer: [2, 4] },
    { text: 'warm', answers: ['a', 'b'], correct: 0 },
  ];
  const pack = loadQuestions(rootWithDeck(deck, { order: 'shuffled' }), 'test.json');
  assert.deepEqual(pack.questions.map((/** @type {any} */ q) => q.text), ['r1', 'warm']);
});

/**
 * The shared pack rulebook. Depth of coverage lives in server/questions.test.js
 * (through loadQuestions, which delegates here); these tests pin the part
 * that file can't: this module works WITHOUT node — no fs, no path — so the
 * Pack Studio can import it in a browser.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { LIMITS, PACK_THEMES, suggestOrder, validatePack } from './pack-validate.js';

test('LIMITS match what validatePack actually enforces', () => {
  const q = (/** @type {any} */ over) => validatePack({ questions: [over] }).problems;
  const long = (/** @type {number} */ n) => 'x'.repeat(n);
  // exactly at the limit: silent; one over: flagged
  assert.equal(q({ text: long(LIMITS.questionChars), answers: ['a', 'b'], correct: 0 }).length, 0);
  assert.equal(q({ text: long(LIMITS.questionChars + 1), answers: ['a', 'b'], correct: 0 }).length, 1);
  assert.equal(q({ text: 'ok?', answers: [long(LIMITS.answerChars + 1), 'b'], correct: 0 }).length, 1);
  assert.equal(
    validatePack({ questions: [], showdown: { statements: [{ text: long(LIMITS.statementChars + 1), answer: true }] } }).problems.length,
    1
  );
  // count ranges are the hard ones
  assert.ok(q({ text: 'ok?', answers: Array(LIMITS.answers[1] + 1).fill('a'), correct: 0 }).some((m) => m.includes('must be 2-6')));
});

test('validatePack is pure shape-checking: same rules as the server, no fs', () => {
  const { pack, problems } = validatePack({
    pack: 'Faculty draft',
    theme: 'sorbet',
    order: 'suggested',
    questions: [
      { type: 'sort', text: 's', buckets: ['A', 'B'], items: [{ label: 'x', bucket: 0 }, { label: 'y', bucket: 1 }] },
      { text: 'warm', answers: ['a', 'b'], correct: 0 },
      { type: 'control', text: 'stray case', controls: [] },
    ],
  });
  assert.equal(pack.theme, 'sorbet');
  assert.deepEqual(pack.questions.map((q) => q.text), ['warm', 's'], 'suggested order, stray control rejected');
  assert.ok(problems.some((m) => m.includes('controlRoom')), 'bucket rejection is named');
  assert.equal(pack.questions[1].itemMs, 6000, 'sort defaults applied');
});

test('image shape check needs no filesystem — traversal dies on shape alone', () => {
  const { pack, problems } = validatePack({
    questions: [{ text: 't', image: '../secrets.json', answers: ['a', 'b'], correct: 0 }],
  });
  assert.equal(pack.questions[0].image, undefined);
  assert.ok(problems.some((m) => m.includes('plain png/jpg/webp/svg filename')));
});

test('the theme whitelist and the ordering helper are exported for the builder', () => {
  assert.ok(PACK_THEMES.includes('blanc'));
  const arranged = suggestOrder([
    { type: 'range', text: 'r', min: 0, max: 1, answer: [0, 1] },
    { text: 'c', answers: ['a', 'b'], correct: 0 },
  ]);
  assert.equal(arranged[0].text, 'c');
});

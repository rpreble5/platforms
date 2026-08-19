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

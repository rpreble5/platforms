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

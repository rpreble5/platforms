import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTROL_LAB_LABEL_MAX_CHARS,
  CONTROL_LAB_SCENARIOS,
  getControlLabScenario,
} from './control-lab-scenarios.js';

test('clinical control-lab scenarios fit the eight-control board', () => {
  for (const [key, scenario] of Object.entries(CONTROL_LAB_SCENARIOS)) {
    assert.equal(scenario.controls.length, 8, `${key} should fill the board`);
    for (const control of scenario.controls) {
      assert.ok(control.label.length <= CONTROL_LAB_LABEL_MAX_CHARS, `${control.label} is too long`);
      assert.ok(control.kind === 'toggle' || control.kind === 'number');
      if (control.kind === 'number') {
        assert.equal(typeof control.target, 'number');
        assert.equal(typeof control.min, 'number');
        assert.equal(typeof control.max, 'number');
        assert.equal(typeof control.step, 'number');
        assert.ok(Number(control.target) >= Number(control.min) && Number(control.target) <= Number(control.max));
        assert.equal((Number(control.target) - Number(control.min)) % Number(control.step), 0);
      } else {
        assert.equal(typeof control.target, 'boolean');
      }
    }
  }
});

test('unknown scenario names fall back to neutropenia', () => {
  assert.equal(getControlLabScenario('unknown'), CONTROL_LAB_SCENARIOS.neutropenia);
});

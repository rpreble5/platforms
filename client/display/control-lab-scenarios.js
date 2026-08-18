export const CONTROL_LAB_LABEL_MAX_CHARS = 18;

/**
 * @typedef {object} ControlLabControl
 * @property {string} label
 * @property {'toggle'|'number'} kind
 * @property {boolean|number} initial
 * @property {boolean|number} target
 * @property {number} [min]
 * @property {number} [max]
 * @property {number} [step]
 * @property {string} [unit]
 */

/**
 * @typedef {object} ControlLabScenario
 * @property {string} title
 * @property {string} context
 * @property {readonly ControlLabControl[]} controls
 */

/**
 * Medical copy stays separate from the physics fixtures so scenarios can
 * change without coupling clinical content to collision geometry.
 */
export const CONTROL_LAB_SCENARIOS = Object.freeze(/** @type {Record<string, ControlLabScenario>} */ ({
  neutropenia: Object.freeze({
    title: 'AML induction - ANC 40 - Day 5 fever on cefepime',
    context: 'Cx NGTD - HDS - no focal sx - no mold ppx',
    controls: Object.freeze([
      { label: 'CT chest', kind: 'toggle', initial: false, target: true },
      { label: 'Aspergillus Ag', kind: 'toggle', initial: false, target: true },
      { label: 'Caspofungin', kind: 'toggle', initial: false, target: true },
      { label: 'Cont. cefepime', kind: 'toggle', initial: false, target: true },
      { label: 'Vanc', kind: 'toggle', initial: false, target: false },
      { label: 'CVC removal', kind: 'toggle', initial: false, target: false },
      { label: 'G-CSF', kind: 'toggle', initial: false, target: false },
      { label: 'RVP', kind: 'toggle', initial: false, target: false },
    ]),
  }),
  hyponatremia: Object.freeze({
    title: 'AUD + malnutrition - chronic hypoNa - Na 108 to 119 in 10h',
    context: 'Seizure resolved after 3% - brisk UOP',
    controls: Object.freeze([
      { label: 'Cont. hypersaline', kind: 'toggle', initial: true, target: false },
      { label: 'DDAVP', kind: 'number', initial: 0, target: 2, min: 0, max: 4, step: 1, unit: 'mcg' },
      { label: 'D5W', kind: 'number', initial: 0, target: 10, min: 0, max: 20, step: 5, unit: 'mL/kg' },
      { label: 'Fluid restriction', kind: 'toggle', initial: false, target: false },
      { label: 'Tolvaptan', kind: 'toggle', initial: false, target: false },
      { label: 'NS', kind: 'toggle', initial: false, target: false },
      { label: 'Lasix', kind: 'toggle', initial: false, target: false },
      { label: 'Na checks', kind: 'number', initial: 6, target: 2, min: 1, max: 8, step: 1, unit: 'hr' },
    ]),
  }),
}));

/** @param {string} key */
export function getControlLabScenario(key) {
  return CONTROL_LAB_SCENARIOS[key] ?? CONTROL_LAB_SCENARIOS.neutropenia;
}

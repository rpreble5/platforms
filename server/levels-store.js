/**
 * The level library on disk: levels/<slug>.json, one designed level per file.
 *
 * Written by the /levels editor's Save button and read at display boot, so
 * the design loop is: drag, Save, restart the round. The files are plain
 * JSON and live in git — designed levels are content, like question packs.
 *
 * Everything that crosses this boundary goes through sanitizeLevelSpec from
 * sim/levels.js: the save body is untrusted network input, and the files are
 * hand-editable, so both directions clamp instead of trusting.
 */

import fs from 'node:fs';
import path from 'node:path';

import { sanitizeLevelSpec } from '../sim/levels.js';

/** @typedef {import('../sim/levels.js').LevelSpec} LevelSpec */

/**
 * A level's filename, from its display name. Distinct names that collapse to
 * the same slug overwrite each other — acceptable for a library curated by
 * one person, and it makes "Save" idempotent for the same level.
 * @param {string} name
 * @returns {string} e.g. "Twin Spires!" -> "twin-spires"
 */
export function levelSlug(name) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'level'
  );
}

/**
 * Every valid level in levels/, sorted by name so the round machine's
 * rotation order is stable. Corrupt files are skipped, never fatal.
 * @param {string} root
 * @returns {LevelSpec[]}
 */
export function listLevels(root) {
  const dir = path.join(root, 'levels');
  /** @type {string[]} */
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return []; // no levels/ directory yet — an empty library, not an error
  }
  /** @type {LevelSpec[]} */
  const specs = [];
  for (const f of files.sort()) {
    try {
      const spec = sanitizeLevelSpec(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
      if (spec) specs.push(spec);
    } catch {
      // skip — a broken file costs one level, not the library
    }
  }
  specs.sort((a, b) => a.name.localeCompare(b.name));
  return specs;
}

/**
 * Validate and write one level. Returns the saved spec (as clamped) or null
 * if the body wasn't a level. The filename comes from levelSlug, never from
 * the client, so a hostile name can't traverse out of levels/.
 * @param {string} root
 * @param {unknown} body parsed JSON from the save request
 * @returns {{spec: LevelSpec, slug: string} | null}
 */
export function saveLevel(root, body) {
  const spec = sanitizeLevelSpec(body);
  if (!spec) return null;
  const dir = path.join(root, 'levels');
  fs.mkdirSync(dir, { recursive: true });
  const slug = levelSlug(spec.name);
  fs.writeFileSync(path.join(dir, `${slug}.json`), `${JSON.stringify(spec, null, 2)}\n`);
  return { spec, slug };
}

/**
 * Delete a level by name. The name is matched against the actual library —
 * same pattern as the pack loader — so only files listLevels can see are
 * deletable.
 * @param {string} root
 * @param {string} name
 * @returns {boolean} true if something was deleted
 */
export function deleteLevel(root, name) {
  const dir = path.join(root, 'levels');
  /** @type {string[]} */
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return false;
  }
  for (const f of files) {
    try {
      const spec = sanitizeLevelSpec(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
      if (spec?.name === name) {
        fs.unlinkSync(path.join(dir, f));
        return true;
      }
    } catch {
      // unreadable file can't be the named level
    }
  }
  return false;
}

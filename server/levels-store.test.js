/**
 * The level library on disk: save/list/delete round trips, and the two ways
 * it must not break — corrupt files, and names that would love to become
 * paths.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { deleteLevel, levelSlug, listLevels, saveLevel } from './levels-store.js';

const LEVEL = {
  name: 'Twin Spires',
  boards: [[500, 3, 300], [1400, 3, 300]],
  rungs: [[960, 1, 400]],
};

/** @returns {string} a fresh fake repo root */
function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'levels-'));
}

test('slug: filename-safe, never empty, never a path', () => {
  assert.equal(levelSlug('Twin Spires!'), 'twin-spires');
  assert.equal(levelSlug('../../etc/passwd'), 'etc-passwd');
  assert.equal(levelSlug('///'), 'level');
  assert.equal(levelSlug('ünïcödé'), 'n-c-d');
});

test('save → list → delete round trip', () => {
  const root = tmpRoot();
  assert.deepEqual(listLevels(root), [], 'no levels/ directory is an empty library');

  const saved = saveLevel(root, LEVEL);
  assert.ok(saved);
  assert.equal(saved.slug, 'twin-spires');
  assert.ok(fs.existsSync(path.join(root, 'levels', 'twin-spires.json')));

  const listed = listLevels(root);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].name, 'Twin Spires');
  assert.deepEqual(listed[0].boards, LEVEL.boards);

  // Same name saves over itself — Save is idempotent, not a duplicator.
  saveLevel(root, { ...LEVEL, rungs: [] });
  assert.equal(listLevels(root).length, 1);
  assert.deepEqual(listLevels(root)[0].rungs, []);

  assert.equal(deleteLevel(root, 'Twin Spires'), true);
  assert.deepEqual(listLevels(root), []);
  assert.equal(deleteLevel(root, 'Twin Spires'), false, 'gone is gone');
});

test('garbage never becomes a file, and never breaks the listing', () => {
  const root = tmpRoot();
  assert.equal(saveLevel(root, null), null);
  assert.equal(saveLevel(root, { name: '', boards: LEVEL.boards }), null);
  assert.equal(saveLevel(root, { name: 'one board', boards: [[500, 3, 300]] }), null);
  assert.ok(!fs.existsSync(path.join(root, 'levels')), 'rejected saves create nothing');

  // A corrupt file costs one level, not the library.
  saveLevel(root, LEVEL);
  fs.writeFileSync(path.join(root, 'levels', 'broken.json'), '{nope');
  fs.writeFileSync(path.join(root, 'levels', 'not-a-level.json'), '{"name":"x"}');
  const listed = listLevels(root);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].name, 'Twin Spires');
});

test('a hostile name cannot leave levels/', () => {
  const root = tmpRoot();
  const saved = saveLevel(root, { ...LEVEL, name: '../escape' });
  assert.ok(saved);
  assert.equal(saved.slug, 'escape');
  assert.ok(fs.existsSync(path.join(root, 'levels', 'escape.json')));
  assert.ok(!fs.existsSync(path.join(root, '..', 'escape.json')));
});

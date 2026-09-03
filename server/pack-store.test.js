import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { commitToGitHub, packRev, packSlug, publishPack } from './pack-store.js';

const deck = (name = 'Cardiology review') => ({
  pack: name, theme: 'blanc', answerMs: 12000, mode: 'solo',
  questions: [{ text: 'Q?', answers: ['a', 'b'], correct: 0 }],
});

function tmpRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'packs-'));
  fs.mkdirSync(path.join(root, 'questions'));
  return root;
}

test('slug mirrors the download filename and never traverses', () => {
  assert.equal(packSlug('Cardiology review!'), 'cardiology-review');
  assert.equal(packSlug('../../etc/passwd'), 'etc-passwd');
  assert.equal(packSlug('   '), 'deck');
});

test('publish writes the deck with attribution and returns its rev', () => {
  const root = tmpRoot();
  const r = publishPack(root, { pack: deck(), by: '  Dr. Ada  ' });
  assert.equal(r.file, 'cardiology-review.json');
  assert.equal(r.created, true);
  const j = JSON.parse(fs.readFileSync(path.join(root, 'questions', r.file), 'utf8'));
  assert.equal(j.pack, 'Cardiology review');
  assert.equal(j.published.by, 'Dr. Ada');
  assert.ok(Date.parse(j.published.at) > 0);
  assert.equal(r.rev, packRev(fs.readFileSync(path.join(root, 'questions', r.file), 'utf8')));
});

test('a stale rev is refused; the right rev or force goes through', () => {
  const root = tmpRoot();
  const first = publishPack(root, { pack: deck() });
  // somebody else moved the file on
  fs.writeFileSync(path.join(root, 'questions', first.file), JSON.stringify(deck()) + '\n// edited\n');
  assert.throws(
    () => publishPack(root, { pack: deck(), file: first.file, baseRev: first.rev }),
    (/** @type {any} */ e) => e.code === 'CONFLICT' && typeof e.current === 'string'
  );
  assert.throws(() => publishPack(root, { pack: deck() }), (/** @type {any} */ e) => e.code === 'CONFLICT', 'no rev at all is stale too');
  const current = packRev(fs.readFileSync(path.join(root, 'questions', first.file), 'utf8'));
  const ok = publishPack(root, { pack: deck(), file: first.file, baseRev: current });
  assert.equal(ok.created, false);
  const forced = publishPack(root, { pack: deck(), file: first.file, force: true });
  assert.notEqual(forced.rev, '');
});

test('renaming a deck keeps its file when it was opened from one', () => {
  const root = tmpRoot();
  const first = publishPack(root, { pack: deck('Old name') });
  const renamed = publishPack(root, { pack: deck('New name'), file: first.file, baseRev: first.rev });
  assert.equal(renamed.file, 'old-name.json');
  assert.equal(fs.readdirSync(path.join(root, 'questions')).length, 1);
  const j = JSON.parse(fs.readFileSync(path.join(root, 'questions', renamed.file), 'utf8'));
  assert.equal(j.pack, 'New name');
});

test('a nameless or question-less body is rejected', () => {
  const root = tmpRoot();
  assert.throws(() => publishPack(root, { pack: { pack: '', questions: [] } }), (/** @type {any} */ e) => e.code === 'BAD_PACK');
  assert.throws(() => publishPack(root, { pack: { pack: 'x' } }), (/** @type {any} */ e) => e.code === 'BAD_PACK');
  assert.throws(() => publishPack(root, /** @type {any} */ ({})), (/** @type {any} */ e) => e.code === 'BAD_PACK');
});

test('the GitHub commit reads the sha first and sends it back on update', async () => {
  /** @type {any[]} */
  const calls = [];
  const fetchImpl = /** @type {any} */ (async (/** @type {string} */ url, /** @type {any} */ init) => {
    calls.push({ url, init });
    if (!init?.method) return { status: 200, ok: true, json: async () => ({ sha: 'abc123' }) };
    return { status: 200, ok: true, json: async () => ({ content: { sha: 'def456' }, commit: { html_url: 'https://x/commit/1' } }) };
  });
  const r = await commitToGitHub({ token: 't', repo: 'o/r', branch: 'main', file: 'a b.json', content: '{}\n', message: 'm', fetchImpl });
  assert.equal(r.sha, 'def456');
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /contents\/questions\/a%20b\.json\?ref=main$/);
  const body = JSON.parse(calls[1].init.body);
  assert.equal(body.sha, 'abc123');
  assert.equal(body.branch, 'main');
  assert.equal(Buffer.from(body.content, 'base64').toString(), '{}\n');
  assert.equal(calls[1].init.headers.Authorization, 'Bearer t');
});

test('a new file commits without a sha, and failures surface', async () => {
  const fetchImpl = /** @type {any} */ (async (/** @type {string} */ url, /** @type {any} */ init) => {
    if (!init?.method) return { status: 404, ok: false, json: async () => ({}) };
    const body = JSON.parse(init.body);
    assert.equal(body.sha, undefined);
    return { status: 201, ok: true, json: async () => ({ content: { sha: 'new' }, commit: {} }) };
  });
  const r = await commitToGitHub({ token: 't', repo: 'o/r', branch: 'b', file: 'x.json', content: '1', message: 'm', fetchImpl });
  assert.equal(r.sha, 'new');
  const failing = /** @type {any} */ (async () => ({ status: 500, ok: false, json: async () => ({}) }));
  await assert.rejects(
    commitToGitHub({ token: 't', repo: 'o/r', branch: 'b', file: 'x.json', content: '1', message: 'm', fetchImpl: failing }),
    /GitHub read failed \(500\)/
  );
});

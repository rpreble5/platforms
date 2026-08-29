/**
 * AI drafting: the prompt carries the real limits, the endpoint guards its
 * money, and a drafted document flows through the same validation as
 * anything typed. No real API calls — ANTHROPIC_BASE_URL points at a local
 * mock that returns a canned document and captures what was sent.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';

import { buildSuggestPrompt, buildSystemPrompt, NOTES_CAP } from './ai-draft.js';
import { LIMITS, validatePack } from '../shared/pack-validate.js';
import { parseDoc } from '../client/builder/pack-text.js';

test('the prompt teaches a document the editor actually parses', () => {
  // The example the model is told to copy, run through the real parser and
  // the real validator. If the document format changes and the prompt is
  // not updated, this fails instead of the drafts silently going stale.
  const p = buildSystemPrompt();
  const example = p.slice(
    p.indexOf('nothing else):') + 'nothing else):'.length,
    p.indexOf('RULES:')
  ).trim();

  const { raw, blocks, problems } = parseDoc(example, { frontMatter: false });
  assert.deepEqual(problems, [], 'the prompt example parses without complaint');
  assert.deepEqual(blocks.map((b) => b.type), ['choice', 'range', 'sort']);
  assert.deepEqual(validatePack(raw).problems, []);

  // …and it teaches the current syntax, not the retired kind
  assert.match(example, /Mammal → Bat/);
  assert.doesNotMatch(example, /type:|#sort|## /);
  // one ✓ per question: the example must not model a select-all, which is
  // teams-only and forbidden in the free-for-all decks New creates
  for (const q of raw.questions) assert.ok(!Array.isArray(q.correct));
});

test('the system prompt quotes the enforced limits and the output contract', () => {
  const p = buildSystemPrompt();
  // Only the limits the drafter can actually breach: it writes deck
  // questions, never control labels or showdown statements.
  for (const n of [LIMITS.questionChars, LIMITS.answerChars, LIMITS.sortLabelChars]) {
    assert.ok(p.includes(`${n}`), `prompt mentions limit ${n}`);
  }
  // …and it must not be told limits for syntax it is forbidden to write.
  assert.doesNotMatch(p, /control label|statement ≤/);
  assert.match(p, /ONLY the document text/i);
  assert.match(p, /Never guess an answer key/i);
  assert.match(p, /## Control Room/);
  assert.match(p, /BREVITY: the ceilings are not targets/);
  // the format the editor actually reads today
  assert.match(p, /Bucket → item/);
  assert.doesNotMatch(p, /type: sort/);
  assert.match(p, /never write 'type:', 'level:', 'img:' or 'layout:' lines/);
  assert.match(p, /TEAMS-ONLY/);
  assert.ok(p.includes(`~${Math.round(LIMITS.questionChars * 2 / 3)}`), 'brevity target derived from LIMITS');
  // the suggestions prompt: JSON contract, opt-out allowed
  const sp = buildSuggestPrompt();
  assert.match(sp, /ONLY a JSON array/);
  assert.match(sp, /OMIT items/);
});

const CANNED_DOC = [
  '# Which was invented first?',
  '✓ The stethoscope',
  'The hypodermic syringe',
  '',
  '# Max daily acetaminophen for a healthy adult?',
  'range: 3-4 of 0-10 g',
  '',
  '## Showdown',
  '',
  'true: An octopus has three hearts',
].join('\n');

/** A fake Anthropic API: one route, canned reply, captured request. */
function mockAnthropic() {
  /** @type {any[]} */
  const seen = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const sent = JSON.parse(body);
      seen.push(sent);
      const isSuggest = /SHORTER phrasings/.test(sent.system?.[0]?.text ?? '');
      const text = isSuggest
        ? JSON.stringify([
            { id: 'b1', options: ['Gram pos', 'Gram +'] },
            { id: 'nope', options: ['x'] },              // unknown id -> dropped
            { id: 'a4', options: ['A phrase far longer than the original text ever was'] }, // longer -> dropped
          ])
        : '```\n' + CANNED_DOC + '\n```';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 'msg_mock', type: 'message', role: 'assistant', model: 'claude-sonnet-5',
        content: [{ type: 'text', text }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 1200, output_tokens: 300 },
      }));
    });
  });
  return { srv, seen };
}

/** Boot the real game server with a given env; resolve when it serves. */
async function bootServer(/** @type {number} */ port, /** @type {Record<string,string>} */ env) {
  const child = spawn('node', ['server/index.js'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, PORT: String(port), ...env },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://localhost:${port}/api/health`);
      if (r.ok) return child;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill();
  throw new Error('server did not boot');
}

/** @param {number} port @param {any} body @param {string} [code] */
function post(port, body, code) {
  return fetch(`http://localhost:${port}/api/ai-draft`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(code ? { 'x-ai-passcode': code } : {}) },
    body: JSON.stringify(body),
  });
}

test('endpoint: off without a key, passcode-gated, and drafts flow through validation', async () => {
  const { srv, seen } = mockAnthropic();
  srv.listen(0);
  await once(srv, 'listening');
  const mockUrl = `http://localhost:${/** @type {any} */ (srv.address()).port}`;

  // (a) no key -> 503 with a setup hint
  const bare = await bootServer(8271, { ANTHROPIC_API_KEY: '', AI_PASSCODE: '' });
  try {
    const r = await post(8271, { mode: 'draft', notes: 'x' });
    assert.equal(r.status, 503);
    assert.match((await r.json()).error, /ANTHROPIC_API_KEY/);
  } finally {
    bare.kill();
  }

  // (b+c+d) key + passcode + mock API
  const child = await bootServer(8272, {
    ANTHROPIC_API_KEY: 'test-key',
    ANTHROPIC_BASE_URL: mockUrl,
    AI_PASSCODE: 'ward6',
  });
  try {
    const noCode = await post(8272, { mode: 'draft', notes: 'stethoscope first; apap max 4g' });
    assert.equal(noCode.status, 401);

    const ok = await post(8272, { mode: 'draft', notes: 'stethoscope first; apap max 4g', instructions: 'two questions' }, 'ward6');
    assert.equal(ok.status, 200);
    const out = await ok.json();
    assert.equal(out.usage.output_tokens, 300);
    // fences stripped, and the doc survives the REAL pipeline
    assert.ok(!out.doc.includes('```'));
    const { raw, problems } = parseDoc(out.doc);
    assert.deepEqual(problems, []);
    assert.deepEqual(validatePack(raw).problems, []);
    assert.equal(raw.questions.length, 2);
    assert.equal(raw.showdown.statements.length, 1);
    // the request carried the cached system prompt and the notes
    const sent = seen.at(-1);
    assert.equal(sent.system[0].cache_control.type, 'ephemeral');
    assert.match(sent.messages[0].content, /AUTHOR INSTRUCTIONS: two questions/);
    assert.match(sent.messages[0].content, /apap max 4g/);

    // (d) suggest mode: options filtered to known ids, shorter, within limits
    const sug = await post(8272, { mode: 'suggest', items: [
      { id: 'b1', kind: 'bucket', text: 'Gram positive', limit: 24 },
      { id: 'a4', kind: 'answer', text: 'Spironolactone', limit: 28 },
    ] }, 'ward6');
    assert.equal(sug.status, 200);
    const sugOut = await sug.json();
    assert.deepEqual(sugOut.suggestions, [{ id: 'b1', options: ['Gram pos', 'Gram +'] }]);
    const sentSuggest = seen.at(-1);
    assert.match(sentSuggest.system[0].text, /SHORTER phrasings/);
    assert.match(sentSuggest.messages[0].content, /Gram positive/);

    // guards: empty notes and oversized notes are 400s
    assert.equal((await post(8272, { mode: 'draft', notes: '' }, 'ward6')).status, 400);
    assert.equal((await post(8272, { mode: 'draft', notes: 'x'.repeat(NOTES_CAP + 1) }, 'ward6')).status, 400);
  } finally {
    child.kill();
    srv.close();
  }
});

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

import { buildSystemPrompt, NOTES_CAP } from './ai-draft.js';
import { LIMITS, validatePack } from '../shared/pack-validate.js';
import { parseDoc } from '../client/builder/pack-text.js';

test('the system prompt quotes the enforced limits and the output contract', () => {
  const p = buildSystemPrompt();
  for (const n of [
    LIMITS.questionChars, LIMITS.answerChars, LIMITS.sortLabelChars,
    LIMITS.controlLabelChars, LIMITS.statementChars,
  ]) {
    assert.ok(p.includes(`${n}`), `prompt mentions limit ${n}`);
  }
  assert.match(p, /ONLY the document text/i);
  assert.match(p, /Never guess an answer key/i);
  assert.match(p, /## Control Room/);
  assert.match(p, /BREVITY: the ceilings are not targets/);
  assert.ok(p.includes(`~${Math.round(LIMITS.questionChars * 2 / 3)}`), 'brevity target derived from LIMITS');
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
      seen.push(JSON.parse(body));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 'msg_mock', type: 'message', role: 'assistant', model: 'claude-sonnet-5',
        content: [{ type: 'text', text: '```\n' + CANNED_DOC + '\n```' }],
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

    // (d) tighten mode sends the doc + warnings
    const tight = await post(8272, { mode: 'tighten', doc: CANNED_DOC, problems: ['Q1: answer "x" is 30 chars (>28 shrinks small)'] }, 'ward6');
    assert.equal(tight.status, 200);
    const sentTighten = seen.at(-1);
    assert.match(sentTighten.messages[0].content, /Rewrite ONLY the flagged/);
    assert.match(sentTighten.messages[0].content, /30 chars/);
    assert.match(sentTighten.messages[0].content, /octopus/);

    // guards: empty notes and oversized notes are 400s
    assert.equal((await post(8272, { mode: 'draft', notes: '' }, 'ward6')).status, 400);
    assert.equal((await post(8272, { mode: 'draft', notes: 'x'.repeat(NOTES_CAP + 1) }, 'ward6')).status, 400);
  } finally {
    child.kill();
    srv.close();
  }
});

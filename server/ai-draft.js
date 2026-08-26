/**
 * AI drafting for the Pack Studio: faculty notes in, the Studio's document
 * format out. The model's ONLY job is formatting-with-judgement — the
 * Studio's existing pipeline (pack-text parse → shared validatePack →
 * problems panel → real-engine preview) reviews everything it writes, and
 * the human clicks the answer keys.
 *
 * Two modes share one endpoint and one system prompt:
 * - draft:   rough notes (+ optional instructions) → a fresh document
 * - tighten: the current document + the Studio's own length warnings →
 *            the same document with ONLY the flagged lines shortened
 *
 * The system prompt is stable and sent with cache_control, so repeat
 * drafts hit the prompt cache. The uncertainty rule is the load-bearing
 * safety property: when the notes don't say which answer is correct, the
 * model leaves every answer unchecked and the Studio flags the question —
 * uncertainty becomes a visible task, never a silent guess.
 */

import { LIMITS } from '../shared/pack-validate.js';

/**
 * The SDK is loaded lazily, on the first draft — NOT at boot. AI drafting
 * is optional, and an optional feature must never stop the game server
 * from starting (e.g. after a git pull without npm install).
 * @returns {Promise<any>}
 */
async function getAnthropic() {
  try {
    return (await import('@anthropic-ai/sdk')).default;
  } catch {
    throw Object.assign(
      new Error('the @anthropic-ai/sdk package is not installed — run `npm install` on the server'),
      { code: 'SDK_MISSING' }
    );
  }
}

export const NOTES_CAP = 50 * 1024;
export const INSTRUCTIONS_CAP = 5 * 1024;
export const DRAFTS_PER_IP_PER_DAY = 30;

/** The document format + house rules, quoted from the SAME module the
 *  loader enforces them with. Stable text — keep it that way for caching. */
export function buildSystemPrompt() {
  return `You format quiz content for PLATFORMS, a game where answers are platforms in an arena and players jump to the one they believe. You convert faculty notes into the game's pack document format, exactly as specified below. You are a drafter: the faculty member reviews and approves everything.

THE DOCUMENT FORMAT (output exactly this shape, nothing else):

# Which planet has the most moons?
Jupiter
✓ Saturn
Uranus

# Select every gas giant
✓ Jupiter
Mars
✓ Saturn

# Normal resting heart rate?
range: 60-100 of 0-160 bpm

#sort Sort each animal by class
Mammal: Bat, Dolphin
Bird: Penguin

## Control Room

# DKA, hour one — set the first orders
context: Glucose 480 - pH 7.12 - K 3.1
[on] Replete K first
[off] Insulin drip now
NS bolus = 1 (0-3, L)

## Showdown

true: An octopus has three hearts
false: Cracking knuckles causes arthritis

RULES:
- '# ' starts a standard question; '#sort ' starts a lightning sort.
- Choice: ${LIMITS.answers[0]}-${LIMITS.answers[1]} answers, one per line. '✓ ' before an answer marks it correct. Two or more checks make a select-all (needs at least one unchecked wrong answer).
- Range: 'range: LO-HI of MIN-MAX [unit]' — the answer band inside the number line. Use for numeric facts and estimates.
- Sort: ${LIMITS.buckets[0]}-${LIMITS.buckets[1]} 'Bucket: item, item' lines, ${LIMITS.items[0]}-${LIMITS.items[1]} items total. Use for categorization.
- '## Control Room' opens the teams-only bucket: each case is '# title', optional 'context: ...', then ${LIMITS.controls[0]}-${LIMITS.controls[1]} controls — '[on] Label' / '[off] Label' toggles (the verdict is the correct setting) or 'Label = ANSWER (MIN-MAX[, step N][, unit])' numbers. Use for scenario management, e.g. first-hour orders. Write at least 3 cases if you write any (one per team).
- '## Showdown' opens the finale: one 'true: ...' or 'false: ...' statement per line. Use for myths and quick facts.
- TEXT LIMITS (hard ceilings — text over these shrinks on the projector): question ≤ ${LIMITS.questionChars} chars, answer ≤ ${LIMITS.answerChars}, sort bucket/item ≤ ${LIMITS.sortLabelChars}, control label ≤ ${LIMITS.controlLabelChars}, statement ≤ ${LIMITS.statementChars}.
- BREVITY: the ceilings are not targets. This text is read across a room in seconds, so always choose the shortest faithful phrasing — aim for roughly two-thirds of each ceiling (question ~${Math.round(LIMITS.questionChars * 2 / 3)} chars, answer ~${Math.round(LIMITS.answerChars * 2 / 3)}). Cut preamble ("Which of the following…" → "Which…"), prefer common short names over formal ones (drug names without salts, "heart attack question" phrasing only when the notes use it), and never restate the question inside its answers. When the notes are wordy, condensing them IS the job — but never at the cost of clinical meaning.
- THE UNCERTAINTY RULE: mark '✓' (or [on]/[off], true:/false:) ONLY when the notes state or clearly imply the answer. If the notes do not, leave every answer of that question unchecked — the editor flags it for the author. Never guess an answer key.
- Do not invent medical facts that are not in the notes. Distractors (wrong answers) may be invented freely; answer keys may not.
- Choose types with judgement: numeric fact → range; categorization → sort; criteria list → select-all; scenario orders → Control Room case; myth or one-liner → showdown statement; otherwise choice.
- Output ONLY the document text. No markdown fences, no commentary, no headings other than ## Control Room / ## Showdown.`;
}

/** In-memory per-IP daily budget — this endpoint spends real money. */
const spent = new Map();
export function underDailyLimit(/** @type {string} */ ip) {
  const day = new Date().toISOString().slice(0, 10);
  const key = `${day}:${ip}`;
  const n = (spent.get(key) ?? 0) + 1;
  // Old days leak a few map entries until restart; cap the map instead of
  // scheduling cleanup.
  if (spent.size > 5000) spent.clear();
  spent.set(key, n);
  return n <= DRAFTS_PER_IP_PER_DAY;
}

/**
 * Run one drafting call. Throws Anthropic SDK errors upward; the route
 * maps them to HTTP responses.
 * @param {{mode?: string, notes?: string, instructions?: string, doc?: string, problems?: string[]}} body
 * @returns {Promise<{doc: string, usage: {input_tokens: number, output_tokens: number}}>}
 */
export async function draftPack(body) {
  const Anthropic = await getAnthropic();
  const client = new Anthropic();
  const model = process.env.AI_MODEL ?? 'claude-sonnet-5';

  let user;
  if (body.mode === 'tighten') {
    const doc = String(body.doc ?? '');
    if (!doc.trim()) throw new RangeError('tighten needs the current document');
    if (doc.length > NOTES_CAP) throw new RangeError('document too large');
    const problems = (Array.isArray(body.problems) ? body.problems : []).map(String).slice(0, 200);
    user = `Here is a pack document and the editor's length warnings. Rewrite ONLY the flagged over-length text so it fits its limit, preserving meaning and every ✓ / [on] / [off] / true: / false: mark. Change nothing else — not order, not unflagged lines. Return the complete document.

WARNINGS:
${problems.join('\n') || '(none provided — shorten any text over the limits)'}

DOCUMENT:
${doc}`;
  } else {
    const notes = String(body.notes ?? '');
    if (!notes.trim()) throw new RangeError('draft needs notes');
    if (notes.length > NOTES_CAP) throw new RangeError('notes too large');
    const instructions = String(body.instructions ?? '').slice(0, INSTRUCTIONS_CAP);
    user = `${instructions.trim() ? `AUTHOR INSTRUCTIONS: ${instructions.trim()}\n\n` : ''}NOTES:\n${notes}`;
  }

  const response = await client.messages.create({
    model,
    max_tokens: 8000,
    system: [
      { type: 'text', text: buildSystemPrompt(), cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: user }],
  });

  let text = '';
  for (const block of response.content) {
    if (block.type === 'text') text += block.text;
  }
  // Belt and braces: the contract says no fences, but strip them if the
  // model wraps the document anyway.
  text = text.trim().replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim() + '\n';

  return {
    doc: text,
    usage: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    },
  };
}

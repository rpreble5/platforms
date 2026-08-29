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

# Sort each animal by class
type: sort
Mammal: Bat, Dolphin
Bird: Penguin

RULES:
- '# ' starts every question, whatever its type. A lightning sort adds a 'type: sort' line directly under the '# ' line; choice and range are inferred from the body.
- Choice: ${LIMITS.answers[0]}-${LIMITS.answers[1]} answers, one per line. '✓ ' before an answer marks it correct. Two or more checks make a select-all (needs at least one unchecked wrong answer).
- Range: 'range: LO-HI of MIN-MAX [unit]' — the answer band inside the number line. Use for numeric facts and estimates.
- Sort: a 'type: sort' line, then ${LIMITS.buckets[0]}-${LIMITS.buckets[1]} 'Bucket: item, item' lines, ${LIMITS.items[0]}-${LIMITS.items[1]} items total. Use for categorization.
- Write DECK QUESTIONS ONLY. Never emit a '## Control Room' or '## Showdown' section, or any '[on]'/'[off]' control or 'true:'/'false:' statement line — the editor does not author those, and anything you write there is thrown away.
- TEXT LIMITS (hard ceilings — text over these shrinks on the projector): question ≤ ${LIMITS.questionChars} chars, answer ≤ ${LIMITS.answerChars}, sort bucket/item ≤ ${LIMITS.sortLabelChars}, control label ≤ ${LIMITS.controlLabelChars}, statement ≤ ${LIMITS.statementChars}.
- BREVITY: the ceilings are not targets. This text is read across a room in seconds, so always choose the shortest faithful phrasing — aim for roughly two-thirds of each ceiling (question ~${Math.round(LIMITS.questionChars * 2 / 3)} chars, answer ~${Math.round(LIMITS.answerChars * 2 / 3)}). Cut preamble ("Which of the following…" → "Which…"), prefer common short names over formal ones (drug names without salts, "heart attack question" phrasing only when the notes use it), and never restate the question inside its answers. When the notes are wordy, condensing them IS the job — but never at the cost of clinical meaning.
- THE UNCERTAINTY RULE: mark '✓' (or [on]/[off], true:/false:) ONLY when the notes state or clearly imply the answer. If the notes do not, leave every answer of that question unchecked — the editor flags it for the author. Never guess an answer key.
- Do not invent medical facts that are not in the notes. Distractors (wrong answers) may be invented freely; answer keys may not.
- Choose types with judgement: numeric fact → range; categorization → sort; criteria list → select-all; a myth or one-liner works as a two-answer choice ("True" / "False"); otherwise choice.
- Output ONLY the document text. No markdown fences, no commentary, no '##' headings of any kind.`;
}

/** The shorter-phrasings picker: per-item alternatives, never rewrites.
 *  Stable text — cache_control depends on it. */
export function buildSuggestPrompt() {
  return `You suggest SHORTER phrasings for quiz text that is drawn on platforms in a projected game, where short text reads best. The audience is physicians and residents.

You receive a JSON array of items: {"id", "kind", "text", "limit"} — kind is one of question, answer, bucket, item, control, statement; limit is that kind's character ceiling.

For each item where a materially shorter phrasing exists (saving at least ~20% or 4+ characters), reply with 1-3 alternatives, best first. Standard medical abbreviations and symbols are welcome when unambiguous to physicians ("Gram positive" → "Gram pos", "Gram +"). Every alternative must preserve the exact meaning and stay within the item's limit. OMIT items that are already tight — do not pad the list.

Reply with ONLY a JSON array, no fences, no commentary: [{"id": "...", "options": ["...", "..."]}, ...]. An empty array is a valid reply.`;
}

/**
 * mode 'suggest': per-item shorter phrasings for the picker dialog.
 * @param {{items?: any[]}} body
 * @returns {Promise<{suggestions: {id: string, options: string[]}[], usage: {input_tokens: number, output_tokens: number}}>}
 */
export async function suggestShorter(body) {
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) throw new RangeError('suggest needs items');
  if (items.length > 300) throw new RangeError('too many items');
  const clean = items.map((it) => ({
    id: String(it?.id ?? '').slice(0, 40),
    kind: String(it?.kind ?? '').slice(0, 20),
    text: String(it?.text ?? '').slice(0, 200),
    limit: Number(it?.limit) || 0,
  }));
  const byId = new Map(clean.map((it) => [it.id, it]));

  const Anthropic = await getAnthropic();
  const client = new Anthropic();
  const response = await client.messages.create({
    model: process.env.AI_MODEL ?? 'claude-sonnet-5',
    max_tokens: 4000,
    system: [
      { type: 'text', text: buildSuggestPrompt(), cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: JSON.stringify(clean) }],
  });

  let text = '';
  for (const block of response.content) {
    if (block.type === 'text') text += block.text;
  }
  text = text.trim().replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim();
  /** @type {any} */
  let parsed = [];
  try { parsed = JSON.parse(text); } catch { parsed = []; }
  const suggestions = (Array.isArray(parsed) ? parsed : [])
    .filter((s) => byId.has(s?.id) && Array.isArray(s?.options))
    .map((s) => {
      const it = /** @type {any} */ (byId.get(s.id));
      const options = s.options
        .map((/** @type {any} */ o) => String(o).trim())
        .filter((/** @type {string} */ o) =>
          o && o.length < it.text.length && (!it.limit || o.length <= it.limit))
        .slice(0, 3);
      return { id: it.id, options };
    })
    .filter((s) => s.options.length);

  return {
    suggestions,
    usage: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    },
  };
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
 * mode 'draft': faculty notes -> a fresh document. Throws Anthropic SDK
 * errors upward; the route maps them to HTTP responses.
 * @param {{notes?: string, instructions?: string}} body
 * @returns {Promise<{doc: string, usage: {input_tokens: number, output_tokens: number}}>}
 */
export async function draftPack(body) {
  const Anthropic = await getAnthropic();
  const client = new Anthropic();
  const model = process.env.AI_MODEL ?? 'claude-sonnet-5';

  const notes = String(body.notes ?? '');
  if (!notes.trim()) throw new RangeError('draft needs notes');
  if (notes.length > NOTES_CAP) throw new RangeError('notes too large');
  const instructions = String(body.instructions ?? '').slice(0, INSTRUCTIONS_CAP);
  const user = `${instructions.trim() ? `AUTHOR INSTRUCTIONS: ${instructions.trim()}\n\n` : ''}NOTES:\n${notes}`;

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

/**
 * Pack validation — the single source of truth, shared verbatim between the
 * game server (server/http.js loadQuestions) and the zero-install Pack
 * Studio (client/builder). One rulebook, two doors: whatever the builder
 * accepts, the server accepts, and the problem messages are identical.
 *
 * Problems are reported loudly but never stop a pack from loading: refusing
 * to start a party because one answer is 29 characters long would be the
 * wrong trade. Fatal per-item problems skip that item; cosmetic ones are
 * notes.
 *
 * NO IMPORTS, no fs, no DOM — pure shape checking, so it runs in node and
 * in the browser alike. The one filesystem truth (does an image file exist
 * on the host?) stays in server/http.js as a second pass.
 */

/**
 * The numbers the checks below enforce, exported so the training page and
 * the Pack Studio quote the SAME limits the loader applies. Char limits are
 * cosmetic (over-long text still plays, it just shrinks small on screen);
 * the count and timing ranges are hard. Update these together with the
 * corresponding checks in validatePack.
 */
export const LIMITS = {
  questionChars: 90,
  answerChars: 28,
  sortLabelChars: 24, // buckets and items alike
  controlLabelChars: 18,
  statementChars: 110,
  answers: [2, 6],
  buckets: [2, 4],
  items: [2, 12],
  controls: [6, 8],
  controlSeconds: [10, 90],
  sortItemSeconds: [3, 15],
};

/** Every theme a pack may name: the three theme keys plus the glass families. */
export const PACK_THEMES = [
  'terrazzo', 'dusk', 'glass',
  'aurora', 'berry', 'ocean', 'frost', 'cream', 'noir', 'blanc',
  'sorbet', 'lagoon', 'highlighter', 'duotone',
];

/**
 * The house program, for packs that say `"order": "suggested"`: warmup
 * single-choice first, then ranges, then select-alls, then the picture
 * questions, and lightning sorts as the finale. STABLE within each group —
 * the author's relative order survives, only the grouping is imposed.
 * Control turns interleave after this (buildQuestionSchedule), so team
 * intermissions still spread across the arranged program.
 * @param {any[]} questions
 * @returns {any[]}
 */
export function suggestOrder(questions) {
  const group = (/** @type {any} */ q) =>
    q.type === 'sort' ? 4 : q.image ? 3 : Array.isArray(q.correct) ? 2 : q.type === 'range' ? 1 : 0;
  return questions
    .map((q, i) => ({ q, i }))
    .sort((a, b) => group(a.q) - group(b.q) || a.i - b.i)
    .map((e) => e.q);
}

/**
 * Validate one raw pack object into the playable shape.
 *
 * @param {any} raw the parsed pack JSON
 * @returns {{ pack: {
 *   pack: string, answerMs: number, theme: string, questions: any[],
 *   mode?: 'solo'|'teams',
 *   showdown: {statements:any[], answerMs?:number} | null,
 *   controlRoom: {questions:any[], perTeam:number, answerMs:number} | null,
 * }, problems: string[] }}
 */
export function validatePack(raw) {
  /** @type {string[]} */
  const problems = [];

  /**
   * The optional question image: a plain filename (the host keeps the file
   * in questions/images). Shape-checked here; existence is the server's
   * business.
   * @param {any} q @param {string} where
   */
  const vetImage = (q, where) => {
    if (q.image === undefined) return;
    if (
      typeof q.image !== 'string' ||
      /[\\/]/.test(q.image) ||
      !/\.(png|jpe?g|webp|svg)$/i.test(q.image)
    ) {
      problems.push(`${where}: image must be a plain png/jpg/webp/svg filename — ignored`);
      delete q.image;
    }
  };

  const questions = (raw.questions ?? []).filter((/** @type {any} */ q, /** @type {number} */ i) => {
    const where = `Q${i + 1}`;

    // Bucket boundaries are hard: the standard deck plays in free-for-all
    // AND teams, so content belonging to a mode-specific bucket is turned
    // away by name — not mangled by the choice validator's error messages.
    if (q?.type === 'control' || Array.isArray(q?.controls)) {
      problems.push(`${where}: control questions live in the "controlRoom" block (teams only) — skipped`);
      return false;
    }
    if (typeof q?.answer === 'boolean' && q?.answers === undefined) {
      problems.push(`${where}: true/false statements live in the "showdown" block — skipped`);
      return false;
    }

    if (q && typeof q === 'object') vetImage(q, where);

    if (q?.type === 'range') {
      if (typeof q.text !== 'string') {
        problems.push(`${where}: missing text — skipped`);
        return false;
      }
      if (!Number.isFinite(q.min) || !Number.isFinite(q.max) || q.min >= q.max) {
        problems.push(`${where}: range needs numeric min < max — skipped`);
        return false;
      }
      const [lo, hi] = Array.isArray(q.answer) ? q.answer : [];
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo > hi) {
        problems.push(`${where}: "answer" must be [low, high] with low <= high — skipped`);
        return false;
      }
      if (lo < q.min || hi > q.max) {
        problems.push(`${where}: answer [${lo}, ${hi}] falls outside the ${q.min}-${q.max} line — skipped`);
        return false;
      }
      if (q.text.length > LIMITS.questionChars) problems.push(`${where}: question is ${q.text.length} chars (>90 is hard to read across a room)`);
      return true;
    }

    // Lightning sort: category buckets plus a rapid-fire item list. Must
    // branch before the choice fallback, or an unknown-typed question would
    // be validated (and silently played) as multiple choice.
    if (q?.type === 'sort') {
      if (typeof q.text !== 'string') {
        problems.push(`${where}: missing text — skipped`);
        return false;
      }
      if (
        !Array.isArray(q.buckets) ||
        q.buckets.length < 2 ||
        q.buckets.length > 4 ||
        !q.buckets.every((/** @type {any} */ b) => typeof b === 'string')
      ) {
        problems.push(`${where}: sort needs 2-4 string buckets — skipped`);
        return false;
      }
      const items = Array.isArray(q.items) ? q.items : [];
      const itemsOk = items.every(
        (/** @type {any} */ it) =>
          typeof it?.label === 'string' &&
          Number.isInteger(it?.bucket) &&
          it.bucket >= 0 &&
          it.bucket < q.buckets.length
      );
      if (items.length < 2 || items.length > 12 || !itemsOk) {
        problems.push(`${where}: sort needs 2-12 items, each {label, bucket in range} — skipped`);
        return false;
      }
      // Items get seconds, not the question's twelve: clamp like the
      // control rounds do.
      q.itemMs = Number.isFinite(q.itemMs)
        ? Math.max(3000, Math.min(15000, Math.round(q.itemMs)))
        : 6000;
      // Buckets double as the platform sign labels, so every existing
      // answers[] drawing path works untouched.
      q.answers = q.buckets.slice();
      for (const b of q.buckets) {
        if (b.length > LIMITS.sortLabelChars) problems.push(`${where}: bucket "${b}" is ${b.length} chars (>24 shrinks small)`);
      }
      for (const it of items) {
        if (it.label.length > LIMITS.sortLabelChars) problems.push(`${where}: item "${it.label}" is ${it.label.length} chars (>24 shrinks small)`);
      }
      return true;
    }

    if (typeof q?.text !== 'string' || !Array.isArray(q?.answers)) {
      problems.push(`${where}: missing text or answers — skipped`);
      return false;
    }
    if (q.answers.length < 2 || q.answers.length > 6) {
      problems.push(`${where}: ${q.answers.length} answers, must be 2-6 — skipped`);
      return false;
    }
    if (
      q.layout !== undefined &&
      !['row', 'islands', 'pyramid', 'reverse-pyramid'].includes(q.layout)
    ) {
      problems.push(`${where}: unknown layout "${q.layout}" — using islands`);
      delete q.layout;
    }
    // A picture needs the airspace: tall layouts put boards exactly where
    // the image hangs, so image questions always play on the flat row.
    if (q.image && q.layout !== 'row') {
      if (q.layout !== undefined) problems.push(`${where}: image questions use the row layout — overriding "${q.layout}"`);
      q.layout = 'row';
    }
    // `correct` is one index, or an array for select-all-that-apply: at
    // least two right (else it's a normal question) and at least one wrong
    // (else the round has no stakes).
    if (Array.isArray(q.correct)) {
      const inRange = q.correct.every(
        (/** @type {any} */ c) => Number.isInteger(c) && c >= 0 && c < q.answers.length
      );
      const distinct = new Set(q.correct).size === q.correct.length;
      if (!inRange || !distinct || q.correct.length < 2 || q.correct.length >= q.answers.length) {
        problems.push(`${where}: select-all "correct" needs 2+ distinct in-range indexes and at least one wrong answer — skipped`);
        return false;
      }
    } else if (!Number.isInteger(q.correct) || q.correct < 0 || q.correct >= q.answers.length) {
      problems.push(`${where}: "correct" is out of range — skipped`);
      return false;
    }
    if (q.text.length > LIMITS.questionChars) problems.push(`${where}: question is ${q.text.length} chars (>90 is hard to read across a room)`);
    for (const a of q.answers) {
      if (String(a).length > LIMITS.answerChars) problems.push(`${where}: answer "${a}" is ${String(a).length} chars (>28 shrinks small)`);
    }
    return true;
  });

  // Control Room questions are a separate pool. At game start the display
  // assigns a distinct case to every participating team, then either
  // interleaves those turns or runs the pool as a standalone mode.
  /** @type {{questions:any[], perTeam:number, answerMs:number} | null} */
  let controlRoom = null;
  if (raw.controlRoom) {
    const answerMs = Number.isFinite(raw.controlRoom.answerMs)
      ? Math.max(10000, Math.min(90000, Math.round(raw.controlRoom.answerMs)))
      : 40000;
    const controlQuestions = (Array.isArray(raw.controlRoom.questions) ? raw.controlRoom.questions : [])
      .filter((/** @type {any} */ q, /** @type {number} */ i) => {
        const where = `control #${i + 1}`;
        if (typeof q?.text !== 'string' || !Array.isArray(q.controls)) {
          problems.push(`${where}: needs text and controls — skipped`);
          return false;
        }
        if (q.controls.length < 6 || q.controls.length > 8) {
          problems.push(`${where}: ${q.controls.length} controls, must be 6-8 — skipped`);
          return false;
        }
        for (let c = 0; c < q.controls.length; c++) {
          const control = q.controls[c];
          const at = `${where} control ${c + 1}`;
          if (typeof control?.label !== 'string' || !['toggle', 'number'].includes(control.kind)) {
            problems.push(`${at}: needs a label and toggle/number kind — skipped`);
            return false;
          }
          if (control.label.length > LIMITS.controlLabelChars) problems.push(`${at}: label "${control.label}" is over 18 chars`);
          if (control.kind === 'toggle') {
            if (typeof control.initial !== 'boolean' || typeof control.answer !== 'boolean') {
              problems.push(`${at}: toggle initial/answer must be boolean — skipped`);
              return false;
            }
          } else {
            const values = [control.initial, control.answer, control.min, control.max, control.step];
            if (!values.every(Number.isFinite) || control.min > control.max || control.step <= 0) {
              problems.push(`${at}: invalid numeric range — skipped`);
              return false;
            }
            if (
              control.initial < control.min || control.initial > control.max ||
              control.answer < control.min || control.answer > control.max
            ) {
              problems.push(`${at}: initial/answer outside range — skipped`);
              return false;
            }
            // The box only ever holds initial ± k*step (clamped), so an
            // answer off that lattice can NEVER be dialled in: the item is
            // permanently unscoreable and a perfect board impossible.
            const steps = (control.answer - control.initial) / control.step;
            if (Math.abs(steps - Math.round(steps)) > 1e-9) {
              problems.push(`${at}: answer ${control.answer} is unreachable from ${control.initial} in steps of ${control.step} — skipped`);
              return false;
            }
          }
        }
        if (q.image !== undefined) {
          problems.push(`${where}: pictures are a standard-deck feature — image ignored`);
          delete q.image;
        }
        q.type = 'control';
        // Same clamp as the block-level window: a stray 500ms (or negative)
        // per-question value would end a team's whole turn unplayed.
        q.answerMs = Number.isFinite(q.answerMs)
          ? Math.max(10000, Math.min(90000, Math.round(q.answerMs)))
          : answerMs;
        return true;
      });
    if (controlQuestions.length) {
      controlRoom = {
        questions: controlQuestions,
        perTeam: Math.max(1, Math.min(4, Math.floor(raw.controlRoom.perTeam ?? 1))),
        answerMs,
      };
    } else {
      problems.push('controlRoom: no valid questions — block ignored');
    }
  }

  // The showdown block is optional and separate from the quiz deck — a list
  // of true/false statements for the sudden-death mode.
  /** @type {{statements: any[], answerMs?: number} | null} */
  let showdown = null;
  if (raw.showdown) {
    const statements = (Array.isArray(raw.showdown.statements) ? raw.showdown.statements : [])
      .filter((/** @type {any} */ st, /** @type {number} */ i) => {
        if (typeof st?.text !== 'string' || typeof st?.answer !== 'boolean') {
          problems.push(`showdown #${i + 1}: needs text and a boolean answer — skipped`);
          return false;
        }
        if (st.text.length > LIMITS.statementChars) problems.push(`showdown #${i + 1}: ${st.text.length} chars (>110 is hard to read fast)`);
        if (st.image !== undefined) {
          problems.push(`showdown #${i + 1}: pictures are a standard-deck feature — image ignored`);
          delete st.image;
        }
        return true;
      });
    if (statements.length) {
      showdown = { statements };
      if (Number.isFinite(raw.showdown.answerMs)) showdown.answerMs = raw.showdown.answerMs;
    } else {
      problems.push('showdown: no valid statements — block ignored');
    }
  }

  // How the deck is meant to be played. The host can still switch modes on
  // the display; this is the pack's own answer, so a teams deck arrives set
  // up for teams instead of relying on someone remembering.
  let mode;
  if (raw.mode !== undefined) {
    if (raw.mode === 'solo' || raw.mode === 'teams') mode = raw.mode;
    else problems.push(`mode "${raw.mode}" is unknown — use solo or teams`);
  }

  let theme = 'glass';
  if (raw.theme !== undefined) {
    if (PACK_THEMES.includes(raw.theme)) theme = raw.theme;
    else problems.push(`theme "${raw.theme}" is unknown — using glass`);
  }

  // Deck order: authors either own it ("authored", the default — the deck
  // plays exactly as listed) or opt into the house program with
  // "order": "suggested".
  let deck = questions;
  if (raw.order !== undefined && raw.order !== 'authored') {
    if (raw.order === 'suggested') deck = suggestOrder(questions);
    else problems.push(`order "${raw.order}" is unknown — playing as authored`);
  }

  return {
    pack: {
      pack: raw.pack ?? 'default',
      answerMs: raw.answerMs ?? 12000,
      mode,
      theme,
      questions: deck,
      showdown,
      controlRoom,
    },
    problems,
  };
}

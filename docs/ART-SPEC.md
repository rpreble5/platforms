# Art spec

File formats, dimensions and the constraints the drawing code imposes. Nothing
here says what the art should look like.

Drop finished files in `assets/`, refresh the display. Each one is optional and
has a procedural fallback, so you can do them one at a time — the yellow HUD
note lists whichever are still being drawn in code.

Every source file is authored at **exactly 2× its display size**. Scale factor
is exactly 0.5 in both axes for all three assets: 1 display pixel = 2 source
pixels.

| file | source | display | alpha |
|---|---|---|---|
| `assets/bg.png` | 3840 × 2160 | 1920 × 1080 | not used |
| `assets/platform.png` | 512 × 152 | variable × 76 | required |
| `assets/floor.png` | 512 × 240 | 256 × 120 per tile | not used |

Display coordinates below are in a fixed 1920 × 1080 world space. The whole
canvas is scaled to whatever screen it's on, so these numbers don't change.

---

## `assets/bg.png`

| | |
|---|---|
| source | **3840 × 2160** |
| aspect ratio | exactly **16:9** |
| display | drawn to 1920 × 1080, stretched to fill |
| alpha | not required; the image is fully covered by later draws |

It is stretched, not letterboxed or cropped. Any ratio other than 16:9 will be
distorted to fit.

### What covers it, in display y

| band | source rows | covered by | coverage |
|---|---|---|---|
| 0 – 150 | 0 – 300 | question banner, `rgba(10,8,20,0.9)`, full width | 90% opaque, always |
| 150 – 700 | 300 – 1400 | nothing, most of the time | see panels below |
| 700 – 980 | 1400 – 1960 | answer signs and the crowd | partial, see below |
| 980 – 1080 | 1960 – 2160 | floor tile, full width | 100% opaque, always |

Panels that appear in the 150–700 band:

- Scoreboard, between questions: display x 580 – 1340, y 190 – 766 at ten rows
  (y 190 – 352 at one row). Source: x 1160 – 2680, y 380 – 1532.
- Final standings, at game end: display x 560 – 1360, y 215 – 865. Source:
  x 1120 – 2720, y 430 – 1730.
- Lobby panel, before the first question: display x 70 – 950, y 64 – 250.
  Source: x 140 – 1900, y 128 – 500.

Occupancy of the 700–980 band:

- Answer signs: display y 820 – 896, spanning x 70 – 1850 with two, three or
  four boards and 60px gaps between them.
- Standing avatars: display y 924 – 980, anywhere across the full width.
- Display y 700 – 820 (source 1400 – 1640) is clear except during the fall
  animation, when signs pass down through it.

---

## `assets/platform.png`

| | |
|---|---|
| source | **512 × 152** |
| aspect ratio | exactly **64:19** |
| display height | exactly **76**, always |
| display width | **400**, **553** or **860** — set by the question's answer count |
| alpha | **required** — every pixel that isn't part of the board must be fully transparent |

Display widths, by answer count: 4 answers → 400px, 3 → 553px, 2 → 860px. All
three occur in one game, so the file must work at all three.

### Horizontal slicing

Drawn as a horizontal 3-slice. Three source column ranges, mapped as follows:

| slice | source columns | width | display width |
|---|---|---|---|
| left cap | 0 – 127 | 128 | 64, fixed |
| middle | 128 – 383 | 256 | stretched to fill the remainder |
| right cap | 384 – 511 | 128 | 64, fixed |

The caps are never stretched horizontally — they always draw at exactly 64
display px, i.e. the same 0.5 scale as the vertical axis. The middle absorbs
all width variation:

| display width | middle display width | horizontal stretch of the middle |
|---|---|---|
| 400 | 272 | **2.125×** |
| 553 | 425 | **3.3203×** |
| 860 | 732 | **5.71875×** |

Consequences:

1. In source columns 128 – 383, every column must be identical to its
   neighbours — the middle must be constant along x. Anything that varies
   horizontally there is smeared by up to 5.71875×.
2. Column 127 must match column 128, and column 383 must match column 384,
   pixel for pixel down all 152 rows, or a visible seam appears at the joins.
3. Anything that must keep its exact shape belongs inside the two 128-column
   caps.
4. The left and right caps are not mirrored in code. Both are taken from the
   file as authored.

### Vertical zones

| zone | source rows | height | display rows (of 76) |
|---|---|---|---|
| upper | 0 – 55 | 56 | 0 – 27 |
| lower | 56 – 151 | 96 | 28 – 75 |

Exactly **7:12** upper to lower.

- The upper 56 source rows are the collision surface. A player standing on this
  board rests with their feet on display row 0 of the sprite and their body
  above it; the boundary at source row 56 is where the solid part of the
  platform ends in the physics.
- The lower 96 source rows carry the answer text, drawn at runtime. Text is
  centred horizontally in a box of `width − 40` display px (20px inset each
  side), and vertically on display row 52 of the 76 — source row 104.
- Font size for the text is 22 – 46 display px at weight 800, chosen per answer
  to fit the box. Text colour is `#2b1c0c`.
- When a board is revealed correct or wrong, a 40px icon is drawn at 42 display
  px from the board's left edge, and the text shifts 24 display px right.

### State tinting

Correct and wrong states are applied in code as a `source-atop` fill over the
whole board — `rgba(61,220,154,0.42)` for correct, `rgba(20,14,26,0.55)` for
wrong. The file itself should be state-neutral: whatever colour is baked in
shows through both tints.

---

## `assets/floor.png`

| | |
|---|---|
| source | **512 × 240** |
| aspect ratio | exactly **32:15** |
| display | 256 × 120 per tile |
| alpha | not required |
| tiling | **horizontal only** |

Repeated across 2720 display px, which is 10.625 tiles — the run starts 400px
off the left edge of the screen and ends 400px off the right, so the crowd can
run past the edges.

Requirements:

- Source column 511 must join source column 0 seamlessly. This is the only
  seam that exists.
- Vertical tiling never happens. The top and bottom edges do not need to match.
- Only the **top 104 display px** are ever on screen, which is source rows
  0 – 207. Rows 208 – 239 are never visible.

---

## `assets/fonts/display.woff2`

| | |
|---|---|
| format | `.woff2` |
| weights used | 500, 600, 700, 800 |
| sizes used | 22 – 74 display px |

A variable font covering 500–800 works, as does a single static weight — the
browser will synthesise the rest.

**Self-host it — do not link Google Fonts.** There is no internet at the venue,
so a CDN link would silently fall back to the system face on the night. Put the
file at that exact path; the `@font-face` is already in
`client/display/index.html` and the code waits for it before the first frame.

---

## Checking your work

1. Drop the file in `assets/`, refresh the display page. The yellow HUD note
   lists whatever is still procedural — when your file loads, it disappears
   from that list.
2. Press `Enter` to start a round and check the platform at **all three
   widths** — questions with 2, 3 and 4 answers are all in the default deck.
   The 2-answer case is where middle-stretch problems show up.
3. `npm run smoke -- --shots --crowd 28` renders a full 31-player round and
   writes screenshots to `state/`, which is a fast way to see the art with a
   crowd on it without gathering a crowd.

## If you want to change the geometry

These numbers are derived, not arbitrary — they come from three constants:

- `ANSWER_H = 28` and `ANSWER_SIGN_H = 76` in `sim/levels.js` — collision
  height and drawn height of an answer board.
- `SPRITES.platform.cap = 128` in `client/display/art.js` — cap width in source
  pixels.
- `EDGE_MARGIN = 70`, `MIN_GAP = 60` in `sim/levels.js` — what produces the
  400 / 553 / 860 widths.

If your art wants different proportions, change the constant and the numbers
above follow. Tell me and I'll adjust them to fit what you've made.

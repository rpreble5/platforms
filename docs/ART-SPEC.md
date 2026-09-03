# Art spec

Three files. Drop them in `assets/`, commit, push. Each one is independent and
optional — anything missing gets a procedural placeholder, and the yellow HUD
note on the display lists what's still placeholder, so they can arrive one at a
time.

Sizes are read from the files at load time. **Any resolution works.** The
numbers below are ratios and layouts, not fixed requirements.

| file | what it is |
|---|---|
| `assets/platform.png` | a 3 × 3 tilesheet, transparent |
| `assets/floor.png` | one square tile, opaque |
| `assets/bg.png` | one 16:9 image, opaque |
| `assets/fonts/display.woff2` | one font file |

---

## `assets/platform.png` — the answer board

A **3 × 3 grid of equal square cells** on a transparent background. The whole
image is square: three cells across, three cells down.

| cell | sheet |
|---|---|
| 64 × 64 | 192 × 192 |
| 128 × 128 | 384 × 384 |
| 256 × 256 | 768 × 768 |

Any of those, or anything else square and divisible by three. Bigger is fine.

```
+----------+----------+-----------+
| top-left | top-mid  | top-right |   row 1
+----------+----------+-----------+
| mid-left | center   | mid-right |   row 2
+----------+----------+-----------+
| bot-left | bot-mid  | bot-right |   row 3
+----------+----------+-----------+
```

Boards are built by placing the left column once, repeating the middle column
as many times as the width needs, and placing the right column once. That's
what lets boards be any size.

So:

- **`top-mid`, `center` and `bot-mid` must tile left-to-right.** Each one's
  right edge has to join its own left edge with no seam.
- The four corners and the two side cells are placed exactly once each and
  never repeat, so all end detail belongs in them.
- Cells have to line up vertically as well: the bottom edge of `top-mid` meets
  the top edge of `center`, and so on.
- Transparent everywhere the board isn't.

Row 1 is the surface players land on. Rows 2 and 3 are the panel the answer
text sits on, so those two rows need to stay plain enough that text over them
is readable — that's the only constraint on their content.

Don't bake in a correct/wrong colour; those are tinted over the top at runtime.

### Checking a sheet

`npm run testsheet` writes a known-good test pattern to
`assets/platform.png` — square notches at the four outer corners, a dot in each
repeating cell. Refresh the display and press Enter: the notches must stay
square at every board width, the dots must stay evenly spaced with no gap or
overlap where tiles meet, and no background must show through between tiles.
Delete the file to go back to the placeholder, or overwrite it with yours and
run the same check.

---

## `assets/floor.png` — the ground

One **square** tile, any size. Tiles **left-to-right only**: the right edge
must join the left edge. Top and bottom edges never meet anything.

Only the top ~40% of the tile is ever on screen.

---

## `assets/bg.png` — the backdrop

One image at **16:9**, any resolution. It's stretched to fill the screen, so
any other ratio will distort.

What covers it, as fractions of the image height:

| band | covered by |
|---|---|
| top 14% | the question banner — opaque, always |
| 14% – 65% | clear, apart from a panel between questions |
| 65% – 91% | the boards and the crowd |
| bottom 9% | the floor — opaque, always |

---

## `assets/fonts/display.woff2` — the display face

**Filled: Baloo 2** (variable, latin, weight axis 400–800), with its OFL
license alongside as `OFL-Baloo2.txt`. The 800s the draw code asks for
render true — one file serves every weight.

**Self-hosted on purpose — don't link Google Fonts.** There's no internet at
the venue, so a CDN link would silently fall back to the system face there.
To swap the face, replace the file at this exact path (keep the
license of whatever you ship); the `@font-face` is already wired up and the
display waits for the font before its first frame.

---

## Board geometry, if you need it

Set in `sim/levels.js`:

- `GRID = 24` — the tile size in display pixels. Every board width is a
  multiple of it.
- `ANSWER_SIGN_H = GRID * 3` — the default board is three tiles tall, 72px.
  The elevated layouts override per platform with `signH = GRID * 4` (96px)
  for two big lines of answer text.
- `ANSWER_H = GRID` — the top tile row is the part players actually stand on.

Widths vary by layout and answer count (any multiple of `GRID`), and nothing
in the renderer depends on a specific width — boards draw correctly at any
size, which is what makes varying board sizes a level-design change rather
than an art change.

# Art spec

Everything needed to make sprites for the display, with prompts at the bottom
for generating them.

Drop finished files in `assets/`, refresh the display, done. Each one is
optional and has a procedural fallback, so you can do them one at a time — the
HUD tells you which are still being drawn in code.

---

## The two rules

**1. The environment is desaturated. Players own the saturated range.**

Twelve bright player colours have to pop off this backdrop at 26px from five
metres. Any scenery colour that competes with them is a bug, however good it
looks on its own. Backgrounds: dark, cool, low chroma. Stage: warm, mid-value,
muted. Nothing in the art should be as saturated as a player.

**2. Detail below ~20px is wasted.**

The whole screen is viewed at 5+ metres. Texture, small ornament and fine
linework will not resolve — they just add noise that makes 30 avatars harder to
pick out. Shape and value do all the work.

## Palette

Source of truth is `client/display/theme.js`; these are what the procedural
fallbacks use, so matching them means art and code look like the same game.

| role | hex | notes |
|---|---|---|
| sky top | `#1b1730` | deep indigo |
| sky bottom | `#332a52` | violet |
| hills far / near | `#2c2547` / `#3d3363` | flat silhouettes, no detail |
| **platform ledge** | `#f0c07a` | the landing surface — brightest thing on the stage, because it's what players aim at |
| platform face | `#d2934f` | the sign body that holds the answer text |
| platform edge | `#8f5f2e` | outline / underside |
| answer text | `#2b1c0c` | dark ink on warm sand: highest-contrast pairing on screen |
| floor top | `#7b6450` | |
| floor body | `#4c3f34` | |
| ink | `#17142a` | outlines |

## Assets

Author everything at **2× the display size**, listed below as *source*. It costs
nothing — these load over loopback — and gives headroom.

### `assets/bg.png` — background

| | |
|---|---|
| source | **3840 × 2160** |
| display | 1920 × 1080, stretched to fill |
| alpha | not needed |

Zones that constrain the composition:

| band (display y) | what's there | requirement |
|---|---|---|
| 0–150 | question banner sits on top | anything here is wasted |
| 150–700 | open air, scoreboard panel appears mid-screen | **the only place busy content belongs** |
| 700–980 | answer signs and the crowd | quiet, dark, low contrast |
| 980–1080 | floor covers it | wasted |

So: interest in the upper middle, calm in the lower third.

### `assets/platform.png` — the answer signboard

The platform *is* the sign. The top band is the ledge players land on; the rest
hangs below and carries the answer text.

| | |
|---|---|
| source | **512 × 152** |
| display | variable width × 76 tall |
| slice | horizontal 3-slice, **left cap 128 src, middle 256 src, right cap 128 src** |
| alpha | **required** — rounded ends must be transparent |

Widths it gets stretched to, depending on the question:

| answers | display width | middle stretch |
|---|---|---|
| 4 | 400 px | ~4× |
| 3 | 553 px | ~6× |
| 2 | 860 px | ~11× |

**Only the middle 256px stretches. The two 128px caps never do.** So all shape
— rounded corners, bevels, end detail — lives in the caps, and the middle must
be a horizontally uniform flat fill. Texture or a pattern in the middle will
smear at 11×.

Vertical split, in source pixels:

- **top 56px = the ledge.** Distinctly lighter than the rest, reads as a surface
  you can stand on. This is the brightest element on the stage.
- **bottom 96px = the sign face.** Flat and unbusy — dark text is drawn over it
  at runtime, so it needs to stay light and even. No highlights or gradients
  where a word will sit.

Neutral art only: correct/wrong states are tinted in code, so don't bake in
green or red.

### `assets/floor.png` — ground tile

| | |
|---|---|
| source | **512 × 240** |
| display | 256 × 120 per tile, repeated across 2720 px |
| alpha | not needed |
| tiling | **horizontal only** — left and right edges must match |

Only the top ~100 display px is ever on screen. Top ~28px should read as a
distinct surface band; below that is body that mostly falls off the bottom.

Vertical tiling never happens, so don't worry about the top/bottom edges
matching.

### `assets/fonts/display.woff2` — display face

Any bold geometric or rounded sans. **Fredoka**, **Baloo 2**, **Nunito**,
**Outfit** and **Archivo Black** all suit flat vector and are open-licensed.
Variable weight is nice but not required; the UI asks for 500–800.

**Self-host it — do not link Google Fonts.** There is no internet at the venue,
so a CDN link would silently fall back to the system face on the night. Download
the `.woff2`, put it at that path, done; the `@font-face` is already in
`client/display/index.html` and the code already waits for it before the first
frame.

---

## Generating these

### Practical notes, in the order they'll bite you

**Transparency.** Most image models can't produce real alpha. Generate on a flat
`#FF00FF` magenta background and key it out afterwards (any editor's colour-select,
or `magick in.png -fuzz 12% -transparent magenta out.png`). Only `platform.png`
needs alpha at all — the other two are fully opaque, so generate those normally.

**Exact dimensions.** Models emit fixed aspect ratios, not arbitrary sizes.
Generate at the nearest ratio and resize/crop to the numbers above. For the
platform (512×152, very wide) you'll likely generate wider and crop.

**Seamless tiling.** Models are unreliable at this. Either use a tool with an
explicit seamless mode, or fix the seam by hand (offset the image by half its
width and paint out the join). Honestly: for the floor, a simple horizontal band
with a couple of colour steps tiles perfectly and looks fine at this distance —
don't over-invest.

**Consistency.** Generate all three in one session with the same style prefix
first in the prompt. Assets made days apart in different sessions will not match.

**No text, no characters** in any of these. Text is drawn at runtime and
characters are separate.

### Style prefix — put this at the front of every prompt

> Flat vector game art, bold thick dark outlines, solid flat colour fills with
> no gradients, no texture, no noise, no shading detail. Limited muted palette,
> clean simple geometric shapes, high contrast between elements. Orthographic
> side view, straight on, no perspective. Children's board game illustration
> style. No text, no lettering, no characters, no people.

### `bg.png`

> …**A wide empty stage backdrop for a party game.** Deep indigo and violet
> night sky graduating from dark at the top to lighter at the bottom. A few
> large simple rounded hill silhouettes across the middle in slightly lighter
> purple, very low contrast, no detail on them. Simple flat shapes only.
> Completely empty and calm across the bottom third of the image. Nothing in the
> top sixth. Muted desaturated colours throughout — nothing bright or saturated
> anywhere. 16:9.

### `platform.png`

> …**A single wide horizontal floating ledge, like a chunky signboard.** Warm
> sand and amber colours. The top third is a distinctly lighter flat surface you
> could stand on; the lower two-thirds is a plain flat amber panel with nothing
> on it. Rounded corners on the left and right ends, thick dark brown outline
> all the way round. Perfectly symmetrical left to right. The middle of the bar
> is completely uniform and featureless. Isolated on a solid flat magenta
> background. Very wide and short, roughly 3.4:1.

Then: key out the magenta, crop to 512×152, and check that the middle column of
pixels is uniform — anything varying there will smear when stretched.

### `floor.png`

> …**A horizontally seamless ground strip.** Muted warm brown earth. The top
> band is a slightly lighter flat surface line, below it is plain darker brown
> body with no detail. Extremely simple, flat colours only, no rocks, no grass,
> no texture. The left and right edges must match so it tiles seamlessly. 2:1.

---

## Checking your work

1. Drop the file in `assets/`, refresh the display page. The yellow HUD note
   lists whatever is still procedural — when your file loads, it disappears from
   that list.
2. Press `Enter` to start a round and check the platform at **all three widths**
   — questions with 2, 3 and 4 answers are all in the default deck. The 2-answer
   case is where middle-stretch problems show up.
3. Stand back. Genuinely — walk to the far side of the room and look. Every
   decision in this spec is about that view, and it's the only way to judge it.
4. `npm run smoke -- --shots --crowd 28` renders a full 31-player round and
   writes screenshots to `state/`, which is a fast way to see the art with a
   crowd on it without gathering a crowd.

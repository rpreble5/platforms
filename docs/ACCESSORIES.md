# How accessories work

> **DORMANT.** Accessories were retired from the identity system when the
> bean-family reskin landed (colour × finish × cohort shape carries identity
> now). The art in `client/display/accessory-art.js` and this document are
> kept so they can come back without archaeology — but nothing below is wired
> into the live game, and the roster no longer has `hatIndex`/`patternIndex`.

The code path, from a player tapping a button to pixels on the screen. For how
to *draw* one, see the header of `client/display/accessory-art.js`; for why the
design is the way it is, see the identity section of the README.

---

## An accessory is two things

Every accessory has both a **number** and a **name**, and both live on the
player record and both go over the wire:

| | type | used for |
|---|---|---|
| `hatIndex` | `0…11` | identity — uniqueness, pool membership, what the phone sends |
| `hat` | `'crown'` | art — the key into `ACCESSORY_ART` |

That's deliberate denormalisation. The index is the thing the server reasons
about; the string is the thing the renderer needs. Keeping both means the
display never imports `ACCESSORIES` just to turn a number into a shape, and the
server never has to care that shapes exist at all.

They can't drift because they are only ever written together, and in one place
that matters: **`#assign()` in `server/roster.js`**.

```js
record.hatIndex = hh;
record.hat = ACCESSORIES[hh].key;
```

(`resolve()` also seeds both in the record literal when a player is created, but
that is a placeholder overwritten by the `#assign()` call three lines later.
Nothing else in the codebase assigns to either field.)

## Pools are index ranges

`poolFor(cohortIndex)` returns `cohort * POOL_SIZE … cohort * POOL_SIZE + POOL_SIZE - 1`.
With `POOL_SIZE = 4`, PGY1 owns 0–3, PGY2 owns 4–7, PGY3 owns 8–11.

The partition is therefore a property of the numbering rather than something
enforced at runtime: two years can never contend for the same accessory,
because their index ranges don't overlap. `cohortOfAccessory()` recovers the
year from an index by integer division for the same reason.

The cost of the trick is that pools must be equal-sized. Changing `POOL_SIZE`
changes all three years at once.

## The path from a tap to a pixel

1. **Phone** sends `SET_LOOK { name, colorIndex, hatIndex, patternIndex, cohortIndex }`
   as JSON behind type byte `0x00`. It is a *request*.
2. **`relay.js` → `#onJson` → `case 'SET_LOOK'`** validates each field with
   `Number.isInteger` and drops anything else, then calls `roster.setLook()`.
3. **`roster.setLook()`** applies the year, then calls `#assign()` if the year,
   colour, accessory or pattern changed. A year change *always* reassigns,
   because the accessory being worn does not exist in the new year's pool.
4. **`#assign()`** resolves the request to a free `(colour, accessory, pattern)`
   triple — see below — and writes all six fields on the record.
5. **`relay.js`** sends the resolved identity back to that one phone as a `LOOK`
   frame, and broadcasts `ROSTER` to every display.
6. **`main.js` → `case 'ROSTER'`** copies `{name, color, hat, pattern, cohortIndex, connected}`
   into the display's `roster` Map, keyed by player id.
7. **`render.js`**, every frame, per player: reads the cohort, computes the drawn
   height, and calls `getAvatar(color, hat, w, drawnH, pattern, cohort.shape)`.
8. **`getAvatar()`** returns a cached canvas, or rasterises one.
9. **`drawHat()`** looks up `ACCESSORY_ART[hat]` and strokes its paths.

Nothing in steps 7–9 knows about `hatIndex`, and nothing in steps 1–6 knows
about paths.

### Where the accessory sits in collision resolution

`#assign()` is three nested loops, and **the nesting is the policy**:

```
for each colour   (requested first, then outward)
  for each accessory in this year's pool   (requested first)
    for each pattern   (requested first)
      if this triple is free, take it
```

So a collision exhausts all four patterns before it moves the accessory, and
all of the year's accessories before it moves the colour. The accessory is the
middle-strength signal: more visible than a body marking, less than a block of
hue. In practice pattern absorbs nearly every collision and a player keeps the
accessory they asked for.

`taken` is rebuilt from every *other* record on each call, so a player changing
their look frees their old slot in the same pass.

## Rasterising

`getAvatar()` draws onto an offscreen canvas of `(w + 36) × (h + 36)` and
translates by `AVATAR_PAD` (18), so **the accessory's origin is the body's
top-left corner**. Draw order matters, because it decides what covers what:

1. body fill, then the 3px ink outline
2. body pattern, clipped to the body path
3. the top-to-bottom shading gradient
4. eyes
5. **accessory**

The accessory is last, which is why `shades` works — it is drawn *over* the eyes
rather than having to dodge them.

### Artboard → body box

`drawHat()` maps the 100 × 100 artboard onto the body with a single matrix:

```js
const m = new DOMMatrix([w / ARTBOARD, 0, 0, h / ARTBOARD, 0, 0]);
path.addPath(basePath(part.d), m);
```

Two consequences worth knowing.

**The mapping is non-uniform.** x scales by `w/100` and y by `h/100`, and the
body is taller than it is wide, so a shape drawn as a circle renders as an
ellipse — by 1.05× on a PGY1 and 1.96× on a PGY3. This is inherited from the
canvas code this replaced, where every coordinate was independently a fraction
of `w` or of `h`.

**The transform is baked into the path, not applied to the context.** If the
context were scaled instead, `lineWidth = 3` would scale with it and the ink
outline would thin out to nothing as the avatar shrinks — and that outline is a
large part of what makes a 30px accessory readable. Baking it into a new
`Path2D` keeps the stroke in device pixels.

### Fill roles

`part.fill` is never a colour. `roleColor()` resolves it against the *player's*
colour so the accessory reads as theirs:

| role | resolves to |
|---|---|
| `light` | `shade(color, +0.45)` |
| `bright` | `shade(color, +0.55)` |
| `dark` | `shade(color, -0.35)` |
| `ink` | flat `rgba(10,12,20,0.92)` |
| `glass` | flat `rgba(255,255,255,0.5)` |

Numeric roles go through `shade()`; string roles are used literally, for the
two cases that should read as material rather than as body colour.

## Caching

Two caches, both lazy, both unbounded — which is safe because the number of
*distinct* avatars is bounded by the roster.

**`parsedPaths`** maps a `d` string to an untransformed `Path2D`. Parsing is
cheap but not free and the same dozen strings are reused constantly.

**`avatarCache`** maps `colour ∥ hat ∥ pattern ∥ shape ∥ WxH` (NUL-separated) to
a finished canvas. Every input that changes a pixel is in the key; miss one and
you get a stale sprite that never refreshes.

The point of all this is the per-frame cost. `drawHat()` runs **once per unique
avatar**, not once per frame — at 30 players the render loop does exactly one
`drawImage` per player per frame, and frame time is a latency term here.

Sizes change with the crowd (`avatarScale` has four tiers) and with the year, so
a player generates a handful of cache entries over an evening, not one.

## Where the code lives, and why

| file | holds |
|---|---|
| `shared/palette.js` | `ACCESSORIES` — key, label, glyph. Identity only. |
| `client/display/accessory-art.js` | `ACCESSORY_ART` — the geometry. |
| `client/display/sprites.js` | `drawHat()`, the caches, `shade()`. |

The split is not arbitrary. `shared/palette.js` is **inlined into the phone page
with its `export` keywords stripped** (see `server/http.js`), and the phone needs
an accessory's name and glyph but never its geometry — so keeping the path
strings out of `shared/` keeps them out of a payload that thirty handsets fetch
simultaneously at the worst moment of the night. That's twelve paths today and
thirty-six once the pools are full.

`accessory-art.js` is also deliberately **DOM-free** — no canvas, no `Path2D` at
module scope — so `client/display/accessory-art.test.js` can import and validate
it under Node.

## Failure modes

Both of the ways this breaks are silent, which is why there are tests and a
preview page for them.

**Unknown key.** `drawHat()` returns early if `ACCESSORY_ART[hat]` is missing, so
a typo produces an avatar with a bare head and no error. Caught by the
palette-vs-art test.

**Unknown fill role.** `roleColor()` falls through to the body colour, so the
shape is drawn in a tint that makes it nearly invisible against the body. Caught
by the fill-role test.

**Clipped art.** Anything more than `AVATAR_PAD` (18px) outside the body box is
cropped by the offscreen canvas, silently. `reach` is declared per accessory for
this reason; `/sprites` compares it against the pad at each drawn size and shows
what is lost. Five accessories currently overflow at small player counts — see
the README.

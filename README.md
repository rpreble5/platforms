# platforms

A latency prototype for a 25–30 player quiz platformer. Phones are dumb
gamepads (left / right / jump). One central screen owns the physics and the
rendering. Nobody looks at their phone while playing.

Rounds work: a question appears, the platforms get answer labels, a timer runs,
the wrong platforms crumble — and on multiple choice the extra points go to
whoever dared to commit LAST. Select-alls, ranges and sorts still pay speed.

It still carries the measurement rig it was built around, because the number
that decides whether any of this feels good — real glass-to-glass latency on
real phones over the WiFi you'll actually use — is not something the code can
tell you.

---

## Quick start

**Never run a Node project before? Start with
[docs/GETTING-STARTED.md](docs/GETTING-STARTED.md)** — installing Node, getting
the code, opening a terminal in the right folder, and what to do when the phone
won't connect (it's almost always the firewall).

Otherwise:

```bash
npm install
npm run dev
```

After the first setup, double-click `start.command` (macOS) or `start.bat`
(Windows) instead.

The terminal prints a QR code and two URLs:

```
players   http://192.168.1.20:8080/       <- scan this / phones open this
display   http://localhost:8080/display/  <- open on the machine driving the TV
```

Put the display page fullscreen on the TV, scan the QR from a phone, and press
buttons. With no phone at all, press `K` to summon a keyboard test avatar and
drive it from the host keyboard (`A` / `D` / space).

| key | on the display |
|---|---|
| **`Enter`** | **activate the menu row / skip to the next question** |
| `↑` `↓` `←` `→` | in the lobby: `↑↓` move between controls, `←→` change deck / mode / background |
| `S` | start the showdown (sudden-death true/false, from the lobby) |
| `P` | pause |
| `R` | restart from question one / abort the showdown |
| `Q` | back to the main menu (from a running or finished game) |
| `A` `D` / arrows | move the local test avatar |
| space / `W` | jump |
| `K` | add / remove the keyboard test avatar (off by default) |
| `H` | latency HUD: hidden → panel → per-player detail |
| `T` | live physics tuning (`←→` pick, `↑↓` adjust, shift for ×5, `P` prints a paste-able block) |
| `F` | arm the flash-test target |

Questions live in `questions/*.json` — every file there is a deck in the
lobby (name it with a top-level `"pack"` field). Decks are re-read on every
selection, so editing one and re-picking it is the whole edit loop.

**A deck is played one way, and says so**: `"mode": "solo"` for a
free-for-all or `"mode": "teams"`. The lobby's mode tabs pick which kind of
session it is and the list below shows only that mode's decks, so a deck is
never played the way it was not written for. The highlighted row is the
deck that will play — clicking a row IS the pick, there is no separate
confirm. A deck that does not say is read from its questions — select-all
only works in teams, so a deck using one is a teams deck. Two ship:

- **`mixed.json`** — free-for-all, 14 questions of general knowledge and
  medicine, one of every type a single player can answer.
- **`showcase.json`** — teams, the demo deck: a medicine + trivia mix with
  choices, ranges, select-alls, a picture question and two lightning sorts.
  Its picture question ships with a placeholder strip: drop a de-identified
  EKG at `questions/images/your-ekg-here.png` (same filename) and the
  question uses it as-is. Verify the medical answer keys before a real
  session — they're board-classic, but they're the author's word.

**Cover art** (dormant): a deck may carry a top-level
`"cover": "art.png"` — a bare filename in `questions/images/`, same rules
as a question picture. The Studio no longer offers a cover control (the
field survives in a pack that has one). The current lobby lists decks as
text rows and does not draw covers;
the field, the Studio button and the server-side checks are all kept for
when deck art returns to the display.

Control Room cases and Showdown statements still parse, validate and play,
but nothing authors or offers them any more: the editor does not write them
and the lobby does not list them. Packs that carry them keep them.
The lobby is a live arena, and the menu is furniture standing in it: the
deck selector, the START platform (with a per-PGY headcount under the
word), the background switcher and the join panel are physical objects
whose roofs are one-way platforms. Players can climb the rungs and stand
on the menu while the host sets up — landing on a card squashes it, but
jumping never changes state; every control is host-only (mouse/keyboard).
Answer time is no longer on the lobby at all: decks carry their own
default, and the host phone (`/host`) keeps a `Time ▸` button for cycling
it when a session needs something different.

### Drawing your own accessories (Figma → code)

Accessories are tiny canvas painters, but you don't have to write one:
draw it as an SVG and convert it.

1. Drag `assets/accessories/TEMPLATE.svg` into Figma. It's a 92×124 frame
   with a ghost bean, the eye line, and margins marked.
2. Draw on top of the guides. Flat fills and simple strokes only — outline
   any text and flatten fancy effects (the converter refuses gradients,
   filters and live text by name). Stay inside the frame; anything more
   than 16 units past the body box gets cropped by the sprite cache.
3. Delete the `guides` layer (forgetting is harmless — it's ignored) and
   export the frame as SVG.
4. `node tools/accessory-svg.js myhat.svg myhat` prints two snippets: a
   painter for `ACCESSORY_PAINTERS` in `shared/avatar.js` and a
   registration line for `ACCESSORIES` in `shared/palette.js`. Paste both,
   check `/client/display/sprites-preview.html`, run `npm test`.

Nothing loads at runtime — the output is ordinary committed code, cached
into sprites like every built-in. `devilhorns` was made exactly this way
(its SVG sits next to the template) and is the example to crib from.

### Training for question writers: /training

Before faculty write anything, point them at **`/training`** (served by
the game server, the Render instance, and GitHub Pages alike, at
`/client/training/`). It's the question writer's guide: every arena a
question type builds — drawn from the real level code, so the diagrams
can't go stale — a live "does it fit?" checker for question/answer/label
lengths, the enforced counts and timings (quoted from the same `LIMITS`
the loader applies), and the mode × type matrix. It ends where writing
starts: a link into the Pack Studio.

### Authoring packs with zero install: the Pack Studio

Faculty don't need the repo, node, or anything installed — the **Pack
Studio** is a static web page that builds, validates and previews packs
entirely in the browser. It runs the SAME validation module as the game
server and its preview is the ACTUAL game engine drawing into a canvas,
so what an author sees is what the room gets. Nothing leaves the page
until they export.

- On the host laptop it's served at **`/builder`**.
- For everyone else, publish it once with GitHub Pages: repo **Settings →
  Pages → Deploy from branch → main / root**, then share
  `https://<owner>.github.io/platforms/client/builder/`. It updates
  whenever the branch is pushed. (Pages serves the repository as-is —
  including `questions/*.json` answer keys. That's the same exposure as
  the repo itself; if the repo is private, use `/builder` on a laptop
  instead.)

The workflow: **sign in** with the faculty passcode and your name (skipped
on a laptop that has no passcode set) → the **deck list** — every deck on
the server, who last saved it and when → open one or start a new deck →
type, watch the live preview → **Save**. Save writes straight to the
server's `questions/` folder, so nobody emails a file; the answer key is
one click away in the ··· menu (it doubles as the host's crib sheet, and
holds the download for a copy of the page with no server). Drafts autosave
in the browser as a safety net — leave mid-edit and the deck reopens with
your changes — and the chip beside Save says Saved or Unsaved changes.
Two people on one deck can't silently overwrite each other: Save sends the
version it opened, a stale save is refused, and the author chooses between
opening the server copy and saving over it. With a `GITHUB_TOKEN` that can
write the repository (`GITHUB_REPO`, and `GITHUB_BRANCH` if not the deploy
branch), every save is also committed to `questions/` — the repo is the
database, git keeps every version — and `start.command` / `start.bat` pull
before starting, so the venue laptop has everything saved since last time
(offline it just carries on). Nothing plays unreviewed — the host still
picks the deck in the lobby.

**AI drafting (optional).** The Studio's "✨ Draft from notes" button
turns pasted rough material — lecture notes, half-written questions, a
list of facts — into formatted questions, and "✨ Tighten to fit"
shortens only over-length text. It runs on the game server (or the
Render test instance) via the Anthropic API: set `ANTHROPIC_API_KEY`
and a faculty `AI_PASSCODE` in the environment (both are pre-declared
in `render.yaml`; a draft costs a few cents). The AI is a drafter, not
an authority: it marks an answer correct only when the notes say so —
anything uncertain arrives unchecked and flagged for the author to
click — and its output lands in the editor as ordinary text, run
through the same validation and live preview as anything typed. Verify
every answer key before a real session.

**Authoring is typing, not clicking.** The Studio's editor is a plain
document: `#` starts a question, its answers go on the lines below, and
everything updates live as you type. Correct answers are picked with the
checkbox beside each line (typing `✓ ` or `* ` at the start of the line
does the same); two checks make a select-all automatically. The
always-there settings — deck name, theme, seconds to answer, how it's
played — never appear in the doc: the name is the title in the top bar,
and the rest live in the settings popover under the chips beside it. Each
question's type shows as a chip in the left margin, and clicking the
chip switches the type. The full format:

```
# Which planet has the most moons?
Jupiter
✓ Saturn
Uranus

# Normal resting heart rate?
range: 60-100 of 0-160 bpm    a range: line makes a number-line question

# Sort each animal by class
Mammal → Bat, Dolphin         two or more arrow lines make a sort question
Bird → Penguin

# What does this EKG show?
img: sample-ekg.png           attach with the panel button, or type it

## Control Room               section headers open the other buckets

# Post-op: set the vent
[on] Suction ready            toggles: pick on/off beside the line
PEEP = 8 (0-20, cmH2O)        numbers: type "PEEP = 8", tune the range
...                           in the panel (6-8 controls per case)

## Showdown

true: An octopus has three hearts
false: Sound travels faster in air than water
```

Clicks are for verdicts (checks, TRUE/FALSE, ON/OFF, question type,
image attach); typing is for content. Every click just rewrites the
text, so the document is always the whole truth — and the detail panel
mirrors the fiddly parts (range numbers, control steps, pacing) as
plain fields so nobody has to memorize syntax. Line-numbered problems
under the preview click through to the offending line.

### Designing a session: the mode × type matrix

A pack has three buckets, and each bucket belongs to specific modes. When you
write a question, this table says where it can live — the loader enforces it
(content in the wrong bucket is skipped with a console note, never mangled):

| question type            | free-for-all | teams | Control Room | showdown |
|--------------------------|:---:|:---:|:---:|:---:|
| choice (single answer)   | ✓ | ✓ | – | – |
| choice, select-all       | ✓ any correct scores | ✓ + team cover bonus | – | – |
| range (number line)      | ✓ | ✓ | – | – |
| lightning sort           | ✓ | ✓ | – | – |
| `image` on any of the above | ✓ | ✓ | – | – |
| control case             | – | ✓ turns between questions | ✓ | – |
| true/false statement     | – | – | – | ✓ |

- The **`questions` array** is the standard deck — it plays in BOTH
  free-for-all and teams mode. Everything above the line lives here.
- The **`controlRoom` block** is the teams bucket: cases play as team turns
  interleaved through a teams-mode quiz, or as the standalone Control Room
  mode. A free-for-all game never schedules them (enforced in the sim).
- The **`showdown` block** is the finale mode: true/false statements,
  no points, last one standing. Started separately from the lobby.

Deck order is yours by default (`"order": "authored"` — plays as listed).
Opt into the house program with a top-level `"order": "suggested"`: warmup
single-choice first, then ranges, then select-alls, then picture questions,
and lightning sorts as the finale — your relative order is kept within each
group, and team turns still spread across the arranged deck.

Three kinds of question share the standard deck:

```jsonc
// Multiple choice (2-5 answers): get onto the platform with the right answer.
// Answers sit three jumps up on tall signboards with big text, climbed via
// ladder columns of non-answer rungs beside the boards — the final move is a
// flat hop, so name labels never sit over the answers. Optional "layout":
// "row" (flat single-jump, for short answers), "pyramid" or "reverse-pyramid"
// (answers stacked at different heights — deliberately uneven, pick your spice).
{ "text": "Capital of Australia?", "answers": ["Sydney", "Canberra"], "correct": 1 }

// Range: a number line is drawn along the floor; stand inside the correct
// interval before time runs out. At the reveal, the floor outside the range
// falls away — along with everyone standing on it.
{ "type": "range", "text": "Appropriate dose of drug X?",
  "min": 0, "max": 20, "answer": [8, 10], "unit": "mg" }

// Any standard question can carry a picture — an EKG, a rash, a map —
// shown large above the platforms. Drop the file in questions/images/
// (png/jpg/webp/svg) and name it; image choice questions always play on
// the flat row layout so the picture has the airspace.
{ "text": "What rhythm is this?", "image": "ekg-01.png",
  "answers": ["Sinus", "AF", "VT", "Torsades"], "correct": 2 }

// Lightning sort: 2-4 category platforms, then 2-12 rapid-fire items shown
// one after another (itemMs each, clamped 3-15s, default 6s). Stand on the
// right bucket at each item's mini-buzzer; the winning bucket flashes
// between items and the arena never rebuilds — one question, a sustained
// scramble. Each landed item pays 300 plus up to 150 for speed.
{ "type": "sort", "text": "Sort each animal by class",
  "buckets": ["Mammal", "Bird", "Reptile"],
  "items": [ { "label": "Bat", "bucket": 0 }, { "label": "Penguin", "bucket": 1 },
             { "label": "Gecko", "bucket": 2 } ],
  "itemMs": 6000 }
```

There is also a separate **showdown** — sudden-death true/false, floor split
into TRUE and FALSE halves, wrong half collapses each statement, last player
standing wins. It is its own mode with no points and no scoreboard contact,
started from the lobby (`S` on the display, or the host page button), and
authored as a top-level block in the same file:

```jsonc
"showdown": { "answerMs": 6000, "statements": [
  { "text": "An octopus has three hearts", "answer": true },
  ...
] }
```

---

## Where to run it

**On the laptop that will drive the TV, on the same network as the phones.**
That is not a preference — it's the design. Every hop this project optimises
away is a LAN hop, and hosting the relay anywhere off-LAN (a cloud box, a
tunnel, a VPN relay) inserts a WAN round trip that dwarfs the entire budget.
A cloud-hosted build can tell you the buttons work; it can tell you nothing
about latency, which is the only reason this milestone exists.

There is no deploy step. `git clone`, `npm install`, `npm run dev`.

### Faculty test drive: the one sanctioned cloud instance

Faculty who want to poke at the game don't have Node, git, or GitHub
accounts — and updates land here daily, so anything installed on their
laptops is stale by Friday. For THEM (and only them) there is a cloud test
instance: they open a URL, the QR points their phone at the same URL, and
every visit runs whatever was pushed last. Zero installs, always current.

**The latency doctrine above still holds.** The cloud hop adds ~60-150 ms
to each button press. A solo evaluator barely notices — the sim and
rendering run at 120 Hz in their own browser; only their taps commute
through the cloud — but that number is disqualifying for thirty people
racing platforms for speed bonuses. One sentence to repeat to everyone:
**the test URL is the test drive; the live session runs on the host laptop over
LAN.**

One-time setup (repo owner): [render.com](https://render.com) → sign in
with GitHub → **New → Blueprint** → pick this repository. Render reads
`render.yaml`, builds the free service, and **redeploys automatically on
every push** to the branch it names. Then copy the service's URL **from
the top of its page in the Render dashboard** and share
`<that-url>/display/` with faculty; phones join by scanning the QR on
that page, exactly like the live session. (Don't type the URL from memory:
onrender.com subdomains are global across all Render users, so the name
in render.yaml may come back with a random suffix — and a guessed URL
can land on a stranger's app entirely.)

Honest small print:

- The free instance sleeps when idle — the first visit of the day can take
  a minute to wake. Refresh once and it's snappy.
- There is ONE room. Two faculty testing at the same moment will see each
  other's avatars. Take turns, or treat it as a feature and wave.
- Anyone holding the URL can technically fetch pack answer keys from the
  API, so share it with faculty only — and never load the real session's
  pack on the test instance.
- The `/host` page works there too: the key is the `HOST_KEY` environment
  variable in the Render dashboard.

### Testing without a room full of people

| what you have | what you can learn |
|---|---|
| Just a laptop | Feel, physics tuning, rendering, crowding. Drive an avatar with `A`/`D`/space; open `/testpad?n=6` for six live gamepads side by side; `npm run smoke -- --crowd 28` renders a full room headlessly. |
| Laptop + your own phone, at home | The real input path, real RTT, and a real flash-test number on your own TV. This is the single highest-value hour you can spend. |
| Office, a few phones, before the event | The client-isolation go/no-go, plus `npm run loadgen` for the client-count sweep. See `docs/venue-check.md`. |
| The actual room | The number that counts. |

`/testpad?n=6` runs N real gamepads as iframes on one machine, each with its own
identity (via `?seat=`, which namespaces the token — without it every tab on an
origin shares one token and they kick each other in a loop). It is for
functional and crowding checks only: no radio, no touch digitizer, no TV in the
path, and those are the terms that dominate.

`/sprites` is the avatar preview page — every colour in both finishes on each
year's body, at the three sizes the game draws.

`/levels` is the level editor — drag platforms on the real renderer, with the
layout rules (reachability, the label rule, spacing, the banner ceiling)
checked live, a 28-bean crowd preview, and a play mode to feel the jumps.
**Save** writes the level to `levels/<name>.json` on the server; the display
re-reads that library at every lobby, so save → start a round is the whole
loop. During a game, each choice question uses a designed level whose board
count matches its answer count, rotating deterministically through the
library; questions can pin one by name with `"level": "<name>"`, and any
count with no designed level falls back to the shipped layout tables in
`sim/levels.js`. Start a design from a saved level or from any shipped
layout as a template; boards can be added, removed, moved and resized
freely (2-5 per level).

### Two things that look exactly like client isolation but aren't

- **The host firewall.** macOS prompts on first run; Windows Defender blocks
  inbound by default and often classifies office WiFi as "Public". Allow Node
  through, or phones will fail to connect on a network that is perfectly fine.
- **The wrong interface.** If the host is on both Ethernet and WiFi, the printed
  join URL may be for the network the phones aren't on. The terminal lists every
  address it found — try another one.

## What happens when someone joins

1. They scan the QR on the display, or type the URL the display prints. Both go
   to the same page; every unknown path lands there too, so a mistyped URL
   still joins the game instead of 404ing at a player mid-party.
2. The phone opens a WebSocket and sends `HELLO` with whatever token it has in
   `localStorage`. No token, or an unknown one, mints a new player.
3. Node replies with `HELLO_ACK`: the player's id, a token to remember, and the
   look it has provisionally assigned them.
4. The phone shows the **setup card** — name, training year, colour, style
   (flat or pastel).
5. They tap **I'm ready**. The phone sends `SET_LOOK`; Node resolves it and
   echoes back what they actually got; the display's roster updates and their
   avatar appears on the floor in that look.
6. The host presses `Enter` on the display to start.

Late joiners run the same path at any time and drop straight into the round in
progress. A reconnect — dropped WiFi, backgrounded tab, closed lid — re-sends
the same token and resumes the same avatar, same look, same score, with no
setup card in the way.

**Everything is a request, not a command.** Twelve colours cannot cover thirty
players, and colour alone isn't separable anyway across a room, under projector
gamma, or for a colourblind player. So the player asks, and the server resolves
collisions so the **(colour, finish) pair stays unique within each year** —
see the resolution order below.

## Telling thirty people apart

Everything about the characters is designed against one number: at a full house
an avatar is drawn about **30×42px** and viewed from five metres, and name
labels have already switched off (`render.js`). A feature needs roughly 3px to
be noticed, which is 10% of the body width. That gives one hard rule:

> **Only things that break the outline are visible.** The eye reads silhouette
> first, and a shape above the head sits against open sky instead of against a
> busy body. Detail *inside* the outline — face markings, a badge, fine pattern
> — is invisible across a room and not worth the pixels.

The bean family obeys that rule with silhouettes rather than add-ons: the egg,
pill and loaf differ at the outline — round top vs domed top vs flat top — so
the year still reads when everything inside the body has been crushed by the
projector.

Three axes carry identity:

| axis | who chooses | what it's for |
|---|---|---|
| colour (12) | player | which one is me — unique within your year |
| finish (flat / pastel) | player | pure preference, never taken away |
| body (egg / pill / loaf, 0.75 / 1.0 / 1.4 tall) | training year | which cohort, at a glance |

The finish is the same hue rendered two ways: **flat** is the saturated colour
with a bold ink outline, **pastel** is washed toward white with a deep
same-hue outline and a blush. Both read cleanly on every stage theme.

**The colour is the claim.** One jade PGY1, full stop: taken colours grey out
on the phone for your year, and a contested request slides to the nearest
free hue. Since colour alone carries uniqueness, the finish is never touched
by collision resolution — what you pick is what you keep. Across years the
body shape separates identical colours, so a PGY1 and a PGY3 can both be
jade. Twelve colours per year covers a residency class; players who haven't
committed to a year yet hold no claim, so a lobby full of people mid-setup
can't exhaust a cohort, and in the unreal case of a 13th same-year player the
server grants a duplicate rather than refusing the join.

**Accessories are pure charm.** Fourteen options (none, flower, shades,
crown, sprout, fangs, moustache, monocle, beret, party hat, propeller, top
hat, cowboy, beanie), drawn by the shared renderer in the bean language and
picked freely on the phone — no pools, no collision logic, because they do
no identity work. They bake into the cached sprite, so they squash, stretch
and lean with the body.

**Training year is a costume, never a gameplay difference.** `PLAYER_H` is 56
for everybody; only the *sprite* changes, growing upward from the feet so the
collision box, jump arc and landing pixel are identical across years. There's a
test in `sim/round.test.js` that says so, because this is the one way the
feature could quietly become an advantage.

Height is a **comparative** cue — a clump of PGY1s beside a clump of PGY3s is
obvious, one PGY2 alone on a platform is not. That's the right shape for a
coarse three-state signal, and it's why the accessory pools carry load too. The
0.75–1.4 spread is wide because narrower ones got swamped: accessory silhouettes
vary total sprite height by about as much again, so 0.9–1.1 was invisible and
0.85–1.15 was marginal.

Outline is a second, weaker channel pointing the same way. Side by side at
30×42 the difference between a capsule and a slab is small but real, and
redundant coding survives occlusion and a bad projector better than one channel
does. Both live in `COHORTS` in `shared/palette.js` — two numbers and two
strings if you want to dial either back.

Whatever the server settles on is what goes back to the phone, and the phone
wears it: the top bar takes the player's colour at full strength, with the hat
in the chip. "Look at your phone, then find that on screen" is the whole
mechanism for picking yourself out of thirty avatars, so it has to be the
resolved look, never the requested one.

Tapping the colour chip in the bar reopens the card, so a name typo or a colour
someone regrets is fixable without rejoining.

## Art and assets

The stage draws from sprites in `assets/` when they exist and falls back to
shapes in code when they don't, so the game runs with that folder empty and you
can add art one file at a time. The HUD names whatever is still procedural.

File formats and layouts: **[docs/ART-SPEC.md](docs/ART-SPEC.md)**.

Two structural things worth knowing:

- **Boards are tiled, not stretched.** `platform.png` is a 3×3 tilesheet; the
  middle column repeats to fill whatever width a board needs. Nothing ever
  smears, and any multiple of `GRID` (24px) is a legal board width, so varying
  board sizes costs nothing on the art side. `npm run testsheet` writes a test
  pattern for checking the tiling.
- **The platform is the signboard.** The top tile row is what you land on; the
  two rows below hang under it and carry the answer text. They're one object, so
  the label falls with the platform on reveal and there's never a question about
  which answer belongs to which ledge. It's also the only layout that fits — an
  avatar standing on the floor reaches y=924 and the platform surface is at 820,
  so a separate floating label had nowhere to go.

## How a round scores

Correct answer: **1000 points**, plus a **bonus up to 500** that ramps
linearly across the answer window — and which way the ramp runs depends on
the question type:

- **Multiple choice pays the NERVE bonus**: the ramp is inverted, so the
  bonus grows the longer you dare to wait before committing. Standing on
  the floor until the last second and landing late is what earns the
  extra — a game of chicken with the timer. First touch still sets your
  time, so landing early and hopping in place at the buzzer buys nothing.
- **Select-all, ranges and sort items keep the speed decay**: fastest pays.
  A late-bonus on select-all would fight the team's coverage job, and a
  decisive read should still win a range.

The smooth ramp (rather than ranking) is the important part, and it is not
the obvious design. Ranking players — 1st gets most, 2nd gets less — would
make the score depend on ordering, and at 30 players the gap between
adjacent arrivals is often tens of milliseconds. That is the same size as
the spread in network latency, so rank scoring would quietly hand points to
whoever has the better phone and the better corner of the room. A linear
ramp over a 12-second window makes 100 ms worth about **four points out of
five hundred**, in either direction.

So what gets rewarded is **deciding, not connecting** — nerve on multiple
choice, speed everywhere else. Rank is still shown on the scoreboard,
because "you were 1st!" is the fun part (on a nerve round, 1st is the
latest commit); it just doesn't drive the maths.

### The buzzer

**Input stops the moment the timer hits zero.** Physics keeps running for an
800 ms settle, so anyone mid-jump completes their arc and lands. Two reasons:

- A full jump is ~680 ms. Before the settle existed, anyone airborne at the
  buzzer counted as standing on nothing and scored zero — bouncing on the right
  answer as time ran out lost you the round.
- With input live through the reveal, the crowd kept milling about and you
  couldn't see where anyone had actually committed. Freezing makes the answer
  readable, which is the whole point of that moment.

**You get credit either way round:** you were on the correct platform when the
timer ended (standing on it, or last standing on it if mid-jump), *or* you land
on it during the settle. The union is deliberate — input is dead after the
buzzer so there's nothing to game, and it closes off every way of losing credit
through no fault of your own, including a round-trip of latency.

Your *time* for the bonus — whichever way the ramp runs — is still set by
**first touch**. Leaving early still forfeits: wander off to another
platform and that's where you're counted.

All of that is covered by tests in `sim/round.test.js`, including explicit
fairness tests asserting that a realistic latency gap is worth under ten points.

## Read this before you measure anything

Two things dominate the latency budget and **neither is in this code**:

1. **Put the TV in Game Mode.** Motion smoothing / "cinema" processing adds
   80–150 ms — more than this entire software pipeline combined. It is one
   settings menu and it is the single highest-leverage change available.
2. **HDMI cable only.** Chromecast and AirPlay add 100–500 ms. There is no
   configuration that makes wireless display acceptable here.

The full budget, touch → photons:

| stage | good | bad |
|---|---|---|
| touch digitizer + OS dispatch | 7 ms | 50 ms |
| JS handler → bytes on the wire | 1 ms | 5 ms |
| **air hop (802.11 contention, retries, power-save)** | 4 ms | **120 ms** |
| AP → host over Ethernet | <1 ms | 2 ms |
| relay → display (loopback) | 0.5 ms | 4 ms |
| latch → next sim tick @120 Hz | 4 ms | 8 ms |
| sim + render in rAF | 2 ms | 20 ms |
| rAF → compositor → HDMI | 17 ms | 33 ms |
| **TV panel processing** | 12 ms | **140 ms** |
| **total** | **~49 ms** | **~380 ms** |

A well-run party lands around **60–90 ms p50**. That is fine — console players
live there. What people actually perceive is **variance and dropped inputs**, not
mean latency: a rock-steady 90 ms feels good, and 40–250 ms jitter feels broken.
Optimise p99 and never-drop-an-input.

---

## Measuring it properly

**The HUD** (top-left, hidden by default — press **H** to cycle hidden →
panel → panel + per-player detail) shows what software can see: air RTT
p50/p95 reported by each phone, loss, relay delay, queue→tick delay, and frame
time. Watch frame p95 — above ~20 ms you're dropping frames and your
*renderer*, not your network, is the latency problem.

**The flash test** is the only measurement that includes touch sampling and the
TV, i.e. the terms that dominate:

1. TV in Game Mode. Display fullscreen. Press **F** to arm the flash target
   (bottom-right; off by default so it doesn't cover an answer).
2. On the phone, tap the ⚑ in its status bar to enable flash mode.
3. With a **second phone**, film in **240 fps slow-motion** so the player's thumb
   *and* the flash target are both in frame.
4. Press jump. Count frames from thumb contact to the square going white.
   ÷ 240 = seconds. Each frame is 4.17 ms.

Run it four times at the first session: **Game Mode on/off × host wired/wireless.** The
Game Mode delta alone will settle every architecture argument you might have.

> The phone's own white flash is a convenience marker, not the reference — the
> phone's display pipeline delays it by 20–40 ms. **Thumb → TV** is the true
> number; phone-flash → TV is a lower bound.

**Load testing** before you write any game:

```bash
npm run loadgen -- --url http://192.168.1.20:8080 --clients 10,20,30 --hold 30
```

Run it from a laptop that is *on the WiFi* so packets are really in the air. It
prints a p50/p95/p99/loss table and tells you whether you've tripped a
bring-the-router trigger. **One radio is not thirty radios** — this validates
server CPU, the AP's client table, and the protocol under volume; it does not
reproduce true airtime contention. Only real phones do that.

---

## Network

Target the office WiFi — it's what you'll use and it may well be fine; the whole
game needs about 50 kbit/s. The prototype's job is to tell you, with numbers,
well before the event.

The one thing that hard-fails is **client isolation**: many corporate and guest
networks let phones reach the internet but not a laptop on the same network.
That breaks this design completely and is undetectable from the host side — you
find out by trying. It's also the cheapest possible test, so do it first: one
phone, one QR scan, does it connect.

Try, best first:

1. **Host on the same WiFi SSID as the phones.** Counter-intuitive given Ethernet
   is faster, but corporate wired and wireless are usually separate VLANs with
   firewall rules between them, so a wired host often simply can't be reached.
2. **Host on Ethernet.** Better when it works — the host's traffic leaves the air
   entirely. Verify a phone can actually reach it.
3. Ask IT for a non-isolated SSID for one evening. Often a five-minute chat.

### When to bring your own router

Decide from measurements, not at the session:

- Isolation probe fails and IT can't help → no choice.
- p99 input RTT > 150 ms, or loss > 1%, at 30 clients under load.
- RTT degrades sharply as clients scale (fine at 10, bad at 25) — that's AP or
  airtime saturation, and a real crowd will be worse.
- Flash test > 150 ms glass-to-glass *after* the TV is in Game Mode.

Then: **standalone island AP, no WAN at all.** No internet means the phones'
background apps stop competing for airtime, which is a real win. Prefer 5 GHz /
802.11ac; a 2.4 GHz-only 802.11n box will struggle at 30 clients. WPA2-PSK (not
WPA3 — old-device compatibility), host on Ethernet, **fixed non-DFS channel
(36–40 or 149–153 in the US)** so a radar event can't silently channel-hop and
drop everyone for 60 s mid-party, and **40 MHz width, not 80**. Put legacy
2.4 GHz on a differently-named SSID; turn band steering off. Brief the players:
their phones will warn "no internet" and Android may bounce them to cellular.

See `docs/venue-check.md` for the pre-event checklist and a place to write the
numbers down.

---

## Architecture

```
30x Phone (dumb gamepad, sends intent only)
      |  WebSocket over LAN  -- the only wireless hop
      v
Node relay  (host laptop: static files + WS fanout + identity)
      |  WebSocket over loopback  -- ~0.5 ms
      v
Display page (owns physics sim AND rendering)
      |  HDMI
      v
    TV / projector
```

**Phones send intent, never position** — a 4-bit button mask. Because nobody
looks at their phone, there is no client view to reconcile: no prediction, no
rollback, no snapshot format. That is a large simplification normal multiplayer
games don't get.

**Physics lives in the display page, not in Node.** The decisive reason isn't the
serialization hop (~1 ms) — it's that separating sim from renderer forces you to
buy an **interpolation buffer**, the standard 1–2 ticks of render-in-the-past
used to smooth arrival jitter. That's 16–33 ms of *deliberate* added latency that
exists only because the two are separated. Co-locating them renders the current
tick with zero interpolation delay, and it's the biggest saving available in
software.

The cost is robustness, handled without giving up co-location: the sim is a pure,
DOM-free module under `sim/` (Node imports the identical files for tests), and
the display pushes a 2 Hz checkpoint to the relay, mirrored to `state/`. Node
owns **identity only**; the display owns **physics and round logic**. No overlap,
so there's never a "which one is right" question.

**Transport is a plain WebSocket.** Not socket.io — we need raw `setNoDelay`,
`perMessageDeflate: false`, and binary frames, and its client JS would land at the
worst possible moment (30 phones joining at once). WebRTC DataChannel is a v2
upgrade behind a measured trigger, not a v1 decision: it buys ~10 ms on the p99,
and roughly nothing on the median.

One non-obvious enabler: the display loads from `localhost`, which **is a secure
context even over plain HTTP**, so it gets `wakeLock` for free — while phones load
over plain HTTP by IP with no certificate warnings.

### Three low-level details that are load-bearing

- `setNoDelay` is applied on the HTTP server's `connection` event, *before* the
  WebSocket upgrade, so no path can miss it. Browsers already set `TCP_NODELAY`
  client-side, so **server → phone is the direction Nagle actually bites** — our
  6-byte echo frames are exactly the small-write case it delays by up to 40 ms.
- Input is forwarded **the instant it arrives**, never batched to a timer.
  Coalescing is precisely the "optimization" that adds the latency we're removing.
- Phones send **on change only, plus a 400 ms heartbeat**. Thirty phones at 60 Hz
  would be ~1800 pkt/s of airtime for zero benefit.

### Why forgiveness beats milliseconds

`JUMP_BUFFER_MS = 150`, `COYOTE_MS = 120` in `shared/tuning.js`.

A player reacts to a frame already ~70 ms old, and their press takes another
~70 ms to arrive — so the world their jump lands in is ~150 ms ahead of the one
they reacted to. That shows up in exactly two ways: pressing just *after* walking
off an edge (coyote time fixes it) and just *before* landing (jump buffering
fixes it). Together those two constants absorb the entire good-case latency
budget. Shaving 10 ms off the wire moves nothing a human can detect; widening the
buffer by 50 ms turns a failed jump into a landed one.

The same logic extends to level design, which is the highest-leverage latency
work available: **keep the required precision low.** A game that never demands
50 ms precision cannot be ruined by 90 ms of lag.

### The dropped-release bug

An avatar that runs off the level forever is the most visible failure this game
can have, and TCP cannot prevent it — iOS suspends a backgrounded tab between a
press and its release. Three independent layers guard it:

1. The **full mask is in every packet**, so loss and reordering self-heal.
2. The phone **resends an unchanged mask every 400 ms**, and sends mask 0
   immediately on `visibilitychange` / `pagehide` / `blur` / `pointercancel`.
3. The server **forwards a synthetic mask 0** after 2 s of silence, and on
   disconnect.

---

## Layout

```
.github/    ci.yml -- typecheck + tests + a browser smoke run on every push
server/     http.js (static + inlined phone page), relay.js (WS), roster.js (identity)
shared/     protocol.js (wire format), tuning.js (all constants), palette.js,
            avatar.js (the bean + accessory renderer, inlined into the phone), qr.js
sim/        PURE, no DOM: world.js, player.js, collide.js  -- Node runs these in tests
client/display/  main.js (loop), input-bus.js, render.js, hud.js, latency-flash.js
                 sprites.js (avatar cache over shared/avatar.js), anim.js
client/phone/    index.html -- the entire gamepad, one file
client/testpad/  N gamepads on one machine, for testing without a crowd
tools/      loadgen.js, smoke.js, testsheet.js, make-nosleep.sh
```

`shared/avatar.js` is deliberately DOM-free (the canvas context comes in as an
argument) so Node tests can validate it and the phone can inline it — the
setup-card preview draws with the exact function the projector uses.

`shared/protocol.js` is imported unchanged by Node and the display page, and is
**inlined into the phone page at boot** with its `export` keywords stripped — so
the phone loads no modules and the wire format still can't drift. The phone being
one gzipped file is a latency decision: thirty phones loading at once is the worst
congestion moment of the session.

## Commands

```bash
npm run dev        # server with --watch
npm start          # server
npm test           # sim determinism + physics + relay + identity + art data
npm run typecheck  # tsc over JSDoc types, no build step
npm run smoke      # drive the real pages in Chromium; --shots, --crowd 28
npm run loadgen    # synthetic clients
npm run testsheet  # a test tilesheet at assets/platform.png
bash tools/make-nosleep.sh   # build the keep-awake videos (needs ffmpeg)
```

There is **no build step** and exactly **one runtime dependency** (`ws`). Types
come from JSDoc + `checkJs`, so the dev loop is save-and-refresh.

## Known gaps

- **iPhone screens may sleep.** The phone page is plain HTTP, so it isn't a
  secure context and `wakeLock` is unavailable. The fallback is a silent looping
  video; `nosleep.webm` is committed and covers Android, but iOS Safari won't
  play VP8 and needs an MP4 — run `bash tools/make-nosleep.sh` (needs a real
  ffmpeg) to build it. Until then iPhones rely on the host's 30-second player
  briefing ("Set Auto-Lock to Never" — see `docs/venue-check.md`). In practice
  sleep is only a risk during the lobby; players tap constantly during a round.
- **No haptics on iOS.** `navigator.vibrate` doesn't exist in Safari, so the
  visual press feedback carries the whole job there.
- **Player cap is 40**, with the longest-gone disconnected slot reclaimed when
  full. Screen space and the 48 colour×hat identities are the real limits.

## What's next

Round *types* — the current one is "everyone races to the right answer". A host
control page, so you're not driving from the display's keyboard. And the feel
pass: tune the physics constants over real WiFi with `T`, not on localhost.

# platforms

A latency prototype for a 25–30 player quiz platformer. Phones are dumb
gamepads (left / right / jump). One central screen owns the physics and the
rendering. Nobody looks at their phone while playing.

Rounds work: a question appears, the platforms get answer labels, a timer runs,
the wrong platforms crumble, and points go to whoever committed fastest.

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
buttons. You can also drive an avatar from the host keyboard (`A` / `D` / space)
with no phone at all.

| key | on the display |
|---|---|
| **`Enter`** | **start the game / skip to the next question** |
| `P` | pause |
| `R` | restart from question one |
| `A` `D` / arrows | move the local test avatar |
| space / `W` | jump |
| `H` | per-player RTT / loss table |
| `T` | live physics tuning (`←→` pick, `↑↓` adjust, shift for ×5, `P` prints a paste-able block) |
| `F` | arm the flash-test target |

Questions live in `questions/default.json` and are re-read on every display
reload, so editing them and hitting refresh is the whole edit loop.

---

## Where to run it

**On the laptop that will drive the TV, on the same network as the phones.**
That is not a preference — it's the design. Every hop this project optimises
away is a LAN hop, and hosting the relay anywhere off-LAN (a cloud box, a
tunnel, a VPN relay) inserts a WAN round trip that dwarfs the entire budget.
A cloud-hosted build can tell you the buttons work; it can tell you nothing
about latency, which is the only reason this milestone exists.

There is no deploy step. `git clone`, `npm install`, `npm run dev`.

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

### Two things that look exactly like client isolation but aren't

- **The host firewall.** macOS prompts on first run; Windows Defender blocks
  inbound by default and often classifies office WiFi as "Public". Allow Node
  through, or phones will fail to connect on a network that is perfectly fine.
- **The wrong interface.** If the host is on both Ethernet and WiFi, the printed
  join URL may be for the network the phones aren't on. The terminal lists every
  address it found — try another one.

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

Correct answer: **1000 points**, plus a **speed bonus up to 500** that decays
linearly from the moment the question opens to the moment it locks.

The decay is the important part, and it is not the obvious design. Ranking
players — 1st gets most, 2nd gets less — would make the score depend on
ordering, and at 30 players the gap between adjacent arrivals is often tens of
milliseconds. That is the same size as the spread in network latency, so rank
scoring would quietly hand points to whoever has the better phone and the better
corner of the room. A linear decay over a 12-second window makes 100 ms worth
about **four points out of five hundred**.

So what actually gets rewarded is **deciding fast, not connecting fast** — which
is the only version of "first gets more" that's fair to run at a party. Rank is
still shown on the scoreboard, because "you were 3rd!" is the fun part; it just
doesn't drive the maths.

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

Your *time* for the speed bonus is still set by **first touch**. Leaving early
still forfeits: wander off to another platform and that's where you're counted.

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

**The HUD** (top-left) shows what software can see: air RTT p50/p95 reported by
each phone, loss, relay delay, queue→tick delay, and frame time. Watch frame
p95 — above ~20 ms you're dropping frames and your *renderer*, not your network,
is the latency problem.

**The flash test** is the only measurement that includes touch sampling and the
TV, i.e. the terms that dominate:

1. TV in Game Mode. Display fullscreen. Press **F** to arm the flash target
   (bottom-right; off by default so it doesn't cover an answer).
2. On the phone, tap the ⚑ in its status bar to enable flash mode.
3. With a **second phone**, film in **240 fps slow-motion** so the player's thumb
   *and* the flash target are both in frame.
4. Press jump. Count frames from thumb contact to the square going white.
   ÷ 240 = seconds. Each frame is 4.17 ms.

Run it four times on night one: **Game Mode on/off × host wired/wireless.** The
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

Decide from measurements, not on the night:

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
shared/     protocol.js (wire format), tuning.js (all constants), palette.js, qr.js
sim/        PURE, no DOM: world.js, player.js, collide.js  -- Node runs these in tests
client/display/  main.js (loop), input-bus.js, render.js, hud.js, latency-flash.js
client/phone/    index.html -- the entire gamepad, one file
client/testpad/  N gamepads on one machine, for testing without a crowd
tools/      loadgen.js, smoke.js, make-nosleep.sh
```

`shared/protocol.js` is imported unchanged by Node and the display page, and is
**inlined into the phone page at boot** with its `export` keywords stripped — so
the phone loads no modules and the wire format still can't drift. The phone being
one gzipped file is a latency decision: thirty phones loading at once is the worst
congestion moment of the night.

## Commands

```bash
npm run dev        # server with --watch
npm start          # server
npm test           # sim determinism + physics + relay integration (24 tests)
npm run typecheck  # tsc over JSDoc types, no build step
npm run smoke      # drive the real pages in Chromium; --shots, --crowd 28
npm run loadgen    # synthetic clients
bash tools/make-nosleep.sh   # build the keep-awake videos (needs ffmpeg)
```

There is **no build step** and exactly **one runtime dependency** (`ws`). Types
come from JSDoc + `checkJs`, so the dev loop is save-and-refresh.

## Known gaps

- **iPhone screens may sleep.** The phone page is plain HTTP, so it isn't a
  secure context and `wakeLock` is unavailable. The fallback is a silent looping
  video; `nosleep.webm` is committed and covers Android, but iOS Safari won't
  play VP8 and needs an MP4 — run `bash tools/make-nosleep.sh` (needs a real
  ffmpeg) to build it. Until then iPhones rely on the "Auto-Lock: Never"
  instruction on the join screen. In practice sleep is only a risk during the
  lobby; players tap constantly during a round.
- **No haptics on iOS.** `navigator.vibrate` doesn't exist in Safari, so the
  visual press feedback carries the whole job there.
- **Player cap is 40**, with the longest-gone disconnected slot reclaimed when
  full. Screen space and the 48 colour×hat identities are the real limits.

## What's next

Round *types* — the current one is "everyone races to the right answer". A host
control page, so you're not driving from the display's keyboard. And the feel
pass: tune the physics constants over real WiFi with `T`, not on localhost.

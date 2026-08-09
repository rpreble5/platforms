# Venue check

Run this **before the event**, not on the day. Everything here is cheap; the
expensive thing is discovering on the night that the network blocks the game
entirely.

Write the numbers in. The whole point of the prototype is that the router
decision stops being a judgement call.

---

## 0. Five-minute go/no-go (do this first)

| # | Check | Result |
|---|---|---|
| 1 | `npm run dev` on the host, on the office WiFi. Terminal prints a `192.168.x.x` / `10.x.x.x` join URL, not just localhost. | ☐ |
| 2 | Scan the QR from **one phone on the office WiFi**. Does the gamepad connect and show a colour + name? | ☐ |
| 3 | Press a button — does an avatar move on the display? | ☐ |

**If step 2 fails, stop.** That is almost certainly **client isolation**, and no
amount of tuning fixes it. Options, in order: ask IT for a non-isolated SSID for
one evening; try the host on Ethernet instead (or vice versa — see below); bring
your own router.

Try both host placements, they behave differently:

- **Host on the same WiFi SSID as the phones** — usually the one that works on
  corporate networks, because wired and wireless are typically separate VLANs
  with firewall rules between them. Costs ~2 ms and some host-radio contention.
- **Host on Ethernet** — better when it works, because the host's traffic leaves
  the air entirely.

| host placement | phone connects? | notes |
|---|---|---|
| same WiFi SSID | ☐ | |
| Ethernet | ☐ | |

---

## 1. The display and the TV

| # | Check | Result |
|---|---|---|
| 1 | **HDMI cable.** No Chromecast, no AirPlay — they add 100–500 ms. | ☐ |
| 2 | **TV picture mode = Game Mode.** Motion smoothing / "TruMotion" / "MotionFlow" / "Cinema" **off**. This is worth ~100 ms. | ☐ |
| 3 | Display page fullscreen at `http://localhost:8080/display/` (localhost specifically — it's a secure context, so the host screen won't sleep). | ☐ |
| 4 | Host power settings: never sleep, never dim. | ☐ |
| 5 | Join QR readable from the back of the room. | ☐ |
| 6 | Frame p95 on the HUD is under 20 ms with a full room. | ☐ |

TV model / picture mode used: ______________________

---

## 2. Load sweep

From a laptop **on the WiFi** (so packets are really in the air):

```bash
npm run loadgen -- --url http://<host-ip>:8080 --clients 10,20,30 --hold 30
```

| clients | live | p50 | p95 | p99 | loss |
|---|---|---|---|---|---|
| 10 |  |  |  |  |  |
| 20 |  |  |  |  |  |
| 30 |  |  |  |  |  |

Check the **live** column matches the client count — a short row is not a
measurement of that many clients.

> This validates server CPU, the AP's client table, and the protocol under
> volume. It does **not** reproduce true airtime contention: one radio is not
> thirty radios. Confirm with as many real handsets as you can borrow, spread
> around the room rather than piled on a table.

Real phones tested: ______ Air RTT p50 / p95 from the HUD: ______ / ______

---

## 3. Glass-to-glass (the number that matters)

Second phone, **240 fps slow-motion**, framing the player's thumb *and* the
flash target in the bottom-right of the TV. Enable flash mode with the ⚑ in the
gamepad's status bar. Count frames from thumb contact to the square going white,
divide by 240.

| config | frames @240fps | ms |
|---|---|---|
| Game Mode ON, host Ethernet |  |  |
| Game Mode ON, host WiFi |  |  |
| Game Mode OFF, host Ethernet |  |  |
| Game Mode OFF, host WiFi |  |  |

Expect the Game Mode rows to differ by ~100 ms. If they don't, check the TV
actually applied the setting to the HDMI input you're using — many TVs store
picture mode per-input.

Target: **under ~90 ms** feels good. Over ~150 ms with Game Mode on means
something is wrong upstream — work the triggers below.

---

## 4. Bring-the-router triggers

Any one of these and the old router comes out:

- ☐ Isolation probe failed and IT can't lift it.
- ☐ p99 > 150 ms, or loss > 1%, at 30 clients.
- ☐ p95 degrades sharply as clients scale (fine at 10, bad at 25).
- ☐ Flash test > 150 ms with the TV already in Game Mode.

### Router setup, if triggered

**Standalone island, no WAN at all.** The game needs no internet, and without it
the phones' background apps stop competing for airtime.

| # | Setting | Result |
|---|---|---|
| 1 | 5 GHz / 802.11ac preferred. A 2.4 GHz-only 802.11n box will struggle at 30 clients. | ☐ |
| 2 | Dedicated SSID, WPA2-PSK (**not** WPA3 — old-device compatibility). | ☐ |
| 3 | **Fixed non-DFS channel**: 36–40 or 149–153 (US). On DFS, a radar event silently channel-hops the AP and drops everyone for ~60 s mid-party. | ☐ |
| 4 | **40 MHz width, not 80.** Narrower is more robust in a crowded room; you need ~50 kbit/s total. | ☐ |
| 5 | Band steering off. Legacy 2.4 GHz on a *differently named* SSID so nobody joins it by accident. | ☐ |
| 6 | Client isolation / AP isolation **off**. | ☐ |
| 7 | Host on **Ethernet** to the router. | ☐ |
| 8 | DHCP on. | ☐ |

Then re-run sections 2 and 3 and compare.

SSID / channel / width used: ______________________

---

## 5. Player briefing

Worth 30 seconds at the start; each of these is a support call you won't get.

- "Set Auto-Lock to **Never**" — iPhones can't be kept awake from a plain-HTTP
  page, so this is manual. (Android is handled automatically.)
- "Plug in if you can, and turn **battery saver off**" — aggressive power-save
  costs tens of milliseconds, and iOS Low Power Mode throttles timers.
- If using your own router: "your phone will say **no internet** — that's
  correct, stay on it." On Android also mention turning off adaptive/smart
  network switching, or handsets will silently bounce back to cellular.
- "Hold **left + right together** to find yourself on screen."
- "If it stops responding, just reload — you'll get the same character back."

---

## 6. On the night

- ☐ Host plugged into power, not just charged.
- ☐ Display page open and fullscreen **before** anyone joins.
- ☐ `H` shows the per-player table if someone complains about lag — check
  whether it's them or everyone.
- ☐ Know the join URL out loud, for anyone whose camera won't scan.

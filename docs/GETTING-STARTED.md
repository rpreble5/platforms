# Getting started

How to run this on your laptop, assuming you've never opened a terminal for it.
About 10 minutes the first time, then one double-click after that.

You need: a laptop, a phone, and both on the same WiFi. That's it — no internet
required once it's running.

---

## 1. Install Node

Go to **[nodejs.org](https://nodejs.org)** and download the big green **LTS**
button. Run the installer, accept the defaults.

Then check it worked. Open a terminal:

- **Mac** — press ⌘+Space, type `Terminal`, press Enter.
- **Windows** — press the Start key, type `PowerShell`, press Enter.

Type this and press Enter:

```
node --version
```

You want `v22.something` or higher. If you get "command not found" or "not
recognized", **close the terminal window and open a new one** — the installer
only updates new windows. If it still fails, the install didn't take; run the
installer again.

## 2. Get the code

### Recommended: GitHub Desktop

It bundles git so there's nothing extra to install, it makes updates one click,
and it solves step 3 for you.

1. Install it from **[desktop.github.com](https://desktop.github.com)** and sign
   in with your GitHub account.
2. **File → Clone Repository** → **GitHub.com** tab → pick `rpreble5/platforms`
   → **Clone**. It goes to `Documents/GitHub/platforms` unless you change it.
3. Click **Fetch origin** (top right) so it can see the branch.
4. **Current Branch** dropdown (top middle) → choose
   `claude/multiplayer-platformer-quiz-xnvuc2`.

That last step matters — cloning drops you on the default branch, which doesn't
have any of this in it.

<details>
<summary>Or download a ZIP, no install at all</summary>

1. On the repo page, switch the branch dropdown to
   `claude/multiplayer-platformer-quiz-xnvuc2`.
2. Green **Code** button → **Download ZIP**, then unzip somewhere findable.

Works fine, but every update means downloading and unzipping again.
</details>

<details>
<summary>Or the command line, if you already use git</summary>

```
git clone https://github.com/rpreble5/platforms.git
cd platforms
git checkout claude/multiplayer-platformer-quiz-xnvuc2
```
</details>

## 3. Open a terminal *in that folder*

The terminal has to be pointed at the project folder, not wherever it opens by
default. This is the step that trips people up.

**With GitHub Desktop, it's one menu item:** **Repository → Open in Terminal**
(Mac) or **Repository → Open in Command Prompt** (Windows). Done — skip to
step 4.

Otherwise:

- **Mac** — right-click the folder in Finder → **New Terminal at Folder**.
  (If you don't see it: System Settings → Keyboard → Keyboard Shortcuts →
  Services → tick "New Terminal at Folder".)
- **Windows** — open the folder in File Explorer, then **Shift+right-click** in
  the empty space inside it → **Open PowerShell window here** (or "Open in
  Terminal").
- **Either, always works** — type `cd ` (with a space) in a terminal, then drag
  the folder from Finder/Explorer onto the window; it fills in the path. Enter.

To confirm you're in the right place, type `ls` (Mac) or `dir` (Windows). You
should see `package.json`, `server`, `client`.

## 4. Install the dependencies — once

```
npm install
```

Takes 10–30 seconds and prints a few lines about added packages. Warnings are
normal. You only ever need to do this again after downloading a new version.

## 5. Start it

```
npm run dev
```

You'll see a QR code and something like:

```
  players   http://192.168.1.20:8080/
  display   http://localhost:8080/display/
```

Two different URLs, and the difference matters:

- **`players`** — has your laptop's address on the network. This is what phones
  open. It's what the QR code encodes.
- **`display`** — the big screen. Only works on the laptop itself.

Leave this terminal window open. Closing it stops the game.

## 6. Open the display

In a browser on the laptop, go to **http://localhost:8080/display/**.

You should see a dark level with platforms and the QR code in the corner. Press
**F11** (Windows) or **⌃⌘F** (Mac) for fullscreen.

Try it right now: press **K** to summon a keyboard test avatar, then **A** and
**D** to move, **space** to jump. If a white blob runs and jumps, everything
works. (Press **K** again to dismiss it — it's not there by default so it never
wanders into a real party.)

## 7. Connect your phone

Make sure the phone is on the **same WiFi as the laptop** — not cellular, not a
guest network.

Point the camera at the QR code on screen and tap the link. Tap once to join.
You get a colour and a name, and three big buttons: left, right, jump.

**The first time you do this, your laptop will ask whether to allow incoming
connections. Say yes.** More on this below if you miss it.

---

## Stopping and restarting

- **Stop:** click the terminal window and press **Ctrl+C** (Ctrl, not ⌘, even on
  Mac).
- **Start again:** `npm run dev` in the same terminal.
- **Next session:** double-click **`start.command`** (Mac) or **`start.bat`**
  (Windows) in the project folder. It does everything for you. To find the
  folder from GitHub Desktop: **Repository → Show in Finder / Show in Explorer**.

On Mac, the first double-click may say the file can't be opened because it's
from an unidentified developer — right-click it → **Open** → **Open**. Once.

## Getting updates

**GitHub Desktop:** click **Fetch origin**, then **Pull origin** when it offers.
Then run `npm install` once more — only actually needed if a dependency changed,
but it's harmless and quick, so just always do it.

**ZIP:** download again, unzip, `npm install` in the new folder.

**Command line:** `git pull` then `npm install`.

---

## When something doesn't work

**The phone can't load the page.** In order of likelihood:

1. **Firewall.** Your laptop is blocking incoming connections. This is by far
   the most common cause, and it looks exactly like the network being broken.
   - *Windows:* a "Windows Defender Firewall has blocked some features" box
     appears the first time. **Tick both "Private" and "Public" networks**, then
     Allow. If you already dismissed it: Windows Security → Firewall & network
     protection → Allow an app through firewall → find Node.js → tick both boxes.
     Office WiFi almost always counts as "Public", so the Public box is the one
     that matters.
   - *Mac:* a dialog asks "Do you want the application node to accept incoming
     network connections?" → **Allow**. If you clicked Deny: System Settings →
     Network → Firewall → Options → find node → set to "Allow incoming
     connections".
2. **Different networks.** Phone on cellular, or on a 5GHz/2.4GHz variant of
   your network that's actually a separate SSID. Check both.
3. **Wrong address.** If your laptop is on both WiFi and Ethernet, the printed
   `players` URL might be for the wrong one. The terminal lists every address it
   found under "other addresses" — try typing one of those into the phone
   manually.
4. **Client isolation.** Some office and guest networks deliberately stop
   devices talking to each other. Nothing you can configure will fix it — see
   `venue-check.md`. Rule out 1–3 first; this is much rarer than the firewall.

**`npm: command not found` / `not recognized`.** Node isn't installed, or your
terminal was open before you installed it. Close the terminal, open a new one,
try again.

**`Error: listen EADDRINUSE :::8080`.** Something else is on port 8080 — usually
a copy of this still running in another terminal window. Either close that one,
or use a different port:

- Mac: `PORT=8081 npm run dev`
- Windows PowerShell: `$env:PORT=8081; npm run dev`
- Windows Command Prompt (what GitHub Desktop opens by default):
  `set PORT=8081 && npm run dev`

The printed URLs will update to match.

**The display page is blank or says "connecting to the relay…".** The terminal
probably isn't running. Check the window you started it in.

**Everything works but the phone screen keeps sleeping.** Expected on iPhone —
set Auto-Lock to Never in Settings → Display & Brightness. Android handles
itself.

---

## Testing without a crowd

You don't need 30 phones to make progress.

- **`http://localhost:8080/testpad?n=6`** — six working gamepads side by side in
  one browser window, each a separate player. Open it next to the display.
  Good for seeing how crowding and identification actually look.
- **Keyboard** — A/D/space on the display page drives one avatar.
- **`npm run smoke -- --shots --crowd 28`** — renders a full 30-player room and
  saves a screenshot to `state/`.

None of these tell you anything about *latency* — no phone, no radio, no TV in
the path. For that you need a real phone, and the flash test in
`venue-check.md`.

## Useful keys on the display

| key | does |
|---|---|
| `K` | add / remove the keyboard test avatar (off by default) |
| `A` `D`, space | move / jump the keyboard test avatar |
| `H` | per-player connection quality table |
| `T` | live physics tuning (arrows to adjust, `P` prints the values) |
| `F` | toggle the flash-test target |

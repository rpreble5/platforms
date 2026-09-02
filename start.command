#!/usr/bin/env bash
# Double-click this on macOS to start the game.
#
# First time only: right-click -> Open -> Open, because macOS blocks scripts
# from unidentified developers on a plain double-click.

cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  Node isn't installed."
  echo "  Get the LTS version from https://nodejs.org, then run this again."
  echo ""
  read -r -p "  Press Enter to close." _
  exit 1
fi

if [ ! -d node_modules ]; then
  echo ""
  echo "  First run — installing dependencies (10-30 seconds)…"
  echo ""
  npm install || { read -r -p "  Install failed. Press Enter to close." _; exit 1; }
fi

# Decks published from the Studio land in the repository; pick them up.
# Offline (the venue) this just prints a line and carries on.
if [ -d .git ] && command -v git >/dev/null 2>&1; then
  echo ""
  echo "  Fetching any decks published since last time…"
  git pull --ff-only --quiet 2>/dev/null || echo "  (couldn't pull — offline, or local changes; playing with the decks already here)"
fi

echo ""
echo "  Starting. Leave this window open; Ctrl+C stops the game."
echo ""
npm run dev

# Keep the window up if the server exits, so any error is readable.
read -r -p "  Server stopped. Press Enter to close." _

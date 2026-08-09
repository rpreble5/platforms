#!/usr/bin/env bash
# Build the silent looping videos used to keep phone screens awake.
#
# Why this exists: the phone page is served over plain HTTP, so it is not a
# secure context and `navigator.wakeLock` is unavailable. The long-standing
# workaround is a muted, looping, invisible <video>. Chrome/Android will take
# the WebM (already committed, ~1KB). iOS Safari will not play VP8, so iPhones
# need the MP4 — which needs an ffmpeg with H.264, hence a script rather than a
# committed asset.
#
#   bash tools/make-nosleep.sh
#
# Without the MP4, iPhones rely on the "Auto-Lock: Never" instruction shown on
# the join screen. In practice screen sleep is only a risk during the lobby and
# scoring; players tap constantly during a round.

set -euo pipefail
cd "$(dirname "$0")/.."
out=client/phone

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg not found. Install it (brew install ffmpeg / apt install ffmpeg) and re-run." >&2
  exit 1
fi

echo "building $out/nosleep.mp4"
ffmpeg -y -loglevel error \
  -f lavfi -i color=c=black:s=64x64:r=15:d=2 \
  -c:v libx264 -profile:v baseline -level 3.0 -pix_fmt yuv420p \
  -b:v 8k -movflags +faststart -an \
  "$out/nosleep.mp4"

echo "building $out/nosleep.webm"
ffmpeg -y -loglevel error \
  -f lavfi -i color=c=black:s=64x64:r=15:d=2 \
  -c:v libvpx -b:v 8k -an \
  "$out/nosleep.webm"

ls -la "$out"/nosleep.*
echo "done — restart the server to pick them up"

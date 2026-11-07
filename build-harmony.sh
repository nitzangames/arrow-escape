#!/usr/bin/env bash
# Build Arrow Escape's playharmony.ai upload. Settings block below.
# See JSGames/Harmony/README.md.
#
#   ./build-harmony.sh          → harmony/<SLUG>-harmony.zip (real Harmony loader)
#   ./build-harmony.sh --fake   → dist/harmony-fake/ (Harmony's test stand-in)
#
# Same game files as nitzan.games; only index.html differs: Harmony's loader goes
# first in <head>, plus overlay theming. src/main.js detects window.PlayHarmony.
set -euo pipefail
cd "$(dirname "$0")"

# ── Settings ────────────────────────────────────────────────────────────────
SLUG="arrow-escape"
FILES=(index.html src levels.json.gz)
ACCENT="#e2574c"
SURFACE="#2b2b2e"
TEXT="#f4f1ea"
BACKDROP="rgba(43, 43, 46, 0.55)"
RADIUS="18px"
# ────────────────────────────────────────────────────────────────────────────

LOADER="https://cdn.playharmony.ai/v1/loader.js"
OUT="dist/harmony"
if [[ "${1:-}" == "--fake" ]]; then
  LOADER="https://cdn.playharmony.ai/v1/fake-loader.js"
  OUT="dist/harmony-fake"
fi

rm -rf "$OUT"
mkdir -p "$OUT"
cp -R "${FILES[@]}" "$OUT/"

THEME=":root { --mtc-accent: $ACCENT; --mtc-surface: $SURFACE; --mtc-text: $TEXT; --mtc-backdrop: $BACKDROP; --mtc-radius: $RADIUS; }"
LOADER="$LOADER" THEME="$THEME" perl -0pi -e '
  s{<head>}{<head>\n  <script src="$ENV{LOADER}"></script>\n  <style>$ENV{THEME}</style>} or die "no <head> in index.html\n";
' "$OUT/index.html"

if [[ "$OUT" == "dist/harmony" ]]; then
  ZIP="$PWD/harmony/$SLUG-harmony.zip"
  mkdir -p harmony
  rm -f "$ZIP"
  (cd "$OUT" && zip -qr "$ZIP" .)
  echo "Built $ZIP ($(du -h "$ZIP" | cut -f1))"
else
  echo "Built $OUT/ (fake Harmony, for local testing only)"
fi

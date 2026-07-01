#!/usr/bin/env bash
# build-deploy.sh — stage exactly the files the app needs into a clean folder,
# ready to upload to a server directory. Use it for both production and a test
# subfolder so the two deploys never drift, and so the reference folders, spec
# docs, and the API key file are never shipped by accident.
#
#   ./build-deploy.sh            # stages into ./_deploy
#   ./build-deploy.sh test-out   # stages into ./test-out
#
# Then upload the *contents* of the staged folder into your server directory:
#   production : <docroot>/insights/
#   test       : <docroot>/insights/test/   ->  https://dqe1.com/insights/test/
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:-$SRC/_deploy}"

# The complete runtime set. typesafe.js and content.js are easy to forget — both
# are imported modules; omitting either breaks the app with a module-load error.
FILES=(
  index.html
  style.css
  app.js
  storage.js
  model.js
  cluster.js
  csv.js
  colors.js
  content.js
  typesafe.js
  preview.png
  .htaccess
)

rm -rf "$OUT"
mkdir -p "$OUT/api"
for f in "${FILES[@]}"; do cp "$SRC/$f" "$OUT/$f"; done
cp "$SRC/api/evaluate.php" "$OUT/api/evaluate.php"

echo "Staged deployable app in: $OUT"
echo "Files:"
(cd "$OUT" && find . -type f | sort | sed 's/^/  /')
echo
echo "NEXT — upload the CONTENTS of '$OUT' into your server folder:"
echo "  production : <docroot>/insights/"
echo "  test       : <docroot>/insights/test/"
echo
echo "API KEY — api/evaluate.php needs the Typesafe key at runtime (never shipped here):"
echo "  preferred : set TYPESAFE_API_KEY as a host env var (covers every path at once)"
echo "  or        : upload typesafe_key.txt into the SAME folder you deploy to"
echo "              (it sits beside index.html; .htaccess blocks it from the web)"

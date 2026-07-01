#!/bin/bash
# Double-click this file in Finder to run the Insight Matrix app locally.
# It serves the folder over HTTP (required for ES modules) and opens your
# browser. Close this Terminal window (or press Ctrl-C) to stop the server.

# Always run from the folder this script lives in, regardless of where it
# was launched from.
cd "$(dirname "$0")" || exit 1

# Find the first free port starting at 8000 so re-launching never collides
# with an already-running copy.
PORT=8000
while lsof -ti "tcp:$PORT" >/dev/null 2>&1; do
  PORT=$((PORT + 1))
done

URL="http://localhost:$PORT/"

echo "──────────────────────────────────────────────"
echo "  Insight Matrix"
echo "  Serving at: $URL"
echo "  Close this window or press Ctrl-C to stop."
echo "──────────────────────────────────────────────"

# Open the browser a moment after the server starts listening.
( sleep 1; open "$URL" ) &

# Run the server in the foreground so the window stays attached to it and
# closing the window stops the server.
exec python3 -m http.server "$PORT"

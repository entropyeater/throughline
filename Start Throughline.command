#!/bin/bash
# Start Throughline.command — double-click launcher (macOS).
#
# Serves this folder over HTTP (ES modules require http://, not file://),
# opens the app in your browser, and stays attached. Close this window to stop
# the server. Picks the first free port starting at 8000.

cd "$(dirname "$0")" || exit 1

port=8000
while lsof -i ":$port" >/dev/null 2>&1; do
  port=$((port + 1))
done

url="http://localhost:$port/index.html"
echo "Serving Throughline at $url"
echo "Close this window (or press Ctrl-C) to stop."

# Open the browser shortly after the server comes up.
( sleep 1; open "$url" ) &

exec python3 serve.py "$port"

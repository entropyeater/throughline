#!/usr/bin/env python3
"""Local dev server for Throughline that disables browser caching.

`python -m http.server` sends no Cache-Control header, so browsers heuristically
cache app.js / style.css and keep running stale code after every edit (you have
to hard-reload to see changes). This subclass forces no-cache on every response
so a normal reload always fetches the current files.

Usage:  python3 serve.py [port]   (default port 8000)

This is a DEV convenience only. Production caching is handled by .htaccess
(see README) — don't deploy this script.
"""
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print(f"Serving Throughline (no-cache) at http://localhost:{port}/index.html")
    print("Close this window (or press Ctrl-C) to stop.")
    try:
        HTTPServer(("", port), NoCacheHandler).serve_forever()
    except KeyboardInterrupt:
        pass

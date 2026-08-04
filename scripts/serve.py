#!/usr/bin/env python3
"""Dev server: http.server + `Cache-Control: no-cache` on every response.

With no cache headers (python -m http.server's default), browsers
heuristically cache ES modules — after an edit you can get a STALE MIXED
MODULE GRAPH: a freshly fetched module importing a cached old one, surfacing
as phantom "does not provide an export named ..." errors. no-cache makes the
browser revalidate each file (304s keep it fast), so a plain reload always
loads a coherent graph.
"""
import http.server
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Audio gets no-store, not no-cache: a re-cut clip can come back with an
        # OLDER Last-Modified than the copy a browser already holds (a copy
        # preserves the source's mtime), so revalidation answers 304 and the
        # stale audio keeps playing. no-store removes the stored copy that
        # conditional request would be about.
        cache = 'no-store' if self.path.startswith('/clips/') else 'no-cache'
        self.send_header('Cache-Control', cache)
        super().end_headers()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8743
    http.server.ThreadingHTTPServer(('127.0.0.1', port), NoCacheHandler).serve_forever()

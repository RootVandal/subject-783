"""Local dev server for Subject 783: no caching, correct MIME types.

    python tools/serve.py [port]        (default 8783)

Browsers otherwise keep old copies of the ES modules, and a mix of old and new files
breaks the page in confusing ways. Windows can also map .js to text/plain via the
registry, which makes module scripts refuse to load; the types are forced here.
"""
import http.server
import socketserver
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8783


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
        '.css': 'text/css', '.html': 'text/html', '.gz': 'application/gzip', '.svg': 'image/svg+xml',
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == '__main__':
    with Server(('127.0.0.1', PORT), Handler) as httpd:
        print(f'Subject 783 on http://localhost:{PORT}', flush=True)
        httpd.serve_forever()

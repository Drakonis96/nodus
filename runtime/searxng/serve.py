"""Nodus managed SearXNG: a loopback JSON search service for Research Chat.

The private interpreter runs with -I -B, so nothing from the user's Python
environment is imported and nothing is written into the signed runtime. The
service answers only on 127.0.0.1, only to requests that carry the per-launch
token, and exits as soon as its parent closes stdin (including a crash of the
parent), so an orphaned search server can never outlive Nodus.
"""
import hmac
import json
import os
import pathlib
import secrets
import sys
import threading

ROOT = pathlib.Path(__file__).resolve().parent
TOKEN = os.environ.get('NODUS_SEARXNG_TOKEN', '')
if len(TOKEN) < 32:
    sys.stderr.write('NODUS_SEARXNG_TOKEN is required\n')
    sys.exit(2)

# SearXNG's valkey module imports the Unix-only pwd module at import time. Valkey
# is disabled here; the shim only satisfies the import on Windows.
paths = [str(ROOT / 'dependencies'), str(ROOT)]
if os.name == 'nt':
    paths.insert(0, str(ROOT / 'shims'))
sys.path[:0] = paths

session = pathlib.Path.cwd()
settings = (ROOT / 'settings.yml').read_text(encoding='utf-8').replace('__SECRET__', secrets.token_hex(32))
(session / 'settings.yml').write_text(settings, encoding='utf-8')
# The bot detector is off (limiter: false) but still looks for its file.
(session / 'limiter.toml').write_text('', encoding='utf-8')
os.environ['SEARXNG_SETTINGS_PATH'] = str(session / 'settings.yml')
os.environ.setdefault('PATH', os.defpath)


def watch_parent():
    try:
        while sys.stdin.buffer.read(4096):
            pass
    finally:
        os._exit(0)


threading.Thread(target=watch_parent, name='nodus-parent-watch', daemon=True).start()

from searx.webapp import app  # noqa: E402  (settings must exist first)
from werkzeug.serving import make_server  # noqa: E402


def guarded(environ, start_response):
    supplied = environ.get('HTTP_X_NODUS_TOKEN', '')
    if not hmac.compare_digest(supplied.encode(), TOKEN.encode()):
        start_response('403 Forbidden', [('Content-Type', 'text/plain'), ('Content-Length', '9')])
        return [b'Forbidden']
    # Every caller is the local Nodus process; say so instead of leaving the
    # client address blank, which SearXNG logs as an error on each request.
    environ['HTTP_X_REAL_IP'] = '127.0.0.1'
    return app(environ, start_response)


server = make_server('127.0.0.1', int(os.environ.get('NODUS_SEARXNG_PORT', '0')), guarded, threaded=True)
sys.stdout.write(json.dumps({'ready': True, 'port': server.server_port}) + '\n')
sys.stdout.flush()
server.serve_forever()

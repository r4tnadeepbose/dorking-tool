#!/usr/bin/env python3
"""
Simple local server for Dorking Tool (HTML UI).

- Serves static frontend files (index.html, styles.css, app.js, data.js, etc.)
- Provides local JSON APIs:
  - GET  /api/health
  - GET  /api/dorkpacks
  - GET  /api/archive?domain=example.com
  - GET  /api/state
  - POST /api/state
  - POST /api/history
  - POST /api/clear

No third-party dependencies. Intended for local/authorized passive use.
"""

from __future__ import annotations

import json
import os
import re
import threading
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
STORE = ROOT / "data_store"
STORE.mkdir(parents=True, exist_ok=True)
STATE_FILE = STORE / "state.json"
HISTORY_FILE = STORE / "history.json"
SETTINGS_FILE = STORE / "settings.json"

HOST = os.environ.get("DORKING_HOST", "127.0.0.1")
PORT = int(os.environ.get("DORKING_PORT", "8765"))

LOCK = threading.RLock()


def now_iso() -> str:
    import datetime as _dt
    return _dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def read_json(path: Path, default):
    try:
        if path.exists():
            with path.open("r", encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        pass
    return default


def write_json(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    tmp.replace(path)


def list_dork_packs():
    packs = []
    d = ROOT / "dorks"
    if not d.exists():
        return packs
    for p in sorted(d.glob("*.txt")):
        try:
            lines = [ln.strip() for ln in p.read_text(encoding="utf-8", errors="replace").splitlines()]
            lines = [ln for ln in lines if ln and not ln.lstrip().startswith("#")]
            packs.append({"file": p.name, "name": p.stem, "count": len(lines), "lines": lines})
        except Exception:
            continue
    return packs


def load_results_structure():
    p = ROOT / "ResultsStructure.json"
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        # Prefer fresh UI assets during local development/use
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def send_head(self):
        # Avoid 304/not-modified stale responses
        try:
            for h in ("If-Modified-Since", "If-None-Match"):
                if h in self.headers:
                    del self.headers[h]
        except Exception:
            pass
        return super().send_head()

    def _send_json(self, obj, status=HTTPStatus.OK):
        data = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _read_json(self):
        try:
            n = int(self.headers.get("Content-Length", "0"))
        except Exception:
            n = 0
        raw = self.rfile.read(n) if n > 0 else b"{}"
        try:
            return json.loads(raw.decode("utf-8") or "{}")
        except Exception:
            return None

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query or "")

        if path == "/api/health":
            return self._send_json({"ok": True, "time": now_iso(), "storage": "file:data_store"})
        if path == "/api/state":
            with LOCK:
                state = read_json(STATE_FILE, None)
                settings = read_json(SETTINGS_FILE, {})
                history = read_json(HISTORY_FILE, [])
            return self._send_json({"ok": True, "state": state, "settings": settings, "history": history})
        if path == "/api/history":
            with LOCK:
                history = read_json(HISTORY_FILE, [])
            return self._send_json({"ok": True, "history": history})
        if path == "/api/dorkpacks":
            return self._send_json({"ok": True, "packs": list_dork_packs(), "results_structure": load_results_structure()})
        if path == "/api/archive":
            domain = (qs.get("domain", [""])[0] or "").strip()
            return self._handle_archive(domain)
        if path.startswith("/api/"):
            return self._send_json({"ok": False, "error": "Not found"}, status=HTTPStatus.NOT_FOUND)

        return super().do_GET()

    def _handle_archive(self, domain: str):
        if not domain:
            return self._send_json({"ok": False, "error": "Domain is required."}, status=HTTPStatus.BAD_REQUEST)
        d = domain.strip().lower()
        d = re.sub(r"^[a-zA-Z][a-zA-Z0-9+.-]*://", "", d)
        d = d.split("/")[0].split("?")[0].split("#")[0].strip()
        if not re.match(r"^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$", d):
            return self._send_json({"ok": False, "error": "Invalid domain."}, status=HTTPStatus.BAD_REQUEST)

        cdx = "https://web.archive.org/cdx/search/cdx?url=" + d + "*&output=text&fl=original&collapse=urlkey"
        urls = []
        truncated = False
        limit = 20000
        try:
            req = Request(cdx, headers={"User-Agent": "DorkingTool/Local (passive lookup)"})
            with urlopen(req, timeout=30) as r:
                for raw in r:
                    line = raw.decode("utf-8", errors="replace").strip()
                    if not line:
                        continue
                    urls.append(line)
                    if len(urls) >= limit:
                        truncated = True
                        break
        except (URLError, HTTPError, TimeoutError, Exception) as e:
            return self._send_json({"ok": False, "error": f"Archive fetch failed: {e}"}, status=HTTPStatus.BAD_GATEWAY)
        return self._send_json({"ok": True, "domain": d, "count": len(urls), "truncated": truncated, "urls": urls})

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        body = self._read_json()
        if body is None:
            return self._send_json({"ok": False, "error": "Invalid JSON body"}, status=HTTPStatus.BAD_REQUEST)

        if path == "/api/state":
            with LOCK:
                if "state" in body:
                    write_json(STATE_FILE, body.get("state"))
                if "settings" in body:
                    write_json(SETTINGS_FILE, body.get("settings"))
                if "history" in body:
                    write_json(HISTORY_FILE, body.get("history"))
            return self._send_json({"ok": True, "saved": True, "time": now_iso()})
        if path == "/api/history":
            with LOCK:
                h = body.get("history")
                if isinstance(h, list):
                    write_json(HISTORY_FILE, h)
                else:
                    history = read_json(HISTORY_FILE, [])
                    entry = body.get("entry")
                    if entry:
                        history.insert(0, entry)
                        write_json(HISTORY_FILE, history[:500])
            return self._send_json({"ok": True})
        if path == "/api/clear":
            with LOCK:
                for f in (STATE_FILE, HISTORY_FILE, SETTINGS_FILE):
                    try:
                        if f.exists():
                            f.unlink()
                    except Exception:
                        pass
            return self._send_json({"ok": True, "cleared": True})

        if path.startswith("/api/"):
            return self._send_json({"ok": False, "error": "Not found"}, status=HTTPStatus.NOT_FOUND)
        return self._send_json({"ok": False, "error": "Not found"}, status=HTTPStatus.NOT_FOUND)

    def log_message(self, fmt, *args):
        try:
            super().log_message(fmt, *args)
        except Exception:
            pass


def main():
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Dorking Tool server running at http://{HOST}:{PORT}/")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        try:
            server.server_close()
        except Exception:
            pass


if __name__ == "__main__":
    main()

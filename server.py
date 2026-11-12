#!/usr/bin/env python3
"""
Dorking Tool - local Python server + HTML UI.

- Serves the static frontend (index.html, styles.css, data.js, app.js) and assets.
- Provides a small local JSON API for persistence and query generation.
- Uses a C++ engine (cpp/engine[.exe]) for /api/generate when available, with a Python fallback.

No third-party dependencies. Data is stored locally under ./data_store.
Run: python server.py
Then open: http://127.0.0.1:8765/
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import threading
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError

ROOT = Path(__file__).resolve().parent
STORE = ROOT / "data_store"
STORE.mkdir(exist_ok=True)
STATE_FILE = STORE / "state.json"
HISTORY_FILE = STORE / "history.json"
SETTINGS_FILE = STORE / "settings.json"

HOST = os.environ.get("DORKING_HOST", "127.0.0.1")
PORT = int(os.environ.get("DORKING_PORT", "8765"))

LOCK = threading.Lock()


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def read_json(path: Path, default):
    try:
        if not path.exists():
            return default
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def write_json(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def load_data():
    # Prefer structured JSON export (generated from data.js) for reliable Python/C++ use.
    pj = ROOT / "data.json"
    if pj.exists():
        try:
            with pj.open("r", encoding="utf-8") as f:
                d = json.load(f)
            if isinstance(d, dict):
                return {
                    "MODULES": d.get("MODULES", []) or [],
                    "QUERIES": d.get("QUERIES", []) or [],
                    "PLAYBOOKS": d.get("PLAYBOOKS", []) or [],
                    "ENGINES": d.get("ENGINES", []) or [],
                }
        except Exception:
            pass
    # Fallback: best-effort parse of data.js (limited)
    p = ROOT / "data.js"
    try:
        txt = p.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return {"MODULES": [], "QUERIES": [], "PLAYBOOKS": [], "ENGINES": []}
    def extract_array(name: str):
        m = re.search(rf"const\s+{name}\s*=\s*(\[[\s\S]*?\n\s*\]);", txt)
        if not m:
            return []
        s = m.group(1)
        s = re.sub(r",\s*([\]\}])", r"\1", s)
        s = re.sub(r"(\{|,)\s*([A-Za-z_][A-Za-z0-9_]*)\s*:", r'\1 "\2":', s)
        s = s.replace("'", '"')
        try:
            return json.loads(s)
        except Exception:
            return []
    return {
        "MODULES": extract_array("MODULES"),
        "QUERIES": extract_array("QUERIES"),
        "PLAYBOOKS": extract_array("PLAYBOOKS"),
        "ENGINES": extract_array("ENGINES"),
    }


DATA = load_data()


def load_results_structure():
    p = ROOT / "ResultsStructure.json"
    try:
        with p.open("r", encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def list_dork_packs():
    d = ROOT / "dorks"
    packs = []
    if not d.exists():
        return packs
    for p in sorted(d.glob("*.txt")):
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except Exception:
            text = ""
        lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
        packs.append({"name": p.stem, "file": p.name, "count": len(lines), "lines": lines})
    return packs


def normalize_target(raw: str, scope: str):
    inp = (raw or "").strip()
    if not inp:
        return {"ok": False, "error": "Target is required."}
    if re.match(r"^\s*javascript:", inp, re.I):
        return {"ok": False, "error": "Unsafe URL scheme is not allowed."}
    s = re.sub(r"^[a-zA-Z][a-zA-Z0-9+.-]*://", "", inp)
    s = re.sub(r"^[^@/]+@", "", s)
    s = s.split("/")[0].split("?")[0].split("#")[0].split(":")[0].strip().lower()
    domain_re = re.compile(r"^(?:\*\.)?(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$")
    if ".." in s or not domain_re.match(s):
        return {"ok": False, "error": "Invalid domain/hostname format."}
    def to_root(h):
        h = h.replace("*.", "")
        parts = h.split(".")
        if len(parts) <= 2:
            return h
        multi = {"co.uk","org.uk","ac.uk","gov.uk","com.au","net.au","org.au","co.jp","co.nz","com.br","com.mx","co.in"}
        if ".".join(parts[-2:]) in multi and len(parts) >= 3:
            return ".".join(parts[-3:])
        return ".".join(parts[-2:])
    target = s
    scope_label = "Exact hostname"
    if scope == "root":
        target = to_root(s); scope_label = "Root domain"
    elif scope == "root_sub":
        target = to_root(s); scope_label = "Root domain and subdomains"
    elif scope == "exact":
        target = s.replace("*.", ""); scope_label = "Exact hostname"
    elif scope == "custom":
        scope_label = "Custom scope"
    if not domain_re.match(target):
        return {"ok": False, "error": "Normalized target is invalid."}
    return {"ok": True, "input": inp, "normalized": target, "scope": scope, "scopeLabel": scope_label, "display": target + " (+ subdomains)" if scope == "root_sub" else target}


def apply_template(template: str, target: str) -> str:
    return (template or "").replace("{target}", target)


def normalize_query(q: str) -> str:
    return re.sub(r"\s+", " ", (q or "")).strip()


def validate_query(q: str) -> bool:
    if not q or re.search(r"\{(target|keyword|extension|subdomain|path|date_from|date_to)\}", q):
        return False
    if q.count('"') % 2 != 0:
        return False
    depth = 0
    for ch in q:
        if ch == '(': depth += 1
        elif ch == ')': depth -= 1
        if depth < 0: return False
    return depth == 0


def detect_operators(query: str):
    ops = []
    for name, pat in [
        ("site:", r"\bsite:"), ("inurl:", r"\binurl:"), ("allinurl:", r"\ballinurl:"),
        ("intitle:", r"\bintitle:"), ("allintitle:", r"\ballintitle:"),
        ("intext:", r"\bintext:"), ("allintext:", r"\ballintext:"),
        ("filetype:", r"\bfiletype:"), ("ext:", r"\bext:"), ("cache:", r"\bcache:"),
        ("after:", r"\bafter:"), ("before:", r"\bbefore:"), ('""', r'"[^"]+"'),
        ("OR", r"\bOR\b|\|"), ("-", r"(?:^|\s)-\S"), ("()", r"[()]") , ("*", r"\*")
    ]:
        if re.search(pat, query, re.I if name not in ['""'] else 0):
            ops.append(name)
    return ops


def generate_queries_py(payload: dict):
    target = payload.get("target", "example.com")
    scope = payload.get("scope", "root")
    module_ids = payload.get("modules") or [m.get("id") for m in DATA.get("MODULES", [])]
    info = normalize_target(target, scope)
    if not info.get("ok"):
        return {"ok": False, "error": info.get("error", "Invalid target")}
    vars_target = info["normalized"]
    selected = set(module_ids)
    items = []
    for q in DATA.get("QUERIES", []):
        if q.get("module") not in selected:
            continue
        template = q.get("template", "")
        is_global = bool(q.get("global"))
        qs = apply_template(template, vars_target)
        if (not is_global) and scope == "root_sub" and normalize_query(template) == "site:{target}":
            qs = f"(site:{vars_target} OR site:*.{vars_target})"
        qs = normalize_query(qs)
        if not validate_query(qs):
            continue
        items.append({
            "id": f"{q.get('id','q')}_{abs(hash(qs))%100000}",
            "key": qs.lower(),
            "label": q.get("label",""),
            "category": q.get("category",""),
            "module": q.get("module",""),
            "priority": q.get("priority","informational"),
            "query": qs,
            "description": q.get("description",""),
            "explanation": q.get("explanation",""),
            "operators": q.get("operators") or detect_operators(qs),
            "enginesNote": q.get("enginesNote","Varies by engine."),
            "global": is_global,
            "source": "preset",
            "status": "Not Reviewed",
            "saved": False,
            "selected": True,
            "notes": "",
            "tags": [],
        })
    # dedupe
    seen = {}
    rank = {"critical":5,"high":4,"medium":3,"low":2,"informational":1}
    for it in items:
        k = it["key"]
        if k not in seen or rank.get(it["priority"],0) > rank.get(seen[k]["priority"],0):
            seen[k] = it
    out = list(seen.values())
    return {"ok": True, "target": info, "count": len(out), "queries": out, "engine_used": "python"}


def find_external_engine():
    """Return (name, command_list, cwd) for first available native/compiled engine."""
    candidates = []
    # Go (built binary)
    go_exe = ROOT / "go" / ("engine.exe" if os.name == "nt" else "engine")
    if go_exe.exists():
        candidates.append(("go", [str(go_exe)], str(ROOT)))
    # Rust (built binary)
    rust_exe = ROOT / "rust" / "target" / "release" / ("dorking-engine.exe" if os.name == "nt" else "dorking-engine")
    if rust_exe.exists():
        candidates.append(("rust", [str(rust_exe)], str(ROOT)))
    rust_exe2 = ROOT / "rust" / ("engine.exe" if os.name == "nt" else "engine")
    if rust_exe2.exists():
        candidates.append(("rust", [str(rust_exe2)], str(ROOT)))
    # C++
    cpp_exe = ROOT / "cpp" / ("engine.exe" if os.name == "nt" else "engine")
    if cpp_exe.exists():
        candidates.append(("cpp", [str(cpp_exe)], str(ROOT)))
    # Java (compiled class)
    java_class = ROOT / "java" / "Engine.class"
    if java_class.exists():
        candidates.append(("java", ["java", "-cp", str(ROOT / "java"), "Engine"], str(ROOT)))
    return candidates


def generate_queries(payload: dict):
    payload2 = dict(payload)
    # Provide query definitions so external engines can generate without parsing JS.
    if "queries" not in payload2:
        payload2["queries"] = DATA.get("QUERIES", [])
    if "modules" not in payload2 or not payload2.get("modules"):
        payload2["modules"] = [m.get("id") for m in DATA.get("MODULES", [])]
    for name, cmd, cwd in find_external_engine():
        try:
            proc = subprocess.run(
                cmd,
                input=json.dumps(payload2).encode("utf-8"),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=15,
                cwd=cwd,
            )
            if proc.returncode == 0:
                out = json.loads(proc.stdout.decode("utf-8", errors="replace") or "{}")
                if isinstance(out, dict) and out.get("ok"):
                    out["engine_used"] = name
                    return out
        except Exception:
            pass
    res = generate_queries_py(payload2)
    res["engine_used"] = "python"
    return res


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        # Prevent stale UI/assets causing "cache error" / different UI between modes
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        # Ask supporting browsers to clear HTTP cache for this origin
        self.send_header("Clear-Site-Data", '"cache"')
        super().end_headers()

    def send_head(self):
        # Disable conditional requests so browsers always receive fresh files (no 304/cache mismatch)
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
        self.send_header("Cache-Control", "no-store")
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
            engines = [n for n,_,_ in find_external_engine()]
            return self._send_json({"ok": True, "time": now_iso(), "engines": engines, "cpp_engine": ("cpp" in engines), "storage": "file:data_store"})
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
        if path == "/api/archive":
            domain = (qs.get("domain", [""])[0] or "").strip()
            return self._handle_archive(domain)
        if path == "/api/dorkpacks":
            return self._send_json({"ok": True, "packs": list_dork_packs(), "results_structure": load_results_structure()})
        if path.startswith("/api/"):
            return self._send_json({"ok": False, "error": "Not found"}, status=HTTPStatus.NOT_FOUND)
        # prevent path escape is handled by SimpleHTTPRequestHandler
        return super().do_GET()

    def _handle_archive(self, domain: str):
        if not domain:
            return self._send_json({"ok": False, "error": "Domain is required."}, status=HTTPStatus.BAD_REQUEST)
        # basic normalization/validation
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
            req = Request(cdx, headers={"User-Agent": "DorkingTool/2.0 (local passive lookup)"})
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
            # Save state/settings/history blobs from frontend (server-side persistence)
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
        if path == "/api/generate":
            res = generate_queries(body)
            return self._send_json(res, status=HTTPStatus.OK if res.get("ok") else HTTPStatus.BAD_REQUEST)
        if path == "/api/clear":
            with LOCK:
                for f in (STATE_FILE, HISTORY_FILE, SETTINGS_FILE):
                    try:
                        if f.exists():
                            f.unlink()
                    except Exception:
                        pass
            return self._send_json({"ok": True, "cleared": True})
        return self._send_json({"ok": False, "error": "Not found"}, status=HTTPStatus.NOT_FOUND)

    def log_message(self, fmt, *args):
        sys.stdout.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))


def main():
    engines = [n for n,_,_ in find_external_engine()]
    print(f"Dorking Tool server running at http://{HOST}:{PORT}/")
    print(f"Static root: {ROOT}")
    print(f"Data store : {STORE}")
    print(f"Engines    : {', '.join(engines) if engines else 'python (fallback only)'}")
    print("Press Ctrl+C to stop.")
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()

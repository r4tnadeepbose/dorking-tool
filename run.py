#!/usr/bin/env python3
"""
One-click launcher for Dorking Tool (Python + HTML UI, with optional C++/Go/Java/Rust engines).

- Starts the local server (server.py)
- Opens the web UI in your default browser
- Uses stdlib only

Usage:
  python run.py
  (or double-click if Python is associated)
"""

from __future__ import annotations

import os
import socket
import subprocess
import sys
import time
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SERVER = ROOT / "server.py"
DEFAULT_HOST = os.environ.get("DORKING_HOST", "127.0.0.1")
DEFAULT_PORT = int(os.environ.get("DORKING_PORT", "8765"))


def port_open(host: str, port: int, timeout: float = 0.3) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def find_free_port(host: str, start: int, tries: int = 20) -> int:
    for p in range(start, start + tries):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind((host, p))
                return p
            except OSError:
                continue
    return start


def wait_for_server(host: str, port: int, proc: subprocess.Popen | None, timeout: float = 15.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if proc is not None and proc.poll() is not None:
            return False
        if port_open(host, port):
            return True
        time.sleep(0.2)
    return port_open(host, port)


def main() -> int:
    if not SERVER.exists():
        print(f"Error: {SERVER} not found.")
        return 1

    host = DEFAULT_HOST
    port = DEFAULT_PORT

    # If something is already listening on the port, try to open UI (maybe server already running)
    if port_open(host, port):
        url = f"http://{host}:{port}/"
        print(f"Server already running at {url}")
        print("Opening browser...")
        webbrowser.open(url)
        return 0

    # Pick a free port if default is taken/unusable
    chosen = find_free_port(host, port)
    if chosen != port:
        print(f"Port {port} unavailable, using {chosen} instead.")
        port = chosen

    env = os.environ.copy()
    env["DORKING_HOST"] = host
    env["DORKING_PORT"] = str(port)

    url = f"http://{host}:{port}/"
    print("Dorking Tool - 1-click launcher")
    print(f"Starting server: {SERVER}")
    print(f"URL: {url}")
    print("Press Ctrl+C to stop.\n")

    try:
        proc = subprocess.Popen([sys.executable, str(SERVER)], cwd=str(ROOT), env=env)
    except Exception as e:
        print(f"Failed to start server: {e}")
        return 1

    try:
        if wait_for_server(host, port, proc):
            print("Server is ready. Opening browser...")
            webbrowser.open(url)
        else:
            print("Server did not become ready in time. Check output above/errors.")
        # Keep launcher attached so Ctrl+C stops the server
        return proc.wait()
    except KeyboardInterrupt:
        print("\nStopping server...")
        try:
            proc.terminate()
            proc.wait(timeout=5)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
        return 0


if __name__ == "__main__":
    try:
        code = main()
    except Exception as e:
        print(f"Unexpected error: {e}")
        code = 1
    if os.name == "nt" and sys.stdin and sys.stdin.isatty():
        # keep window open on double-click/error if run interactively
        pass
    sys.exit(code)

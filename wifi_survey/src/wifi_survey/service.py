"""Tiny HTTP wrapper so the home planner can run analyses (`wifi-survey serve`).

POST /analyze  {"floorplan": {...}, "records": [...]}  →  analysis JSON
GET  /health   →  {"status": "ok", "version": ...}

Runs inside the home planner's Docker network; nothing is exposed to the LAN.
"""

from __future__ import annotations

import json
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from wifi_survey import __version__

MAX_BODY = 50 * 1024 * 1024


class Handler(BaseHTTPRequestHandler):
    server_version = f"wifi-survey/{__version__}"

    def _send(self, status: int, body: dict[str, Any]) -> None:
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        if self.path == "/health":
            self._send(200, {"status": "ok", "version": __version__})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self) -> None:
        if self.path != "/analyze":
            self._send(404, {"error": "not found"})
            return
        length = int(self.headers.get("Content-Length") or 0)
        if not 0 < length <= MAX_BODY:
            self._send(413 if length else 400, {"error": "bad request size"})
            return
        try:
            body = json.loads(self.rfile.read(length))
            from wifi_survey.analysis import analyze  # heavy imports only when used

            self._send(200, analyze(body["floorplan"], body["records"]))
        except (KeyError, ValueError) as e:
            self._send(400, {"error": f"invalid input: {e}"})
        except Exception as e:  # report, keep serving
            traceback.print_exc()
            self._send(500, {"error": f"analysis failed: {e}"})

    def log_message(self, format: str, *args: Any) -> None:
        print(f"{self.address_string()} {format % args}", flush=True)


def serve(host: str = "0.0.0.0", port: int = 8000) -> None:
    print(f"wifi-survey analysis service {__version__} on {host}:{port}", flush=True)
    ThreadingHTTPServer((host, port), Handler).serve_forever()

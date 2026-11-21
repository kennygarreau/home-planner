"""`wifi-survey agent`: take measurements requested from the Floor Plans page.

The agent only makes outbound HTTP requests to the home planner:
  POST /api/survey-agent/poll               long-poll for the next job
  POST /api/survey-agent/jobs/<id>/progress  (409 → the job was cancelled: stop)
  POST /api/survey-agent/jobs/<id>/result
"""

from __future__ import annotations

import contextlib
import json
import platform
import socket
import time
import urllib.error
import urllib.request
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from wifi_survey import __version__
from wifi_survey.collect.measure import Cancelled, measure_point
from wifi_survey.collect.runner import Runner
from wifi_survey.collect.wifi import parse_iw_list
from wifi_survey.config import SurveyConfig, user_config_path

POLL_WAIT_S = 25


class ApiError(Exception):
    pass


class Api(Protocol):
    def post(self, path: str, body: dict[str, Any], timeout: float = 15) -> tuple[int, Any]: ...


@dataclass
class HttpApi:
    base_url: str

    def post(self, path: str, body: dict[str, Any], timeout: float = 15) -> tuple[int, Any]:
        req = urllib.request.Request(
            self.base_url.rstrip("/") + path,
            data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:  # LAN URL from the user's config
                raw = r.read()
                return r.status, (json.loads(raw) if raw else None)
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                return e.code, json.loads(raw) if raw else None
            except json.JSONDecodeError:
                return e.code, None
        except (urllib.error.URLError, OSError, TimeoutError) as e:
            raise ApiError(str(getattr(e, "reason", e))) from e


def agent_id(path: Path | None = None) -> str:
    """Stable per-laptop id, so the page recognises the same agent across restarts."""
    path = path or user_config_path().with_name("agent-id")
    try:
        existing = path.read_text().strip()
        if existing:
            return existing
    except OSError:
        pass
    new = str(uuid.uuid4())
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(new + "\n")
    except OSError:
        pass
    return new


def agent_info(runner: Runner, iface: str) -> dict[str, Any]:
    caps = parse_iw_list(runner.run(["iw", "list"]).stdout)
    driver = None
    with contextlib.suppress(OSError):
        driver = Path(f"/sys/class/net/{iface}/device/driver").resolve().name
    iw_version = runner.run(["iw", "--version"]).stdout.strip() or None
    return {
        "hostname": socket.gethostname(),
        "version": __version__,
        "interface": iface,
        "kernel": platform.release(),
        "driver": driver,
        "iw": iw_version,
        "capabilities": {
            "bands": caps.bands,
            "he": caps.he,
            "eht": caps.eht,
            "six_ghz_channels": caps.freqs_6ghz_enabled,
        },
    }


Log = Callable[[str], None]


@dataclass
class Agent:
    cfg: SurveyConfig
    runner: Runner
    api: Api
    iface: str
    agent_id: str
    log: Log = print
    sleep: Callable[[float], None] = time.sleep

    def __post_init__(self) -> None:
        self.info = agent_info(self.runner, self.iface)

    def poll_once(self, wait: float = POLL_WAIT_S) -> dict[str, Any] | None:
        status, body = self.api.post(
            "/api/survey-agent/poll",
            {"agentId": self.agent_id, **self.info, "wait": wait},
            timeout=wait + 15,
        )
        if status == 200 and body and body.get("job"):
            return body["job"]
        if status in (200, 204):
            return None
        raise ApiError(f"poll failed: HTTP {status} {body}")

    def progress(self, job: dict[str, Any], step: str, message: str) -> bool:
        self.log(f"  · {message}")
        try:
            status, _ = self.api.post(
                f"/api/survey-agent/jobs/{job['pointId']}/progress",
                {"agentId": self.agent_id, "step": step, "message": message},
            )
        except ApiError:
            return True  # keep measuring; the result post will retry
        return status != 409

    def post_result(self, job: dict[str, Any], record: dict[str, Any] | None, error: str | None) -> None:
        body = {"agentId": self.agent_id, "record": record, "error": error, "agent": self.info}
        for attempt in range(5):
            try:
                status, _ = self.api.post(f"/api/survey-agent/jobs/{job['pointId']}/result", body)
                if status == 409:
                    self.log("  Job was cancelled on the page; result discarded.")
                return
            except ApiError as e:
                self.log(f"  Couldn't send result ({e}); retrying…")
                self.sleep(min(2**attempt, 15))
        self.log("  Gave up sending the result.")

    def handle(self, job: dict[str, Any]) -> dict[str, Any] | None:
        self.log(f"▶ Measuring {job['label']}")
        try:
            record = measure_point(
                job,
                self.cfg,
                self.runner,
                self.iface,
                lambda s, m: self.progress(job, s, m),
                sleep=self.sleep,
            )
        except Cancelled:
            self.log("  Cancelled from the page.")
            return None
        except KeyboardInterrupt:
            self.post_result(job, None, "Agent was stopped mid-measurement (Ctrl+C)")
            raise
        except Exception as e:  # report, don't crash the agent
            self.log(f"  Measurement failed: {e}")
            self.post_result(job, None, f"Measurement failed: {e}")
            return None
        self.post_result(job, record, None)
        self.log("  " + summarize(record))
        return record

    def run(self, once: bool = False) -> None:
        backoff = 1.0
        while True:
            try:
                job = self.poll_once()
                backoff = 1.0
            except ApiError as e:
                self.log(f"Home planner unreachable ({e}); retrying in {backoff:.0f}s")
                self.sleep(backoff)
                backoff = min(backoff * 2, 30)
                continue
            if job is None:
                continue
            self.handle(job)
            if once:
                return


def summarize(record: dict[str, Any]) -> str:
    c = record.get("connected") or {}
    t = record.get("throughput") or {}
    lat = record.get("latency") or {}
    parts = []
    if c:
        parts.append(f"{c.get('signal_dbm')} dBm on {c.get('band')} GHz ch {c.get('channel')}")
    else:
        parts.append("not connected")
    if t.get("down_mbps") is not None:
        parts.append(f"↓ {t['down_mbps']:.0f} / ↑ {t.get('up_mbps') or 0:.0f} Mbps")
    if lat.get("avg_ms") is not None:
        parts.append(f"{lat['avg_ms']:.1f} ms")
    parts.append(f"{len(record.get('scan') or [])} BSSIDs")
    warn = record.get("warnings") or []
    return (
        "✔ " + " · ".join(parts) + (f"  ({len(warn)} warning{'s' if len(warn) != 1 else ''})" if warn else "")
    )

"""Throughput (iperf3) and latency (ping) measurements."""

from __future__ import annotations

import itertools
import json
import math
import re
import time
from collections.abc import Callable

from pydantic import BaseModel

from wifi_survey.collect.runner import Runner


class IperfResult(BaseModel):
    mbps: float | None = None
    retransmits: int | None = None
    duration_s: float | None = None
    error: str | None = None


def parse_iperf_json(text: str) -> IperfResult:
    """Parse `iperf3 -J`. The receiver's rate is the honest one in both directions."""
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return IperfResult(error=(text.strip().splitlines() or ["no output"])[-1][:200])
    if err := data.get("error"):
        return IperfResult(error=str(err))
    end = data.get("end") or {}
    recv, sent = end.get("sum_received") or {}, end.get("sum_sent") or {}
    if "bits_per_second" not in recv:
        return IperfResult(error="iperf3 returned no summary")
    return IperfResult(
        mbps=round(recv["bits_per_second"] / 1e6, 1),
        retransmits=sent.get("retransmits"),
        duration_s=round(recv.get("seconds", 0.0), 2),
    )


def run_iperf(
    runner: Runner,
    server: str,
    port: int,
    duration_s: int,
    *,
    download: bool,
    sleep: Callable[[float], None] = time.sleep,
) -> IperfResult:
    """download=True uses -R (server sends). Retries once if the server is busy."""
    args = ["iperf3", "-c", server, "-p", str(port), "-t", str(duration_s), "-J", "--connect-timeout", "3000"]
    if download:
        args.append("-R")
    result = IperfResult(error="not run")
    for attempt in range(2):
        res = runner.run(args, timeout=duration_s + 15)
        result = parse_iperf_json(res.stdout or res.stderr)
        if result.error and "busy" in result.error and attempt == 0:
            sleep(3)
            continue
        break
    return result


class PingResult(BaseModel):
    target: str
    sent: int = 0
    received: int = 0
    loss_pct: float = 100.0
    avg_ms: float | None = None
    p95_ms: float | None = None
    jitter_ms: float | None = None
    min_ms: float | None = None
    max_ms: float | None = None


_TIME = re.compile(r"time[=<]([\d.]+) ms")
_SUMMARY = re.compile(r"(\d+) packets transmitted, (\d+) (?:packets )?received")


def parse_ping(text: str, target: str) -> PingResult:
    times = [float(t) for t in _TIME.findall(text)]
    m = _SUMMARY.search(text)
    sent = int(m.group(1)) if m else len(times)
    received = int(m.group(2)) if m else len(times)
    out = PingResult(target=target, sent=sent, received=received)
    if sent:
        out.loss_pct = round(100 * (sent - received) / sent, 1)
    if times:
        s = sorted(times)
        out.avg_ms = round(sum(times) / len(times), 3)
        out.p95_ms = round(s[max(0, math.ceil(0.95 * len(s)) - 1)], 3)
        out.min_ms, out.max_ms = s[0], s[-1]
        # RFC 3550-style: mean absolute difference between consecutive replies.
        diffs = [abs(b - a) for a, b in itertools.pairwise(times)]
        out.jitter_ms = round(sum(diffs) / len(diffs), 3) if diffs else 0.0
    return out


def run_ping(runner: Runner, target: str, count: int) -> PingResult:
    res = runner.run(
        ["ping", "-n", "-c", str(count), "-i", "0.2", "-W", "1", target], timeout=count * 0.2 + 10
    )
    return parse_ping(res.stdout, target)

"""Take one survey measurement and build the spec §2.2 point record."""

from __future__ import annotations

import statistics
import time
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from wifi_survey import SCHEMA_VERSION
from wifi_survey.collect.doctor import default_gateway
from wifi_survey.collect.perf import run_iperf, run_ping
from wifi_survey.collect.runner import Runner
from wifi_survey.collect.wifi import (
    NMCLI_FIELDS,
    LinkInfo,
    ScanEntry,
    parse_iw_link,
    parse_iw_scan_dump,
    parse_nmcli_wifi_list,
)
from wifi_survey.config import SurveyConfig

# Return False to cancel the measurement (the server said the job is gone).
ProgressFn = Callable[[str, str], bool]

SCAN_FIRST_WAIT_S = 2.0  # first look at the results this long after requesting a rescan
SCAN_MAX_WAIT_S = 10.0  # a full 2.4/5/6 GHz scan can take several seconds
FRESH_MS = 15_000  # without our own rescan, accept cached results up to this old

POLKIT_HINT = (
    "NetworkManager refused the rescan (not authorized). Run the agent from a terminal in your desktop "
    "session, or allow scans with a polkit rule — see `wifi-survey doctor`."
)


class MeasurementError(Exception):
    pass


def scan_sample(
    runner: Runner, iface: str, sleep: Callable[[float], None]
) -> tuple[list[ScanEntry], str, str | None]:
    """One scan: request a rescan, then wait for results seen *after* the request.

    Returns (entries, source, rescan_error). Cached results from before the request
    may come from wherever the laptop was earlier, so they're only accepted (up to
    FRESH_MS old) when NetworkManager won't rescan for us.
    """
    res = runner.run(["nmcli", "device", "wifi", "rescan", "ifname", iface])
    rescan_error = None if res.ok else (res.stderr.strip() or f"exit {res.returncode}")
    elapsed = 0.0
    while True:
        step = SCAN_FIRST_WAIT_S if elapsed == 0 else 1.0
        sleep(step)
        elapsed += step
        dump = runner.run(["iw", "dev", iface, "scan", "dump"])
        if not dump.ok:
            # iw can't read the scan cache here; nmcli can (no age info, signal in %).
            nm = runner.run(
                ["nmcli", "-t", "-f", NMCLI_FIELDS, "dev", "wifi", "list", "ifname", iface, "--rescan", "no"]
            )
            return (parse_nmcli_wifi_list(nm.stdout) if nm.ok else []), "nmcli", rescan_error
        limit_ms = elapsed * 1000 + 500 if rescan_error is None else FRESH_MS
        fresh = [
            e for e in parse_iw_scan_dump(dump.stdout) if e.last_seen_ms is None or e.last_seen_ms <= limit_ms
        ]
        if fresh or elapsed >= SCAN_MAX_WAIT_S:
            return fresh, "iw", rescan_error


class Cancelled(Exception):
    pass


def _step(progress: ProgressFn, step: str, message: str) -> None:
    if not progress(step, message):
        raise Cancelled(step)


def aggregate_scans(samples: list[list[ScanEntry]]) -> list[dict[str, Any]]:
    """Median signal per BSSID across samples (spec: N samples, median per BSSID)."""
    by_bssid: dict[str, list[ScanEntry]] = {}
    for sample in samples:
        for e in sample:
            by_bssid.setdefault(e.bssid, []).append(e)
    out: list[dict[str, Any]] = []
    for bssid, seen in by_bssid.items():
        last = seen[-1]
        out.append(
            {
                "bssid": bssid,
                "ssid": last.ssid,
                "freq_mhz": last.freq_mhz,
                "band": last.band,
                "channel": last.channel,
                "width_mhz": last.width_mhz,
                "signal_dbm": round(statistics.median(e.signal_dbm for e in seen), 1),
                "seen_in": len(seen),
                "wifi_gen": last.wifi_gen,
                "station_count": last.station_count,
                "channel_utilisation": last.channel_utilisation,
                "source": last.source,
            }
        )
    out.sort(key=lambda e: e["signal_dbm"], reverse=True)
    return out


def connected_record(links: list[LinkInfo]) -> dict[str, Any] | None:
    up = [lk for lk in links if lk.connected]
    if not up:
        return None
    last = up[-1]
    signals = [lk.signal_dbm for lk in up if lk.signal_dbm is not None]
    return {
        "bssid": last.bssid,
        "ssid": last.ssid,
        "freq_mhz": last.freq_mhz,
        "band": last.band,
        "channel": last.channel,
        "width_mhz": last.width_mhz,
        "signal_dbm": round(statistics.median(signals), 1) if signals else None,
        "rx_bitrate_mbps": last.rx_bitrate_mbps,
        "tx_bitrate_mbps": last.tx_bitrate_mbps,
        "rx_mcs": last.rx_mcs,
        "tx_mcs": last.tx_mcs,
        "nss": last.nss,
        "phy_mode": last.phy_mode,
        "roamed": len({lk.bssid for lk in up}) > 1,
    }


def measure_point(
    job: dict[str, Any],
    cfg: SurveyConfig,
    runner: Runner,
    iface: str,
    progress: ProgressFn,
    *,
    sleep: Callable[[float], None] = time.sleep,
) -> dict[str, Any]:
    warnings: list[str] = []
    n = max(1, cfg.samples_per_point)

    _step(progress, "settle", f"Hold the laptop at about {cfg.height_m:g} m and keep still")
    sleep(cfg.settle_s)

    samples: list[list[ScanEntry]] = []
    links: list[LinkInfo] = []
    source = "iw"
    rescan_errors: set[str] = set()
    for i in range(n):
        _step(progress, "scan", f"Scanning {i + 1}/{n}")
        entries, src, rescan_error = scan_sample(runner, iface, sleep)
        if src == "nmcli":
            source = "nmcli"
        if rescan_error:
            rescan_errors.add(rescan_error)
        if entries:
            samples.append(entries)
        links.append(parse_iw_link(runner.run(["iw", "dev", iface, "link"]).stdout))

    if not samples:
        if any("not authorized" in e.lower() for e in rescan_errors):
            raise MeasurementError(POLKIT_HINT)
        raise MeasurementError("No fresh Wi-Fi scan results within 10 s — is the Wi-Fi radio on?")
    if rescan_errors:
        warnings.append(
            "Couldn't request a fresh scan; used NetworkManager's background results (≤ 15 s old): "
            + "; ".join(sorted(rescan_errors))
        )
    if len(samples) < n:
        warnings.append(f"Only {len(samples)} of {n} scans returned fresh results")

    connected = connected_record(links)
    if connected is None:
        warnings.append("Laptop was not connected to Wi-Fi during this measurement")
    elif connected["roamed"]:
        warnings.append("Laptop roamed between access points during the measurement")
    if source == "nmcli":
        warnings.append("Scan used nmcli (signal converted from %; less precise)")

    throughput: dict[str, Any] | None = None
    if not cfg.iperf.server:
        warnings.append("No iperf3 server configured; throughput skipped")
    elif runner.which("iperf3") is None:
        warnings.append("iperf3 is not installed; throughput skipped")
    elif connected is None:
        warnings.append("Not connected; throughput skipped")
    else:
        d = cfg.iperf.duration_s
        _step(progress, "download", f"Download test ({d}s)")
        down = run_iperf(runner, cfg.iperf.server, cfg.iperf.port, d, download=True, sleep=sleep)
        _step(progress, "upload", f"Upload test ({d}s)")
        up = run_iperf(runner, cfg.iperf.server, cfg.iperf.port, d, download=False, sleep=sleep)
        for name, r in (("download", down), ("upload", up)):
            if r.error:
                warnings.append(f"iperf3 {name} failed: {r.error}")
        throughput = {
            "down_mbps": down.mbps,
            "up_mbps": up.mbps,
            "retransmits": up.retransmits,
            "duration_s": d,
            "server": cfg.iperf.server,
        }

    _step(progress, "latency", "Latency test")
    latency: dict[str, Any] | None = None
    target = cfg.ping.target
    label = target
    if target == "gateway":
        target = default_gateway(runner.run(["ip", "route", "show", "default"]).stdout) or ""
    if target:
        ping = run_ping(runner, target, cfg.ping.count)
        if ping.received == 0 and cfg.ping.target == "gateway" and cfg.iperf.server:
            # Many routers ignore ping; the wired iperf3 server is the next-best round trip.
            ping = run_ping(runner, cfg.iperf.server, cfg.ping.count)
            label = "iperf_server"
            warnings.append("Gateway didn't answer ping; latency measured to the iperf3 server")
        latency = {
            "target": label,
            "host": ping.target,
            "avg_ms": ping.avg_ms,
            "p95_ms": ping.p95_ms,
            "jitter_ms": ping.jitter_ms,
            "loss_pct": ping.loss_pct,
        }
    else:
        warnings.append("No ping target (no default gateway)")

    return {
        "schema_version": SCHEMA_VERSION,
        "point_id": job.get("label"),
        "floor_id": job.get("floorId"),
        "room_id": job.get("roomId"),
        "pos": job.get("pos_m"),
        "height_m": cfg.height_m,
        "timestamp": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "survey_type": job.get("surveyType"),
        "connected": connected,
        "scan": aggregate_scans(samples),
        "scan_source": source,
        "throughput": throughput,
        "latency": latency,
        "samples": n,
        "warnings": warnings,
        "notes": "",
    }

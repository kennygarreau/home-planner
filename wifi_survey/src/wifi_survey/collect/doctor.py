"""`wifi-survey doctor`: is this machine ready to survey? (spec Phase 0)"""

from __future__ import annotations

import json
import re
import socket
import urllib.error
import urllib.request
from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from typing import Literal

from wifi_survey.collect.redact import Redactor
from wifi_survey.collect.runner import Runner
from wifi_survey.collect.wifi import (
    NMCLI_FIELDS,
    detect_interface,
    parse_iw_link,
    parse_iw_list,
    parse_iw_reg,
    parse_iw_scan_dump,
    parse_nmcli_wifi_list,
)
from wifi_survey.config import SurveyConfig

Status = Literal["pass", "warn", "fail", "skip"]

# Lets members of `wheel` ask NetworkManager for a Wi-Fi scan from any session
# (SSH, systemd units). Desktop terminals are usually allowed already.
POLKIT_RULE_PATH = "/etc/polkit-1/rules.d/50-wifi-survey.rules"
POLKIT_RULE = (
    "polkit.addRule(function(action, subject) {\n"
    '  if (action.id == "org.freedesktop.NetworkManager.wifi.scan" && subject.isInGroup("wheel"))\n'
    "    return polkit.Result.YES;\n"
    "});"
)
POLKIT_FIX = f"sudo tee {POLKIT_RULE_PATH} <<'EOF'\n{POLKIT_RULE}\nEOF"


@dataclass
class Check:
    name: str
    status: Status
    detail: str
    fix: str | None = None


@dataclass
class DoctorReport:
    interface: str | None
    checks: list[Check] = field(default_factory=list)
    scan_source: str | None = None  # "iw" | "nmcli" | None

    @property
    def ok(self) -> bool:
        return not any(c.status == "fail" for c in self.checks)

    def to_json(self) -> str:
        return json.dumps({"ok": self.ok, **asdict(self)}, indent=2)


TcpProbe = Callable[[str, int, float], str | None]
HttpProbe = Callable[[str, float], str | None]


def tcp_probe(host: str, port: int, timeout: float) -> str | None:
    """None if a TCP connection succeeds, otherwise the error text."""
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return None
    except OSError as e:
        return str(e)


def http_probe(url: str, timeout: float) -> str | None:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return None if r.status == 200 else f"HTTP {r.status}"
    except (urllib.error.URLError, OSError) as e:
        return str(getattr(e, "reason", e))


def default_gateway(ip_route_output: str) -> str | None:
    m = re.search(r"^default via (\S+)", ip_route_output, re.MULTILINE)
    return m.group(1) if m else None


def run_doctor(
    cfg: SurveyConfig,
    runner: Runner,
    *,
    redact: bool = False,
    tcp: TcpProbe = tcp_probe,
    http: HttpProbe = http_probe,
) -> DoctorReport:
    r = Redactor() if redact else None
    show = (lambda s: r.text(s)) if r else (lambda s: s)
    checks: list[Check] = []
    add = lambda *a, **k: checks.append(Check(*a, **k))  # noqa: E731

    # ── Tools ────────────────────────────────────────────────────────────────
    have = {t: runner.which(t) is not None for t in ("iw", "nmcli", "iperf3", "ping", "ip")}
    add(
        "iw installed",
        "pass" if have["iw"] else "fail",
        runner.which("iw") or "not found",
        None if have["iw"] else "sudo pacman -S iw",
    )
    add(
        "nmcli installed",
        "pass" if have["nmcli"] else "warn",
        runner.which("nmcli") or "not found",
        None if have["nmcli"] else "NetworkManager is the fallback scanner and triggers rescans",
    )
    add(
        "iperf3 installed",
        "pass" if have["iperf3"] else "warn",
        runner.which("iperf3") or "not found",
        None if have["iperf3"] else "sudo pacman -S iperf3  (needed for throughput)",
    )

    # ── Interface ────────────────────────────────────────────────────────────
    iface: str | None = None
    if cfg.interface != "auto":
        iface = cfg.interface
        add("Wireless interface", "pass", f"{iface} (from config)")
    elif have["iw"]:
        iface = detect_interface(runner.run(["iw", "dev"]).stdout)
        add("Wireless interface", "pass" if iface else "fail", iface or "no managed Wi-Fi interface found")
    report = DoctorReport(interface=iface, checks=checks)
    if not iface or not have["iw"]:
        return report

    # ── Radio capabilities ───────────────────────────────────────────────────
    caps = parse_iw_list(runner.run(["iw", "list"]).stdout)
    add(
        "Bands supported",
        "pass" if caps.bands else "warn",
        ", ".join(f"{b} GHz" for b in caps.bands) or "unknown",
    )
    country = parse_iw_reg(runner.run(["iw", "reg", "get"]).stdout)
    reg_unset = country in (None, "00")
    if caps.freqs_6ghz_enabled:
        add("6 GHz", "pass", f"{caps.freqs_6ghz_enabled} channels enabled")
    elif caps.freqs_6ghz_disabled:
        add(
            "6 GHz",
            "warn",
            f"radio has 6 GHz but all {caps.freqs_6ghz_disabled} channels are disabled",
            "Usually the regulatory domain; see the next check",
        )
    else:
        add("6 GHz", "warn", "not supported by this radio — 6 GHz can only be predicted")
    add(
        "Regulatory domain",
        "warn" if reg_unset else "pass",
        country or "unknown",
        "Set your country: `sudo iw reg set US` (persist via /etc/conf.d/wireless-regdom)"
        if reg_unset
        else None,
    )
    add(
        "Wi-Fi 6 / 7 (HE / EHT)",
        "pass" if caps.eht else "warn",
        f"HE {'yes' if caps.he else 'no'}, EHT {'yes' if caps.eht else 'no'}",
        None if caps.eht else "Wi-Fi 7 link rates won't be measurable with this radio",
    )

    # ── Link ─────────────────────────────────────────────────────────────────
    link = parse_iw_link(runner.run(["iw", "dev", iface, "link"]).stdout)
    if link.connected:
        ssid = r.ssid(link.ssid or "") if r else link.ssid
        add(
            "Connected",
            "pass",
            f"{ssid} · {link.band} GHz ch {link.channel} · {link.width_mhz} MHz · {link.signal_dbm} dBm"
            + (f" · {link.phy_mode}" if link.phy_mode else ""),
        )
    else:
        add("Connected", "fail", "not connected to Wi-Fi", "Connect to the network you want to survey")

    # ── Scanning without root ────────────────────────────────────────────────
    dump = runner.run(["iw", "dev", iface, "scan", "dump"])
    entries = parse_iw_scan_dump(dump.stdout) if dump.ok else []
    if entries:
        bands = sorted({e.band for e in entries if e.band})
        add("Scan dump (no root)", "pass", f"{len(entries)} BSSIDs cached ({', '.join(bands)} GHz)")
        report.scan_source = "iw"
    elif dump.ok:
        add(
            "Scan dump (no root)",
            "warn",
            "works, but the cache is empty",
            "Run `nmcli dev wifi rescan` then retry; the survey does this automatically",
        )
        report.scan_source = "iw"
    else:
        add(
            "Scan dump (no root)",
            "fail" if not have["nmcli"] else "warn",
            show(dump.stderr.strip() or f"exit {dump.returncode}"),
            "Will fall back to nmcli (signal in %)",
        )
    if have["nmcli"]:
        rs = runner.run(["nmcli", "device", "wifi", "rescan", "ifname", iface])
        err = rs.stderr.strip()
        if rs.ok:
            add("Rescan permission", "pass", "NetworkManager accepts scan requests")
        elif "not authorized" in err.lower():
            add(
                "Rescan permission",
                "fail",
                "NetworkManager refused the scan request (not authorized) — readings would be stale",
                "Run from a terminal in your desktop session, or allow it once with:\n" + POLKIT_FIX,
            )
        else:
            add(
                "Rescan permission",
                "warn",
                show(err or f"exit {rs.returncode}"),
                "Often just rate-limiting right after another scan; re-run doctor in a few seconds",
            )
        nm = runner.run(
            ["nmcli", "-t", "-f", NMCLI_FIELDS, "dev", "wifi", "list", "ifname", iface, "--rescan", "no"]
        )
        nm_entries = parse_nmcli_wifi_list(nm.stdout) if nm.ok else []
        add(
            "nmcli scan list",
            "pass" if nm_entries else "warn",
            f"{len(nm_entries)} networks" if nm.ok else show(nm.stderr.strip()),
        )
        if report.scan_source is None and nm_entries:
            report.scan_source = "nmcli"

    # ── Network reachability ─────────────────────────────────────────────────
    gw = default_gateway(runner.run(["ip", "route", "show", "default"]).stdout) if have["ip"] else None
    if gw and have["ping"]:
        p = runner.run(["ping", "-c", "3", "-i", "0.2", "-W", "1", gw], timeout=10)
        m = re.search(r"= [\d.]+/([\d.]+)/", p.stdout)
        if p.ok:
            add("Gateway ping", "pass", f"{gw}" + (f" · avg {m.group(1)} ms" if m else ""))
        else:
            add(
                "Gateway ping",
                "warn",
                f"{gw} · no reply (many routers ignore ping)",
                "Set ping.target in survey.yaml to a host that answers, e.g. the iperf3 server",
            )
    else:
        add("Gateway ping", "skip", "no default gateway" if not gw else "ping not installed")

    if cfg.iperf.server:
        err = tcp(cfg.iperf.server, cfg.iperf.port, 2.0)
        add(
            "iperf3 server",
            "pass" if err is None else "warn",
            f"{cfg.iperf.server}:{cfg.iperf.port}" + ("" if err is None else f" — {err}"),
            None if err is None else "Start `iperf3 -s` on the wired machine",
        )
    else:
        add("iperf3 server", "skip", "not configured", "Set iperf.server in survey.yaml")

    if cfg.home_planner_url:
        url = cfg.home_planner_url.rstrip("/") + "/api/health"
        err = http(url, 3.0)
        add(
            "Home planner",
            "pass" if err is None else "warn",
            cfg.home_planner_url + ("" if err is None else f" — {err}"),
        )
    else:
        add("Home planner", "skip", "not configured")

    return report

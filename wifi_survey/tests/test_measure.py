import re

import pytest

from wifi_survey.collect.measure import Cancelled, MeasurementError, aggregate_scans, measure_point
from wifi_survey.collect.runner import CmdResult, FakeRunner
from wifi_survey.collect.wifi import ScanEntry
from wifi_survey.config import SurveyConfig

REAL = "server-cnvi-ax"
IF = "wlp128s20f3"
JOB = {
    "pointId": "p1",
    "label": "kitchen-01",
    "floorId": "f1",
    "roomId": "r1",
    "pos_m": [3.048, 2.438],
    "surveyType": "baseline",
}


def entry(bssid, sig, **kw):
    return ScanEntry(bssid=bssid, freq_mhz=5180, band="5", channel=36, signal_dbm=sig, **kw)


def test_aggregate_takes_median_and_sorts():
    out = aggregate_scans([[entry("a", -70), entry("b", -50)], [entry("a", -60)], [entry("a", -66)]])
    assert [e["bssid"] for e in out] == ["b", "a"]
    a = out[1]
    assert a["signal_dbm"] == -66 and a["seen_in"] == 3
    assert out[0]["seen_in"] == 1


def runner(fixture_text, over=None):
    r = {
        ("nmcli", "device", "wifi", "rescan"): "",
        ("iw", "dev", IF, "scan", "dump"): fixture_text(REAL, "iw_scan_dump.txt"),
        ("iw", "dev", IF, "link"): fixture_text("synthetic", "iw_link_he_5ghz.txt"),
        ("iperf3",): lambda a: CmdResult(
            a, 0, fixture_text("perf", "iperf_down.json" if "-R" in a else "iperf_up.json")
        ),
        ("ip", "route", "show", "default"): "default via 10.0.0.254 dev wlan0\n",
        ("ping", "-n", "-c", "20", "-i", "0.2", "-W", "1", "10.0.0.254"): fixture_text(
            "perf", "ping_noreply.txt"
        ),
        ("ping", "-n", "-c", "20", "-i", "0.2", "-W", "1", "10.0.0.1"): fixture_text("perf", "ping_ok.txt"),
    }
    r.update(over or {})
    return FakeRunner(r)


def cfg():
    return SurveyConfig(iperf={"server": "10.0.0.1", "duration_s": 10}, samples_per_point=3)


def test_full_measurement(fixture_text):
    steps = []
    rec = measure_point(
        JOB, cfg(), runner(fixture_text), IF, lambda s, m: steps.append(s) or True, sleep=lambda s: None
    )
    assert steps == ["settle", "scan", "scan", "scan", "download", "upload", "latency"]
    assert rec["schema_version"] == 1 and rec["point_id"] == "kitchen-01" and rec["pos"] == [3.048, 2.438]
    assert rec["connected"]["signal_dbm"] == -69 and rec["connected"]["band"] == "5"
    assert rec["throughput"]["down_mbps"] > 0 and rec["throughput"]["up_mbps"] > 0
    assert len(rec["scan"]) == 5 and all(e["seen_in"] == 3 for e in rec["scan"])
    # Gateway ignores ping → falls back to the iperf3 server
    assert rec["latency"]["target"] == "iperf_server" and rec["latency"]["loss_pct"] == 0.0
    assert any("Gateway didn't answer" in w for w in rec["warnings"])


def test_not_connected_skips_throughput(fixture_text):
    r = runner(fixture_text, {("iw", "dev", IF, "link"): "Not connected.\n"})
    rec = measure_point(JOB, cfg(), r, IF, lambda s, m: True, sleep=lambda s: None)
    assert rec["connected"] is None and rec["throughput"] is None
    assert not any(c[0] == "iperf3" for c in r.calls)


DENIED = CmdResult(
    ("nmcli",), 1, "", "Error: org.freedesktop.NetworkManager.wifi.scan request failed: not authorized."
)


def test_rescan_refused_and_cache_stale_fails_clearly(fixture_text):
    stale = re.sub(r"\d+ ms ago", "99999 ms ago", fixture_text(REAL, "iw_scan_dump.txt"))
    r = runner(
        fixture_text,
        {("iw", "dev", IF, "scan", "dump"): stale, ("nmcli", "device", "wifi", "rescan"): DENIED},
    )
    with pytest.raises(MeasurementError, match="polkit"):
        measure_point(JOB, cfg(), r, IF, lambda s, m: True, sleep=lambda s: None)


def test_rescan_refused_but_background_scan_is_fresh(fixture_text):
    r = runner(fixture_text, {("nmcli", "device", "wifi", "rescan"): DENIED})  # fixture entries are ~10 s old
    rec = measure_point(JOB, cfg(), r, IF, lambda s, m: True, sleep=lambda s: None)
    assert rec["scan"] and rec["scan_source"] == "iw"
    assert any("Couldn't request a fresh scan" in w for w in rec["warnings"])


def test_only_results_seen_after_the_rescan_count(fixture_text):
    waits = []
    rec = measure_point(JOB, cfg(), runner(fixture_text), IF, lambda s, m: True, sleep=waits.append)
    # Fixture entries were last seen ~10.1 s ago, so each scan waits until 10 s have elapsed.
    assert sum(w for w in waits if w in (1.0, 2.0)) >= 3 * 10
    assert len(rec["scan"]) == 5


def test_iw_dump_not_permitted_uses_nmcli(fixture_text):
    r = runner(
        fixture_text,
        {
            ("iw", "dev", IF, "scan", "dump"): CmdResult(
                ("iw",), 255, "", "command failed: Operation not permitted (-1)"
            ),
            ("nmcli", "-t"): fixture_text(REAL, "nmcli_wifi_list.txt"),
        },
    )
    rec = measure_point(JOB, cfg(), r, IF, lambda s, m: True, sleep=lambda s: None)
    assert rec["scan_source"] == "nmcli" and rec["scan"]


def test_cancel_stops_before_throughput(fixture_text):
    r = runner(fixture_text)
    with pytest.raises(Cancelled):
        measure_point(JOB, cfg(), r, IF, lambda s, m: s != "download", sleep=lambda s: None)
    assert not any(c[0] == "iperf3" for c in r.calls)

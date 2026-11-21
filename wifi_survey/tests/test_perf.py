import pytest

from wifi_survey.collect.perf import parse_iperf_json, parse_ping, run_iperf
from wifi_survey.collect.runner import CmdResult, FakeRunner


def test_iperf_upload_and_download_real(fixture_text):
    up = parse_iperf_json(fixture_text("perf", "iperf_up.json"))
    down = parse_iperf_json(fixture_text("perf", "iperf_down.json"))
    assert up.error is None and down.error is None
    assert up.mbps == pytest.approx(42763, rel=0.01)
    assert down.mbps == pytest.approx(44379, rel=0.01)
    assert up.retransmits == 0 and up.duration_s == pytest.approx(2.0, abs=0.01)


def test_iperf_refused_real(fixture_text):
    r = parse_iperf_json(fixture_text("perf", "iperf_refused.json"))
    assert r.mbps is None and "Connection refused" in r.error


def test_iperf_non_json():
    assert parse_iperf_json("iperf3: error - unable to connect").error == "iperf3: error - unable to connect"


def test_iperf_retries_once_when_busy(fixture_text):
    calls = []

    def respond(args):
        calls.append(args)
        if len(calls) == 1:
            return CmdResult(args, 1, '{"error": "the server is busy running a test. try again later"}')
        return CmdResult(args, 0, fixture_text("perf", "iperf_down.json"))

    r = run_iperf(FakeRunner({("iperf3",): respond}), "srv", 5201, 10, download=True, sleep=lambda s: None)
    assert r.error is None and len(calls) == 2
    assert "-R" in calls[0] and "--connect-timeout" in calls[0]


def test_ping_ok_real(fixture_text):
    p = parse_ping(fixture_text("perf", "ping_ok.txt"), "10.0.0.1")
    assert (p.sent, p.received, p.loss_pct) == (10, 10, 0.0)
    assert p.avg_ms == pytest.approx(0.045, abs=0.002)  # matches ping's own summary
    assert p.min_ms <= p.p95_ms <= p.max_ms
    assert p.jitter_ms is not None and p.jitter_ms >= 0


def test_ping_no_reply_real(fixture_text):
    p = parse_ping(fixture_text("perf", "ping_noreply.txt"), "10.0.0.254")
    assert (p.sent, p.received, p.loss_pct, p.avg_ms) == (5, 0, 100.0, None)


def test_ping_stats():
    text = "".join(
        f"64 bytes from x: icmp_seq={i} ttl=64 time={t} ms\n" for i, t in enumerate([1, 3, 2, 10], 1)
    )
    text += "4 packets transmitted, 4 received, 0% packet loss, time 600ms\n"
    p = parse_ping(text, "x")
    assert p.avg_ms == 4.0 and p.p95_ms == 10.0
    assert p.jitter_ms == pytest.approx((2 + 1 + 8) / 3, abs=1e-3)

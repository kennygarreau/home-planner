from wifi_survey.collect.doctor import default_gateway, run_doctor
from wifi_survey.collect.runner import CmdResult, FakeRunner
from wifi_survey.config import SurveyConfig

REAL = "server-cnvi-ax"
PING_OK = (
    "--- 192.168.50.1 ping statistics ---\n3 packets transmitted, 3 received\n"
    "rtt min/avg/max/mdev = 1.1/2.5/4.0/0.3 ms\n"
)


def make_runner(fixture_text, link="synthetic/iw_link_he_5ghz.txt", overrides=None):
    folder, name = link.split("/")
    responses = {
        ("iw", "dev"): fixture_text(REAL, "iw_dev.txt").replace("wlo1", "wlp128s20f3"),
        ("iw", "list"): fixture_text(REAL, "iw_list.txt"),
        ("iw", "reg", "get"): "global\ncountry US: DFS-FCC\n",
        ("iw", "dev", "wlp128s20f3", "link"): fixture_text(folder, name),
        ("iw", "dev", "wlp128s20f3", "scan", "dump"): fixture_text(REAL, "iw_scan_dump.txt"),
        ("nmcli",): fixture_text(REAL, "nmcli_wifi_list.txt"),
        ("nmcli", "device", "wifi", "rescan"): "",
        (
            "ip",
            "route",
            "show",
            "default",
        ): "default via 192.168.50.1 dev wlp128s20f3 proto dhcp metric 600\n",
        ("ping",): PING_OK,
    }
    responses.update(overrides or {})
    return FakeRunner(responses)


def cfg(**kw):
    return SurveyConfig(home_planner_url="http://hp:3000", **{"iperf": {"server": "10.0.0.2"}, **kw})


def statuses(report):
    return {c.name: c.status for c in report.checks}


def test_happy_path(fixture_text):
    report = run_doctor(cfg(), make_runner(fixture_text), tcp=lambda *a: None, http=lambda *a: None)
    s = statuses(report)
    assert report.interface == "wlp128s20f3"
    assert report.ok, report.checks
    assert s["Connected"] == s["Scan dump (no root)"] == s["iperf3 server"] == s["Home planner"] == "pass"
    assert s["6 GHz"] == "warn" and s["Wi-Fi 6 / 7 (HE / EHT)"] == "warn"  # server card: no 6 GHz / EHT
    assert report.scan_source == "iw"
    assert "avg 2.5 ms" in next(c.detail for c in report.checks if c.name == "Gateway ping")


def test_not_connected_fails(fixture_text):
    report = run_doctor(
        cfg(),
        make_runner(fixture_text, link=f"{REAL}/iw_link.txt"),
        tcp=lambda *a: None,
        http=lambda *a: None,
    )
    assert not report.ok
    assert statuses(report)["Connected"] == "fail"


def test_scan_dump_needs_root_falls_back_to_nmcli(fixture_text):
    denied = CmdResult(("iw",), 255, "", "command failed: Operation not permitted (-1)")
    runner = make_runner(fixture_text, overrides={("iw", "dev", "wlp128s20f3", "scan", "dump"): denied})
    report = run_doctor(cfg(), runner, tcp=lambda *a: None, http=lambda *a: None)
    assert statuses(report)["Scan dump (no root)"] == "warn"
    assert report.scan_source == "nmcli"
    assert report.ok


def test_unset_regdomain_and_unreachable_services(fixture_text):
    runner = make_runner(fixture_text, overrides={("iw", "reg", "get"): "global\ncountry 00: DFS-UNSET\n"})
    report = run_doctor(cfg(), runner, tcp=lambda *a: "Connection refused", http=lambda *a: "timed out")
    s = statuses(report)
    assert s["Regulatory domain"] == "warn"
    assert s["iperf3 server"] == "warn" and s["Home planner"] == "warn"
    assert report.ok  # warnings don't block


def test_missing_iw_stops_early():
    runner = FakeRunner({}, installed={"nmcli"})
    report = run_doctor(SurveyConfig(), runner)
    assert not report.ok and report.interface is None
    assert statuses(report)["iw installed"] == "fail"


def test_redact_hides_ssid(fixture_text):
    report = run_doctor(
        cfg(), make_runner(fixture_text), redact=True, tcp=lambda *a: None, http=lambda *a: None
    )
    detail = next(c.detail for c in report.checks if c.name == "Connected")
    assert detail.startswith("SSID_") and "dBm" in detail


def test_default_gateway():
    assert default_gateway("default via 192.168.1.1 dev wlan0 proto dhcp\n") == "192.168.1.1"
    assert default_gateway("") is None


def test_rescan_not_authorized_fails_with_polkit_fix(fixture_text):
    denied = CmdResult(
        ("nmcli",), 1, "", "Error: org.freedesktop.NetworkManager.wifi.scan request failed: not authorized."
    )
    runner = make_runner(fixture_text, overrides={("nmcli", "device", "wifi", "rescan"): denied})
    report = run_doctor(cfg(), runner, tcp=lambda *a: None, http=lambda *a: None)
    check = next(c for c in report.checks if c.name == "Rescan permission")
    assert check.status == "fail" and not report.ok
    assert "polkit.addRule" in check.fix and "wheel" in check.fix


def test_power_save_on_warns(fixture_text):
    runner = make_runner(
        fixture_text, overrides={("iw", "dev", "wlp128s20f3", "get", "power_save"): "Power save: on\n"}
    )
    report = run_doctor(cfg(), runner, tcp=lambda *a: None, http=lambda *a: None)
    check = next(c for c in report.checks if c.name == "Wi-Fi power saving")
    assert check.status == "warn" and "power_save off" in check.fix
    assert report.ok  # a warning, not a blocker


def test_power_save_off_passes(fixture_text):
    runner = make_runner(
        fixture_text, overrides={("iw", "dev", "wlp128s20f3", "get", "power_save"): "Power save: off\n"}
    )
    report = run_doctor(cfg(), runner, tcp=lambda *a: None, http=lambda *a: None)
    assert next(c for c in report.checks if c.name == "Wi-Fi power saving").status == "pass"

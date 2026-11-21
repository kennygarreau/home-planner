from wifi_survey.collect.redact import Redactor
from wifi_survey.collect.wifi import parse_iw_scan_dump, parse_nmcli_wifi_list

SCAN = """BSS AA:BB:CC:11:22:33(on wlan0) -- associated
\tfreq: 5805.0
\tsignal: -60.00 dBm
\tSSID: Example Home
\tWPS:\t * Version: 1.0
\t\t * UUID: 1234abcd-0000
\t\t * Manufacturer: AcmeRouters
\t\t * Model Number: RX-1
\t\t * Serial Number: SN998877
\t\t * Device name: Living Room Router
BSS aa:bb:cc:11:22:34(on wlan0)
\tfreq: 2437.0
\tsignal: -70.00 dBm
\tSSID: Example Home
"""


def test_redacts_everything_sensitive():
    out = Redactor().text(SCAN)
    for secret in ("AA:BB:CC", "aa:bb:cc", "Example Home", "SN998877", "AcmeRouters", "Living Room", "1234abcd"):
        assert secret not in out
    assert "Version: 1.0" in out  # non-identifying WPS fields survive


def test_redaction_is_stable_and_still_parses():
    r = Redactor()
    entries = parse_iw_scan_dump(r.text(SCAN))
    assert [e.ssid for e in entries] == ["SSID_1", "SSID_1"]
    assert entries[0].bssid != entries[1].bssid
    assert entries[0].associated


def test_same_mac_maps_identically_across_tools():
    r = Redactor()
    iw = r.text("BSS aa:bb:cc:11:22:33(on wlan0)\n\tfreq: 2437\n\tsignal: -50.00 dBm\n\tSSID: Home\n")
    nm = r.nmcli_terse("*:AA\\:BB\\:CC\\:11\\:22\\:33:Home:6:2437 MHz:130 Mbit/s:80:WPA2\n")
    a = parse_iw_scan_dump(iw)[0]
    b = parse_nmcli_wifi_list(nm)[0]
    assert a.bssid == b.bssid and a.ssid == b.ssid == "SSID_1"

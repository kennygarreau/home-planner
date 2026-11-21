import pytest

from wifi_survey.collect.wifi import (
    band_of,
    channel_of,
    detect_interface,
    nm_percent_to_dbm,
    parse_iw_dev,
    parse_iw_link,
    parse_iw_list,
    parse_iw_reg,
    parse_iw_scan_dump,
    parse_nmcli_wifi_list,
    split_terse,
)

REAL = "server-cnvi-ax"


@pytest.mark.parametrize(
    ("freq", "band", "chan"),
    [
        (2412, "2.4", 1),
        (2437, "2.4", 6),
        (2484, "2.4", 14),
        (5180, "5", 36),
        (5805, "5", 161),
        (5885, "5", 177),
        (5935, "6", 2),
        (5955, "6", 1),
        (6115, "6", 33),
        (7115, "6", 233),
        (900, None, None),
    ],
)
def test_band_and_channel(freq, band, chan):
    assert band_of(freq) == band
    assert channel_of(freq) == chan


def test_iw_dev_real(fixture_text):
    assert parse_iw_dev(fixture_text(REAL, "iw_dev.txt")) == ["wlo1"]  # skips the P2P-device


def test_detect_interface_falls_back_to_sysfs(tmp_path):
    (tmp_path / "eth0").mkdir()
    (tmp_path / "wlp128s20f3" / "wireless").mkdir(parents=True)
    assert detect_interface("", tmp_path) == "wlp128s20f3"


def test_iw_link_not_connected_real(fixture_text):
    assert parse_iw_link(fixture_text(REAL, "iw_link.txt")).connected is False


def test_iw_link_he(fixture_text):
    link = parse_iw_link(fixture_text("synthetic", "iw_link_he_5ghz.txt"))
    assert link.connected and link.bssid == "02:00:00:00:aa:01" and link.ssid == "SSID_1"
    assert (link.freq_mhz, link.band, link.channel, link.width_mhz) == (5805, "5", 161, 80)
    assert link.signal_dbm == -69
    assert (link.rx_bitrate_mbps, link.tx_bitrate_mbps) == (216.1, 288.2)
    assert (link.rx_mcs, link.nss, link.phy_mode) == ("HE-MCS 2", 2, "HE")


def test_iw_link_eht_6ghz(fixture_text):
    link = parse_iw_link(fixture_text("synthetic", "iw_link_eht_6ghz.txt"))
    assert (link.band, link.channel, link.width_mhz, link.phy_mode) == ("6", 33, 160, "EHT")
    assert link.rx_mcs == "EHT-MCS 11" and link.tx_mcs == "EHT-MCS 9"


def test_iw_link_ht_legacy(fixture_text):
    link = parse_iw_link(fixture_text("synthetic", "iw_link_ht_2ghz_legacy_tx.txt"))
    assert (link.freq_mhz, link.channel, link.width_mhz) == (2437, 6, 20)
    assert link.rx_mcs == "HT-MCS 7" and link.tx_mcs is None and link.tx_bitrate_mbps == 1.0


def test_scan_dump_real(fixture_text):
    entries = parse_iw_scan_dump(fixture_text(REAL, "iw_scan_dump.txt"))
    assert len(entries) == 5
    assert all(e.source == "iw" and e.bssid.startswith("02:00:00:00:") for e in entries)
    by_band = {e.band for e in entries}
    assert by_band == {"2.4", "5"}
    two4 = next(e for e in entries if e.band == "2.4")
    assert (two4.channel, two4.width_mhz, two4.wifi_gen) == (6, 20, 4)  # vendor VHT on 2.4
    assert two4.station_count == 17 and two4.channel_utilisation == pytest.approx(51 / 255, abs=1e-3)
    five = [e for e in entries if e.band == "5"]
    assert {e.width_mhz for e in five} == {80}
    assert all(e.last_seen_ms and e.last_seen_ms > 0 for e in entries)
    assert all(-100 < e.signal_dbm < 0 for e in entries)


def test_scan_dump_associated_and_hidden():
    text = (
        "BSS 02:00:00:00:00:01(on wlan0) -- associated\n\tfreq: 6115.0\n\tsignal: -48.00 dBm\n\tSSID: \n"
        "\tEHT capabilities:\n\t\tEHT MAC Capabilities (0x0000):\n"
        "BSS 02:00:00:00:00:02(on wlan0)\n\tfreq: 2412\n\tsignal: -80.00 dBm\n"
    )
    a, b = parse_iw_scan_dump(text)
    assert a.associated and a.ssid is None and a.wifi_gen == 7 and a.band == "6"
    assert not b.associated and b.signal_dbm == -80.0


def test_nmcli_terse_split():
    assert split_terse(r"*:AA\:BB\:CC\:DD\:EE\:FF:My\:Net:6") == ["*", "AA:BB:CC:DD:EE:FF", "My:Net", "6"]


def test_nmcli_real(fixture_text):
    entries = parse_nmcli_wifi_list(fixture_text(REAL, "nmcli_wifi_list.txt"))
    assert len(entries) == 6
    assert all(e.source == "nmcli" and e.bssid.count(":") == 5 for e in entries)
    assert {e.band for e in entries} == {"2.4", "5"}
    assert entries[0].signal_dbm == -50  # 100 % saturates at -50 dBm


def test_nm_percent_to_dbm():
    assert nm_percent_to_dbm(62) == -69
    assert nm_percent_to_dbm(0) == -100


def test_iw_list_real(fixture_text):
    caps = parse_iw_list(fixture_text(REAL, "iw_list.txt"))
    assert caps.bands == ["2.4", "5"]
    assert caps.he and not caps.eht
    assert caps.freqs_6ghz_enabled == 0


def test_iw_list_6ghz_disabled():
    text = (
        "Band 4:\n\t\tEHT Iftypes: managed\n"
        "\t\t\t* 5955.0 MHz [1] (disabled)\n\t\t\t* 5975.0 MHz [5] (disabled)\n"
    )
    caps = parse_iw_list(text)
    assert caps.eht and "6" not in caps.bands
    assert (caps.freqs_6ghz_disabled, caps.freqs_6ghz_enabled) == (2, 0)


def test_iw_reg(fixture_text):
    # Real capture: global domain is unset (00) but phy#0 is self-managed with US — US applies.
    assert parse_iw_reg(fixture_text(REAL, "iw_reg.txt")) == "US"
    assert parse_iw_reg("global\ncountry 00: DFS-UNSET\n") == "00"
    self_managed = "global\ncountry 00: DFS-UNSET\n\nphy#0 (self-managed)\ncountry US: DFS-FCC\n"
    assert parse_iw_reg(self_managed) == "US"

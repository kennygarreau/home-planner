from wifi_survey.model.rates import link_rate_mbps, noise_floor_dbm, throughput_mbps


def test_noise_floor():
    assert round(noise_floor_dbm(80)) == -88


def test_rates_rise_with_signal_and_width():
    assert link_rate_mbps(-95, "5") == 0
    assert link_rate_mbps(-80, "5") < link_rate_mbps(-65, "5") < link_rate_mbps(-45, "5")
    assert link_rate_mbps(-45, "5") == round(143.4 * 4.19 * 2, 1)  # MCS 11, 2x2, 80 MHz ~ 1.2 Gbps
    assert link_rate_mbps(-40, "6") > link_rate_mbps(-40, "5")  # 160 MHz + 4096-QAM


def test_throughput_capped_by_wired_link():
    assert throughput_mbps(-40, "6") == 940
    assert 0 < throughput_mbps(-70, "5") < 300

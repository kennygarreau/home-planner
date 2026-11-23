"""Rough link-rate and throughput estimates from signal strength.

Used to compare layouts ("what does a third AP buy?"), not as a promise.
Assumes a 2-stream Wi-Fi 6/7 client (like the survey laptop), 0.8 us guard
interval, the channel widths from the channel plan, a 7 dB receiver noise
figure, and real throughput at ~60% of the PHY rate, capped by the 1 GbE
wired path to the iperf3 server.
"""

from __future__ import annotations

import math

NOISE_FIGURE_DB = 7.0
EFFICIENCY = 0.6
WIRED_CAP_MBPS = 940.0
STREAMS = 2
PLAN_WIDTH_MHZ = {"2.4": 20, "5": 80, "6": 160}

# Minimum SNR (dB) per MCS and the 1-stream 20 MHz rate (Mbps) for HE/EHT.
# MCS 12-13 (4096-QAM) are Wi-Fi 7 only; offered on 6 GHz plans.
MCS_SNR = [5, 8, 11, 14, 17, 21, 23, 25, 29, 31, 34, 36, 39, 41]
RATE_20_1SS = [8.6, 17.2, 25.8, 34.4, 51.6, 68.8, 77.4, 86.0, 103.2, 114.7, 129.0, 143.4, 154.9, 172.1]
WIDTH_FACTOR = {20: 1.0, 40: 2.0, 80: 4.19, 160: 8.38, 320: 16.75}


def noise_floor_dbm(width_mhz: int) -> float:
    return -174 + 10 * math.log10(width_mhz * 1e6) + NOISE_FIGURE_DB


def link_rate_mbps(signal_dbm: float, band: str, width_mhz: int | None = None) -> float:
    """PHY rate a 2-stream client could hold at this signal (0 if below MCS 0)."""
    width = width_mhz or PLAN_WIDTH_MHZ.get(band, 80)
    snr = signal_dbm - noise_floor_dbm(width)
    top = 13 if band == "6" else 11
    mcs = max((i for i, need in enumerate(MCS_SNR[: top + 1]) if snr >= need), default=None)
    if mcs is None:
        return 0.0
    return round(RATE_20_1SS[mcs] * WIDTH_FACTOR[width] * STREAMS, 1)


def throughput_mbps(signal_dbm: float, band: str, width_mhz: int | None = None) -> float:
    """Approximate iperf3-style throughput, capped by the 1 GbE server link."""
    return round(min(EFFICIENCY * link_rate_mbps(signal_dbm, band, width_mhz), WIRED_CAP_MBPS), 0)

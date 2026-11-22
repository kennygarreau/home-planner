"""Parsers for `iw` and `nmcli` output, plus small radio helpers.

All parsers take plain text so they can be unit-tested against fixture files.
"""

from __future__ import annotations

import re
from pathlib import Path

from pydantic import BaseModel

# ── Frequencies ──────────────────────────────────────────────────────────────


def band_of(freq_mhz: float) -> str | None:
    if 2400 <= freq_mhz <= 2500:
        return "2.4"
    if 5925 <= freq_mhz <= 7125:
        return "6"
    if 5150 <= freq_mhz < 5925:
        return "5"
    return None


def channel_of(freq_mhz: float) -> int | None:
    f = round(freq_mhz)
    if f == 2484:
        return 14
    if 2412 <= f <= 2472:
        return (f - 2407) // 5
    if f == 5935:
        return 2
    if 5955 <= f <= 7115:
        return (f - 5950) // 5
    if 5150 <= f < 5925:
        return (f - 5000) // 5
    return None


def _num(s: str) -> int | float:
    v = float(s)
    return int(v) if v.is_integer() else v


# ── iw dev ───────────────────────────────────────────────────────────────────


def parse_iw_dev(text: str) -> list[str]:
    """Interface names of type `managed` (station) from `iw dev`."""
    out: list[str] = []
    current: str | None = None
    for line in text.splitlines():
        s = line.strip()
        if s.startswith("Interface "):
            current = s.split(None, 1)[1]
        elif s.startswith("type ") and current:
            if s.split(None, 1)[1] == "managed":
                out.append(current)
            current = None
    return out


# ── iw link ──────────────────────────────────────────────────────────────────


class LinkInfo(BaseModel):
    connected: bool
    bssid: str | None = None
    ssid: str | None = None
    freq_mhz: int | float | None = None
    band: str | None = None
    channel: int | None = None
    width_mhz: int | None = None
    signal_dbm: int | float | None = None
    rx_bitrate_mbps: float | None = None
    tx_bitrate_mbps: float | None = None
    rx_mcs: str | None = None
    tx_mcs: str | None = None
    nss: int | None = None
    phy_mode: str | None = None  # HT / VHT / HE / EHT


_BITRATE = re.compile(r"([\d.]+) MBit/s(.*)")
_MCS = re.compile(r"\b(EHT|HE|VHT)-MCS (\d+)|\bMCS (\d+)")
_NSS = re.compile(r"\b(EHT|HE|VHT)-NSS (\d+)")
_WIDTH = re.compile(r"\b(\d+)MHz\b")


def _parse_bitrate(rest: str) -> tuple[float, str | None, int | None, int | None, str | None]:
    m = _BITRATE.search(rest)
    if not m:
        return 0.0, None, None, None, None
    rate, tail = float(m.group(1)), m.group(2)
    mcs = mode = None
    if mm := _MCS.search(tail):
        if mm.group(1):
            mode, mcs = mm.group(1), f"{mm.group(1)}-MCS {mm.group(2)}"
        else:
            mode, mcs = "HT", f"HT-MCS {mm.group(3)}"
    nss = int(n.group(2)) if (n := _NSS.search(tail)) else None
    width = int(w.group(1)) if (w := _WIDTH.search(tail)) else None
    return rate, mcs, nss, width, mode


def parse_iw_link(text: str) -> LinkInfo:
    if "Not connected" in text or not text.strip():
        return LinkInfo(connected=False)
    info = LinkInfo(connected=True)
    widths: list[int] = []
    for line in text.splitlines():
        s = line.strip()
        if m := re.match(r"Connected to ([0-9a-fA-F:]{17})", s):
            info.bssid = m.group(1).lower()
        elif s.startswith("SSID:"):
            info.ssid = s[5:].strip()
        elif s.startswith("freq:"):
            info.freq_mhz = _num(s[5:].strip().split()[0])
        elif s.startswith("signal:"):
            info.signal_dbm = _num(s[7:].strip().split()[0])
        elif s.startswith("rx bitrate:"):
            rate, mcs, nss, width, mode = _parse_bitrate(s)
            info.rx_bitrate_mbps, info.rx_mcs, info.phy_mode = rate, mcs, mode or info.phy_mode
            info.nss = nss or info.nss
            if width:
                widths.append(width)
        elif s.startswith("tx bitrate:"):
            rate, mcs, nss, width, mode = _parse_bitrate(s)
            info.tx_bitrate_mbps, info.tx_mcs = rate, mcs
            info.phy_mode = info.phy_mode or mode
            info.nss = info.nss or nss
            if width:
                widths.append(width)
    if info.freq_mhz is not None:
        info.band, info.channel = band_of(info.freq_mhz), channel_of(info.freq_mhz)
    info.width_mhz = max(widths) if widths else (20 if info.connected else None)
    return info


# ── iw scan dump ─────────────────────────────────────────────────────────────


class ScanEntry(BaseModel):
    bssid: str
    ssid: str | None = None
    freq_mhz: int | float
    band: str | None = None
    channel: int | None = None
    signal_dbm: float
    last_seen_ms: int | None = None
    width_mhz: int | None = None
    wifi_gen: int | None = None  # 4=HT, 5=VHT, 6=HE, 7=EHT
    station_count: int | None = None
    channel_utilisation: float | None = None  # 0..1
    associated: bool = False
    source: str = "iw"


_BSS_LINE = re.compile(r"^BSS ([0-9a-fA-F:]{17})\(on [^)]+\)(.*)$")


def _width_from_block(lines: list[str]) -> int | None:
    """Best-effort operating width from HT/VHT/HE/EHT operation elements."""
    width = None
    for s in lines:
        if m := re.search(r"channel width: \d+ \((\d+) MHz\)", s):  # VHT op: "1 (80 MHz)"
            width = max(width or 0, int(m.group(1)))
        elif m := re.search(r"channel width: \d+ \((\d+)\+\d+ MHz\)", s):  # 80+80
            width = max(width or 0, 160)
        elif m := re.search(r"\* (?:channel )?width: (\d+) MHz", s, re.IGNORECASE):  # 6 GHz op info
            width = max(width or 0, int(m.group(1)))
        elif "secondary channel offset: above" in s or "secondary channel offset: below" in s:
            width = max(width or 0, 40)
        elif "secondary channel offset: no secondary" in s:
            width = max(width or 0, 20)
    return width


def parse_iw_scan_dump(text: str) -> list[ScanEntry]:
    blocks: list[tuple[str, str, list[str]]] = []
    for line in text.splitlines():
        if m := _BSS_LINE.match(line):
            blocks.append((m.group(1).lower(), m.group(2), []))
        elif blocks:
            blocks[-1][2].append(line.strip())

    out: list[ScanEntry] = []
    for bssid, tail, lines in blocks:
        freq = signal = None
        ssid: str | None = None
        last_seen = stations = None
        util = None
        gen = None
        for s in lines:
            if s.startswith("freq:") and freq is None:
                freq = _num(s[5:].strip().split()[0])
            elif s.startswith("signal:"):
                signal = float(s[7:].strip().split()[0])
            elif s.startswith("SSID:") and ssid is None:
                ssid = s[5:].strip() or None
            elif m := re.match(r"last seen: (\d+) ms ago", s):
                last_seen = int(m.group(1))
            elif m := re.match(r"\* station count: (\d+)", s):
                stations = int(m.group(1))
            elif m := re.match(r"\* channel utilisation: (\d+)/255", s):
                util = round(int(m.group(1)) / 255, 3)
            elif s.startswith("EHT capabilities") or s.startswith("EHT operation"):
                gen = 7
            elif s.startswith("HE capabilities") and (gen or 0) < 6:
                gen = 6
            elif s.startswith("VHT capabilities") and (gen or 0) < 5:
                gen = 5
            elif s.startswith("HT capabilities") and (gen or 0) < 4:
                gen = 4
        if freq is None or signal is None:
            continue
        if gen == 5 and band_of(freq) == "2.4":
            gen = 4  # "VHT on 2.4 GHz" is a vendor extension, not Wi-Fi 5
        out.append(
            ScanEntry(
                bssid=bssid,
                ssid=ssid,
                freq_mhz=freq,
                band=band_of(freq),
                channel=channel_of(freq),
                signal_dbm=signal,
                last_seen_ms=last_seen,
                width_mhz=_width_from_block(lines),
                wifi_gen=gen,
                station_count=stations,
                channel_utilisation=util,
                associated="associated" in tail,
            )
        )
    return out


# ── nmcli ────────────────────────────────────────────────────────────────────

NMCLI_FIELDS = "IN-USE,BSSID,SSID,CHAN,FREQ,RATE,SIGNAL,SECURITY"


def split_terse(line: str) -> list[str]:
    """Split one `nmcli -t` line on unescaped ':' and unescape `\\:` / `\\\\`."""
    fields, cur, i = [], [], 0
    while i < len(line):
        c = line[i]
        if c == "\\" and i + 1 < len(line):
            cur.append(line[i + 1])
            i += 2
            continue
        if c == ":":
            fields.append("".join(cur))
            cur = []
        else:
            cur.append(c)
        i += 1
    fields.append("".join(cur))
    return fields


def nm_percent_to_dbm(pct: int) -> int:
    """NetworkManager maps dBm → % as clamp(2·(dBm+100), 0, 100); invert it (±1 dB, saturates at -50)."""
    return round(pct / 2 - 100)


def parse_nmcli_wifi_list(text: str) -> list[ScanEntry]:
    """Parse `nmcli -t -f IN-USE,BSSID,SSID,CHAN,FREQ,RATE,SIGNAL,SECURITY dev wifi list`."""
    out: list[ScanEntry] = []
    for line in text.splitlines():
        if not line.strip():
            continue
        f = split_terse(line)
        if len(f) < 7:
            continue
        in_use, bssid, ssid, _chan, freq, _rate, signal = f[:7]
        try:
            freq_mhz = int(freq.split()[0])
            pct = int(signal)
        except (ValueError, IndexError):
            continue
        out.append(
            ScanEntry(
                bssid=bssid.lower(),
                ssid=ssid or None,
                freq_mhz=freq_mhz,
                band=band_of(freq_mhz),
                channel=channel_of(freq_mhz),
                signal_dbm=nm_percent_to_dbm(pct),
                associated=in_use.strip() == "*",
                source="nmcli",
            )
        )
    return out


# ── iw list / iw reg get ─────────────────────────────────────────────────────


class RadioCapabilities(BaseModel):
    bands: list[str]
    freqs_6ghz_enabled: int = 0
    freqs_6ghz_disabled: int = 0
    he: bool = False
    eht: bool = False


_FREQ_LINE = re.compile(r"\* (\d+(?:\.\d+)?) MHz \[\d+\](.*)")


def parse_iw_list(text: str) -> RadioCapabilities:
    bands: set[str] = set()
    en6 = dis6 = 0
    for line in text.splitlines():
        s = line.strip()
        if m := _FREQ_LINE.match(s):
            f = float(m.group(1))
            band = band_of(f)
            disabled = "disabled" in m.group(2)
            if band:
                if not disabled:
                    bands.add(band)
                if band == "6":
                    if disabled:
                        dis6 += 1
                    else:
                        en6 += 1
    he = bool(re.search(r"HE (Iftypes|MAC Capabilities)", text))
    eht = bool(re.search(r"EHT (Iftypes|MAC Capabilities)", text))
    order = ["2.4", "5", "6"]
    return RadioCapabilities(
        bands=sorted(bands, key=order.index),
        freqs_6ghz_enabled=en6,
        freqs_6ghz_disabled=dis6,
        he=he,
        eht=eht,
    )


def parse_iw_reg(text: str) -> str | None:
    """Country code of the regulatory domain in effect for phy0 (or global)."""
    countries = re.findall(r"country ([A-Z0-9]{2}):", text)
    if not countries:
        return None
    # `iw reg get` prints "global" first, then per-phy self-managed domains.
    # A self-managed phy domain (Intel CNVi often is) is what actually applies.
    return countries[-1] if "phy#" in text else countries[0]


def parse_power_save(text: str) -> bool | None:
    """`iw dev <if> get power_save` → True (on), False (off) or None (unknown)."""
    m = re.search(r"Power save:\s*(on|off)", text, re.IGNORECASE)
    return None if not m else m.group(1).lower() == "on"


# ── Interface discovery ──────────────────────────────────────────────────────


def detect_interface(iw_dev_output: str, sys_class_net: Path = Path("/sys/class/net")) -> str | None:
    names = parse_iw_dev(iw_dev_output)
    if names:
        return names[0]
    try:
        wl = sorted(p.name for p in sys_class_net.iterdir() if (p / "wireless").exists())
    except OSError:
        wl = []
    return wl[0] if wl else None

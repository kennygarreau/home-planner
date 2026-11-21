"""Redact network identifiers from command output before it is shared or committed.

SSIDs, BSSIDs/MACs and WPS device details (which include the router's serial
number) are replaced with stable placeholders, so redacted output still parses
and still shows which entries were the same network.
"""

from __future__ import annotations

import re

_MAC = re.compile(r"(?<![0-9A-Fa-f:\\])(?:[0-9A-Fa-f]{2}(?::|\\:)){5}[0-9A-Fa-f]{2}(?![0-9A-Fa-f:])")
_SSID_LINE = re.compile(r"^(\s*(?:SSID|MESH ID):[ \t]?)(.*)$", re.MULTILINE)
_WPS_FIELDS = re.compile(
    r"^(\s*\*\s*(?:UUID|Manufacturer|Model|Model Number|Serial Number|Device name|"
    r"Primary Device Type):[ \t]?)(.+)$",
    re.MULTILINE,
)
_WPS_SENSITIVE = ("UUID", "Manufacturer", "Model", "Model Number", "Serial Number", "Device name")


class Redactor:
    """Keeps a consistent mapping for one redaction session."""

    def __init__(self) -> None:
        self.macs: dict[str, str] = {}
        self.ssids: dict[str, str] = {}

    def mac(self, original: str) -> str:
        escaped = "\\:" in original
        key = original.replace("\\:", ":").lower()
        if key not in self.macs:
            n = len(self.macs) + 1
            # Locally administered unicast prefix 02:, so it can't collide with a real vendor OUI.
            self.macs[key] = f"02:00:00:00:{n // 256:02x}:{n % 256:02x}"
        out = self.macs[key]
        return out.upper().replace(":", "\\:") if escaped else out

    def ssid(self, original: str) -> str:
        if not original.strip():
            return original
        if original not in self.ssids:
            self.ssids[original] = f"SSID_{len(self.ssids) + 1}"
        return self.ssids[original]

    def text(self, s: str) -> str:
        s = _MAC.sub(lambda m: self.mac(m.group(0)), s)
        s = _SSID_LINE.sub(lambda m: m.group(1) + self.ssid(m.group(2)), s)
        s = _WPS_FIELDS.sub(self._wps, s)
        return s

    def _wps(self, m: re.Match[str]) -> str:
        label = m.group(1)
        if any(f"{k}:" in label for k in _WPS_SENSITIVE):
            return label + "REDACTED"
        return m.group(0)

    def nmcli_terse(self, s: str) -> str:
        """nmcli -t lines: field 3 (SSID) is free text, so redact it positionally."""
        from wifi_survey.collect.wifi import split_terse

        out = []
        for line in s.splitlines():
            f = split_terse(line)
            if len(f) >= 3:
                f[1] = self.mac(f[1]).replace("\\:", ":")
                f[2] = self.ssid(f[2])
                line = ":".join(x.replace("\\", "\\\\").replace(":", "\\:") for x in f)
            out.append(line)
        return "\n".join(out) + ("\n" if s.endswith("\n") else "")

"""Work out which BSSIDs (radios) belong to which existing AP on the floor plan.

One physical AP has several radios (2.4 GHz, one or two 5 GHz, maybe 6 GHz),
each with its own BSSID. Vendors derive them from one base MAC, so they share
their first five octets once the "locally administered" bit is ignored.

1. Group BSSIDs into devices by that prefix.
2. Keep groups the laptop actually connected to at least once (the home
   network); neighbours and other devices are dropped.
3. Find where each group was heard loudest and match groups to the nearest
   AP marker (closest pairs first, each AP used once).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

from wifi_survey.floorplan.schema import FloorPlan
from wifi_survey.model.environment import Environment

FAR_M = 8.0  # warn when the loudest reading is further than this from the matched AP


def device_key(bssid: str) -> str:
    octets = [int(x, 16) for x in bssid.lower().split(":")]
    octets[0] &= ~0x02
    return ":".join(f"{o:02x}" for o in octets[:5])


@dataclass
class Radio:
    bssid: str
    band: str | None
    channel: int | None
    max_dbm: float
    at_point: str


@dataclass
class ApMatch:
    ap_id: str
    label: str
    floor_id: str
    distance_m: float
    radios: list[Radio] = field(default_factory=list[Radio])


@dataclass
class Mapping:
    aps: list[ApMatch]
    bssid_to_ap: dict[str, str]
    warnings: list[str]


def map_bssids(plan: FloorPlan, env: Environment, records: list[dict[str, Any]]) -> Mapping:
    warnings: list[str] = []
    connected = {
        r["connected"]["bssid"].lower() for r in records if r.get("connected") and r["connected"].get("bssid")
    }
    home_keys = {device_key(b) for b in connected}

    # Loudest observation per BSSID, and per device group.
    best: dict[str, tuple[float, dict[str, Any], dict[str, Any]]] = {}
    for r in records:
        scan: list[dict[str, Any]] = r.get("scan") or []
        for e in scan:
            b = str(e["bssid"]).lower()
            if device_key(b) not in home_keys:
                continue
            sig = float(e["signal_dbm"])
            if b not in best or sig > best[b][0]:
                best[b] = (sig, e, r)
    groups: dict[str, list[str]] = {}
    for b in best:
        groups.setdefault(device_key(b), []).append(b)

    aps = [(f, ap) for f in plan.floors for ap in f.existing_aps]
    if not aps:
        return Mapping(
            [], {}, ["No existing APs are marked on the floor plan — nothing to calibrate against"]
        )

    # Distance from each group's loudest reading to each AP (3-D, metres).
    pairs: list[tuple[float, str, int]] = []
    for key, members in groups.items():
        loud = max(members, key=lambda b: best[b][0])
        rec = best[loud][2]
        px, py = rec["pos"]
        pz = env.rx_z(rec["floor_id"], rec.get("height_m") or 1.0)
        for k, (f, ap) in enumerate(aps):
            az = env.mount_z(f.id, ap.mount)
            pairs.append((math.dist((px, py, pz), (ap.pos[0], ap.pos[1], az)), key, k))
    pairs.sort()

    used_groups: set[str] = set()
    used_aps: set[int] = set()
    matches: list[ApMatch] = []
    bssid_to_ap: dict[str, str] = {}
    for d, key, k in pairs:
        if key in used_groups or k in used_aps:
            continue
        used_groups.add(key)
        used_aps.add(k)
        f, ap = aps[k]
        m = ApMatch(ap.id, ap.label, f.id, round(d, 2))
        for b in sorted(groups[key], key=lambda b: (best[b][1].get("band") or "", b)):
            sig, e, rec = best[b]
            m.radios.append(Radio(b, e.get("band"), e.get("channel"), sig, rec.get("point_id", "")))
            bssid_to_ap[b] = ap.id
        if d > FAR_M:
            warnings.append(
                f"{ap.label}: its loudest reading was {d:.1f} m away — check the AP's position on the plan"
            )
        matches.append(m)

    for key in groups.keys() - used_groups:
        warnings.append(
            f"A home radio group ({len(groups[key])} BSSIDs) has no AP marked for it — is an AP missing?"
        )
    for k in set(range(len(aps))) - used_aps:
        warnings.append(f"{aps[k][1].label}: no radios matched — was it switched on during the survey?")
    return Mapping(matches, bssid_to_ap, warnings)

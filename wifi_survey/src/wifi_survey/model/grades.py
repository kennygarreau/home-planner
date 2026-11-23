"""Room grades (A-F) from the survey: coverage, download and latency vs target.

  score = 0.50 x coverage   share of the room at or above its signal target
                            (from the heatmap grid; share of measured spots
                            if there is no grid)
        + 0.35 x download   median measured download / target, capped at 1
        + 0.15 x latency    share of spots whose p95 latency meets target
Missing components are dropped and the weights renormalised.
A >= 0.90, B >= 0.80, C >= 0.70, D >= 0.55, else F. A room passes at A or B.
"""

from __future__ import annotations

import statistics as st
from typing import Any

import numpy as np

from wifi_survey.floorplan.schema import FloorPlan, Room
from wifi_survey.model.environment import FArr, points_in_polygon
from wifi_survey.model.targets import Target, Targets

WEIGHTS = {"coverage": 0.50, "download": 0.35, "latency": 0.15}
CUTS = [(0.90, "A"), (0.80, "B"), (0.70, "C"), (0.55, "D")]


def letter(score: float) -> str:
    return next((g for cut, g in CUTS if score >= cut - 1e-9), "F")


def grid_cells(grid: dict[str, Any], band: str) -> tuple[FArr, FArr] | None:
    values = grid.get("bands", {}).get(band)
    if values is None:
        return None
    nx, ny, step = int(grid["nx"]), int(grid["ny"]), float(grid["step"])
    x0, y0 = float(grid["x0"]), float(grid["y0"])
    gx, gy = np.meshgrid(x0 + (np.arange(nx) + 0.5) * step, y0 + (np.arange(ny) + 0.5) * step)
    xy: FArr = np.column_stack([gx.ravel(), gy.ravel()]).astype(np.float64)
    v: FArr = np.array([np.nan if x is None else float(x) for x in values], dtype=np.float64)
    return xy, v


EXCELLENT_DBM = -60.0


def room_coverage(
    cells: tuple[FArr, FArr] | None, room: Room, threshold: float
) -> tuple[float | None, float | None, float | None]:
    """(share >= threshold, median signal, share >= -60 dBm) of a room's grid cells."""
    if cells is None:
        return None, None, None
    xy, v = cells
    inside = points_in_polygon(xy, room.polygon) & np.isfinite(v)
    if not inside.any():
        return None, None, None
    vals = v[inside]
    return float(np.mean(vals >= threshold)), float(np.median(vals)), float(np.mean(vals >= EXCELLENT_DBM))


def _score(parts: dict[str, float | None]) -> float:
    have = {k: v for k, v in parts.items() if v is not None}
    if not have:
        return 0.0
    total = sum(WEIGHTS[k] for k in have)
    return sum(WEIGHTS[k] * v for k, v in have.items()) / total


def grade_room(
    room: Room,
    target: Target,
    coverage: float | None,
    median_dbm: float | None,
    records: list[dict[str, Any]],
) -> dict[str, Any]:
    conn = [
        float(r["connected"]["signal_dbm"])
        for r in records
        if r.get("connected") and r["connected"].get("signal_dbm") is not None
    ]
    downs = [
        float(r["throughput"]["down_mbps"])
        for r in records
        if r.get("throughput") and r["throughput"].get("down_mbps") is not None
    ]
    p95s = [
        float(r["latency"]["p95_ms"])
        for r in records
        if r.get("latency") and r["latency"].get("p95_ms") is not None
    ]
    if coverage is None and conn:
        coverage = sum(s >= target.signal_dbm for s in conn) / len(conn)
    down_med = st.median(downs) if downs else None
    parts: dict[str, float | None] = {
        "coverage": coverage,
        "download": min(1.0, down_med / target.down_mbps) if down_med is not None else None,
        "latency": sum(p <= target.latency_p95_ms for p in p95s) / len(p95s) if p95s else None,
    }
    score = _score(parts)
    issues: list[str] = []
    if coverage is not None and coverage < 0.9:
        issues.append(f"{1 - coverage:.0%} of the room is below {target.signal_dbm:.0f} dBm")
    if down_med is not None and down_med < target.down_mbps:
        issues.append(f"Download {down_med:.0f} Mbps (target {target.down_mbps:.0f})")
    if downs and min(downs) < target.down_mbps / 2 and (down_med or 0) >= target.down_mbps:
        issues.append(f"Weak spot: {min(downs):.0f} Mbps at one point")
    if parts["latency"] is not None and parts["latency"] < 1:
        issues.append(f"Latency spikes above {target.latency_p95_ms:.0f} ms (p95)")
    g = letter(score)
    return {
        "grade": g,
        "pass": g in ("A", "B"),
        "score": round(score, 3),
        "components": {k: (None if v is None else round(v, 3)) for k, v in parts.items()},
        "target": {
            "signal_dbm": target.signal_dbm,
            "down_mbps": target.down_mbps,
            "latency_p95_ms": target.latency_p95_ms,
        },
        "measured": {
            "points": len(records),
            "signal_median_dbm": st.median(conn) if conn else None,
            "signal_worst_dbm": min(conn) if conn else None,
            "down_median_mbps": round(down_med, 1) if down_med is not None else None,
            "down_worst_mbps": round(min(downs), 1) if downs else None,
            "latency_p95_median_ms": round(st.median(p95s), 1) if p95s else None,
        },
        "model": {
            "coverage": None if coverage is None else round(coverage, 3),
            "median_dbm": None if median_dbm is None else round(median_dbm, 1),
        },
        "issues": issues,
    }


def grade_rooms(
    plan: FloorPlan, targets: Targets, grids: dict[str, Any], band: str, records: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """rooms.json content (spec §2.3): grade, metrics and pass/fail per room."""
    out: list[dict[str, Any]] = []
    for f in plan.floors:
        cells = grid_cells(grids[f.id], band) if f.id in grids else None
        for room in f.rooms:
            t = targets.for_room(room)
            cov, med, exc = room_coverage(cells, room, t.signal_dbm)
            recs = [r for r in records if r.get("room_id") == room.id]
            graded = grade_room(room, t, cov, med, recs)
            graded["model"]["excellent"] = None if exc is None else round(exc, 3)
            out.append(
                {
                    "room_id": room.id,
                    "name": room.name,
                    "floor_id": f.id,
                    "floor": f.name,
                    "priority": room.priority,
                    "use": room.use,
                    "band": band,
                    **graded,
                }
            )
    return out

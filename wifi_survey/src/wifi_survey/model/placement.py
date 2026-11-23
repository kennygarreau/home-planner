"""AP placement optimiser and channel plan (spec Phase 5).

Candidates: ceiling spots on a grid over every room that allows an AP (floor
setting "anywhere"), plus marked candidate sites (floors set to "anywhere" or
"candidates"). Each candidate's predicted signal at every evaluation cell comes
from the calibrated model with the new AP's EIRP.

Objective (maximised):
    sum over bands b in {5, 6} of  w_b x  sum_rooms  w_room x share of room cells >= room target
    divided by sum of w_room, minus a small penalty per AP at a site marked
    "Ethernet can't reach".
Search: greedy for 1..max APs, each improved by swap local search until no
swap helps. Ties break on candidate order, so results are deterministic.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import numpy.typing as npt
import yaml

from wifi_survey.config import CONFIG_DIR
from wifi_survey.floorplan.schema import FloorPlan
from wifi_survey.model.calibrate import BandModel
from wifi_survey.model.environment import Environment, FArr, Materials, points_in_polygon
from wifi_survey.model.grades import letter
from wifi_survey.model.mapping import device_key
from wifi_survey.model.rates import link_rate_mbps, throughput_mbps
from wifi_survey.model.targets import Targets

BAND_WEIGHTS = {"5": 0.6, "6": 0.4}
MARGIN_MIN_DB, MARGIN_MAX_DB = 3.0, 8.0  # design margin = model RMSE, within these bounds
NEIGHBOUR_MIN_SIGHTINGS = 3  # a neighbour network must be seen at this many spots to count
# Beyond the targets, more APs buy strong signal: score the share of area at
# "excellent" (>= -60 dBm, room for the fastest rates) at a lower weight so it
# never trades away actual target coverage (10% more excellent = 1% coverage).
EXCELLENT_DBM = -60.0
EXCELLENT_WEIGHT = 0.1
OVERLAP_DBM = -67.0  # two APs at least this strong = roaming overlap
CANDIDATE_SPACING_M = 1.0
CANDIDATE_INSET_M = 0.5
EVAL_STEP_M = 0.5
NO_CABLE_PENALTY = 0.02
# Tie-breaker: coverage alone is flat wherever an AP already covers a room, so
# add a small bonus for signal margin above target (clipped to ±10 dB, scaled
# to ±MARGIN_WEIGHT). It prefers central, stronger layouts without ever
# outweighing more than a sliver of actual coverage.
MARGIN_WEIGHT = 0.005
MARGIN_CLIP_DB = 10.0
GOOD_ENOUGH = 0.95  # weighted 5+6 GHz coverage at which adding APs stops paying off
MIN_GAIN = 0.02

# US channel groups. 5 GHz: 80 MHz blocks (first channel, label, DFS).
BLOCKS_5 = [
    (36, "36-48", False),
    (149, "149-161", False),
    (52, "52-64", True),
    (100, "100-112", True),
    (116, "116-128", True),
    (132, "132-144", True),
]
CENTERS_6_160 = [15, 47, 79, 111, 143, 175, 207]


@dataclass
class ApSpec:
    key: str
    name: str
    eirp: dict[str, float]  # band → planning EIRP (dBm)


def load_ap_spec(key: str, path: Path | None = None) -> ApSpec:
    raw: dict[str, Any] = yaml.safe_load((path or CONFIG_DIR / "ap_models.yaml").read_text())
    models: dict[str, Any] = raw.get("models") or {}
    if key not in models:
        raise KeyError(f"Unknown AP model {key!r}; known: {', '.join(models)}")
    m: dict[str, Any] = models[key]
    bands: dict[str, Any] = m.get("bands") or {}
    eirp = {
        str(b): float(v.get("design_tx_power_dbm", v["tx_power_dbm"])) + float(v["antenna_gain_dbi"])
        for b, v in bands.items()
    }
    return ApSpec(key, str(m.get("name") or key), eirp)


@dataclass
class Candidate:
    floor_id: str
    xy: tuple[float, float]
    z: float
    room_id: str | None
    room: str
    source: str  # "grid" | "site"
    label: str = ""
    cable_feasible: bool = True


@dataclass
class Cells:
    floor_ids: list[str]
    floor_of: npt.NDArray[np.int64]  # (E,) index into floor_ids
    xy: FArr  # (E, 2)
    room_of: list[str]  # (E,) room id
    threshold: FArr  # (E,) target dBm
    weight: FArr  # (E,) room weight / room cell count
    grid: dict[str, dict[str, Any]] = field(default_factory=dict[str, dict[str, Any]])  # floor → layout
    grid_index: npt.NDArray[np.int64] = field(default_factory=lambda: np.zeros(0, dtype=np.int64))


def _dist_to_edges(xy: FArr, poly: list[tuple[float, float]]) -> FArr:
    p = np.asarray(poly, dtype=np.float64)
    best = np.full(xy.shape[0], np.inf)
    for k in range(len(p)):
        a: FArr = p[k - 1]
        b: FArr = p[k]
        ab: FArr = b - a
        t: FArr = np.clip(((xy - a) @ ab) / max(float(ab @ ab), 1e-12), 0.0, 1.0)
        nearest: FArr = a + t[:, None] * ab
        dist: FArr = np.linalg.norm(xy - nearest, axis=1)
        best = np.minimum(best, dist)
    return best


def candidates(plan: FloorPlan, env: Environment) -> list[Candidate]:
    out: list[Candidate] = []
    for f in plan.floors:
        if f.ap_placement == "none":
            continue
        ceiling = env.mount_z(f.id, "ceiling")
        if f.ap_placement == "anywhere":
            for room in f.rooms:
                if not room.ap_allowed or len(room.polygon) < 3:
                    continue
                poly = np.asarray(room.polygon, dtype=np.float64)
                lo, hi = poly.min(0), poly.max(0)
                xs = np.arange(lo[0] + CANDIDATE_SPACING_M / 2, hi[0], CANDIDATE_SPACING_M)
                ys = np.arange(lo[1] + CANDIDATE_SPACING_M / 2, hi[1], CANDIDATE_SPACING_M)
                gx, gy = np.meshgrid(xs, ys)
                xy: FArr = np.column_stack([gx.ravel(), gy.ravel()]).astype(np.float64)
                if xy.size == 0:
                    continue
                keep = points_in_polygon(xy, room.polygon) & (
                    _dist_to_edges(xy, room.polygon) >= CANDIDATE_INSET_M
                )
                if not keep.any():  # tiny room: allow its centre
                    c = poly.mean(0)
                    xy, keep = c[None, :].astype(np.float64), np.array([True])
                for x, y in xy[keep]:
                    out.append(Candidate(f.id, (float(x), float(y)), ceiling, room.id, room.name, "grid"))
        for s in f.candidate_ap_sites:
            room = next((r for r in f.rooms if points_in_polygon(np.array([s.pos]), r.polygon)[0]), None)
            out.append(
                Candidate(
                    f.id,
                    (s.pos[0], s.pos[1]),
                    env.mount_z(f.id, s.mount),
                    room.id if room else None,
                    room.name if room else "",
                    "site",
                    s.label,
                    s.cable_feasible,
                )
            )
    return out


def eval_cells(plan: FloorPlan, targets: Targets, step: float = EVAL_STEP_M) -> Cells:
    floor_ids = [f.id for f in plan.floors]
    floor_of: list[int] = []
    xys: list[FArr] = []
    room_of: list[str] = []
    thr: list[float] = []
    wts: list[float] = []
    gidx: list[int] = []
    grid: dict[str, dict[str, Any]] = {}
    for fi, f in enumerate(plan.floors):
        pts = [p for r in f.rooms for p in r.polygon]
        if not pts:
            continue
        x0 = math.floor(min(p[0] for p in pts) / step) * step
        y0 = math.floor(min(p[1] for p in pts) / step) * step
        nx = max(1, math.ceil((max(p[0] for p in pts) - x0) / step))
        ny = max(1, math.ceil((max(p[1] for p in pts) - y0) / step))
        grid[f.id] = {"x0": x0, "y0": y0, "step": step, "nx": nx, "ny": ny}
        gx, gy = np.meshgrid(x0 + (np.arange(nx) + 0.5) * step, y0 + (np.arange(ny) + 0.5) * step)
        all_xy: FArr = np.column_stack([gx.ravel(), gy.ravel()]).astype(np.float64)
        taken = np.zeros(all_xy.shape[0], dtype=bool)
        for room in f.rooms:
            inside = points_in_polygon(all_xy, room.polygon) & ~taken
            if not inside.any():
                continue
            taken |= inside
            n = int(inside.sum())
            t = targets.for_room(room)
            w = targets.weight(room) / n
            idx = np.flatnonzero(inside)
            floor_of += [fi] * n
            xys.append(all_xy[idx])
            room_of += [room.id] * n
            thr += [t.signal_dbm] * n
            wts += [w] * n
            gidx += idx.tolist()
    xy: FArr = np.vstack(xys) if xys else np.zeros((0, 2))
    return Cells(
        floor_ids,
        np.array(floor_of, dtype=np.int64),
        xy,
        room_of,
        np.array(thr, dtype=np.float64),
        np.array(wts, dtype=np.float64),
        grid,
        np.array(gidx, dtype=np.int64),
    )


def signal_matrix(
    env: Environment, mats: Materials, model: BandModel, eirp: float, cands: list[Candidate], cells: Cells
) -> FArr:
    """(C, E) predicted dBm from every candidate to every evaluation cell."""
    s = np.full((len(cands), cells.xy.shape[0]), -150.0)
    for fi, fid in enumerate(cells.floor_ids):
        mask = cells.floor_of == fi
        if not mask.any():
            continue
        z = env.rx_z(fid)
        for ci, c in enumerate(cands):
            s[ci, mask] = model.predict_eirp(env, mats, eirp, c.floor_id, c.xy, c.z, fid, cells.xy[mask], z)
    return s


@dataclass
class Scorer:
    matrices: dict[str, FArr]  # band → (C, E)
    cells: Cells
    penalty: FArr  # (C,)
    margin_db: float = 0.0  # placement aims for room target + this
    extra: dict[str, FArr] = field(default_factory=dict[str, FArr])  # reported, not optimised (2.4 GHz)

    @property
    def thr(self) -> FArr:
        return self.cells.threshold + self.margin_db

    def coverage(self, chosen: list[int], band: str) -> float:
        if not chosen:
            return 0.0
        best = self.matrices[band][chosen].max(0)
        w = self.cells.weight
        return float((w * (best >= self.thr)).sum() / w.sum())

    def _band_value(self, best: FArr) -> FArr:
        """Coverage share plus the margin tie-breaker, for (..., E) best-signal arrays."""
        w, thr = self.cells.weight, self.thr
        covered = (best >= thr) @ w / w.sum()
        excellent = (best >= EXCELLENT_DBM) @ w / w.sum()
        margin = np.clip(best - thr, -MARGIN_CLIP_DB, MARGIN_CLIP_DB) / MARGIN_CLIP_DB
        return covered + EXCELLENT_WEIGHT * excellent + MARGIN_WEIGHT * (margin @ w) / w.sum()

    def share(self, chosen: list[int], band: str, dbm: float | None = None) -> float:
        """Weighted share of area at or above `dbm` (default: each room's own target, no margin)."""
        m = self.matrices.get(band, self.extra.get(band))
        if m is None or not chosen:
            return 0.0
        best = m[chosen].max(0)
        thr = self.cells.threshold if dbm is None else np.full_like(best, dbm)
        w = self.cells.weight
        return float((w * (best >= thr)).sum() / w.sum())

    def overlap(self, chosen: list[int], band: str) -> float:
        """Share of area where at least two APs are >= OVERLAP_DBM (smooth roaming zones)."""
        m = self.matrices.get(band)
        if m is None or len(chosen) < 2:
            return 0.0
        strong = (m[chosen] >= OVERLAP_DBM).sum(0) >= 2
        w = self.cells.weight
        return float((w * strong).sum() / w.sum())

    def score(self, chosen: list[int]) -> float:
        if not chosen:
            return 0.0
        norm = sum(BAND_WEIGHTS[b] for b in self.matrices)
        val = sum(
            BAND_WEIGHTS[b] * float(self._band_value(m[chosen].max(0))) for b, m in self.matrices.items()
        )
        return val / norm - float(self.penalty[chosen].sum())

    def _scores_if_added(self, base: dict[str, FArr], base_penalty: float) -> FArr:
        """Score of chosen + each candidate, for all candidates at once."""
        total = np.zeros(next(iter(self.matrices.values())).shape[0])
        norm = sum(BAND_WEIGHTS[b] for b in self.matrices)
        for b, m in self.matrices.items():
            total += BAND_WEIGHTS[b] * self._band_value(np.maximum(m, base[b][None, :]))
        return total / norm - self.penalty - base_penalty

    def _base(self, chosen: list[int]) -> dict[str, FArr]:
        e = self.cells.xy.shape[0]
        return {b: (m[chosen].max(0) if chosen else np.full(e, -np.inf)) for b, m in self.matrices.items()}

    def optimise(self, n: int, start: list[int] | None = None) -> list[int]:
        chosen = list(start or [])
        while len(chosen) < n:
            s = self._scores_if_added(self._base(chosen), float(self.penalty[chosen].sum()))
            s[chosen] = -np.inf
            chosen.append(int(np.argmax(s)))
        for _ in range(50):  # swap local search
            improved = False
            for i in range(len(chosen)):
                others = chosen[:i] + chosen[i + 1 :]
                s = self._scores_if_added(self._base(others), float(self.penalty[others].sum()))
                s[others] = -np.inf
                j = int(np.argmax(s))
                if s[j] > self.score(chosen) + 1e-9:
                    chosen[i] = j
                    improved = True
            if not improved:
                break
        return sorted(chosen)


def busy_channels(records: list[dict[str, Any]]) -> dict[str, dict[int, float]]:
    """Strongest neighbour (non-home) signal per channel, by band."""
    home = {
        device_key(str(r["connected"]["bssid"]))
        for r in records
        if r.get("connected") and r["connected"].get("bssid")
    }
    strongest: dict[tuple[str, str], tuple[str, int, float]] = {}
    sightings: dict[tuple[str, str], int] = {}
    for r in records:
        scan: list[dict[str, Any]] = r.get("scan") or []
        for e in scan:
            if device_key(str(e["bssid"])) in home or e.get("channel") is None or not e.get("band"):
                continue
            key = (str(e["band"]), str(e["bssid"]).lower())
            sightings[key] = sightings.get(key, 0) + 1
            prev = strongest.get(key)
            if prev is None or float(e["signal_dbm"]) > prev[2]:
                strongest[key] = (str(e["band"]), int(e["channel"]), float(e["signal_dbm"]))
    out: dict[str, dict[int, float]] = {}
    for key, (band, ch, sig) in strongest.items():
        if sightings[key] < NEIGHBOUR_MIN_SIGHTINGS:
            continue  # seen once or twice: not a reason to avoid a channel
        chans = out.setdefault(band, {})
        chans[ch] = max(chans.get(ch, -200.0), sig)
    return out


def _bucket(sig: float) -> int:
    return 0 if sig < -80 else 1 if sig < -65 else 2


def channel_plan(n: int, busy: dict[str, dict[int, float]]) -> list[dict[str, Any]]:
    b5, b24 = busy.get("5", {}), busy.get("2.4", {})

    def block_busy(first: int) -> float:
        return max((v for ch, v in b5.items() if first <= ch <= first + 12), default=-200.0)

    order5 = sorted(BLOCKS_5, key=lambda b: (_bucket(block_busy(b[0])), b[2], block_busy(b[0])))

    def ch24_busy(c: int) -> float:
        return max((v for ch, v in b24.items() if abs(ch - c) <= 4), default=-200.0)

    order24 = sorted([1, 6, 11], key=lambda c: (_bucket(ch24_busy(c)), ch24_busy(c), c))
    plan: list[dict[str, Any]] = []
    for i in range(n):
        first, label, dfs = order5[i % len(order5)]
        busiest = block_busy(first)
        plan.append(
            {
                "2.4": {"channel": order24[i % 3], "width_mhz": 20, "power": "low (about 6 dB below 5 GHz)"},
                "5": {
                    "channel": first + 6,
                    "block": label,
                    "width_mhz": 80,
                    "dfs": dfs,
                    "neighbours_dbm": None if busiest < -150 else round(busiest),
                    "power": "high",
                },
                "6": {
                    "channel": CENTERS_6_160[i % len(CENTERS_6_160)],
                    "width_mhz": 160,
                    "note": "320 MHz is an option with up to 3 APs if your clients support it"
                    if n <= 3
                    else None,
                    "power": "high",
                },
            }
        )
    return plan


def plan_placement(
    plan: FloorPlan,
    env: Environment,
    mats: Materials,
    models: dict[str, BandModel],
    records: list[dict[str, Any]],
    ap: ApSpec,
    *,
    max_aps: int = 4,
    targets: Targets | None = None,
    baseline_rooms: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    targets = targets or Targets.load()
    warnings: list[str] = []
    base = models.get("5") or next(iter(models.values()), None)
    if base is None:
        return {"options": [], "warnings": ["No calibrated model — analyse the survey first"]}
    if "5" not in models:
        warnings.append("No 5 GHz fit; 5/6 GHz predicted from the 2.4 GHz fit")
    band_models = {b: base.for_band(b) for b in ("5", "6") if b in ap.eirp}
    if "6" in band_models:
        warnings.append("6 GHz is predicted from the 5 GHz fit (nothing to measure on 6 GHz yet)")

    cands = candidates(plan, env)
    if not cands:
        return {
            "options": [],
            "warnings": ["No candidate AP spots — every floor is set to 'No APs' or has no rooms"],
        }
    cells = eval_cells(plan, targets)
    matrices = {b: signal_matrix(env, mats, m, ap.eirp[b], cands, cells) for b, m in band_models.items()}
    penalty = np.array([0.0 if c.cable_feasible else NO_CABLE_PENALTY for c in cands])
    margin = (
        float(np.clip(round(base.rmse_db), MARGIN_MIN_DB, MARGIN_MAX_DB)) if base.rmse_db else MARGIN_MIN_DB
    )
    extra: dict[str, FArr] = {}
    if "2.4" in models and "2.4" in ap.eirp:
        extra["2.4"] = signal_matrix(env, mats, models["2.4"], ap.eirp["2.4"], cands, cells)
    scorer = Scorer(matrices, cells, penalty, margin, extra)
    busy = busy_channels(records)

    options: list[dict[str, Any]] = []
    chosen: list[int] = []
    for n in range(1, max_aps + 1):
        chosen = scorer.optimise(n, start=chosen)
        options.append(_option(n, chosen, scorer, cands, cells, plan, busy, baseline_rooms or []))

    # "Good enough" uses the same band weighting as the objective (5 and 6 GHz).
    norm = sum(BAND_WEIGHTS[b] for b in matrices)
    weighted = [sum(BAND_WEIGHTS[b] * o["coverage"].get(b, 0.0) for b in matrices) / norm for o in options]
    for o, w in zip(options, weighted, strict=True):
        o["coverage_weighted"] = round(w, 4)
    rec = next((i for i, c in enumerate(weighted) if c >= GOOD_ENOUGH), None)
    if rec is None:
        rec = (
            next(
                (i for i in range(1, len(weighted)) if weighted[i] - weighted[i - 1] < MIN_GAIN),
                len(weighted),
            )
            - 1
        )
        rec = max(rec, 0)
    return {
        "ap_model": {
            "key": ap.key,
            "name": ap.name,
            "planning_eirp_dbm": ap.eirp,
        },
        "design_margin_db": margin,
        "candidates": len(cands),
        "options": options,
        "recommended": rec,
        "warnings": warnings,
    }


def _baseline_coverage(room: dict[str, Any]) -> float | None:
    model: dict[str, Any] = room.get("model") or {}
    cov = model.get("coverage")
    return None if cov is None else float(cov)


def _option(
    n: int,
    chosen: list[int],
    scorer: Scorer,
    cands: list[Candidate],
    cells: Cells,
    plan: FloorPlan,
    busy: dict[str, dict[int, float]],
    baseline: list[dict[str, Any]],
) -> dict[str, Any]:
    channels = channel_plan(n, busy)
    names = {f.id: f.name for f in plan.floors}
    order = sorted(
        chosen,
        key=lambda i: (
            cells.floor_ids.index(cands[i].floor_id) if cands[i].floor_id in cells.floor_ids else 0,
            cands[i].xy,
        ),
    )
    aps = [
        {
            "floor_id": cands[i].floor_id,
            "floor": names.get(cands[i].floor_id, ""),
            "room_id": cands[i].room_id,
            "room": cands[i].room,
            "pos": [round(cands[i].xy[0], 2), round(cands[i].xy[1], 2)],
            "mount": "ceiling" if cands[i].source == "grid" else "site",
            "source": cands[i].source,
            "site_label": cands[i].label or None,
            "channels": channels[k],
        }
        for k, i in enumerate(order)
    ]

    best = {b: m[chosen].max(0) for b, m in {**scorer.matrices, **scorer.extra}.items()}
    base_by_room = {r["room_id"]: r for r in baseline}
    rooms: list[dict[str, Any]] = []
    for f in plan.floors:
        for room in f.rooms:
            sel = np.array([r == room.id for r in cells.room_of], dtype=bool)
            if not sel.any():
                continue
            thr = float(cells.threshold[sel][0])
            cov = {b: float(np.mean(v[sel] >= thr)) for b, v in best.items()}
            med = {b: float(np.median(v[sel])) for b, v in best.items()}
            b0 = base_by_room.get(room.id, {})
            rooms.append(
                {
                    "room_id": room.id,
                    "name": room.name,
                    "floor": f.name,
                    "priority": room.priority,
                    "target_dbm": thr,
                    "coverage": {b: round(c, 3) for b, c in cov.items()},
                    "median_dbm": {b: round(m, 1) for b, m in med.items()},
                    "excellent": {
                        b: round(float(np.mean(v[sel] >= EXCELLENT_DBM)), 3) for b, v in best.items()
                    },
                    "link_rate_mbps": {b: link_rate_mbps(m, b) for b, m in med.items()},
                    "throughput_mbps": {b: throughput_mbps(m, b) for b, m in med.items()},
                    "grade": letter(cov.get("5", 0.0)),
                    "baseline_grade": b0.get("grade"),
                    "baseline_coverage": _baseline_coverage(b0),
                }
            )

    grids: dict[str, Any] = {}
    for fi, fid in enumerate(cells.floor_ids):
        if fid not in cells.grid:
            continue
        layout = cells.grid[fid]
        sel = cells.floor_of == fi
        bands: dict[str, list[float | None]] = {}
        for b, v in best.items():
            vals: list[float | None] = [None] * (int(layout["nx"]) * int(layout["ny"]))
            for gi, val in zip(cells.grid_index[sel].tolist(), v[sel].tolist(), strict=True):
                vals[gi] = round(val * 2) / 2
            bands[b] = vals
        grids[fid] = {**layout, "bands": bands}

    return {
        "n_aps": n,
        "score": round(scorer.score(chosen), 4),
        "coverage": {b: round(scorer.coverage(chosen, b), 4) for b in scorer.matrices},
        "coverage_at_target": {
            b: round(scorer.share(chosen, b), 4) for b in [*scorer.matrices, *scorer.extra]
        },
        "excellent": {
            b: round(scorer.share(chosen, b, EXCELLENT_DBM), 4) for b in [*scorer.matrices, *scorer.extra]
        },
        "overlap_5": round(scorer.overlap(chosen, "5"), 4),
        "aps": aps,
        "rooms": rooms,
        "grids": grids,
    }

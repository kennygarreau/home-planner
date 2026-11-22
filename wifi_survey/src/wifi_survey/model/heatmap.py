"""Measurement-aware heatmaps: model prediction + interpolated residuals.

Plain interpolation between survey points smears signal straight through
walls. Instead, the calibrated model predicts the best signal available in
every grid cell (it knows where the walls are), and the remaining error at
each measured point is spread to nearby cells by inverse-distance weighting
that fades back to the pure model within a few metres. Walls therefore show
as sharp drops, and the map agrees with the readings where they were taken.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np

from wifi_survey.model.calibrate import BandModel, Transmitter
from wifi_survey.model.environment import Environment, FArr, Materials

IDW_RADIUS_M = 5.0
IDW_SOFTEN_M = 0.5
IDW_PRIOR_WEIGHT = 1 / 3.0**2  # equivalent of a zero-residual "reading" 3 m away


def _best(
    models: BandModel,
    env: Environment,
    materials: Materials,
    txs: list[Transmitter],
    floor_id: str,
    xy: FArr,
    z: float,
) -> FArr:
    preds = [models.predict(env, materials, t, floor_id, xy, z) for t in txs if t.bssid in models.eirp]
    return np.max(np.vstack(preds), axis=0) if preds else np.full(xy.shape[0], np.nan)


def build_grids(
    env: Environment,
    materials: Materials,
    models: dict[str, BandModel],
    transmitters: list[Transmitter],
    records: list[dict[str, Any]],
    bssid_to_ap: dict[str, str],
    step: float = 0.25,
) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for floor in env.floors:
        pts = [p for r in floor.rooms for p in r.polygon] + [p for w in floor.walls for p in (w.a, w.b)]
        if not pts:
            continue
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        x0, y0 = math.floor(min(xs) / step) * step, math.floor(min(ys) / step) * step
        nx = max(1, math.ceil((max(xs) - x0) / step))  # cells cover [x0, max x]
        ny = max(1, math.ceil((max(ys) - y0) / step))
        gx, gy = np.meshgrid(x0 + (np.arange(nx) + 0.5) * step, y0 + (np.arange(ny) + 0.5) * step)
        cells: FArr = np.column_stack([gx.ravel(), gy.ravel()]).astype(np.float64)
        mask = env.room_mask(floor.id, cells)
        z = env.rx_z(floor.id)

        here = [r for r in records if r.get("floor_id") == floor.id and r.get("pos")]
        bands: dict[str, list[float | None]] = {}
        for band, model in models.items():
            vals = np.full(cells.shape[0], np.nan)
            if mask.any():
                vals[mask] = _best(model, env, materials, transmitters, floor.id, cells[mask], z)
            # Residual correction from this floor's readings.
            pxy: list[tuple[float, float]] = []
            resid: list[float] = []
            for r in here:
                scan: list[dict[str, Any]] = r.get("scan") or []
                seen: list[float] = [
                    float(e["signal_dbm"])
                    for e in scan
                    if e.get("band") == band and str(e["bssid"]).lower() in bssid_to_ap
                ]
                if not seen:
                    continue
                p: FArr = np.array([r["pos"]], dtype=np.float64)
                pred = _best(
                    model,
                    env,
                    materials,
                    transmitters,
                    floor.id,
                    p,
                    env.rx_z(floor.id, r.get("height_m") or 1.0),
                )[0]
                if np.isfinite(pred):
                    pxy.append((float(r["pos"][0]), float(r["pos"][1])))
                    resid.append(float(max(seen) - pred))
            if pxy and mask.any():
                P: FArr = np.array(pxy, dtype=np.float64)
                R: FArr = np.array(resid, dtype=np.float64)
                d2 = ((cells[mask][:, None, :] - P[None, :, :]) ** 2).sum(-1)
                w = np.where(d2 <= IDW_RADIUS_M**2, 1 / (d2 + IDW_SOFTEN_M**2), 0.0)
                vals[mask] += (w * R).sum(1) / (w.sum(1) + IDW_PRIOR_WEIGHT)
            bands[band] = [None if not np.isfinite(v) else round(float(v) * 2) / 2 for v in vals]
        out[floor.id] = {"x0": x0, "y0": y0, "step": step, "nx": nx, "ny": ny, "bands": bands}
    return out

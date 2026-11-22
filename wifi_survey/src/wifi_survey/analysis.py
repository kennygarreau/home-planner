"""Fit the propagation model to a survey and build heatmaps (spec Phases 3-4).

Input: floorplan.json (home planner export) and the survey's point records
(spec §2.2). Output: a JSON-able dict the home planner stores and renders.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import asdict
from datetime import UTC, datetime
from typing import Any

from wifi_survey import SCHEMA_VERSION, __version__
from wifi_survey.floorplan.schema import FloorPlan
from wifi_survey.model.calibrate import BandModel, Observation, Transmitter, fit_band
from wifi_survey.model.environment import Environment, Materials
from wifi_survey.model.heatmap import build_grids
from wifi_survey.model.mapping import map_bssids

MIN_OBS_PER_BAND = 8
RMSE_TARGET_DB = 6.0


def analyze(
    floorplan: dict[str, Any],
    records: list[dict[str, Any]],
    *,
    materials: Materials | None = None,
    step: float = 0.25,
) -> dict[str, Any]:
    plan = FloorPlan.model_validate(floorplan)
    env = Environment(plan)
    mats = materials or Materials.load()
    warnings: list[str] = []

    records = [r for r in records if r.get("floor_id") in env.index and r.get("pos")]
    mapping = map_bssids(plan, env, records)
    warnings += mapping.warnings

    aps = {ap.id: (f, ap) for f in plan.floors for ap in f.existing_aps}
    transmitters: dict[str, Transmitter] = {}
    for bssid, ap_id in mapping.bssid_to_ap.items():
        f, ap = aps[ap_id]
        transmitters[bssid] = Transmitter(
            bssid, ap_id, f.id, (ap.pos[0], ap.pos[1]), env.mount_z(f.id, ap.mount)
        )

    obs: dict[str, list[Observation]] = defaultdict(list)
    for r in records:
        z = env.rx_z(r["floor_id"], r.get("height_m") or 1.0)
        for e in r.get("scan") or []:
            tx = transmitters.get(e["bssid"].lower())
            if tx and e.get("band"):
                obs[e["band"]].append(
                    Observation(
                        tx,
                        r["floor_id"],
                        (r["pos"][0], r["pos"][1]),
                        z,
                        float(e["signal_dbm"]),
                        r.get("point_id", ""),
                    )
                )

    models: dict[str, BandModel] = {}
    for band, ob in sorted(obs.items()):
        if len(ob) < MIN_OBS_PER_BAND:
            warnings.append(f"{band} GHz: only {len(ob)} readings — not enough to fit")
            continue
        m = fit_band(env, mats, band, ob)
        models[band] = m
        if m.rmse_db > RMSE_TARGET_DB:
            warnings.append(
                f"{band} GHz: model error {m.rmse_db:.1f} dB is above the {RMSE_TARGET_DB:.0f} dB target"
            )

    grids = build_grids(env, mats, models, list(transmitters.values()), records, mapping.bssid_to_ap, step)
    ap_label = {ap_id: aps[ap_id][1].label for ap_id in aps}
    channel = {r.bssid: r.channel for m in mapping.aps for r in m.radios}
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "tool_version": __version__,
        "points_used": len(records),
        "aps": [asdict(m) for m in mapping.aps],
        "bands": {
            band: {
                "n_obs": m.n_obs,
                "rmse_db": round(m.rmse_db, 2),
                "mae_db": round(m.mae_db, 2),
                "bias_db": round(m.bias_db, 2),
                "path_loss_exponent": round(m.n, 2),
                "material_factors": {k: round(v, 2) for k, v in sorted(m.k.items())},
                "material_loss_db": {k: round(m.loss_db(mats, k), 1) for k in sorted(m.k)},
                "eirp_dbm": {b: round(v, 1) for b, v in m.eirp.items()},
                "eirp_by_radio": [
                    {
                        "ap": ap_label[transmitters[b].ap_id],
                        "channel": channel.get(b),
                        "eirp_dbm": round(v, 1),
                    }
                    for b, v in sorted(
                        m.eirp.items(), key=lambda kv: (ap_label[transmitters[kv[0]].ap_id], kv[0])
                    )
                ],
                "residuals": m.residuals,
            }
            for band, m in models.items()
        },
        "grids": grids,
        "warnings": warnings,
    }

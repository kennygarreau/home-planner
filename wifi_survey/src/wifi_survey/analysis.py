"""Fit the propagation model to a survey and build heatmaps (spec Phases 3-4).

Input: floorplan.json (home planner export) and the survey's point records
(spec §2.2). Output: a JSON-able dict the home planner stores and renders.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from typing import Any

from wifi_survey import SCHEMA_VERSION, __version__
from wifi_survey.floorplan.schema import FloorPlan
from wifi_survey.model.calibrate import BandModel, Observation, Transmitter, fit_band
from wifi_survey.model.environment import Environment, Materials
from wifi_survey.model.grades import grade_rooms
from wifi_survey.model.heatmap import build_grids
from wifi_survey.model.mapping import Mapping, map_bssids
from wifi_survey.model.placement import load_ap_spec, plan_placement
from wifi_survey.model.targets import Targets

MIN_OBS_PER_BAND = 8
RMSE_TARGET_DB = 6.0


@dataclass
class Fitted:
    plan: FloorPlan
    env: Environment
    mats: Materials
    records: list[dict[str, Any]]
    mapping: Mapping
    transmitters: dict[str, Transmitter]
    models: dict[str, BandModel]
    warnings: list[str] = field(default_factory=list[str])


def fit_survey(
    floorplan: dict[str, Any], records: list[dict[str, Any]], materials: Materials | None = None
) -> Fitted:
    """Map radios to APs and fit the propagation model per band."""
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
        scan: list[dict[str, Any]] = r.get("scan") or []
        for e in scan:
            tx = transmitters.get(str(e["bssid"]).lower())
            if tx and e.get("band"):
                obs[str(e["band"])].append(
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
    return Fitted(plan, env, mats, records, mapping, transmitters, models, warnings)


def analyze(
    floorplan: dict[str, Any],
    records: list[dict[str, Any]],
    *,
    materials: Materials | None = None,
    step: float = 0.25,
) -> dict[str, Any]:
    fit = fit_survey(floorplan, records, materials)
    plan, env, mats, records, mapping = fit.plan, fit.env, fit.mats, fit.records, fit.mapping
    transmitters, models, warnings = fit.transmitters, fit.models, fit.warnings
    aps = {ap.id: (f, ap) for f in plan.floors for ap in f.existing_aps}

    grids = build_grids(env, mats, models, list(transmitters.values()), records, mapping.bssid_to_ap, step)
    grade_band = "5" if "5" in models else next(iter(models), "5")
    rooms = grade_rooms(plan, Targets.load(), grids, grade_band, records)
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
        "rooms": rooms,
        "warnings": warnings,
    }


def plan_aps(
    floorplan: dict[str, Any],
    records: list[dict[str, Any]],
    *,
    ap_model: str = "tplink_eap772",
    max_aps: int = 4,
) -> dict[str, Any]:
    """Placement options for new APs using the survey-calibrated model (spec Phase 5)."""
    fit = fit_survey(floorplan, records)
    grids = build_grids(
        fit.env, fit.mats, fit.models, list(fit.transmitters.values()), fit.records, fit.mapping.bssid_to_ap
    )
    band = "5" if "5" in fit.models else next(iter(fit.models), "5")
    baseline = grade_rooms(fit.plan, Targets.load(), grids, band, fit.records)
    result = plan_placement(
        fit.plan,
        fit.env,
        fit.mats,
        fit.models,
        fit.records,
        load_ap_spec(ap_model),
        max_aps=max(1, min(max_aps, 6)),
        baseline_rooms=baseline,
    )
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "tool_version": __version__,
        **result,
        "warnings": fit.warnings + result.get("warnings", []),
    }

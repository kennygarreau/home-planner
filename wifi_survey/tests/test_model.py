"""Propagation model: geometry, AP mapping, calibration recovery, heatmaps."""

import numpy as np
import pytest

from wifi_survey.analysis import analyze
from wifi_survey.floorplan.schema import FloorPlan
from wifi_survey.model.calibrate import Observation, Transmitter, fit_band
from wifi_survey.model.environment import Environment, Materials, fspl_1m
from wifi_survey.model.mapping import device_key, map_bssids

MATS = Materials.load()


def house(two_floors=False, door=False):
    """20 m x 10 m; drywall at x=5 and x=15, concrete at x=10. Rooms fill the floor."""

    def floor(fid, level, elev, slab):
        walls = [
            {"id": f"{fid}-n", "a": [0, 0], "b": [20, 0], "material": "exterior_frame", "exterior": True},
            {"id": f"{fid}-s", "a": [0, 10], "b": [20, 10], "material": "exterior_frame", "exterior": True},
            {"id": f"{fid}-w", "a": [0, 0], "b": [0, 10], "material": "exterior_frame", "exterior": True},
            {"id": f"{fid}-e", "a": [20, 0], "b": [20, 10], "material": "exterior_frame", "exterior": True},
            {"id": f"{fid}-d1", "a": [5, 0], "b": [5, 10], "material": "drywall"},
            {"id": f"{fid}-c", "a": [10, 0], "b": [10, 10], "material": "concrete"},
            {"id": f"{fid}-d2", "a": [15, 0], "b": [15, 10], "material": "drywall"},
        ]
        rooms = [
            {"id": f"{fid}-r{i}", "name": f"R{i}", "polygon": [[x, 0], [x + 5, 0], [x + 5, 10], [x, 10]]}
            for i, x in enumerate([0, 5, 10, 15])
        ]
        openings = (
            [
                {
                    "wall_id": f"{fid}-c",
                    "type": "door",
                    "offset_m": 4.5,
                    "width_m": 1.0,
                    "material": "wood_door",
                }
            ]
            if door
            else []
        )
        return {
            "id": fid,
            "name": fid,
            "level": level,
            "elevation_m": elev,
            "ceiling_height_m": 2.5,
            "slab_material": slab,
            "rooms": rooms,
            "walls": walls,
            "openings": openings,
            "existing_aps": [],
        }

    floors = [floor("g", 0, 0.0, "wood_joist" if two_floors else None)]
    if two_floors:
        floors.append(floor("u", 1, 2.8, None))
    floors[0]["existing_aps"] = [
        {"id": "ap1", "label": "West", "pos": [2.0, 2.0], "mount": "desk"},
        {"id": "ap2", "label": "East", "pos": [18.0, 8.0], "mount": "ceiling"},
    ]
    return {"schema_version": 1, "units": "m", "floors": floors}


def test_crossings_and_openings():
    env = Environment(FloorPlan.model_validate(house(door=True)))
    f = env.features("g", (2.0, 5.0), 1.0, "g", np.array([[18.0, 5.0], [18.0, 1.0], [3.0, 5.0]]), 1.0)
    # (2,5)→(18,5): drywall x2, through the concrete wall's door at y=5
    assert f.walls["wall:drywall"].tolist() == [2, 2, 0]
    assert f.walls["opening:wood_door"].tolist() == [1, 0, 0]
    assert f.walls["wall:concrete"].tolist() == [0, 1, 0]
    assert f.log_d[2] == pytest.approx(np.log10(1.0))


def test_slabs_between_floors():
    env = Environment(FloorPlan.model_validate(house(two_floors=True)))
    f = env.features("g", (2.0, 2.0), 0.8, "u", np.array([[2.0, 2.0]]), 3.8)
    assert f.slabs == {"wood_joist": pytest.approx(np.array([1.0]))}
    assert 10 ** f.log_d[0] == pytest.approx(3.0)


def synth_records(plan_json, truth, noise=0.0, seed=0):
    """Readings from a known model at a 1 m grid (two radios per AP, one band)."""
    plan = FloorPlan.model_validate(plan_json)
    env = Environment(plan)
    rng = np.random.default_rng(seed)
    radios = {
        "ap1": ["02:11:22:33:44:10", "00:11:22:33:44:14"],
        "ap2": ["02:aa:bb:cc:dd:20", "00:aa:bb:cc:dd:24"],
    }
    records = []
    for f in plan.floors:
        for x in np.arange(0.5, 20, 1.0):
            for y in np.arange(0.5, 10, 1.5):
                scan = []
                for fl in plan.floors:
                    for ap in fl.existing_aps:
                        feat = env.features(
                            fl.id,
                            ap.pos,
                            env.mount_z(fl.id, ap.mount),
                            f.id,
                            np.array([[x, y]]),
                            env.rx_z(f.id),
                        )
                        for b in radios[ap.id]:
                            rssi = truth["eirp"][b] - fspl_1m("5") - 10 * truth["n"] * feat.log_d[0]
                            for key, cnt in feat.walls.items():
                                kind, name = key.split(":", 1)
                                rssi -= cnt[0] * MATS.loss(kind, name, "5") * truth["k"].get(key, 1.0)
                            for mat, cnt in feat.slabs.items():
                                rssi -= (
                                    cnt[0] * MATS.loss("floor", mat, "5") * truth["k"].get(f"slab:{mat}", 1.0)
                                )
                            scan.append(
                                {
                                    "bssid": b,
                                    "band": "5",
                                    "channel": 36,
                                    "signal_dbm": float(rssi + rng.normal(0, noise)),
                                }
                            )
                records.append(
                    {
                        "point_id": f"{f.id}-{x}-{y}",
                        "floor_id": f.id,
                        "pos": [float(x), float(y)],
                        "height_m": 1.0,
                        "connected": {"bssid": radios["ap1"][0]},
                        "scan": scan,
                    }
                )
    # make the laptop "connect" to ap2 somewhere too
    records[-1]["connected"] = {"bssid": radios["ap2"][0]}
    return records


TRUTH = {
    "n": 3.3,
    "k": {"wall:drywall": 1.4, "wall:concrete": 0.8, "wall:exterior_frame": 1.0, "slab:wood_joist": 1.2},
    "eirp": {
        "02:11:22:33:44:10": 18.0,
        "00:11:22:33:44:14": 21.0,
        "02:aa:bb:cc:dd:20": 23.0,
        "00:aa:bb:cc:dd:24": 16.0,
    },
}


def test_device_key_ignores_locally_administered_bit():
    assert device_key("02:11:22:33:44:10") == device_key("00:11:22:33:44:14")
    assert device_key("00:11:22:33:44:14") != device_key("00:11:22:33:45:14")


def test_mapping_groups_radios_and_ignores_neighbours():
    plan_json = house()
    recs = synth_records(plan_json, TRUTH)
    for r in recs:  # a strong neighbour that the laptop never joins
        r["scan"].append({"bssid": "66:77:88:99:aa:bb", "band": "5", "channel": 40, "signal_dbm": -40.0})
    plan = FloorPlan.model_validate(plan_json)
    m = map_bssids(plan, Environment(plan), recs)
    assert m.bssid_to_ap == {
        "02:11:22:33:44:10": "ap1",
        "00:11:22:33:44:14": "ap1",
        "02:aa:bb:cc:dd:20": "ap2",
        "00:aa:bb:cc:dd:24": "ap2",
    }
    assert all(a.distance_m < 1.5 for a in m.aps) and not m.warnings


@pytest.mark.parametrize("two_floors", [False, True])
def test_calibration_recovers_known_parameters(two_floors):
    """Spec Phase 4 'done': synthetic data with known parameters is recovered."""
    plan_json = house(two_floors=two_floors)
    plan = FloorPlan.model_validate(plan_json)
    env = Environment(plan)
    recs = synth_records(plan_json, TRUTH)
    mapping = map_bssids(plan, env, recs)
    aps = {ap.id: (f, ap) for f in plan.floors for ap in f.existing_aps}
    txs = {
        b: Transmitter(b, a, aps[a][0].id, aps[a][1].pos, env.mount_z(aps[a][0].id, aps[a][1].mount))
        for b, a in mapping.bssid_to_ap.items()
    }
    obs = [
        Observation(
            txs[e["bssid"]],
            r["floor_id"],
            tuple(r["pos"]),
            env.rx_z(r["floor_id"]),
            e["signal_dbm"],
            r["point_id"],
        )
        for r in recs
        for e in r["scan"]
    ]
    m = fit_band(env, MATS, "5", obs)
    assert m.n == pytest.approx(TRUTH["n"], abs=0.05)
    assert m.k["wall:drywall"] == pytest.approx(1.4, abs=0.05)
    assert m.k["wall:concrete"] == pytest.approx(0.8, abs=0.05)
    if two_floors:
        assert m.k["slab:wood_joist"] == pytest.approx(1.2, abs=0.05)
    for b, e in TRUTH["eirp"].items():
        assert m.eirp[b] == pytest.approx(e, abs=0.5)
    assert m.rmse_db < 0.3


def test_noisy_fit_has_honest_error():
    plan_json = house()
    result = analyze(plan_json, synth_records(plan_json, TRUTH, noise=3.0, seed=1))
    b = result["bands"]["5"]
    assert 2.0 < b["rmse_db"] < 4.0  # ≈ the injected 3 dB noise
    assert b["path_loss_exponent"] == pytest.approx(3.3, abs=0.3)


def test_analysis_output_and_heatmap():
    plan_json = house(two_floors=True, door=True)
    result = analyze(plan_json, synth_records(plan_json, TRUTH))
    assert set(result["bands"]) == {"5"} and not result["warnings"]
    assert {a["label"] for a in result["aps"]} == {"West", "East"}
    g = result["grids"]["g"]
    vals = g["bands"]["5"]
    assert len(vals) == g["nx"] * g["ny"]
    grid = np.array([np.nan if v is None else v for v in vals]).reshape(g["ny"], g["nx"])
    cell = lambda x, y: grid[int((y - g["y0"]) / g["step"]), int((x - g["x0"]) / g["step"])]  # noqa: E731
    assert cell(2.1, 2.1) > cell(9.0, 5.0)  # near the West AP beats behind drywall
    assert np.isfinite(grid).all()  # the rooms cover the whole floor


def test_heatmap_shows_walls_as_sharp_drops():
    # One AP only, so "best signal" on both sides of the concrete wall comes from it.
    plan_json = house()
    plan_json["floors"][0]["existing_aps"] = plan_json["floors"][0]["existing_aps"][:1]
    result = analyze(plan_json, synth_records(plan_json, TRUTH))
    g = result["grids"]["g"]
    grid = np.array(g["bands"]["5"], dtype=float).reshape(g["ny"], g["nx"])
    cell = lambda x, y: grid[int((y - g["y0"]) / g["step"]), int((x - g["x0"]) / g["step"])]  # noqa: E731
    concrete = MATS.loss("wall", "concrete", "5") * TRUTH["k"]["wall:concrete"]  # 14.4 dB
    drop = cell(9.9, 1.0) - cell(10.1, 1.0)  # 20 cm apart, either side of the wall
    assert drop == pytest.approx(concrete, abs=1.5)


def test_no_aps_warns():
    plan_json = house()
    plan_json["floors"][0]["existing_aps"] = []
    result = analyze(plan_json, synth_records(house(), TRUTH))
    assert result["bands"] == {} and any("No existing APs" in w for w in result["warnings"])

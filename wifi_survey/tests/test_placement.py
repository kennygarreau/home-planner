"""Room grades, AP placement and channel plan."""

import pytest
from test_model import TRUTH, house, synth_records

from wifi_survey.analysis import analyze, plan_aps
from wifi_survey.floorplan.schema import FloorPlan, Room
from wifi_survey.model.calibrate import BandModel
from wifi_survey.model.environment import Environment, Materials
from wifi_survey.model.grades import grade_room, letter
from wifi_survey.model.placement import ApSpec, candidates, channel_plan, load_ap_spec, plan_placement
from wifi_survey.model.targets import Target, Targets

MATS = Materials.load()


# ── Targets & grades ─────────────────────────────────────────────────────────


def test_room_target_takes_strictest_use():
    t = Targets.load()
    room = Room(id="r", name="Office", polygon=[(0, 0), (1, 0), (1, 1)], use=["streaming", "video_calls"])
    got = t.for_room(room)
    assert (got.signal_dbm, got.down_mbps, got.latency_p95_ms) == (-67, 50, 30)
    assert t.for_room(Room(id="x", name="x", polygon=[])) == t.default
    assert t.weight(Room(id="h", name="h", polygon=[], priority="high")) == 3.0


def test_letters():
    assert [letter(s) for s in (0.95, 0.9, 0.85, 0.75, 0.6, 0.3)] == ["A", "A", "B", "C", "D", "F"]


def rec(signal, down, p95):
    return {
        "connected": {"signal_dbm": signal},
        "throughput": {"down_mbps": down},
        "latency": {"p95_ms": p95},
    }


def test_grade_room_components_and_issues():
    room = Room(id="r", name="Office", polygon=[], use=["office"])
    target = Target(-67, 50, 40)
    good = grade_room(room, target, 1.0, -55, [rec(-55, 300, 5), rec(-58, 250, 6)])
    assert good["grade"] == "A" and good["pass"] and not good["issues"]
    bad = grade_room(room, target, 0.6, -70, [rec(-69, 10, 50), rec(-66, 7, 9)])
    assert bad["grade"] == "F" and not bad["pass"]
    assert any("below -67 dBm" in i for i in bad["issues"]) and any(
        "Download 8 Mbps" in i for i in bad["issues"]
    )
    # Without a heatmap grid, coverage falls back to the share of spots meeting the target.
    only_points = grade_room(room, target, None, None, [rec(-60, 100, 5), rec(-70, 100, 5)])
    assert only_points["components"]["coverage"] == 0.5


def test_analysis_includes_room_grades():
    plan_json = house()
    result = analyze(plan_json, synth_records(plan_json, TRUTH))
    rooms = result["rooms"]
    assert len(rooms) == 4 and all(r["grade"] in "ABCDF" for r in rooms)
    assert all(r["model"]["coverage"] is not None for r in rooms)


# ── Placement ────────────────────────────────────────────────────────────────


def long_room(placement="anywhere", sites=()):
    """One open 24 m x 6 m room: the obvious answers are the middle (1 AP) and the quarter points (2)."""
    return FloorPlan.model_validate(
        {
            "floors": [
                {
                    "id": "f",
                    "name": "F",
                    "elevation_m": 0,
                    "ceiling_height_m": 2.5,
                    "ap_placement": placement,
                    "rooms": [{"id": "r", "name": "Hall", "polygon": [[0, 0], [24, 0], [24, 6], [0, 6]]}],
                    "walls": [],
                    "candidate_ap_sites": list(sites),
                }
            ]
        }
    )


FLAT = {"5": BandModel(band="5", n=3.0, k={}, eirp={})}


def placement(plan, ap=None, **kw):
    return plan_placement(
        plan, Environment(plan), MATS, FLAT, [], ap or ApSpec("t", "Test", {"5": 14.0}), **kw
    )


def test_one_ap_goes_in_the_middle():
    # Strong enough to cover the room from the centre, but only with margin to spare there.
    one = placement(long_room(), ap=ApSpec("t", "Test", {"5": 10.0}), max_aps=1)["options"][0]
    assert one["aps"][0]["pos"][0] == pytest.approx(12.0, abs=1.5)
    assert one["aps"][0]["pos"][1] == pytest.approx(3.0, abs=1.0)


def test_two_aps_split_the_room():
    # ~4 m reach (with the 3 dB design margin): two APs must share the 24 m room.
    one, two = placement(long_room(), ap=ApSpec("t", "Test", {"5": -3.0}), max_aps=2)["options"]
    xs = sorted(a["pos"][0] for a in two["aps"])
    assert xs[0] == pytest.approx(6.0, abs=2.0) and xs[1] == pytest.approx(18.0, abs=2.0)
    assert two["coverage"]["5"] > one["coverage"]["5"]


def test_all_options_offered_and_more_aps_buy_excellent_signal():
    res = placement(long_room(), ap=ApSpec("t", "Test", {"5": 14.0}), max_aps=4)
    opts = res["options"]
    assert [o["n_aps"] for o in opts] == [1, 2, 3, 4]
    assert res["recommended"] == 0  # one AP already meets the targets
    exc = [o["excellent"]["5"] for o in opts]
    assert exc[1] > exc[0] and exc[3] >= exc[2] >= exc[1]  # extra APs still buy something
    assert opts[1]["overlap_5"] > 0 and opts[0]["overlap_5"] == 0
    room = opts[1]["rooms"][0]
    assert room["link_rate_mbps"]["5"] > 0 and room["throughput_mbps"]["5"] <= 940


def test_design_margin_comes_from_model_error():
    noisy = {"5": BandModel(band="5", n=3.0, k={}, eirp={}, rmse_db=5.4)}
    plan = long_room()
    res = plan_placement(
        plan, Environment(plan), MATS, noisy, [], ApSpec("t", "Test", {"5": 14.0}), max_aps=1
    )
    assert res["design_margin_db"] == 5.0
    assert placement(long_room(), max_aps=1)["design_margin_db"] == 3.0  # floor when RMSE is unknown


def test_placement_is_deterministic():
    a = placement(long_room(), max_aps=3)
    b = placement(long_room(), max_aps=3)
    assert [o["aps"] for o in a["options"]] == [o["aps"] for o in b["options"]]


def test_floor_settings_control_candidates():
    env_none = long_room("none")
    assert candidates(env_none, Environment(env_none)) == []
    site = {"id": "s", "label": "C1", "pos": [3.0, 3.0], "mount": "ceiling", "cable_feasible": True}
    only_sites = long_room("candidates", [site])
    c = candidates(only_sites, Environment(only_sites))
    assert len(c) == 1 and c[0].source == "site" and c[0].room == "Hall"


def test_recommends_smallest_layout_that_is_good_enough():
    strong = placement(long_room(), ap=ApSpec("t", "Test", {"5": 30.0}), max_aps=3)
    assert strong["options"][0]["coverage"]["5"] >= 0.95 and strong["recommended"] == 0
    weak = placement(long_room(), ap=ApSpec("t", "Test", {"5": -5.0}), max_aps=3)  # ~4.5 m reach
    assert weak["recommended"] >= 1


def test_option_has_rooms_and_grid():
    opt = placement(long_room(), max_aps=1)["options"][0]
    assert opt["rooms"][0]["name"] == "Hall" and opt["rooms"][0]["grade"] in "ABCDF"
    g = opt["grids"]["f"]
    assert len(g["bands"]["5"]) == g["nx"] * g["ny"]


def test_neighbours_seen_once_dont_block_channels():
    from wifi_survey.model.placement import busy_channels

    home = {"bssid": "00:11:22:33:44:01"}
    recs = [
        {
            "connected": home,
            "scan": [{"bssid": "aa:aa:aa:aa:aa:01", "band": "5", "channel": 44, "signal_dbm": -50.0}],
        }
        for _ in range(3)
    ]
    recs[0]["scan"].append({"bssid": "bb:bb:bb:bb:bb:01", "band": "5", "channel": 161, "signal_dbm": -55.0})
    busy = busy_channels(recs)
    assert busy == {"5": {44: -50.0}}  # the one-off sighting on 161 is ignored


def test_channel_plan_avoids_busy_channels():
    busy = {"5": {44: -50.0, 48: -55.0}, "2.4": {1: -60.0, 2: -58.0}}
    plan = channel_plan(3, busy)
    blocks = [p["5"]["block"] for p in plan]
    assert blocks[0] == "149-161" and len(set(blocks)) == 3 and "36-48" not in blocks
    assert plan[0]["2.4"]["channel"] in (6, 11) and plan[0]["2.4"]["width_mhz"] == 20
    assert len({p["6"]["channel"] for p in plan}) == 3


def test_ap_spec_eirp_uses_planning_margin():
    spec = load_ap_spec("tplink_eap772")
    assert spec.eirp == {"2.4": 16.0, "5": 21.0, "6": 21.0}  # design tx power + antenna gain
    with pytest.raises(KeyError):
        load_ap_spec("nope")


def test_plan_aps_end_to_end():
    plan_json = house(two_floors=True)
    res = plan_aps(plan_json, synth_records(plan_json, TRUTH), max_aps=2)
    assert res["ap_model"]["name"] == "EAP772" and len(res["options"]) == 2
    opt = res["options"][res["recommended"]]
    assert {"5", "6"} <= set(opt["coverage"]) and opt["aps"][0]["channels"]["5"]["width_mhz"] == 80
    assert any("6 GHz is predicted" in w for w in res["warnings"])
    assert all(r["baseline_grade"] for r in opt["rooms"])


def test_recommendation_weighs_6ghz_too():
    # 5 GHz alone would be "good enough" with one AP; 6 GHz (weaker) still needs a second.
    plan = long_room()
    models = {"5": BandModel(band="5", n=3.0, k={}, eirp={})}
    ap = ApSpec("t", "Test", {"5": 14.0, "6": 2.0})
    res = plan_placement(plan, Environment(plan), MATS, models, [], ap, max_aps=3)
    first = res["options"][0]
    assert first["coverage"]["5"] >= 0.95 and first["coverage"]["6"] < 0.9
    assert res["recommended"] >= 1
    assert all("coverage_weighted" in o for o in res["options"])

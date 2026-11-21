# Wi‑Fi Survey & AP Placement Module — Implementation Plan

> Plan for Claude Code. This is the `wifi_survey` module of a larger home‑planner project.
> Goal: survey existing Wi‑Fi coverage with a laptop, model new access point (AP) placements, and produce a report with per‑room coverage floor plans.

---

## 1. Context

| Item | Value |
|---|---|
| New APs | TP‑Link Omada, Wi‑Fi 7, BE11000 tri‑band (2.4 / 5 / 6 GHz). **Confirm the exact model number** (e.g. EAP7xx) and fill its specs into `config/ap_models.yaml` |
| Survey laptop | Linux (Garuda/Arch), Intel 800‑series CNVi Wi‑Fi 7 (`8086:7f70`), supports 2.4/5/6 GHz |
| Wireless interface | `wlp128s20f3` (detect at runtime; don't hard‑code it) |
| Network manager | NetworkManager (`nmcli`) + `iw` |
| Existing network | Mesh/router with several BSSIDs on 2.4 and 5 GHz; baseline is about -69 dBm on 5 GHz in the starting room |
| AP power | PoE+ (802.3at) required; placement is limited to places Ethernet can reach |

### Constraints

- **No root for normal survey runs.** Use `nmcli dev wifi rescan` to start a scan, then read the cached results with `iw dev <if> scan dump` and `iw dev <if> link`. Check on day one that `scan dump` works without root; if it doesn't, fall back to `nmcli` (signal in %, converted to approximate dBm) and record which source was used.
- Never change system network settings. The tool only reads.
- Keep SSIDs, BSSIDs and the house layout in local data files. Never send them to outside services.

---

## 2. Integration contract (how this fits the larger project)

The module is self‑contained and talks to the rest of the project only through these files. Version every schema (`"schema_version": 1`).

```
wifi_survey/
  pyproject.toml            # managed with uv; Python ≥3.12
  README.md
  config/
    ap_models.yaml          # AP radio specs (tx power, antenna gain per band)
    materials.yaml          # wall material → attenuation dB per band
    survey.yaml             # interface, iperf server, samples per point, etc.
  src/wifi_survey/
    floorplan/              # load/validate/render floor plans
    collect/                # measurement collection (iw, nmcli, iperf3, ping)
    model/                  # propagation model, calibration, placement optimizer
    viz/                    # heatmaps, floor‑plan overlays
    report/                 # report builder (HTML + Markdown + PNG/SVG)
    cli.py                  # `wifi-survey` entry point (Typer)
  tests/
  data/                     # gitignored: real house data lives here
    floorplan.json
    surveys/<survey_id>/points.jsonl
    surveys/<survey_id>/meta.json
  out/                      # gitignored: generated reports
```

### 2.1 `floorplan.json` (shared with the home planner)

If the larger project already has a floor‑plan model, **write an adapter to it instead of creating a second source of truth.** Otherwise, use this schema:

```jsonc
{
  "schema_version": 1,
  "units": "m",
  "floors": [
    {
      "id": "ground",
      "name": "Ground floor",
      "elevation_m": 0.0,
      "ceiling_height_m": 2.5,
      "slab_material": "concrete_slab",      // attenuation to the floor above
      "background_image": "plans/ground.png", // optional, with scale/offset below
      "image_transform": {"scale_px_per_m": 50, "origin_px": [40, 40]},
      "rooms": [
        {"id": "kitchen", "name": "Kitchen", "polygon": [[0,0],[4,0],[4,5],[0,5]],
         "priority": "high", "use": ["video_calls"]}
      ],
      "walls": [
        {"id": "w1", "a": [4,0], "b": [4,5], "material": "drywall", "thickness_m": 0.12}
      ],
      "openings": [
        {"wall_id": "w1", "type": "door", "offset_m": 1.0, "width_m": 0.9}
      ],
      "ethernet_drops": [
        {"id": "e1", "pos": [3.8, 0.2], "mount": "ceiling", "existing": true}
      ],
      "candidate_ap_sites": [
        {"id": "c1", "pos": [2.0, 2.5], "mount": "ceiling", "cable_feasible": true}
      ],
      "obstacles": [
        {"type": "fridge", "polygon": [[0,4],[0.8,4],[0.8,4.8],[0,4.8]], "material": "metal"}
      ]
    }
  ]
}
```

### 2.2 Survey point record (`points.jsonl`, one JSON object per line)

```jsonc
{
  "schema_version": 1,
  "point_id": "kitchen-02",
  "floor_id": "ground",
  "room_id": "kitchen",
  "pos": [2.1, 3.4],
  "height_m": 1.0,
  "timestamp": "2026-11-21T14:03:22Z",
  "connected": {
    "bssid": "…", "ssid": "…", "freq_mhz": 5805, "channel": 161, "width_mhz": 80,
    "signal_dbm": -69, "rx_bitrate_mbps": 216.1, "tx_bitrate_mbps": 288.2,
    "rx_mcs": "HE-MCS 2", "nss": 2
  },
  "scan": [
    {"bssid": "…", "ssid": "…", "freq_mhz": 2417, "band": "2.4", "signal_dbm": -55, "source": "iw"}
  ],
  "throughput": {"down_mbps": 410.2, "up_mbps": 380.5, "retransmits": 12, "duration_s": 10},
  "latency": {"target": "gateway", "avg_ms": 3.1, "p95_ms": 7.9, "jitter_ms": 1.2, "loss_pct": 0.0},
  "samples": 3,
  "notes": ""
}
```

`meta.json` records: survey type (`baseline` | `ap_on_a_stick` | `validation`), the AP used for the test with its position and settings, laptop and driver versions, iperf server, and the date.

### 2.3 Outputs (what the home planner consumes)

- `out/<survey_id>/report.html` (self‑contained) and `report.md`
- `out/<survey_id>/heatmaps/<floor>_<band>_<metric>.png` and `.svg`
- `out/<survey_id>/rooms.json`: a grade, metrics, and pass/fail per room (machine‑readable)
- `out/plan/placement.json`: recommended AP sites, bands, channels, power, and expected coverage per room

---

## 3. Phases

Work through these in order. Each phase ends with its tests passing and a short demo command in the README.

### Phase 0 — Setup and environment check
- Scaffold the package with `uv init --package wifi_survey`. Dependencies: `numpy`, `scipy`, `shapely`, `matplotlib`, `pydantic`, `typer`, `rich`, `jinja2`, `pyyaml`.
- System tools: `iperf3` (`sudo pacman -S iperf3`; the user runs this). Optional: `wavemon`.
- `wifi-survey doctor` checks for: the interface, `iw`, `nmcli`, `iperf3`, reachability of the iperf server, whether `scan dump` works without root, and 6 GHz support (`iw list`, looking for 6 GHz frequencies and EHT capabilities).
- **Done when:** `doctor` prints a clean pass/fail table on this laptop.

### Phase 1 — Floor plan
- Pydantic models for the schema in 2.1, plus validation: closed room polygons, walls inside floor bounds, openings that fit their walls.
- **Ways to get a floor plan in** (the tool can't infer walls from Wi‑Fi):
  1. **Room‑list builder:** a YAML list of rooms with sizes and adjacency (e.g. `kitchen: 4x5, north_of: living`) → a rough first layout the user corrects.
  2. **Image tracing:** load a photo or PDF of a sketch or builder plan. The user clicks two points with a known distance to set the scale, then traces rooms and walls in a small local web editor (one page of HTML/JS served by `wifi-survey edit-plan`). Save as `floorplan.json`.
  3. **Import:** an adapter for scan‑app exports (e.g. magicplan, or RoomPlan USDZ/JSON) if the user has one. Leave this as a stub until a real file exists.
- Render the plan to SVG/PNG with room labels, wall materials (colour‑coded), Ethernet drops, and candidate sites.
- **Done when:** a sample plan round‑trips (load → validate → render), and the editor saves a valid file.

### Phase 2 — Collection
- `collect/wifi.py`: parse the output of `iw dev <if> link`, `iw dev <if> scan dump`, and `nmcli -t dev wifi list`. Keep **fixture files of real command output** in `tests/fixtures/` and unit‑test the parsers against them.
- `collect/perf.py`: `iperf3 -c <server> -J` both ways (`-R` for download), 10 s each by default. Ping the gateway (and optionally a public host) for latency, p95, jitter and loss.
- `wifi-survey survey run --survey-id baseline-2026-11 --floor ground`: an interactive loop:
  1. Show the floor plan with points already surveyed.
  2. The user picks a room and clicks or types a position (or picks a pre‑planned grid point).
  3. The tool waits ~3 s to settle, takes N scan samples (default 3, median per BSSID), runs iperf and ping, and appends a line to `points.jsonl`.
  4. Pick up where it left off after a crash or restart (resume support).
- Plan points automatically: 2–4 per room, spaced about every 2–3 m, plus doorways and known problem spots.
- Hold the laptop at a consistent height (~1 m); the tool reminds the user. Lock the laptop to one band/BSSID only when the survey type calls for it.
- **Done when:** a dry run with a mocked command runner writes valid JSONL, and a real 3‑point test in one room works end to end.

### Phase 3 — Visualisation (measured data)
- Interpolate measured points onto a grid for each floor. Use a model‑aware approach rather than plain IDW: fit the propagation model (Phase 4) to the measurements, then interpolate the **leftover error** with IDW or kriging, so walls show up as sharp drops instead of smooth blur.
- Heatmaps for: strongest signal per band, signal of the connected AP, download/upload throughput, latency, and AP‑handoff zones (best BSSID per cell).
- Colour scale with standard thresholds: ≥ -60 dBm excellent, -60 to -67 good (VoIP/video), -67 to -75 fair, < -75 poor. Use a colour‑blind‑safe palette and draw room outlines on top.
- **Done when:** heatmaps render from fixture data with a legend, scale bar, and north arrow.

### Phase 4 — Propagation model and calibration
- **Multi‑wall model** (COST‑231 style):
  `RSSI = Ptx + Gtx + Grx − PL(d0) − 10·n·log10(d/d0) − Σ wall_loss(material, band) − floor_loss·k`
  - Use shapely to find the walls each path crosses. Doors and windows count as openings with lower loss.
  - Default losses per band in `materials.yaml` (drywall, brick, concrete, glass, metal, wood door, floor slab), loosely based on published values. 6 GHz loses more through walls than 5 GHz.
- **Calibration:** fit `n` and a correction factor per material to the baseline data with `scipy.optimize.least_squares`, starting from the known positions of the current APs (the user marks them). Report the fit error (RMSE in dB) for each band.
- **Done when:** on synthetic data with known parameters, the fit recovers them within tolerance. On real data, report the RMSE (aim for < 6 dB).

### Phase 5 — Placement optimisation
- Inputs: candidate sites (cable‑feasible only, unless the user allows "would need a new cable run"), number of APs (1–4), room priorities, AP specs per band, and target thresholds per room use.
- Objective: maximise the **weighted share of each room's area** that meets the target on 5 GHz and 6 GHz, with penalties for overlap that causes co‑channel interference and for sites that need a new cable run.
- Method: try every combination when there are few candidates; otherwise greedy selection plus local search.
- Channel plan: no overlap on 5 GHz (prefer 80 MHz, 160 MHz only if the band is clean) or 6 GHz (consider 160/320 MHz). Use 20 MHz on 2.4 GHz with channels 1/6/11. Avoid channels the baseline scan shows busy. Suggest per‑band transmit power (usually lower on 2.4 GHz to discourage sticky clients).
- Write `placement.json` and draw the predicted heatmaps for each layout option (top 3).
- **Done when:** the optimiser picks the obvious best sites on a toy floor plan, and its results don't change between runs.

### Phase 6 — "AP on a stick" check
- Once the first Omada AP arrives: power it with a temporary PoE injector at the top candidate site, give it a test SSID, and run the survey again with `--type ap_on_a_stick --ap-site c1`.
- Re‑fit the model using the real AP's readings and re‑run placement. Show predicted vs measured readings per point (error histogram).
- Repeat for the second‑best site if the result is unclear.

### Phase 7 — Report
- Built with Jinja2 into `report.html` (self‑contained, images inlined) and `report.md`:
  1. Summary: recommended number of APs, their sites, and expected results
  2. Method and equipment
  3. Baseline: heatmaps per floor and band, plus a table of rooms graded A–F
  4. Recommended layout: floor plans with AP icons, predicted heatmaps, room table showing before → after
  5. Alternatives considered (top 3) with trade‑offs
  6. Omada setup checklist: SSIDs per band, channels and widths, power, fast roaming (802.11k/v/r), band steering, minimum RSSI (use carefully), MLO, PoE+ budget
  7. Appendix: raw point table, model fit statistics, materials table
- Also write `rooms.json` and `placement.json` for the home planner.
- **Done when:** the report builds from fixture data and the real baseline, and opens offline.

### Phase 8 — Final check after install
- After the APs are mounted and set up, run a `validation` survey on the same point grid.
- Generate a before/after comparison report and flag rooms that miss their target.

---

## 4. CLI summary

```bash
wifi-survey doctor
wifi-survey plan new --from-rooms rooms.yaml        # or: edit-plan --image sketch.jpg
wifi-survey edit-plan                               # local web editor
wifi-survey survey points --floor ground            # generate the point grid
wifi-survey survey run --survey-id baseline --floor ground
wifi-survey model fit --survey-id baseline
wifi-survey place --aps 2 --survey-id baseline
wifi-survey survey run --survey-id stick-c1 --type ap_on_a_stick --ap-site c1
wifi-survey report --survey-id baseline --plan out/plan/placement.json
```

---

## 5. Testing

- Unit tests: parsers (against real fixture output), geometry (wall crossings, openings), model (synthetic recovery), optimiser (toy plans), schema validation.
- Use a fake command runner so the tests never touch the real radio.
- One synthetic "golden" house with known AP positions, used across phases 3–7.
- `ruff` + `pytest`; type‑check with `pyright` in strict mode for `model/` and `floorplan/`.

---

## 6. Inputs the user must provide

- [ ] Floor plan source: a sketch photo, builder PDF, scan‑app export, or room list with sizes
- [ ] Number of floors, ceiling heights, and wall materials
- [ ] Positions of the current router/mesh units, plus internet speed
- [ ] Existing Ethernet drops and places a cable could be run
- [ ] A wired machine to run `iperf3 -s` (desktop, NAS, Raspberry Pi)
- [ ] Room priorities and uses (office calls, TV streaming, etc.)
- [ ] The exact Omada AP model and quantity; the PoE+ switch or injectors; the controller type (software, hardware, or app standalone)

## 7. Open questions / risks

- Whether `iw scan dump` works without root on this kernel. Check in Phase 0.
- 6 GHz cannot be surveyed until a 6 GHz AP exists. Baseline 6 GHz coverage is predicted only, and must be checked in Phase 6.
- Laptop antennas differ from phones; note this in the report. Optionally adjust using a phone app reading.
- Interference from neighbours changes over time; repeat scans at different times of day if channel choice matters.

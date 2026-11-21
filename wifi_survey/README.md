# wifi_survey

Wi-Fi survey and AP placement for home-planner. See [`docs/wifi-survey-plan.md`](../docs/wifi-survey-plan.md).

It uses a **hybrid** setup: this package runs on the survey laptop to check the machine and take measurements. You
mark where you're standing on the home planner's Floor Plans page, which stores the points. The floor plan comes from
the home planner (`GET /api/floorplans/export/wifi`), so there is no separate `floorplan.json` to maintain.

## Laptop setup

**Recommended: the AppImage.** The home planner serves a self-contained build (Python included) at
**Tools → Wi-Fi Survey**, or directly at `/downloads/wifi-survey-x86_64.AppImage` with a manifest at
`/downloads/wifi-survey.json`. It's rebuilt whenever the frontend image is rebuilt
(`packaging/appimage/build.sh`; Python 3.12.15 manylinux2014, appimagetool 1.9.1 and the type2 runtime are pinned
and checked against their SHA-256 hashes).

```bash
sudo pacman -S iperf3
mv ~/Downloads/wifi-survey-x86_64.AppImage ~/.local/bin/wifi-survey && chmod +x ~/.local/bin/wifi-survey
wifi-survey setup http://192.168.50.51:3000   # writes ~/.config/wifi-survey/survey.yaml
wifi-survey doctor
```

**From source** (for development on the laptop):

```bash
sudo pacman -S uv iperf3          # iw and networkmanager are already installed on Garuda
git clone https://github.com/kennygarreau/home-planner.git && cd home-planner/wifi_survey
uv sync                           # core install: enough for doctor + measurement
uv run wifi-survey doctor
```

Defaults come from `config/survey.yaml`. To override them without editing the repo, copy that file to
`~/.config/wifi-survey/survey.yaml`.

The model-fitting and reporting tools (Phases 3–7) are an optional extra: `uv sync --extra analysis`.

## Commands so far

| Command | What it does |
|---|---|
| `wifi-survey doctor` | Checks tools, interface, link, scanning without root, 6 GHz support and regulatory domain, gateway ping, and whether the iperf3 server and home planner can be reached. `--json` for machine-readable output, `--redact` to hide SSIDs and BSSIDs. |
| `wifi-survey setup <url>` | Points the laptop at the home planner. Writes `~/.config/wifi-survey/survey.yaml`, using the same host for iperf3. |
| `wifi-survey agent` | Waits for measurement requests from **Floor Plans → Survey** and runs them: settle, three fresh scans (middle value per BSSID), iperf3 down/up, then ping. Results go to the home planner. `--once` exits after one. |
| `wifi-survey capture-fixtures <name>` | Saves **redacted** real `iw`/`nmcli` output to `tests/fixtures/<name>/` for the parser tests. |

## How a measurement flows

The agent only makes **outbound** requests to the home planner, so nothing needs to reach the laptop:

```
Survey page ──POST /api/surveys/:id/points──▶ home planner ◀──long-poll /api/survey-agent/poll── agent
            ◀────────── polls state ────────  home planner ◀── progress / result ─────────────── agent
```

One measurement runs at a time. A request nobody picks up within 2 minutes expires, because by then you've probably
moved. Cancelling on the page stops the agent at its next step. If a re-measure fails or is cancelled, the point keeps
its previous reading.

Scans only count networks seen **after** the agent's rescan request. Older cached results could have been taken
somewhere else in the house. If NetworkManager refuses the rescan ("not authorized", typical over SSH), the agent
falls back to background results no more than 15 s old and records a warning. If there aren't any, the measurement
fails. `doctor` prints a polkit rule that lets members of `wheel` request scans from any session.

## Privacy

SSIDs, BSSIDs and the house layout stay on the local network (spec §1). `data/` and `out/` are gitignored.
`capture-fixtures` replaces MAC addresses, SSIDs and WPS device details (which include the router's serial number)
before writing anything. Look over the files before committing them anyway.

## Development

All radio access goes through `collect.runner.Runner`. Tests use `FakeRunner` plus fixture files and never touch
a real radio.

```bash
uv sync --group dev
uv run pytest
uv run ruff check
uv run pyright
```

On the home-planner server, run these inside a container rather than on the host:

```bash
docker run --rm --user $(id -u):$(id -g) -e HOME=/tmp -e UV_CACHE_DIR=/tmp/uvcache \
  -e UV_PROJECT_ENVIRONMENT=/tmp/venv -v $PWD:/w -w /w ghcr.io/astral-sh/uv:python3.12-bookworm-slim \
  sh -c "uv sync -q --group dev && uv run pytest"
```

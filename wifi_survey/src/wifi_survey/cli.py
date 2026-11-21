"""`wifi-survey` command-line entry point."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated
from urllib.parse import urlparse

import typer
import yaml
from rich.console import Console
from rich.table import Table

from wifi_survey import __version__
from wifi_survey.collect.doctor import run_doctor
from wifi_survey.collect.redact import Redactor
from wifi_survey.collect.runner import SubprocessRunner
from wifi_survey.collect.wifi import NMCLI_FIELDS, detect_interface
from wifi_survey.config import IN_REPO, PACKAGE_ROOT, load_config, user_config_path

app = typer.Typer(help="Wi-Fi survey & AP placement for home-planner.", no_args_is_help=True)
console = Console()

ConfigOpt = Annotated[Path | None, typer.Option("--config", "-c", help="Path to survey.yaml")]

STATUS_STYLE = {
    "pass": "[green]✔ pass[/]",
    "warn": "[yellow]! warn[/]",
    "fail": "[red]✘ fail[/]",
    "skip": "[dim]- skip[/]",
}


@app.command()
def version() -> None:
    """Print the version."""
    console.print(__version__)


@app.command()
def setup(
    url: Annotated[str, typer.Argument(help="Home planner address, e.g. http://192.168.50.51:3000")],
    iperf: Annotated[str | None, typer.Option(help="iperf3 host (default: home planner host)")] = None,
    iperf_port: Annotated[int, typer.Option(help="iperf3 server port")] = 5201,
    force: Annotated[bool, typer.Option("--force", "-f", help="Overwrite an existing config")] = False,
) -> None:
    """Point this laptop at your home planner (writes ~/.config/wifi-survey/survey.yaml)."""
    url = url.rstrip("/")
    host = urlparse(url).hostname
    if not host:
        console.print(f"[red]Not a URL:[/] {url}")
        raise typer.Exit(2)
    try:
        with urllib.request.urlopen(f"{url}/api/health", timeout=5) as r:  # LAN address supplied by the user
            ok = json.load(r).get("status") == "ok"
    except (urllib.error.URLError, OSError, ValueError) as e:
        console.print(f"[yellow]Warning:[/] couldn't reach {url}/api/health ({getattr(e, 'reason', e)})")
        ok = False
    if ok:
        console.print(f"[green]✔[/] Home planner reachable at {url}")

    dest = user_config_path()
    if dest.exists() and not force:
        console.print(f"[yellow]{dest} already exists.[/] Re-run with --force to overwrite.")
        raise typer.Exit(1)
    cfg = {
        "schema_version": 1,
        "interface": "auto",
        "home_planner_url": url,
        "iperf": {"server": iperf or host, "port": iperf_port, "duration_s": 10},
        "ping": {"target": "gateway", "count": 20},
        "samples_per_point": 3,
        "settle_s": 3,
        "height_m": 1.0,
    }
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text("# Written by `wifi-survey setup`\n" + yaml.safe_dump(cfg, sort_keys=False))
    console.print(f"[green]Wrote {dest}[/]. Next: [bold]wifi-survey doctor[/]")


@app.command()
def doctor(
    config: ConfigOpt = None,
    as_json: Annotated[bool, typer.Option("--json", help="Machine-readable output")] = False,
    redact: Annotated[bool, typer.Option("--redact", help="Hide SSIDs/BSSIDs (for sharing output)")] = False,
) -> None:
    """Check that this machine can run a survey."""
    cfg = load_config(config)
    report = run_doctor(cfg, SubprocessRunner(), redact=redact)
    if as_json:
        print(report.to_json())
        raise typer.Exit(0 if report.ok else 1)

    table = Table(title=f"wifi-survey doctor · interface: {report.interface or '?'}", show_lines=False)
    table.add_column("Check")
    table.add_column("Status")
    table.add_column("Detail")
    for c in report.checks:
        detail = c.detail + (f"\n[dim]→ {c.fix}[/]" if c.fix and c.status != "pass" else "")
        table.add_row(c.name, STATUS_STYLE[c.status], detail)
    console.print(table)
    console.print(
        f"[dim]config: {cfg.source or 'built-in defaults'} · scan source: {report.scan_source or 'none'}[/]"
    )
    console.print(
        "[green]Ready to survey.[/]" if report.ok else "[red]Fix the failures above before surveying.[/]"
    )
    raise typer.Exit(0 if report.ok else 1)


@app.command()
def agent(
    config: ConfigOpt = None,
    once: Annotated[bool, typer.Option("--once", help="Exit after one measurement")] = False,
) -> None:
    """Wait for measurement requests from the Floor Plans page and run them."""
    from wifi_survey.agent import Agent, HttpApi, agent_id

    cfg = load_config(config)
    if not cfg.home_planner_url:
        console.print("[red]No home planner configured.[/] Run [bold]wifi-survey setup <url>[/] first.")
        raise typer.Exit(2)
    runner = SubprocessRunner()
    iface = cfg.interface if cfg.interface != "auto" else detect_interface(runner.run(["iw", "dev"]).stdout)
    if not iface:
        console.print("[red]No Wi-Fi interface found.[/]")
        raise typer.Exit(1)
    a = Agent(cfg, runner, HttpApi(cfg.home_planner_url), iface, agent_id(), log=console.print)
    console.print(
        f"[bold]wifi-survey agent[/] {__version__} on [cyan]{a.info['hostname']}[/] ({iface})\n"
        f"Connected to {cfg.home_planner_url}.\n"
        "Open [bold]Floor Plans → Survey[/] and click a point to measure.\n"
        f"[dim]Hold the laptop at about {cfg.height_m:g} m. Ctrl+C to stop.[/]"
    )
    try:
        a.run(once=once)
    except KeyboardInterrupt:
        console.print("\nStopped.")


@app.command("capture-fixtures")
def capture_fixtures(
    name: Annotated[str, typer.Argument(help="Fixture set name, e.g. 'laptop-be200'")],
    config: ConfigOpt = None,
    out: Annotated[Path | None, typer.Option(help="Output dir (default tests/fixtures/<name>)")] = None,
) -> None:
    """Save REDACTED real command output as parser test fixtures.

    SSIDs, BSSIDs/MACs and WPS device details (router serials) are replaced with
    stable placeholders before anything is written.
    """
    cfg = load_config(config)
    runner = SubprocessRunner()
    iface = cfg.interface if cfg.interface != "auto" else detect_interface(runner.run(["iw", "dev"]).stdout)
    if not iface:
        console.print("[red]No Wi-Fi interface found.[/]")
        raise typer.Exit(1)

    dest = out or (PACKAGE_ROOT / "tests" / "fixtures" / name if IN_REPO else Path.cwd() / f"fixtures-{name}")
    dest.mkdir(parents=True, exist_ok=True)
    r = Redactor()
    commands: dict[str, list[str]] = {
        "iw_dev.txt": ["iw", "dev"],
        "iw_link.txt": ["iw", "dev", iface, "link"],
        "iw_scan_dump.txt": ["iw", "dev", iface, "scan", "dump"],
        "iw_list.txt": ["iw", "list"],
        "iw_reg.txt": ["iw", "reg", "get"],
        "nmcli_wifi_list.txt": [
            "nmcli",
            "-t",
            "-f",
            NMCLI_FIELDS,
            "dev",
            "wifi",
            "list",
            "ifname",
            iface,
            "--rescan",
            "no",
        ],
    }
    for fname, args in commands.items():
        res = runner.run(args)
        text = res.stdout if res.ok else f"# exit {res.returncode}: {res.stderr.strip()}\n"
        text = r.nmcli_terse(text) if fname.startswith("nmcli") and res.ok else r.text(text)
        (dest / fname).write_text(text)
        status = "ok" if res.ok else f"[yellow]exit {res.returncode}[/]"
        console.print(f"  {fname:22} {len(text.splitlines()):5} lines  {status}")
    (dest / "README.md").write_text(
        f"Captured {datetime.now(UTC):%Y-%m-%d} with `wifi-survey capture-fixtures {name}` "
        f"on interface `{iface}`.\nRedacted: {len(r.macs)} MACs, {len(r.ssids)} SSIDs, WPS device details.\n"
    )
    console.print(
        f"[green]Wrote {dest}[/] — redacted {len(r.macs)} MACs and {len(r.ssids)} SSIDs. "
        "Skim the files before committing."
    )


if __name__ == "__main__":
    app()

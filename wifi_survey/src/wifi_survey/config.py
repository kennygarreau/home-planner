"""Survey configuration (config/survey.yaml)."""

from __future__ import annotations

import os
from pathlib import Path

import yaml
from pydantic import BaseModel, Field

PACKAGE_ROOT = Path(__file__).resolve().parents[2]  # wifi_survey/ in a repo checkout
_REPO_CONFIG = PACKAGE_ROOT / "config"
_BUNDLED_CONFIG = Path(__file__).resolve().parent / "_config"  # installed wheel / AppImage
CONFIG_DIR = _REPO_CONFIG if (_REPO_CONFIG / "survey.yaml").exists() else _BUNDLED_CONFIG
IN_REPO = (PACKAGE_ROOT / "pyproject.toml").exists()


def user_config_path() -> Path:
    xdg = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
    return xdg / "wifi-survey" / "survey.yaml"


class IperfConfig(BaseModel):
    server: str | None = None
    port: int = 5201
    duration_s: int = 10


class PingConfig(BaseModel):
    target: str = "gateway"
    count: int = 20


class SurveyConfig(BaseModel):
    schema_version: int = 1
    interface: str = "auto"
    home_planner_url: str | None = None
    iperf: IperfConfig = Field(default_factory=IperfConfig)
    ping: PingConfig = Field(default_factory=PingConfig)
    samples_per_point: int = 3
    settle_s: float = 3
    height_m: float = 1.0
    source: str | None = None  # where this config was loaded from


def config_search_path(explicit: Path | None = None) -> list[Path]:
    paths: list[Path] = []
    if explicit:
        paths.append(explicit)
    if env := os.environ.get("WIFI_SURVEY_CONFIG"):
        paths.append(Path(env))
    paths.append(user_config_path())
    paths.append(CONFIG_DIR / "survey.yaml")
    return paths


def load_config(explicit: Path | None = None) -> SurveyConfig:
    """First existing file wins; an explicitly requested file must exist."""
    if explicit and not explicit.exists():
        raise FileNotFoundError(explicit)
    for p in config_search_path(explicit):
        if p.exists():
            data = yaml.safe_load(p.read_text()) or {}
            return SurveyConfig(**data, source=str(p))
    return SurveyConfig(source=None)

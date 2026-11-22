"""Per-room targets from config/targets.yaml."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from wifi_survey.config import CONFIG_DIR
from wifi_survey.floorplan.schema import Room


@dataclass(frozen=True)
class Target:
    signal_dbm: float
    down_mbps: float
    latency_p95_ms: float


@dataclass
class Targets:
    default: Target
    uses: dict[str, Target]
    priority_weight: dict[str, float]

    @classmethod
    def load(cls, path: Path | None = None) -> Targets:
        raw: dict[str, Any] = yaml.safe_load((path or CONFIG_DIR / "targets.yaml").read_text())

        def t(d: dict[str, Any]) -> Target:
            return Target(float(d["signal_dbm"]), float(d["down_mbps"]), float(d["latency_p95_ms"]))

        uses: dict[str, Any] = raw.get("uses") or {}
        weights: dict[str, Any] = raw.get("priority_weight") or {}
        return cls(
            t(raw["default"]), {k: t(v) for k, v in uses.items()}, {k: float(v) for k, v in weights.items()}
        )

    def for_room(self, room: Room) -> Target:
        ts = [self.uses[u] for u in room.use if u in self.uses] or [self.default]
        return Target(
            signal_dbm=max(t.signal_dbm for t in ts),
            down_mbps=max(t.down_mbps for t in ts),
            latency_p95_ms=min(t.latency_p95_ms for t in ts),
        )

    def weight(self, room: Room) -> float:
        return self.priority_weight.get(room.priority, 1.0)

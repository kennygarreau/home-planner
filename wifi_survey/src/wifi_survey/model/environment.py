"""Geometry of the house for the propagation model: what a radio path crosses.

For a transmitter and many receiver points this computes, per path:
  - the 3-D distance,
  - how many walls of each material it crosses (a crossing inside a door or
    window span counts as that opening's material instead; passages count as
    nothing),
  - how many floor slabs of each material it passes through.

Paths between floors are approximated in plan view: the first half of the
path is tested against the transmitter floor's walls and the second half
against the receiver floor's walls, with the slabs in between.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import numpy.typing as npt
import yaml

from wifi_survey.config import CONFIG_DIR
from wifi_survey.floorplan.schema import Floor, FloorPlan

FArr = npt.NDArray[np.float64]

FREQ_MHZ = {"2.4": 2437.0, "5": 5500.0, "6": 6500.0}
RX_HEIGHT_M = 1.0
MIN_DIST_M = 0.5
MOUNT_HEIGHT_M = {"desk": 0.8, "floor": 0.15, "wall": 2.0}  # ceiling = ceiling height - 0.15


def fspl_1m(band: str) -> float:
    """Free-space path loss at 1 m (dB)."""
    return 20 * math.log10(FREQ_MHZ[band]) - 27.55


@dataclass
class Materials:
    walls: dict[str, dict[str, float]]
    openings: dict[str, dict[str, float]]
    floors: dict[str, dict[str, float]]

    @classmethod
    def load(cls, path: Path | None = None) -> Materials:
        raw: dict[str, Any] = yaml.safe_load((path or CONFIG_DIR / "materials.yaml").read_text())

        def conv(d: dict[str, dict[str, Any]] | None) -> dict[str, dict[str, float]]:
            return {k: {str(b): float(v) for b, v in bands.items()} for k, bands in (d or {}).items()}

        return cls(conv(raw.get("walls")), conv(raw.get("openings")), conv(raw.get("floors")))

    def loss(self, kind: str, name: str, band: str) -> float:
        table = {"wall": self.walls, "opening": self.openings, "floor": self.floors}[kind]
        if name not in table:
            # Unknown materials fall back to something sensible rather than free space.
            name = {"wall": "drywall", "opening": "wood_door", "floor": "wood_joist"}[kind]
        return table[name].get(band, table[name].get("5", 0.0))


@dataclass
class _FloorGeom:
    floor: Floor
    a: FArr  # (W, 2)
    b: FArr  # (W, 2)
    wall_mat: list[str]
    # per wall: list of (u0, u1, material | None) opening spans along the wall (0..1)
    spans: list[list[tuple[float, float, str | None]]] = field(
        default_factory=list[list[tuple[float, float, str | None]]]
    )


@dataclass
class PathFeatures:
    log_d: FArr  # (N,) log10 of 3-D distance in metres
    walls: dict[str, FArr]  # material → (N,) crossing counts (walls and openings, prefixed)
    slabs: dict[str, FArr]  # slab material → (N,) counts


class Environment:
    def __init__(self, plan: FloorPlan) -> None:
        self.floors = sorted(plan.floors, key=lambda f: (f.elevation_m, f.level))
        self.index = {f.id: i for i, f in enumerate(self.floors)}
        self.geom: list[_FloorGeom] = []
        for f in self.floors:
            a = np.array([w.a for w in f.walls], dtype=np.float64).reshape(-1, 2)
            b = np.array([w.b for w in f.walls], dtype=np.float64).reshape(-1, 2)
            g = _FloorGeom(f, a, b, [w.material for w in f.walls])
            by_wall: dict[str, list[tuple[float, float, str | None]]] = {}
            lengths = {w.id: math.dist(w.a, w.b) for w in f.walls}
            for o in f.openings:
                length = lengths.get(o.wall_id)
                if not length:
                    continue
                mat = (
                    None
                    if o.type == "passage"
                    else (o.material or ("glass" if o.type == "window" else "wood_door"))
                )
                by_wall.setdefault(o.wall_id, []).append(
                    (o.offset_m / length, (o.offset_m + o.width_m) / length, mat)
                )
            g.spans = [by_wall.get(w.id, []) for w in f.walls]
            self.geom.append(g)

    # ── Heights ──────────────────────────────────────────────────────────────

    def mount_z(self, floor_id: str, mount: str) -> float:
        f = self.floors[self.index[floor_id]]
        if mount == "ceiling":
            return f.elevation_m + max(f.ceiling_height_m - 0.15, 0.5)
        return f.elevation_m + MOUNT_HEIGHT_M.get(mount, 0.8)

    def rx_z(self, floor_id: str, height_m: float = RX_HEIGHT_M) -> float:
        return self.floors[self.index[floor_id]].elevation_m + height_m

    # ── Crossings ────────────────────────────────────────────────────────────

    def _crossings(self, g: _FloorGeom, p: FArr, q: FArr) -> dict[str, FArr]:
        """Count wall/opening crossings for segments p[i]→q[i] on one floor."""
        n = p.shape[0]
        out: dict[str, FArr] = {}
        if g.a.shape[0] == 0 or n == 0:
            return out
        r = q - p  # (N, 2)
        s = g.b - g.a  # (W, 2)
        den = r[:, None, 0] * s[None, :, 1] - r[:, None, 1] * s[None, :, 0]  # (N, W)
        d = g.a[None, :, :] - p[:, None, :]  # (N, W, 2)
        with np.errstate(divide="ignore", invalid="ignore"):
            t = (d[..., 0] * s[None, :, 1] - d[..., 1] * s[None, :, 0]) / den  # along path
            u = (d[..., 0] * r[:, None, 1] - d[..., 1] * r[:, None, 0]) / den  # along wall
        hit = (np.abs(den) > 1e-12) & (t > 1e-9) & (t < 1 - 1e-9) & (u >= 0) & (u <= 1)
        in_opening = np.zeros_like(hit)
        for w, spans in enumerate(g.spans):
            for u0, u1, mat in spans:
                m = hit[:, w] & (u[:, w] >= u0) & (u[:, w] <= u1)
                if not m.any():
                    continue
                in_opening[:, w] |= m
                if mat:
                    key = f"opening:{mat}"
                    out[key] = out.get(key, np.zeros(n)) + m
        solid = hit & ~in_opening
        for w, mat in enumerate(g.wall_mat):
            col = solid[:, w]
            if col.any():
                key = f"wall:{mat}"
                out[key] = out.get(key, np.zeros(n)) + col
        return out

    def features(
        self, tx_floor: str, tx_xy: tuple[float, float], tx_z: float, rx_floor: str, rx_xy: FArr, rx_z: float
    ) -> PathFeatures:
        rx_xy = np.asarray(rx_xy, dtype=np.float64).reshape(-1, 2)
        n = rx_xy.shape[0]
        tx = np.broadcast_to(np.asarray(tx_xy, dtype=np.float64), (n, 2))
        horiz = np.linalg.norm(rx_xy - tx, axis=1)
        dist = np.maximum(np.sqrt(horiz**2 + (rx_z - tx_z) ** 2), MIN_DIST_M)

        i, j = self.index[tx_floor], self.index[rx_floor]
        walls: dict[str, FArr] = {}

        def add(src: dict[str, FArr]) -> None:
            for k, v in src.items():
                walls[k] = walls.get(k, np.zeros(n)) + v

        if i == j:
            add(self._crossings(self.geom[i], tx.copy(), rx_xy))
        else:
            mid = (tx + rx_xy) / 2
            add(self._crossings(self.geom[i], tx.copy(), mid))
            add(self._crossings(self.geom[j], mid, rx_xy))

        slabs: dict[str, FArr] = {}
        for k in range(min(i, j), max(i, j)):
            mat = self.floors[k].slab_material or "wood_joist"
            slabs[mat] = slabs.get(mat, np.zeros(n)) + 1.0
        return PathFeatures(np.log10(dist), walls, slabs)

    # ── Rooms / grid ─────────────────────────────────────────────────────────

    def room_mask(self, floor_id: str, xy: FArr) -> npt.NDArray[np.bool_]:
        """Points inside any room on the floor."""
        xy = np.asarray(xy, dtype=np.float64).reshape(-1, 2)
        inside = np.zeros(xy.shape[0], dtype=bool)
        for room in self.floors[self.index[floor_id]].rooms:
            inside |= points_in_polygon(xy, room.polygon)
        return inside


def points_in_polygon(xy: FArr, polygon: list[tuple[float, float]]) -> npt.NDArray[np.bool_]:
    """Ray-casting point-in-polygon for many points."""
    xy = np.asarray(xy, dtype=np.float64).reshape(-1, 2)
    poly = np.asarray(polygon, dtype=np.float64)
    inside = np.zeros(xy.shape[0], dtype=bool)
    x, y = xy[:, 0], xy[:, 1]
    for k in range(len(poly)):
        x1, y1 = poly[k]
        x2, y2 = poly[k - 1]
        cond = (y1 > y) != (y2 > y)
        with np.errstate(divide="ignore", invalid="ignore"):
            xin = (x2 - x1) * (y - y1) / (y2 - y1) + x1
        inside ^= cond & (x < xin)
    return inside

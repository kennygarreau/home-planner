"""Multi-wall (COST-231 style) propagation model and its calibration.

    RSSI = EIRP_radio - FSPL(1 m) - 10·n·log10(d) - Σ_m count_m·L_m·k_m - Σ_s slabs_s·L_s·k_s

L_m / L_s are the starting losses from materials.yaml; the fit scales them by
k (≈1 means the table was right). With the path geometry fixed the model is
linear in every unknown (n, k_m, k_s, EIRP per radio), so calibration is a
bounded linear least-squares problem (scipy lsq_linear) with weak priors that
keep parameters sensible when the data can't pin them down:
    n ~ 3.0 ± 0.8, k ~ 1.0 ± 0.5, EIRP ~ 20 ± 8 dBm, measurement noise sigma = 4 dB.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import numpy as np
from scipy import optimize  # pyright: ignore[reportMissingTypeStubs]

from wifi_survey.model.environment import Environment, FArr, Materials, PathFeatures, fspl_1m

# scipy ships no type stubs; pin the one function we use to a known signature.
_lsq_linear: Callable[..., Any] = optimize.lsq_linear  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType]

SIGMA_OBS = 4.0
PRIOR_N = (3.0, 0.8)
PRIOR_K = (1.0, 0.5)
PRIOR_EIRP = (20.0, 8.0)
BOUNDS_N = (1.5, 5.0)
BOUNDS_K = (0.2, 3.5)
BOUNDS_EIRP = (-10.0, 40.0)


@dataclass
class Transmitter:
    bssid: str
    ap_id: str
    floor_id: str
    xy: tuple[float, float]
    z: float


@dataclass
class Observation:
    tx: Transmitter
    floor_id: str
    xy: tuple[float, float]
    z: float
    measured: float
    point_id: str


@dataclass
class BandModel:
    band: str
    n: float
    k: dict[str, float]  # "wall:<mat>" / "opening:<mat>" / "slab:<mat>" → scale
    eirp: dict[str, float]  # bssid → dBm
    n_obs: int = 0
    rmse_db: float = 0.0
    mae_db: float = 0.0
    bias_db: float = 0.0
    residuals: list[dict[str, Any]] = field(default_factory=list[dict[str, Any]])

    def loss_db(self, materials: Materials, key: str) -> float:
        kind, name = key.split(":", 1)
        base = materials.loss("floor" if kind == "slab" else kind, name, self.band)
        return base * self.k.get(key, 1.0)

    def predict(
        self, env: Environment, materials: Materials, tx: Transmitter, floor_id: str, xy: FArr, z: float
    ) -> FArr:
        f = env.features(tx.floor_id, tx.xy, tx.z, floor_id, xy, z)
        out = self.eirp[tx.bssid] - fspl_1m(self.band) - 10 * self.n * f.log_d
        for key, counts in _losses(f).items():
            out = out - counts * self.loss_db(materials, key)
        return out


def _losses(f: PathFeatures) -> dict[str, FArr]:
    out = dict(f.walls)
    for mat, v in f.slabs.items():
        out[f"slab:{mat}"] = v
    return out


def fit_band(env: Environment, materials: Materials, band: str, obs: list[Observation]) -> BandModel:
    feats = [env.features(o.tx.floor_id, o.tx.xy, o.tx.z, o.floor_id, np.array([o.xy]), o.z) for o in obs]
    loss_keys = sorted({k for f in feats for k, v in _losses(f).items() if v.any()})
    radios = sorted({o.tx.bssid for o in obs})
    n_params = 1 + len(loss_keys) + len(radios)
    col_k = {k: 1 + i for i, k in enumerate(loss_keys)}
    col_e = {b: 1 + len(loss_keys) + i for i, b in enumerate(radios)}

    rows: list[FArr] = []
    target: list[float] = []
    for o, f in zip(obs, feats, strict=True):
        row = np.zeros(n_params)
        row[0] = -10 * f.log_d[0]
        for key, counts in _losses(f).items():
            if key in col_k:
                kind, name = key.split(":", 1)
                row[col_k[key]] = -counts[0] * materials.loss("floor" if kind == "slab" else kind, name, band)
        row[col_e[o.tx.bssid]] = 1.0
        rows.append(row / SIGMA_OBS)
        target.append((o.measured + fspl_1m(band)) / SIGMA_OBS)

    def prior(col: int, mean_sd: tuple[float, float]) -> None:
        row = np.zeros(n_params)
        row[col] = 1 / mean_sd[1]
        rows.append(row)
        target.append(mean_sd[0] / mean_sd[1])

    prior(0, PRIOR_N)
    for c in col_k.values():
        prior(c, PRIOR_K)
    for c in col_e.values():
        prior(c, PRIOR_EIRP)

    lb = np.array([BOUNDS_N[0]] + [BOUNDS_K[0]] * len(loss_keys) + [BOUNDS_EIRP[0]] * len(radios))
    ub = np.array([BOUNDS_N[1]] + [BOUNDS_K[1]] * len(loss_keys) + [BOUNDS_EIRP[1]] * len(radios))
    res: Any = _lsq_linear(np.vstack(rows), np.array(target), bounds=(lb, ub))
    x: FArr = np.asarray(res.x, dtype=np.float64)

    model = BandModel(
        band=band,
        n=float(x[0]),
        k={key: float(x[c]) for key, c in col_k.items()},
        eirp={b: float(x[c]) for b, c in col_e.items()},
        n_obs=len(obs),
    )
    errs: list[float] = []
    for o in obs:
        pred = float(model.predict(env, materials, o.tx, o.floor_id, np.array([o.xy]), o.z)[0])
        errs.append(pred - o.measured)
        model.residuals.append(
            {
                "point_id": o.point_id,
                "bssid": o.tx.bssid,
                "ap_id": o.tx.ap_id,
                "measured": round(o.measured, 1),
                "predicted": round(pred, 1),
            }
        )
    e = np.array(errs)
    if e.size:
        model.rmse_db = float(np.sqrt(np.mean(e**2)))
        model.mae_db = float(np.mean(np.abs(e)))
        model.bias_db = float(np.mean(e))
    return model

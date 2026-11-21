"""Command execution behind a small interface so tests never touch the radio."""

from __future__ import annotations

import os
import shutil
import subprocess
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Protocol


@dataclass(frozen=True)
class CmdResult:
    args: tuple[str, ...]
    returncode: int
    stdout: str = ""
    stderr: str = ""

    @property
    def ok(self) -> bool:
        return self.returncode == 0


class Runner(Protocol):
    def run(self, args: Sequence[str], timeout: float = 30) -> CmdResult: ...
    def which(self, name: str) -> str | None: ...


class SubprocessRunner:
    """Runs real commands with a C locale so output is parseable."""

    def run(self, args: Sequence[str], timeout: float = 30) -> CmdResult:
        env = {**os.environ, "LC_ALL": "C", "LANG": "C"}
        try:
            p = subprocess.run(
                list(args), capture_output=True, text=True, timeout=timeout, env=env, check=False
            )
        except FileNotFoundError:
            return CmdResult(tuple(args), 127, "", f"{args[0]}: command not found")
        except subprocess.TimeoutExpired as e:
            out = e.stdout.decode() if isinstance(e.stdout, bytes) else (e.stdout or "")
            return CmdResult(tuple(args), 124, out, f"timed out after {timeout}s")
        return CmdResult(tuple(args), p.returncode, p.stdout, p.stderr)

    def which(self, name: str) -> str | None:
        return shutil.which(name)


Response = CmdResult | str | Callable[[tuple[str, ...]], CmdResult]


@dataclass
class FakeRunner:
    """Maps command prefixes to canned output. Longest matching prefix wins.

    >>> r = FakeRunner({("iw", "dev"): "Interface wlan0\\n"})
    >>> r.run(["iw", "dev"]).stdout
    'Interface wlan0\\n'
    """

    responses: dict[tuple[str, ...], Response] = field(default_factory=dict)
    installed: set[str] | None = None  # None = everything installed
    calls: list[tuple[str, ...]] = field(default_factory=list)

    def run(self, args: Sequence[str], timeout: float = 30) -> CmdResult:
        key = tuple(args)
        self.calls.append(key)
        for n in range(len(key), 0, -1):
            resp = self.responses.get(key[:n])
            if resp is None:
                continue
            if isinstance(resp, str):
                return CmdResult(key, 0, resp, "")
            if isinstance(resp, CmdResult):
                return CmdResult(key, resp.returncode, resp.stdout, resp.stderr)
            return resp(key)
        if self.installed is not None and key[0] not in self.installed:
            return CmdResult(key, 127, "", f"{key[0]}: command not found")
        return CmdResult(key, 1, "", f"FakeRunner: no response for {' '.join(key)}")

    def which(self, name: str) -> str | None:
        if self.installed is None or name in self.installed:
            return f"/usr/bin/{name}"
        return None

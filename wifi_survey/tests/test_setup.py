import io
import json

import yaml
from typer.testing import CliRunner

from wifi_survey import cli
from wifi_survey.config import load_config


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def test_setup_writes_user_config(tmp_path, monkeypatch):
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
    seen = []
    monkeypatch.setattr(
        cli.urllib.request,
        "urlopen",
        lambda url, timeout: seen.append(url) or FakeResponse(json.dumps({"status": "ok"}).encode()),
    )
    result = CliRunner().invoke(cli.app, ["setup", "http://10.1.2.3:3000/"])
    assert result.exit_code == 0, result.output
    assert seen == ["http://10.1.2.3:3000/api/health"]
    written = tmp_path / "wifi-survey" / "survey.yaml"
    data = yaml.safe_load(written.read_text())
    assert data["home_planner_url"] == "http://10.1.2.3:3000"
    assert data["iperf"]["server"] == "10.1.2.3"
    # load_config prefers the user config over the bundled defaults
    assert load_config().home_planner_url == "http://10.1.2.3:3000"

    again = CliRunner().invoke(cli.app, ["setup", "http://10.1.2.3:3000"])
    assert again.exit_code == 1 and "--force" in again.output


def test_setup_rejects_non_url(tmp_path, monkeypatch):
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
    result = CliRunner().invoke(cli.app, ["setup", "not a url"])
    assert result.exit_code == 2

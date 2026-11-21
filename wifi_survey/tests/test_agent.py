from wifi_survey.agent import Agent, ApiError, agent_id
from wifi_survey.collect.runner import FakeRunner
from wifi_survey.config import SurveyConfig

IF = "wlan0"
JOB = {
    "pointId": "p1",
    "label": "den-01",
    "floorId": "f1",
    "roomId": None,
    "pos_m": [1, 2],
    "surveyType": "baseline",
}


class FakeApi:
    def __init__(self, polls, progress_status=200, fail_first_result=False):
        self.polls = list(polls)
        self.calls = []
        self.progress_status = progress_status
        self.fail_first_result = fail_first_result

    def post(self, path, body, timeout=15):
        self.calls.append((path, body))
        if path.endswith("/poll"):
            nxt = self.polls.pop(0)
            if isinstance(nxt, Exception):
                raise nxt
            return (200, {"job": nxt}) if nxt else (204, None)
        if path.endswith("/progress"):
            return self.progress_status, None
        if path.endswith("/result"):
            if self.fail_first_result:
                self.fail_first_result = False
                raise ApiError("connection reset")
            return 200, {"ok": True}
        raise AssertionError(path)


def make_agent(fixture_text, api):
    runner = FakeRunner(
        {
            ("iw", "list"): fixture_text("server-cnvi-ax", "iw_list.txt"),
            ("iw", "--version"): "iw version 6.9\n",
            ("iw", "dev", IF, "link"): "Not connected.\n",
            ("iw", "dev", IF, "scan", "dump"): fixture_text("server-cnvi-ax", "iw_scan_dump.txt"),
            ("nmcli",): "",
            ("ip",): "",
        }
    )
    logs = []
    a = Agent(
        SurveyConfig(home_planner_url="http://hp"),
        runner,
        api,
        IF,
        "agent-1",
        log=logs.append,
        sleep=lambda s: None,
    )
    return a, logs


def test_poll_measure_result_cycle(fixture_text):
    api = FakeApi([ApiError("down"), None, JOB])
    a, logs = make_agent(fixture_text, api)
    a.run(once=True)
    paths = [p for p, _ in api.calls]
    assert paths[:3] == ["/api/survey-agent/poll"] * 3
    assert "/api/survey-agent/jobs/p1/progress" in paths
    result = next(b for p, b in api.calls if p.endswith("/result"))
    assert result["agentId"] == "agent-1" and result["error"] is None
    assert result["record"]["point_id"] == "den-01"
    assert result["agent"]["capabilities"]["bands"] == ["2.4", "5"]
    poll_body = api.calls[0][1]
    assert poll_body["agentId"] == "agent-1" and poll_body["hostname"] and poll_body["version"]
    assert any("unreachable" in m for m in logs)


def test_cancelled_job_posts_no_result(fixture_text):
    api = FakeApi([JOB], progress_status=409)
    a, logs = make_agent(fixture_text, api)
    a.run(once=True)
    assert not any(p.endswith("/result") for p, _ in api.calls)
    assert any("Cancelled" in m for m in logs)


def test_result_post_is_retried(fixture_text):
    api = FakeApi([JOB], fail_first_result=True)
    a, _ = make_agent(fixture_text, api)
    a.run(once=True)
    assert sum(p.endswith("/result") for p, _ in api.calls) == 2


def test_measurement_crash_is_reported(fixture_text):
    api = FakeApi([JOB])
    a, _ = make_agent(fixture_text, api)
    a.runner.responses[("iw", "dev", IF, "scan", "dump")] = lambda args: (_ for _ in ()).throw(
        RuntimeError("boom")
    )
    a.run(once=True)
    result = next(b for p, b in api.calls if p.endswith("/result"))
    assert result["record"] is None and "boom" in result["error"]


def test_agent_id_is_stable(tmp_path):
    p = tmp_path / "agent-id"
    first = agent_id(p)
    assert first == agent_id(p) and len(first) == 36

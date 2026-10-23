import dataclasses
import importlib

import httpx
import pytest


class Counter:
    name = "offline-test-model"
    units = "tokens"

    def __call__(self, messages, tools):
        return len(messages) + len(tools)

    def __bool__(self):
        return False  # An explicit port is selected by identity, not truthiness.


def test_http_planner_exposes_injected_counter_without_using_it(framework_module, run_async):
    module = importlib.import_module("agent_mc_autonomy.planner")
    counter = Counter()

    async def exercise():
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _: pytest.fail("No model call"))) as client:
            config = module.HttpPlannerConfig("http://model.test/v1", "test-model")
            planner = module.HttpPlanner(config, 512, 30, client=client, context_counter=counter)
            assert planner.context_counter is counter

    run_async(exercise())


@pytest.mark.parametrize(("explicit", "inherited"), [(False, False), (False, True), (True, False), (True, True)])
def test_runner_passes_explicit_or_planner_counter_without_changing_default_calls(
        framework_module, tmp_path, monkeypatch, run_async, explicit, inherited):
    module = importlib.import_module("agent_mc_autonomy.runner")
    selected, attached = Counter(), Counter()
    seen = []

    class Planner:
        closed = False

        async def decide(self, *_):
            pytest.fail("No inference needed for port wiring")

        async def aclose(self):
            self.closed = True

    class Controller:
        def __init__(self, *args, **kwargs):
            seen.append(kwargs)

        async def run(self, goal):
            assert goal == "survive"

    planner = Planner()
    if inherited:
        planner.context_counter = attached
    monkeypatch.setattr(module, "Controller", Controller)
    settings = dataclasses.replace(framework_module.Settings(), enabled=True, host="example.test",
                                   username="OfflineCounter", viewer_auto_open=False)
    options = {"context_counter": selected} if explicit else {}
    run_async(module.run_session(settings, tmp_path / "fake.mjs", tmp_path, planner, "survive",
                                 lambda **_: None, lambda: False, bridge_factory=lambda *_: object(), **options))
    expected = selected if explicit else attached if inherited else None
    import uuid
    uuid.UUID(seen[0].pop("runtime_session"))
    assert seen == ([{"context_counter": expected}] if expected is not None else [{}])
    assert planner.closed


def cli_inputs(tmp_path):
    config, entry = tmp_path / "settings.toml", tmp_path / "fake.mjs"
    config.write_text('[server]\nhost="example.test"\nusername="OfflineCounter"\n'
                      '[autonomy]\nenabled=true\n'
                      '[planner]\nbase_url="http://model.test/v1"\nmodel="test-model"\n', encoding="utf-8")
    entry.write_text("// offline fixture", encoding="utf-8")
    return ["--config", str(config), "--entry", str(entry), "--data", str(tmp_path / "data")]


def test_runner_forwards_both_host_ports_and_exposes_the_same_runtime_session(
        framework_module, tmp_path, monkeypatch, run_async):
    import json
    module = importlib.import_module("agent_mc_autonomy.runner")
    seen, states = [], []
    def base(revision):
        return None

    def recent(request):
        return {"available": False}

    class Controller:
        def __init__(self, *args, **kwargs):
            seen.append(kwargs)
        async def run(self, goal):
            assert goal == "survive"

    monkeypatch.setattr(module, "Controller", Controller)
    settings = dataclasses.replace(framework_module.Settings(), enabled=True, host="example.test",
                                   username="OfflinePorts", viewer_auto_open=False)
    run_async(module.run_session(settings, tmp_path / "fake.mjs", tmp_path, None, "survive",
        lambda **values: states.append(values), lambda: False, bridge_factory=lambda *_: object(),
        host_context_provider=base, recent_context_provider=recent))
    assert seen[0]["host_context_provider"] is base and seen[0]["recent_context_provider"] is recent
    assert all(s["runtime_session"] == seen[0]["runtime_session"] and s["settings_identity"] == settings.identity for s in states)
    saved = json.loads((tmp_path / "sessions" / settings.identity / "host" / "status.json").read_text())
    assert saved["runtime_session"] == seen[0]["runtime_session"]


def test_cli_factory_runs_before_planner_and_receives_parsed_config(framework_module, tmp_path, monkeypatch):
    module = importlib.import_module("agent_mc_autonomy.cli")
    counter, calls = Counter(), []

    def factory(config):
        assert isinstance(config, module.HttpPlannerConfig) and config.model == "test-model"
        calls.append("factory")
        return counter

    class Planner:
        def __init__(self, config, budget, timeout, *, context_counter):
            assert context_counter is counter
            self.context_counter = context_counter
            calls.append("planner")

    async def session(settings, entry, data, planner, goal, publish, stopped, *, viewer_entry=None):
        assert planner.context_counter is counter
        calls.append("session")

    monkeypatch.setattr(module, "HttpPlanner", Planner)
    monkeypatch.setattr(module, "run_session", session)
    assert module.main(["run", *cli_inputs(tmp_path)], context_counter_factory=factory) == 0
    assert calls == ["factory", "planner", "session"]


@pytest.mark.parametrize("command", ["check", "status", "model-config", "queue-only"])
def test_cli_never_constructs_counter_for_passive_or_queue_only_commands(framework_module, tmp_path, monkeypatch, command):
    module = importlib.import_module("agent_mc_autonomy.cli")
    calls = []

    def forbidden(*_, **__):
        pytest.fail("Passive/queue-only operation must not construct a counter or planner")

    async def legacy_play(settings, entry, data, config, goal, viewer_entry=None):
        assert config is None
        calls.append("queue-only")

    monkeypatch.setattr(module, "HttpPlanner", forbidden)
    monkeypatch.setattr(module, "play", legacy_play)
    args = ["run", "--queue-only"] if command == "queue-only" else [command]
    assert module.main([*args, *cli_inputs(tmp_path)], context_counter_factory=forbidden) == 0
    assert calls == (["queue-only"] if command == "queue-only" else [])


@pytest.mark.parametrize("error_type", [ValueError, RuntimeError])
def test_cli_factory_failure_prevents_planner_and_body_construction(framework_module, tmp_path, monkeypatch, capsys, error_type):
    module = importlib.import_module("agent_mc_autonomy.cli")

    def factory(config):
        raise error_type("private-provider-key")

    def forbidden(*_, **__):
        pytest.fail("Invalid counter must fail before planner/body startup")

    monkeypatch.setattr(module, "HttpPlanner", forbidden)
    monkeypatch.setattr(module, "run_session", forbidden)
    assert module.main(["run", *cli_inputs(tmp_path)], context_counter_factory=factory) == 1
    captured = capsys.readouterr()
    assert "private-provider-key" not in captured.out + captured.err
    assert "context_counter_factory_unavailable_" + error_type.__name__ in captured.out


def test_cli_default_play_call_remains_compatible(framework_module, tmp_path, monkeypatch):
    module = importlib.import_module("agent_mc_autonomy.cli")
    calls = []

    async def legacy_play(settings, entry, data, config, goal, viewer_entry=None):
        calls.append(config.model)

    monkeypatch.setattr(module, "play", legacy_play)
    assert module.main(["run", *cli_inputs(tmp_path)]) == 0
    assert calls == ["test-model"]


@pytest.mark.parametrize("empty_factory", [False, True])
def test_play_without_counter_keeps_legacy_planner_constructor(framework_module, tmp_path, monkeypatch, run_async, empty_factory):
    module = importlib.import_module("agent_mc_autonomy.cli")
    calls = []

    class Planner:
        def __init__(self, config, budget, timeout):
            calls.append("planner")

    async def session(*_, viewer_entry=None):
        calls.append("session")

    def factory(config):
        calls.append("factory")
        return None

    monkeypatch.setattr(module, "HttpPlanner", Planner)
    monkeypatch.setattr(module, "run_session", session)
    options = {"context_counter_factory": factory} if empty_factory else {}
    run_async(module.play(framework_module.Settings(), tmp_path / "fake.mjs", tmp_path,
                          module.HttpPlannerConfig("http://model.test/v1", "test-model"), "survive", **options))
    assert calls == (["factory", "planner", "session"] if empty_factory else ["planner", "session"])

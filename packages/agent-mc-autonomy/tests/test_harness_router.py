import asyncio
import json

import httpx
import pytest

from agent_mc_autonomy.harness_router import HarnessRouterConfig, HarnessRouterPlanner, decode_plan
from agent_mc_autonomy.model_config import planner_settings
from agent_mc_autonomy.planner import PlannerResponseError
from agent_mc_autonomy.routing import RoutedPlanner, standalone_config


TOOLS = [{"type": "function", "function": {"name": "mc_read", "parameters": {"type": "object"}}}]
PLAN = {"content": None, "tool_calls": [{"id": "call1", "type": "function", "function": {"name": "mc_read", "arguments": "{}"}}]}


def cfg(**changes):
    return HarnessRouterConfig.parse({"base_url": "http://harness.test/api/harness", "harness_id": "dsh", "model": "chosen", **changes})


def completed(plan=PLAN, **changes):
    return {"id": "resp_test", "status": "completed", "output": [{"type": "message", "role": "assistant",
            "content": [{"type": "output_text", "text": json.dumps(plan)}]}], **changes}


@pytest.mark.parametrize("change", [{"api_key": "literal"}, {"base_url": "https://user:secret@harness.test"},
    {"base_url": "file:///tmp/server"}, {"api_key_env": ""}, {"harness_id": "../other"}, {"model": ""},
    {"max_step": True}, {"max_step": 0}, {"poll_seconds": float("nan")}])
def test_invalid_harness_configuration_cannot_start_or_leak(change):
    with pytest.raises(ValueError):
        cfg(**change)


def test_route_is_explicit_no_default_harness_and_no_key_literal():
    assert planner_settings({}) is None
    assert isinstance(planner_settings({"route": "harnessrouter", "base_url": "http://local.test", "harness_id": "dsh", "model": "chosen"}), HarnessRouterConfig)
    with pytest.raises(ValueError):
        standalone_config({"route": "host"})


def test_real_uhp_envelope_schemas_as_data_and_native_dispatch_stays_outside(tmp_path, monkeypatch, run_async):
    monkeypatch.setenv("HARNESSROUTER_API_KEY", "fake-private-key")
    calls = []
    def serve(request):
        calls.append(request)
        if request.method == "POST":
            return httpx.Response(200, json={"id": "resp_test", "status": "in_progress"})
        return httpx.Response(200, json=completed())
    async def exercise():
        planner = HarnessRouterPlanner(cfg(poll_seconds=0.1), 1024, 5,
            client=httpx.AsyncClient(transport=httpx.MockTransport(serve)), journal=tmp_path / "requests.jsonl")
        messages = [{"role": "system", "content": "stable rules"}, {"role": "user", "content": "real facts", "_provider_state": {"opaque": "previous-vendor-private-state"}}]
        result = await planner.decide(messages, TOOLS)
        assert result["tool_calls"] == PLAN["tool_calls"]
        body = json.loads(calls[0].content)
        assert "tools" not in body and "previous_response_id" not in body
        assert json.loads(body["input"])["tools"] == TOOLS
        assert "previous-vendor-private-state" not in body["input"]
        assert body["metadata"] == {"harness_id": "dsh"} and body["model"] == "chosen"
        assert body["background"] and body["max_step"] == 4
        assert calls[0].headers["Idempotency-Key"]
        assert calls[0].headers["Authorization"] == "Bearer fake-private-key"
        assert str(calls[1].url).endswith("/api/harness/v1/responses/resp_test")
        assert result["model_status"]["route"] == "harnessrouter"
        await planner.aclose()
    run_async(exercise())
    records = [json.loads(line) for line in (tmp_path / "requests.jsonl").read_text().splitlines()]
    assert [row["phase"] for row in records] == ["submitting", "accepted", "completed"]
    assert all(not row["body_dispatched"] for row in records)
    assert "fake-private-key" not in (tmp_path / "requests.jsonl").read_text()


@pytest.mark.parametrize("payload", [completed(status="incomplete"), completed({"content": "", "tool_calls": []}),
    completed({**PLAN, "goalVerified": True}), completed({"content": None, "tool_calls": [{"id": "bad", "type": "function", "function": {"name": "mc_connection", "arguments": "{}"}}]}),
    completed(output=[{"type": "message", "content": [{"type": "output_text", "text": "```json\n{}\n```"}]}])])
def test_no_partial_or_invented_success_or_hidden_control_calls(payload):
    with pytest.raises((ValueError, TypeError)):
        decode_plan(payload, TOOLS)


def test_live_dsh_argument_object_is_canonicalized_without_coercing_values():
    tool = {"type": "function", "function": {"name": "agent_remember", "parameters": {"type": "object"}}}
    plan = {"content": None, "tool_calls": [{"id": "remember-1", "type": "function",
            "function": {"name": "agent_remember", "arguments": {"text": "continuity-token"}}}]}
    result = decode_plan(completed(plan), [tool])
    assert json.loads(result["tool_calls"][0]["function"]["arguments"]) == {"text": "continuity-token"}
    plan["tool_calls"][0]["function"]["arguments"] = '{"text":NaN}'
    with pytest.raises(ValueError, match="non_finite_json"):
        decode_plan(completed(plan), [tool])


def test_failed_harness_cancels_task_sanitizes_errors_and_never_retries(monkeypatch, run_async, tmp_path):
    monkeypatch.setenv("HARNESSROUTER_API_KEY", "sensitive")
    seen = []
    def serve(request):
        seen.append(str(request.url))
        return httpx.Response(503, text="sensitive upstream diagnostics")
    async def exercise():
        planner = HarnessRouterPlanner(cfg(), 1024, 5, client=httpx.AsyncClient(transport=httpx.MockTransport(serve)), journal=tmp_path / "requests.jsonl")
        with pytest.raises(RuntimeError, match="^harness_http_error_503$"):
            await planner.decide([], TOOLS)
        await planner.aclose()
    run_async(exercise())
    assert len(seen) == 1
    assert "sensitive" not in (tmp_path / "requests.jsonl").read_text()


def test_refused_upstream_is_not_retried_as_bad_json(monkeypatch, run_async, tmp_path):
    monkeypatch.setenv("HARNESSROUTER_API_KEY", "fake")
    def serve(_):
        return httpx.Response(200, json=completed(status="failed", error={"code": "turn_failed", "message": "private provider 429 body"}))
    async def exercise():
        planner = HarnessRouterPlanner(cfg(), 1024, 5, client=httpx.AsyncClient(transport=httpx.MockTransport(serve)), journal=tmp_path / "requests.jsonl")
        with pytest.raises(RuntimeError, match="^harness_task_failed_no_game_dispatch$"):
            await planner.decide([], TOOLS)
        await planner.aclose()
    run_async(exercise())
    last = json.loads((tmp_path / "requests.jsonl").read_text().splitlines()[-1])
    assert last["phase"] == "failed" and not last["body_dispatched"]
    assert "private provider" not in (tmp_path / "requests.jsonl").read_text()


def test_cancel_known_harness_task_without_claiming_game_cancel(monkeypatch, run_async, tmp_path):
    monkeypatch.setenv("HARNESSROUTER_API_KEY", "fake")
    calls = []
    async def serve(request):
        calls.append(request)
        return httpx.Response(200, json={"id": "resp_test", "status": "cancelled" if str(request.url).endswith("/cancel") else "in_progress"})
    async def exercise():
        planner = HarnessRouterPlanner(cfg(poll_seconds=5), 1024, 30,
            client=httpx.AsyncClient(transport=httpx.MockTransport(serve)), journal=tmp_path / "requests.jsonl")
        task = asyncio.create_task(planner.decide([], TOOLS))
        while not planner.response_id:
            await asyncio.sleep(0)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        await planner.aclose()
    run_async(exercise())
    assert len(calls) == 2 and str(calls[-1].url).endswith("/cancel")
    last = json.loads((tmp_path / "requests.jsonl").read_text().splitlines()[-1])
    assert last["cancellation_confirmed"] and last["body_dispatched"] is False


def test_discovery_uses_documented_path_no_model_request(monkeypatch, run_async):
    monkeypatch.setenv("HARNESSROUTER_API_KEY", "fake")
    seen = []
    def serve(request):
        seen.append(request)
        return httpx.Response(200, json={"protocol": "uhp", "capabilities": {"sessions": True}})
    async def exercise():
        planner = HarnessRouterPlanner(cfg(), 1024, 5, client=httpx.AsyncClient(transport=httpx.MockTransport(serve)))
        assert (await planner.inspect())["protocol"] == "uhp"
        await planner.aclose()
    run_async(exercise())
    assert len(seen) == 1 and seen[0].method == "GET" and str(seen[0].url).endswith("/v1/uhp")


def test_runtime_change_rejects_inflight_response_and_leaves_body_with_coordinator(tmp_path, run_async):
    file = tmp_path / "agent.toml"
    def write(model):
        file.write_text('[planner]\nbase_url="http://local.test/v1"\nmodel="' + model + '"\n')
    write("first")
    made = []
    class Fake:
        def __init__(self, config, *_args, **_kw):
            self.model, self.closed = config.model, False
            made.append(self)
        async def decide(self, *_):
            if self.model == "first":
                write("second")
            return PLAN
        async def aclose(self):
            self.closed = True
    async def exercise():
        router = RoutedPlanner(file, 1024, 5, factory=Fake)
        with pytest.raises(PlannerResponseError):
            await router.decide([], TOOLS)
        assert not made[0].closed
        assert (await router.decide([], TOOLS))["tool_calls"] == PLAN["tool_calls"]
        assert made[0].closed and len(made) == 2
        await router.aclose()
        assert made[1].closed
    run_async(exercise())


def test_switch_keeps_original_native_receipt_and_same_character(tmp_path, monkeypatch, run_async):
    import dataclasses
    from agent_mc_autonomy.agent_store import AgentSettings, AgentStore, tools as character_tools
    from agent_mc_autonomy.configuration import Settings
    from agent_mc_autonomy.controller import Controller, model_tools
    from agent_mc_autonomy.ownership import session_lease, session_is_owned
    from test_controller import Bridge, action, choose

    monkeypatch.setenv("HARNESSROUTER_API_KEY", "fake")
    file = tmp_path / "agent.toml"
    def write(route):
        file.write_text('[planner]\nroute="' + route + '"\nbase_url="http://local.test/v1"\nmodel="chosen"\n' +
                        ('harness_id="dsh"\n' if route == "harnessrouter" else ''))
    made = []
    class Port:
        def __init__(self, config, *_args, **_kwargs):
            self.harness = isinstance(config, HarnessRouterConfig)
            self.closed = False
            made.append(self)
        async def decide(self, *_):
            if self.harness:
                return choose()
            return {"content": None, "tool_calls": [{"id": "recall", "type": "function",
                    "function": {"name": "agent_recall", "arguments": '{"query":"bridge"}'}}]}
        async def aclose(self):
            self.closed = True

    profile = AgentSettings.parse({"owner_id": "owner", "id": "traveller", "name": "旅人", "persona": "诚实。"})
    store = AgentStore(tmp_path, profile, "same-world-account")
    store.configure()
    ident = store.invoke("agent_remember", {"text": "bridge promise"}, "note")["id"]
    bridge = Bridge()
    controller = None
    async def exercise():
        nonlocal controller
        write("harnessrouter")
        router = RoutedPlanner(file, 1024, 5, factory=Port)
        controller = Controller(bridge, router.decide, dataclasses.replace(Settings(), max_tool_rounds=1),
                                tmp_path / "host", lambda **_: None, lambda: False, character=store)
        controller.persist(stopped=False)
        schemas = model_tools(bridge.tools) + [{"type": "function", "function": {"name": t["name"],
                    "description": t["description"], "parameters": t["inputSchema"]}} for t in character_tools()]
        with session_lease(tmp_path / "host"):
            await controller.turn_once("test", store.prompt(), schemas)
            original = dict(controller.pending)
            write("direct")
            assert controller.current_work() and controller.pending == original
            assert len(made) == 1  # Changing a file starts neither a model nor a second body.
            assert session_is_owned(tmp_path / "host")
            bridge.event_pages = [[{"execution": action(terminal=True)}]]
            await controller.events()
            assert not controller.pending
            await controller.turn_once("test", store.prompt(), schemas)
            assert made[0].closed and len(made) == 2
            recall = json.loads(json.loads(controller.groups[-1][-1]["content"])["text"])
            assert recall["records"][0]["id"] == ident and not recall["current_world_verified"]
            assert len([call for call in bridge.calls if call[0] == "mc_do"]) == 1
            assert not any(call[0] == "mc_connection" for call in bridge.calls)
        await router.aclose()
    run_async(exercise())
    assert not session_is_owned(tmp_path / "host")
    assert controller.inflight_request is None


def test_routing_does_not_bypass_previous_unknown_action_block(tmp_path, run_async):
    from agent_mc_autonomy.configuration import Settings
    from agent_mc_autonomy.controller import Controller
    from test_controller import Bridge
    file = tmp_path / "agent.toml"
    file.write_text('[planner]\nbase_url="http://local.test/v1"\nmodel="replacement"\n')
    def forbidden(*_args, **_kwargs):
        raise AssertionError("Unknown actions must block before making a new planner")
    async def exercise():
        router = RoutedPlanner(file, 1024, 5, factory=forbidden)
        bridge = Bridge()
        controller = Controller(bridge, router.decide, Settings(), tmp_path, lambda **_: None, lambda: False)
        controller.persist(uncertain=True, inflight_request="original-request")
        with pytest.raises(RuntimeError, match="outcome_unknown"):
            await controller.run("continue")
        assert not bridge.opened and not bridge.calls
        assert json.loads(controller.state_path.read_text())["inflight_request"] == "original-request"
        await router.aclose()
    run_async(exercise())

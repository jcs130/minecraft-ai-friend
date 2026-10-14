"""Planning outages must not tear down the independent Minecraft body."""
import asyncio
import copy
import dataclasses
import json
from types import SimpleNamespace

import httpx
import pytest
from test_controller import action, choose, setup

from agent_mc_autonomy.model_config import HttpPlannerConfig
from agent_mc_autonomy.planner import HttpPlanner


def brain(serve):
    config = HttpPlannerConfig.parse({"provider": "openai-compatible", "model": "fixture",
                                      "base_url": "http://fixture.invalid/v1", "auth": {"mode": "none"}})
    return HttpPlanner(config, 2048, 10, client=httpx.AsyncClient(transport=httpx.MockTransport(serve)))


@pytest.mark.parametrize("status", [408, 429, 500, 502, 503, 504])
def test_transient_http_is_typed_and_sanitized_without_provider_retry(run_async, status):
    seen = []
    def serve(request):
        seen.append(request)
        return httpx.Response(status, text="private-provider-body", headers={"x-secret": "private-header"})
    planner = brain(serve)
    async def exercise():
        with pytest.raises(RuntimeError) as caught:
            await planner.decide([], [])
        assert type(caught.value).__name__ == "PlannerUnavailableError"
        assert caught.value.diagnostic == {"protocol": "chat", "reason": "http_error", "status": status}
        assert str(caught.value) == f"brain_http_error_{status}"
        assert len(seen) == 1
        await planner.aclose()
    run_async(exercise())


@pytest.mark.parametrize("error", [httpx.ConnectError, httpx.ReadTimeout, httpx.RemoteProtocolError])
def test_transport_failure_is_typed_without_leaking_url_or_error_text(run_async, error):
    def serve(request):
        raise error("private-transport-detail", request=request)
    planner = brain(serve)
    async def exercise():
        with pytest.raises(RuntimeError) as caught:
            await planner.decide([], [])
        assert type(caught.value).__name__ == "PlannerUnavailableError"
        assert caught.value.diagnostic == {"protocol": "chat", "reason": "transport_error"}
        assert str(caught.value) == "brain_transport_error"
        await planner.aclose()
    run_async(exercise())


@pytest.mark.parametrize("status", [400, 401, 403, 404])
def test_permanent_http_errors_are_not_silently_retried(run_async, status):
    planner = brain(lambda _: httpx.Response(status, text="private-body"))
    async def exercise():
        with pytest.raises(RuntimeError, match=f"brain_http_error_{status}") as caught:
            await planner.decide([], [])
        assert type(caught.value) is RuntimeError
        await planner.aclose()
    run_async(exercise())


def test_http_outage_retains_history_pending_and_events_then_recovers(framework_module, tmp_path, run_async):
    requests = []
    def serve(request):
        requests.append(json.loads(request.content))
        if len(requests) == 1:
            return httpx.Response(503, text="private-body")
        return httpx.Response(200, json={"choices": [{"finish_reason": "tool_calls", "message": choose()}]})
    planner = brain(serve)
    module, bridge, controller = setup(framework_module, tmp_path, planner.decide)
    controller.persist(stopped=False)
    controller.pending[("task", "body-1")] = action()
    controller.groups = [[{"role": "assistant", "content": "Observed exact inventory; find food next."}]]
    controller.recent = [{"cursor": 7, "text": "No food in inventory"}]
    before = copy.deepcopy((controller.groups, controller.recent, controller.pending))
    tools = module.model_tools(bridge.tools)
    run_async(controller.turn_once("survive", "prefix", tools))
    assert (controller.groups, controller.recent, controller.pending) == before
    assert controller.continuation_needed and controller.planner_failures == 1
    assert controller.inflight_request is None and not bridge.closed
    assert not json.loads(controller.state_path.read_text())["stopped"]
    assert not any(name in {"mc_do", "mc_connection"} for name, *_ in bridge.calls)
    bridge.event_pages.append([{"cursor": 8, "execution": action(terminal=True), "text": "Native action finished"}])
    run_async(controller.events())
    assert not controller.current_work()
    run_async(controller.turn_once("survive", "prefix", tools))
    assert controller.planner_failures == 0 and controller.planner_retry_at == 0
    assert "No food in inventory" in json.dumps(requests[1])
    assert "Native action finished" in json.dumps(requests[1])
    assert "Observed exact inventory" in json.dumps(requests[1])
    assert len([name for name, *_ in bridge.calls if name == "mc_do"]) == 1
    rows = [json.loads(line) for line in (tmp_path / "decisions.jsonl").read_text().splitlines()]
    assert rows[0]["rejected"] == {"protocol": "chat", "reason": "http_error", "status": 503}
    assert rows[0]["dispatched"] is False
    run_async(planner.aclose())


@pytest.mark.parametrize("interrupt", ["none", "user_feedback", "stop"])
def test_outage_cooldown_polls_body_and_preserves_feedback_and_stop(framework_module, tmp_path, run_async, monkeypatch, interrupt):
    clock, attempted, stopped = [1000], [], [False]
    def serve(_):
        attempted.append(clock[0])
        return httpx.Response(503)
    planner = brain(serve)
    module, bridge, controller = setup(framework_module, tmp_path, planner.decide, lambda: stopped[0])
    controller.settings = dataclasses.replace(controller.settings, min_decision_seconds=1)
    monkeypatch.setattr(module, "time", SimpleNamespace(monotonic=lambda: clock[0]))
    original_sleep = asyncio.sleep
    async def tick(_):
        clock[0] += 1
        stopped[0] = clock[0] >= (1003 if interrupt == "stop" else 1100)
        await original_sleep(0)
    monkeypatch.setattr(module.asyncio, "sleep", tick)
    if interrupt == "user_feedback":
        from agent_mc_autonomy.mailbox import Mailbox
        controller.commands = Mailbox(tmp_path)
    polls = []
    def on_poll():
        polls.append(clock[0])
        if clock[0] == 1002:
            bridge.event_pages.append([{"cursor": 9, "trigger": "flush", "text": "Ordinary fresh observation"}])
            if interrupt == "user_feedback":
                controller.commands.submit("feedback", {"goal": "Return to shelter", "mode": "insert"},
                                           "a6e8b876-9720-4a84-a049-74f3fb4e3b28")
    bridge.on_poll = on_poll
    run_async(controller.run("survive"))
    assert attempted == ([1000] if interrupt == "stop" else [1000, 1003] if interrupt == "user_feedback" else [1000, 1005])
    assert len(polls) > 1
    connections = [args["action"] for name, args, _ in bridge.calls if name == "mc_connection"]
    assert connections.count("connect") == connections.count("disconnect") == 1
    assert not any(name == "mc_do" for name, *_ in bridge.calls)
    assert bridge.closed and not controller.inflight_request
    run_async(planner.aclose())


def test_repeated_outage_caps_backoff_without_native_replay(framework_module, tmp_path, run_async):
    planner = brain(lambda _: httpx.Response(503))
    module, bridge, controller = setup(framework_module, tmp_path, planner.decide)
    controller.persist(stopped=False)
    tools = module.model_tools(bridge.tools)
    for _ in range(10):
        run_async(controller.turn_once("survive", "prefix", tools))
        assert 0 < controller.planner_retry_at - module.time.monotonic() <= 300
    assert controller.planner_failures == 10
    assert controller.planner_retry_at - module.time.monotonic() >= 299
    assert not bridge.closed and controller.inflight_request is None
    assert not any(name in {"mc_do", "mc_connection"} for name, *_ in bridge.calls)
    run_async(planner.aclose())

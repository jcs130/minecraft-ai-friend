import base64
import importlib
import json
import struct
from dataclasses import replace
from unittest.mock import AsyncMock

import httpx
import pytest


def module(framework_module, name):
    return importlib.import_module("agent_mc_autonomy."+name.removeprefix("autonomy."))

def image_raw():
    # Core's transport header, not a rendered image fixture.
    png = b"\x89PNG\r\n\x1a\n" + struct.pack(">I", 13) + b"IHDR" + struct.pack(">II", 128, 128)
    return {"content": [{"type": "image", "mimeType": "image/png", "data": base64.b64encode(png).decode()}]}


def answer(confidence=0.81):
    return {"type": "choice", "choice": "work", "confidence": confidence,
            "probabilities": {"survival": 0.02, "inspect": 0.1, "work": 0.88, "wait": 0}}


def test_fast_rules_no_request_and_danger_does_not_wait(framework_module, run_async):
    fast = module(framework_module, "autonomy.fast")
    selector = AsyncMock(return_value=answer())
    state = {"facts": {"body": "生命 2/20，饥饿 16/20"}}
    policy = fast.FastPolicy(fast.FastSettings(mode="host"), selector)
    assert run_async(policy.choose(state))["choice"] == "survival"
    assert selector.await_count == 0
    assert run_async(fast.FastPolicy(fast.FastSettings()).choose({"facts": {}}))["reason"] == "not_configured"


def test_jev_confidence_is_not_probability_and_low_confidence_falls_back(framework_module, run_async):
    fast = module(framework_module, "autonomy.fast")
    config = fast.FastSettings(mode="system_one")
    selector = AsyncMock(side_effect=[answer(), answer(.2)])
    policy = fast.FastPolicy(config, selector)
    state = {"facts": {"body": "生命 20/20"}}
    result = run_async(policy.choose(state))
    assert result["source"] == "system_one" and result["confidence"] == .81 and result["selected_probability"] == .88
    assert run_async(policy.choose(state))["reason"] == "low_confidence"


@pytest.mark.parametrize("change", [{"choice": "arbitrary_action"}, {"confidence": float("nan")},
                                  {"probabilities": {"work": 1}}, {"choice": "wait"}])
def test_invalid_fast_selection_never_authorizes_action(framework_module, run_async, change):
    fast = module(framework_module, "autonomy.fast")
    selector = AsyncMock(return_value={**answer(), **change})
    policy = fast.FastPolicy(fast.FastSettings(mode="host"), selector)
    result = run_async(policy.choose({"facts": {"body": "health=20"}}))
    assert result["source"] == "rules" and result["advisory_only"]
    assert run_async(policy.choose({"facts": {}}))["reason"] == "provider_cooldown"
    assert selector.await_count == 1


def test_systemone_remote_or_local_and_private_key_errors(framework_module, run_async, monkeypatch):
    fast = module(framework_module, "autonomy.fast")
    monkeypatch.setenv("MC_FAST_TEST_KEY", "fake-secret")
    requests = []
    def respond(request):
        requests.append(request)
        return httpx.Response(200, json={"model": "jev-test", "answers": {"focus": answer()}})
    config = fast.FastSettings.parse({"mode": "system_one", "endpoint": "https://api.example.test/v1/systemone", "model": "chosen", "api_key_env": "MC_FAST_TEST_KEY"})
    async def exercise():
        client = httpx.AsyncClient(transport=httpx.MockTransport(respond))
        service = fast.SystemOne(config, client=client)
        result = await service.select({"facts": {"body": "healthy"}})
        assert result["choice"] == "work"
        payload = json.loads(requests[0].content)
        assert set(payload) == {"state", "model", "questions"} and payload["model"] == "chosen"
        assert requests[0].headers["Authorization"] == "Bearer fake-secret"
        monkeypatch.delenv("MC_FAST_TEST_KEY")
        with pytest.raises(ValueError, match="fast_key_unavailable"):
            await service.select({})
        assert len(requests) == 1
        await service.aclose()
    run_async(exercise())
    assert fast.FastSettings.parse({"endpoint": "http://127.0.0.1:8000/v1/systemone"}).endpoint
    with pytest.raises(ValueError, match="https"):
        fast.FastSettings.parse({"endpoint": "http://remote.test/v1/systemone"})


def test_image_budget_latest_tail_and_no_old_artifact_refresh(framework_module, monkeypatch):
    perception = module(framework_module, "autonomy.perception")
    context = module(framework_module, "autonomy.context")
    frame = perception.latest_png(image_raw(), "mc_view_map")
    assert frame and not perception.latest_png(image_raw(), "mc_artifact")
    messages, budget = context.assemble("fixed", [], "goal", {"parts": []}, [], [],
        context_tokens=32768 - perception.IMAGE_RESERVE, reserved_output=1024)
    enriched, sent = perception.attach_frame(messages, frame)
    assert sent and enriched[:-1] == messages[:-1]
    assert enriched[-1]["content"][-1]["type"] == "image_url"
    assert budget["total"] + perception.IMAGE_RESERVE <= 32768
    monkeypatch.setattr(perception.time, "monotonic", lambda: frame["received_at"] + 16)
    assert perception.attach_frame(messages, frame) == (messages, False)
    assert not perception.latest_png({**image_raw(), "isError": True}, "mc_view_map")


def test_standalone_text_capability_never_sends_image(framework_module, run_async):
    planner = module(framework_module, "autonomy.planner")
    received = []
    def respond(request):
        received.append(json.loads(request.content))
        return httpx.Response(200, json={"choices": [{"finish_reason": "stop", "message": {"content": "ok"}}]})
    async def exercise():
        client = httpx.AsyncClient(transport=httpx.MockTransport(respond))
        brain = planner.HttpPlanner(planner.HttpPlannerConfig("http://model.test/v1", "model"), 512, 30, client=client)
        result = await brain.decide([{"role": "user", "content": [{"type": "text", "text": "current"}, {"type": "image_url", "image_url": {"url": "secret-image"}}]}], [])
        assert result["model_status"]["route"] == "standalone_text"
        assert received[0]["messages"] == [{"role": "user", "content": "current"}]
        await brain.aclose()
    run_async(exercise())


def test_missing_model_keeps_controller_turn_and_retry_bounded(framework_module, tmp_path, run_async):
    from test_controller import setup
    async def decide(*_):
        return {"content": None, "tool_calls": [], "model_status": {"route": "unavailable", "reason": "model_usage_not_bound"}}
    controller_module, bridge, controller = setup(framework_module, tmp_path, decide)
    controller.settings = replace(controller.settings, max_tool_rounds=1)
    run_async(controller.turn_once("survive", "rules", controller_module.model_tools(bridge.tools)))
    assert controller.continuation_needed and controller.planner_retry_at > 0
    assert not any(name == "mc_do" for name, _, _ in bridge.calls)
    assert bridge.calls[-1][1]["action"] == "end_turn"

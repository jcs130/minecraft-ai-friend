"""Player conversation and local narration share a turn, never a delivery channel."""
import copy
import dataclasses
import json

import pytest
from test_controller import choose, setup
from test_narration import voice  # noqa: F401 - shared durable fake-host fixture

from agent_mc_autonomy.context import assemble
from agent_mc_autonomy.controller import model_tools


def catalogue(skills=("chat", "goto")):
    return [{"name": "mc_do", "inputSchema": {"type": "object", "properties": {
        "steps": {"type": "array", "items": {"type": "object", "properties": {
            "skill": {"enum": list(skills)}, "text": {"type": "string"},
            "at": {"type": "array", "items": {"type": "number"}}}, "required": ["skill"]}}},
        "required": ["steps"]}, "_meta": {"agent-mc/v1": {"tags": ["act"]}}}]


@pytest.mark.parametrize("mode", ["compact", "full"])
def test_real_request_explains_native_conversation_without_companion_roster(mode):
    tools = model_tools(catalogue(), context_mode=mode)
    event = {"run": "test", "cursor": 1, "type": "minecraft.chat", "trigger": "flush",
             "text": "Alex: 山边有个洞，想一起看看吗？", "meta": {"channel": "public"}}
    first, _ = assemble("Original host persona", tools, "Explore freely", {}, [event], [],
        context_tokens=32768, reserved_output=2048, context_mode=mode)
    later, _ = assemble("Original host persona", tools, "Explore freely", {}, [], [],
        context_tokens=32768, reserved_output=2048, context_mode=mode)
    prefix = first[0]["content"]
    assert prefix == later[0]["content"]  # No social timer or per-message prefix churn.
    assert '"skill":"chat","text"' in prefix
    assert "may initiate" in prefix and "No roster" in prefix
    assert "not every turn" in prefix and "same mc_do" in prefix
    assert "client-transport" in prefix and "heard" in prefix
    assert "Alex:" in json.dumps(first[-1], ensure_ascii=False)


def test_chat_example_is_not_invented_for_a_backend_without_chat_steps():
    for tools in (model_tools(catalogue(("goto",))), [], model_tools([
            {"name": "mc_do", "inputSchema": {"type": "object", "properties": {"operation": {"type": "string"}}}}])):
        messages, _ = assemble("host", tools, "explore", {}, [], [], context_tokens=32768, reserved_output=2048)
        assert '"skill":"chat","text"' not in messages[0]["content"]


@pytest.mark.parametrize("name", ["_spoken_text", "spoken_text"])
def test_speech_field_called_as_tool_is_rejected_with_actionable_correction(
        framework_module, tmp_path, name):
    module, bridge, controller = setup(framework_module, tmp_path, None)
    selected = choose()["tool_calls"]
    selected[0]["function"] = {"name": name, "arguments": '{"text":"测试话语"}'}
    original = copy.deepcopy(selected)
    with pytest.raises(module.ModelCallRejected, match="not a tool.*mc_do"):
        controller.prepare_calls(selected, model_tools(bridge.tools))
    assert selected == original and bridge.calls == [] and not controller.pending


@pytest.mark.parametrize("mode", ["compact", "full"])
def test_chat_and_work_use_one_native_admission_while_local_speech_stays_local(
        voice, framework_module, run_async, mode):  # noqa: F811
    port, expected, _ = voice
    assert port.subscribe(expected)
    captured = []
    steps = [{"skill": "chat", "text": "我在山脚发现了一个洞，有人想一起看看吗？"},
             {"skill": "goto", "at": [1, 70, 3]}]

    async def decide(messages, tools):
        captured.append((messages, tools))
        return {"content": None, "tool_calls": [{"id": "one-choice", "type": "function", "function": {
            "name": "mc_do", "arguments": json.dumps({"steps": steps, "_spoken_text": "过去瞧瞧。"})}}]}

    module, bridge, controller = setup(framework_module, port.directory, decide)
    bridge.tools = catalogue()
    controller.settings = dataclasses.replace(controller.settings, context_mode=mode)
    assert not controller.settings.social.enabled
    controller.recent_request = lambda _: {**expected, "as_of": port.now()}
    run_async(controller.turn_once("explore", "body contract", model_tools(bridge.tools, context_mode=mode)))
    assert len(captured) == 1
    calls = [args for name, args, _ in bridge.calls if name == "mc_do"]
    assert calls == [{"steps": steps, "queue": "append"}]
    assert set(controller.pending) == {("task", "body-1")}
    assert port.take(expected)["line"] == "过去瞧瞧。"
    assert "not a tool" in captured[0][0][0]["content"]
    assert not any(name == "mc_stop" for name, _, _ in bridge.calls)


def test_local_narration_does_not_automatically_broadcast_to_players(voice, framework_module, run_async):  # noqa: F811
    port, expected, _ = voice
    assert port.subscribe(expected)
    async def decide(*_):
        return {"content": '{"spoken_text":"这座山真高。"}', "tool_calls": []}
    module, bridge, controller = setup(framework_module, port.directory, decide)
    bridge.tools = catalogue()
    controller.recent_request = lambda _: {**expected, "as_of": port.now()}
    run_async(controller.turn_once("explore", "body contract", model_tools(bridge.tools)))
    assert port.take(expected)["line"] == "这座山真高。"
    assert not any(name == "mc_do" for name, _, _ in bridge.calls) and not controller.pending

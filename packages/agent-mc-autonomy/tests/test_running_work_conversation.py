"""Conversation admission must not wait for an endless native task to finish."""

import asyncio
import dataclasses
import json
from types import SimpleNamespace

import pytest
from test_controller import choose, setup


@pytest.mark.parametrize("trigger", ["flush", "debounce", {"type": "flush"}])
def test_received_chat_and_read_followup_run_while_body_keeps_ownership(
        framework_module, tmp_path, run_async, monkeypatch, trigger):
    clock, decisions, delivered = [1000], [], [False]

    async def decide(messages, _):
        decisions.append((clock[0], messages))
        if len(decisions) == 1:
            response = choose()
            response["tool_calls"][0]["function"]["arguments"] = (
                '{"steps":[{"skill":"follow","name":"Alex"}]}')
            return response
        assert controller.pending[("task", "body-1")]["terminal"] is False
        if len(decisions) == 2:
            response = choose()
            response["tool_calls"][0]["function"] = {"name": "mc_help", "arguments": "{}"}
            return response
        return {"content": "看到你的消息啦，我们先回村歇一晚。", "tool_calls": []}

    module, bridge, controller = setup(framework_module, tmp_path, decide, lambda: clock[0] >= 1040)
    controller.settings = dataclasses.replace(
        controller.settings, max_decisions=0, max_tool_rounds=1, min_decision_seconds=10)
    bridge.tools.append({"name": "mc_help", "inputSchema": {"type": "object"}})
    monkeypatch.setattr(module, "time", SimpleNamespace(monotonic=lambda: clock[0]))
    original_sleep = asyncio.sleep

    async def tick(_):
        clock[0] += 1
        await original_sleep(0)

    monkeypatch.setattr(module.asyncio, "sleep", tick)

    def incoming():
        if controller.pending and clock[0] >= 1002 and not delivered[0]:
            delivered[0] = True
            bridge.event_pages.append([{"run": "run-1", "cursor": 1891,
                "type": "minecraft.chat", "trigger": trigger,
                "text": "[MC 私聊] Alex: 先回村歇一晚吗？"}])

    bridge.on_poll = incoming
    run_async(controller.run("survive"))
    assert [at for at, _ in decisions] == [1000, 1010, 1020]
    assert "先回村歇一晚吗" in json.dumps(decisions[1][1], ensure_ascii=False)
    assert "Read the next section" in json.dumps(decisions[2][1], ensure_ascii=False)
    assert sum(name == "mc_do" for name, _, _ in bridge.calls) == 1
    assert not any(name == "mc_stop" for name, _, _ in bridge.calls)


@pytest.mark.parametrize("event", [
    {"type": "minecraft.world.snapshot", "trigger": "flush"},
    {"type": "minecraft.task.progress", "trigger": "debounce"},
    {"type": "minecraft.chat", "trigger": "piggyback"},
    {"type": "minecraft.chat", "trigger": "flush", "contextDelivery": "archive-only"},
    {"type": "minecraft.chat", "trigger": "flush", "meta": {"staleEpoch": True}},
])
def test_telemetry_and_archived_chat_do_not_replan_running_work(
        framework_module, tmp_path, run_async, monkeypatch, event):
    clock, decisions, delivered = [1000], [], [False]

    async def decide(*_):
        decisions.append(clock[0])
        return choose()

    module, bridge, controller = setup(framework_module, tmp_path, decide, lambda: clock[0] >= 1030)
    controller.settings = dataclasses.replace(controller.settings, max_decisions=0, min_decision_seconds=5)
    monkeypatch.setattr(module, "time", SimpleNamespace(monotonic=lambda: clock[0]))
    original_sleep = asyncio.sleep

    async def tick(_):
        clock[0] += 1
        await original_sleep(0)

    monkeypatch.setattr(module.asyncio, "sleep", tick)

    def incoming():
        if controller.pending and not delivered[0]:
            delivered[0] = True
            bridge.event_pages.append([{"run": "run-1", "cursor": 1, "text": "snapshot", **event}])

    bridge.on_poll = incoming
    run_async(controller.run("survive"))
    assert decisions == [1000]


@pytest.mark.parametrize("stop_at,expected", [(1010, [1000]), (1045, [1000, 1030])])
def test_conversation_preserves_planner_backoff_and_explicit_stop(
        framework_module, tmp_path, run_async, monkeypatch, stop_at, expected):
    clock, decisions, delivered = [1000], [], [False]

    async def decide(*_):
        decisions.append(clock[0])
        return choose() if len(decisions) == 1 else {"content": "收到，等你过来。", "tool_calls": []}

    module, bridge, controller = setup(framework_module, tmp_path, decide, lambda: clock[0] >= stop_at)
    controller.settings = dataclasses.replace(controller.settings, max_decisions=0, min_decision_seconds=5)
    monkeypatch.setattr(module, "time", SimpleNamespace(monotonic=lambda: clock[0]))
    original_sleep = asyncio.sleep

    async def tick(_):
        clock[0] += 1
        await original_sleep(0)

    monkeypatch.setattr(module.asyncio, "sleep", tick)

    def incoming():
        if controller.pending and clock[0] >= 1002 and not delivered[0]:
            delivered[0] = True
            controller.planner_retry_at = 1030
            bridge.event_pages.append([{"run": "run-1", "cursor": 1,
                "type": "minecraft.chat", "trigger": "flush", "text": "[MC 私聊] Alex: 等等我"}])

    bridge.on_poll = incoming
    run_async(controller.run("survive"))
    assert decisions == expected
    assert sum(name == "mc_do" for name, _, _ in bridge.calls) == 1


def test_new_body_admission_ends_read_continuation_without_replaying_follow(
        framework_module, tmp_path, run_async):
    replies = iter(["mc_help", "mc_do"])

    async def decide(*_):
        response = choose()
        name = next(replies)
        response["tool_calls"][0]["function"] = {
            "name": name, "arguments": "{}" if name == "mc_help" else '{"steps":[]}'}
        return response

    module, bridge, controller = setup(framework_module, tmp_path, decide)
    controller.settings = dataclasses.replace(controller.settings, max_tool_rounds=1)
    bridge.tools.append({"name": "mc_help", "inputSchema": {"type": "object"}})
    controller.receipt({"execution": {"kind": "task", "id": "existing-follow",
        "phase": "running", "terminal": False}, "events": [{"run": "run-1", "cursor": 1,
        "type": "minecraft.chat", "trigger": "flush", "text": "[MC 私聊] Alex: 回村吗？"}]})
    tools = module.model_tools(bridge.tools)
    run_async(controller.turn_once("survive", "body contract", tools))
    assert controller.conversation_ready() and controller.continuation_needed
    run_async(controller.turn_once("survive", "body contract", tools))
    assert not controller.conversation_ready()
    assert set(controller.pending) == {("task", "existing-follow"), ("task", "body-1")}
    assert not any(name == "mc_stop" for name, _, _ in bridge.calls)


def test_message_during_reply_still_requests_another_decision(
        framework_module, tmp_path, run_async):
    async def exercise():
        ready = asyncio.Event()

        async def decide(*_):
            await ready.wait()
            return {"content": "第一条消息看到了。", "tool_calls": []}

        module, bridge, controller = setup(framework_module, tmp_path, decide)
        controller.receipt({"execution": {"kind": "task", "id": "existing-follow",
            "phase": "running", "terminal": False}, "events": [{"run": "run-1", "cursor": 1,
            "type": "minecraft.chat", "trigger": "flush", "text": "第一条消息"}]})
        bridge.on_poll = ready.set
        bridge.event_pages = [[{"run": "run-1", "cursor": 2, "type": "minecraft.chat",
            "trigger": "debounce", "text": "推理时新到的第二条消息"}]]
        await controller.turn_once("survive", "body contract", module.model_tools(bridge.tools))
        assert controller.conversation_ready() and controller.deferred_wake
        assert [event["cursor"] for event in controller.recent] == [2]
        assert controller.pending[("task", "existing-follow")]["terminal"] is False

    run_async(exercise())

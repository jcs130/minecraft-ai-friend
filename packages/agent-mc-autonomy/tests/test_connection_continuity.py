"""Retain one owned native runtime while its existing game connection retries."""
import asyncio
import dataclasses
from types import SimpleNamespace

import pytest
from test_controller import action, choose, packed, setup


@pytest.mark.parametrize("cancel_task", [False, True])
def test_transient_reconnect_pauses_planning_then_resumes_without_replaying_native_work(
        framework_module, tmp_path, run_async, monkeypatch, cancel_task):
    clock, decisions, published, cancelled = [1000], [], [], [False]

    async def decide(*_):
        decisions.append(clock[0])
        result = choose()
        if not cancel_task or len(decisions) > 1:
            result["tool_calls"][0]["function"] = {"name": "mc_help", "arguments": "{}"}
        return result

    module, bridge, controller = setup(framework_module, tmp_path, decide, lambda: clock[0] >= 1028)
    controller.settings = dataclasses.replace(controller.settings, max_decisions=0, max_tool_rounds=1,
                                              min_decision_seconds=10, idle_decision_seconds=60)
    controller.publish = lambda **row: published.append((clock[0], row))
    original_call, original_sleep = bridge.call, asyncio.sleep

    async def call(name, args, **kwargs):
        if name == "mc_connection" and args["action"] == "status":
            bridge.calls.append((name, args, kwargs))
            waiting = 1010 <= clock[0] < 1015
            return packed({"phase": "started", "connection": {"ready": not waiting,
                "phase": "connecting" if waiting else "online"},
                "lamps": [{"label": "服务器", "state": "loading" if waiting else "online"}]})
        return await original_call(name, args, **kwargs)

    async def tick(_):
        clock[0] += 1
        await original_sleep(0)

    def event():
        if cancel_task and clock[0] >= 1012 and not cancelled[0]:
            cancelled[0] = True
            bridge.event_pages.append([{"cursor": 8, "trigger": "flush",
                "execution": {**action(True), "phase": "cancelled"}}])

    monkeypatch.setattr(bridge, "call", call)
    monkeypatch.setattr(bridge, "on_poll", event)
    monkeypatch.setattr(module, "time", SimpleNamespace(monotonic=lambda: clock[0]))
    monkeypatch.setattr(module.asyncio, "sleep", tick)
    run_async(controller.run("survive"))
    assert decisions[0] == 1000 and any(t >= 1015 for t in decisions)
    assert not any(1010 <= t < 1015 for t in decisions)
    assert any(row.get("phase") == "reconnecting" and row.get("game_connected") is False for _, row in published)
    connections = [args["action"] for name, args, _ in bridge.calls if name == "mc_connection"]
    assert connections.count("connect") == connections.count("disconnect") == 1
    assert sum(name == "mc_do" for name, *_ in bridge.calls) == int(cancel_task)
    assert not controller.pending and bridge.closed


def test_typed_not_ready_overrides_stale_online_lamp(framework_module):
    from agent_mc_autonomy.controller import online
    assert not online({"phase": "started", "connection": {"ready": False, "phase": "connecting"},
                       "lamps": [{"label": "服务器", "state": "online"}]})


@pytest.mark.parametrize("phase", ["stopped", "unknown", None])
def test_stopped_or_untyped_connections_are_not_restarted_or_replayed(
        framework_module, tmp_path, run_async, phase):
    _, bridge, controller = setup(framework_module, tmp_path, None)
    controller.pending[("task", "body-1")] = action()
    status = {"phase": "started", "connection": {"ready": False, "phase": phase}}
    with pytest.raises(RuntimeError, match="native retry is not active"):
        run_async(controller.wait_for_native_reconnect(status))
    assert controller.pending[("task", "body-1")]["terminal"] is False
    assert not bridge.calls


def test_explicit_stop_wins_during_reconnection_without_clearing_original_pending(
        framework_module, tmp_path, run_async):
    _, bridge, controller = setup(framework_module, tmp_path, None, lambda: True)
    controller.pending[("task", "body-1")] = action()
    assert not run_async(controller.wait_for_native_reconnect({"phase": "started",
        "connection": {"ready": False, "phase": "stopped"}}))
    assert controller.pending[("task", "body-1")]["terminal"] is False and not bridge.calls


@pytest.mark.parametrize("waiting_phase", ["connecting", "retrying"])
def test_initial_native_retry_can_exceed_two_minutes_then_resume_once(
        framework_module, tmp_path, run_async, monkeypatch, waiting_phase):
    clock, decisions, published = [0], [], []

    async def decide(*_):
        decisions.append(clock[0])
        result = choose()
        result["tool_calls"][0]["function"] = {"name": "mc_help", "arguments": "{}"}
        return result

    module, bridge, controller = setup(framework_module, tmp_path, decide)
    controller.settings = dataclasses.replace(controller.settings, max_decisions=1, max_tool_rounds=1)
    controller.publish = lambda **row: published.append(row)
    original_call, original_sleep = bridge.call, asyncio.sleep

    async def call(name, args, **kwargs):
        if name == "mc_connection" and args["action"] == "status":
            bridge.calls.append((name, args, kwargs))
            waiting = clock[0] < 185
            return packed({"phase": "started", "connection": {"ready": not waiting,
                "phase": waiting_phase if waiting else "online"}})
        return await original_call(name, args, **kwargs)

    async def tick(_):
        clock[0] += 1
        await original_sleep(0)

    monkeypatch.setattr(bridge, "call", call)
    monkeypatch.setattr(module, "time", SimpleNamespace(monotonic=lambda: clock[0]))
    monkeypatch.setattr(module.asyncio, "sleep", tick)
    run_async(controller.run("survive"))
    assert decisions == [185]
    assert any(row.get("phase") == "reconnecting" and row.get("game_connected") is False for row in published)
    assert any(name == "mc_events" for name, *_ in bridge.calls)
    connections = [args["action"] for name, args, _ in bridge.calls if name == "mc_connection"]
    assert connections.count("connect") == connections.count("disconnect") == 1
    assert not any(name == "mc_do" for name, *_ in bridge.calls)
    assert bridge.closed and not controller.pending


def test_mailbox_stop_is_admitted_while_initial_connection_retries(
        framework_module, tmp_path, run_async, monkeypatch):
    import uuid

    from agent_mc_autonomy.mailbox import Mailbox

    clock = [0]
    module, bridge, controller = setup(framework_module, tmp_path, None)
    controller.commands = Mailbox(tmp_path)
    original_call, original_sleep = bridge.call, asyncio.sleep

    async def call(name, args, **kwargs):
        if name == "mc_connection" and args["action"] == "status":
            bridge.calls.append((name, args, kwargs))
            return packed({"phase": "started", "connection": {"ready": False, "phase": "retrying"}})
        return await original_call(name, args, **kwargs)

    async def tick(_):
        clock[0] += 1
        if clock[0] == 3:
            controller.commands.submit("stop", {"reason": "operator stop while server is down"}, str(uuid.uuid4()))
        await original_sleep(0)

    monkeypatch.setattr(bridge, "call", call)
    monkeypatch.setattr(module, "time", SimpleNamespace(monotonic=lambda: clock[0]))
    monkeypatch.setattr(module.asyncio, "sleep", tick)
    run_async(controller.run("survive"))
    assert clock[0] == 3 and controller.operator_stop
    assert not any(name in {"mc_do", "mc_help"} for name, *_ in bridge.calls)
    assert bridge.closed and not controller.pending

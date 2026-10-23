"""Full controller seams for native authority, optional deadlines and local reads."""

import asyncio
import dataclasses
import hashlib
import json
import time
import uuid

import pytest
from test_controller import action, choose, packed, setup
from test_host_recent import controller_fixture, message, projection

from agent_mc_autonomy.mailbox import Mailbox
from agent_mc_autonomy.viewer_public import viewer_projection


@pytest.mark.parametrize("evidence", [{"outcomeKnown": False}, {"outcomeUnknown": True}, {"nativeStatus": "unknown"}])
@pytest.mark.parametrize("next_tool", ["mc_do", "mc_help"])
def test_unknown_native_event_during_recent_wait_preserves_authority_and_restart_fence(
        framework_module, tmp_path, run_async, evidence, next_tool):
    inferred, cleaned = [], []

    async def decide(*_):
        inferred.append(True)
        result = choose()
        result["tool_calls"][0]["function"] = {"name": next_tool, "arguments": "{}"}
        return result

    module, bridge, controller = controller_fixture(framework_module, tmp_path, decide)
    bridge.tools.append({"name": "mc_help", "inputSchema": {"type": "object"}})
    bridge.event_pages.append([{"run": "run-1", "cursor": 1, "type": "minecraft.execution",
                               "execution": {**action(), "evidence": evidence}}])

    async def provider(req):
        try:
            await asyncio.sleep(10)
            return projection(req)
        finally:
            cleaned.append(True)

    controller.recent_context_provider = provider
    with pytest.raises(RuntimeError, match="outcome_unknown"):
        run_async(controller.turn_once("survive", "body", module.model_tools(bridge.tools)))
    assert inferred == []
    assert cleaned == [True]
    assert not any(name in {"mc_do", "mc_help"} for name, _, _ in bridge.calls)
    assert json.loads(controller.state_path.read_text())["uncertain"] is True
    result, _, boundary = run_async(controller.execute_model_call(next_tool, {}))
    assert boundary and result["dispatched"] is False
    assert not any(name in {"mc_do", "mc_help"} for name, _, _ in bridge.calls)
    assert json.loads(controller.state_path.read_text())["uncertain"] is True
    _, restarted_bridge, restarted = setup(framework_module, tmp_path, decide)
    with pytest.raises(RuntimeError, match="previous dispatch requires receipt reconciliation"):
        run_async(restarted.run("survive"))
    assert not restarted_bridge.opened and restarted_bridge.calls == []
    assert json.loads(controller.state_path.read_text())["uncertain"] is True


def test_native_event_transport_error_is_not_optional_provider_failure(framework_module, tmp_path, run_async):
    class NativeFailure(RuntimeError):
        pass

    failure = NativeFailure("synthetic authoritative event transport failure")
    inferred = []

    async def decide(*_):
        inferred.append(True)
        return choose()

    module, bridge, controller = controller_fixture(framework_module, tmp_path, decide)
    original = bridge.call

    async def call(name, args, **kwargs):
        if name == "mc_events":
            raise failure
        return await original(name, args, **kwargs)

    async def provider(req):
        await asyncio.sleep(0)
        return projection(req)

    bridge.call, controller.recent_context_provider = call, provider
    with pytest.raises(NativeFailure) as caught:
        run_async(controller.turn_once("survive", "body", module.model_tools(bridge.tools)))
    assert caught.value is failure and inferred == []


def delayed_native(bridge, controller, stage, entered, release, *, unknown=False):
    original = bridge.call
    calls = []
    event = {"run": "run-1", "cursor": 1, "type": "minecraft.observation", "text": "deferred native evidence"}
    if unknown:
        event["execution"] = {**action(), "evidence": {"outcomeKnown": False}}
    page = {"run": "run-1", "nextCursor": 1, "events": [event]}
    if stage == "renew":
        controller.settings = dataclasses.replace(controller.settings, java_client={"leaseMs": 1000})
        controller.body_lease_due = 0

    async def call(name, args, **kwargs):
        calls.append((name, args))
        blocked = (name == "mc_events" and stage == "events" or name == "mc_control" and stage == "renew"
                   or name == "mc_protocol" and args.get("action") == "archive" and stage == "gap")
        if blocked:
            entered.set()
            await release.wait()
        if name == "mc_control":
            return packed({"expiresAt": 15000})
        if name == "mc_events":
            return packed({**page, "gap": stage == "gap"})
        if name == "mc_protocol" and args.get("action") == "archive":
            return packed(page)
        return await original(name, args, **kwargs)

    bridge.call = call
    return calls


@pytest.mark.parametrize("stage", ["events", "gap", "renew"])
@pytest.mark.parametrize("provider_waits", [False, True])
def test_total_recent_wait_is_bounded_and_defers_until_owned_native_page_drains(
        framework_module, tmp_path, run_async, stage, provider_waits):
    inferred, cleaned = [], []

    async def decide(*_):
        inferred.append(True)
        return choose()

    module, bridge, controller = controller_fixture(framework_module, tmp_path, decide)

    async def scenario():
        entered, release = asyncio.Event(), asyncio.Event()
        calls = delayed_native(bridge, controller, stage, entered, release)

        async def provider(req):
            try:
                await asyncio.sleep(10 if provider_waits else 0)
                return projection(req)
            finally:
                cleaned.append(True)

        controller.recent_context_provider = provider
        turn = asyncio.create_task(controller.turn_once("survive", "body", module.model_tools(bridge.tools)))
        try:
            await asyncio.wait_for(entered.wait(), 0.2)
            started = time.monotonic()
            await asyncio.wait_for(asyncio.shield(turn), 0.7)
            assert time.monotonic() - started < 0.65
            assert inferred == [] and cleaned == [True]
            # A second direct turn cannot outrun the coordinator's owned page.
            await controller.turn_once("survive", "body", module.model_tools(bridge.tools))
            assert inferred == []
            release.set()
            await controller.events()
            assert [r["text"] for r in controller.recent] == ["deferred native evidence"]
            assert sum(name == "mc_events" for name, _ in calls) == 1
            assert sum(name == "mc_protocol" and args.get("action") == "archive" for name, args in calls) == (stage == "gap")
        finally:
            release.set()
            if not turn.done():
                turn.cancel()
            await asyncio.gather(turn, return_exceptions=True)

    run_async(scenario())


@pytest.mark.parametrize("signal", ["stop", "feedback"])
def test_stop_and_real_feedback_are_observed_while_native_page_is_slow(
        framework_module, tmp_path, run_async, signal):
    inferred, stopped = [], [False]

    async def decide(*_):
        inferred.append(True)
        return choose()

    module, bridge, controller = controller_fixture(framework_module, tmp_path, decide)
    controller.stop_requested = lambda: stopped[0]
    controller.commands = Mailbox(tmp_path)

    async def scenario():
        entered, release = asyncio.Event(), asyncio.Event()
        delayed_native(bridge, controller, "events", entered, release, unknown=True)

        async def provider(req):
            await asyncio.sleep(0)
            return projection(req)

        controller.recent_context_provider = provider
        turn = asyncio.create_task(controller.turn_once("survive", "body", module.model_tools(bridge.tools)))
        try:
            await asyncio.wait_for(entered.wait(), 0.2)
            started = time.monotonic()
            if signal == "stop":
                stopped[0] = True
            else:
                controller.commands.submit("feedback", {"goal": "New real user feedback", "mode": "insert", "origin": "user"}, str(uuid.uuid4()))
            await asyncio.wait_for(asyncio.shield(turn), 0.3)
            assert time.monotonic() - started < 0.25 and inferred == []
            release.set()
            with pytest.raises(RuntimeError, match="outcome_unknown"):
                await controller.events()
            assert json.loads(controller.state_path.read_text())["uncertain"] is True
        finally:
            release.set()
            if not turn.done():
                turn.cancel()
            await asyncio.gather(turn, return_exceptions=True)

    run_async(scenario())


def test_full_host_original_dispatch_keeps_json_expanding_text_and_receipts_local(
        framework_module, tmp_path, run_async):
    _, bridge, controller = controller_fixture(framework_module, tmp_path, None)
    published = []
    controller.publish = lambda **values: published.append(values)
    run_async(controller.protocol("facts"))
    req = controller.recent_request(controller.current_host_context())
    text = "\x01" * 1000
    selected = controller.host_context_port.queryable_recent(projection(req, [message(text=text, occurred=req["as_of"]-1)]), req)
    handle = selected["recent_messages"][0]["original_ref"]["handle"]
    before = len(bridge.calls)
    result, compact, _ = run_async(controller.execute_model_call("mc_original", {"handle": handle, "offset": 0, "limit": 1000}))
    assert bridge.calls[before:] == [] and bridge.artifacts == []
    page = json.loads(result["text"])
    assert page["text"] == text and page["text_sha256"] == hashlib.sha256(text.encode()).hexdigest()
    assert json.loads(json.loads(compact)["text"])["text"] == text
    journal = json.loads((tmp_path / "receipts.jsonl").read_text())
    assert json.loads(journal["result"]["text"])["text"] == text
    assert "\\u0001" not in json.dumps(published)
    public = viewer_projection({"game_connected": True, **published[-1]}, "SyntheticPlayer", "public-session")
    assert "\\u0001" not in json.dumps(public) and handle not in json.dumps(public)


def test_full_genuine_body_original_dispatch_preserves_native_artifact_archiving(
        framework_module, tmp_path, run_async):
    _, bridge, controller = controller_fixture(framework_module, tmp_path, None)
    text = "\x01" * 1000
    bridge.artifacts.append(text)
    result, compact, _ = run_async(controller.execute_model_call("mc_original", {"handle": "log:1", "limit": 1000}))
    assert json.loads(result["text"])["text"] == text
    assert any(name == "mc_artifact" and args["action"] == "get" for name, args, _ in bridge.calls)
    assert any(name == "mc_artifact" and args["action"] == "put" for name, args, _ in bridge.calls)
    assert json.loads(compact)["original_chunks"]


@pytest.mark.parametrize("late_unknown", [False, True])
def test_run_shutdown_observes_or_fences_the_owned_native_poll_before_closing(
        framework_module, tmp_path, run_async, late_unknown):
    inferred, stopped, cancelled = [], [False], []

    async def decide(*_):
        inferred.append(True)
        return choose()

    _, bridge, controller = controller_fixture(framework_module, tmp_path, decide)
    controller.stop_requested = lambda: stopped[0]
    original = bridge.call

    async def scenario():
        entered, release = asyncio.Event(), asyncio.Event()
        polls = 0

        async def call(name, args, **kwargs):
            nonlocal polls
            if name == "mc_events":
                polls += 1
                if polls > 1:
                    entered.set()
                    try:
                        await release.wait()
                    except asyncio.CancelledError:
                        cancelled.append(True)
                        raise
                    return packed({"run": "run-1", "nextCursor": 1, "events": [
                        {"run": "run-1", "cursor": 1, "execution": {**action(), "evidence": {"outcomeKnown": False}}}]})
                return packed({"run": "run-1", "nextCursor": 0, "events": []})
            if name == "mc_connection" and args["action"] == "disconnect":
                if not late_unknown:
                    assert cancelled == [True]
            return await original(name, args, **kwargs)

        async def provider(req):
            await asyncio.sleep(0)
            return projection(req)

        async def stop_after_poll():
            await entered.wait()
            stopped[0] = True
            if late_unknown:
                release.set()

        bridge.call, controller.recent_context_provider = call, provider
        steering = asyncio.create_task(stop_after_poll())
        try:
            if late_unknown:
                with pytest.raises(RuntimeError, match="outcome_unknown"):
                    await asyncio.wait_for(controller.run("survive"), 2)
            else:
                await asyncio.wait_for(controller.run("survive"), 2)
            assert inferred == [] and bridge.closed
            assert json.loads(controller.state_path.read_text())["uncertain"] is True
            assert polls == 2
            _, restarted_bridge, restarted = setup(framework_module, tmp_path, decide)
            with pytest.raises(RuntimeError, match="previous dispatch requires receipt reconciliation"):
                await restarted.run("survive")
            assert not restarted_bridge.opened
        finally:
            release.set()
            if not steering.done():
                steering.cancel()
            await asyncio.gather(steering, return_exceptions=True)

    run_async(scenario())


def test_cancelled_owned_native_poll_still_fences_restart_during_shutdown(
        framework_module, tmp_path, run_async):
    _, bridge, controller = controller_fixture(framework_module, tmp_path, None)
    original = bridge.call

    async def scenario():
        entered = asyncio.Event()
        native_tasks = []
        async def call(name, args, **kwargs):
            if name == "mc_events":
                native_tasks.append(asyncio.current_task())
                entered.set()
                await asyncio.sleep(10)
            return await original(name, args, **kwargs)
        bridge.call = call
        waiter = asyncio.create_task(controller.events())
        await entered.wait()
        # Model interpreter/transport shutdown cancelling its owned native task
        # before the coordinator gets to join it. An unread page is unresolved.
        native_tasks[0].cancel()
        await asyncio.gather(waiter, return_exceptions=True)
        await controller.close_event_poll()
        assert json.loads(controller.state_path.read_text())["uncertain"] is True
        _, restarted_bridge, restarted = setup(framework_module, tmp_path, None)
        with pytest.raises(RuntimeError, match="previous dispatch requires receipt reconciliation"):
            await restarted.run("survive")
        assert not restarted_bridge.opened

    run_async(scenario())


@pytest.mark.parametrize("stop_at", ["optional_wait", "deferred_join"])
def test_real_mailbox_stop_closes_runtime_without_releasing_deferred_native_page(
        framework_module, tmp_path, run_async, stop_at):
    inferred, native_calls, cancelled = [], [], []
    stop_id = "00000000-0000-4000-8000-000000000201"
    steps_id = "00000000-0000-4000-8000-000000000202"

    async def decide(*_):
        inferred.append(True)
        return choose()

    _, bridge, controller = controller_fixture(framework_module, tmp_path, decide)
    box = controller.commands = Mailbox(tmp_path)
    original, original_events = bridge.call, controller.events

    async def scenario():
        entered, joined, release = asyncio.Event(), asyncio.Event(), asyncio.Event()
        polls, joins = 0, 0

        async def events():
            nonlocal joins
            joins += 1
            if joins == 3:  # Normal poll, optional poll, then coordinator join.
                joined.set()
            return await original_events()

        async def call(name, args, **kwargs):
            nonlocal polls
            native_calls.append(name)
            if name == "mc_events":
                polls += 1
                if polls == 2:
                    entered.set()
                    try:
                        await release.wait()
                    except asyncio.CancelledError:
                        cancelled.append(True)
                        raise
                return packed({"run": "run-1", "nextCursor": polls, "events": []})
            return await original(name, args, **kwargs)

        async def provider(req):
            await asyncio.sleep(0)
            return projection(req)

        bridge.call, controller.events, controller.recent_context_provider = call, events, provider
        runtime = asyncio.create_task(controller.run("survive"))
        try:
            await asyncio.wait_for(entered.wait(), 0.5)
            # An ordinary older command must not bypass the unresolved page.
            box.submit("steps", {"steps": [{"skill": "observe"}], "queue": "append"}, steps_id)
            if stop_at == "deferred_join":
                await asyncio.wait_for(joined.wait(), 2)
            started = time.monotonic()
            assert box.submit("stop", {}, stop_id)["delivery"] == "queued"
            await asyncio.wait_for(asyncio.shield(runtime), 1.8)
            assert time.monotonic() - started < 1.7
            delivered = box.get(stop_id)
            assert delivered["delivery"] == "delivered" and delivered["native_receipt"]["stop_requested"] is True
            assert box.submit("stop", {}, stop_id) == delivered  # Same durable UUID, no second stop.
            assert box.get(steps_id)["delivery"] == "cancelled"
            assert not release.is_set() and cancelled == [True] and polls == 2
            assert bridge.closed and inferred == []
            assert not {"mc_do", "mc_scout", "mc_stop"}.intersection(native_calls)
            assert json.loads(controller.state_path.read_text())["uncertain"] is True
            _, restarted_bridge, restarted = setup(framework_module, tmp_path, decide)
            with pytest.raises(RuntimeError, match="previous dispatch requires receipt reconciliation"):
                await restarted.run("survive")
            assert not restarted_bridge.opened
        finally:
            if not runtime.done():
                runtime.cancel()
            await asyncio.gather(runtime, return_exceptions=True)
            release.set()

    run_async(scenario())


def test_real_mailbox_stop_cannot_be_starved_by_repeated_has_more_pages(
        framework_module, tmp_path, run_async):
    inferred, native_calls = [], []
    stop_id = "00000000-0000-4000-8000-000000000203"

    async def decide(*_):
        inferred.append(True)
        return choose()

    _, bridge, controller = controller_fixture(framework_module, tmp_path, decide)
    box = controller.commands = Mailbox(tmp_path)
    original = bridge.call

    async def scenario():
        repeated = asyncio.Event()
        polls = 0

        async def call(name, args, **kwargs):
            nonlocal polls
            native_calls.append(name)
            if name == "mc_events":
                polls += 1
                if polls >= 3:
                    repeated.set()
                await asyncio.sleep(0.005)
                return packed({"run": "run-1", "nextCursor": polls, "events": [], "hasMore": polls > 1})
            return await original(name, args, **kwargs)

        async def provider(req):
            await asyncio.sleep(0)
            return projection(req)

        bridge.call, controller.recent_context_provider = call, provider
        runtime = asyncio.create_task(controller.run("survive"))
        try:
            await asyncio.wait_for(repeated.wait(), 0.5)
            started = time.monotonic()
            box.submit("stop", {}, stop_id)
            await asyncio.wait_for(asyncio.shield(runtime), 1.8)
            assert time.monotonic() - started < 1.7
            assert box.get(stop_id)["delivery"] == "delivered"
            assert box.get(stop_id)["native_receipt"]["stop_requested"] is True
            assert bridge.closed and inferred == []
            assert not {"mc_do", "mc_scout", "mc_stop"}.intersection(native_calls)
            assert json.loads(controller.state_path.read_text())["uncertain"] is True
            _, restarted_bridge, restarted = setup(framework_module, tmp_path, decide)
            with pytest.raises(RuntimeError, match="previous dispatch requires receipt reconciliation"):
                await restarted.run("survive")
            assert not restarted_bridge.opened
        finally:
            if not runtime.done():
                runtime.cancel()
            await asyncio.gather(runtime, return_exceptions=True)

    run_async(scenario())


def test_shutdown_fences_completed_has_more_page_when_its_waiter_was_cancelled(
        framework_module, tmp_path, run_async):
    _, bridge, controller = controller_fixture(framework_module, tmp_path, None)
    original = bridge.call

    async def scenario():
        waiter = None
        async def call(name, args, **kwargs):
            if name == "mc_events":
                # Cancellation races delivery of an already-completed page.
                asyncio.get_running_loop().call_soon(waiter.cancel)
                return packed({"run": "run-1", "nextCursor": 1, "events": [], "hasMore": True})
            return await original(name, args, **kwargs)
        bridge.call = call
        waiter = asyncio.create_task(controller.events())
        await asyncio.gather(waiter, return_exceptions=True)
        await controller.close_event_poll()
        assert json.loads(controller.state_path.read_text())["uncertain"] is True
        _, restarted_bridge, restarted = setup(framework_module, tmp_path, None)
        with pytest.raises(RuntimeError, match="previous dispatch requires receipt reconciliation"):
            await restarted.run("survive")
        assert not restarted_bridge.opened

    run_async(scenario())

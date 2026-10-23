"""One explicitly shared model; review may defer new slow body requests only."""

import asyncio
import dataclasses
import json
import uuid
from copy import copy, deepcopy
from types import SimpleNamespace

import pytest
from test_controller import choose, setup
from test_review import runtime as review_runtime

from agent_mc_autonomy.configuration import Settings
from agent_mc_autonomy.review import ReviewPolicy, ReviewPort

POOL = "explicitly-shared-test-model"


def test_existing_body_boundary_does_not_start_another_model_during_review(
    framework_module, tmp_path, run_async
):
    requests = []

    async def decide(*_):
        requests.append(True)
        return choose()

    module, bridge, controller = setup(framework_module, tmp_path, decide)
    settings = copy(controller.settings)
    object.__setattr__(settings, "review_model_pool", POOL)
    controller.settings = settings
    controller.review_port = SimpleNamespace(
        model_inference_window=lambda _: {
            "id": "window",
            "review_id": "a" * 12,
            "expires_at": 10180,
        }
    )
    run_async(
        controller.turn_once("survive", "contract", module.model_tools(bridge.tools))
    )
    assert requests == [], (
        "Body admitted a new expensive request while the shared-model review was already active"
    )
    assert not any(name == "mc_do" for name, _, _ in bridge.calls)


@pytest.fixture
def review(tmp_path):
    port, clock, publish = review_runtime.__wrapped__(tmp_path)
    publish(game_identity={"realm": "test", "account": "bot", "agent": "player"})
    offered = port.offer()["review"]
    port.decide(offered["id"], "inspect")
    return port, clock, publish, offered


def test_pool_is_explicit_disabled_by_default_and_does_not_change_identity():
    base = {"server": {"host": "example.test", "username": "Bot"}}
    assert Settings.parse(base).review_model_pool == ""
    configured = Settings.parse({**base, "autonomy": {"review_model_pool": POOL}})
    assert (
        configured.review_model_pool == POOL
        and configured.identity == Settings.parse(base).identity
    )
    for value in ["https://private.invalid", "x" * 129, True, "with space"]:
        with pytest.raises(ValueError):
            Settings.parse({**base, "autonomy": {"review_model_pool": value}})


def test_cross_process_window_is_bounded_scoped_and_has_no_native_side_effects(review):
    port, clock, _, offered = review
    before = deepcopy(port.state())
    window = port.begin_model_inference(offered["id"], POOL)
    other = ReviewPort(port.directory, now=port.now)
    assert window["expires_at"] == offered["opportunity"]["expires_at"]
    assert 0 < window["expires_at"] - clock[0] <= 180
    assert other.model_inference_window(POOL)["id"] == window["id"]
    assert not other.end_model_inference(None) and not other.end_model_inference(
        "untrusted text"
    )
    assert other.model_inference_window("other-model") is None
    assert not port.state()["review"].get("result") and not port.mailbox.ready()
    assert port.mailbox.intent_revision() == before["review"]["revision"]
    assert other.end_model_inference(window["id"])
    assert port.model_inference_window(POOL) is None
    newer = port.begin_model_inference(offered["id"], POOL)
    assert not other.end_model_inference(window["id"])
    assert port.model_inference_window(POOL)["id"] == newer["id"]


@pytest.mark.parametrize(
    "change",
    ["expiry", "stale", "session", "scope", "user", "stop", "death", "disabled"],
)
def test_stale_or_urgent_boundaries_ignore_old_window_without_replaying_it(
    review, change
):
    port, clock, publish, offered = review
    window = port.begin_model_inference(offered["id"], POOL)
    if change == "expiry":
        clock[0] += 181
        publish()
    elif change == "stale":
        clock[0] += 31
    elif change == "session":
        publish(owner_pid=456)
    elif change == "scope":
        publish(game_identity={"realm": "other", "account": "bot", "agent": "player"})
    elif change == "user":
        port.mailbox.submit(
            "feedback", {"goal": "New human goal", "mode": "insert"}, str(uuid.uuid4())
        )
    elif change == "stop":
        port.mailbox.submit("stop", {}, str(uuid.uuid4()))
    elif change == "disabled":
        port.configure(ReviewPolicy(enabled=False))
    else:
        publish(phase="failed", error="native danger/death")
    assert port.model_inference_window(POOL) is None
    assert (
        port.state()["model_inference_window"]["id"] == window["id"]
    )  # No cleanup/replay of historical state.


def test_body_request_is_deferred_but_the_original_native_queue_is_untouched(
    framework_module, tmp_path, run_async, review
):
    port, _, _, offered = review
    requests = []

    async def decide(*_):
        requests.append(True)
        return choose()

    module, bridge, controller = setup(framework_module, tmp_path, decide)
    controller.review_port = port
    controller.settings = dataclasses.replace(
        controller.settings, review_model_pool=POOL, max_tool_rounds=1
    )
    original = {
        ("task", "old"): {
            "kind": "task",
            "id": "old",
            "phase": "running",
            "terminal": False,
        }
    }
    controller.pending = deepcopy(original)
    window = port.begin_model_inference(offered["id"], POOL)
    run_async(
        controller.turn_once(
            "survive", "core contract", module.model_tools(bridge.tools)
        )
    )
    assert requests == [] and bridge.calls == []
    assert controller.pending == original and controller.continuation_needed
    assert not controller.stop_requested()
    port.end_model_inference(window["id"])
    controller.receipt(
        {
            "execution": {
                "kind": "task",
                "id": "old",
                "phase": "completed",
                "terminal": True,
            }
        }
    )
    assert (
        not controller.pending
    )  # The ordinary receipt path still reconciles native work while held.
    run_async(
        controller.turn_once(
            "survive", "core contract", module.model_tools(bridge.tools)
        )
    )
    assert requests == [True] and ("task", "body-1") in controller.pending


def test_already_inflight_body_response_is_not_cancelled_or_discarded(
    framework_module, tmp_path, run_async, review
):
    port, _, _, offered = review
    windows = []

    async def decide(*_):
        windows.append(port.begin_model_inference(offered["id"], POOL))
        await asyncio.sleep(0)
        return choose()

    module, bridge, controller = setup(framework_module, tmp_path, decide)
    controller.review_port = port
    controller.settings = dataclasses.replace(
        controller.settings, review_model_pool=POOL, max_tool_rounds=1
    )
    run_async(
        controller.turn_once(
            "survive", "core contract", module.model_tools(bridge.tools)
        )
    )
    assert ("task", "body-1") in controller.pending and windows
    assert not controller.preempted
    assert any(name == "mc_do" for name, _, _ in bridge.calls)


def test_user_feedback_bypasses_optional_model_window(
    framework_module, tmp_path, run_async, review
):
    port, _, _, offered = review
    port.begin_model_inference(offered["id"], POOL)

    async def decide(*_):
        return choose()

    module, bridge, controller = setup(framework_module, tmp_path, decide)
    controller.review_port = port
    controller.settings = dataclasses.replace(
        controller.settings, review_model_pool=POOL, max_tool_rounds=1
    )
    controller.commands = port.mailbox
    controller.commands.submit(
        "feedback",
        {"goal": "New human intent", "origin": "user", "mode": "insert"},
        str(uuid.uuid4()),
    )
    controller.commands.claim()
    controller.active_goal = controller.commands.active_goal()
    controller.feedback_pending = True
    run_async(
        controller.turn_once(
            "New human intent", "contract", module.model_tools(bridge.tools)
        )
    )
    assert any(name == "mc_do" for name, _, _ in bridge.calls)


@pytest.mark.parametrize("priority", ["ordinary", "danger"])
def test_run_loop_keeps_native_polling_without_spending_decision_budget(
    framework_module, tmp_path, run_async, review, monkeypatch, priority
):
    port, _, _, offered = review
    window = port.begin_model_inference(offered["id"], POOL)
    clock, requests = [1000], []

    async def decide(*_):
        requests.append(clock[0])
        return choose()

    module, bridge, controller = setup(
        framework_module, tmp_path, decide, lambda: clock[0] > 1006
    )
    controller.review_port = port
    controller.settings = dataclasses.replace(
        controller.settings, review_model_pool=POOL, max_decisions=1, max_tool_rounds=1
    )
    original_sleep = asyncio.sleep

    async def tick(_):
        clock[0] += 1
        if clock[0] == 1003:
            port.end_model_inference(window["id"])
        await original_sleep(0)

    monkeypatch.setattr(module, "time", SimpleNamespace(monotonic=lambda: clock[0]))
    monkeypatch.setattr(module.asyncio, "sleep", tick)

    def danger():
        if clock[0] == 1002:
            bridge.event_pages.append(
                [{"cursor": 1, "trigger": "interrupt", "text": "Health dropped"}]
            )

    if priority == "danger":
        bridge.on_poll = danger
    run_async(controller.run("survive"))
    assert (
        requests == [1002 if priority == "danger" else 1003] and controller.count == 1
    )
    assert sum(name == "mc_events" for name, _, _ in bridge.calls) >= (
        2 if priority == "danger" else 3
    )
    assert not any(name == "mc_stop" for name, _, _ in bridge.calls)


def test_durable_stop_is_processed_while_new_inference_is_deferred(
    framework_module, tmp_path, run_async, review, monkeypatch
):
    port, _, _, offered = review
    port.begin_model_inference(offered["id"], POOL)
    clock, requests = [1000], []

    async def decide(*_):
        requests.append(True)
        return choose()

    module, bridge, controller = setup(
        framework_module, tmp_path, decide, lambda: clock[0] > 1006
    )
    controller.review_port = port
    controller.commands = port.mailbox
    controller.settings = dataclasses.replace(
        controller.settings, review_model_pool=POOL, max_decisions=0
    )
    original_sleep = asyncio.sleep
    stop_id = str(uuid.uuid4())

    async def tick(_):
        clock[0] += 1
        if clock[0] == 1002:
            port.mailbox.submit("stop", {}, stop_id)
        await original_sleep(0)

    monkeypatch.setattr(module, "time", SimpleNamespace(monotonic=lambda: clock[0]))
    monkeypatch.setattr(module.asyncio, "sleep", tick)
    run_async(controller.run("survive"))
    assert not requests and controller.count == 0
    assert port.mailbox.get(stop_id)["delivery"] == "delivered"
    assert any(
        name == "mc_connection" and args["action"] == "disconnect"
        for name, args, _ in bridge.calls
    )


def test_window_begins_during_input_assembly_without_losing_a_decision(
    framework_module, tmp_path, run_async, review
):
    port, _, _, offered = review
    requests = []

    async def decide(*_):
        requests.append(True)
        return choose()

    module, bridge, controller = setup(framework_module, tmp_path, decide)
    controller.review_port = port
    controller.settings = dataclasses.replace(
        controller.settings, review_model_pool=POOL, max_tool_rounds=1
    )
    original_call = bridge.call

    async def call(name, arguments, **kwargs):
        if name == "mc_protocol" and arguments.get("action") == "facts":
            port.begin_model_inference(offered["id"], POOL)
        return await original_call(name, arguments, **kwargs)

    bridge.call = call
    result = run_async(
        controller.turn_once("survive", "contract", module.model_tools(bridge.tools))
    )
    assert result is False and not requests and controller.continuation_needed
    assert [
        args["action"] for name, args, _ in bridge.calls if name == "mc_protocol"
    ] == ["begin_turn", "facts", "end_turn"]


def test_window_requires_real_inspection_and_ignores_malformed_state(review):
    port, clock, _, offered = review
    with port.transaction() as state:
        state["review"].pop("inspected_at")
    assert port.begin_model_inference(offered["id"], POOL) is None
    port.decide(offered["id"], "inspect")
    window = port.begin_model_inference(offered["id"], POOL)
    assert port.begin_model_inference(offered["id"], POOL) is None
    with port.transaction() as state:
        state["model_inference_window"]["expires_at"] = float("inf")
    assert port.model_inference_window(POOL) is None
    assert port.state()["model_inference_window"]["id"] == window["id"]


def test_inspected_window_cannot_be_granted_after_an_uninspected_world_switch(review):
    port, _, _, offered = review
    path = port.directory / "status.json"
    value = json.loads(path.read_text("utf-8"))
    value["game_identity"] = {"realm": "other", "account": "bot", "agent": "player"}
    path.write_text(json.dumps(value), encoding="utf-8")
    assert port.begin_model_inference(offered["id"], POOL) is None
    assert not port.mailbox.ready()

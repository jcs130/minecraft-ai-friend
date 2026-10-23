import dataclasses
import json
from types import SimpleNamespace

import pytest
from test_controller import choose, setup
from test_shared_information import MESSAGES


def invoke(name, arguments):
    return {
        "id": "query",
        "type": "function",
        "function": {
            "name": "mc_invoke",
            "arguments": json.dumps({"name": name, "arguments": arguments}),
        },
    }


def mixed_tools(bridge):
    bridge.tools.extend(
        [
            {
                "name": name,
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "unload" if name == "mc_blueprint" else "drop": {
                            "type": "string"
                        }
                    },
                    "additionalProperties": False,
                },
                "_meta": {"agent-mc/v1": {"tags": ["write"]}},
            }
            for name in ("mc_blueprint", "mc_map")
        ]
    )


@pytest.mark.parametrize(
    "arguments",
    [
        {},
        {"action": "list"},
        {"action": "search", "query": "commission", "limit": 15},
        {"action": "read", "id": "message_42"},
        {"id": "message_42"},
    ],
)
def test_feedback_can_read_mixed_tag_message_tool_before_body_plan(
    framework_module, tmp_path, run_async, arguments
):
    module, bridge, controller = setup(framework_module, tmp_path, None)
    bridge.tools.append(MESSAGES)
    controller.feedback_pending = True
    original = bridge.call

    async def call(name, args, **metadata):
        if name == "mc_messages":
            bridge.calls.append((name, args, metadata))
            return {
                "structuredContent": {
                    "protocol": "agent-mc/v1",
                    "text": "dated server commission instructions",
                }
            }
        return await original(name, args, **metadata)

    bridge.call = call
    query = {
        "id": "message-query",
        "type": "function",
        "function": {"name": "mc_messages", "arguments": json.dumps(arguments)},
    }
    _, name, args = controller.prepare_call([query], module.model_tools(bridge.tools))
    result, _, _ = run_async(controller.execute_model_call(name, args))
    assert not result.get("failed") and controller.read_activity == {"mc_messages": 1}
    assert bridge.calls[-1][1] == arguments
    assert (
        controller.feedback_pending
        and not controller.pending
        and not controller.native_outcomes
    )


@pytest.mark.parametrize(
    "arguments,tags",
    [
        ({"action": "review", "ids": ["message_42"]}, ["read", "write"]),
        ({"action": "delete"}, ["read", "write"]),
        ({"action": "list"}, ["read", "write", "act"]),
        ({"action": "list"}, ["read", "write", "speak"]),
    ],
)
def test_feedback_message_read_exception_keeps_writes_and_effects_blocked(
    framework_module, tmp_path, arguments, tags
):
    from copy import deepcopy

    module, bridge, controller = setup(framework_module, tmp_path, None)
    tool = deepcopy(MESSAGES)
    tool["_meta"]["agent-mc/v1"]["tags"] = tags
    bridge.tools.append(tool)
    controller.feedback_pending = True
    call = {
        "id": "message-query",
        "type": "function",
        "function": {"name": "mc_messages", "arguments": json.dumps(arguments)},
    }
    with pytest.raises(module.ModelCallRejected):
        controller.prepare_call([call], module.model_tools(bridge.tools))
    assert controller.feedback_pending and not bridge.calls


@pytest.mark.parametrize("name", ["mc_blueprint", "mc_map"])
def test_pending_feedback_empty_catalogue_read_dispatches_without_consuming_plan(
    framework_module, tmp_path, run_async, name
):
    module, bridge, controller = setup(framework_module, tmp_path, None)
    mixed_tools(bridge)
    controller.feedback_pending = True
    controller.tool_failure = {
        "tool": "mc_do",
        "error": "actual body failure",
        "native_execution": {"id": "failed", "phase": "blocked"},
    }
    original = bridge.call

    async def call(tool, arguments, **metadata):
        if tool == name:
            bridge.calls.append((tool, arguments, metadata))
            return {
                "structuredContent": {
                    "protocol": "agent-mc/v1",
                    "text": "catalogue only",
                }
            }
        return await original(tool, arguments, **metadata)

    bridge.call = call
    _, tool, args = controller.prepare_call(
        [invoke(name, {})], module.model_tools(bridge.tools)
    )
    result, _, _ = run_async(controller.execute_model_call(tool, args))
    assert not result.get("failed") and controller.read_activity[name] == 1
    assert controller.feedback_pending and not controller.pending
    assert controller.tool_failure["native_execution"]["id"] == "failed"
    assert len([row for row in bridge.calls if row[0] == name]) == 1
    assert not json.loads(controller.state_path.read_text())["uncertain"]


@pytest.mark.parametrize(
    "name, arguments",
    [
        ("mc_blueprint", {"unload": "old"}),
        ("mc_map", {"drop": "old"}),
        ("mc_blueprint", {"action": "list"}),
        ("mc_map", {"action": "list"}),
        ("mc_other_write", {}),
    ],
)
def test_empty_query_exception_never_admits_writes_or_malformed_operations(
    framework_module, tmp_path, name, arguments
):
    module, bridge, controller = setup(framework_module, tmp_path, None)
    mixed_tools(bridge)
    bridge.tools.append(
        {
            "name": "mc_other_write",
            "inputSchema": {"type": "object"},
            "_meta": {"agent-mc/v1": {"tags": ["write"]}},
        }
    )
    controller.feedback_pending = True
    with pytest.raises(module.ModelCallRejected):
        controller.prepare_call(
            [invoke(name, arguments)], module.model_tools(bridge.tools)
        )
    assert (
        controller.feedback_pending
        and bridge.calls == []
        and controller.inflight_request is None
    )


def test_empty_query_still_requires_the_discovered_schema(framework_module, tmp_path):
    module, bridge, controller = setup(framework_module, tmp_path, None)
    mixed_tools(bridge)
    bridge.tools[-1]["inputSchema"]["required"] = ["drop"]
    controller.feedback_pending = True
    with pytest.raises(module.ModelCallRejected, match="drop"):
        controller.prepare_call(
            [invoke("mc_map", {})], module.model_tools(bridge.tools)
        )
    assert not bridge.calls


def test_query_exception_preserves_unknown_receipt_barrier(
    framework_module, tmp_path, run_async
):
    module, bridge, controller = setup(framework_module, tmp_path, None)
    mixed_tools(bridge)
    controller.feedback_pending = True
    original = bridge.call

    async def call(name, arguments, **metadata):
        if name == "mc_blueprint":
            return {"content": [{"type": "text", "text": "unstructured"}]}
        return await original(name, arguments, **metadata)

    bridge.call = call
    _, name, args = controller.prepare_call(
        [invoke("mc_blueprint", {})], module.model_tools(bridge.tools)
    )
    with pytest.raises(RuntimeError, match="outcome_unknown"):
        run_async(controller.execute_model_call(name, args))
    assert (
        controller.feedback_pending
        and json.loads(controller.state_path.read_text())["uncertain"]
    )


def test_reject_then_valid_query_publishes_zero_and_feasible_correction(
    framework_module, tmp_path, run_async
):
    seen, status = [], {}

    async def decide(messages, _):
        seen.append(messages)
        return {
            "tool_calls": [
                invoke("mc_blueprint", {"unload": "old"} if len(seen) == 1 else {})
            ]
        }

    module, bridge, controller = setup(framework_module, tmp_path, decide)
    mixed_tools(bridge)
    controller.settings = dataclasses.replace(controller.settings, max_tool_rounds=1)
    controller.active_goal = {
        "id": "feedback",
        "goal": "Find a feasible next action",
        "mode": "insert",
        "origin": "user",
    }
    controller.feedback_pending = True
    controller.publish = lambda **value: status.update(value)
    original = bridge.call

    async def call(name, arguments, **metadata):
        if name == "mc_blueprint":
            bridge.calls.append((name, arguments, metadata))
            return {
                "structuredContent": {
                    "protocol": "agent-mc/v1",
                    "text": "catalogue only",
                }
            }
        return await original(name, arguments, **metadata)

    bridge.call = call
    tools = module.model_tools(bridge.tools)
    run_async(controller.turn_once("survive", "prefix", tools))
    assert status["invalid_tool_calls"] == 1 and not any(
        row[0] == "mc_blueprint" for row in bridge.calls
    )
    run_async(controller.turn_once("survive", "prefix", tools))
    assert status["invalid_tool_calls"] == 0 and controller.feedback_pending
    assert (
        "mc_blueprint({})" in seen[1][-1]["content"]
        and "mc_do" in seen[1][-1]["content"]
    )
    assert "No tool was dispatched" in seen[1][-1]["content"]


def test_mc_do_remains_the_feedback_body_plan(framework_module, tmp_path, run_async):
    module, bridge, controller = setup(framework_module, tmp_path, None)
    consumed = []
    controller.feedback_pending = True
    controller.active_goal = {"id": "feedback-goal", "mode": "insert"}
    controller.commands = SimpleNamespace(consume_queue_policy=consumed.append)
    _, name, args = controller.prepare_call(
        choose()["tool_calls"], module.model_tools(bridge.tools)
    )
    run_async(controller.execute_model_call(name, args))
    assert consumed == ["feedback-goal"] and not controller.feedback_pending
    assert (
        next(row[1]["queue"] for row in bridge.calls if row[0] == "mc_do")
        == "afterCheckpoint"
    )

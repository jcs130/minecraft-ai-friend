"""Live planner batches must not lose pure reads behind a mixed tool name."""
import json

import pytest
from test_controller import choose, setup

READS = [
    ("mc_script", {"api": "mc.state"}),
    ("mc_script", {"runId": 9}),
    ("mc_script", {"runId": 9, "call": 1}),
    ("mc_script", {}),
    ("mc_memory", {"action": "search", "query": "route", "limit": 3}),
    ("mc_memory", {"action": "get", "id": "note-1"}),
    ("mc_memory", {"action": "help", "topic": "search"}),
    ("mc_observe", {"mode": "rays", "rays": [[0, 0]]}),
    ("mc_check", {"checks": []}),
    ("mc_map", {}),
    ("mc_blueprint", {}),
]


def call(identifier, name, arguments):
    return {"id": identifier, "type": "function", "function": {
        "name": "mc_invoke", "arguments": json.dumps({"name": name, "arguments": arguments})}}


def advertise(bridge, names):
    bridge.tools.extend({"name": name, "inputSchema": {"type": "object"},
                         "_meta": {"agent-mc/v1": {"tags": ["read", "write", "act"]}}}
                        for name in set(names))


@pytest.mark.parametrize("name,arguments", READS)
def test_original_read_then_body_batch_is_admitted_without_a_correction_turn(
        framework_module, tmp_path, name, arguments):
    module, bridge, controller = setup(framework_module, tmp_path, None)
    advertise(bridge, [name])
    calls = [call("read", name, arguments), choose()["tool_calls"][0]]
    prepared = controller.prepare_calls(calls, module.model_tools(bridge.tools))
    assert [(n, a) for _, n, a in prepared] == [(name, arguments), ("mc_do", {"steps": []})]


def test_two_real_script_api_reads_share_one_response(framework_module, tmp_path):
    module, bridge, controller = setup(framework_module, tmp_path, None)
    advertise(bridge, ["mc_script"])
    calls = [call("state", "mc_script", {"api": "mc.state"}),
             call("actions", "mc_script", {"api": "mc.do"})]
    assert len(controller.prepare_calls(calls, module.model_tools(bridge.tools))) == 2


@pytest.mark.parametrize("name,arguments", [
    ("mc_script", {"api": "mc.state", "code": "await mc.do([])"}),
    ("mc_script", {"runId": 9, "stop": True}),
    ("mc_script", {"runId": 9, "waitMs": 1000}),
    ("mc_script", {"find": {"names": ["water"]}}),
    ("mc_script", {"validate": True, "code": "return 1"}),
    ("mc_script", {"library": {"op": "save"}}),
    ("mc_script", {"routine": {"op": "run", "id": "farm_harvest"}}),
    ("mc_memory", {"action": "remember", "summary": "new note"}),
    ("mc_memory", {"action": "search", "content": "write payload"}),
    ("mc_memory", {"action": "service", "operation": "reflect"}),
    ("mc_memory", {"action": ["search"]}),
    ("mc_map", {"name": "home"}),
    ("mc_blueprint", {"save": {}}),
])
def test_mixed_or_executing_forms_still_cannot_precede_another_call(
        framework_module, tmp_path, name, arguments):
    module, bridge, controller = setup(framework_module, tmp_path, None)
    advertise(bridge, [name])
    with pytest.raises(module.ModelCallRejected):
        controller.prepare_calls([call("first", name, arguments), choose()["tool_calls"][0]],
                                 module.model_tools(bridge.tools))
    assert not bridge.calls


@pytest.mark.parametrize("boundary", ["none", "failed", "end", "stop", "queued"])
def test_validated_read_batch_keeps_native_barriers_and_original_receipts(
        framework_module, tmp_path, run_async, boundary):
    stopped = False
    response = choose()
    response["tool_calls"].insert(0, call("read", "mc_script", {"api": "mc.state"}))

    async def decide(*_):
        return response

    module, bridge, controller = setup(framework_module, tmp_path, decide, lambda: stopped)
    advertise(bridge, ["mc_script"])
    original = bridge.call

    async def dispatch(name, arguments, **metadata):
        nonlocal stopped
        if name != "mc_script":
            return await original(name, arguments, **metadata)
        bridge.calls.append((name, arguments, metadata))
        stopped = boundary == "stop"
        result = {"protocol": "agent-mc/v1", "text": "Original SDK read contract",
                  "failed": boundary == "failed", "endsTurn": boundary == "end"}
        if boundary == "queued":
            result["execution"] = {"kind": "method", "id": "unexpected-native-task",
                                   "phase": "accepted", "terminal": False, "goalCompleted": False}
        return {"structuredContent": result}

    bridge.call = dispatch
    run_async(controller.turn_once("survive", "prefix", module.model_tools(bridge.tools)))
    observed = [name for name, *_ in bridge.calls if name in {"mc_script", "mc_do"}]
    assert observed == (["mc_script", "mc_do"] if boundary == "none" else ["mc_script"])
    exchange = controller.groups[-1]
    assert [x["tool_call_id"] for x in exchange if x["role"] == "tool"] == ["read", "call-1"]
    if boundary != "none":
        assert json.loads(exchange[-1]["content"])["dispatched"] is False
    assert controller.read_activity.get("mc_script", 0) == (0 if boundary == "failed" else 1)


@pytest.mark.parametrize("name,arguments", READS)
def test_pure_read_can_resolve_missing_prerequisite_for_pending_feedback(
        framework_module, tmp_path, name, arguments):
    module, bridge, controller = setup(framework_module, tmp_path, None)
    advertise(bridge, [name])
    controller.feedback_pending = True
    prepared = controller.prepare_calls([call("read", name, arguments)], module.model_tools(bridge.tools))
    assert prepared[0][1:] == (name, arguments)


@pytest.mark.parametrize("name,arguments", [("mc_script", {"code": "return 1"}),
                                           ("mc_memory", {"action": "remember", "summary": "a note"})])
def test_pending_feedback_still_blocks_script_execution_and_metadata_writes(
        framework_module, tmp_path, name, arguments):
    module, bridge, controller = setup(framework_module, tmp_path, None)
    advertise(bridge, [name])
    controller.feedback_pending = True
    with pytest.raises(module.ModelCallRejected, match="Pending feedback"):
        controller.prepare_calls([call("write", name, arguments)], module.model_tools(bridge.tools))

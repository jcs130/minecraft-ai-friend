import importlib
import json

import pytest


def query_tool():
    return {
        "name": "mc_query",
        "description": "Only declared read-only server queries; sent is not completed.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "minLength": 1},
                "arguments": {"type": "array", "items": {"type": "string"}},
                "requestId": {"type": "string", "minLength": 1},
            },
            "additionalProperties": False,
        },
        "_meta": {"agent-mc/v1": {"tags": ["read"]}},
    }


@pytest.mark.parametrize("mode", ["compact", "full"])
def test_declared_server_query_is_direct_and_keeps_native_schema(framework_module, mode):
    module = importlib.import_module("agent_mc_autonomy.controller")
    declaration = query_tool()
    tools = {t["function"]["name"]: t["function"]
             for t in module.model_tools([declaration], context_mode=mode)}
    assert tools["mc_query"]["parameters"] == declaration["inputSchema"]
    assert "sent is not completed" in tools["mc_query"]["description"]
    assert "mc_query" not in {t["function"]["name"] for t in module.model_tools([])}


def test_declared_server_query_can_precede_an_appended_plan_during_navigation(
    framework_module, tmp_path
):
    from test_controller import setup

    module, bridge, controller = setup(framework_module, tmp_path, None)
    bridge.tools.append(query_tool())
    controller.lookahead_anchor = {"task": "running-route"}
    controller.feedback_pending = True
    calls = [
        {"id": "query", "type": "function", "function": {
            "name": "mc_query", "arguments": json.dumps({"query": "declared-status"})}},
        {"id": "plan", "type": "function", "function": {
            "name": "mc_do", "arguments": json.dumps({"steps": [], "queue": "append"})}},
    ]
    prepared = controller.prepare_calls(calls, module.model_tools(bridge.tools, context_mode="full"))
    assert [(name, args) for _, name, args in prepared] == [
        ("mc_query", {"query": "declared-status"}), ("mc_do", {"steps": [], "queue": "append"})]
    assert module.observation_call("mc_query", {"query": "declared-status"})
    assert "mc_query" not in module.REUSABLE_IMMEDIATE_READS
    assert bridge.calls == []
    # The new read classification does not grant body interruption or arbitrary commands.
    calls[1]["function"]["arguments"] = json.dumps({"steps": [], "queue": "now"})
    with pytest.raises(module.ModelCallRejected, match="Planning ahead"):
        controller.prepare_calls(calls, module.model_tools(bridge.tools, context_mode="full"))
    calls[0]["function"]["arguments"] = json.dumps({"command": "/arbitrary"})
    with pytest.raises(module.ModelCallRejected):
        controller.prepare_calls(calls[:1], module.model_tools(bridge.tools, context_mode="full"))


def test_query_receipt_stays_a_read_without_creating_native_work(
    framework_module, tmp_path, run_async
):
    from test_controller import setup

    module, bridge, controller = setup(framework_module, tmp_path, None)
    bridge.tools.append(query_tool())
    original_call = bridge.call

    async def call(name, args, **kwargs):
        if name == "mc_query":
            bridge.calls.append((name, args, kwargs))
            return {"structuredContent": {
                "protocol": "agent-mc/v1", "text": "sent, awaiting server reply",
                "data": {"requestId": "query-1", "phase": "sent", "goal_completed": False},
            }}
        return await original_call(name, args, **kwargs)

    bridge.call = call
    result, _, _ = run_async(controller.execute_model_call("mc_query", {"query": "declared-status"}))
    assert result["data"]["phase"] == "sent"
    assert result.get("execution") is None
    assert controller.pending == {}
    assert controller.inflight_request is None
    assert controller.read_activity["mc_query"] == 1
    assert not any(name in {"mc_do", "mc_stop", "mc_escape"} for name, _, _ in bridge.calls)

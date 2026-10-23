"""Rejected evidence stays visible without promoting malformed wire examples."""
import copy
import json

import pytest
from test_controller import choose, setup


@pytest.mark.parametrize("function", [
    {"name": "mc_life", "arguments": "{}"},
    {"name": "mc_do", "arguments": '{"steps":"invalid"}'},
    {"name": "mc_do", "arguments": "{"},
])
def test_rejected_call_and_exact_failure_survive_into_next_request(framework_module, tmp_path, run_async, function):
    invalid = choose()
    invalid["tool_calls"][0]["function"] = function
    original = copy.deepcopy(invalid)
    seen = []
    async def decide(messages, _):
        seen.append(copy.deepcopy(messages))
        return invalid if len(seen) == 1 else choose()
    module, bridge, controller = setup(framework_module, tmp_path, decide)
    next(tool for tool in bridge.tools if tool["name"] == "mc_do")["inputSchema"] = {
        "type": "object", "properties": {"steps": {"type": "array"}}}
    tools = module.model_tools(bridge.tools)
    run_async(controller.turn_once("survive", "prefix", tools))
    assert not any(name == "mc_do" for name, *_ in bridge.calls)
    run_async(controller.turn_once("survive", "prefix", tools))
    if function['arguments'] == '{':
        assert not any(m.get('tool_calls') or m.get('tool_call_id') for m in seen[1])
        failure = next(json.loads(m['content'])['rejected_model_call'] for m in seen[1]
                       if m['role'] == 'user' and 'rejected_model_call' in m.get('content', ''))
        assert failure['dispatched'] is False and 'column' in failure['error']
        records = [json.loads(line) for line in (tmp_path/'decisions.jsonl').read_text(encoding='utf-8').splitlines()]
        assert records[0]['response'] == original
    else:
        previous = next(m for m in seen[1] if m.get("tool_calls"))
        assert previous["tool_calls"] == original["tool_calls"]
        failure = next(m for m in seen[1] if m.get("tool_call_id") == "call-1")
        receipt = json.loads(failure["content"])
        assert receipt["dispatched"] is False and receipt["failed"] is True
        assert receipt["origin"] == "controller_validation" and receipt["text"]
    assert invalid == original
    assert sum(name == "mc_do" for name, *_ in bridge.calls) == 1


def test_malformed_whole_batch_stays_archived_without_dispatch_or_wire_replay(framework_module, tmp_path, run_async):
    response = choose()
    response["tool_calls"].insert(0, {"id": "read", "type": "function", "function": {"name": "mc_help", "arguments": "{}"}})
    response["tool_calls"][1]["function"]["arguments"] = "{"
    async def decide(*_):
        return response
    module, bridge, controller = setup(framework_module, tmp_path, decide)
    bridge.tools.append({"name": "mc_help", "inputSchema": {"type": "object"}})
    run_async(controller.turn_once("survive", "prefix", module.model_tools(bridge.tools)))
    exchange = controller.groups[-1]
    assert len(exchange) == 1 and exchange[0]['role'] == 'user'
    assert json.loads(exchange[0]['content'])['rejected_model_call']['dispatched'] is False
    records = [json.loads(line) for line in (tmp_path/'decisions.jsonl').read_text(encoding='utf-8').splitlines()]
    assert records[0]['response'] == response
    assert not any(name in {"mc_help", "mc_do"} for name, *_ in bridge.calls)


@pytest.mark.parametrize("fault", ["duplicate_id", "empty_id", "missing_name", "nonstring_arguments"])
def test_malformed_envelopes_do_not_poison_history_protocol(framework_module, tmp_path, run_async, fault):
    response = choose()
    call = response["tool_calls"][0]
    if fault == "duplicate_id":
        response["tool_calls"].append(copy.deepcopy(call))
    elif fault == "empty_id":
        call["id"] = ""
    elif fault == "missing_name":
        call["function"]["name"] = None
    else:
        call["function"]["arguments"] = {}
    async def decide(*_):
        return response
    module, bridge, controller = setup(framework_module, tmp_path, decide)
    run_async(controller.turn_once("survive", "prefix", module.model_tools(bridge.tools)))
    assert controller.groups == []
    records = [json.loads(line) for line in (tmp_path / "decisions.jsonl").read_text().splitlines()]
    assert records[0]["response"] == response and records[1]["dispatched"] is False
    assert not any(name == "mc_do" for name, *_ in bridge.calls)

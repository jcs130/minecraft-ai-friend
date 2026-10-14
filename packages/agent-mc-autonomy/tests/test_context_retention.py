"""Keep complete recent exchanges when the actual dynamic tail leaves room."""
import copy
import json

import pytest

from agent_mc_autonomy.context import assemble, encode


def exchange(index, text_size=1800, name="mc_help"):
    call_id = f"call-{index}"
    return [{"role": "assistant", "content": None, "tool_calls": [{
        "id": call_id, "type": "function", "function": {
            "name": name, "arguments": encode({"skill": f"skill-{index}"})}}]},
        {"role": "tool", "tool_call_id": call_id, "content": encode({"text": str(index) * text_size})}]


def exact_cost(messages, tools, output=2048):
    return len(encode({"messages": messages, "tools": tools}).encode()) + output + 1024


@pytest.mark.parametrize("last_task", [None, "这一场还没有跑完过任何一单。", "Task completed; query original for evidence."])
def test_unused_fact_reserve_keeps_complete_history(last_task):
    prefix, tools = "stable-" + "p" * 8000, []
    facts = {"parts": [{"key": "body", "text": "health 20/20"}, {"key": "place", "text": "f" * 900}]}
    if last_task:
        facts["parts"].append({"key": "lastTask", "text": last_task, "original": "log:terminal"})
    groups = [exchange(1), exchange(2), exchange(3)]
    events = [{"run": "run", "cursor": 7, "type": "chat", "text": "An external observation"}]
    before = copy.deepcopy((facts, groups, events))
    empty, _ = assemble(prefix, tools, "survive", facts, events, [], context_tokens=65536, reserved_output=2048)
    full = empty[:2] + [message for group in groups for message in group] + empty[-1:]
    limit = exact_cost(full, tools) + 80
    messages, budget = assemble(prefix, tools, "survive", facts, events, groups,
                                context_tokens=limit, reserved_output=2048)
    assert messages == full
    assert budget["total"] == exact_cost(messages, tools) <= limit
    assert (facts, groups, events) == before


def test_backfill_never_splits_an_exchange_or_exceeds_actual_bound():
    prefix, tools = "stable-" + "p" * 8000, []
    facts = {"parts": [{"key": "body", "text": "health 20/20"},
                       {"key": "lastTask", "text": "No task completed yet."}]}
    groups = [exchange(1, 7000), exchange(2, 1900), exchange(3, 1900)]
    empty, _ = assemble(prefix, tools, "survive", facts, [], [], context_tokens=65536, reserved_output=2048)
    expected = empty[:2] + groups[1] + groups[2] + empty[-1:]
    limit = exact_cost(expected, tools) + 20
    messages, budget = assemble(prefix, tools, "survive", facts, [], groups,
                                context_tokens=limit, reserved_output=2048)
    assert messages == expected
    assert budget["total"] <= limit
    assert [call["id"] for message in messages for call in message.get("tool_calls", [])] == ["call-2", "call-3"]
    assert [message["tool_call_id"] for message in messages if message["role"] == "tool"] == ["call-2", "call-3"]
    assert json.loads(messages[-1]["content"])["current_facts"] == facts["parts"]

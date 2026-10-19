"""Optional provider hints preserve original messages and fresh facts."""

import copy

import pytest

from agent_mc_autonomy.model_config import HttpPlannerConfig
from agent_mc_autonomy.model_protocols import request


def config(**fields):
    return HttpPlannerConfig.parse({"base_url": "http://127.0.0.1:8000/v1", "model": "chosen",
                                   "auth": {"mode": "none"}, **fields})


def test_changed_facts_keep_checkpointed_tool_history_and_originals():
    history = [{"role": "system", "content": "identity"},
               {"role": "assistant", "content": None, "tool_calls": [
                   {"id": "call_1", "type": "function", "function": {"name": "observe", "arguments": "{}"}}]},
               {"role": "tool", "tool_call_id": "call_1", "content": "complete original receipt"}]
    original = copy.deepcopy(history)
    wires = [request(config(cache_strategy="ninfer"), history + [{"role": "user", "content": facts}], [], 2048)[1]
             for facts in ["fresh hunger=3", "fresh hunger=18"]]
    assert wires[0]["messages"][:-1] == wires[1]["messages"][:-1]
    checkpoint = wires[0]["messages"][-2]
    assert checkpoint["role"] == "tool" and checkpoint["tool_call_id"] == "call_1"
    assert checkpoint["content"] == [{"type": "text", "text": "complete original receipt",
                                      "prompt_cache_breakpoint": {"mode": "explicit"}}]
    assert wires[1]["messages"][-1] == {"role": "user", "content": "fresh hunger=18"}
    assert 'prompt_cache_key' not in wires[0] and 'prompt_cache_key' not in wires[1]
    assert history == original


def test_growing_history_repeats_stable_boundaries_without_caching_replaced_facts():
    history = [{'role': 'system', 'content': 'immutable identity'}]
    for index in range(8):
        history.extend([{'role': 'assistant', 'content': None},
                        {'role': 'tool', 'tool_call_id': str(index), 'content': f'original receipt {index}'}])
    before = copy.deepcopy(history)
    first = request(config(cache_strategy='ninfer'), history + [{'role': 'user', 'content': 'replaced scene A'}], [], 2048)[1]
    second = request(config(cache_strategy='ninfer'), history + [
        {'role': 'assistant', 'content': None}, {'role': 'tool', 'tool_call_id': '8', 'content': 'original receipt 8'},
        {'role': 'user', 'content': 'replaced scene B'}], [], 2048)[1]

    def marked(body):
        return [part['text'] for row in body['messages'] for part in row.get('content') or []
                if isinstance(part, dict) and part.get('prompt_cache_breakpoint')]

    assert marked(first) == ['immutable identity', 'original receipt 5', 'original receipt 6', 'original receipt 7']
    assert marked(second) == ['immutable identity', 'original receipt 6', 'original receipt 7', 'original receipt 8']
    assert first['prompt_cache_options'] == second['prompt_cache_options'] == {'mode': 'explicit'}
    assert 'prompt_cache_key' not in first and 'prompt_cache_key' not in second
    assert first['messages'][-1]['content'] == 'replaced scene A'
    assert second['messages'][-1]['content'] == 'replaced scene B'
    assert history == before


def test_defaults_and_explicit_chat_key_do_not_add_vendor_markers():
    messages = [{"role": "system", "content": "identity"}, {"role": "user", "content": "fresh"}]
    normal = request(config(), messages, [], 2048)[1]
    keyed = request(config(parameters={"prompt_cache_key": "selected-session"}), messages, [], 2048)[1]
    assert normal["messages"] == keyed["messages"] == messages
    assert "prompt_cache_key" not in normal and keyed["prompt_cache_key"] == "selected-session"


def test_tool_only_history_keeps_supported_checkpoint_hints():
    messages = [{'role': 'assistant', 'content': None},
                {'role': 'tool', 'tool_call_id': 'c', 'content': 'complete original tool result'}]
    wire = request(config(cache_strategy='ninfer'), messages, [], 2048)[1]
    assert wire['messages'][-1]['content'][0]['prompt_cache_breakpoint'] == {'mode': 'explicit'}


def test_images_and_empty_assistant_remain_intact_without_marking_current_scene():
    messages = [{"role": "system", "content": [{"type": "text", "text": "identity"}]},
                {"role": "assistant", "content": None},
                {"role": "user", "content": [{"type": "text", "text": "fresh"},
                     {"type": "image_url", "image_url": {"url": "data:image/png;base64,YQ=="}}]}]
    original = copy.deepcopy(messages)
    wire = request(config(cache_strategy="ninfer", parameters={"prompt_cache_key": "private"}), messages, [], 2048)[1]
    assert wire["messages"][-1] == messages[-1] and wire["messages"][1]["content"] is None
    assert wire["messages"][0]["content"][0]["prompt_cache_breakpoint"] == {"mode": "explicit"}
    assert wire["prompt_cache_key"] == "private" and messages == original


@pytest.mark.parametrize("strategy", [True, {}, "auto", ""])
def test_unknown_cache_strategy_is_rejected(strategy):
    with pytest.raises(ValueError, match="cache_strategy"):
        config(cache_strategy=strategy)


def test_ninfer_strategy_cannot_leak_into_other_protocols():
    with pytest.raises(ValueError, match="requires_chat"):
        config(protocol="responses", cache_strategy="ninfer")

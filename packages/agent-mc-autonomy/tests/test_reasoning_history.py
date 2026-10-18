"""Explicit Chat-only replay policy without losing a current tool continuation."""

import copy
from dataclasses import replace

import pytest

from agent_mc_autonomy.model_config import HttpPlannerConfig
from agent_mc_autonomy.model_protocols import request, scope


def config(**changes):
    return HttpPlannerConfig.parse(
        {"base_url": "http://localhost:1/v1", "model": "fixture", "auth": {"mode": "none"}, **changes}
    )


def assistant(cfg, text, reasoning):
    return {"role": "assistant", "content": text,
            "_provider_state": {"scope": scope(cfg), "data": {"reasoning_content": reasoning}}}


def messages(cfg):
    call = {"id": "call-1", "type": "function", "function": {"name": "read", "arguments": "{}"}}
    current = {**assistant(cfg, None, "current reasoning"), "tool_calls": [call]}
    return [{"role": "user", "content": "old"}, assistant(cfg, "old answer", "old reasoning"),
            {"role": "user", "content": [{"type": "text", "text": "new"}]}, current,
            {"role": "tool", "tool_call_id": "call-1", "content": "original result"}]


def test_current_turn_omits_only_completed_reasoning_and_keeps_tool_continuation():
    cfg = config(reasoning_history="current_turn")
    original = messages(cfg)
    unchanged = copy.deepcopy(original)
    body = request(cfg, original, [], 1024)[1]
    assert "reasoning_content" not in body["messages"][1]
    assert body["messages"][3]["reasoning_content"] == "current reasoning"
    assert body["messages"][3]["tool_calls"] == original[3]["tool_calls"]
    assert body["messages"][-1] == original[-1]
    assert original == unchanged
    assert "reasoning_history" not in body


def test_all_is_the_unchanged_default_and_other_wire_fields_remain_exact():
    cfg = config()
    original = messages(cfg)
    default = request(cfg, original, [], 1024)[1]
    explicit = request(replace(cfg, reasoning_history="all"), original, [], 1024)[1]
    reduced = request(replace(cfg, reasoning_history="current_turn"), original, [], 1024)[1]
    assert default == explicit
    assert default["messages"][1]["reasoning_content"] == "old reasoning"
    del default["messages"][1]["reasoning_content"]
    assert reduced == default


def test_fresh_user_tail_omits_past_reasoning_but_keeps_all_conversation_and_results():
    cfg = config(reasoning_history="current_turn")
    original = messages(cfg) + [{"role": "user", "content": "fresh actual facts"}]
    body = request(cfg, original, [], 1024)[1]
    assert all("reasoning_content" not in row for row in body["messages"])
    assert [row.get("content") for row in body["messages"]] == [row.get("content") for row in original]
    assert len(body["messages"]) == len(original)


def test_no_user_boundary_preserves_available_current_reasoning():
    cfg = config(reasoning_history="current_turn")
    body = request(cfg, [assistant(cfg, "answer", "current reasoning")], [], 1024)[1]
    assert body["messages"][0]["reasoning_content"] == "current reasoning"


def test_foreign_provider_state_is_never_replayed_under_either_policy():
    cfg = config(reasoning_history="current_turn")
    original = messages(cfg)
    original[3]["_provider_state"]["scope"] = "foreign-provider"
    for policy in ("all", "current_turn"):
        body = request(replace(cfg, reasoning_history=policy), original, [], 1024)[1]
        assert "reasoning_content" not in body["messages"][3]


@pytest.mark.parametrize("value", [None, False, 1, [], {}, "none", "ALL"])
def test_invalid_replay_policy_is_rejected(value):
    with pytest.raises(ValueError, match="reasoning_history"):
        config(reasoning_history=value)


@pytest.mark.parametrize("protocol", ["responses", "anthropic", "gemini"])
def test_opt_in_cannot_strip_signed_or_other_native_protocol_replay(protocol):
    with pytest.raises(ValueError, match="reasoning_history"):
        config(protocol=protocol, reasoning_history="current_turn")
    assert config(protocol=protocol).reasoning_history == "all"


def test_direct_dataclass_construction_cannot_bypass_budget_admission():
    with pytest.raises(ValueError, match="reasoning_history"):
        replace(config(), reasoning_history="invalid").validate_budget(1024)

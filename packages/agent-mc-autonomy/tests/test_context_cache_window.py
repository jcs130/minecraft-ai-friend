"""Exercise full-window retirement at the real controller request boundary."""
import copy
import dataclasses
import json

import pytest
from test_controller import setup

from agent_mc_autonomy.configuration import Settings, SettingsValidationError
from agent_mc_autonomy.context import assemble, encode


def exchange(index, size=1800):
    return [
        {"role": "assistant", "content": None, "tool_calls": [{
            "id": f"call-{index}", "type": "function",
            "function": {"name": "mc_bag", "arguments": "{}"}}]},
        {"role": "tool", "tool_call_id": f"call-{index}",
         "content": f"Original inventory receipt {index}: " + "x" * size},
    ]


def test_full_window_retires_only_complete_evicted_groups_at_controller_seam(
        framework_module, tmp_path, run_async):
    captured = []

    async def decide(messages, _):
        captured.append(copy.deepcopy(messages))
        return {"content": "Waiting for a meaningful event", "tool_calls": []}

    module, bridge, controller = setup(framework_module, tmp_path, decide)
    controller.settings = dataclasses.replace(controller.settings, context_mode="full", context_tokens=131072)
    original = [exchange(i) for i in range(64)]
    controller.groups = copy.deepcopy(original)
    run_async(controller.turn_once("survive", "stable", module.model_tools(bridge.tools)))
    shown = [m["tool_call_id"] for m in captured[0] if m["role"] == "tool"]
    assert 0 < len(shown) < len(original), "fixture must exceed the actual request window"
    assert controller.groups[:-1] == original[-len(shown):]
    assert controller.groups[-1] == [{"role": "assistant", "content": "Waiting for a meaningful event"}]
    assert all(len(group) == 2 for group in controller.groups[:-1])
    assert original[0][1]["content"].endswith("x" * 1800)
    assert bridge.calls and all(name in {"mc_protocol", "mc_events"} for name, _, _ in bridge.calls)


def test_opt_in_batch_retirement_keeps_the_next_small_exchanges_cacheable(
        framework_module, tmp_path, run_async):
    captured, diagnostics = [], []

    async def decide(messages, _):
        captured.append(copy.deepcopy(messages))
        return {"content": "Waiting", "tool_calls": []}

    module, bridge, controller = setup(framework_module, tmp_path, decide)
    controller.settings = dataclasses.replace(controller.settings, context_mode="full", context_tokens=131072,
                                             context_history_headroom_tokens=8192)
    controller.publish = lambda **row: diagnostics.append(row)
    controller.groups = [exchange(i) for i in range(64)]
    tools = module.model_tools(bridge.tools)
    for i in range(3):
        run_async(controller.turn_once(f"Current goal {i}", "stable", tools))
        controller.groups.append(exchange(100 + i, 800))
    budgets = [r["context"] for r in diagnostics if "context" in r]
    assert budgets[0]["history"]["evicted"] > 0
    assert [r["history"]["evicted"] for r in budgets[1:]] == [0, 0]
    assert budgets[0]["history"]["cache_headroom_tokens"] == 8192
    assert all(r["limit"] == 131072 for r in budgets)
    assert captured[1][:len(captured[0]) - 1] == captured[0][:-1]
    assert captured[2][:len(captured[1]) - 1] == captured[1][:-1]
    for message in captured[-1]:
        if message["role"] == "tool":
            assert message["content"].startswith("Original inventory receipt")


def test_headroom_does_not_remove_fitting_history_or_fresh_terminal_evidence():
    groups = [exchange(1, 500)]
    facts = {"parts": [{"key": "serverFeedback", "text": "Protection denied; choose a different action."}]}
    source = copy.deepcopy((groups, facts))
    messages, budget = assemble("stable", [], "survive", facts, [], groups,
        context_mode="full", context_tokens=131072, reserved_output=8192,
        context_history_headroom_tokens=8192)
    assert messages[2:-1] == groups[0]
    assert json.loads(messages[-1]["content"])["current_facts"] == facts["parts"]
    assert budget["history"]["evicted"] == 0
    assert (groups, facts) == source


def test_headroom_is_bounded_and_never_drops_facts_to_meet_a_cache_target():
    facts = {"parts": [{"key": "body", "text": "h" * 12000}]}
    messages, budget = assemble("stable", [], "survive", facts, [], [exchange(1, 6000)],
        context_mode="full", context_tokens=23000, reserved_output=2048,
        context_history_headroom_tokens=131072)
    assert json.loads(messages[-1]["content"])["current_facts"] == facts["parts"]
    assert budget["total"] <= 23000
    assert budget["history"]["cache_headroom_tokens"] <= 23000 // 4
    assert len(encode(messages)) > 12000


@pytest.mark.parametrize("value", [-1, True, 2.5, 131073])
def test_cache_headroom_configuration_rejects_invalid_values(value):
    with pytest.raises(SettingsValidationError):
        Settings.parse({"autonomy": {"context_history_headroom_tokens": value}})


def test_cache_headroom_remains_opt_in_and_does_not_change_identity():
    plain = Settings.parse({})
    selected = Settings.parse({"autonomy": {"context_history_headroom_tokens": 8192}})
    assert plain.context_history_headroom_tokens == 0
    assert selected.context_history_headroom_tokens == 8192
    assert plain.identity == selected.identity

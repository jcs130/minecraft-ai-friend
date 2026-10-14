"""Provider-independent request counting must preserve the existing budget gates."""

import copy
import json
from dataclasses import replace

import pytest

from agent_mc_autonomy import context
from agent_mc_autonomy.perception import IMAGE_RESERVE, latest_png
from test_context_retention import exchange
from test_controller import Bridge
from test_model_policy import image_raw


class SymbolCounter:
    """Test vocabulary: each serialized Unicode codepoint is exactly one token."""

    name = "fixture-symbol-tokenizer"

    def __call__(self, messages, tools):
        return len(context.encode({"messages": messages, "tools": tools}))


def fixture():
    return {"parts": [{"key": "body", "text": "生命20，饥饿12"},
                      {"key": "place", "text": "草地", "original": "log:place"}]}


def test_token_counter_keeps_large_utf8_prompt_and_complete_history():
    counter = SymbolCounter()
    prefix = "规则" * 3000
    tools = [{"type": "function", "function": {"name": "look", "description": "观察" * 2000}}]
    facts, groups = fixture(), [exchange(1, 900), exchange(2, 900)]
    before = copy.deepcopy((tools, facts, groups))
    full, _ = context.assemble(prefix, tools, "生存", facts, [], groups,
                               context_tokens=100000, reserved_output=1024)
    limit = counter(full, tools) + 1024 + 1024 + 20
    with pytest.raises(ValueError, match="context_budget_exceeded"):
        context.assemble(prefix, tools, "生存", facts, [], groups,
                         context_tokens=limit, reserved_output=1024)
    actual, budget = context.assemble(prefix, tools, "生存", facts, [], groups,
        context_tokens=limit, reserved_output=1024, context_counter=counter)
    assert actual == full
    assert budget["counter"] == counter.name and budget["units"] == "tokens"
    assert budget["input"] == counter(actual, tools)
    assert budget["total"] == budget["input"] + budget["output_reserve"] + budget["framing_reserve"] <= limit
    assert budget["output_reserve"] == 1024 and budget["framing_reserve"] == 1024
    assert (tools, facts, groups) == before


def test_counter_budget_keeps_only_complete_pairs_and_current_facts_last():
    counter, facts = SymbolCounter(), fixture()
    groups = [exchange(1, 6000), exchange(2, 1000), exchange(3, 1000)]
    empty, _ = context.assemble("stable", [], "survive", facts, [], [],
                               context_tokens=100000, reserved_output=1024)
    expected = empty[:2] + groups[1] + groups[2] + empty[-1:]
    limit = counter(expected, []) + 1024 + 1024 + 20
    messages, budget = context.assemble("stable", [], "survive", facts, [], groups,
        context_tokens=limit, reserved_output=1024, context_counter=counter)
    assert messages == expected
    assert budget["total"] <= limit
    assert [call["id"] for m in messages for call in m.get("tool_calls", [])] == ["call-2", "call-3"]
    assert [m["tool_call_id"] for m in messages if m["role"] == "tool"] == ["call-2", "call-3"]
    assert json.loads(messages[-1]["content"])["current_facts"] == facts["parts"]


@pytest.mark.parametrize("invalid", [True, False, -1, 1.5, "12", None])
def test_invalid_counter_result_restarts_entire_byte_assembly(invalid):
    class InvalidCounter(SymbolCounter):
        calls = 0

        def __call__(self, messages, tools):
            self.calls += 1
            return invalid if self.calls == 5 else 100

    counter, facts, groups = InvalidCounter(), fixture(), [exchange(1, 2200), exchange(2, 2200)]
    arguments = ("stable", [], "survive", facts, [], groups)
    expected, original = context.assemble(*arguments, context_tokens=10000, reserved_output=1024)
    actual, budget = context.assemble(*arguments, context_tokens=10000, reserved_output=1024, context_counter=counter)
    assert counter.calls == 5
    assert actual == expected
    assert budget.pop("counter_fallback") == ("ValueError" if invalid == -1 else "TypeError")
    assert budget == original


def test_counter_exception_does_not_leak_or_mutate_retry_inputs():
    class BrokenCounter(SymbolCounter):
        def __call__(self, messages, tools):
            messages[0]["content"] = "changed"
            tools.clear()
            raise RuntimeError("private-provider-key-and-response")

    arguments = ("stable", [{"function": {"name": "help"}}], "survive", fixture(), [], [exchange(1)])
    before = copy.deepcopy(arguments)
    expected, original = context.assemble(*arguments, context_tokens=15000, reserved_output=1024)
    actual, budget = context.assemble(*arguments, context_tokens=15000, reserved_output=1024, context_counter=BrokenCounter())
    assert actual == expected and arguments == before
    assert budget.pop("counter_fallback") == "RuntimeError"
    assert budget == original
    assert "private-provider" not in json.dumps(budget)


def test_valid_counter_budget_failure_does_not_retry_with_bytes():
    class TooLarge(SymbolCounter):
        def __call__(self, messages, tools):
            return 100000

    with pytest.raises(ValueError, match="context_budget_exceeded"):
        context.assemble("stable", [], "survive", fixture(), [], [],
                         context_tokens=15000, reserved_output=1024, context_counter=TooLarge())


@pytest.mark.parametrize("units", ["bytes", None, False])
def test_counter_with_non_token_units_cannot_be_mislabeled(units):
    counter = SymbolCounter()
    counter.units = units
    arguments = ("stable", [], "survive", fixture(), [], [])
    expected, original = context.assemble(*arguments, context_tokens=15000, reserved_output=1024)
    actual, budget = context.assemble(*arguments, context_tokens=15000, reserved_output=1024, context_counter=counter)
    assert actual == expected
    assert budget.pop("counter_fallback") == "ValueError"
    assert budget == original


def test_no_counter_keeps_existing_byte_total_and_payload():
    messages, budget = context.assemble("stable", [], "survive", fixture(), [], [],
                                       context_tokens=15000, reserved_output=1024)
    explicit = context.assemble("stable", [], "survive", fixture(), [], [],
        context_tokens=15000, reserved_output=1024, context_counter=None)
    assert explicit == (messages, budget)
    assert budget["total"] == len(context.encode({"messages": messages, "tools": []}).encode("utf-8")) + 2048
    assert budget["counter"] == "utf8-byte-upper-bound+1024-framing"
    assert budget["units"] == "token_upper_bound"


@pytest.mark.parametrize("with_image", [False, True])
def test_controller_counter_preserves_independent_image_and_output_reserves(framework_module, run_async, tmp_path, with_image):
    from agent_mc_autonomy.controller import Controller, model_tools

    counted, decisions, published = [], [], {}

    class Counter(SymbolCounter):
        def __call__(self, messages, tools):
            counted.append(copy.deepcopy(messages))
            return super().__call__(messages, tools)

    async def decide(messages, tools):
        decisions.append(messages)
        return {"content": "Waiting for the next event.", "tool_calls": []}

    settings = replace(framework_module.Settings(), max_tool_rounds=1)
    bridge, counter = Bridge(), Counter()
    controller = Controller(bridge, decide, settings, tmp_path, lambda **v: published.update(v),
                            lambda: False, context_counter=counter)
    if with_image:
        controller.frame = latest_png(image_raw(), "mc_view_map")
    run_async(controller.turn_once("survive", "stable", model_tools(bridge.tools)))
    assert len(decisions) == 1 and counted
    assert all(isinstance(message["content"], str) for messages in counted for message in messages)
    budget = published["context"]
    reserve = IMAGE_RESERVE if with_image else 0
    assert budget["image_reserve"] == reserve
    assert budget["total"] == budget["input"] + settings.max_output_tokens + 1024 + reserve <= settings.context_tokens
    assert budget["counter"] == counter.name and budget["units"] == "tokens"
    assert isinstance(decisions[0][-1]["content"], list) is with_image

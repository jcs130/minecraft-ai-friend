"""Learning guidance uses the real advertised catalogue and a cache-stable prefix."""

import json

import pytest

from agent_mc_autonomy.context import assemble
from agent_mc_autonomy.controller import model_tools


def request(names, mode, value):
    catalogue = [{"name": name, "description": "Native tool", "inputSchema": {"type": "object"}}
                 for name in names]
    tools = model_tools(catalogue, context_mode=mode)
    messages, budget = assemble("Original persona", tools, "Continue the original goal",
        {"parts": [{"key": "health", "text": str(value), "original": "health:original"}]}, [], [],
        context_tokens=32768, reserved_output=4096, context_mode=mode,
        native_outcomes=[{"id": "original-execution", "terminal": True, "goalCompleted": False}])
    return messages, budget


@pytest.mark.parametrize("mode", ["compact", "full"])
def test_authored_method_workflow_reaches_actual_request_without_dynamic_prefix_churn(mode):
    first, budget = request(["mc_do", "mc_script", "mc_memory"], mode, 20)
    second, _ = request(["mc_do", "mc_script", "mc_memory"], mode, 14)
    fixed = first[0]["content"]
    assert fixed == second[0]["content"]
    assert "Original persona" in fixed
    assert "api:authoring" in fixed and "validationRunId" in fixed
    assert "executionId" in fixed and "Explicit adopt requires supporting evidence" in fixed
    assert "mc_practice" not in fixed  # No fictional experiment port.
    assert json.loads(first[-1]["content"])["current_facts"] != json.loads(second[-1]["content"])["current_facts"]
    assert budget["total"] <= 32768


@pytest.mark.parametrize("names", [["mc_do"], ["mc_do", "mc_memory"], ["mc_do", "mc_combat_tactic"], ["mc_practice"]])
def test_missing_script_port_does_not_instruct_agent_to_author_using_unavailable_tool(names):
    messages, _ = request(names, "compact", 20)
    fixed = messages[0]["content"]
    assert "api:authoring" not in fixed and "mc_script" not in fixed
    assert "mc_practice" not in fixed


def test_native_invoke_catalogue_is_also_recognized_without_exposing_another_body():
    wrapped = [{"type": "function", "function": {"name": "mc_invoke", "parameters": {
        "type": "object", "properties": {"name": {"enum": ["mc_script", "mc_practice"]}}}}}]
    messages, _ = assemble("Original persona", wrapped, "Original goal", {}, [], [],
        context_tokens=32768, reserved_output=4096)
    assert "mc_practice is optional isolated comparison" in messages[0]["content"]
    assert "Stage is not adoption" in messages[0]["content"]
    assert "No repeated reflection without new evidence" in messages[0]["content"]

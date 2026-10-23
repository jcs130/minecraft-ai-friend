"""A bad local documentation query must never become an unknown body dispatch."""

import json

import pytest
from test_controller import setup


def catalogue():
    return [{"name": "mc_do", "inputSchema": {"type": "object", "properties": {
        "steps": {"type": "array", "items": {"type": "object", "properties": {
            "skill": {"enum": ["take", "stow", "craft"]}, "count": {"type": "integer"}}}}}}}]


@pytest.mark.parametrize("arguments", [
    {"name": "mc_do", "path": "/inputSchema/properties/steps/items/properties/take"},
    {"name": "mc_do", "path": "/inputSchema/properties/steps/items/properties/skill/enum/999"},
    {"name": "mc_do", "path": "/inputSchema/properties/steps/items/properties/skill/enum/not-an-index"},
    {"name": "mc_do", "path": "take"},
    {"name": "mc_do", "path": 42},
    {"name": "unknown_tool"},
    {"name": ["mc_do"]},
])
def test_invalid_local_help_is_a_known_rejection_before_dispatch(
        framework_module, tmp_path, run_async, arguments):
    _, bridge, controller = setup(framework_module, tmp_path, None)
    bridge.tools = catalogue()
    controller.persist(stopped=False, uncertain=False, inflight_request=None, pending=[])
    before = controller.state_path.read_bytes()
    result, compact, _ = run_async(controller.execute_model_call("mc_tool_help", arguments))
    assert result["failed"] is True and result["dispatched"] is False
    assert result["origin"] == "controller_validation" and result["execution"] is None
    assert "mc_tool_help" in result["text"] and "mc_help" in result["text"]
    assert json.loads(compact)["dispatched"] is False
    assert controller.inflight_request is None and not controller.pending
    assert controller.state_path.read_bytes() == before
    assert bridge.calls == [], "local validation must not query a model, game or native artifact"
    journal = json.loads((tmp_path / "receipts.jsonl").read_text(encoding="utf-8"))
    assert journal["tool"] == "mc_tool_help" and journal["result"]["dispatched"] is False


def test_valid_help_path_keeps_original_schema_and_completes_without_body_work(
        framework_module, tmp_path, run_async):
    _, bridge, controller = setup(framework_module, tmp_path, None)
    bridge.tools = catalogue()
    result, _, _ = run_async(controller.execute_model_call("mc_tool_help", {
        "name": "mc_do", "path": "/inputSchema/properties/steps/items/properties/skill/enum/0"}))
    assert json.loads(result["text"]) == "take"
    assert not result.get("failed") and result.get("execution") is None
    assert bridge.calls == [] and controller.inflight_request is None
    assert json.loads(controller.state_path.read_text(encoding="utf-8"))["uncertain"] is False


def test_failed_help_does_not_erase_unresolved_native_failure(framework_module, tmp_path, run_async):
    _, bridge, controller = setup(framework_module, tmp_path, None)
    bridge.tools = catalogue()
    controller.tool_failure = {"tool": "mc_do", "error": "Cannot open chest", "observation_only": False,
                               "native_execution": {"id": "native-1", "phase": "blocked"}}
    run_async(controller.execute_model_call("mc_tool_help", {"name": "mc_do", "path": "/take"}))
    assert controller.tool_failure["error"] == "Cannot open chest"
    assert controller.tool_failure["observation_failure"]["tool"] == "mc_tool_help"
    assert bridge.calls == []

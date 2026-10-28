import copy
import json

import pytest
from test_controller import setup
from test_shared_information import HELP

from agent_mc_autonomy.controller import READ_PROTOCOL, failure_context, model_tools, protocol_planner_help, tool_help

PROTOCOL_TOOL = {"name": "mc_protocol", "description": "Native lifecycle begin_turn end_turn ack_barrier",
                 "inputSchema": {"type": "object", "properties": {"protocol": {"const": "agent-mc/v1"},
                     "action": {"enum": ["begin_turn", "end_turn", "ack_barrier", "task", "facts", "archive", "archive_runs"]},
                     "id": {"type": "string"}}, "required": ["protocol", "action"]}}


@pytest.mark.parametrize("mode", ["compact", "full"])
def test_advertisement_fallback_docs_and_error_recovery_share_one_scope(mode):
    catalogue = [copy.deepcopy(PROTOCOL_TOOL)]
    original = copy.deepcopy(catalogue)
    advertised = next(row["function"] for row in model_tools(catalogue, context_mode=mode) if row["function"]["name"] == "mc_protocol")
    assert set(advertised["parameters"]["properties"]["action"]["enum"]) == READ_PROTOCOL
    assert "begin_turn" not in advertised["description"]
    fallback = json.loads(tool_help(catalogue, {"name": "mc_protocol"})["text"])
    assert set(fallback["inputSchema"]["properties"]["action"]["enum"]) == READ_PROTOCOL
    correction = failure_context(catalogue, "mc_protocol", {"protocol": "agent-mc/v1", "action": "begin_turn"},
                                 {"text": "host owns lifecycle"})
    assert set(correction["parameter_help"]["action"]["enum"]) == READ_PROTOCOL
    assert catalogue == original


@pytest.mark.parametrize("path,full", [("", True), ("/properties/action", True), ("/properties/action", False),
                                       ("/properties/action/enum", False)])
def test_shared_protocol_docs_project_the_actual_read_schema(path, full):
    result = protocol_planner_help([PROTOCOL_TOOL], {"name": "mc_protocol", "path": path, "full": full})
    text = result["text"]
    assert not result["dispatched"]
    assert "begin_turn" not in text and "end_turn" not in text and "ack_barrier" not in text
    reply = json.loads(text)
    assert reply["protocol"] == "agent-mc-tool-help/v1" and reply["path"] == path
    assert "schema" in reply if full else "schemaSummary" in reply


@pytest.mark.parametrize("path", ["/properties/action/enum/4", "/properties/action/enum/-1", "/properties/action/enum/00", "/bad~path"])
def test_invalid_or_unavailable_nodes_do_not_reveal_native_lifecycle(path):
    with pytest.raises((LookupError, TypeError, ValueError)):
        protocol_planner_help([PROTOCOL_TOOL], {"name": "mc_protocol", "path": path})


def test_shared_help_cannot_bypass_scope_or_dispatch_lifecycle(framework_module, tmp_path, run_async):
    _, bridge, controller = setup(framework_module, tmp_path, None)
    bridge.tools.extend([HELP, PROTOCOL_TOOL])
    result, _ = run_async(controller.dispatch("mc_tool_help", {"name": "mc_protocol", "full": True}, "read-scope"))
    assert "begin_turn" not in result["text"]
    assert bridge.calls == [] and controller.inflight_request is None
    assert not controller.pending and not result.get("failed")


def test_help_batch_limit_is_preserved_in_recovery_and_advertisement():
    tool = {"name": "mc_help", "inputSchema": {"type": "object", "properties": {
        "skills": {"type": "array", "maxItems": 4, "items": {"type": "string"}}}}}
    notice = failure_context([tool], "mc_help", {"skills": ["a"] * 6}, {"text": "too many items"})
    assert notice["parameter_help"]["skills"]["maxItems"] == 4
    assert model_tools([tool])[0]["function"]["parameters"]["properties"]["skills"]["maxItems"] == 4

"""New MCP receipts retain the existing unknown-outcome stop boundary."""

import json

import pytest
from test_controller import choose, setup


def test_structured_mcp_unknown_without_execution_preserves_restart_fence(
        framework_module, tmp_path, run_async):
    async def decide(*_):
        return choose()

    module, bridge, controller = setup(framework_module, tmp_path, decide)
    bridge.result = {
        "protocol": "agent-mc/v1", "text": "Original result unknown; query the original request.",
        "failed": False, "execution": None,
        "data": {"status": "unknown", "reason": "request_outcome_unknown", "retryable": False,
                 "request_id": "original-request", "next_safe_read": {
                     "tool": "mc_protocol", "arguments": {
                         "protocol": "agent-mc/v1", "action": "request", "id": "original-request"}}},
    }
    controller.persist(stopped=False)
    with pytest.raises(RuntimeError, match="outcome_unknown"):
        run_async(controller.turn_once("survive", "prefix", module.model_tools(bridge.tools)))
    state = json.loads(controller.state_path.read_text())
    assert state["uncertain"] is True and state["inflight_request"]
    assert (tmp_path / "receipts.jsonl").is_file()
    assert len([call for call in bridge.calls if call[0] == "mc_do"]) == 1
    assert not any(args.get("action") == "ack_barrier" for name, args, _ in bridge.calls if name == "mc_protocol")
    _, second, restart = setup(framework_module, tmp_path, decide)
    with pytest.raises(RuntimeError, match="outcome_unknown"):
        run_async(restart.run("survive"))
    assert not second.opened and not second.calls


@pytest.mark.parametrize("status", ["completed", "partial", "blocked", "noop", "skipped", "cancelled"])
def test_known_structured_status_is_not_unknown(framework_module, status):
    from agent_mc_autonomy.controller import uncertain

    assert not uncertain({"data": {"status": status, "retryable": False}, "execution": None})

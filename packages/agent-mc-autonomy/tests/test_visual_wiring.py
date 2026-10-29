import dataclasses
import json

import pytest
from test_controller import setup
from test_model_policy import image_raw

from agent_mc_autonomy.context import RULES
from agent_mc_autonomy.perception import has_images


@pytest.mark.parametrize("vision_enabled, capture_failed", [(True, False), (False, False), (True, True)])
def test_visual_progressive_help_invoke_fresh_frame_and_text_fallback(framework_module, tmp_path, run_async, vision_enabled, capture_failed):
    requests = []
    def call(name, arguments):
        return {"content": None, "tool_calls": [{"id": str(len(requests)), "type": "function",
            "function": {"name": name, "arguments": json.dumps(arguments)}}]}
    async def decide(messages, tools):
        requests.append(messages)
        advertised = {row["function"]["name"]: row["function"] for row in tools}
        assert ("mc_visual" in advertised) is (len(requests) > 1)
        assert "mc_visual" in advertised["mc_tool_help"]["parameters"]["properties"]["name"]["enum"]
        assert "mc_visual" in advertised["mc_invoke"]["parameters"]["properties"]["name"]["enum"]
        if len(requests) == 1:
            return call("mc_tool_help", {"name": "mc_visual"})
        if len(requests) == 2:
            assert "raw" in json.dumps(messages)
            assert "observed/historical terrain" in json.dumps(messages)
            return call("mc_visual", {"mode": "first", "raw": True})
        assert has_images(messages) is (vision_enabled and not capture_failed)
        return {"content": "Use fresh textual facts if no image is attached.", "tool_calls": []}
    module, bridge, controller = setup(framework_module, tmp_path, decide)
    controller.settings = dataclasses.replace(controller.settings, vision_enabled=vision_enabled, max_tool_rounds=3)
    bridge.tools.append({"name": "mc_visual", "description": "Capture an actual scene PNG. raw returns synchronous image.",
        "inputSchema": {"type": "object", "properties": {"mode": {"enum": ["first"]}, "raw": {"type": "boolean"}},
                        "required": ["mode"], "additionalProperties": False}, "_meta": {"agent-mc/v1": {"tags": ["read"]}}})
    native_call = bridge.call
    captures = []
    async def body(name, arguments, **metadata):
        if name == "mc_visual":
            captures.append(arguments)
            return {**image_raw(), "structuredContent": {"protocol": "agent-mc/v1", "failed": capture_failed,
                    "text": "capture_unavailable" if capture_failed else "fresh current body scene"}}
        return await native_call(name, arguments, **metadata)
    bridge.call = body
    run_async(controller.turn_once("survive", RULES, module.model_tools(bridge.tools)))
    assert len(requests) == 3 and captures == [{"mode": "first", "raw": True}]
    assert controller.frame is None  # One fresh image is consumed once, no background capture.
    assert "headless camera capture and viewer screenshots are unavailable" not in RULES
    assert "background" in RULES.lower() and "mc_visual" in RULES

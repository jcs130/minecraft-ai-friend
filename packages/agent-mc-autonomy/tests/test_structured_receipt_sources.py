"""Ordinary discovery and notebook provenance is not a spatial source tag."""
import importlib
import json

import pytest
from test_controller import setup


@pytest.mark.parametrize("source", [{"kind": "discovery"}, ["descriptor"], None])
def test_structured_nonspatial_source_is_preserved(framework_module, source):
    module = importlib.import_module("agent_mc_autonomy.observations")
    text = json.dumps({"source": source, "options": [{"id": "waypoint"}]})
    assert module.spatial_observations(text) == []
    assert module.spatial_text(text) == text


def test_large_discovery_receipt_is_archived_without_leaving_dispatch_unknown(
        framework_module, tmp_path, run_async):
    _, bridge, controller = setup(framework_module, tmp_path, None)
    bridge.tools.append({"name": "mc_options", "inputSchema": {"type": "object"}})
    result = {"protocol": "agent-mc/v1",
              "text": json.dumps({"source": {"kind": "discovery"}, "options": ["known"] * 420}),
              "meta": {"discovery": {"description": "schema metadata " * 240}}}
    original_call = bridge.call

    async def call(name, arguments, **metadata):
        if name == "mc_options":
            bridge.calls.append((name, arguments, metadata))
            return {"structuredContent": result}
        return await original_call(name, arguments, **metadata)

    bridge.call = call
    returned, compact, _ = run_async(controller.execute_model_call("mc_options", {}))
    assert returned["failed"] is False
    state = json.loads((tmp_path / "host-state.json").read_text())
    assert state["inflight_request"] is None and state["uncertain"] is False
    archived = json.loads((tmp_path / "receipts.jsonl").read_text())
    assert json.loads(archived["result"]["text"])["source"] == {"kind": "discovery"}
    summary = json.loads(compact)
    assert summary["original_chunks"] and "mc_original" in summary["retrieve"]
    assert not any(name == "mc_do" for name, _, _ in bridge.calls)

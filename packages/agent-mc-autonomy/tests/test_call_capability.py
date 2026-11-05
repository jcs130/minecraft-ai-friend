import copy
import json

import pytest

from agent_mc_autonomy.bridge import MinecraftBridge
from agent_mc_autonomy.call_capability import PROTOCOL, SCHEMA
from agent_mc_autonomy.controller import READ_PROTOCOL, model_tools


def bridge(tmp_path, answer, *, legacy=False):
    client = MinecraftBridge("unused-node", tmp_path / "unused", tmp_path / "config", tmp_path / "log")
    client.tools = [{"name": "mc_method", "_meta": {} if legacy else {PROTOCOL: {
        "callCapabilities": {"schema": SCHEMA, "tool": "mc_protocol", "action": "inspect_call"}}}},
        {"name": "mc_protocol", "inputSchema": {"type": "object", "properties": {"action": {
            "enum": sorted(READ_PROTOCOL | ({"inspect_call", "resolve_work"} if not legacy else set()))}}}}]
    calls = []

    async def call(name, arguments, **_):
        calls.append((name, arguments))
        return {"content": [{"type": "text", "text": json.dumps(answer)}]}

    client.call = call
    return client, calls


def test_inspection_never_calls_the_target_or_starts_a_body(tmp_path, run_async):
    answer = {"schema": SCHEMA, "tool": "mc_method", "valid": True, "available": None,
              "readOnly": False, "backgroundLearning": True, "reason": "declared", "dispatched": False}
    client, calls = bridge(tmp_path, answer)
    assert run_async(client.inspect_call("mc_method", {"op": "save"})) == answer
    assert calls == [("mc_protocol", {"protocol": PROTOCOL, "action": "inspect_call",
                                     "tool": "mc_method", "arguments": {"op": "save"}})]
    assert client._owner is None
    projected = next(t["function"]["parameters"] for t in model_tools(client.tools)
                     if t["function"]["name"] == "mc_protocol")
    assert set(projected["properties"]["action"]["enum"]) == READ_PROTOCOL | {"inspect_call", "resolve_work"}


def test_old_cores_are_unknown_without_probe_or_optimistic_execution(tmp_path, run_async):
    client, calls = bridge(tmp_path, {}, legacy=True)
    assert run_async(client.inspect_call("mc_method", {}))["backgroundLearning"] is None
    assert run_async(client.resolve_work([]))["available"] is False
    assert not calls


@pytest.mark.parametrize("bad", [{"dispatched": True}, {"tool": "another"}, {"schema": "future"},
                                {"readOnly": "true"}, {"reason": "invalid_arguments"}])
def test_bad_declarations_fail_closed(tmp_path, run_async, bad):
    answer = {"schema": SCHEMA, "tool": "mc_method", "valid": True, "available": None,
              "readOnly": True, "backgroundLearning": False, "reason": "declared", "dispatched": False}
    client, _ = bridge(tmp_path, {**answer, **bad})
    with pytest.raises(ValueError, match="capability"):
        run_async(client.inspect_call("mc_method", {}))


def test_work_resolution_keeps_original_identity_and_never_adopts(tmp_path, run_async):
    ref = {"scope": {"realm": "world", "account": "account", "agent": "agent"},
           "subject": "quest", "instance": "occurrence-1", "revision": 3}
    answer = {"protocol": PROTOCOL, "run": "run-1", "adopted": False,
              "resolutions": [{"reference": ref, "state": None, "disposition": "unknown"}]}
    client, calls = bridge(tmp_path, answer)
    assert run_async(client.resolve_work([ref])) == answer
    assert calls[0][1]["references"] == [ref]
    wrong = copy.deepcopy(answer)
    wrong["resolutions"][0]["reference"]["revision"] = 4
    client, _ = bridge(tmp_path, wrong)
    with pytest.raises(ValueError, match="resolution"):
        run_async(client.resolve_work([ref]))

"""Native catalogue and exact no-dispatch correction regressions; no live calls."""
import copy
import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from agent_mc_autonomy.context import coalesce_rejected, encode
from agent_mc_autonomy.controller import failure_context, model_tools, tool_help
from agent_mc_autonomy.model_protocols import assistant_history, decode, request, scope
from test_controller import setup
from test_model_providers import config
from test_rejected_plan_history import rejected


def catalogue():
    # Exact minecraftToolDecls() mc_do/mc_scout declarations from core .25,
    # canonical 6cbff24070a2ff4ee224e6d5bf94e82cebe4a914; no runtime text.
    return json.loads(Path(__file__).with_name("fixtures").joinpath("native-step-tools.json").read_text(encoding="utf-8"))


# Actual016 outer arguments. Inner text lacks its final ], and a ray range is
# negative. This fixture must stay rejected, never coerced/repaired/dispatched.
INVALID = {"steps": '[{"skill": "observe", "mode": "sites", "sites": [[-60, 72, 313], [-58, 72, 306], [-59, 73, 310], [-53, 69, 313]]}, {"skill": "observe", "mode": "rays", "rays": [[0, 0, 32], [0, 0, -32], [0, 45, 32], [0, -45, 32], [0, 90, 24]]}'}


def test_real_catalogue_keeps_scalar_applicability_and_original_target_semantics():
    native = catalogue()
    before = copy.deepcopy(native)
    tools = {row["function"]["name"]: row["function"] for row in model_tools(native)}
    props = native[0]["inputSchema"]["properties"]["steps"]["items"]["properties"]
    for field in ("durationMs", "yawDeg", "pitchDeg", "distance", "target"):
        actual = tools["mc_do"]["parameters"]["properties"]["steps"]["items"]["properties"][field]
        assert actual["description"] == props[field]["description"]
        expanded = json.loads(tool_help(native, {"name": "mc_do", "path": "/inputSchema/properties/steps/items/properties/" + field})["text"])
        assert expanded == props[field]
    assert native == before
    assert model_tools(native) == model_tools(list(reversed(native)))
    def constraints(value):
        if isinstance(value, dict):
            return {k: constraints(v) for k, v in value.items()
                    if k not in {"description", "title", "examples", "$comment", "default"}}
        return [constraints(v) for v in value] if isinstance(value, list) else value
    for tool in native:
        assert constraints(tools[tool["name"]]["parameters"]["properties"]["steps"]) == constraints(
            tool["inputSchema"]["properties"]["steps"])
    for name, steps in (
        ("mc_do", [{"skill": "flee", "distance": 12}]),
        ("mc_do", [{"skill": "look", "at": [-53, 70, 313]}]),
        ("mc_do", [{"skill": "find", "target": "birch_log"}]),
        ("mc_do", [{"skill": "control", "keys": ["forward"], "durationMs": 500, "yawDeg": 10}]),
        ("mc_scout", [{"skill": "observe", "mode": "voxels", "bounds": [-2, -1, -2, 2, 3, 2]}]),
    ):
        arguments = {"steps": steps}
        assert Draft202012Validator(tools[name]["parameters"]).is_valid(arguments)
        assert Draft202012Validator(next(t for t in native if t["name"] == name)["inputSchema"]).is_valid(arguments)
    scout = Draft202012Validator(tools["mc_scout"]["parameters"])
    for steps in (INVALID["steps"], [{"skill": "look"}],
                  [{"skill": "observe", "mode": "voxels", "bounds": [-4, -2, -4, 4, 4]}],
                  [{"skill": "observe", "mode": "rays", "rays": [[0, 0, -32]]}]):
        assert not scout.is_valid({"steps": steps})


@pytest.mark.parametrize("steps", [INVALID["steps"], None, {}, 1])
def test_malformed_steps_help_has_genuine_shape_and_original_schema_pointer(steps):
    help_ = failure_context(catalogue(), "mc_scout", {"steps": steps}, {"text": "steps violates native type='array'"})
    assert help_["parameter_help"]["steps"]["type"] == "array"
    assert help_["parameter_help"]["steps"]["items"] == {"type": "object"}
    assert help_["parameter_help"]["steps"]["schema"]["arguments"] == {
        "name": "mc_scout", "path": "/inputSchema/properties/steps"}
    assert "JSON text inside a string is not an array" in help_["next_step"]
    assert len(encode(help_).encode("utf-8")) <= 4500


def test_actual_invalid_repeats_keep_latest_closed_pair_distinct_failure_and_durable_evidence(framework_module, tmp_path, run_async):
    seen, originals = [], []
    async def decide(messages, tools):
        seen.append(copy.deepcopy(messages))
        index = len(seen)
        args = {"steps": [{"skill": "look"}]} if index == 2 else INVALID
        response = {"content": None, "tool_calls": [{"id": f"invalid-{index}", "type": "function",
                    "function": {"name": "mc_scout", "arguments": encode(args)}}]}
        originals.append(copy.deepcopy(response))
        return response
    module, bridge, controller = setup(framework_module, tmp_path, decide)
    bridge.tools = catalogue()
    tools = module.model_tools(bridge.tools)
    preserved = [rejected(100, result={"failed": False, "execution": {"id": "running", "phase": "accepted"}}),
                 rejected(101, result={"failed": True, "uncertain": True, "text": "unknown"})]
    mixed = rejected(102)
    mixed[0]["tool_calls"].insert(0, {"id": "read", "type": "function", "function": {"name": "mc_bag", "arguments": "{}"}})
    mixed.insert(1, {"role": "tool", "tool_call_id": "read", "content": "bag observed"})
    preserved.append(mixed)
    controller.groups = copy.deepcopy(preserved)
    for _ in range(10):
        run_async(controller.turn_once("survive", "prefix", tools))
    assert not any(name in {"mc_do", "mc_scout"} for name, *_ in bridge.calls)
    assert controller.pending == {} and controller.inflight_request is None
    assert len(controller.groups) == 5 and controller.groups[:3] == preserved
    previous = [m for m in seen[-1] if m.get("tool_calls")]
    assert [m["tool_calls"][0]["id"] for m in previous[-2:]] == ["invalid-2", "invalid-9"]
    replies = [m for m in seen[-1] if m["role"] == "tool"]
    assert [m["tool_call_id"] for m in replies[-2:]] == ["invalid-2", "invalid-9"]
    latest = json.loads(replies[-1]["content"])
    assert latest["failed"] is True and latest["dispatched"] is False
    assert latest["origin"] == "controller_validation" and "steps violates native type='array'" in latest["text"]
    assert latest["repeated_rejections"]["count"] == 7
    assert latest["correction"]["parameter_help"]["steps"]["type"] == "array"
    assert previous[-1]["tool_calls"] == originals[-2]["tool_calls"]
    rows = [json.loads(line) for line in (tmp_path / "decisions.jsonl").read_text(encoding="utf-8").splitlines()]
    assert [r["response"] for r in rows if "response" in r] == originals
    assert sum(r.get("dispatched") is False for r in rows) == 10
    assert not (tmp_path / "receipts.jsonl").exists()


@pytest.mark.parametrize("provider", ["deepseek", "openai", "anthropic", "google"])
def test_exact_rejections_keep_authentic_native_state_and_provider_envelope(provider):
    cfg = config(provider)
    groups = []
    for index in range(2):
        call_id = f"call-{index}"
        args = {"steps": "[]"}
        if cfg.protocol == "chat":
            payload = {"choices": [{"finish_reason": "tool_calls", "message": {"content": None,
                "reasoning_content": "same reasoning", "tool_calls": [{"id": call_id, "type": "function", "function": {
                    "name": "mc_scout", "arguments": encode(args)}}]}}]}
        elif cfg.protocol == "responses":
            payload = {"status": "completed", "output": [{"type": "reasoning", "encrypted_content": "same opaque state"},
                {"type": "function_call", "id": f"fc-{index}", "call_id": call_id, "name": "mc_scout", "arguments": encode(args)}]}
        elif cfg.protocol == "anthropic":
            payload = {"stop_reason": "tool_use", "content": [{"type": "thinking", "thinking": "same reasoning", "signature": "sig"},
                {"type": "tool_use", "id": call_id, "name": "mc_scout", "input": args}]}
        else:
            payload = {"candidates": [{"finishReason": "STOP", "content": {"parts": [
                {"functionCall": {"id": call_id, "name": "mc_scout", "args": args}, "thoughtSignature": "sig"}]}}]}
        response, state, _ = decode(cfg, payload)
        response["_provider_state"] = {"scope": scope(cfg), "data": state}
        groups.append([assistant_history(response), {"role": "tool", "tool_call_id": call_id,
            "content": encode({"failed": True, "dispatched": False, "origin": "controller_validation", "text": "steps type"})}])
    before = copy.deepcopy(groups)
    history, removed = coalesce_rejected(groups)
    assert groups == before and len(history) == len(removed) == 1
    assert history[0][0] == before[-1][0]
    messages = [{"role": "system", "content": "stable"}, *history[0]]
    _, wire = request(cfg, messages, model_tools(catalogue()), 2048)
    encoded = encode(wire)
    assert "call-1" in encoded and "call-0" not in encoded and "_provider_state" not in encoded
    if cfg.protocol == "chat":
        assert wire["messages"][1]["reasoning_content"] == "same reasoning"
        assert wire["messages"][2]["tool_call_id"] == "call-1"
    elif cfg.protocol == "responses":
        assert wire["input"][-1]["call_id"] == "call-1"
        assert wire["input"][0]["content"] == [{"type": "input_text", "text": "stable"}]
    elif cfg.protocol == "anthropic":
        assert wire["messages"][0]["content"][0]["signature"] == "sig"
        assert wire["messages"][-1]["content"][0]["tool_use_id"] == "call-1"
    else:
        assert wire["contents"][0]["parts"][0]["thoughtSignature"] == "sig"
        assert wire["contents"][-1]["parts"][0]["functionResponse"]["id"] == "call-1"
    # Provider state is meaningful context, never ignored for deduplication.
    changed = copy.deepcopy(groups)
    changed[-1][0]["_provider_state"]["data"] = {"changed": "opaque"}
    assert len(coalesce_rejected(changed)[0]) == 2


@pytest.mark.parametrize("field,value", [("uncertain", True), ("outcome_unknown", True),
    ("execution", {"id": "accepted", "phase": "unknown"}), ("failed", False), ("dispatched", True)])
def test_successful_and_unknown_groups_are_not_coalesced(field, value):
    groups = [rejected(i) for i in range(2)]
    for group in groups:
        group[-1]["content"] = encode({**json.loads(group[-1]["content"]), field: value})
    assert coalesce_rejected(groups)[0] == groups


@pytest.mark.parametrize("change", ["argument_id", "content", "reasoning", "unclosed", "nested_unknown", "correction"])
def test_only_exact_closed_rejections_can_coalesce(change):
    groups = [rejected(i) for i in range(2)]
    if change == "argument_id":
        args = json.loads(groups[-1][0]["tool_calls"][0]["function"]["arguments"])
        args["steps"][0]["id"] = "different-user-id"
        groups[-1][0]["tool_calls"][0]["function"]["arguments"] = encode(args)
    elif change in {"content", "reasoning"}:
        groups[-1][0]["content" if change == "content" else "reasoning_content"] = "different"
    elif change == "unclosed":
        groups[-1][-1]["tool_call_id"] = "another-call"
    else:
        extra = {"evidence": {"outcomeKnown": False}} if change == "nested_unknown" else {"correction": {"parameter_help": "different"}}
        groups[-1][-1]["content"] = encode({**json.loads(groups[-1][-1]["content"]), **extra})
    assert coalesce_rejected(groups)[0] == groups

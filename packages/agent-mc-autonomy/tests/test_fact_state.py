"""Producer semantic comparison never erases raw, dated decision evidence."""
import copy
import hashlib
import json

import pytest
from test_observation_reuse import observed, prepare

from agent_mc_autonomy.context import assemble
from agent_mc_autonomy.controller import admission_fingerprint


def facts(sample="old", **changes):
    state = {"position": [1, 64, 2], "health": 20, "inventory": [{"name": "wheat_seeds", "count": 30}]}
    state.update(changes)
    revision = "sha256:" + hashlib.sha256(json.dumps(state, sort_keys=True).encode()).hexdigest()
    return {"parts": [{"key": "recoveryState", "text": json.dumps({"sampledAt": sample, **state}),
                       "revision": "raw-" + sample, "original": "log:" + sample, "stateRevision": revision}]}


def test_completed_probe_not_redispatched_for_sampling_clock_alone(framework_module, tmp_path, run_async):
    bridge, controller = prepare(framework_module, tmp_path)
    probe = {"steps": [{"skill": "probe", "shape": "box", "fill": "solid",
                         "anchors": [[-476, 68, -492], [-468, 68, -485]]}]}
    controller.last_admission_facts = admission_fingerprint(facts("first"))
    assert observed(controller, run_async, arguments=probe).get("execution")
    controller.last_admission_facts = admission_fingerprint(facts("later"))
    cached = observed(controller, run_async, arguments=probe)
    assert cached["code"] == "observation_already_answered" and cached["dispatched"] is False
    assert cached["previous_observation"]["fresh"] is False
    assert len([c for c in bridge.calls if c[0] == "mc_do"]) == 1
    controller.last_admission_facts = admission_fingerprint(facts("later", health=19))
    assert observed(controller, run_async, arguments=probe).get("execution")
    assert len([c for c in bridge.calls if c[0] == "mc_do"]) == 2


@pytest.mark.parametrize("key", ["position", "health", "inventory", "mana", "cooldownMs", "lastCastAt", "target"])
def test_explicit_semantic_change_invalidates_comparison(key):
    assert admission_fingerprint(facts()) != admission_fingerprint(facts(**{key: None}))


@pytest.mark.parametrize("revision", [None, "", "sha256:short", "sha256:" + "A" * 64,
                                      "sha256:" + "a" * 64 + "\n", ["sha256:" + "a" * 64]])
def test_absent_or_malformed_digest_conservatively_uses_full_text(revision):
    before, after = facts("first"), facts("later")
    for value in (before, after):
        value["parts"][0]["stateRevision"] = revision
    assert admission_fingerprint(before) != admission_fingerprint(after)


def test_undeclared_native_state_is_not_silently_ignored():
    before, after = facts("first"), facts("later")
    before["parts"].append({"key": "combatCapabilities", "text": '{"mana":12,"lastCastAt":"old"}'})
    after["parts"].append({"key": "combatCapabilities", "text": '{"mana":11,"lastCastAt":"new"}'})
    assert admission_fingerprint(before) != admission_fingerprint(after)


@pytest.mark.parametrize("mode", ["compact", "full"])
def test_comparison_digest_does_not_replace_raw_model_evidence(mode):
    current = facts("2026-10-29T07:00:00Z")
    original = copy.deepcopy(current)
    messages, _ = assemble("rules", [], "survive", current, [], [], context_tokens=16000,
                           reserved_output=2048, context_mode=mode)
    tail = json.loads(messages[-1]["content"])
    part = next(p for p in tail["current_facts"] if p["key"] == "recoveryState")
    assert part["text"] == current["parts"][0]["text"]
    assert "sampledAt" in part["text"]
    assert "stateRevision" not in part and "revision" not in part
    assert current == original

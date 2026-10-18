"""A failed withdrawal must not become progress merely by reopening its box."""
import copy

import pytest
from test_controller import action
from test_effect_recovery import prepare


def plan(count=6, tail=None):
    return {"steps": [{"skill": "goto", "at": [1, 61, 2]},
                      {"skill": "use", "at": [1, 61, 2]},
                      {"skill": "take", "item": "oak_planks", "count": count, "from": "open"},
                      *(tail or [])]}


def measured(skill, *, at=None, opened=False, close=False):
    stock = {"oak_planks": 2, "coal": 10}
    before = {"at": "2026-10-18T07:04:20Z", "target": None,
              "inventory": stock, "position": [1.5, 61, 1.5],
              "window": {"id": 55, "type": "minecraft:generic_9x3"} if close else None}
    after = copy.deepcopy(before)
    after["at"] = "2026-10-18T07:04:22Z"
    if at is not None:
        before["target"] = after["target"] = {"name": "chest", "stateId": 2973}
    if opened:
        after["window"] = {"id": 55, "type": "minecraft:generic_9x3"}
    if close:
        after["window"] = None
    return {"schema": "agent-mc-observed-effect/v1", "skill": skill, "dimension": "minecraft:overworld",
            "at": at, "before": before, "after": after,
            "changed": {"target": False if at is not None else None, "inventory": False,
                        "position": False, "window": opened or close},
            "status": "changed" if opened or close else "unchanged",
            "coverage": "client-visible-only", "goalVerified": False}


def terminal(tail=False):
    rows = [{"step": 1, "outcome": "ok", "observedEffect": measured("goto", at=[1, 61, 2])},
            {"step": 2, "outcome": "ok", "observedEffect": measured("use", at=[1, 61, 2], opened=True)},
            {"step": 3, "outcome": "fail", "why": "No oak planks in this container; inventory still has two.",
             "observedEffect": measured("take", close=True)}]
    if tail:
        rows.append({"step": 4, "outcome": "skip", "why": "Earlier prerequisite failed"})
    return {**action(True), "phase": "blocked", "evidence": {"steps": rows}}


def test_reopening_and_different_tail_cannot_repeat_failed_withdrawal(framework_module, tmp_path, run_async):
    bridge, controller = prepare(framework_module, tmp_path)
    controller.game_facts["observation"]["inventory"] = {"oak_planks": 2, "coal": 10}
    controller.game_facts["run"] = "native-run"
    for args in (plan(), plan(tail=[{"skill": "craft", "item": "chest", "count": 1}])):
        assert run_async(controller.execute_model_call("mc_do", args))[0].get("execution")
        end = terminal(len(args["steps"]) > 3)
        controller.receipt({"execution": end, "events": [{"run": "native-run", "cursor": 58, "execution": end}]})
    result = run_async(controller.execute_model_call("mc_do", {**plan(), "_spoken_text": "Try another batch"}))[0]
    assert result.get("dispatched") is False
    assert result["code"] == "repeated_container_failure"
    assert len([call for call in bridge.calls if call[0] == "mc_do"]) == 2
    assert result["previous_outcome"]["original_event"] == {"run": "native-run", "cursor": 58}
    assert result["previous_outcome"]["goal_verified"] is False
    assert not controller.pending


@pytest.mark.parametrize("change", ["inventory", "box", "item", "quantity", "scope", "death", "expiry", "acquisition", "connection"])
def test_new_evidence_or_prerequisite_work_is_not_blocked(change, monkeypatch):
    import agent_mc_autonomy.container_recovery as module
    from agent_mc_autonomy.container_recovery import ContainerRecovery
    clock = [100.0]
    monkeypatch.setattr(module.time, "monotonic", lambda: clock[0])
    guard = ContainerRecovery()
    for _ in range(2):
        guard.record(plan(), terminal(), "world", 0, {"run": "native-run", "cursor": 58})
    args = plan()
    facts = {"run": "native-run", "observation": {"dimension": "minecraft:overworld", "inventory": {"oak_planks": 2, "coal": 10}}}
    assert guard.repeated(args, facts, "world", 0)
    scope, epoch = "world", 0
    if change == "inventory":
        facts["observation"]["inventory"]["oak_planks"] = 8
    elif change == "box":
        args["steps"][1]["at"] = [2, 61, 2]
    elif change == "item":
        args["steps"][2]["item"] = "chest"
    elif change == "quantity":
        args["steps"][2]["count"] = 1
    elif change == "scope":
        scope = "other-world"
    elif change == "death":
        epoch = 1
    elif change == "expiry":
        clock[0] += 121
    elif change == "connection":
        facts["run"] = "new-native-run"
    else:
        args["steps"].insert(0, {"skill": "collect", "target": "oak_log", "count": 1})
    assert guard.repeated(args, facts, scope, epoch) is None


@pytest.mark.parametrize("broken", ["missing", "unmeasured", "inventory_change", "foreign_window", "duplicate", "not_terminal", "no_reference"])
def test_incomplete_or_ambiguous_measurements_never_block(broken):
    from agent_mc_autonomy.container_recovery import ContainerRecovery
    guard = ContainerRecovery()
    end = terminal()
    rows = end["evidence"]["steps"]
    reference = {"run": "native-run", "cursor": 58}
    if broken == "missing":
        rows[2].pop("observedEffect")
    elif broken == "unmeasured":
        rows[2]["observedEffect"]["before"]["inventory"] = None
    elif broken == "inventory_change":
        rows[2]["observedEffect"]["after"]["inventory"]["oak_planks"] = 8
        rows[2]["observedEffect"]["changed"]["inventory"] = True
    elif broken == "foreign_window":
        rows[2]["observedEffect"]["before"]["window"]["id"] = 77
    elif broken == "duplicate":
        rows[1]["step"] = 3
    elif broken == "not_terminal":
        end["terminal"] = False
    else:
        reference = {}
    for _ in range(2):
        guard.record(plan(), end, "world", 0, reference)
    facts = {"run": "native-run", "observation": {"dimension": "minecraft:overworld", "inventory": {"oak_planks": 2, "coal": 10}}}
    assert guard.repeated(plan(), facts, "world", 0) is None

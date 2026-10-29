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


def unopened_plan():
    args = plan()
    args["steps"][1]["face"] = "east"
    return args


def unopened_terminal():
    end = terminal()
    use = measured("use", at=[1, 61, 2])
    for sample in (use["before"], use["after"]):
        sample["target"] = {"name": "grass_block", "stateId": 9}
    end["evidence"]["steps"][1] = {"step": 2, "outcome": "fail", "observedEffect": use}
    end["evidence"]["steps"][2] = {"step": 3, "outcome": "skip", "why": "No accessible window after step 2"}
    return end


def unopened_facts():
    return {"run": "native-run", "observation": {"dimension": "minecraft:overworld",
            "inventory": {"oak_planks": 2, "coal": 10}, "position": {"x": 1.5, "y": 61, "z": 1.5}}}


def test_failed_open_with_face_and_skipped_take_is_not_requeued(framework_module, tmp_path, run_async):
    bridge, controller = prepare(framework_module, tmp_path)
    controller.game_facts = unopened_facts()
    for cursor in (58, 59):
        assert run_async(controller.execute_model_call("mc_do", unopened_plan()))[0].get("execution")
        end = unopened_terminal()
        controller.receipt({"execution": end, "events": [{"run": "native-run", "cursor": cursor, "execution": end}]})
    result = run_async(controller.execute_model_call("mc_do", unopened_plan()))[0]
    assert result["code"] == "repeated_container_failure" and result["dispatched"] is False
    assert result["previous_outcome"]["kind"] == "unopened_container"
    assert result["previous_outcome"]["original_event"] == {"run": "native-run", "cursor": 59}
    assert result["previous_outcome"]["goal_verified"] is False
    assert "no withdrawal was attempted" in result["text"]
    assert len([x for x in bridge.calls if x[0] == "mc_do"]) == 2
    assert not controller.pending


@pytest.mark.parametrize("change", ["face", "target", "position", "inventory", "run", "scope", "death", "expiry", "acquisition"])
def test_failed_open_allows_changed_prerequisites(change, monkeypatch):
    import agent_mc_autonomy.container_recovery as module
    guard = module.ContainerRecovery()
    clock = [100.0]
    monkeypatch.setattr(module.time, "monotonic", lambda: clock[0])
    for cursor in (58, 59):
        guard.record(unopened_plan(), unopened_terminal(), "world", 0, {"run": "native-run", "cursor": cursor})
    args, facts, scope, epoch = unopened_plan(), unopened_facts(), "world", 0
    assert guard.repeated(args, facts, scope, epoch)
    if change == "face":
        args["steps"][1]["face"] = "west"
    elif change == "target":
        args["steps"][1]["at"] = [2, 61, 2]
    elif change == "position":
        facts["observation"]["position"]["x"] += 1
    elif change == "inventory":
        facts["observation"]["inventory"]["oak_planks"] += 1
    elif change == "run":
        facts["run"] = "next-native-run"
    elif change == "scope":
        scope = "next-world"
    elif change == "death":
        epoch = 1
    elif change == "expiry":
        clock[0] += 121
    else:
        args["steps"].insert(0, {"skill": "collect", "target": "oak_log", "count": 1})
    assert guard.repeated(args, facts, scope, epoch) is None


@pytest.mark.parametrize("broken", ["unknown_target", "unknown_position", "changed", "use_skipped", "take_failed", "missing_effect", "not_terminal"])
def test_failed_open_requires_exact_complete_measurement(broken):
    from agent_mc_autonomy.container_recovery import ContainerRecovery
    guard, end = ContainerRecovery(), unopened_terminal()
    rows = end["evidence"]["steps"]
    if broken == "unknown_target":
        rows[1]["observedEffect"]["after"]["target"] = None
    elif broken == "unknown_position":
        rows[1]["observedEffect"]["after"]["position"] = None
    elif broken == "changed":
        effect = rows[1]["observedEffect"]
        effect["after"]["position"][0] += 1
        effect["changed"]["position"] = True
        effect["status"] = "changed"
    elif broken == "use_skipped":
        rows[1]["outcome"] = "skip"
    elif broken == "take_failed":
        rows[2]["outcome"] = "fail"
    elif broken == "missing_effect":
        rows[1].pop("observedEffect")
    else:
        end["terminal"] = False
    for cursor in (58, 59):
        guard.record(unopened_plan(), end, "world", 0, {"run": "native-run", "cursor": cursor})
    assert guard.repeated(unopened_plan(), unopened_facts(), "world", 0) is None


@pytest.mark.parametrize("change,blocked", [("timestamp", True), ("jitter", True), ("target", False), ("position", False)])
def test_failed_open_compares_measured_state_across_receipts(change, blocked):
    from agent_mc_autonomy.container_recovery import ContainerRecovery
    guard = ContainerRecovery()
    guard.record(unopened_plan(), unopened_terminal(), "world", 0, {"run": "native-run", "cursor": 58})
    end = unopened_terminal()
    sample = end["evidence"]["steps"][1]["observedEffect"]
    for state in (sample["before"], sample["after"]):
        if change == "timestamp":
            state["at"] = "2026-10-18T07:05:10Z"
        elif change in {"jitter", "position"}:
            state["position"][0] += .01 if change == "jitter" else 1
        else:
            state["target"] = {"name": "chest", "stateId": 2973}
    guard.record(unopened_plan(), end, "world", 0, {"run": "native-run", "cursor": 59})
    assert bool(guard.repeated(unopened_plan(), unopened_facts(), "world", 0)) is blocked


@pytest.mark.parametrize("face", [[], {}, True, None, "automatic"])
def test_invalid_face_is_not_accepted_by_recovery(face):
    from agent_mc_autonomy.container_recovery import ContainerRecovery
    guard, args = ContainerRecovery(), unopened_plan()
    args["steps"][1]["face"] = face
    for cursor in (58, 59):
        guard.record(args, unopened_terminal(), "world", 0, {"run": "native-run", "cursor": cursor})
    assert guard.repeated(args, unopened_facts(), "world", 0) is None

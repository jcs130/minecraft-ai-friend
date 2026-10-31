"""Real controller evidence for completed controls returning to their origin."""
import copy
import json
import math

import pytest

from test_controller import action
from test_effect_recovery import effect, finish, prepare


PLAN = {"steps": [
    {"skill": "control", "mode": "ground", "keys": ["jump"], "durationMs": 300},
    {"skill": "control", "mode": "ground", "keys": ["forward"], "durationMs": 500},
]}


def terminal(*, displaced=False, stock=False):
    origin = [1.5, 61.0, 1.5]
    peak = [1.5, 62.25, 1.5]
    destination = [2.5, 61.0, 1.5] if displaced else origin
    rows = []
    for i, (before, after) in enumerate([(origin, peak), (peak, destination)]):
        sample = effect()
        sample.update(skill="control", at=None, status="changed")
        sample["before"].update(target=None, position=copy.deepcopy(before))
        sample["after"].update(target=None, position=copy.deepcopy(after))
        sample["changed"].update(target=None, position=math.dist(before, after) > .05)
        if stock and i == 1:
            sample["after"]["inventory"]["cobblestone"] += 1
            sample["changed"]["inventory"] = True
        rows.append({"step": i+1, "outcome": "ok", "observedEffect": sample})
    return {**action(True), "evidence": {"steps": rows, "receipt": "Controls completed; inspect dated positions before claiming route progress."}}


@pytest.mark.parametrize("intermediate_facts", [False, True])
def test_control_roundtrip_keeps_native_failure(framework_module, tmp_path, run_async, intermediate_facts):
    bridge, controller = prepare(framework_module, tmp_path)
    scope = {"realm": "test-realm", "account": "test-account", "agent": "Test"}
    controller.game_scope = scope
    controller.game_facts["parts"] = [{"key": "identity", "text": json.dumps(scope)}]
    finish(controller, run_async)
    previous = copy.deepcopy(controller.tool_failure)
    controller.read_activity = {"mc_scout": 4}
    run_async(controller.execute_model_call("mc_do", copy.deepcopy(PLAN)))
    if intermediate_facts:
        facts = copy.deepcopy(controller.game_facts)
        facts["observation"]["position"]["y"] = 62.25
        controller.observe_game_facts(facts)
        facts["observation"]["position"]["y"] = 61
        controller.observe_game_facts(facts)
    value = terminal()
    raw = copy.deepcopy(value)
    controller.receipt({"execution": value, "events": [{"run": "native-run", "cursor": 201, "execution": value}]})
    assert controller.tool_failure == previous, "Jumping up and landing at the same point did not repair the failed native task"
    if not intermediate_facts:
        assert controller.read_activity == {"mc_scout": 4}
    assert value == raw, "Raw successful steps must remain successful with their original observations"
    outcome = controller.native_outcomes[-1]
    assert outcome["phase"] == "completed" and outcome["goal_verified"] is False
    motion = outcome["control_motion"]
    assert motion["returns_to_start"] is True and motion["net_distance"] == 0
    assert motion["moving_steps"] == 2 and motion["other_effects_observed"] is False
    assert len([call for call in bridge.calls if call[0] == "mc_do"]) == 2
    from agent_mc_autonomy.observations import native_outcome_view
    from agent_mc_autonomy.context import assemble
    assert native_outcome_view(outcome)["control_motion"] == motion
    messages, _ = assemble("rules", [], "survive", {}, [], [], context_tokens=32768,
                           reserved_output=2048, native_outcomes=controller.native_outcomes)
    assert json.loads(messages[-1]["content"])["recent_native_outcomes"][-1]["control_motion"] == motion
    from agent_mc_autonomy.review_evidence import compact
    assert compact({"native_outcomes": [outcome]}, "offline-evidence")["native_outcomes"][0]["control_motion"] == motion


def test_net_movement_and_stock_remain_real_changes(framework_module, tmp_path, run_async):
    for name, options in [("motion", {"displaced": True}), ("stock", {"stock": True})]:
        bridge, controller = prepare(framework_module, tmp_path/name)
        finish(controller, run_async)
        run_async(controller.execute_model_call("mc_do", copy.deepcopy(PLAN)))
        controller.receipt({"execution": terminal(**options)})
        assert controller.tool_failure is None


@pytest.mark.parametrize("broken", ["unknown", "missing", "gap", "dimension", "mixed", "attack_key", "single", "malformed", "nonterminal", "invalid_mode", "unknown_window"])
def test_uncertain_or_noncontrol_batches_do_not_claim_a_roundtrip(broken):
    from agent_mc_autonomy.control_motion import derive_control_motion
    args, execution = copy.deepcopy(PLAN), terminal()
    first, second = execution["evidence"]["steps"]
    if broken == "unknown":
        second["observedEffect"]["after"]["inventory"] = None
    elif broken == "missing":
        second.pop("observedEffect")
    elif broken == "gap":
        second["observedEffect"]["before"]["position"][0] += 3
    elif broken == "dimension":
        second["observedEffect"]["dimension"] = "minecraft:the_nether"
    elif broken == "mixed":
        args["steps"][1]["skill"] = "attack"
    elif broken == "attack_key":
        args["steps"][1]["keys"] = ["attack"]
    elif broken == "single":
        args["steps"] = args["steps"][:1]
        execution["evidence"]["steps"] = [first]
    elif broken == "malformed":
        second["step"] = 1
    elif broken == "invalid_mode":
        args["steps"][1]["mode"] = []
    elif broken == "unknown_window":
        second["observedEffect"]["after"].pop("window")
        second["observedEffect"]["changed"]["window"] = None
    else:
        execution["terminal"] = False
    assert derive_control_motion(args, execution) is None


def test_public_control_motion_projection_checks_geometry_and_detaches():
    from agent_mc_autonomy import control_motion_view, derive_control_motion
    value = derive_control_motion(PLAN, terminal())
    projected = control_motion_view(value)
    assert projected and projected["coverage"] == "client-visible-only" and projected["goal_verified"] is False
    projected["origin"][0] = 100
    assert value["origin"][0] == 1.5
    bad = {**value, "net_distance": 8}
    assert control_motion_view(bad) is None
    bad = {**value, "returns_to_start": False}
    assert control_motion_view(bad) is None

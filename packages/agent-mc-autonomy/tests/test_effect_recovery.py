"""Replay accepted-but-ineffective furnace work without a real game/model."""
import copy
import json

import pytest

from agent_mc_autonomy.context import assemble
from test_controller import action, setup


PLAN = {"steps": [{"skill": "smelt", "input": "iron_ingot", "count": 2,
                   "fuel": "cobblestone", "at": [1, 61, 2]}]}


def effect(changed=False):
    before = {"at": "2026-10-17T12:30:40Z", "target": {"name": "furnace", "stateId": 4295},
              "inventory": {"iron_ingot": 2, "cobblestone": 31}, "position": [1.5, 61, 1.5], "window": None}
    after = copy.deepcopy(before)
    after["at"] = "2026-10-17T12:30:43Z"
    if changed:
        after["inventory"]["iron_ingot"] = 1
    return {"schema": "agent-mc-observed-effect/v1", "skill": "smelt", "dimension": "minecraft:overworld",
            "at": [1, 61, 2], "before": before, "after": after,
            "changed": {"target": False, "inventory": changed, "position": False, "window": False},
            "status": "changed" if changed else "unchanged", "coverage": "client-visible-only", "goalVerified": False}


def prepare(framework_module, tmp_path):
    _, bridge, controller = setup(framework_module, tmp_path, None)
    controller.game_scope = "test-world-and-account"
    controller.game_facts = {"observation": {"dimension": "minecraft:overworld",
        "inventory": effect()["after"]["inventory"], "position": {"x": 1.5, "y": 61, "z": 1.5}}}
    controller.last_admission_facts = "same scene"
    return bridge, controller


def finish(controller, run_async, *, changed=False, phase="blocked", args=None, raw_effect=True):
    run_async(controller.execute_model_call("mc_do", copy.deepcopy(args or PLAN)))
    terminal = {**action(terminal=True), "phase": phase, "evidence": {
        "receipt": "熔炉燃料槽未读到指定的圆石，炉火未起；本次未放入铁锭，先核对燃料和配方。",
        "steps": [{"step": 1, "outcome": "fail" if phase == "blocked" else "ok",
                   "why": "燃料槽没有圆石，炉火未起", **({"observedEffect": effect(changed)} if raw_effect else {})}]}}
    controller.receipt({"execution": terminal, "events": [{"run": "native-run", "cursor": 96,
                                                           "execution": terminal}]})


def test_terminal_effect_reaches_planner_and_public_projection(framework_module, tmp_path, run_async):
    from agent_mc_autonomy.observations import native_outcome_view
    _, controller = prepare(framework_module, tmp_path)
    finish(controller, run_async)
    projected = native_outcome_view(controller.native_outcomes[-1])
    sample = projected["step_outcomes"]["samples"][0]
    assert sample["observed_effect"]["status"] == "unchanged"
    assert sample["observed_effect"]["changed"] == effect()["changed"]
    assert sample["observed_effect"]["coverage"] == "client-visible-only"
    assert sample["observed_effect"]["goal_verified"] is False
    messages, _ = assemble("rules", [], "survive", {}, [], [], context_tokens=32768,
                           reserved_output=2048, native_outcomes=controller.native_outcomes)
    assert json.loads(messages[-1]["content"])["recent_native_outcomes"][-1] == projected


@pytest.mark.parametrize("phase,changed,raw,cleared", [
    ("blocked", False, True, False), ("completed", False, True, False),
    ("completed", False, False, False), ("blocked", True, True, True)])
def test_only_observed_change_clears_read_activity(framework_module, tmp_path, run_async, phase, changed, raw, cleared):
    _, controller = prepare(framework_module, tmp_path)
    controller.read_activity = {"mc_scout": 7}
    run_async(controller.execute_model_call("mc_do", copy.deepcopy(PLAN)))
    assert controller.read_activity == {"mc_scout": 7}, "acceptance erased unproductive reads"
    # Use the correlated accepted task's real terminal, with no second dispatch.
    terminal = {**action(terminal=True), "phase": phase, "evidence": {"steps": [
        {"step": 1, "outcome": "ok", **({"observedEffect": effect(changed)} if raw else {})}]}}
    controller.receipt({"execution": terminal})
    assert (controller.read_activity == {}) == cleared


def test_identical_no_effect_plan_cannot_loop_by_changing_narration_or_queue(framework_module, tmp_path, run_async):
    bridge, controller = prepare(framework_module, tmp_path)
    finish(controller, run_async)
    finish(controller, run_async)
    result = run_async(controller.execute_model_call("mc_do", {**PLAN, "queue": "now", "_spoken_text": "try again"}))[0]
    assert result.get("dispatched") is False
    assert result["code"] == "repeated_no_effect"
    assert len([call for call in bridge.calls if call[0] == "mc_do"]) == 2
    assert not controller.pending
    assert result["previous_outcome"]["original_event"] == {"run": "native-run", "cursor": 96}
    assert result["previous_outcome"]["goal_verified"] is False


def test_completed_existing_stock_does_not_bypass_exact_plan_recovery(framework_module, tmp_path, run_async):
    bridge, controller = prepare(framework_module, tmp_path)
    args = {"steps": [{"skill": "goto", "at": [1, 61, 2]},
                      {"skill": "craft", "item": "bread", "count": 1}]}
    inventory = {"bread": 1, "cobblestone": 31}
    controller.game_facts["observation"]["inventory"] = inventory
    samples = []
    for index, skill in enumerate(("goto", "craft"), 1):
        value = effect()
        value["skill"] = skill
        value["before"]["inventory"] = copy.deepcopy(inventory)
        value["after"]["inventory"] = copy.deepcopy(inventory)
        samples.append({"step": index, "outcome": "ok", "observedEffect": value})
    for _ in range(2):
        run_async(controller.execute_model_call("mc_do", copy.deepcopy(args)))
        terminal = {**action(True), "phase": "completed", "evidence": {
            "receipt": "Already holding the requested stock; no new item was crafted.",
            "steps": copy.deepcopy(samples)}}
        controller.receipt({"execution": terminal, "events": [{"run": "native-run", "cursor": 96, "execution": terminal}]})
    result = run_async(controller.execute_model_call("mc_do", {**args, "_spoken_text": "Another line"}))[0]
    assert result.get("dispatched") is False
    assert result["code"] == "repeated_no_effect"
    assert len([call for call in bridge.calls if call[0] == "mc_do"]) == 2
    assert result["previous_outcome"]["goal_verified"] is False
    assert result["previous_outcome"]["original_event"] == {"run": "native-run", "cursor": 96}
    # Consuming that stock is new evidence: the same plan can be useful again.
    controller.game_facts["observation"]["inventory"] = {"cobblestone": 31}
    assert run_async(controller.execute_model_call("mc_do", copy.deepcopy(args)))[0].get("execution")


def test_completed_without_effect_samples_does_not_prohibit_real_work(framework_module, tmp_path, run_async):
    bridge, controller = prepare(framework_module, tmp_path)
    for _ in range(3):
        run_async(controller.execute_model_call("mc_do", copy.deepcopy(PLAN)))
        controller.receipt({"execution": {**action(True), "phase": "completed", "evidence": {
            "receipt": "Completed without measurements", "steps": [{"step": 1, "outcome": "ok"}]}}})
    assert len([call for call in bridge.calls if call[0] == "mc_do"]) == 3


@pytest.mark.parametrize("change", ["inventory", "position", "dimension", "scope", "death", "plan", "expiry"])
def test_changed_evidence_and_different_work_stay_available(framework_module, tmp_path, run_async, monkeypatch, change):
    import agent_mc_autonomy.effects as module
    clock = [100.0]
    monkeypatch.setattr(module.time, "monotonic", lambda: clock[0])
    bridge, controller = prepare(framework_module, tmp_path)
    finish(controller, run_async)
    finish(controller, run_async)
    args = copy.deepcopy(PLAN)
    if change == "inventory":
        controller.game_facts["observation"]["inventory"] = {"iron_ingot": 3, "cobblestone": 31}
    elif change == "position":
        controller.game_facts["observation"]["position"]["x"] += 1
    elif change == "dimension":
        controller.game_facts["observation"]["dimension"] = "minecraft:the_nether"
    elif change == "scope":
        controller.game_scope = "other-world"
    elif change == "death":
        controller.death_epoch += 1
    elif change == "plan":
        args["steps"][0]["input"] = "raw_iron"
        args["steps"][0]["fuel"] = "coal"
    else:
        clock[0] += 121
    assert run_async(controller.execute_model_call("mc_do", args))[0].get("execution")
    assert len([call for call in bridge.calls if call[0] == "mc_do"]) == 3


@pytest.mark.parametrize("broken", ["missing", "coverage", "status", "nonfinite", "unknown", "duplicate"])
def test_uncertain_or_malformed_effects_never_prohibit_retries(framework_module, tmp_path, run_async, broken):
    _, controller = prepare(framework_module, tmp_path)
    for _ in range(3):
        assert run_async(controller.execute_model_call("mc_do", copy.deepcopy(PLAN)))[0].get("execution")
        value = effect()
        if broken == "coverage": value["coverage"] = "model-inferred"
        elif broken == "status": value["status"] = "changed"
        elif broken == "nonfinite": value["after"]["position"][0] = float("nan")
        elif broken == "unknown":
            value["after"]["inventory"] = None
            value["changed"]["inventory"] = None
            value["status"] = "unknown"
        row = {"step": 1, "outcome": "fail", **({"observedEffect": value} if broken != "missing" else {})}
        controller.receipt({"execution": {**action(True), "phase": "blocked", "evidence": {
            "steps": [row, row] if broken == "duplicate" else [row]}}})


def test_build_preview_does_not_reset_observation_history(framework_module, tmp_path, run_async):
    from agent_mc_autonomy.controller import observation_call
    _, controller = prepare(framework_module, tmp_path)
    args = {"steps": [{"skill": "build", "material": "furnace", "anchors": [[1, 61, 2]], "dryRun": True}]}
    assert observation_call("mc_do", args)
    controller.read_activity = {"mc_scout": 5}
    run_async(controller.execute_model_call("mc_do", args))
    assert controller.read_activity == {"mc_scout": 5, "mc_do": 1}


@pytest.mark.parametrize("sample,cleared", [
    ("unchanged", False), ("unknown", False), ("missing", False),
    ("forged_change", False), ("changed", True),
])
def test_completed_item_request_only_retires_a_native_failure_after_validated_change(
        framework_module, tmp_path, run_async, sample, cleared):
    bridge, controller = prepare(framework_module, tmp_path)
    finish(controller, run_async)
    failure = copy.deepcopy(controller.tool_failure)
    task = {**action(), "id": "later-item-use"}
    bridge.result = {"protocol": "agent-mc/v1", "text": "queued", "execution": task}
    run_async(controller.execute_model_call("mc_do", {"steps": [{"skill": "use", "item": "player_head"}]}))
    assert controller.tool_failure == failure, "an accepted request is not recovery"
    value = effect(changed=sample == "changed")
    value.update(skill="use", at=None)
    value["changed"]["target"] = None
    if sample == "unknown":
        value["after"]["inventory"] = None
        value["changed"]["inventory"] = None
        value["status"] = "unknown"
    if sample == "forged_change":
        value["changed"]["inventory"] = True
        value["status"] = "changed"  # The before/after samples disprove it.
    row = {"step": 1, "outcome": "ok", **({"observedEffect": value} if sample != "missing" else {})}
    controller.receipt({"execution": {**task, "phase": "completed", "terminal": True,
        "evidence": {"receipt": "Item-use request sent; its completion alone is not an observed effect.", "steps": [row]}}})
    assert (controller.tool_failure is None) is cleared
    if not cleared:
        assert controller.tool_failure == failure
    assert controller.native_outcomes[-1]["goal_verified"] is False


def test_failed_skill_reference_is_read_once_and_retained_for_recovery(framework_module, tmp_path, run_async):
    bridge, controller = prepare(framework_module, tmp_path)
    bridge.tools.append({"name": "mc_help", "inputSchema": {"type": "object"}})
    finish(controller, run_async)
    run_async(controller.recovery_reference())
    run_async(controller.recovery_reference())
    assert [args for name, args, _ in bridge.calls if name == "mc_help"] == [{"skill": "smelt"}]
    assert controller.tool_failure["recovery"][0]["tool"] == "mc_help"
    assert controller.tool_failure["failed_skills"] == ["smelt"]
    assert not controller.pending
    messages, _ = assemble("rules", [], "survive", {}, [], [], context_tokens=32768,
                           reserved_output=2048, tool_failure=controller.tool_failure)
    assert json.loads(messages[-1]["content"])["tool_failure"]["recovery"][0]["arguments"] == {"skill": "smelt"}


def test_native_event_effect_payload_is_bounded_without_losing_its_original(framework_module, tmp_path, run_async):
    _, controller = prepare(framework_module, tmp_path)
    finish(controller, run_async)
    event = controller.recent[-1]
    event["execution"]["evidence"]["steps"][0]["observedEffect"]["before"]["inventory"].update(
        {f"item_{i}": 64 for i in range(100)})
    event["execution"]["evidence"]["steps"][0]["observedEffect"]["after"]["inventory"].update(
        {f"item_{i}": 64 for i in range(100)})
    messages, _ = assemble("rules", [], "survive", {}, [event], [], context_tokens=16000, reserved_output=2048)
    projected = json.loads(messages[-1]["content"])["events"][0]
    assert "steps" not in projected["execution"]["evidence"]
    assert projected["execution"]["evidence"]["step_outcomes"]["samples"][0]["observed_effect"]["status"] == "unchanged"
    assert projected["original"]["run"] == "native-run" and projected["original"]["after"] == 95
    assert "item_99" not in json.dumps(projected)


def test_unknown_help_delivery_still_preserves_the_uncertainty_fence(framework_module, tmp_path, run_async):
    bridge, controller = prepare(framework_module, tmp_path)
    bridge.tools.append({"name": "mc_help", "inputSchema": {"type": "object"}})
    finish(controller, run_async)
    previous = bridge.call
    async def call(name, args, **metadata):
        if name == "mc_help":
            raise RuntimeError("outcome_unknown: read delivery was lost")
        return await previous(name, args, **metadata)
    bridge.call = call
    with pytest.raises(RuntimeError, match="outcome_unknown"):
        run_async(controller.recovery_reference())
    state = json.loads((tmp_path / "host-state.json").read_text(encoding="utf-8"))
    assert state["uncertain"] and state["inflight_request"]
    assert "smelt" not in controller.skill_references

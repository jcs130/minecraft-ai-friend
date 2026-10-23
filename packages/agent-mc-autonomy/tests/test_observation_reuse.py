"""Replay the live repeated four-quadrant voxel scout across native turns."""
import copy
import dataclasses
import json

import pytest
from test_controller import action, setup

from agent_mc_autonomy.context import assemble

PLAN = {"steps": [{"skill": "observe", "mode": "voxels", "bounds": bounds} for bounds in (
    [-16, -1, -16, -9, 1, -9], [-8, -1, -16, -1, 1, -9],
    [-16, -1, -8, -9, 1, -1], [-8, -1, -8, -1, 1, -1])]}


def spatial_receipt():
    # The real batch's long header previously occupied the entire 450-byte preview.
    values = [{"source": "client-visible-world", "observedAt": "2026-10-17T01:17:38Z",
               "dimension": "overworld", "kind": "voxels", "bounds": [i, 64, 0, i, 64, 0],
               "frame": {"feet": [-567, 65, -389]}, "order": "y,z,x; x fastest",
               "unknownCells": 1, "cells": [-1], "palette": []} for i in range(4)]
    return "任务读数标题" * 60 + "\n" + "\n".join(json.dumps(value, ensure_ascii=False) for value in values)


def observed(controller, run_async, name="mc_scout", arguments=None):
    result = run_async(controller.execute_model_call(name, copy.deepcopy(arguments or PLAN)))[0]
    if result.get("execution"):
        terminal = {**action(terminal=True), "evidence": {"receipt": spatial_receipt(),
                    "steps": [{"step": i, "outcome": "ok"} for i in range(1, 5)]}}
        controller.receipt({"execution": terminal, "events": [{"run": "run-1", "cursor": 7,
                            "execution": terminal}]})
    return result


def prepare(framework_module, tmp_path):
    _, bridge, controller = setup(framework_module, tmp_path, None)
    bridge.tools.append({"name": "mc_scout", "inputSchema": {"type": "object"}})
    original = bridge.call

    async def call(name, args, **metadata):
        return await original("mc_do" if name == "mc_scout" else name, args, **metadata)

    bridge.call = call
    controller.last_admission_facts = "same position, stock and visible scene"
    return bridge, controller


def test_first_two_new_spatial_answers_can_handoff_without_ordinary_event_delay(
        framework_module, tmp_path, run_async):
    _, controller = prepare(framework_module, tmp_path)
    for index in range(3):
        controller.continuation_ready = False
        plan = {"steps": [{"skill": "observe", "mode": "sites", "sites": [[index, 64, 0]]}]}
        assert observed(controller, run_async, arguments=plan).get("execution")
        assert controller.continuation_ready is (index < 2), (
            "A requested new answer must reach the planner promptly, but successive scans must remain bounded"
        )
        assert not controller.pending
    assert controller.read_activity == {"mc_scout": 3}


def test_documentation_and_inventory_reads_do_not_consume_spatial_handoff_slots(
        framework_module, tmp_path, run_async):
    _, controller = prepare(framework_module, tmp_path)
    controller.read_activity = {"mc_help": 3, "mc_bag": 1}
    assert observed(controller, run_async).get("execution")
    assert controller.continuation_ready
    assert controller.read_activity == {"mc_help": 3, "mc_bag": 1, "mc_scout": 1}


@pytest.mark.parametrize("phase", ["blocked", "partial", "rejected"])
def test_failed_spatial_read_does_not_bypass_planner_backoff(
        framework_module, tmp_path, run_async, phase):
    _, controller = prepare(framework_module, tmp_path)
    assert run_async(controller.execute_model_call("mc_scout", copy.deepcopy(PLAN)))[0].get("execution")
    end = {**action(True), "phase": phase, "evidence": {"receipt": "The query did not complete"}}
    controller.receipt({"execution": end})
    assert not controller.continuation_ready


def test_spatial_answer_cannot_create_handoff_while_other_native_work_is_pending(
        framework_module, tmp_path, run_async):
    _, controller = prepare(framework_module, tmp_path)
    assert run_async(controller.execute_model_call("mc_scout", copy.deepcopy(PLAN)))[0].get("execution")
    controller.pending[("task", "other-body-work")] = {"terminal": False}
    end = {**action(True), "evidence": {"receipt": spatial_receipt()}}
    controller.receipt({"execution": end})
    assert not controller.continuation_ready
    assert ("task", "other-body-work") in controller.pending


def test_completed_scout_is_not_queued_again_under_unchanged_facts(framework_module, tmp_path, run_async):
    bridge, controller = prepare(framework_module, tmp_path)
    assert observed(controller, run_async).get("execution")
    # Model/tool call IDs, task clocks and a revised host goal are not new scene data.
    controller.groups.clear()
    controller.active_goal = {"id": "revised", "origin": "host_review", "goal": "walk west"}
    result = observed(controller, run_async)
    native = [call for call in bridge.calls if call[0] == "mc_do"]
    assert len(native) == 1, "same scout is still being dispatched indefinitely"
    assert result["dispatched"] is False and not result.get("execution")
    assert result["code"] == "observation_already_answered"
    assert result["previous_observation"]["original_event"] == {"run": "run-1", "cursor": 7}
    assert result["previous_observation"]["fresh"] is False
    assert len(result["previous_observation"]["observations"]) == 4
    assert controller.read_activity == {"mc_scout": 1}
    assert not controller.pending


def test_completed_voxels_and_route_scout_reuses_its_original_receipt(framework_module, tmp_path, run_async):
    bridge, controller = prepare(framework_module, tmp_path)
    plan = {"steps": [{"skill": "observe", "mode": "voxels", "bounds": [-3, -1, -3, 3, 4, 3]},
                      {"skill": "goto", "at": [10, 70, 10], "dryRun": True}]}
    assert observed(controller, run_async, arguments=plan).get("execution")
    result = observed(controller, run_async, arguments=plan)
    assert result.get("code") == "observation_already_answered"
    assert result["dispatched"] is False and result["previous_observation"]["execution_id"] == "body-1"
    assert len([row for row in bridge.calls if row[0] == "mc_do"]) == 1


def test_slow_full_context_inference_does_not_expire_answered_scout(
        framework_module, tmp_path, run_async, monkeypatch):
    import agent_mc_autonomy.controller as module
    ticks = [100.0]
    monkeypatch.setattr(module.time, "monotonic", lambda: ticks[0])
    bridge, controller = prepare(framework_module, tmp_path)
    plan = {"steps": [{"skill": "observe", "mode": "voxels", "bounds": [-3, -2, -3, 3, 4, 3]},
                      {"skill": "build", "anchors": [[10, 64, 20], [12, 64, 22]],
                       "material": "bamboo", "shape": "rect", "dryRun": True}]}
    assert observed(controller, run_async, arguments=plan).get("execution")
    ticks[0] += 75  # Actual full-window response plus host review/dispatch overhead.
    result = observed(controller, run_async, arguments=plan)
    assert result.get("code") == "observation_already_answered"
    assert result.get("dispatched") is False
    assert len([row for row in bridge.calls if row[0] == "mc_do"]) == 1
    assert result["previous_observation"]["fresh"] is False


def test_dry_run_body_port_does_not_bypass_answered_scout(framework_module, tmp_path, run_async):
    bridge, controller = prepare(framework_module, tmp_path)
    plan = {"steps": [{"skill": "observe", "mode": "voxels", "bounds": [-3, -2, -3, 3, 4, 3]},
                      {"skill": "build", "material": "bamboo", "anchors": [[1, 64, 1]], "dryRun": True}]}
    assert observed(controller, run_async, arguments=plan).get("execution")
    result = observed(controller, run_async, "mc_do", plan)
    assert result.get("code") == "observation_already_answered"
    assert result.get("dispatched") is False
    assert len([row for row in bridge.calls if row[0] == "mc_do"]) == 1


def test_preview_without_voxel_json_reuses_receipt_but_real_build_stays_available(
        framework_module, tmp_path, run_async):
    bridge, controller = prepare(framework_module, tmp_path)
    preview = {"steps": [{"skill": "build", "anchors": [[1, 64, 1]], "material": "bamboo", "dryRun": True}]}
    assert run_async(controller.execute_model_call("mc_scout", preview))[0].get("execution")
    text = "试算：需要一块竹子，当前有十块。没有放置、移动或挖掘。"
    end = {**action(True), "evidence": {"receipt": text, "steps": [{"step": 1, "outcome": "ok"}]}}
    controller.receipt({"execution": end, "events": [{"run": "run-1", "cursor": 9, "execution": end}]})
    repeated = run_async(controller.execute_model_call("mc_do", copy.deepcopy(preview)))[0]
    assert repeated.get("code") == "observation_already_answered" and repeated["dispatched"] is False
    assert repeated["previous_observation"]["receipt"] == text
    assert repeated["previous_observation"]["original_event"] == {"run": "run-1", "cursor": 9}
    real = copy.deepcopy(preview)
    real["steps"][0]["dryRun"] = False
    assert run_async(controller.execute_model_call("mc_do", real))[0].get("execution")
    assert len([row for row in bridge.calls if row[0] == "mc_do"]) == 2


def test_completed_task_without_any_answer_does_not_block_a_real_read(framework_module, tmp_path, run_async):
    _, controller = prepare(framework_module, tmp_path)
    assert run_async(controller.execute_model_call("mc_scout", copy.deepcopy(PLAN)))[0].get("execution")
    controller.receipt({"execution": {**action(True), "evidence": {"steps": [{"step": 1, "outcome": "ok"}]}}})
    assert run_async(controller.execute_model_call("mc_scout", copy.deepcopy(PLAN)))[0].get("execution")


def test_slow_repeated_scout_yields_a_recovery_round_with_body_work(
        framework_module, tmp_path, run_async, monkeypatch):
    import agent_mc_autonomy.controller as module
    ticks, seen = [100.0], []
    monkeypatch.setattr(module.time, "monotonic", lambda: ticks[0])
    bridge, controller = prepare(framework_module, tmp_path)
    controller.settings = dataclasses.replace(controller.settings, max_tool_rounds=1)

    async def decide(messages, tools):
        available = {tool["function"]["name"] for tool in tools}
        seen.append((messages, available))
        ticks[0] += 75
        name = "mc_scout" if "mc_scout" in available else "mc_do"
        args = PLAN if name == "mc_scout" else {"steps": [{"skill": "goto", "at": [1, 65, 1]}]}
        return {"tool_calls": [{"id": "round-" + str(len(seen)), "type": "function",
                                "function": {"name": name, "arguments": json.dumps(args)}}]}

    controller.decide = decide
    tools = module.model_tools(bridge.tools)
    run_async(controller.turn_once("survive", "rules", tools))
    end = {**action(True), "evidence": {"receipt": spatial_receipt(),
           "steps": [{"step": index, "outcome": "ok"} for index in range(1, 5)]}}
    controller.receipt({"execution": end, "events": [{"run": "run-1", "cursor": 7, "execution": end}]})
    run_async(controller.turn_once("survive", "rules", tools))
    run_async(controller.turn_once("survive", "rules", tools))
    assert "mc_scout" not in seen[-1][1] and {"mc_do", "mc_original"} <= seen[-1][1]
    assert "observation_already_answered" in json.dumps(seen[-1][0])
    native = [row for row in bridge.calls if row[0] == "mc_do"]
    assert len(native) == 2 and native[-1][1]["steps"][0]["skill"] == "goto"


def test_terminal_read_retains_each_result_after_long_batch_header(framework_module, tmp_path, run_async):
    _, controller = prepare(framework_module, tmp_path)
    observed(controller, run_async)
    row = controller.native_outcomes[-1]
    assert len(row.get("observations", [])) == 4, "terminal preview has only the task header"
    assert all(value["unknownCells"] == 1 for value in row["observations"])
    messages, _ = assemble("rules", [], "survive", {}, [], [], context_tokens=16000,
                           reserved_output=2048, native_outcomes=controller.native_outcomes)
    tail = json.loads(messages[-1]["content"])
    assert len(tail["recent_native_outcomes"][-1]["observations"]) == 4
    assert "unknown" in tail["recent_native_outcomes"][-1]["observation_guidance"]


@pytest.mark.parametrize("change", ["facts", "arguments", "scope", "expiry", "body_action"])
def test_fresh_evidence_and_new_work_allow_scout_again(framework_module, tmp_path, run_async, monkeypatch, change):
    import agent_mc_autonomy.controller as module
    ticks = [100.0]
    monkeypatch.setattr(module.time, "monotonic", lambda: ticks[0])
    bridge, controller = prepare(framework_module, tmp_path)
    observed(controller, run_async)
    arguments = copy.deepcopy(PLAN)
    if change == "facts":
        controller.last_admission_facts = "player moved or observed stock/scene changed"
    elif change == "arguments":
        arguments["steps"][0]["bounds"][0] += 1
    elif change == "scope":
        controller.game_scope = "other connection"
    elif change == "expiry":
        ticks[0] += 301
    else:
        observed(controller, run_async, "mc_do", {"steps": [{"skill": "goto", "at": [1, 65, 1]}]})
        # A terminal without physical readbacks proves no motion by itself.
        controller.game_facts = {"observation": {"dimension": "overworld", "position": {"x": 0, "y": 65, "z": 0}}}
        controller.observe_game_facts({"observation": {"dimension": "overworld", "position": {"x": 1, "y": 65, "z": 1}}})
    assert observed(controller, run_async, arguments=arguments).get("execution")
    assert len([call for call in bridge.calls if call[0] == "mc_do"]) == (3 if change == "body_action" else 2)


def test_acceptance_alone_does_not_cache_or_invent_an_observation(framework_module, tmp_path, run_async):
    bridge, controller = prepare(framework_module, tmp_path)
    run_async(controller.execute_model_call("mc_scout", copy.deepcopy(PLAN)))
    run_async(controller.execute_model_call("mc_scout", copy.deepcopy(PLAN)))
    assert len([call for call in bridge.calls if call[0] == "mc_do"]) == 2


def test_mixed_body_steps_are_never_reused_as_observation(framework_module, tmp_path, run_async):
    bridge, controller = prepare(framework_module, tmp_path)
    plan = {"steps": [*PLAN["steps"], {"skill": "goto", "at": [1, 65, 1]}]}
    observed(controller, run_async, "mc_do", plan)
    assert observed(controller, run_async, "mc_do", plan).get("execution")
    assert len([call for call in bridge.calls if call[0] == "mc_do"]) == 2


def test_repeated_read_through_mc_do_keeps_actual_body_actions_available(framework_module, tmp_path, run_async):
    bridge, controller = prepare(framework_module, tmp_path)
    import agent_mc_autonomy.controller as module
    controller.last_admission_facts = module.admission_fingerprint(
        {"parts": [{"key": "world", "text": "health=20", "original": "log:health"}]})
    observed(controller, run_async, "mc_do", PLAN)
    assert observed(controller, run_async, "mc_do", PLAN)["dispatched"] is False

    async def decide(_messages, tools):
        assert "mc_do" in {tool["function"]["name"] for tool in tools}, "A read cannot hide the body action port"
        return {"tool_calls": [{"id": "actual-work", "type": "function", "function": {
            "name": "mc_do", "arguments": json.dumps({"steps": [{"skill": "goto", "at": [1, 65, 1]}]})}}]}

    controller.decide = decide
    run_async(controller.turn_once("survive", "native contract", module.model_tools(bridge.tools)))
    assert len([call for call in bridge.calls if call[0] == "mc_do"]) == 2


def test_repeated_inventory_read_yields_one_recovery_decision_with_other_tools(
        framework_module, tmp_path, run_async):
    seen = []

    async def decide(messages, tools):
        available = {tool["function"]["name"] for tool in tools}
        seen.append((messages, available))
        name = "mc_bag" if "mc_bag" in available else "mc_do"
        return {"content": None, "tool_calls": [{"id": "call-" + str(len(seen)), "type": "function",
            "function": {"name": name, "arguments": json.dumps(
                {"item": "大背包"} if name == "mc_bag" else {"steps": [{"skill": "goto", "at": [1, 65, 1]}]})}}]}

    module, bridge, controller = setup(framework_module, tmp_path, decide)
    controller.settings = dataclasses.replace(controller.settings, max_tool_rounds=4)
    bridge.tools.append({"name": "mc_bag", "inputSchema": {"type": "object"}})
    tools = module.model_tools(bridge.tools)
    run_async(controller.turn_once("survive", "rules", tools))
    run_async(controller.turn_once("survive", "rules", tools))
    assert len([call for call in bridge.calls if call[0] == "mc_bag"]) == 1
    assert len([call for call in bridge.calls if call[0] == "mc_do"]) == 1
    assert "mc_bag" not in seen[-1][1] and {"mc_do", "mc_original"} <= seen[-1][1]
    assert "read_already_answered" in json.dumps(seen[-1][0])
    recovery = next(json.loads(message["content"])["previous_answer"] for message in seen[-1][0]
                    if message.get("role") == "tool" and "read_already_answered" in message.get("content", ""))
    assert recovery["received_at"] and recovery["request_id"] and recovery["turn_id"]
    assert recovery["journal"] == "receipts.jsonl" and recovery["fresh"] is False
    assert controller.pending[("task", "body-1")]["terminal"] is False


@pytest.mark.parametrize("change", ["facts", "arguments", "scope", "expiry"])
def test_inventory_reuse_does_not_hide_changed_state(framework_module, tmp_path, run_async, monkeypatch, change):
    import agent_mc_autonomy.controller as module
    ticks = [100.0]
    monkeypatch.setattr(module.time, "monotonic", lambda: ticks[0])
    bridge, controller = prepare(framework_module, tmp_path)
    args = {"item": "大背包"}
    run_async(controller.execute_model_call("mc_bag", args))
    if change == "facts":
        controller.last_admission_facts = "inventory changed"
    elif change == "arguments":
        args = {"item": "chest"}
    elif change == "scope":
        controller.game_scope = "other-account"
    else:
        ticks[0] += 301
    run_async(controller.execute_model_call("mc_bag", args))
    assert len([call for call in bridge.calls if call[0] == "mc_bag"]) == 2

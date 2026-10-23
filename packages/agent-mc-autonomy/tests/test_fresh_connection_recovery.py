"""A native connection starts alive without inheriting a previous bot's death ID."""

import dataclasses
import json
from copy import deepcopy

import pytest
from test_controller import action, choose, packed, setup
from test_death_memory import SCOPE, event, facts
from test_stage_applicability import offer, propose  # shared real-port fixture
from test_stage_applicability import seam as _seam_fixture

from agent_mc_autonomy.death_memory import DeathMemory

# Keep pytest's shared fixture registration while leaving argument names free.
seam = _seam_fixture


def fresh_body(with_recovery=True):
    value = facts(episode_id=None)
    value["run"] = "new-native-run"
    value["parts"] = [p for p in value["parts"] if with_recovery or p["key"] != "recoveryState"]
    for part in value["parts"]:
        if part["key"] == "deathLifecycle":
            part["text"] = json.dumps({"phase": "alive"})
    value["parts"].append({"key": "gear", "text": "Synchronized inventory: empty"})
    return value


def restart(framework_module, tmp_path, box, body, publish):
    decisions = []

    async def decide(messages, _):
        decisions.append(messages)
        reply = choose()
        reply["tool_calls"][0]["function"]["arguments"] = json.dumps({"steps": [{"skill": "goto", "at": [301, 64, 2]}]})
        return reply

    module, bridge, controller = setup(framework_module, tmp_path, decide)
    controller.settings = dataclasses.replace(controller.settings, max_decisions=1, max_tool_rounds=1)
    controller.commands = box
    controller.publish = publish
    original = bridge.call

    async def call(name, args, **kw):
        if name == "mc_protocol" and args["action"] == "facts":
            return packed(body[0])
        if name == "mc_events":
            return packed({"run": "new-native-run", "nextCursor": 0, "events": []})
        return await original(name, args, **kw)

    bridge.call = call
    return module, bridge, controller, decisions


@pytest.mark.parametrize("completed", [False, True])
@pytest.mark.parametrize("with_recovery", [False, True])
def test_fresh_native_run_allows_real_local_action_and_new_host_stage_without_old_death_id(
        seam, framework_module, tmp_path, run_async, completed, with_recovery):
    _, _, original, box, port, body, clock, _, published, user = seam
    body[0]["run"] = "old-native-run"
    original.observe_game_facts(body[0])
    run_async(original.external_command())
    old_stage = propose(port, tmp_path)
    run_async(original.external_command())
    old_payload = deepcopy(box.goal_lineage(old_stage)[0])
    store = DeathMemory(tmp_path)
    store.record({**event(), "run": "old-native-run"}, body[0], [], [], [])
    if completed:
        store.execute(SCOPE, {"action": "report", "id": "death-1", "lesson": "Historical route hypothesis",
                             "applicability": "Only after fresh local route checks", "evidence": "old-native-run cursor 1"})
    history = deepcopy(store.entries(SCOPE))
    body[0] = fresh_body(with_recovery)
    module, bridge, controller, decisions = restart(framework_module, tmp_path, box, body, original.publish)
    controller.observe_game_facts(body[0])
    run_async(controller.events())
    assert controller.death_waiting is False and controller.death_recovery is None
    assert controller.pending == {} and controller.inflight_request is None
    assert published["death_episode"] is None
    assert box.get(old_stage)["delivery"] == "needs_reassessment"
    assert box.active_goal()["id"] == user
    assert box.goal_lineage(old_stage)[0]["stage_baseline"] == old_payload["stage_baseline"]
    assert store.entries(SCOPE) == history
    # Prove an actual local body call, not only profile/review counters while a
    # hidden recovery fence remains armed; exercise the main loop below too.
    run_async(controller.turn_once("Explore and build a home", "prefix", module.model_tools(bridge.tools)))
    sent = [args for name, args, _ in bridge.calls if name == "mc_do"]
    assert sent == [{"steps": [{"skill": "goto", "at": [301, 64, 2]}], "queue": "afterCheckpoint"}]
    assert decisions and "Historical host proposal" in json.dumps(decisions)
    controller.receipt({"execution": action(True)})
    clock[0] += 180
    controller.publish()
    review_id = offer(port, tmp_path)
    inspected = port.decide(review_id, "inspect")
    assert not inspected.get("death_episode")
    result = port.decide(review_id, "insert", "Current connection is healthy; choose a local goal", "Inspect flowers near current position")
    assert result["dispatched"]
    run_async(controller.external_command())
    active = box.active_goal()
    assert active["id"] == result["request_id"] and active["stage_baseline"]["run"] == "new-native-run"
    assert active["stage_baseline"]["lifecycle"] == {"phase": "alive", "episodeId": None}
    assert box.current_user_goal(active["id"])["id"] == user
    run_async(controller.run("Explore and build a home"))
    assert len([name for name, _, _ in bridge.calls if name == "mc_do"]) == 2
    assert box.get(old_stage)["delivery"] == "needs_reassessment"
    assert store.entries(SCOPE) == history


def test_actual_death_after_fresh_connection_still_requires_same_episode_sync_and_native_drain(
        seam, framework_module, tmp_path, run_async):
    _, _, original, box, _, body, _, _, _, _ = seam
    run_async(original.external_command())
    DeathMemory(tmp_path).record({**event(), "run": "old-native-run"}, body[0], [], [], [])
    body[0] = fresh_body()
    module, bridge, controller, _ = restart(framework_module, tmp_path, box, body, original.publish)
    controller.observe_game_facts(body[0])
    run_async(controller.turn_once("Explore locally", "prefix", module.model_tools(bridge.tools)))
    assert len([name for name, _, _ in bridge.calls if name == "mc_do"]) == 1
    controller.receipt({"events": [{**event(2), "run": "new-native-run"}]})
    assert controller.death_waiting and controller.death_recovery["id"] == "death-2"
    body[0] = {**facts(episode_id="death-2"), "run": "new-native-run"}
    for part in body[0]["parts"]:
        if part["key"] == "recoveryState":
            part["text"] = json.dumps({**json.loads(part["text"]), "inventorySynced": False})
    run_async(controller.events())
    assert controller.death_waiting
    result, _, _ = run_async(controller.execute_model_call("mc_do", {"steps": []}))
    assert result["dispatched"] is False
    body[0] = {**facts(episode_id="death-2"), "run": "new-native-run"}
    run_async(controller.events())
    assert controller.death_recovery and not controller.continuation_ready
    controller.receipt({"execution": {**action(True), "phase": "cancelled"}})
    run_async(controller.events())
    assert controller.death_recovery is None and controller.continuation_ready
    run_async(controller.turn_once("Explore locally", "prefix", module.model_tools(bridge.tools)))
    assert len([name for name, _, _ in bridge.calls if name == "mc_do"]) == 2


def test_old_native_run_inspection_cannot_silently_rebase_a_new_host_stage(seam, tmp_path, run_async):
    _, _, controller, box, port, body, _, _, _, _ = seam
    body[0]["run"] = "old-native-run"
    controller.observe_game_facts(body[0])
    run_async(controller.external_command())
    review_id = offer(port, tmp_path)
    assert port.decide(review_id, "inspect")["body_baseline"]["run"] == "old-native-run"
    body[0] = fresh_body()
    controller.observe_game_facts(body[0])
    rejected = port.decide(review_id, "insert", "Old connection inspection", "Seek local flowers")
    assert rejected["error"] == "critical_baseline_changed"
    assert port.mailbox.get(port.request_id(review_id)) is None
    assert port.decide(review_id, "inspect")["body_baseline"]["run"] == "new-native-run"
    accepted = port.decide(review_id, "insert", "Fresh connection inspected", "Seek local flowers")
    run_async(controller.external_command())
    assert accepted["dispatched"] and box.active_goal()["id"] == accepted["request_id"]

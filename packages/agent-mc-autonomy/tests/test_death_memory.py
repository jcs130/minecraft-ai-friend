import json
import pytest

from agent_mc_autonomy.death_memory import DeathMemory
from agent_mc_autonomy.context import RULES
from test_controller import setup, choose, packed

SCOPE = {"realm": "realm-a", "account": "offline:actual-uuid", "agent": "player"}


def event(index=1, scope=SCOPE):
    return {"run": "native-run", "cursor": index, "ts": "2026-10-15T01:02:03Z", "type": "minecraft.event",
            "meta": {"death": {"id": "death-" + str(index), "scope": scope, "health": 0, "food": 4,
                     "observed_at": "2026-10-15T01:02:03Z", "cause": None, "position": {"x": 1, "y": 64, "z": 2}}}}


def facts(phase="alive", scope=SCOPE):
    return {"parts": [{"key": "identity", "text": json.dumps(scope)},
                      {"key": "deathLifecycle", "text": json.dumps({"phase": phase})},
                      {"key": "body", "text": "生命 20/20", "original": "actual-body-handle"}]}


def test_episode_dedup_persistence_scope_and_unverified_lesson(tmp_path):
    store = DeathMemory(tmp_path)
    recorded = store.record(event(), facts(), [], [], [])
    assert recorded["source_event"] == {"run": "native-run", "cursor": 1, "ts": "2026-10-15T01:02:03Z"}
    assert recorded["cause"] is None
    assert store.record(event(), facts(), [], [], []) is None
    restarted = DeathMemory(tmp_path)
    result = restarted.execute(SCOPE, {"action": "report", "id": "death-1", "lesson": "Check route clearance",
                               "applicability": "Before using that route", "evidence": "native-run event 1"})
    assert result["lesson"]["hypothesis"] is True
    assert result["behavioral_improvement_verified"] is False
    assert restarted.context(SCOPE)["lessons"][0]["episode_id"] == "death-1"
    assert restarted.entries({**SCOPE, "realm": "another-server"}) == []
    assert restarted.entries({**SCOPE, "account": "offline:other-player"}) == []
    with pytest.raises(ValueError):
        restarted.execute({**SCOPE, "realm": "another-server"}, {"action": "get", "id": "death-1"})
    restarted.notified(recorded)
    assert restarted.entries(SCOPE, pending=True) == []
    assert restarted.execute(SCOPE, {"action": "get", "id": "death-1"})["source_event"]["cursor"] == 1


def test_episode_retention_is_bounded_and_excludes_private_context(tmp_path):
    store = DeathMemory(tmp_path)
    for i in range(40):
        store.record(event(i), {"parts": [{"key": "persona", "text": "PRIVATE-HOST-PERSONA"}]}, [], [], [])
    rows = store.entries(SCOPE)
    assert len(rows) == 32 and rows[-1]["id"] == "death-8"
    assert "PRIVATE-HOST-PERSONA" not in json.dumps(rows)
    assert store.record(event(1), facts(), [], [], []) is None  # Evicted episodes cannot replay from the same source run.


def test_death_blocks_turn_and_action_until_respawn_with_fresh_identity(framework_module, tmp_path, run_async):
    seen = []
    async def decide(messages, tools):
        seen.append(messages)
        return choose()
    module, bridge, controller = setup(framework_module, tmp_path, decide)
    original = bridge.call
    phase = ["respawn_pending"]
    async def call(name, args, **kw):
        if name == "mc_protocol" and args["action"] == "facts":
            return packed(facts(phase[0]))
        return await original(name, args, **kw)
    bridge.call = call
    controller.receipt({"events": [event()]})
    run_async(controller.turn_once("survive", "prefix", module.model_tools(bridge.tools)))
    assert seen == [] and not any(c[0] == "mc_do" for c in bridge.calls)
    result, _, boundary = run_async(controller.execute_model_call("mc_do", {"steps": []}))
    assert result["dispatched"] is False and boundary
    phase[0] = "alive"
    run_async(controller.turn_once("survive", "prefix", module.model_tools(bridge.tools)))
    assert len(seen) == 1 and "death_memory" in seen[0][-1]["content"]
    assert "native-run" in seen[0][-1]["content"]
    controller.observe_game_facts(facts(scope={**SCOPE, "realm": "realm-b"}))
    assert controller.death_memory.context(controller.game_scope) is None


def test_stale_archive_death_and_unknown_receipts_do_not_replay(framework_module, tmp_path):
    _, bridge, controller = setup(framework_module, tmp_path, None)
    for stale in ({"contextDelivery": "archive-only"}, {"meta": {**event()["meta"], "staleEpoch": True}}):
        controller.receipt({"events": [{**event(), **stale}]})
    assert controller.death_memory.entries(SCOPE) == []
    with pytest.raises(RuntimeError, match="outcome_unknown"):
        controller.receipt({"execution": {"kind": "task", "id": "old", "evidence": {"outcomeUnknown": True}}})
    assert bridge.calls == []


def test_guide_is_optional_and_persona_and_user_intent_drive_interests():
    assert "optional knowledge, not a required activity sequence" in RULES
    assert "host persona, current intent" in RULES
    assert "explicit user goals retain priority" in RULES


def test_host_receives_real_episode_once_even_after_restart_and_instant_respawn(tmp_path):
    from datetime import datetime, timezone
    from agent_mc_autonomy.review import ReviewPort, ReviewPolicy
    from test_review import snapshot
    clock = [10000]
    port = ReviewPort(tmp_path, now=lambda: clock[0])
    port.configure(ReviewPolicy(enabled=True))
    episode = DeathMemory(tmp_path).record(event(), facts(), [], [], [])
    def publish():
        value = snapshot(clock[0], death_episode=episode, game_identity=SCOPE)
        (tmp_path / "status.json").write_text(json.dumps(value), encoding="utf-8")
        port.observe(value)
    publish()
    offered = port.offer()["review"]
    assert offered["trigger"] == "death_review"
    assert offered["evidence"]["death_episode"]["source_event"]["cursor"] == 1
    assert port.defer(offered["id"], True)["error"] == "meaningful_review_requires_decision"
    port.delivered(offered["id"], True)
    assert not port.offer()["offered"]
    assert DeathMemory(tmp_path).entries(SCOPE, pending=True) == []
    clock[0] += 1
    publish()
    assert port.decide(offered["id"], "inspect")["death_episode"]["id"] == episode["id"]
    port = ReviewPort(tmp_path, now=lambda: clock[0])
    clock[0] += 181
    publish()
    assert not port.offer()["offered"]
    clock[0] += 400
    publish()
    next_review = port.offer().get("review")
    assert not next_review or "death_episode" not in next_review["evidence"]


def test_large_lessons_fit_context_without_evicting_fresh_body_facts(tmp_path):
    from agent_mc_autonomy.context import assemble
    store = DeathMemory(tmp_path)
    store.record(event(), facts(), [], [], [])
    store.execute(SCOPE, {"action": "report", "id": "death-1", "lesson": "长" * 1200,
                         "applicability": "长" * 600, "evidence": "长" * 600})
    messages, budget = assemble("prefix", [], "survive", facts(), [], [], context_tokens=8000, reserved_output=1024,
                                death_memory=store.context(SCOPE))
    assert budget["total"] <= 8000
    assert any(p["key"] == "body" for p in json.loads(messages[-1]["content"])["current_facts"])


def test_scope_change_removes_old_death_tool_history_from_the_next_model_request(framework_module, tmp_path, run_async):
    seen = []
    async def decide(messages, tools):
        seen.append(messages)
        return {"content": "wait", "tool_calls": []}
    module, bridge, controller = setup(framework_module, tmp_path, decide)
    controller.observe_game_facts(facts())
    episode = controller.death_memory.record(event(), facts(), [], [], [])
    controller.groups = [[{"role": "assistant", "content": None, "tool_calls": [{"id": "old-death-read", "type": "function",
        "function": {"name": "death_review", "arguments": '{"action":"get","id":"death-1"}'}}]},
        {"role": "tool", "tool_call_id": "old-death-read", "content": json.dumps(episode)}]]
    # The new realm's death can arrive before its next fresh identity sample.
    controller.receipt({"events": [event(2, scope={**SCOPE, "realm": "realm-b"})]})
    original = bridge.call
    async def call(name, args, **kw):
        if name == "mc_protocol" and args["action"] == "facts":
            return packed(facts(scope={**SCOPE, "realm": "realm-b"}))
        return await original(name, args, **kw)
    bridge.call = call
    run_async(controller.turn_once("survive", "prefix", module.model_tools(bridge.tools)))
    assert seen and "realm-a" not in json.dumps(seen)
    assert "old-death-read" not in json.dumps(seen)


def test_foreign_scope_terminal_settles_native_ledger_without_contaminating_new_episode(framework_module, tmp_path):
    _, _, controller = setup(framework_module, tmp_path, None)
    controller.observe_game_facts(facts())
    key = ("task", "old-realm-task")
    controller.action_requests[key] = ("mc_do", {"steps": []}, "actual-old-request", False)
    controller.action_scopes[key] = SCOPE
    controller.pending[key] = {"kind": "task", "id": key[1]}
    new_scope = {**SCOPE, "realm": "realm-b"}
    controller.observe_game_facts(facts(scope=new_scope))
    terminal = {"kind": "task", "id": key[1], "terminal": True, "phase": "completed", "evidence": {"receipt": "old-realm-receipt"}}
    controller.receipt({"execution": terminal, "events": [{"run": "old-native-run", "cursor": 3, "ts": "2026-10-15T01:00:00Z", "type": "minecraft.task", "execution": terminal}]})
    assert key not in controller.pending and key not in controller.action_requests
    controller.receipt({"events": [event(4, scope=new_scope)]})
    episode = controller.death_memory.entries(new_scope)[0]
    assert episode["receipts"] == []
    assert controller.native_outcomes == []
    assert "old-native-run" not in json.dumps(episode)


@pytest.mark.parametrize("change", ["death", "scope", "runtime_failure"])
def test_quiet_review_defer_rechecks_new_urgent_event_and_identity_before_observe(tmp_path, change):
    from agent_mc_autonomy.review import ReviewPort, ReviewPolicy
    from test_review import snapshot
    clock = [10000]
    port = ReviewPort(tmp_path, now=lambda: clock[0])
    port.configure(ReviewPolicy(enabled=True))
    def publish(value, observe=True):
        (tmp_path / "status.json").write_text(json.dumps(value), encoding="utf-8")
        if observe:
            port.observe(value)
    publish(snapshot(clock[0], game_identity=SCOPE))
    port.decide(port.offer()["review"]["id"], "continue", "Continue")
    clock[0] += 180
    publish(snapshot(clock[0], game_identity=SCOPE))
    periodic = port.offer()["review"]
    assert periodic["trigger"] == "periodic_review"
    changes = {"game_identity": SCOPE}
    if change == "death":
        changes["death_episode"] = DeathMemory(tmp_path).record(event(), facts(), [], [], [])
    elif change == "scope":
        changes["game_identity"] = {**SCOPE, "realm": "realm-b"}
    else:
        changes["phase"] = "failed"
    publish(snapshot(clock[0], **changes), observe=False)
    assert port.defer(periodic["id"], True)["is_error"]
    assert not port.state()["review"].get("result")

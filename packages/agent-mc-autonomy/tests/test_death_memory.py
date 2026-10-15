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


def facts(phase="alive", scope=SCOPE, episode_id="death-1"):
    return {"parts": [{"key": "identity", "text": json.dumps(scope)},
                      {"key": "deathLifecycle", "text": json.dumps({"phase": phase, "episodeId": episode_id})},
                      {"key": "recoveryState", "text": json.dumps({"position": {"x": 301, "y": 64, "z": 2},
                       "dimension": "overworld", "inventorySynced": True, "inventory": [], "health": 20, "food": 20})},
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
    port.configure(ReviewPolicy(enabled=True, idle_presence_seconds=900))
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
    assert DeathMemory(tmp_path).entries(SCOPE, pending=True)[0]["id"] == episode["id"]
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
    assert next_review["evidence"]["death_episode"]["id"] == episode["id"]


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
            return packed(facts(scope={**SCOPE, "realm": "realm-b"}, episode_id="death-2"))
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
    port.configure(ReviewPolicy(enabled=True, idle_presence_seconds=900))
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


@pytest.mark.parametrize("terminal_at,retry_until,expected", [(1002, 0, 1004), (1006, 0, 1006), (1002, 1020, 1020)])
def test_fresh_respawn_handoff_waits_for_native_terminal_and_retains_backoff(
        framework_module, tmp_path, run_async, monkeypatch, terminal_at, retry_until, expected):
    import asyncio
    import dataclasses
    from types import SimpleNamespace
    from test_controller import action
    clock, decisions = [1000], []
    async def decide(messages, _):
        decisions.append((clock[0], messages))
        return choose()
    module, bridge, controller = setup(framework_module, tmp_path, decide, lambda: clock[0] >= 1025)
    controller.settings = dataclasses.replace(controller.settings, min_decision_seconds=10, max_tool_rounds=1)
    monkeypatch.setattr(module, "time", SimpleNamespace(monotonic=lambda: clock[0]))
    original_sleep, original_call = asyncio.sleep, bridge.call
    async def tick(_):
        clock[0] += 1
        await original_sleep(0)
    monkeypatch.setattr(module.asyncio, "sleep", tick)
    async def call(name, args, **kwargs):
        if name == "mc_protocol" and args["action"] == "facts":
            return packed(facts("respawn_pending" if 1002 <= clock[0] < 1004 else "alive"))
        return await original_call(name, args, **kwargs)
    bridge.call = call
    def poll():
        if clock[0] == 1002:
            controller.planner_retry_at = retry_until
            bridge.event_pages.append([{**event(), "trigger": "flush"}])
        if clock[0] == terminal_at:
            bridge.event_pages.append([{"cursor": 2, "trigger": "piggyback", "execution": {
                **action(True), "phase": "cancelled", "evidence": {"receipt": "death cancellation acknowledged"}}}])
    bridge.on_poll = poll
    run_async(controller.run("preserve original objective"))
    assert [at for at, _ in decisions] == [1000, expected]
    assert "death_memory" in decisions[-1][1][-1]["content"]


def test_respawn_requires_matching_identity_episode_and_synced_inventory(framework_module, tmp_path, run_async):
    _, bridge, controller = setup(framework_module, tmp_path, None)
    controller.observe_game_facts(facts())
    controller.receipt({"events": [event()]})
    for stale in (facts(scope={**SCOPE, "account": "other"}),
                  {"parts": [p for p in facts()["parts"] if p["key"] != "identity"]},
                  {"parts": [{**p, "text": json.dumps({"inventorySynced": False})}
                             if p["key"] == "recoveryState" else p for p in facts()["parts"]]},
                  {"parts": [{**p, "text": json.dumps({"inventorySynced": True, "health": 0})}
                             if p["key"] == "recoveryState" else p for p in facts()["parts"]]},
                  {"parts": [{**p, "text": json.dumps({"phase": "alive", "episodeId": "old"})}
                             if p["key"] == "deathLifecycle" else p for p in facts()["parts"]]}):
        controller.observe_game_facts(stale)
        assert controller.death_waiting
    assert not controller.continuation_ready


def test_recovery_context_preserves_proposal_and_measured_distance_without_inventing_route(tmp_path):
    from agent_mc_autonomy.death_memory import recovery_context
    from agent_mc_autonomy.review import review_observation
    from test_review import snapshot
    original = event()
    original["meta"]["death"]["position"]["dimension"] = "overworld"
    episode = DeathMemory(tmp_path).record(original, facts(), [], [], [])
    goal = {"id": "stage-1", "goal": "Return to the old work site", "origin": "host_review", "parent_id": "user-1"}
    recovery = recovery_context(episode, facts(), goal)
    assert recovery["straight_line_death_distance"] == 300
    assert recovery["route_distance"] is None
    assert recovery["objective_proposal"] == goal
    assert recovery["current"]["inventory"] == []
    assert recovery["applicability"] == "requires_fresh_review"
    changed = {**episode, "position": {**episode["position"], "dimension": "the_nether"}}
    assert recovery_context(changed, facts())["straight_line_death_distance"] is None
    value = snapshot(10000, game_identity=SCOPE, death_episode=episode, current_goal=goal)
    value["facts"]["parts"].extend(facts()["parts"])
    evidence = review_observation(value, 10000)["evidence"]
    assert evidence["death_recovery"]["straight_line_death_distance"] == 300
    assert evidence["death_recovery"]["objective_proposal"]["parent_id"] == "user-1"


def test_duplicate_death_cannot_rearm_consumed_recovery_or_clear_unknown(framework_module, tmp_path, run_async):
    _, bridge, controller = setup(framework_module, tmp_path, None)
    original = bridge.call
    async def call(name, args, **kwargs):
        if name == "mc_protocol" and args["action"] == "facts":
            return packed(facts())
        return await original(name, args, **kwargs)
    bridge.call = call
    controller.receipt({"events": [event()]})
    run_async(controller.events())
    assert controller.continuation_ready
    controller.continuation_ready = False
    controller.receipt({"events": [event()]})
    run_async(controller.events())
    assert not controller.continuation_ready
    with pytest.raises(RuntimeError, match="outcome_unknown"):
        controller.receipt({"execution": {"kind": "task", "id": "old", "evidence": {"outcomeUnknown": True}}})
    assert json.loads(controller.state_path.read_text())["uncertain"] is True
    assert not any(name == "mc_do" for name, _, _ in bridge.calls)


@pytest.mark.parametrize("finish_during_poll", [False, True])
def test_death_invalidates_delayed_planner_even_after_respawn_and_closes_old_turn(
        framework_module, tmp_path, run_async, monkeypatch, finish_during_poll):
    import asyncio
    import dataclasses
    from types import SimpleNamespace
    from test_controller import action
    clock, requests, cancelled, delivered = [1000], [], [], [False]
    release = asyncio.Event()
    async def decide(messages, _):
        requests.append(messages)
        reply = choose()
        reply["tool_calls"][0]["function"]["arguments"] = json.dumps({"steps": [
            {"skill": "goto", "at": [1 if len(requests) == 1 else 301, 64, 2]}]})
        if len(requests) == 1:
            try:
                await release.wait()
            except asyncio.CancelledError:
                cancelled.append(True)  # Even a provider returning after cancellation is stale.
        return reply
    module, bridge, controller = setup(framework_module, tmp_path, decide, lambda: clock[0] > 1020)
    controller.settings = dataclasses.replace(controller.settings, min_decision_seconds=10, max_tool_rounds=1)
    monkeypatch.setattr(module, "time", SimpleNamespace(monotonic=lambda: clock[0]))
    original_sleep, original_wait, original_call = asyncio.sleep, asyncio.wait, bridge.call
    async def tick(_):
        clock[0] += 1
        await original_sleep(0)
    async def wait(tasks, timeout):
        return await original_wait(tasks, timeout=0.001)
    monkeypatch.setattr(module.asyncio, "sleep", tick)
    monkeypatch.setattr(module.asyncio, "wait", wait)
    async def call(name, args, **kwargs):
        if name == "mc_protocol" and args["action"] == "facts":
            if delivered[0] and finish_during_poll:
                release.set()
                await original_sleep(0)
                await original_sleep(0)
            return packed(facts(episode_id="death-1" if delivered[0] else "previous-life"))
        return await original_call(name, args, **kwargs)
    bridge.call = call
    def poll():
        if requests and not delivered[0]:
            delivered[0] = True
            controller.pending[("task", "old-body")] = {"kind": "task", "id": "old-body"}
            bridge.event_pages.append([{**event(), "trigger": "flush"}, {"cursor": 2,
                "execution": {**action(True), "id": "old-body", "phase": "cancelled"}}])
        elif delivered[0]:
            release.set()  # The unfixed old inference eventually returns instead of hanging the regression.
    bridge.on_poll = poll
    run_async(controller.run("preserve user purpose"))
    assert len(requests) == 2
    dispatched = [(args, kw) for name, args, kw in bridge.calls if name == "mc_do"]
    assert len(dispatched) == 1 and dispatched[0][0]["steps"][0]["at"] == [301, 64, 2]
    turns = [(args["action"], args["id"]) for name, args, _ in bridge.calls
             if name == "mc_protocol" and args["action"] in {"begin_turn", "end_turn"}]
    assert [action for action, _ in turns] == ["begin_turn", "end_turn", "begin_turn", "end_turn"]
    assert turns[0][1] == turns[1][1] and turns[2][1] == turns[3][1] != turns[0][1]
    assert dispatched[0][1]["turn_id"] == turns[2][1]
    assert "death-1" in json.dumps(requests[1])
    assert bool(cancelled) is (not finish_during_poll)

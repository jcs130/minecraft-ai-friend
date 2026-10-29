import dataclasses
import json

from test_controller import packed, setup
from test_death_memory import SCOPE, event, facts

from agent_mc_autonomy.death_memory import DeathMemory


def report(**changes):
    return {"action": "report", "id": "death-1", "lesson": "Check an escape route",
            "applicability": "Before entering confined combat", "evidence": "native-run event 1", **changes}


def test_identical_report_is_a_persisted_noop_and_can_still_be_revised(tmp_path):
    store = DeathMemory(tmp_path)
    store.record(event(), facts(), [], [], [])
    assert store.execute(SCOPE, report())["saved"] is True
    store = DeathMemory(tmp_path)
    before = store.entries(SCOPE)[0]
    duplicate = store.execute(SCOPE, report(lesson="  Check an escape route  "))
    assert duplicate["saved"] is False
    assert duplicate["reason"] == "unchanged_lesson"
    assert duplicate["behavioral_improvement_verified"] is False
    assert store.entries(SCOPE)[0] == before
    changed = store.execute(SCOPE, report(evidence="native-run event 1; observed obstruction"))
    assert changed["saved"] is True
    assert changed["lesson"]["evidence"].endswith("observed obstruction")


def test_saved_lesson_context_does_not_demand_another_report(tmp_path):
    store = DeathMemory(tmp_path)
    store.record(event(), facts(), [], [], [])
    assert store.context(SCOPE)["report_pending"] is True
    store.execute(SCOPE, report())
    context = store.context(SCOPE)
    assert context["report_pending"] is False
    assert context["lesson_saved"] is True
    assert "already recorded" in context["next"]
    assert "do not repeat" in context["next"]
    assert context["inspect"] == {"action": "get", "id": "death-1"}
    assert context["behavioral_improvement_verified"] is False
    assert store.context({**SCOPE, "realm": "other"}) is None


def test_deferred_main_reflection_is_not_a_demand_for_another_planner_report(tmp_path):
    store = DeathMemory(tmp_path)
    store.record(event(), facts(), [], [], [])
    with store.connection() as db:
        row = store.entries(SCOPE)[0]
        row["reflection"] = {"outcome": "deferred", "reason": "Insufficient evidence"}
        db.execute("UPDATE death_episodes SET body=?", (json.dumps(row),))
    context = store.context(SCOPE)
    assert context["report_pending"] is False
    assert context["lesson_saved"] is False
    assert "deferred" in context["next"]


def test_duplicate_report_yields_without_pausing_other_work(framework_module, tmp_path, run_async):
    published = []
    _, bridge, controller = setup(framework_module, tmp_path, None)
    controller.publish = lambda **value: published.append(value)
    controller.observe_game_facts(facts())
    controller.death_memory.record(event(), facts(), [], [], [])
    first, _, boundary = run_async(controller.execute_model_call("death_review", report()))
    assert json.loads(first["text"])["saved"] is True and not boundary
    for _ in range(8):
        result, compact, boundary = run_async(controller.execute_model_call("death_review", report()))
        assert result["failed"] is False and boundary
        assert result["code"] == "death_lesson_unchanged"
        assert json.loads(compact)["code"] == "death_lesson_unchanged"
        assert controller.planner_retry_at == 0
        assert controller.unactioned_replies == 0
        assert controller.continuation_needed
    assert not bridge.calls and not controller.pending and controller.inflight_request is None
    assert not controller.death_waiting
    assert published[-1]["planner_retry_seconds"] == 0
    changed, _, boundary = run_async(controller.execute_model_call("death_review", report(lesson="Use new observed clearance")))
    assert json.loads(changed["text"])["saved"] is True and not boundary


def test_repeated_report_ends_read_chain_and_preserves_receipts(framework_module, tmp_path, run_async):
    seen = []
    async def decide(messages, _):
        seen.append(messages)
        return {"content": None, "tool_calls": [{"id": "call-" + str(len(seen)), "type": "function",
            "function": {"name": "death_review", "arguments": json.dumps(report())}}]}
    module, bridge, controller = setup(framework_module, tmp_path, decide)
    controller.settings = dataclasses.replace(controller.settings, context_mode="full", max_tool_rounds=6)
    original = bridge.call
    async def call(name, args, **kw):
        if name == "mc_protocol" and args["action"] == "facts":
            return packed(facts())
        return await original(name, args, **kw)
    bridge.call = call
    controller.observe_game_facts(facts())
    controller.death_memory.record(event(), facts(), [], [], [])
    run_async(controller.turn_once("Choose meaningful work", "body contract", module.model_tools(bridge.tools)))
    assert len(seen) == 2
    rows = [json.loads(line) for line in (tmp_path / "receipts.jsonl").read_text().splitlines()]
    assert len(rows) == 2
    assert json.loads(rows[0]["result"]["text"])["saved"] is True
    assert json.loads(rows[1]["result"]["text"])["saved"] is False
    assert len(controller.groups) == 2
    assert controller.groups[-1][-1]["role"] == "tool"
    assert not any(name == "mc_do" for name, *_ in bridge.calls)
    assert [args["action"] for name, args, _ in bridge.calls if name == "mc_protocol"][-1] == "end_turn"

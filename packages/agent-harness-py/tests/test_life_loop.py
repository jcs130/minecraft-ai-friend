import json
import time

import pytest

from agent_mc_harness.journal import ActionJournal
from agent_mc_harness.life_loop import LifeLoop, next_delay, observe, validate_proposal
from agent_mc_harness.models import ActionReceipt, BodyAction, BodySnapshot
from test_server_npc import role


def actor(kind="maid"):
    tools = ["body:observe", "body:chat", "body:move", "body:stop"]
    if kind == "maid":
        tools.append("body:native:guard")
    return role(body_kind=kind, default_native_guard=kind == "maid", allowed_tools=tools)


def snap(**changes):
    values = dict(life_state="alive", position={"x": 8, "y": 64, "z": 8}, dimension="minecraft:overworld",
                  health=20.0, max_health=20.0, food=18.0, entities=[], inventory={}, raw={})
    values.update(changes)
    return BodySnapshot(**values)


def test_needs_are_current_and_unknown_stays_unknown():
    view = observe(actor(), snap(), {}, [], [])
    assert view.needs["danger"] == "clear"
    assert view.needs["health"] == "ok"
    assert view.needs["hunger"] == "ok"
    assert view.needs["sleep"] == "unknown"
    hungry = observe(actor(), snap(food=3, health=5, entities=[{"hostile": True}]), {}, [], [])
    assert hungry.needs["hunger"] == "low"
    assert hungry.needs["health"] == "critical"
    assert hungry.needs["danger"] == "present"
    unknown = observe(actor("villager"), snap(food=None, health=None, max_health=None, entities=None), {}, [], [])
    assert unknown.needs["hunger"] == "unknown"
    assert unknown.needs["health"] == "unknown"
    assert unknown.needs["danger"] == "unknown"


def test_tier_budgets_and_completion_evidence():
    proposal = validate_proposal(actor("villager"), {"goal": "回屋休息", "successEvidence": "夜里在家入睡", "reviewAfterSeconds": 120})
    assert proposal.review_after_seconds == 120
    with pytest.raises(ValueError):
        validate_proposal(actor("villager"), {"goal": "x" * 91})
    with pytest.raises(ValueError):
        validate_proposal(actor(), {"goal": "完成", "status": "completed"})
    with pytest.raises(ValueError):
        validate_proposal(actor(), {"goal": "完成", "status": "completed", "successEvidence": "真实回执", "amount": 3})


def test_state_survives_restart_and_records_real_progress(tmp_path):
    journal = ActionJournal(tmp_path / "actions.sqlite")
    loop = LifeLoop(journal)
    configured = actor()
    before = observe(configured, snap(), {}, [], [])
    state = loop.apply(configured, validate_proposal(configured, {"goal": "去河边钓鱼", "nextAction": "检查钓点", "reviewAfterSeconds": 90}), now=before.observed_at)
    assert state.status == "active" and state.revision == 1
    journal.close()

    journal = ActionJournal(tmp_path / "actions.sqlite")
    loop = LifeLoop(journal)
    loaded = loop.load(str(configured.character_id), "maid")
    assert loaded.goal == "去河边钓鱼"
    moved = observe(configured, snap(position={"x": 12, "y": 64, "z": 8}), {}, [], [])
    action = BodyAction(verb="move", request_id="life_move_0001", args={"x": 12})
    receipt = ActionReceipt(request_id=action.request_id, verb="move", status="completed", terminal=True)
    state = loop.record_outcome(configured, action, receipt, moved, now=moved.observed_at)
    assert state.last_progress_at == moved.observed_at
    assert state.status == "active"
    assert loop.record_outcome(configured, action, receipt, moved) == state
    journal.close()


def test_repeated_commitment_backs_off_without_counting_reworded_steps_as_progress(tmp_path):
    journal = ActionJournal(tmp_path / "actions.sqlite")
    loop = LifeLoop(journal)
    configured = actor()
    first = loop.apply(configured, validate_proposal(configured, {
        "goal": "驻守家园", "phase": "guarding", "nextAction": "原地警戒", "reviewAfterSeconds": 90,
    }), now=1_000)
    assert first.stagnant_reviews == 0 and first.review_at == 1_090

    repeated = loop.apply(configured, validate_proposal(configured, {
        "goal": "驻守家园", "phase": "guarding", "nextAction": "继续观察周围", "reviewAfterSeconds": 90,
    }), now=2_000)
    assert repeated.revision == first.revision + 1
    assert repeated.stagnant_reviews == 1 and repeated.review_at == 2_090
    assert repeated.last_progress_at == first.last_progress_at

    repeated_again = loop.apply(configured, validate_proposal(configured, {
        "goal": "驻守家园", "phase": "guarding", "nextAction": "等待新情况", "reviewAfterSeconds": 90,
    }), now=3_000)
    assert repeated_again.stagnant_reviews == 2 and repeated_again.review_at == 3_180

    revised = loop.apply(configured, validate_proposal(configured, {
        "goal": "检查补给", "phase": "preparing", "nextAction": "查看背包", "reviewAfterSeconds": 90,
    }), now=4_000)
    assert revised.stagnant_reviews == 0 and revised.review_at == 4_090
    journal.close()


def test_failure_blocks_with_backoff_and_new_observation_can_unblock(tmp_path):
    journal = ActionJournal(tmp_path / "actions.sqlite")
    loop = LifeLoop(journal)
    configured = actor("villager")
    view = observe(configured, snap(), {}, [], [])
    loop.apply(configured, validate_proposal(configured, {"goal": "去工作点", "reviewAfterSeconds": 60}), now=view.observed_at)
    action = BodyAction(verb="move", request_id="life_move_0002", args={"x": 20})
    receipt = ActionReceipt(request_id=action.request_id, verb="move", status="failed", terminal=True, text="path_blocked")
    blocked = loop.record_outcome(configured, action, receipt, view)
    assert blocked.status == "blocked" and blocked.blocked_reason == "path_blocked"
    assert blocked.review_at >= view.observed_at + 45
    assert next_delay(blocked, view, external_event=False, configured_interval=90, now=view.observed_at) >= 45
    moved = observe(configured, snap(position={"x": 24, "y": 64, "z": 8}), {}, [], [])
    recovered = loop.observe(configured, moved)
    assert recovered.status == "active" and recovered.blocked_reason == ""
    journal.close()


def test_villager_idle_is_quieter_than_numen_but_danger_wakes_immediately():
    villager = observe(actor("villager"), snap(), {}, [], [])
    numen = observe(actor("numen"), snap(), {}, [], [])
    assert next_delay(None, villager, external_event=False, configured_interval=45) >= 180
    assert next_delay(None, numen, external_event=False, configured_interval=45) == 45
    danger = observe(actor("villager"), snap(entities=[{"hostile": True}]), {}, [], [])
    assert next_delay(None, danger, external_event=False, configured_interval=45) == 0
    assert next_delay(None, villager, external_event=True, configured_interval=45) == 0


def test_planner_can_persist_life_without_fabricating_an_action(tmp_path):
    import asyncio
    import httpx
    from agent_mc_harness.npc import ModelClient, NpcHost, NpcPlanner
    from agent_mc_harness.runtime import Intent, PlanContext

    async def run():
        answers = [{"steps": [], "life": {"goal": "在河边钓一条鱼", "phase": "寻找钓点", "nextAction": "检查鱼竿和水面",
                                           "successEvidence": "真实鱼获入包", "reviewAfterSeconds": 120}}]
        prompts = []

        def respond(request):
            prompts.append(json.loads(request.content))
            return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(answers.pop(0))}}]})

        model = ModelClient("http://127.0.0.1:1/v1", "test", http=httpx.AsyncClient(transport=httpx.MockTransport(respond)))
        configured = role(body_kind="maid", default_native_guard=True,
                          allowed_tools=["body:observe", "body:inventory", "body:chat", "body:move", "body:stop", "body:native:guard"])
        from simbody import SimBody
        from test_npc_native_continuity import maid_context
        body = SimBody(body_id=str(configured.body_id))
        here = maid_context(resident={"loaded": True, "activeRequest": "none", "sleeping": False, "combat": {}},
                            taskId="touhou_little_maid:idle", nativeGuardDelegated=True)
        body.snapshot = lambda: asyncio.sleep(0, result=here.snapshot)
        journal = ActionJournal(tmp_path / "planner.sqlite")
        host = NpcHost(configured, body, NpcPlanner(configured, model), None, journal)
        try:
            steps = await host._plan(Intent(id="life-plan", agent=configured.id, goal="Choose a useful activity."),
                                     PlanContext(snapshot=here.snapshot))
            assert steps == [] and not body.acts
            assert prompts[0]["messages"][1]["content"]
            state = host.life_loop.load(str(configured.character_id), "maid")
            assert state.goal == "在河边钓一条鱼" and state.next_action == "检查鱼竿和水面"
        finally:
            await model.close()
            journal.close()
            await body.destroy()

    asyncio.run(run())


def test_villager_planning_turn_requests_a_durable_life_commitment(tmp_path):
    import asyncio
    import httpx
    from agent_mc_harness.npc import IDLE_GOAL, ModelClient, NpcHost, NpcPlanner
    from agent_mc_harness.runtime import Intent, PlanContext
    from simbody import SimBody

    async def run():
        prompts = []

        def respond(request):
            prompts.append(json.loads(request.content))
            return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps({
                "steps": [],
                "agenda": [{"afterMinutes": 0, "forMinutes": 10, "goal": "在床边休息", "evidence": "保持睡眠直到天亮"}],
                "life": {"goal": "在床边休息", "phase": "sleeping", "nextAction": "继续睡眠并定时复查",
                         "successEvidence": "天亮后自然醒来", "reviewAfterSeconds": 300, "status": "waiting"},
            })}}]})

        model = ModelClient("http://127.0.0.1:1/v1", "test", http=httpx.AsyncClient(transport=httpx.MockTransport(respond)))
        configured = role(body_kind="villager", agenda_enabled=True,
                          allowed_tools=["body:observe", "body:chat", "body:move", "body:stop"])
        body = SimBody(body_id=str(configured.body_id))
        here = snap(raw={})
        body.snapshot = lambda: asyncio.sleep(0, result=here)
        journal = ActionJournal(tmp_path / "villager-planner.sqlite")
        host = NpcHost(configured, body, NpcPlanner(configured, model), None, journal)
        try:
            steps = await host._plan(Intent(id="villager-life-plan", agent=configured.id, goal=IDLE_GOAL),
                                     PlanContext(snapshot=here, agenda={"current": None, "upcoming": []}))
            assert steps == [] and not body.acts
            assert '"agenda", "steps" and "life"' in prompts[0]["messages"][0]["content"]
            state = host.life_loop.load(str(configured.character_id), "villager")
            assert state.goal == "在床边休息" and state.status == "waiting"
        finally:
            await model.close()
            journal.close()
            await body.destroy()

    asyncio.run(run())

import asyncio
import json
from datetime import UTC, datetime, timedelta

import httpx

from agent_mc_harness.models import ActionSupport, BodySnapshot, NativeAction
from agent_mc_harness.npc import IDLE_GOAL, ModelClient, NpcPlanner, reaction_choices, restore_default_guard, reviewed_steps
from agent_mc_harness.runtime import Intent, PlanContext
from simbody import SimBody
from test_server_npc import role


def maid_context(**raw):
    caps = SimBody().capabilities()
    caps.native_actions.extend([NativeAction(name="guard"), NativeAction(name="dismount")])
    caps.actions["follow"] = ActionSupport(native="follow")
    caps.actions["stay"] = ActionSupport(native="stay")
    caps.actions["cast"] = ActionSupport(native="cast")
    return PlanContext(
        capabilities=caps,
        snapshot=BodySnapshot(life_state="alive", position={"x": 3, "y": 64, "z": 8}, health=12,
                              max_health=30, raw=raw),
    )


def test_fresh_mode_and_position_do_not_repeat_writes_or_reads():
    actor = role(body_kind="maid", allowed_tools=["body:observe", "body:native:guard", "body:follow"])
    context = maid_context(nativeGuardDelegated=True, follow={"active": True})
    values = [{"tool": tool} for tool in actor.allowed_tools]
    assert reviewed_steps(actor, context, values) == []
    context.snapshot.sampled_at = datetime.now(UTC) - timedelta(seconds=8)
    assert [step.tool for step in reviewed_steps(actor, context, values)] == actor.allowed_tools


def test_new_mode_and_explicit_physical_action_remain_available():
    actor = role(body_kind="maid", allowed_tools=["body:native:guard", "body:follow",
                                                "body:stay", "body:cast"])
    context = maid_context(nativeGuardDelegated=True, follow={"active": True, "temporaryWait": True})
    steps = [{"tool": "body:follow"}, {"tool": "body:native:guard"}]
    assert [step.tool for step in reviewed_steps(actor, context, steps)] == ["body:follow", "body:native:guard"]
    assert reviewed_steps(actor, context, [{"tool": "body:cast", "args": {"spellId": "mend"}}])
    assert reviewed_steps(actor, context, [{"tool": "body:stay"}])


def test_guard_and_healing_are_not_stopped_by_fast_reaction():
    actor = role(body_kind="maid", allowed_tools=["body:native:guard", "body:observe", "body:stay"])
    assert set(reaction_choices(actor, maid_context(nativeGuardDelegated=False))) == {"guard", "wait"}
    assert reaction_choices(actor, maid_context(nativeGuardDelegated=True)) == {}
    assert reaction_choices(actor, maid_context(nativeGuardDelegated=False, passenger=True)) == {}
    assert reaction_choices(actor, maid_context(nativeGuardDelegated=False, sitting=True)) == {}


def test_default_guard_resumes_only_an_idle_unoccupied_body():
    actor = role(body_kind="maid", default_native_guard=True, allowed_tools=["body:native:guard"])
    ready = dict(nativeGuardDelegated=False, taskId="touhou_little_maid:idle", canMove=True,
                 passenger=False, sitting=False, homeMode=False, follow={"temporaryWait": False})
    assert restore_default_guard(actor, maid_context(**ready)).tool == "body:native:guard"
    for change in ({"sitting": True}, {"passenger": True}, {"homeMode": True}, {"canMove": False},
                   {"nativeGuardDelegated": True}, {"taskId": "touhou_little_maid:fishing"},
                   {"follow": {"temporaryWait": True}}):
        assert restore_default_guard(actor, maid_context(**(ready | change))) is None


def test_idle_activity_review_resumes_configured_expedition():
    async def run():
        actor = role(body_kind="maid", default_native_guard=True, activity_review_seconds=90,
                     allowed_tools=["body:native:guard"])
        expedition = {"state": "not_delegated", "leaderDimension": "minecraft:overworld"}
        resident = {"loaded": True, "expedition": expedition}
        ready = dict(nativeGuardDelegated=False, taskId="touhou_little_maid:idle", canMove=True,
                     passenger=False, sitting=False, homeMode=False, follow={"temporaryWait": False},
                     resident=resident)
        planner = NpcPlanner(actor, None)
        context = maid_context(**ready)
        intent = Intent(id="qa-expedition", agent=actor.id, goal=IDLE_GOAL)
        assert [step.tool for step in await planner(intent, context)] == ["body:native:guard"]
        for observation in (
            ready | {"sitting": True},
            ready | {"resident": resident | {"sleeping": True}},
            ready | {"resident": resident | {"expedition": {"state": "not_delegated"}}},
            ready | {"resident": resident | {"expedition": expedition | {"pendingTravelRequestId": "qa-travel"}}},
        ):
            assert restore_default_guard(actor, maid_context(**observation)) is None

    asyncio.run(run())


def test_opted_in_sitting_resident_can_rejoin_live_leader_after_review():
    actor = role(body_kind="maid", default_native_guard=True, activity_review_seconds=90,
                 expedition_wait_seconds=180, allowed_tools=["body:native:guard"])
    expedition = {"state": "not_delegated", "leaderDimension": "minecraft:overworld"}
    resident = {"loaded": True, "expedition": expedition}
    ready = dict(nativeGuardDelegated=False, taskId="touhou_little_maid:idle", canMove=False,
                 passenger=False, sitting=True, homeMode=False, follow={"temporaryWait": False},
                 resident=resident)

    def review(change=None, elapsed=180):
        context = maid_context(**(ready | (change or {})))
        context.snapshot.health = 30
        context.activity_review = {"activity": "waiting", "elapsedSeconds": elapsed}
        return restore_default_guard(actor, context)

    assert review().tool == "body:native:guard"
    assert review(elapsed=179) is None
    for change in ({"passenger": True}, {"homeMode": True}, {"taskId": "touhou_little_maid:fishing"},
                   {"resident": resident | {"sleeping": True}},
                   {"resident": resident | {"combat": {"targetId": "hostile"}}},
                   {"resident": resident | {"activeRequest": "existing-action"}},
                   {"resident": resident | {"expedition": {"state": "not_delegated"}}}):
        assert review(change) is None

    async def planned_wait():
        context = maid_context(**ready)
        context.snapshot.health = 30
        context.activity_review = {"activity": "waiting", "elapsedSeconds": 180}
        context.agenda = {"current": {"goal": "Wait for the expedition leader at home"}}
        planner = NpcPlanner(actor, None)
        intent = Intent(id="qa-planned-wait", agent=actor.id, goal=IDLE_GOAL)
        assert [step.tool for step in await planner(intent, context)] == ["body:native:guard"]
        context.snapshot.raw.update(sitting=False, canMove=True)
        context.activity_review = {"activity": "free", "elapsedSeconds": 0}
        assert [step.tool for step in await planner(intent, context)] == ["body:native:guard"]

    asyncio.run(planned_wait())


def test_idle_task_does_not_cancel_an_existing_opted_in_expedition():
    actor = role(body_kind="maid", default_native_guard=True, activity_review_seconds=90,
                 expedition_wait_seconds=180, native_tasks=["touhou_little_maid:idle", "touhou_little_maid:attack"],
                 allowed_tools=["body:native:guard", "body:native:task", "body:stay"])
    context = maid_context(nativeGuardDelegated=True, sitting=False, taskId="touhou_little_maid:idle",
                           resident={"expedition": {"leaderId": "registered-leader"}})
    context.capabilities.native_actions.append(NativeAction(name="task"))
    assert reviewed_steps(actor, context, [{"tool": "body:native:task", "args": {"taskId": "touhou_little_maid:idle"}}]) == []
    work = {"tool": "body:native:task", "args": {"taskId": "touhou_little_maid:attack"}}
    assert reviewed_steps(actor, context, [work])[0].args == work["args"]
    assert reviewed_steps(actor, context, [{"tool": "body:stay"}])[0].tool == "body:stay"


def test_completed_walk_to_expedition_leader_returns_to_native_guard():
    actor = role(body_kind="maid", default_native_guard=True, activity_review_seconds=90,
                 expedition_wait_seconds=180, allowed_tools=["body:native:guard"])
    expedition = {"state": "not_delegated", "leaderId": "registered-leader", "leaderDimension": "minecraft:overworld"}
    resident = {"loaded": True, "expedition": expedition}
    ready = dict(nativeGuardDelegated=False, taskId="touhou_little_maid:idle", canMove=True,
                 passenger=False, sitting=False, homeMode=True, follow={"temporaryWait": False},
                 resident=resident, socialNavigationTargetUuid="registered-leader", socialWalkAvailable=True)

    def sample(**change):
        context = maid_context(**(ready | change))
        context.activity_review = {"activity": "free"}
        context.snapshot.health = 30
        return context

    assert restore_default_guard(actor, sample()).tool == "body:native:guard"
    assert restore_default_guard(actor, sample(socialNavigationTargetUuid="")) is None
    assert restore_default_guard(actor, sample(socialNavigationTargetUuid="different-companion")) is None
    assert restore_default_guard(actor, sample(socialWalkAvailable=False)) is None
    assert restore_default_guard(actor, sample(resident=resident | {"activeRequest": "still-moving"})) is None
    danger = sample()
    danger.snapshot.health = 10
    assert restore_default_guard(actor, danger) is None


def test_reviewed_maid_uses_shared_native_routine_while_guarding():
    async def run():
        actor = role(body_kind="maid", default_native_guard=True, activity_review_seconds=90,
                     allowed_tools=["body:native:guard", "body:native:fish"])
        context = maid_context(nativeGuardDelegated=True, sitting=False, fishing={"canStartNativeCatch": True})
        context.snapshot.health = 30
        context.capabilities.native_actions.append(NativeAction(name="fish"))
        context.activity_review = {"activity": "guarding"}
        planner = NpcPlanner(actor, None)
        intent = Intent(id="qa-shared-routine", agent=actor.id, goal=IDLE_GOAL)
        assert [step.tool for step in await planner(intent, context)] == ["body:native:fish"]

    asyncio.run(run())


def test_numen_fast_attack_requires_an_observed_hostile_and_idle_body():
    actor = role()
    context = PlanContext(capabilities=SimBody().capabilities(), snapshot=BodySnapshot(
        life_state="alive", health=8, max_health=30, raw={"facts": {"workPending": False}},
    ))
    assert reaction_choices(actor, context) == {}
    context.snapshot.entities = [{"hostile": True, "id": "qa-visible-hostile"}]
    assert set(reaction_choices(actor, context)) == {"attack_hostile", "wait"}
    context.snapshot.raw["facts"]["workPending"] = True
    assert reaction_choices(actor, context) == {}


def test_idle_does_not_publish_a_routine_status_line_or_suspend_guard():
    async def run():
        actor = role(body_kind="maid", allowed_tools=["body:chat", "body:stay", "body:observe"])
        plan = {"steps": [{"tool": "body:chat", "args": {"text": "前方还很安静。"}},
                          {"tool": "body:observe"}, {"tool": "body:stay"}]}
        transport = httpx.MockTransport(lambda request: httpx.Response(200, json={
            "id": "qa-quiet", "choices": [{"message": {"content": json.dumps(plan)}}],
        }))
        client = ModelClient("http://127.0.0.1:1/v1", "synthetic", http=httpx.AsyncClient(transport=transport))
        try:
            planner = NpcPlanner(actor, client)
            context = maid_context(nativeGuardDelegated=True)
            goal = "Choose one useful activity grounded in the current scene; rest silently when none is needed."
            assert await planner(Intent(id="qa-idle", agent=actor.id, goal=goal), context) == []
        finally:
            await client.close()
    asyncio.run(run())

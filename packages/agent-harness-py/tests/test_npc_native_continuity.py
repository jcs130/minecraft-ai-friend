import asyncio
import json
from datetime import UTC, datetime, timedelta

import httpx

from agent_mc_harness.models import ActionSupport, BodySnapshot, NativeAction
from agent_mc_harness.npc import (
    GUARD_RESTORE_RETRY_SECONDS,
    IDLE_GOAL,
    JOURNEY_ANCHOR_RETRY_SECONDS,
    SELF_CHOSEN_WAIT,
    ModelClient,
    NpcPlanner,
    at_registered_home,
    leave_journey_anchor,
    reaction_choices,
    restore_default_guard,
    reviewed_steps,
)
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
                   {"follow": {"temporaryWait": True}}, {"nativeGuardAvailable": False}):
        assert restore_default_guard(actor, maid_context(**(ready | change))) is None


def test_native_guard_resume_uses_availability_and_bounds_legacy_retries(monkeypatch):
    async def run():
        clock = [100.0]
        monkeypatch.setattr("agent_mc_harness.npc.time.monotonic", lambda: clock[0])
        actor = role(body_kind="maid", default_native_guard=True, autonomy_mode="native_first",
                     allowed_tools=["body:native:guard"])
        planner = NpcPlanner(actor, None)
        scene = dict(nativeGuardDelegated=False, taskId="touhou_little_maid:idle", canMove=True,
                     passenger=False, sitting=False, homeMode=False, follow={"temporaryWait": False},
                     schedule="ALL", activity="idle")
        intent = Intent(id="qa-guard", agent=actor.id, goal=IDLE_GOAL)
        assert await planner(intent, maid_context(**scene, nativeGuardAvailable=False)) == []
        assert [step.tool for step in await planner(intent, maid_context(**scene))] == ["body:native:guard"]
        assert await planner(intent, maid_context(**scene)) == []
        clock[0] += GUARD_RESTORE_RETRY_SECONDS
        assert [step.tool for step in await planner(intent, maid_context(**scene, nativeGuardAvailable=True))] == [
            "body:native:guard"]

    asyncio.run(run())


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


def anchored_resident(**changes):
    """A resident that rested by its own choice where a journey ended, far from its registered house."""
    home = {"dimension": "minecraft:aincrad", "door": {"x": -672, "y": 67, "z": 825}, "work": {"x": -672, "y": 67, "z": 828}}
    expedition = {"state": "not_delegated", "leaderId": "registered-leader", "leaderDimension": "minecraft:overworld"}
    resident = {"loaded": True, "expedition": expedition, "home": home} | changes.pop("resident", {})
    raw = dict(nativeGuardDelegated=False, taskId="touhou_little_maid:idle", canMove=False, passenger=False,
               sitting=True, homeMode=True, follow={"temporaryWait": False}, resident=resident) | changes.pop("raw", {})
    context = maid_context(**raw)
    context.snapshot.health = 30
    context.snapshot.dimension = changes.pop("dimension", "minecraft:overworld")
    context.snapshot.position = changes.pop("position", {"x": -597, "y": 92, "z": -313})
    context.activity_review = ({"activity": "waiting", "elapsedSeconds": 180, "waitPurpose": SELF_CHOSEN_WAIT}
                               | changes.pop("review", {}))
    assert not changes
    return context


def anchored_role(**changes):
    return role(**(dict(body_kind="maid", default_native_guard=True, activity_review_seconds=90, expedition_wait_seconds=180,
                        allowed_tools=["body:native:guard", "body:follow"]) | changes))


def test_registered_home_is_compared_only_with_usable_coordinates():
    home = {"dimension": "minecraft:aincrad", "work": {"x": 0, "y": 64, "z": 0}}
    here = anchored_resident(dimension="minecraft:aincrad", position={"x": 30, "y": 64, "z": 0}).snapshot
    assert at_registered_home(here, home) is True
    here.position = {"x": 60, "y": 64, "z": 0}
    assert at_registered_home(here, home) is False
    here.dimension = "minecraft:overworld"
    assert at_registered_home(here, home) is False
    for unusable in (None, {}, {"dimension": "minecraft:overworld"}, {"dimension": "", "work": {"x": 0, "y": 64, "z": 0}},
                     {"dimension": "minecraft:overworld", "work": {"x": "0", "y": 64, "z": 0}}):
        assert at_registered_home(here, unusable) is None
    here.position = {"x": 1, "y": 64}
    assert at_registered_home(here, home) is None
    here.position, here.dimension = {"x": 1, "y": 64, "z": 2}, None
    assert at_registered_home(here, home) is None


def test_own_expired_rest_on_a_journey_anchor_stands_up_to_rejoin_the_leader():
    actor = anchored_role()
    assert [step.tool for step in leave_journey_anchor(actor, anchored_resident())] == ["body:follow", "body:native:guard"]
    # The anchor itself still blocks the ordinary resume, which cannot move a body in home mode.
    assert restore_default_guard(actor, anchored_resident()) is None
    leader = {"state": "not_delegated", "leaderId": "registered-leader", "leaderDimension": "minecraft:overworld"}
    kept = (
        {"review": {"elapsedSeconds": 179}},
        {"review": {"elapsedSeconds": 180.0}},
        {"review": {"waitPurpose": "在这里等我回来"}},  # An addressed order is remembered with its own words.
        {"review": {"waitPurpose": None}},
        {"review": {"activity": "free"}},
        {"raw": {"homeMode": False}},  # The existing expired-wait resume owns this case.
        {"raw": {"sitting": False}},
        {"raw": {"nativeGuardDelegated": True}},
        {"raw": {"passenger": True}},
        {"raw": {"taskId": "touhou_little_maid:fishing"}},
        {"raw": {"follow": None}},
        {"resident": {"loaded": False}},
        {"resident": {"sleeping": True}},
        {"resident": {"leased": True}},
        {"resident": {"thinking": True}},
        {"resident": {"combat": {"targetId": "hostile"}}},
        {"resident": {"activeRequest": "existing-action"}},
        {"resident": {"expedition": {"state": "not_delegated", "leaderId": "registered-leader"}}},
        {"resident": {"expedition": {"state": "not_delegated", "leaderDimension": "minecraft:overworld"}}},
        {"resident": {"expedition": leader | {"state": "travel_unconfirmed_check_ledger"}}},
        {"resident": {"expedition": leader | {"pendingTravelRequestId": "qa-travel"}}},
        {"resident": {"home": None}},  # Without a registered house the anchor may itself be the home.
        {"dimension": "minecraft:aincrad", "position": {"x": -670, "y": 67, "z": 827}},
        {"position": {"x": -597, "y": 92}},
    )
    for change in kept:
        assert leave_journey_anchor(actor, anchored_resident(**change)) is None, change
    hostile = anchored_resident()
    hostile.snapshot.entities = [{"hostile": True}]
    assert leave_journey_anchor(actor, hostile) is None
    for missing in (anchored_role(expedition_wait_seconds=None),
                    anchored_role(default_native_guard=False, expedition_wait_seconds=None),
                    anchored_role(allowed_tools=["body:native:guard"])):
        assert leave_journey_anchor(missing, anchored_resident()) is None
    unsupported = anchored_resident()
    del unsupported.capabilities.actions["follow"]
    assert leave_journey_anchor(actor, unsupported) is None
    unsupported.capabilities = None
    assert leave_journey_anchor(actor, unsupported) is None


def test_planner_leaves_a_journey_anchor_once_per_retry_window_without_a_model():
    async def run():
        actor = anchored_role()
        planner = NpcPlanner(actor, None)  # No model client: this decision is native policy.
        intent = Intent(id="qa-anchor", agent=actor.id, goal=IDLE_GOAL)
        context = anchored_resident()
        context.agenda = {"current": {"goal": "Rest here and watch"}}
        assert [step.tool for step in await planner(intent, context)] == ["body:follow", "body:native:guard"]
        assert planner.last_route == {"layer": "native-policy", "reason": "leave_expired_journey_anchor"}
        accepted = reviewed_steps(actor, context, [{"tool": "body:follow"}, {"tool": "body:native:guard"}])
        assert [step.tool for step in accepted] == ["body:follow", "body:native:guard"]
        # A refused write leaves the same observation. It waits for the retry window.
        assert planner.next_anchor_leave > 0 and JOURNEY_ANCHOR_RETRY_SECONDS == 600
        planner.next_anchor_leave = 0.0
        assert [step.tool for step in await planner(intent, context)] == ["body:follow", "body:native:guard"]
        # Once the body stands free of the anchor, the ordinary resume delegates guard alone.
        context.snapshot.raw.update(sitting=False, homeMode=False, canMove=True)
        context.activity_review = {"activity": "free", "elapsedSeconds": 0}
        assert [step.tool for step in await planner(intent, context)] == ["body:native:guard"]

    asyncio.run(run())


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

"""Native routines run without a standing model loop, with explicit wakeups."""

import asyncio
import json
import time
from datetime import timedelta
from uuid import UUID

import httpx
import pytest

from agent_mc_harness.journal import ActionJournal
from agent_mc_harness.models import BodyEvent, BodySnapshot, NativeAction, utcnow
from agent_mc_harness.npc import DANGER_GOAL, DIALOGUE_GOAL, IDLE_GOAL, NpcHost, NpcPlanner
from agent_mc_harness.runtime import Intent, PlanContext
from test_maid_social_planning import VisiblePlayers
from test_native_maid import MAID, OWNER, make
from test_npc_native_continuity import maid_context
from test_server_npc import role


class RecordingModel:
    def __init__(self):
        self.prompts = []

    async def request(self, route, payload, timeout):
        self.prompts.append(json.loads(payload["messages"][1]["content"]))
        return {"id": "fixture", "choices": [{"message": {"content": '{"steps":[]}'}}]}


def context(schedule="DAY", activity="work", **raw):
    here = maid_context(schedule=schedule, activity=activity, canMove=True, socialWalkAvailable=True,
                        taskId="touhou_little_maid:farm", taskEnabled=True, **raw)
    here.snapshot.health = 24
    here.capabilities.native_actions.append(NativeAction(name="schedule"))
    return here


def maid(**settings):
    return role(body_kind="maid", allowed_tools=["body:move", "body:chat", "body:native:schedule"], **settings)


def review(planner, here, goal=IDLE_GOAL):
    return asyncio.run(planner(Intent(id="qa-routine", agent=planner.role.id, goal=goal), here))


def test_native_daily_cycles_avoid_model_calls_then_allow_a_periodic_review():
    baseline = RecordingModel()
    standard = NpcPlanner(maid(), baseline)
    model = RecordingModel()
    economical = NpcPlanner(maid(autonomy_mode="native_first"), model)
    for i in range(24):
        activity = ("work", "idle", "rest")[i % 3]
        assert review(standard, context(activity=activity)) == []
        assert review(economical, context(activity=activity)) == []
    assert len(baseline.prompts) == 24 and not model.prompts
    assert economical.next_native_review > time.monotonic() + 895
    economical.next_native_review = time.monotonic() - 1
    assert review(economical, context(activity="rest")) == [] and not model.prompts
    assert review(economical, context(activity="work")) == []
    assert review(economical, context(activity="work")) == []
    assert len(model.prompts) == 1


@pytest.mark.parametrize("schedule", ["DAY", "NIGHT", "ALL"])
def test_configured_schedule_uses_a_native_write_without_model_or_repeat(schedule):
    model = RecordingModel()
    planner = NpcPlanner(maid(autonomy_mode="native_first", native_schedule=schedule), model)
    previous = context(schedule="NIGHT" if schedule == "DAY" else "DAY")
    step, = review(planner, previous)
    assert step.tool == "body:native:schedule" and step.args == {"schedule": schedule}
    assert review(planner, previous) == []  # Receipt or native observation has not caught up.
    assert review(planner, context(schedule=schedule)) == []
    assert not model.prompts


def test_do_not_change_schedule_while_natively_busy_or_without_capability():
    model = RecordingModel()
    planner = NpcPlanner(maid(autonomy_mode="native_first", native_schedule="DAY"), model)
    asleep = context(schedule="ALL", activity="rest")
    busy = context(schedule="ALL", resident={"loaded": True, "activeRequest": "original-action"})
    incapable = context(schedule="ALL")
    incapable.capabilities.native_actions.clear()
    for here in (asleep, busy, incapable):
        assert review(planner, here) == [] and not model.prompts


def test_new_agenda_and_unavailable_native_task_each_wake_once():
    model = RecordingModel()
    planner = NpcPlanner(maid(autonomy_mode="native_first"), model)
    here = context()
    assert review(planner, here) == []
    here.agenda = {"current": {"startsAt": 30, "endsAt": 300, "goal": "Meet a visitor", "evidence": "Nearby"}, "upcoming": []}
    assert review(planner, here) == []
    assert review(planner, here) == []
    here.snapshot.raw["taskEnabled"] = False
    assert review(planner, here) == []
    assert review(planner, here) == []
    assert len(model.prompts) == 2


def test_addressed_turn_and_critical_danger_bypass_routine_savings():
    actor = maid(autonomy_mode="native_first")
    model = RecordingModel()
    planner = NpcPlanner(actor, model)
    asleep = context(activity="rest")
    assert review(planner, asleep) == [] and not model.prompts
    asleep.dialogue = [BodyEvent(kind="dialogue", body_kind="maid", body_id=str(actor.body_id),
                                text="在吗？", data={"eventId": "test-dialogue", "speakerId": str(actor.owner_id)})]
    assert review(planner, asleep, DIALOGUE_GOAL) == [] and len(model.prompts) == 1
    assert model.prompts[0]["currentDialogue"][0]["data"]["eventId"] == "test-dialogue"
    guarding = context(nativeGuardDelegated=True, resident={"combat": {"targetId": "known-mob"}})
    assert review(planner, guarding, DANGER_GOAL) == [] and len(model.prompts) == 1
    guarding.snapshot.health = 5
    assert review(planner, guarding, DANGER_GOAL) == [] and len(model.prompts) == 2
    assert review(planner, guarding, DANGER_GOAL) == [] and len(model.prompts) == 2


@pytest.mark.parametrize("data", [{"ai": True}, {"duty": {"movementOwnedByServer": True}}])
def test_villager_native_brain_or_service_schedule_owns_the_quiet_turn(data):
    model = RecordingModel()
    actor = role(body_kind="villager", autonomy_mode="native_first",
                 allowed_tools=["body:observe", "body:chat", "body:move", "body:stop"])
    planner = NpcPlanner(actor, model)
    here = PlanContext(snapshot=BodySnapshot(life_state="alive", raw=data))
    assert review(planner, here) == [] and not model.prompts
    assert planner.last_route["reason"] == "native_routine_continuing"
    assert review(planner, here, DIALOGUE_GOAL) == [] and len(model.prompts) == 1


def test_old_or_missing_body_sample_does_not_start_a_speculative_ordinary_turn():
    model = RecordingModel()
    planner = NpcPlanner(maid(autonomy_mode="native_first"), model)
    here = context()
    here.snapshot.sampled_at = utcnow() - timedelta(seconds=10)
    assert review(planner, here) == [] and not model.prompts
    assert planner.last_route["reason"] == "native_observation_unavailable"


def test_native_schedule_cannot_expand_a_body_catalogue():
    with pytest.raises(ValueError, match="native_schedule_requires_authorized_maid_routine"):
        role(body_kind="maid", autonomy_mode="native_first", native_schedule="DAY", allowed_tools=["body:move"])
    with pytest.raises(ValueError, match="native_first_requires_maid_or_villager"):
        role(body_kind="numen", autonomy_mode="native_first")


def test_native_schedule_and_day_phase_are_read_back_through_the_body_adapter(tmp_path):
    async def run():
        world = VisiblePlayers()
        world.actions.append("schedule")
        clock = {"schedule": "ALL", "activity": "work"}

        def game(request):
            args = json.loads(request.content).get("arguments", {})
            response = world(request)
            if args.get("action") == "schedule":
                clock["schedule"] = args["schedule"]
            if args.get("action") != "context":
                return response
            envelope = response.json()
            content = envelope["result"]["content"][0]
            row = json.loads(content["text"])
            row["data"].update(clock, taskEnabled=True)
            content["text"] = json.dumps(row)
            return httpx.Response(response.status_code, json=envelope)

        actor = maid(body_id=UUID(MAID), character_id=UUID(MAID), owner_id=UUID(OWNER),
                    autonomy_mode="native_first", native_schedule="DAY", activity_review_seconds=90)
        body = make(game, scope=actor.scope("qa-schedule"))
        journal = ActionJournal(tmp_path / "schedule.sqlite3")
        model = RecordingModel()
        planner = NpcPlanner(actor, model)
        host = NpcHost(actor, body, planner, None, journal)
        try:
            await body.spawn()
            first = host.runtime.submit_intent(IDLE_GOAL, agent=actor.id)
            await host.runtime.run_intent(first)
            operation, = journal.recent(str(actor.body_id))
            assert operation[0].name == "schedule" and operation[1].terminal and operation[1].status == "completed"
            assert (await body.snapshot()).raw["schedule"] == "DAY"
            for phase in ("rest", "work"):
                clock["activity"] = phase
                turn = host.runtime.submit_intent(IDLE_GOAL, agent=actor.id)
                await host.runtime.run_intent(turn)
                assert turn.state == "completed" and (await body.snapshot()).raw["activity"] == phase
            assert [action["action"] for action in world.writes] == ["schedule"] and not model.prompts
        finally:
            await host.close()
            journal.close()
    asyncio.run(run())

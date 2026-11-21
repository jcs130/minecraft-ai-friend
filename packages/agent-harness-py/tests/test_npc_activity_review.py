import asyncio
import json
import time
from datetime import timedelta

import httpx
import pytest

from agent_mc_harness.journal import ActionJournal
from agent_mc_harness.models import ActionReceipt
from agent_mc_harness.npc import DANGER_GOAL, IDLE_GOAL, ModelClient, NpcHost, NpcPlanner, activity_scene
from agent_mc_harness.runtime import Intent, Step
from simbody import SimBody
from test_npc_native_continuity import maid_context
from test_server_npc import role


def resident(sitting=False, *, activity=None, expedition=None, **extra):
    details = {"loaded": True, "activeRequest": "none", "sleeping": False, "combat": {}, **(activity or {})}
    if expedition is not None:
        details["expedition"] = expedition
    return maid_context(sitting=sitting, resident=details, taskId="touhou_little_maid:idle",
                        nativeGuardDelegated=not sitting, **extra)


def actor():
    return role(body_kind="maid", default_native_guard=True, activity_review_seconds=90,
                allowed_tools=["body:native:guard", "body:stay", "body:observe"])


def turn(goal=IDLE_GOAL):
    return Intent(id="review-turn", agent="yui", goal=goal)


def test_wait_purpose_belongs_to_body_and_confirmed_request(tmp_path):
    path = tmp_path / "actions.sqlite"
    journal = ActionJournal(path)
    step = Step(tool="body:stay", note="在路口给落后的队友指路")
    journal.begin("yui", step.action("wait-order-01"), note=step.note)
    receipt = ActionReceipt(request_id="wait-order-01", verb="stay", status="unknown", terminal=False)
    journal.settle("yui", receipt)
    assert journal.unresolved("yui")
    assert journal.observe_activity("yui", "free", "a", time.time())[2] is None
    journal.close()
    journal = ActionJournal(path)
    journal.settle("yui", receipt.model_copy(update={"status": "completed", "terminal": True}))
    started, reviewed, purpose, _ = journal.observe_activity("yui", "waiting", "a", time.time())
    assert purpose == step.note and reviewed >= started
    assert journal.observe_activity("kirito", "waiting", "a", time.time())[2] is None
    assert journal.observe_activity("yui", "waiting", "leader-back", time.time())[1:] == (None, step.note, True)
    now = time.time()
    journal.reviewed_activity("yui", "waiting", "leader-back", now, renew_wait=True)
    assert journal.observe_activity("yui", "waiting", "leader-back", now)[0] == started
    journal.reviewed_activity("yui", "waiting", "leader-back", now, "再等一会儿", renew_wait=True)
    assert journal.observe_activity("yui", "waiting", "leader-back", now)[:3] == (now, now, "再等一会儿")
    journal.observe_activity("yui", "working", "a", time.time())
    journal.settle("yui", receipt.model_copy(update={"status": "completed", "terminal": True}))
    assert journal.observe_activity("yui", "waiting", "a", time.time())[2] is None
    journal.begin("yui", step.action("wait-order-02"), note="不应生效")
    journal.settle("yui", receipt.model_copy(update={"request_id": "wait-order-02", "status": "failed", "terminal": True}))
    assert journal.observe_activity("yui", "waiting", "a", time.time())[2] is None
    journal.close()


@pytest.mark.parametrize("mode,make", [
    ("waiting", lambda: resident(sitting=True)), ("sleeping", lambda: resident(activity={"sleeping": True})),
    ("working", lambda: maid_context(taskId="touhou_little_maid:fishing", resident={"loaded": True})),
    ("fighting", lambda: resident(activity={"combat": {"targetId": "zombie"}})), ("guarding", resident),
    ("free", lambda: maid_context(resident={"loaded": True})),
])
def test_current_activities_are_inputs_to_judgment(mode, make):
    assert activity_scene(make().snapshot)[0] == mode


def test_late_or_unknown_body_and_pending_writes_stay_fenced():
    stale = resident().snapshot
    stale.sampled_at -= timedelta(seconds=9)
    for snap in (None, stale, resident(activity={"loaded": False}).snapshot, resident(activity={"downed": True}).snapshot,
                 resident(activity={"activeRequest": "old-work"}).snapshot,
                 resident(expedition={"pendingTravelRequestId": "prior-trip"}).snapshot):
        assert activity_scene(snap) is None


def test_model_can_remain_waiting_leave_early_or_choose_its_own_break(tmp_path):
    async def run():
        answers, prompts = [], []
        def respond(request):
            prompts.append(json.loads(json.loads(request.content)["messages"][1]["content"]))
            return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps({"steps": answers.pop(0)})}}]})
        model = ModelClient("http://127.0.0.1:1/v1", "test", http=httpx.AsyncClient(transport=httpx.MockTransport(respond)))
        registered = actor()
        journal = ActionJournal(tmp_path / "actions.sqlite")
        body = SimBody()
        planner = NpcPlanner(registered, model)
        host = NpcHost(registered, body, planner, None, journal)
        here = resident(sitting=True, expedition={"leaderId": "partner"})
        async def sample():
            return here.snapshot
        body.snapshot = sample
        try:
            answers.append([])
            assert await host._plan(turn(), here) == []
            assert await host._plan(turn(), here) == [] and len(prompts) == 1  # quiet interval
            mode, cue = activity_scene(here.snapshot)
            journal.reviewed_activity(str(registered.body_id), mode, cue, time.time() - 95)
            answers.append([])
            assert await host._plan(turn(), here) == [] and len(prompts) == 2  # no forced expiry
            here.snapshot.raw["resident"]["expedition"]["leaderDimension"] = "minecraft:overworld"
            answers.append([{"tool": "body:native:guard"}])
            assert [s.tool for s in await host._plan(turn(), here)] == ["body:native:guard"]
            assert prompts[-1]["activityReview"]["activity"] == "waiting"
            here = resident()
            answers.append([{"tool": "body:stay", "note": "在湖边歇息"}])
            steps = await host._plan(turn(), here)
            assert [(s.tool, s.note) for s in steps] == [("body:stay", "在湖边歇息")]
            here = resident(sitting=True)
            answers.append([{"tool": "body:stay"}])
            assert await host._plan(turn(DANGER_GOAL), here) == []  # continue, with no duplicate physical write
            answers.append([{"tool": "body:native:guard"}])
            async def changed_while_thinking():
                return resident(activity={"activeRequest": "another-action"}).snapshot
            body.snapshot = changed_while_thinking
            assert await host._plan(turn(DANGER_GOAL), here) == []
            assert not body.acts
        finally:
            await model.close()
            journal.close()
    asyncio.run(run())

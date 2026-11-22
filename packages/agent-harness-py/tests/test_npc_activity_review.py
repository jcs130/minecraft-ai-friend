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


def autonomous_host(tmp_path, planner):
    from agent_mc_harness.models import BodyIdentity, WorldRef

    configured = role()
    body = SimBody(body_id=str(configured.body_id))
    body.identity = lambda: BodyIdentity(kind="numen", body_id=str(configured.body_id),
                                        owner_id=str(configured.native_owner_id), scope=configured.scope("qa"),
                                        world=WorldRef(server_id="qa", world_key="world"))
    return NpcHost(configured, body, planner, None, ActionJournal(tmp_path / "progress.sqlite")), body


def test_receipt_read_failure_does_not_kill_actor_or_replay(tmp_path):
    from agent_mc_harness.models import BodyAction

    async def run():
        async def forbidden_plan(intent, context):
            raise AssertionError("an unknown write must still fence new planning")

        host, body = autonomous_host(tmp_path, forbidden_plan)
        original = BodyAction(verb="chat", request_id="original_unknown_01", args={"text": "synthetic-private-message"})
        unknown = ActionReceipt(request_id=original.request_id, verb="chat", status="unknown", terminal=False)
        host.journal.begin(body.body_id, original)
        host.journal.settle(body.body_id, unknown)
        queries, second_read, release = [], asyncio.Event(), asyncio.Event()

        async def read(request_id):
            queries.append(request_id)
            if len(queries) == 1:
                host.wake.set()
                raise OSError("synthetic transport interruption")
            second_read.set()
            await release.wait()
            return unknown

        body.result = read
        task = asyncio.create_task(host.run())
        try:
            await asyncio.wait_for(second_read.wait(), 1)
            assert not task.done() and queries == [original.request_id, original.request_id]
            assert host.journal.unresolved(body.body_id)[0].request_id == original.request_id
            progress = host.autonomy_status()
            assert progress["state"] == "waiting_for_original_receipt" and progress["needsAttention"]
            assert progress["lastError"] == "original_receipt_unavailable:OSError"
            assert progress["lastPlanStartedAt"] is None and progress["lastObservationAt"] is None
            assert "synthetic-private-message" not in json.dumps(progress)
            assert original.request_id not in json.dumps(progress)
            assert not body.acts
        finally:
            release.set()
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            await host.close()

    asyncio.run(run())


def test_receipt_query_timeout_is_bounded_and_keeps_original_request(tmp_path):
    from agent_mc_harness.models import BodyAction

    async def run():
        host, body = autonomous_host(tmp_path, None)
        host.READ_TIMEOUT_SECONDS = .02
        original = BodyAction(verb="move", request_id="original_timeout_01", args={"x": 1, "y": 64, "z": 0})
        host.journal.begin(body.body_id, original)
        read_cancelled, second_read = asyncio.Event(), asyncio.Event()
        reads = []

        async def unavailable(request_id):
            reads.append(request_id)
            if len(reads) == 2:
                second_read.set()
            try:
                await asyncio.Future()
            except asyncio.CancelledError:
                read_cancelled.set()
                host.wake.set()
                raise

        body.result = unavailable
        task = asyncio.create_task(host.run())
        try:
            await asyncio.wait_for(second_read.wait(), 1)
            assert read_cancelled.is_set() and not task.done()
            assert reads == [original.request_id, original.request_id] and not body.acts
            assert host.journal.unresolved(body.body_id)[0].request_id == original.request_id
            assert host.autonomy_status()["lastError"] == "original_receipt_unavailable:TimeoutError"
            assert host.last_receipt_query_at is None
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            await host.close()

    asyncio.run(run())


def test_original_terminal_receipt_unfences_a_fresh_plan_without_replay(tmp_path):
    from agent_mc_harness.models import BodyAction

    async def run():
        planned = asyncio.Event()

        async def plan(intent, context):
            planned.set()
            return []

        host, body = autonomous_host(tmp_path, plan)
        original = BodyAction(verb="move", request_id="original_settled_01", args={"x": 1, "y": 64, "z": 0})
        host.journal.begin(body.body_id, original)
        host.journal.settle(body.body_id, ActionReceipt(request_id=original.request_id, verb="move", status="unknown", terminal=False))
        queries = []

        async def reconcile(request_id):
            queries.append(request_id)
            host.wake.set()
            return ActionReceipt(request_id=request_id, verb="move", status="failed", terminal=True)

        body.result = reconcile
        task = asyncio.create_task(host.run())
        try:
            await asyncio.wait_for(planned.wait(), 1)
            assert queries == [original.request_id] and not body.acts
            assert not host.journal.unresolved(body.body_id)
            assert host.last_receipt_query_at and host.last_receipt_settled_at and host.last_observation_at
            assert host.last_plan_started_at and host.last_plan_finished_at and host.last_plan_outcome == "completed"
            assert host.autonomy_status()["pendingRequests"] == []
            assert host.journal.receipt(body.body_id, original.request_id).status == "failed"
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            await host.close()

    asyncio.run(run())


def test_progress_detects_stalled_loop_but_not_maintenance_and_survives_close(tmp_path):
    async def run():
        host, body = autonomous_host(tmp_path, None)
        await body.spawn()
        try:
            assert host.autonomy_status()["state"] == "starting"
            host.last_loop_monotonic = time.monotonic() - 31
            host.last_loop_at = "synthetic-checkpoint"
            assert host.autonomy_status()["state"] == "loop_stalled"
            assert host.autonomy_status()["needsAttention"]
            host.pausing = True
            assert host.autonomy_status()["state"] == "maintenance"
            assert not host.autonomy_status()["needsAttention"]
        finally:
            await host.close()
        # Service publishes one final row after the journal is closed.
        assert host.autonomy_status()["state"] == "maintenance"

    asyncio.run(run())


def test_failed_or_unknown_observation_is_not_a_successful_sense_timestamp(tmp_path):
    from agent_mc_harness.models import BodySnapshot

    async def run():
        host, body = autonomous_host(tmp_path, None)

        async def broken():
            raise OSError("synthetic observation interruption")

        body.snapshot = broken
        try:
            assert await host._observe() is None
            assert host.last_observation_at is None
            assert host.loop_error == "observation_unavailable:OSError"

            async def unknown():
                return BodySnapshot(life_state="unknown")

            body.snapshot = unknown
            assert (await host._observe()).life_state == "unknown"
            assert host.last_observation_at is None
        finally:
            await host.close()

    asyncio.run(run())

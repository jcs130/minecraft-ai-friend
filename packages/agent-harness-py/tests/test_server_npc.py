import asyncio
import json
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta

import httpx
import pytest

from agent_mc_harness.body.safety import guard_body
from agent_mc_harness.fastslow import FastSlow, FastSlowConfig
from agent_mc_harness.journal import ActionJournal
from agent_mc_harness.models import BodyAction, BodyEvent, BodyIdentity, BodySnapshot, SafetyState, WorldRef
from agent_mc_harness.npc import FastSelector, ModelClient, NpcHost, NpcPlanner, NpcRole, reviewed_steps
from agent_mc_harness.runtime import HarnessRuntime, PlanContext, Step
from simbody import SimBody


def role(**changes):
    values = dict(id="kirito", name="桐人", character_id="8ae995f9-5944-48c9-b720-0ab91bdfff09",
                  body_id="8ae995f9-5944-48c9-b720-0ab91bdfff09", owner_id="00000000-0000-4000-8000-000000000001",
                  body_kind="numen", provider="tokenplan", model="qwen3.8-flash", persona="A thoughtful swordsman.",
                  allowed_tools=["body:chat", "body:move", "body:attack", "body:observe", "body:stop"])
    return NpcRole(**(values | changes))


def test_unknown_configured_verb_is_rejected_before_host_start():
    with pytest.raises(ValueError):
        role(allowed_tools=["body:observe", "body:use"])
    assert role(allowed_tools=["body:observe", "body:use_item"]).allowed_tools[-1] == "body:use_item"


@pytest.mark.parametrize("step", [
    {"tool": "body:command", "args": {"line": "/op anyone"}},
    {"tool": "body:attack", "args": {"target": "player"}},
    {"tool": "body:chat", "args": {"text": "x" * 41}},
    {"tool": "body:move", "args": {"companion": "other-role", "x": 1, "y": 2, "z": 3}},
])
def test_model_cannot_expand_body_authority(step):
    with pytest.raises(ValueError):
        reviewed_steps(role(), PlanContext(capabilities=SimBody().capabilities()), [step])


def test_numen_item_use_is_limited_to_the_reviewed_id_and_parameters():
    configured = role(allowed_tools=["body:use_item"], native_items=["test_mod:charm"])
    step = {"tool": "body:use_item", "args": {"item": "test_mod:charm"}}
    assert reviewed_steps(configured, PlanContext(), [step])[0].args == step["args"]
    for args in ({"item": "test_mod:other"}, {"item": "test_mod:charm", "hold": 30}):
        with pytest.raises(ValueError, match="item_not_in_reviewed_native_catalogue"):
            reviewed_steps(configured, PlanContext(), [{**step, "args": args}])


def test_slow_model_gets_current_scene_and_empty_plan_rests():
    async def run():
        received = []
        def answer(request):
            received.append(json.loads(request.content))
            return httpx.Response(200, json={"id": "synthetic-plan", "choices": [{"message": {"content": '{"steps":[]}'}}]})
        http = httpx.AsyncClient(transport=httpx.MockTransport(answer))
        model = ModelClient("http://127.0.0.1:4000/v1", "test", http=http)
        body = SimBody()
        await body.spawn()
        runtime = HarnessRuntime(body=body, planner=NpcPlanner(role(), model), execute=True)
        intent = runtime.submit_intent("Observe and rest if safe")
        await runtime.run_intent(intent)
        assert intent.state == "completed" and not body.acts
        assert json.loads(received[0]["messages"][1]["content"])["observed"]["health"] == 20
        assert received[0]["model"] == "qwen3.8-flash"
        await runtime.close()
        await model.close()
    asyncio.run(run())


def test_unknown_write_blocks_other_writes_after_restart(tmp_path):
    async def run():
        path = tmp_path / "actions.sqlite"
        body = SimBody(unknown={"move"})
        await body.spawn()
        journal = ActionJournal(path)
        runtime = HarnessRuntime(body=body, execute=True, journal=journal)
        intent = runtime.submit_intent("move", steps=[{"tool": "body:move", "args": {"x": 1, "y": 64, "z": 0}}])
        await runtime.run_intent(intent)
        assert intent.state == "paused"
        original = journal.unresolved(body.body_id)[0]
        await runtime.close()
        journal.close()
        journal = ActionJournal(path)
        second = SimBody()
        await second.spawn()
        runtime = HarnessRuntime(body=second, execute=True, journal=journal)
        retry = runtime.submit_intent("try another action", steps=[{"tool": "body:chat", "args": {"text": "hello"}}])
        await runtime.run_intent(retry)
        assert retry.state == "paused" and not second.acts
        assert journal.unresolved(body.body_id)[0].request_id == original.request_id
        second.restore_request(original)
        assert (await second.result(original.request_id)).status == "unknown" and not second.acts
        await runtime.close()
        journal.close()
    asyncio.run(run())


def test_journal_commit_failure_prevents_dispatch(tmp_path):
    async def run():
        body = SimBody()
        await body.spawn()
        journal = ActionJournal(tmp_path / "actions.sqlite")
        def fail(*args): raise OSError("disk full")
        journal.begin = fail
        runtime = HarnessRuntime(body=body, execute=True, journal=journal)
        intent = runtime.submit_intent("chat", steps=[{"tool": "body:chat", "args": {"text": "hello"}}])
        await runtime.run_intent(intent)
        assert not body.acts and intent.state == "failed"
        await runtime.close()
        journal.close()
    asyncio.run(run())


@pytest.mark.parametrize("choice,confidence,age,expected", [("guard", .9, 0, True), ("invented", .99, 0, False), ("guard", .3, 0, False), ("guard", .9, 10, False)])
def test_fast_model_is_a_fresh_bounded_selector(choice, confidence, age, expected):
    async def run():
        http = httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(200, json={
            "answers": {"action": {"choice": choice, "confidence": confidence}}})))
        client = ModelClient("https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1", "test", http=http)
        selector = FastSelector(client)
        context = PlanContext(capabilities=SimBody().capabilities(), snapshot=BodySnapshot(life_state="alive", sampled_at=datetime.now(UTC)-timedelta(seconds=age)))
        result = await selector.choose(role(), context, {"guard": Step(tool="body:attack", args={"target": "hostile"}), "wait": Step(tool="body:observe")})
        assert (result is not None) == expected
        await client.close()
    asyncio.run(run())


def test_cross_role_receipt_does_not_clear_pending(tmp_path):
    from agent_mc_harness.models import ActionReceipt
    journal = ActionJournal(tmp_path / "actions.sqlite")
    journal.begin("kirito", BodyAction(verb="move", request_id="original_123"))
    with pytest.raises(ValueError):
        journal.settle("yui", ActionReceipt(request_id="original_123", verb="move", status="completed", terminal=True))
    assert len(journal.unresolved("kirito")) == 1
    journal.close()


def test_numen_consumes_delivered_dialogue_without_reply_loop(tmp_path):
    from agent_mc_harness.models import BodyEvent, BodyIdentity, WorldRef
    from agent_mc_harness.npc import NpcHost
    async def run():
        actor = role()
        body = SimBody(body_id=str(actor.body_id))
        body.identity = lambda: BodyIdentity(kind="numen", body_id=str(actor.body_id), world=WorldRef(server_id="qa", world_key="world"), scope=actor.scope("qa"))
        async def plan(intent, context):
            return [Step(tool="body:chat", args={"text":"收到。"})] if intent.source_events else []
        host = NpcHost(actor, body, plan, None, ActionJournal(tmp_path / "dialogue.sqlite"))
        host._event(BodyEvent(kind="chat", body_kind="numen", text="桐人，在吗？", body_id=str(actor.body_id), data={"eventId":"original_event_1", "speakerId":str(actor.owner_id)}))
        running = asyncio.create_task(host.run())
        try:
            for _ in range(40):
                if body.acts: break
                await asyncio.sleep(.05)
            assert len(body.acts) == 1
            host.next_plan = 0
            host.wake.set()
            await asyncio.sleep(2.3)
            assert len(body.acts) == 1
            assert not host.pending_dialogue
        finally:
            running.cancel()
            await asyncio.gather(running, return_exceptions=True)
            await host.close()
    asyncio.run(run())


class _RecoveryBody(SimBody):
    """Synthetic observations and a record of every action entry, even refused writes."""

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.life_state = "alive"
        self.safety = None
        self.act_calls = []
        self.stop_calls = []
        self.snapshot_reads = []

    def health(self):
        return super().health().model_copy(update={"safety": self.safety})

    async def act(self, action):
        self.act_calls.append(action)
        return await super().act(action)

    async def stop(self, reason=None):
        self.stop_calls.append(reason)
        return await super().stop(reason)

    async def snapshot(self):
        snapshot = (await super().snapshot()).model_copy(update={"life_state": self.life_state})
        self.snapshot_reads.append(snapshot)
        return snapshot


class _SlowRecoveryPlanner:
    def __init__(self, steps=None):
        self.entered = asyncio.Event()
        self.release = asyncio.Event()
        self.calls = []
        self.steps = steps if steps is not None else [Step(tool="body:move", args={"x": 1, "y": 64, "z": 0})]

    async def __call__(self, intent, context):
        self.calls.append((intent, context.snapshot))
        if len(self.calls) == 1:
            self.entered.set()
            await self.release.wait()
            return self.steps
        return [Step(tool="body:chat", args={"text": "synthetic fresh plan"})]


async def _wait_for_recovery_condition(condition):
    async def wait():
        while not condition():
            await asyncio.sleep(.005)
    await asyncio.wait_for(wait(), 2)


@asynccontextmanager
async def _recovery_harness(tmp_path, *, durable=True):
    body = _RecoveryBody()
    await body.spawn()
    journal = ActionJournal(tmp_path / "recovery.sqlite") if durable else None
    runtime = HarnessRuntime(body=body, execute=True, journal=journal)
    try:
        yield runtime, body, journal
    finally:
        await runtime.close()
        if journal is not None:
            journal.close()


def _emit_recovery_pause(body, kind):
    if kind == "death":
        body.life_state, body.health_ = "dead", 0
        body._set_state("dead")
    else:
        body.safety = SafetyState(halted=True, reason="synthetic safety halt")
    event = body.emit(kind, "synthetic runtime interruption")
    assert isinstance(event, BodyEvent) and event.kind == kind


async def _revive_recovery_body(body, *, safety=None):
    body.life_state, body.health_, body.safety = "alive", 20, safety
    await body.spawn()


async def _pause_during_real_planning(runtime, body, kind="death"):
    """Get the marker from run_intent + the subscribed BodyEvent, never assign it."""
    previous_planner = runtime.planner
    planner = _SlowRecoveryPlanner()
    runtime.planner = planner
    intent = runtime.submit_intent("synthetic interrupted plan")
    before_actions = len(body.act_calls)
    running = asyncio.create_task(runtime.run_intent(intent))
    try:
        await asyncio.wait_for(planner.entered.wait(), 2)
        assert runtime._active is intent and intent.state == "active"
        _emit_recovery_pause(body, kind)
        assert intent.state == "paused" and intent.needs_host
        assert intent.recoverable_pause == kind
        assert "recoverable_pause" not in intent.model_dump()
        planner.release.set()
        await asyncio.wait_for(running, 2)
        assert runtime._active is None
        assert intent.state == "paused" and intent.recoverable_pause == kind
        assert intent.step_index == 0 and not intent.receipts
        assert len(body.act_calls) == before_actions
        return intent
    finally:
        planner.release.set()
        if not running.done():
            running.cancel()
        await asyncio.gather(running, return_exceptions=True)
        runtime.planner = previous_planner


@pytest.mark.parametrize("safety", [None, SafetyState(halted=False)], ids=["no-safety-report", "explicit-clear"])
@pytest.mark.parametrize("age", [-.5, 0, 4.5], ids=["within-future-tolerance", "current", "within-five-seconds"])
def test_recovered_death_pause_retires_once_without_dispatch(tmp_path, safety, age):
    async def run():
        async with _recovery_harness(tmp_path) as (runtime, body, journal):
            intent = await _pause_during_real_planning(runtime, body)
            await _revive_recovery_body(body, safety=safety)
            snapshot = (await body.snapshot()).model_copy(update={
                "sampled_at": datetime.now(UTC) - timedelta(seconds=age),
            })
            assert runtime.retire_recovered_pauses(snapshot) is True
            assert intent.state == "cancelled"
            assert intent.reason == "body_recovered_replan_from_current_observation"
            assert intent.step_index == 0 and not intent.receipts
            assert not body.act_calls and not body.stop_calls
            assert not journal.unresolved(body.body_id) and not journal.recent(body.body_id)
            assert runtime.retire_recovered_pauses(await body.snapshot()) is False
            assert intent.state == "cancelled" and not body.act_calls
    asyncio.run(run())


@pytest.mark.parametrize("pause_kind", ["death", "safety"])
@pytest.mark.parametrize("blocker", [
    "stale", "future", "dead", "unloaded", "unknown", "snapshot-none",
    "lifecycle-dead", "lifecycle-detached", "lifecycle-reconnecting", "lifecycle-destroyed", "lifecycle-error",
    "disconnected", "safety-halted",
])
def test_recoverable_pause_rejects_unverified_body_recovery(tmp_path, monkeypatch, pause_kind, blocker):
    async def run():
        async with _recovery_harness(tmp_path) as (runtime, body, journal):
            intent = await _pause_during_real_planning(runtime, body, pause_kind)
            await _revive_recovery_body(body, safety=SafetyState(halted=False))
            snapshot = await body.snapshot()
            if blocker in {"stale", "future"}:
                age = 5.5 if blocker == "stale" else -1.5
                snapshot = snapshot.model_copy(update={"sampled_at": datetime.now(UTC) - timedelta(seconds=age)})
            elif blocker in {"dead", "unloaded", "unknown"}:
                snapshot = snapshot.model_copy(update={"life_state": blocker})
            elif blocker == "snapshot-none":
                snapshot = None
            elif blocker.startswith("lifecycle-"):
                body._set_state(blocker.removeprefix("lifecycle-"))
            elif blocker == "disconnected":
                health = body.health().model_copy(update={"connected": False})
                monkeypatch.setattr(body, "health", lambda: health)
            else:
                body.safety = SafetyState(halted=True, reason="still halted")
            before = intent.model_dump()
            assert runtime.retire_recovered_pauses(snapshot) is False
            assert intent.model_dump() == before
            assert intent.state == "paused" and intent.needs_host
            assert intent.recoverable_pause == pause_kind
            assert not body.act_calls and not body.stop_calls and not journal.unresolved(body.body_id)
    asyncio.run(run())


@pytest.mark.parametrize("source", ["event", "blocked-receipt"])
def test_safety_pause_requires_explicit_clear_before_retirement(tmp_path, monkeypatch, source):
    async def run():
        async with _recovery_harness(tmp_path) as (runtime, inner, journal):
            if source == "event":
                body = inner
                intent = await _pause_during_real_planning(runtime, inner, "safety")
            else:
                body = guard_body(inner)
                runtime.attach_body(body)
                # A pre-existing halt returns blocked_by_safety without a new safety event.
                body.state = SafetyState(halted=True, reason="synthetic pre-existing halt")
                intent = runtime.submit_intent("synthetic blocked move", steps=[
                    {"tool": "body:move", "args": {"x": 1, "y": 64, "z": 0}},
                ])
                await runtime.run_intent(intent)
                assert intent.receipts[0].status == "blocked_by_safety"
                assert not any(event.kind == "safety" for event in runtime.events)
            assert intent.state == "paused" and intent.needs_host and intent.recoverable_pause == "safety"
            assert runtime.retire_recovered_pauses(await body.snapshot()) is False
            health = body.health
            with monkeypatch.context() as patch:
                patch.setattr(body, "health", lambda: health().model_copy(update={"safety": None}))
                assert runtime.retire_recovered_pauses(await body.snapshot()) is False
            assert intent.state == "paused" and intent.recoverable_pause == "safety"
            if source == "event":
                inner.safety = SafetyState(halted=False)
            else:
                body.clear_halt()
            assert runtime.retire_recovered_pauses(await body.snapshot()) is True
            assert intent.state == "cancelled" and intent.reason == "body_recovered_replan_from_current_observation"
            assert intent.step_index == 0 and not inner.act_calls and not inner.stop_calls
            assert not journal.unresolved(inner.body_id)
    asyncio.run(run())


@pytest.mark.parametrize("reason", [None, "body died", "safety halt: synthetic", "no steps: host must supply constraints.steps"])
def test_host_pause_reason_does_not_authorize_recovery(tmp_path, reason):
    async def run():
        async with _recovery_harness(tmp_path) as (runtime, body, journal):
            intent = runtime.submit_intent("synthetic manual pause", steps=[{"tool": "body:chat", "args": {"text": "do not send"}}])
            assert intent.recoverable_pause is None
            await runtime.control("pause", intent.id, reason=reason)
            assert intent.state == "paused" and intent.recoverable_pause is None
            before = intent.model_dump()
            assert runtime.retire_recovered_pauses(await body.snapshot()) is False
            assert intent.model_dump() == before and not body.act_calls and not body.stop_calls
            assert not journal.unresolved(body.body_id)
    asyncio.run(run())


@pytest.mark.parametrize("pause_kind", ["death", "safety"])
def test_host_pause_overrides_already_paused_recoverable_intent(tmp_path, pause_kind):
    async def run():
        async with _recovery_harness(tmp_path) as (runtime, body, journal):
            intent = await _pause_during_real_planning(runtime, body, pause_kind)
            await _revive_recovery_body(body, safety=SafetyState(halted=False))
            await runtime.control("pause", intent.id, reason="body died")
            assert intent.state == "paused" and intent.reason == "body died"
            assert intent.recoverable_pause is None
            assert runtime.retire_recovered_pauses(await body.snapshot()) is False
            assert intent.state == "paused" and not body.act_calls and not body.stop_calls
            assert not journal.unresolved(body.body_id)
    asyncio.run(run())


def test_original_unknown_dispatch_blocks_retirement_without_replay(tmp_path):
    async def run():
        async with _recovery_harness(tmp_path) as (runtime, body, journal):
            body.unknown.add("move")
            original_intent = runtime.submit_intent("synthetic uncertain write", steps=[
                {"tool": "body:move", "args": {"x": 7, "y": 64, "z": 0}},
            ])
            await runtime.run_intent(original_intent)
            assert original_intent.state == "paused" and original_intent.needs_host
            assert original_intent.recoverable_pause is None
            original = journal.unresolved(body.body_id)[0]
            original_receipt = journal.receipt(body.body_id, original.request_id)
            assert original_receipt.status == "unknown" and not original_receipt.terminal
            interrupted = await _pause_during_real_planning(runtime, body)
            await _revive_recovery_body(body)
            assert len(body.act_calls) == 1
            assert runtime.retire_recovered_pauses(await body.snapshot()) is False
            assert interrupted.state == "paused" and interrupted.recoverable_pause == "death"
            assert original_intent.state == "paused" and original_intent.recoverable_pause is None
            assert journal.unresolved(body.body_id) == [original]
            assert journal.receipt(body.body_id, original.request_id) == original_receipt
            body.restore_request(original)
            assert (await body.result(original.request_id)).status == "unknown"
            assert [action.request_id for action in body.act_calls] == [original.request_id]
            assert len(body.acts) == 1 and not body.stop_calls
    asyncio.run(run())


def test_recovered_pause_waits_for_its_in_flight_planner_to_return(tmp_path):
    async def run():
        async with _recovery_harness(tmp_path) as (runtime, body, journal):
            planner = _SlowRecoveryPlanner()
            runtime.planner = planner
            intent = runtime.submit_intent("synthetic still planning")
            running = asyncio.create_task(runtime.run_intent(intent))
            try:
                await asyncio.wait_for(planner.entered.wait(), 2)
                _emit_recovery_pause(body, "death")
                await _revive_recovery_body(body)
                assert runtime._active is intent and intent.state == "paused"
                assert intent.recoverable_pause == "death"
                assert runtime.retire_recovered_pauses(await body.snapshot()) is False
                assert intent.state == "paused" and not body.act_calls
                planner.release.set()
                await asyncio.wait_for(running, 2)
                assert runtime._active is None and intent.state == "paused"
                assert runtime.retire_recovered_pauses(await body.snapshot()) is True
                assert intent.state == "cancelled" and intent.step_index == 0
                assert not body.act_calls and not body.stop_calls and not journal.unresolved(body.body_id)
            finally:
                planner.release.set()
                if not running.done():
                    running.cancel()
                await asyncio.gather(running, return_exceptions=True)
    asyncio.run(run())


@pytest.mark.parametrize("phase", ["queued", "active-state", "planning", "executing"])
def test_recovered_pause_waits_for_other_queued_or_active_work(tmp_path, monkeypatch, phase):
    async def run():
        # No journal here: executing work must block retirement independently of unresolved writes.
        async with _recovery_harness(tmp_path, durable=False) as (runtime, body, _):
            interrupted = await _pause_during_real_planning(runtime, body)
            await _revive_recovery_body(body)
            work = runtime.submit_intent("synthetic other work")
            running = None
            release = asyncio.Event()
            if phase == "active-state":
                runtime._transition(work, "active")
                assert runtime._active is None
            elif phase == "planning":
                planner = _SlowRecoveryPlanner(steps=[])
                runtime.planner = planner
                release = planner.release
                running = asyncio.create_task(runtime.run_intent(work))
                await asyncio.wait_for(planner.entered.wait(), 2)
            elif phase == "executing":
                entered = asyncio.Event()
                do_act = body._do_act
                async def hold_action(action, request_id):
                    entered.set()
                    await release.wait()
                    return await do_act(action, request_id)
                monkeypatch.setattr(body, "_do_act", hold_action)
                runtime.update_intent(work.id, steps=[{"tool": "body:observe"}])
                running = asyncio.create_task(runtime.run_intent(work))
                await asyncio.wait_for(entered.wait(), 2)
            try:
                if running is not None:
                    assert runtime._active is work and work.state == "active"
                before_actions = list(body.act_calls)
                assert runtime.retire_recovered_pauses(await body.snapshot()) is False
                assert interrupted.state == "paused" and interrupted.recoverable_pause == "death"
                assert body.act_calls == before_actions and not body.stop_calls
                if running is None:
                    await runtime.control("cancel", work.id)
                else:
                    release.set()
                    await asyncio.wait_for(running, 2)
                    assert work.state == "completed" and runtime._active is None
                assert runtime.retire_recovered_pauses(await body.snapshot()) is True
                assert interrupted.state == "cancelled" and interrupted.step_index == 0
                assert all(action.verb == "observe" for action in body.act_calls)
            finally:
                release.set()
                if running is not None:
                    if not running.done():
                        running.cancel()
                    await asyncio.gather(running, return_exceptions=True)
    asyncio.run(run())


@pytest.mark.parametrize("cause", ["no-steps", "unsupported", "max-defers"])
def test_needs_host_planning_pauses_are_not_mistaken_for_body_recovery(tmp_path, cause):
    async def run():
        async with _recovery_harness(tmp_path) as (runtime, body, journal):
            if cause == "unsupported":
                async def unsupported_plan(intent, context):
                    return [Step(tool="body:sit")]
                runtime.planner = unsupported_plan
            elif cause == "max-defers":
                runtime.fastslow = FastSlow(FastSlowConfig(use_router=False))
                runtime.max_defers, runtime.defer_seconds = 1, 0
                body.native_busy = True
            intent = runtime.submit_intent("synthetic host-required pause")
            await runtime.run_intent(intent)
            if cause == "max-defers":
                assert intent.state == "queued" and intent.defers == 1
                await runtime.run_intent(intent)
                body.native_busy = False
            assert intent.state == "paused" and intent.needs_host
            assert intent.recoverable_pause is None
            expected = {"no-steps": "no steps", "unsupported": "not supported", "max-defers": "native kept the body"}[cause]
            assert expected in intent.reason
            before = intent.model_dump()
            assert runtime.retire_recovered_pauses(await body.snapshot()) is False
            assert intent.model_dump() == before and not body.act_calls and not body.stop_calls
            assert not journal.unresolved(body.body_id)
    asyncio.run(run())


def test_actor_replans_after_death_during_slow_planning_without_replaying_steps(tmp_path, monkeypatch):
    async def run():
        actor = role(interval_seconds=600, agenda_enabled=False)
        body = _RecoveryBody(body_id=str(actor.body_id))
        body.identity = lambda: BodyIdentity(
            kind="numen", body_id=str(actor.body_id),
            world=WorldRef(server_id="qa", world_key="synthetic-recovery"), scope=actor.scope("qa"),
        )
        planner = _SlowRecoveryPlanner()
        host = NpcHost(actor, body, planner, None, ActionJournal(tmp_path / "actor-recovery.sqlite"))
        retire = host.runtime.retire_recovered_pauses
        retire_calls = []
        def record_retirement(snapshot):
            result = retire(snapshot)
            retire_calls.append((snapshot, result))
            return result
        monkeypatch.setattr(host.runtime, "retire_recovered_pauses", record_retirement)
        running = asyncio.create_task(host.run())
        try:
            await asyncio.wait_for(planner.entered.wait(), 2)
            old, old_snapshot = planner.calls[0]
            assert old_snapshot.life_state == "alive" and host.runtime._active is old
            _emit_recovery_pause(body, "death")
            assert old.state == "paused" and old.needs_host and old.recoverable_pause == "death"
            planner.release.set()
            await _wait_for_recovery_condition(lambda: host.runtime._active is None)
            assert old.state == "paused" and not body.act_calls and not host.journal.unresolved(body.body_id)

            recovered_at = datetime.now(UTC)
            body.pos = {"x": 80.0, "y": 70.0, "z": 9.0}
            body.inventory = {"synthetic:respawn_marker": 1}
            await _revive_recovery_body(body)
            first_recovery_read = len(body.snapshot_reads)
            # Recovery, not the ordinary periodic deadline, must enable the next plan.
            host.next_plan = asyncio.get_running_loop().time() + 600
            host.wake.set()
            await _wait_for_recovery_condition(lambda: old.state == "cancelled")
            host.wake.set()
            await _wait_for_recovery_condition(lambda: len(planner.calls) >= 2 and planner.calls[1][0].state == "completed")

            fresh, fresh_snapshot = planner.calls[1]
            assert len(planner.calls) == 2 and fresh.id != old.id
            assert old.reason == "body_recovered_replan_from_current_observation"
            assert old.step_index == 0 and not old.receipts
            assert fresh_snapshot is not old_snapshot and fresh_snapshot.life_state == "alive"
            assert fresh_snapshot.sampled_at >= recovered_at
            assert fresh_snapshot.position == body.pos and fresh_snapshot.inventory == body.inventory
            successful_reads = [snapshot for snapshot, result in retire_calls if result]
            assert successful_reads
            assert all(any(snapshot is read for read in body.snapshot_reads[first_recovery_read:]) for snapshot in successful_reads)
            assert all(snapshot.life_state == "alive" and snapshot.sampled_at >= recovered_at for snapshot in successful_reads)
            assert [action.verb for action in body.act_calls] == ["chat"]
            assert body.acts[0].args == {"text": "synthetic fresh plan"} and not body.stop_calls
            assert not host.journal.unresolved(body.body_id)
            old_states = [event.data["state"] for event in host.runtime.events
                          if event.kind == "intent_state" and event.data.get("intentId") == old.id]
            assert old_states == ["queued", "active", "paused", "cancelled"]
        finally:
            planner.release.set()
            running.cancel()
            await asyncio.gather(running, return_exceptions=True)
            await host.close()
    asyncio.run(run())

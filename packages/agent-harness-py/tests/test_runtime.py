from __future__ import annotations

import asyncio
from typing import Any

from simbody import SimBody

from agent_mc_harness import Flags, HarnessRuntime, create_harness
from agent_mc_harness.protocol import handle
from agent_mc_harness.runtime import Intent, PlanContext, Step


async def settle(rt: HarnessRuntime, intent_id: str, states: tuple[str, ...] = ("completed", "failed", "paused", "cancelled")) -> Intent:
    for _ in range(400):
        if rt.intents[intent_id].state in states:
            await asyncio.sleep(0.02)  # let background workers (reflection) run
            return rt.intents[intent_id]
        await asyncio.sleep(0.01)
    raise AssertionError(f"intent stuck in {rt.intents[intent_id].state}")


def test_flags_default_off_and_create_harness_returns_none() -> None:
    f = Flags.from_env({})
    assert (f.enabled, f.execute, f.memory, f.fastslow, f.reflection, f.jitrl) == (False, False, "off", False, True, False)
    assert create_harness(SimBody(), Flags.from_env({})) is None


def test_bare_goal_pauses_for_host_and_steps_execute_in_priority_order(run: Any) -> None:
    async def go() -> None:
        body = SimBody()
        await body.spawn()
        rt = HarnessRuntime(body=body, execute=True)
        bare = rt.submit_intent("do something clever")
        low = rt.submit_intent("low", priority="low", steps=[{"tool": "body:chat", "args": {"text": "low"}}])
        high = rt.submit_intent("high", priority="urgent", steps=[{"tool": "body:chat", "args": {"text": "high"}}])
        rt.start()
        assert (await settle(rt, bare.id)).needs_host
        await settle(rt, low.id)
        await settle(rt, high.id)
        assert [a.args["text"] for a in body.acts] == ["high", "low"]
        assert rt.metrics.decisions["host"] == 2
        await rt.close()
    run(go())


def test_execute_off_never_touches_the_body(run: Any) -> None:
    async def go() -> None:
        body = SimBody()
        await body.spawn()
        rt = HarnessRuntime(body=body, execute=False)
        i = rt.submit_intent("x", steps=[{"tool": "body:chat", "args": {"text": "x"}}])
        rt.start()
        await asyncio.sleep(0.1)
        assert rt.intents[i.id].state == "queued" and body.acts == []
        await rt.close()
    run(go())


def test_unsupported_step_rejected_at_submit_and_unknown_outcome_pauses_without_replay(run: Any) -> None:
    async def go() -> None:
        body = SimBody(unknown={"lost"})
        await body.spawn()
        rt = HarnessRuntime(body=body, execute=True)
        try:
            rt.submit_intent("x", steps=[{"tool": "body:sit", "args": {}}])
            raise AssertionError("unsupported step accepted")
        except ValueError:
            pass
        i = rt.submit_intent("x", steps=[{"tool": "body:move", "args": {"tag": "lost"}}, {"tool": "body:chat", "args": {"text": "after"}}])
        rt.start()
        done = await settle(rt, i.id)
        assert done.state == "paused" and "do not replay" in (done.reason or "")
        assert len(body.acts) == 1
        await rt.close()
    run(go())


def test_pause_cancel_and_protocol_messages(run: Any) -> None:
    async def go() -> None:
        body = SimBody(delay=0.2)
        await body.spawn()
        rt = HarnessRuntime(body=body, execute=True)
        welcome = await handle(rt, {"v": 1, "id": "1", "type": "hello", "payload": {}}, agent="cormy")
        assert welcome["type"] == "welcome" and "move" in welcome["payload"]["body"]["verbs"]
        sub = await handle(rt, {"v": 1, "id": "2", "type": "submit_intent", "payload": {"goal": "walk", "constraints": {
            "steps": [{"tool": "body:move", "args": {}}, {"tool": "body:move", "args": {}}, {"tool": "body:move", "args": {}}]}}}, agent="cormy")
        iid = sub["payload"]["intentId"]
        other = await handle(rt, {"v": 1, "id": "3", "type": "control", "payload": {"action": "cancel", "intentId": iid}}, agent="intruder")
        assert other["payload"]["code"] == "forbidden"
        rt.start()
        await asyncio.sleep(0.05)
        await handle(rt, {"v": 1, "id": "4", "type": "control", "payload": {"action": "cancel", "intentId": iid}}, agent="cormy")
        done = await settle(rt, iid)
        assert done.state == "cancelled" and len(body.acts) < 3
        summary = await handle(rt, {"v": 1, "id": "5", "type": "get_summary", "payload": {}}, agent="cormy")
        assert "brain" in summary["payload"]["summary"]
        events = await handle(rt, {"v": 1, "id": "6", "type": "pull_events", "payload": {"after": 0, "minSeverity": 1}}, agent="cormy")
        assert events["ok"] and events["payload"]["events"]
        bad = await handle(rt, {"v": 1, "id": "7", "type": "submit_intent", "payload": {"goal": ""}})
        assert bad["payload"]["code"] == "bad_request"
        body_info = await handle(rt, {"v": 1, "id": "8", "type": "get_body", "payload": {"include": ["capabilities"]}}, agent="cormy")
        assert "scope" not in body_info["payload"]["body"]["identity"]
        await rt.close()
    run(go())


def test_safety_event_pauses_active_intent_and_preempts_lease(run: Any) -> None:
    from fakes import WARNING

    from agent_mc_harness import guard_body

    async def go() -> None:
        inner = SimBody(delay=0.15)
        body = guard_body(inner)
        await body.spawn()
        rt = HarnessRuntime(body=body, execute=True)
        i = rt.submit_intent("walk", steps=[{"tool": "body:move", "args": {}}, {"tool": "body:move", "args": {}}])
        rt.start()
        await asyncio.sleep(0.05)
        epoch = rt.lease.epoch
        body.feed_server_text(WARNING)
        done = await settle(rt, i.id)
        assert done.state == "paused" and "safety" in (done.reason or "")
        assert rt.lease.epoch > epoch
        assert len(inner.acts) == 1
        await rt.close()
    run(go())


def test_planner_receives_memory_hot_tier_and_lessons(run: Any) -> None:
    from agent_mc_harness.learning.strategies import StrategyStore
    from agent_mc_harness.memory import LocalMemory, MemoryEpisode, MemoryRouter

    seen: list[PlanContext] = []

    async def planner(intent: Intent, ctx: PlanContext) -> list[Step]:
        seen.append(ctx)
        return [Step(tool="body:chat", args={"text": "planned"})]

    async def go() -> None:
        body = SimBody()
        await body.spawn()
        mem = MemoryRouter(LocalMemory())
        strategies = StrategyStore()
        g = body.identity().group_id()  # type: ignore[union-attr]
        await mem.add(g, MemoryEpisode(id="e1", kind="chat", name="c", body="the iron is north"))
        strategies.propose(f"{g}:lesson:method:move", "lesson", {"cue": "walking", "lesson": "check the path"})
        rt = HarnessRuntime(body=body, execute=True, planner=planner, memory=mem, strategies=strategies)
        i = rt.submit_intent("find iron")
        rt.start()
        assert (await settle(rt, i.id)).state == "completed"
        assert seen[0].hot[0].id == "e1" and seen[0].memories and seen[0].lessons == ["walking: check the path"]
        assert rt.intents[i.id].strategy_refs == [(f"{g}:lesson:method:move", 1)]
        await rt.close()
    run(go())

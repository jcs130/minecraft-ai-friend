import asyncio
from types import SimpleNamespace

import pytest
from test_server_npc import role

from agent_mc_harness.npc import NpcPlanner


def test_dialogue_does_not_take_a_second_slot_from_another_role():
    async def run():
        shared = asyncio.Semaphore(2)
        entered = asyncio.Queue()
        release = asyncio.Event()
        active = peak = 0

        async def request(route, payload, timeout):
            nonlocal active, peak
            active += 1
            peak = max(peak, active)
            try:
                entered.put_nowait(payload["turn"])
                await release.wait()
                return payload["turn"]
            finally:
                active -= 1

        model = SimpleNamespace(request=request)
        kirito, feiyu, yui = [NpcPlanner(role(id=name), model, semaphore=shared)
                              for name in ("kirito", "feiyu", "yui")]
        first = asyncio.create_task(kirito.decision("plan", {"turn": "first"}, 3))
        assert await asyncio.wait_for(entered.get(), 1) == "first"
        dialogue = asyncio.create_task(kirito.decision("dialogue", {"turn": "dialogue"}, 3))
        other = asyncio.create_task(feiyu.decision("plan", {"turn": "other"}, 3))
        last = asyncio.create_task(yui.decision("plan", {"turn": "last"}, 3))
        try:
            assert await asyncio.wait_for(entered.get(), 1) == "other"
            assert entered.empty()
        finally:
            release.set()
            await asyncio.gather(first, dialogue, other, last)
        assert peak == 2
    asyncio.run(run())


def test_decision_timing_separates_queue_from_model_and_contains_no_dialogue_text():
    async def run():
        shared = asyncio.Semaphore(1)
        await shared.acquire()
        entered = asyncio.Event()
        release = asyncio.Event()

        async def request(route, payload, timeout):
            entered.set()
            await release.wait()
            return {"reply": "private-test-line"}

        planner = NpcPlanner(role(), SimpleNamespace(request=request), semaphore=shared)
        pending = asyncio.create_task(planner.decision("dialogue", {"text": "private-test-line"}, 2))
        try:
            await asyncio.sleep(0.04)
            assert not entered.is_set()
            shared.release()
            await asyncio.wait_for(entered.wait(), 1)
            await asyncio.sleep(0.04)
            release.set()
            assert await pending == ({"reply": "private-test-line"}, "tokenplan")
            timing = planner.last_decision_timings["dialogue"]
            assert timing["answerReceived"] is True and timing["kind"] == "dialogue"
            assert timing["queueMs"] >= 30 and timing["modelMs"] >= 30
            assert timing["totalMs"] >= timing["queueMs"] + timing["modelMs"] - 1
            assert "private-test-line" not in str(timing)
        finally:
            release.set()
            if shared.locked() and not entered.is_set():
                shared.release()
            await asyncio.gather(pending, return_exceptions=True)
    asyncio.run(run())


def test_overlapping_plan_and_dialogue_keep_separate_timing_records():
    async def run():
        entered = asyncio.Event()
        release = asyncio.Event()

        async def request(route, payload, timeout):
            if payload == "plan":
                entered.set()
                await release.wait()
            return payload

        planner = NpcPlanner(role(), SimpleNamespace(request=request))
        plan = asyncio.create_task(planner.decision("plan", "plan", 2))
        await asyncio.wait_for(entered.wait(), 1)
        dialogue = asyncio.create_task(planner.decision("dialogue", "dialogue", 2))
        try:
            await asyncio.sleep(0.04)
            assert set(planner.last_decision_timings) == {"plan", "dialogue"}
            assert planner.last_decision_timings["plan"]["answerReceived"] is False
            release.set()
            assert await plan == ("plan", "tokenplan")
            assert await dialogue == ("dialogue", "tokenplan")
            assert all(row["answerReceived"] for row in planner.last_decision_timings.values())
            assert planner.last_decision_timings["dialogue"]["queueMs"] >= 30
            assert planner.last_decision_timings["plan"]["modelMs"] >= 30
        finally:
            release.set()
            await asyncio.gather(plan, dialogue, return_exceptions=True)
    asyncio.run(run())


@pytest.mark.parametrize("occupied", ["role", "shared", "http"])
def test_timeout_includes_the_whole_fallback_and_releases_capacity(occupied):
    async def run():
        shared = asyncio.Semaphore(1)
        entered, release = asyncio.Event(), asyncio.Event()
        calls = []

        async def request(route, payload, timeout):
            calls.append(payload)
            entered.set()
            if payload == "hold" or occupied == "http" and payload == "timed":
                await release.wait()
            return payload

        planner = NpcPlanner(role(), SimpleNamespace(request=request), semaphore=shared)
        holder = None
        if occupied == "shared":
            await shared.acquire()
        elif occupied == "role":
            holder = asyncio.create_task(planner.decision("plan", "hold", 2))
            await asyncio.wait_for(entered.wait(), 1)
        timed = asyncio.create_task(planner.decision("dialogue", "timed", 0.04))
        try:
            done, _ = await asyncio.wait([timed], timeout=0.6)
            assert timed in done, "fallback exceeded its deadline"
            with pytest.raises(TimeoutError):
                await timed
            assert ("timed" in calls) == (occupied == "http")
            timing = planner.last_decision_timings["dialogue"]
            assert timing["answerReceived"] is False and timing["totalMs"] >= 30
            assert (timing["modelMs"] is not None) == (occupied == "http")
            assert timing["queueMs"] is not None
        finally:
            timed.cancel()
            await asyncio.gather(timed, return_exceptions=True)
            if occupied == "shared":
                shared.release()
            release.set()
            if holder:
                await holder
        assert await planner.decision("plan", "next", 1) == ("next", "tokenplan")
    asyncio.run(run())


def test_rebuilt_planner_shares_role_slot_and_http_gets_remaining_budget():
    async def run():
        slot, shared = asyncio.Lock(), asyncio.Semaphore(2)
        started, release = asyncio.Event(), asyncio.Event()
        budgets = {}

        async def request(route, payload, timeout):
            budgets[payload] = timeout
            if payload == "old":
                started.set()
                await release.wait()
            return payload

        def build():
            return NpcPlanner(role(), SimpleNamespace(request=request), semaphore=shared, role_lock=slot)

        old = asyncio.create_task(build().decision("plan", "old", 2))
        await asyncio.wait_for(started.wait(), 1)
        new = asyncio.create_task(build().decision("dialogue", "new", 1))
        try:
            await asyncio.sleep(0)
            await asyncio.sleep(0.05)
            assert "new" not in budgets
        finally:
            release.set()
            await asyncio.gather(old, new)
        assert 0 < budgets["new"] < 0.98
    asyncio.run(run())


def test_desktop_routes_bypass_occupied_fallback_slots():
    async def run():
        async def offer(kind, messages):
            return messages[0] if messages else None

        shared, slot = asyncio.Semaphore(1), asyncio.Lock()
        planner = NpcPlanner(role(), None, resident_turns=SimpleNamespace(offer=offer),
                             semaphore=shared, role_lock=slot)
        async with slot, shared:
            assert await planner.decision("dialogue", {"messages": ["reply"]}, 0) == ("reply", "desktop")
            assert await planner.decision("plan", {"messages": []}, 0, desktop_only=True) == (None, "desktop")
    asyncio.run(run())

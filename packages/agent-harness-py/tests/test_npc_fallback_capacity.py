import asyncio
from types import SimpleNamespace

import pytest

from agent_mc_harness.npc import NpcPlanner
from test_server_npc import role


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

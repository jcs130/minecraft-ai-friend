"""Adapter-specific mappings (the shared rules are in test_contract.py)."""
from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import pytest
from fakes import WARNING, FakeBridge
from test_contract import SCOPE, make

from agent_mc_harness import BodyAction, guard_body
from agent_mc_harness.body.numen import HostedNumenPort, NumenBody, parse_status


def test_native_numen_maps_verbs_to_documented_lua_and_reads_events(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, run: Any) -> None:
    async def go() -> None:
        async with make("numen-native", tmp_path, monkeypatch, lua_dialect="numen-paper") as (body, world):
            await body.spawn()
            r = await body.act(BodyAction(verb="move", args={"x": 3, "y": 64, "z": 7}, request_id="req-move-00001"))
            assert r.status == "completed" and world.pos == {"x": 3.0, "y": 64.0, "z": 7.0}
            lua = [a["code"] for n, a in world.calls if n == "lua"]
            assert any("numen.move.to({x=3,y=64,z=7})" in c for c in lua)
            bad = await body.act(BodyAction(verb="move", args={"x": "far"}, request_id="req-move-00002"))
            assert bad.status == "rejected"
            snap = await body.snapshot()
            assert snap.health == 20.0 and snap.dimension == "minecraft:overworld" and snap.position == {"x": 3.0, "y": 64.0, "z": 7.0}
            seen: list[str] = []
            body.subscribe(lambda e: seen.append(e.kind))
            world.events.append('<event kind="death">slain by zombie</event>')
            await asyncio.sleep(0.3)
            assert "death" in seen and body.lifecycle() == "dead"
            await body.destroy()
    run(go())


def test_native_numen_015_dialect_uses_upstream_lua_api(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, run: Any) -> None:
    """Numen 0.1.5 (verified live): walk(pos) not move.to, task.stop for halts, status.self for snapshots."""
    async def go() -> None:
        async with make("numen-native", tmp_path, monkeypatch) as (body, world):
            await body.spawn()
            caps = body.capabilities().actions
            assert caps["move"].native == "lua numen.move.walk" and caps["stop"].native == "lua numen.task.stop"
            r = await body.act(BodyAction(verb="move", args={"x": 3, "y": 64, "z": 7.5}, request_id="req-move-01501"))
            assert r.status == "completed" and world.pos == {"x": 3.0, "y": 64.0, "z": 7.5}
            lua = [a["code"] for n, a in world.calls if n == "lua"]
            assert "numen.move.walk({x=3,y=64,z=7.5})" in lua and not any("numen.move.to" in c or "walk(0,0,0)" in c for c in lua)
            for _ in range(2):  # a read-only status program carries no action receipt, so it may repeat
                snap = await body.snapshot()
                assert snap.health == 20.0 and snap.max_health == 20.0 and snap.position == {"x": 3.0, "y": 64.0, "z": 7.5}
            assert not any("numen.status.self()" in a.get("code", "") for _, a in world.writes())
            inv = await body.act(BodyAction(verb="inventory", request_id="req-inv-01501"))
            assert inv.status == "completed" and "stone" in inv.text
            world.task_running = True
            stop = await body.stop("test")
            assert stop.status == "completed" and "stopped" in stop.text
            idle = await body.stop("idle")
            assert idle.status == "completed" and "idle" in idle.text, "an idle body is a successful stop"
            await body.destroy()
    run(go())


def test_native_numen_015_busy_is_not_dispatched_and_cut_off_is_unknown(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, run: Any) -> None:
    async def go() -> None:
        async with make("numen-native", tmp_path, monkeypatch) as (body, world):
            await body.spawn()
            world.busy = True
            busy = await body.act(BodyAction(verb="move", args={"x": 1, "y": 64, "z": 1}, request_id="req-busy-00001"))
            assert busy.status == "rejected", "one program per companion: refused before it ran"
            assert (await body.stop("busy")).status == "rejected"
            world.busy = False
            again = await body.act(BodyAction(verb="move", args={"x": 1, "y": 64, "z": 1}, request_id="req-busy-00002"))
            assert again.status == "completed", "a refused (never dispatched) action is not held by the receipt ledger"
            world.cut_off_next = True
            cut = await body.act(BodyAction(verb="move", args={"x": 2, "y": 64, "z": 2}, request_id="req-cut-000001"))
            assert cut.status == "unknown" and cut.retry_allowed is False, "a seat-flip cut-off may still have run"
            sent = len([c for c in world.calls if c[0] == "lua" and "walk({x=2," in c[1]["code"]])
            repeat = await body.act(BodyAction(verb="move", args={"x": 2, "y": 64, "z": 2}, request_id="req-cut-000002"))
            assert repeat.status == "rejected" and "thisCallDispatched" in str(repeat.data)
            assert len([c for c in world.calls if c[0] == "lua" and "walk({x=2," in c[1]["code"]]) == sent, "never replayed"
            await body.destroy()
    run(go())


def test_hosted_numen_uses_mc_numen_with_host_call_id_and_envelope_events(run: Any) -> None:
    async def go() -> None:
        bridge = FakeBridge(numen=True)
        body = guard_body(NumenBody(HostedNumenPort(bridge), scope=SCOPE, poll_seconds=0.05, result_poll_seconds=0))
        await body.spawn()
        r = await body.act(BodyAction(verb="chat", args={"text": "hello"}, request_id="req-chat-hosted1"))
        name, args, rid = bridge.writes()[0]
        assert name == "mc_numen" and args["op"] == "call" and args["tool"] == "say" and rid == "req-chat-hosted1"
        assert r.status in ("accepted", "completed")
        bridge.push("system", WARNING)  # owner connection sees the anti-cheat text
        await asyncio.sleep(0.3)
        assert body.halted()
        await body.destroy()
    run(go())


def test_maid_commands_validated_by_the_real_maid_port(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, run: Any) -> None:
    async def go() -> None:
        async with make("maid", tmp_path, monkeypatch) as (body, bridge):
            await body.spawn()
            assert body.identity().name == "肥鱼"  # type: ignore[union-attr]
            await body.act(BodyAction(verb="follow", request_id="req-follow-0001"))
            await body.act(BodyAction(verb="chat", args={"text": "跟我来"}, request_id="req-speak-0001"))
            assert any("follow" in c for c in bridge.maid_commands) and any("speak" in c or "say" in c for c in bridge.maid_commands)
            recall = await body.act(BodyAction(verb="recall", request_id="req-recall-001"))
            assert recall.status == "accepted" and not recall.terminal
            final = await body.result("req-recall-001")
            assert final.status == "completed"
            seen: list[tuple[str, str]] = []
            body.subscribe(lambda e: seen.append((e.kind, e.text)))
            bridge.inbox.append({"eventId": "ev1", "text": "主人：去拿木头", "speaker": "Zhongli"})
            await asyncio.sleep(0.3)
            assert ("dialogue", "主人：去拿木头") in seen
            await body.destroy()
            assert body.lifecycle() == "destroyed" and not any(a.get("action") in ("summon", "create", "delete") for _, a, _ in bridge.calls)
    run(go())


def test_parse_status_tolerates_prefixes() -> None:
    s = parse_status('MC_STATUS {"health": 12, "food": 9, "x": 1, "y": 2, "z": 3, "dimension": "minecraft:the_nether"}')
    assert s["health"] == 12 and s["position"] == {"x": 1, "y": 2, "z": 3} and s["dimension"] == "minecraft:the_nether"

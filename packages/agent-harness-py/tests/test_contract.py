"""Shared contract: every body adapter (native Numen, hosted Numen, Touhou maid) obeys the same rules."""
from __future__ import annotations

import asyncio
import contextlib
import shutil
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import pytest
from fakes import COMPANION, MAID, OWNER, FakeBridge, FakeNumenWorld, MaidOracle, patch_native
from simbody import SimBody

from agent_mc_harness import BodyAction, Scope, guard_body
from agent_mc_harness.body.base import BodyAdapter
from agent_mc_harness.body.maid import MaidBody
from agent_mc_harness.body.numen import HostedNumenPort, NativeNumenPort, NumenBody

SCOPE = Scope(realm="test-world", account="owner", agent="harness")
KINDS = ["numen-native", "numen-hosted", "maid"]


@contextlib.asynccontextmanager
async def make(kind: str, tmp: Path, monkeypatch: pytest.MonkeyPatch, *, lua_dialect: str = "numen-0.1.5") -> AsyncIterator[tuple[BodyAdapter, Any]]:
    if kind == "numen-native":
        world = FakeNumenWorld()
        patch_native(monkeypatch, world)
        (tmp / "token").write_text("t0k3n-not-real", encoding="utf-8")
        port = NativeNumenPort({"upstream_url": "http://127.0.0.1:9/mcp", "token_file": str(tmp / "token"), "companion_uuid": COMPANION,
                                "journal_dir": str(tmp / "journal"), "lua_dialect": lua_dialect})
        body: BodyAdapter = NumenBody(port, scope=SCOPE, server_id="qiandengji", poll_seconds=0.05, result_poll_seconds=0)
        yield body, world
    elif kind == "numen-hosted":
        bridge = FakeBridge(numen=True)
        yield NumenBody(HostedNumenPort(bridge), scope=SCOPE, poll_seconds=0.05, result_poll_seconds=0), bridge
    else:
        if shutil.which("node") is None:
            pytest.skip("node not available for the maid-port oracle")
        oracle = MaidOracle()
        bridge = FakeBridge(maid_tool=oracle.tool, oracle=oracle)
        try:
            yield MaidBody(bridge, scope=SCOPE, owner_id=OWNER, maid_id=MAID, server_id="qiandengji", poll_seconds=0.05,
                           result_poll_seconds=0, context_poll_seconds=0), bridge
        finally:
            oracle.close()


@pytest.mark.parametrize("kind", KINDS)
def test_lifecycle_identity_capabilities(kind: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, run: Any) -> None:
    async def go() -> None:
        async with make(kind, tmp_path, monkeypatch) as (body, _):
            assert body.lifecycle() == "detached"
            early = await body.act(BodyAction(verb="chat", args={"text": "hi"}, request_id="req-early-0001"))
            assert early.status == "rejected" and "spawn" in early.text
            await body.spawn()
            assert body.lifecycle() == "ready"
            ident = body.identity()
            assert ident is not None and ident.scope == SCOPE
            assert ident.body_id == (MAID if kind == "maid" else COMPANION)
            gid = ident.group_id()
            assert len(gid) <= 64 and gid.startswith(ident.kind)
            caps = body.capabilities()
            assert caps.kind == ident.kind and caps.supports("chat") and caps.supports("stop")
            assert caps.native_actions, "native escape hatch is declared"
            await body.reconnect()
            assert body.lifecycle() == "ready"
            await body.destroy()
            assert body.lifecycle() == "destroyed"
    run(go())


@pytest.mark.parametrize("kind", KINDS)
def test_action_semantics(kind: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, run: Any) -> None:
    async def go() -> None:
        async with make(kind, tmp_path, monkeypatch) as (body, edge):
            await body.spawn()
            bad = await body.act(BodyAction(verb="chat", args={}, request_id="req-bad-00001"))
            assert bad.status == "rejected" and bad.terminal
            invalid_id = await body.act(BodyAction(verb="chat", args={"text": "x"}, request_id="bad id!"))
            assert invalid_id.status == "rejected"
            unsupported = next(v for v in ("craft", "attack", "sit", "drop") if not body.capabilities().supports(v))
            r = await body.act(BodyAction(verb=unsupported, args={}, request_id="req-unsup-0001"))  # type: ignore[arg-type]
            assert r.status == "unsupported"
            writes_before = len(edge.writes())
            first = await body.act(BodyAction(verb="chat", args={"text": "你好"}, request_id="req-chat-00001"))
            assert first.status in ("completed", "accepted")
            again = await body.act(BodyAction(verb="chat", args={"text": "你好"}, request_id="req-chat-00001"))
            assert again == first, "same requestId returns the original receipt"
            assert len(edge.writes()) == writes_before + 1, "idempotent: no second write"
            assert again.retry_allowed is False
            conflict = await body.act(BodyAction(verb="chat", args={"text": "另一句"}, request_id=first.request_id))
            assert conflict.status == "rejected" and "request_id_conflict" in conflict.text
            assert len(edge.writes()) == writes_before + 1
            assert (await body.result(first.request_id)).request_id == first.request_id
            stop = await body.stop("test")
            assert stop.verb == "stop"
            snap = await body.snapshot()
            assert snap.life_state in ("alive", "unknown")
            h = body.health()
            assert h.counters.actions >= 1 and h.connected
            await body.destroy()
    run(go())


def test_original_request_binds_native_operation_and_json_arguments(run: Any) -> None:
    async def go() -> None:
        body = SimBody()
        await body.spawn()
        rid = "req-native-010"
        first = BodyAction(verb="native", name="lua", args={"item": {"x": True, "y": [1, 2]}}, request_id=rid)
        saved = await body.act(first)
        reordered = first.model_copy(update={"args": {"item": {"y": [1, 2], "x": True}}})
        assert await body.act(reordered) == saved
        for changed in ({"name": "other"}, {"verb": "chat"}, {"args": {"item": {"x": 1, "y": [1, 2]}}}):
            conflict = await body.act(first.model_copy(update=changed))
            assert conflict.status == "rejected" and "request_id_conflict" in conflict.text
        assert await body.result(rid) == saved and len(body.acts) == 1

        recovered = SimBody()
        recovered.restore_request(first)
        recovered.restore_request(reordered)
        with pytest.raises(ValueError, match="request_id_conflict"):
            recovered.restore_request(first.model_copy(update={"name": "other"}))
        await recovered.spawn()
        assert (await recovered.act(reordered)).status == "unknown"
        assert (await recovered.act(first.model_copy(update={"name": "other"}))).status == "rejected"
        assert (await recovered.result(rid)).status == "unknown" and not recovered.acts
    run(go())


def test_foreign_dispatch_and_query_receipts_do_not_settle_original(monkeypatch: pytest.MonkeyPatch, run: Any) -> None:
    async def go() -> None:
        body = SimBody()
        await body.spawn()
        async def crossed_reply(*args):
            return body.receipt("req-foreign-01", "chat", "completed")

        monkeypatch.setattr(body, "_do_act", crossed_reply)
        monkeypatch.setattr(body, "_do_result", crossed_reply)
        action = BodyAction(verb="chat", args={"text": "hello"}, request_id="req-original-01")
        sent = await body.act(action)
        assert sent.request_id == action.request_id and sent.status == "unknown"
        assert await body.result(sent.request_id) == sent
        assert await body.act(action) == sent and body.health().counters.actions == 1
    run(go())


@pytest.mark.parametrize("cancel_dispatch", [False, True])
def test_original_request_claimed_before_dispatch(monkeypatch: pytest.MonkeyPatch, run: Any, cancel_dispatch: bool) -> None:
    async def go() -> None:
        body = SimBody()
        await body.spawn()
        entered, release = asyncio.Event(), asyncio.Event()
        calls = []

        async def dispatch(action, rid):
            calls.append((rid, action.args["text"]))
            entered.set()
            await release.wait()
            return body.receipt(rid, action.verb, "completed", "delivered")

        monkeypatch.setattr(body, "_do_act", dispatch)
        original = BodyAction(verb="chat", args={"text": "first"}, request_id="req-race-001")
        sending = asyncio.create_task(body.act(original))
        await entered.wait()
        duplicate = asyncio.create_task(body.act(original))
        conflict = asyncio.create_task(body.act(original.model_copy(update={"args": {"text": "changed"}})))
        await asyncio.sleep(0)
        interim = await body.result("req-race-001")
        if cancel_dispatch:
            sending.cancel()
        release.set()
        if cancel_dispatch:
            with pytest.raises(asyncio.CancelledError):
                await sending
        else:
            assert (await sending).status == "completed"
        assert interim.request_id == "req-race-001" and not interim.terminal
        assert (await duplicate).request_id == "req-race-001"
        refused = await conflict
        assert refused.status == "rejected" and "request_id_conflict" in refused.text
        final = await body.result("req-race-001")
        assert final.status == ("unknown" if cancel_dispatch else "completed")
        assert await body.act(original) == final
        assert calls == [("req-race-001", "first")]
    run(go())


@pytest.mark.parametrize("kind", KINDS)
def test_transport_failure_is_unknown_not_replayed(kind: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, run: Any) -> None:
    async def go() -> None:
        async with make(kind, tmp_path, monkeypatch) as (body, edge):
            await body.spawn()
            original = edge.call if kind != "numen-native" else None
            if kind == "numen-native":
                edge.fail_next = ConnectionError("dropped")
            else:
                async def boom(name: str, arguments: dict[str, Any], **kw: Any) -> dict[str, Any]:
                    if name != "mc_events":
                        raise ConnectionError("dropped")
                    return await original(name, arguments, **kw)  # type: ignore[misc]
                edge.call = boom
            r = await body.act(BodyAction(verb="chat", args={"text": "x"}, request_id="req-lost-00001"))
            assert r.status == "unknown" and not r.terminal and r.retry_allowed is False
            if original is not None:
                edge.call = original
            again = await body.act(BodyAction(verb="chat", args={"text": "x"}, request_id="req-lost-00001"))
            assert again.status == "unknown", "an uncertain write is never re-sent under the same requestId"
            await body.destroy()
    run(go())


@pytest.mark.parametrize("kind", KINDS)
def test_safety_guard_halts_every_body(kind: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, run: Any) -> None:
    from fakes import WARNING

    async def go() -> None:
        async with make(kind, tmp_path, monkeypatch) as (inner, _):
            body = guard_body(inner)
            await body.spawn()
            seen: list[str] = []
            body.subscribe(lambda e: seen.append(e.kind))
            assert body.feed_server_text(WARNING)
            from agent_mc_harness.models import MOTION_VERBS
            verb = next(v for v in ("move", "follow", "attack", "recall") if v in MOTION_VERBS and body.capabilities().supports(v))
            r = await body.act(BodyAction(verb=verb, args={"x": 1, "y": 64, "z": 1}, request_id="req-halt-00001"))  # type: ignore[arg-type]
            assert r.status == "blocked_by_safety"
            chat = await body.act(BodyAction(verb="chat", args={"text": "still allowed"}, request_id="req-halt-00002"))
            assert chat.status != "blocked_by_safety", "speech is not motion"
            assert "safety" in seen
            await asyncio.sleep(0)
            await body.destroy()
    run(go())

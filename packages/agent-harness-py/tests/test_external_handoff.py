import asyncio
import json
from types import SimpleNamespace
from uuid import uuid4

import pytest
from test_hosted_mcp import port
from test_hosted_stop import LeaseSession
from test_server_npc import role as npc_role

from agent_mc_harness.npc_service import ResidentRun, external_handoff


@pytest.mark.parametrize("kind", ("maid", "numen"))
def test_external_handoff_is_scoped_and_expires(tmp_path, kind):
    role = npc_role(body_kind=kind, body_id=uuid4(), owner_id=uuid4(), body_owner_id=uuid4(),
                    allowed_tools=["body:observe"])
    marker = tmp_path / "handoff.json"
    cfg = {"externalHandoffFile": str(marker)}
    assert not external_handoff(role, cfg, now=100)
    valid = {"bodyId": str(role.body_id), "ownerId": str(role.native_owner_id), "until": 232}
    for changes, expected in [
        ({}, True), ({"bodyId": str(uuid4())}, False), ({"ownerId": str(role.owner_id)}, False),
        ({"until": 100}, False), ({"until": 281}, False), ({"until": "232"}, False),
    ]:
        marker.write_text(json.dumps(valid | changes))
        assert external_handoff(role, cfg, now=100) is expected
    marker.write_text(json.dumps(valid))
    assert not external_handoff(role, cfg, now=233)
    assert not external_handoff(role, {}, now=100)
    peer = role.model_copy(update={"body_id": uuid4()})
    assert not external_handoff(peer, cfg, now=100)


def test_numen_handoff_waits_for_idle_native_vacancy_before_reopening(tmp_path, monkeypatch, run):
    async def check():
        session = LeaseSession()
        sampled = asyncio.Event()
        original_snapshot = session.snapshot
        session.work_pending = False

        def snapshot():
            if session.mode == "paused" and session.epoch >= 3:
                sampled.set()
            return original_snapshot() | {"workPending": session.work_pending}

        monkeypatch.setattr(session, "snapshot", snapshot)
        old = port(tmp_path, session)
        await old.open()
        resident = ResidentRun(SimpleNamespace(role=SimpleNamespace(id="kirito", body_kind="numen"),
                                               body=SimpleNamespace(port=old), close=old.close), None)
        resident.close_in_background(external=True)
        try:
            await asyncio.wait_for(sampled.wait(), 2)
            assert not resident.closing.done() and session.mode == "paused" and session.fenced
            session.fenced = False
            session.work_pending = True
            await asyncio.sleep(.6)
            assert not resident.closing.done()
            session.work_pending = False
            await asyncio.wait_for(resident.closing, 2)
        finally:
            if not resident.closing.done():
                resident.closing.cancel()
                await asyncio.gather(resident.closing, return_exceptions=True)

        external = port(tmp_path, session)
        await external.open()
        replacement = port(tmp_path, session)
        returning = asyncio.create_task(replacement.wait_for_return(lambda: False))
        try:
            await asyncio.sleep(.1)
            assert not returning.done() and session.boot == external.boot
            assert not any(row["op"] == "attach" and row["boot"] == replacement.boot for row in session.calls)
            await external.close()
            session.fenced = False
            assert await asyncio.wait_for(returning, 2)
            await replacement.open()
            assert replacement.boot != old.boot
            assert session.mode == "harness" and session.fenced
        finally:
            if not returning.done():
                returning.cancel()
                await asyncio.gather(returning, return_exceptions=True)
            if not external.closing:
                await external.close()
            await replacement.close()
    run(check())


def test_first_start_with_active_handoff_only_observes_lease(tmp_path, monkeypatch, run):
    async def check():
        session = LeaseSession()
        session.epoch, session.mode, session.fenced = 12, "harness", True
        original_snapshot = session.snapshot
        original_call = session.call_tool
        facts_called = asyncio.Event()

        async def call(tool, args):
            if args["op"] == "facts" and not facts_called.is_set():
                facts_called.set()
                raise OSError("one transient facts failure")
            return await original_call(tool, args)

        monkeypatch.setattr(session, "call_tool", call)
        monkeypatch.setattr(session, "snapshot", lambda: original_snapshot() | {"workPending": False})
        body = port(tmp_path, session)
        await body.close()  # The marker was already active at startup, so the local role did not attach.
        held = asyncio.create_task(body.wait_voluntary_release())
        try:
            await asyncio.wait_for(facts_called.wait(), 2)
            assert not held.done() and not session.transitions
            session.mode, session.fenced = "paused", False
            await asyncio.wait_for(held, 2)
            assert all(row["op"] == "facts" for row in session.calls)
        finally:
            if not held.done():
                held.cancel()
                await asyncio.gather(held, return_exceptions=True)
    run(check())


@pytest.mark.parametrize("failure", [TimeoutError(), ExceptionGroup("MCP transport", [OSError("connection reset")])])
def test_external_vacancy_transport_failure_keeps_probing_without_reclosing_the_host(run, failure):
    async def check():
        calls = []
        available = False

        async def close():
            calls.append("close local driver")

        async def wait_for_release():
            calls.append("read native vacancy")
            if not available:
                raise failure

        host = SimpleNamespace(role=SimpleNamespace(id="kirito", body_kind="numen"), close=close,
                               body=SimpleNamespace(port=SimpleNamespace(wait_voluntary_release=wait_for_release)))
        resident = ResidentRun(host, None)
        resident.close_in_background(external=True)
        with pytest.raises(type(failure)):
            await resident.closing
        initial = resident.closing
        assert not resident.released and resident.vacancy_retry_at is not None
        resident.retry_external_vacancy(resident.vacancy_retry_at - 1)
        assert resident.closing is initial
        resident.retry_external_vacancy(resident.vacancy_retry_at)
        with pytest.raises(type(failure)):
            await resident.closing
        assert not resident.released
        available = True
        resident.retry_external_vacancy(resident.vacancy_retry_at)
        await resident.closing
        assert resident.closing.exception() is None and resident.vacancy_retry_at is None
        assert calls == ["close local driver", "read native vacancy", "read native vacancy", "read native vacancy"]

    run(check())


def test_external_vacancy_nontransport_failure_is_not_retried(run):
    async def check():
        calls = []
        failure = ExceptionGroup("invalid native receipt", [ValueError("identity mismatch")])

        async def close():
            calls.append("close local driver")

        async def wait_for_release():
            calls.append("read native vacancy")
            raise failure

        host = SimpleNamespace(role=SimpleNamespace(id="kirito", body_kind="numen"), close=close,
                               body=SimpleNamespace(port=SimpleNamespace(wait_voluntary_release=wait_for_release)))
        resident = ResidentRun(host, None)
        resident.close_in_background(external=True)
        with pytest.raises(ExceptionGroup) as caught:
            await resident.closing
        assert caught.value is failure
        assert resident.vacancy_retry_at is None and not resident.released
        resident.retry_external_vacancy(float("inf"))
        assert resident.closing.done() and calls == ["close local driver", "read native vacancy"]

    run(check())


def test_incomplete_handoff_never_opens_a_second_controller(tmp_path):
    role = npc_role(body_kind="maid", body_id=uuid4(), owner_id=uuid4(), allowed_tools=["body:observe"])
    marker = tmp_path / "handoff.json"
    for content in ("bad", "[]", "{}", "null"):
        marker.write_text(content)
        assert not external_handoff(role, {"externalHandoffFile": str(marker)})
    with pytest.raises(ValueError, match="absolute"):
        external_handoff(role, {"externalHandoffFile": "relative"})

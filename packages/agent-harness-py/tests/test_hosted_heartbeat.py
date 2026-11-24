import asyncio
import json
from contextlib import asynccontextmanager
from types import SimpleNamespace

import httpx
import pytest
from test_hosted_mcp import BODY, Session, port

from agent_mc_harness.body import hosted_mcp


def faster_heartbeat(monkeypatch):
    monkeypatch.setattr(hosted_mcp, "HEARTBEAT_INTERVAL_SECONDS", 0.01)
    monkeypatch.setattr(hosted_mcp, "HEARTBEAT_RPC_SECONDS", 0.03)


@pytest.mark.parametrize("failure", ["read_error", "deadline"])
def test_one_transient_heartbeat_miss_keeps_original_active_action(tmp_path, monkeypatch, failure):
    faster_heartbeat(monkeypatch)

    async def run():
        dispatched = asyncio.Event()
        next_heartbeat = asyncio.Event()
        finish = asyncio.Event()

        class LongAction(Session):
            heartbeat_attempts = 0

            async def call_tool(self, tool, args):
                if args["op"] == "call":
                    self.calls.append(args)
                    dispatched.set()
                    await finish.wait()
                    return SimpleNamespace(isError=False, structuredContent={
                        "id": args["id"], "state": "completed", "message": "one measured completion",
                    })
                if args["op"] == "heartbeat":
                    self.heartbeat_attempts += 1
                    if self.heartbeat_attempts == 1:
                        if failure == "read_error":
                            raise httpx.ReadError("temporary transport response loss")
                        await asyncio.Event().wait()
                    if self.heartbeat_attempts == 2:
                        next_heartbeat.set()
                return await super().call_tool(tool, args)

        session = LongAction()
        body = port(tmp_path, session)
        try:
            await body.open()
            original = "original_long_action"
            task = asyncio.create_task(body.call("lua", {"code": "return true"}, original))
            async with asyncio.timeout(2):
                await dispatched.wait()
                await next_heartbeat.wait()
            assert body.lost is False
            finish.set()
            result = await task
            assert result.status == "completed"
            assert (await body.call("lua", {"code": "return true"}, original)).status == "completed"
            assert [x["id"] for x in session.calls if x["op"] == "call"] == [original]
            assert sum(x["op"] == "attach" for x in session.calls) == 1
        finally:
            finish.set()
            await body.close()

    asyncio.run(run())


@pytest.mark.parametrize("cause,attempts", [("persistent_transport", 2), ("wrong_epoch", 1)])
def test_persistent_miss_or_fence_change_remains_fail_closed(tmp_path, monkeypatch, cause, attempts):
    faster_heartbeat(monkeypatch)

    async def run():
        class Unavailable(Session):
            heartbeats = 0

            async def call_tool(self, tool, args):
                if args["op"] == "heartbeat":
                    self.heartbeats += 1
                    if cause == "persistent_transport":
                        raise httpx.ReadError("persistent transport response loss")
                    return SimpleNamespace(isError=False, structuredContent={
                        "roleUuid": BODY, "fenced": True, "mode": "harness", "epoch": args["epoch"] + 1,
                    })
                return await super().call_tool(tool, args)

        session = Unavailable()
        body = port(tmp_path, session)
        try:
            await body.open()
            async with asyncio.timeout(2):
                await asyncio.shield(body.heartbeat)
            assert body.lost and session.heartbeats == attempts
            assert body.disconnected.is_set() is (cause == "persistent_transport")
            result = await body.call("lua", {"code": "return true"}, "new_unfenced_action")
            assert result.status == "rejected"
            assert all(x["op"] != "call" for x in session.calls)
        finally:
            await body.close()

    asyncio.run(run())


@pytest.mark.parametrize("state", ["same_fence", "different_epoch", "paused", "unsettled", "expired"])
def test_heartbeat_uses_fresh_transport_without_acquiring_or_replaying(tmp_path, monkeypatch, state):
    async def run():
        class BrokenStream(Session):
            async def call_tool(self, tool, args):
                if args["op"] == "heartbeat":
                    raise httpx.ReadError("original stream stalled")
                return await super().call_tool(tool, args)

        original = BrokenStream()
        body = port(tmp_path, original)
        fresh_calls = []
        try:
            await body.open()
            body.heartbeat.cancel()
            await asyncio.gather(body.heartbeat, return_exceptions=True)
            body._provided_session = None

            async def read(tool, args):
                fresh_calls.append(args)
                assert args["op"] in {"facts", "heartbeat"}
                if args["op"] == "heartbeat" and state == "expired":
                    return SimpleNamespace(isError=True, structuredContent={})
                return SimpleNamespace(isError=False, structuredContent={
                    "roleUuid": BODY, "epoch": body.epoch + (state == "different_epoch"),
                    "mode": "paused" if state == "paused" else "harness", "fenced": state != "unsettled",
                })

            @asynccontextmanager
            async def fresh():
                yield SimpleNamespace(call_tool=read)

            monkeypatch.setattr(body, "_mcp_session", fresh)
            epoch, generation = body.epoch, body.boot
            if state == "same_fence":
                await body._heartbeat_once()
                assert [row["op"] for row in fresh_calls] == ["facts", "heartbeat"]
                assert not body.lost
            else:
                with pytest.raises(RuntimeError):
                    await body._heartbeat_once()
                assert [row["op"] for row in fresh_calls] == (["facts", "heartbeat"] if state == "expired" else ["facts"])
            assert all(row["epoch"] == epoch and row["boot"] == generation for row in fresh_calls)
            assert not any(row["op"] == "call" for row in original.calls)
            assert sum(row["op"] == "attach" for row in original.calls) == 1
        finally:
            await body.close()

    asyncio.run(run())


def test_mcp2_transport_error_is_transient():
    httpx2 = pytest.importorskip("httpx2")
    assert hosted_mcp.HostedMcpPort._transient_facts_error(httpx2.ReadError("read interrupted"))
    assert not hosted_mcp.HostedMcpPort._transient_facts_error(RuntimeError("CONTROL_CHANGED"))


def test_mcp2_typed_connection_errors_are_transient_but_native_denials_are_not():
    from mcp.shared.exceptions import MCPError
    from mcp.types import CONNECTION_CLOSED, INVALID_PARAMS, REQUEST_TIMEOUT

    for code in (REQUEST_TIMEOUT, CONNECTION_CLOSED):
        error = MCPError(code=code, message="synthetic transport failure")
        assert hosted_mcp.HostedMcpPort._transient_facts_error(error)
        assert hosted_mcp.HostedMcpPort._transient_facts_error(ExceptionGroup("connection", [error]))
        assert not hosted_mcp.HostedMcpPort._transient_facts_error(ExceptionGroup("mixed", [error, ValueError("identity")]))
    assert not hosted_mcp.HostedMcpPort._transient_facts_error(MCPError(code=INVALID_PARAMS, message="invalid identity"))


def test_uncertain_action_exposes_transport_type_and_never_resends(tmp_path):
    async def run():
        requests = []

        class OneLostResponse(Session):
            async def call_tool(self, tool, args):
                if args["op"] == "call":
                    requests.append(args["id"])
                    raise httpx.ReadError("sensitive provider connection context")
                if args["op"] == "result":
                    return SimpleNamespace(isError=False, structuredContent={
                        "id": args["id"], "state": "completed", "message": "original result recovered",
                    })
                return await super().call_tool(tool, args)

        body = port(tmp_path, OneLostResponse())
        try:
            await body.open()
            request = "original_uncertain_action"
            args = {"code": "return true"}
            first = await body.call("lua", args, request)
            assert first.status == "unknown"
            assert first.data == {"reason": "native_rpc_unconfirmed", "errorType": "ReadError"}
            assert "sensitive" not in json.dumps(first.data)
            assert (await body.call("lua", args, request)).status == "unknown"
            assert (await body.result(request)).status == "completed"
            assert requests == [request]
        finally:
            await body.close()

    asyncio.run(run())

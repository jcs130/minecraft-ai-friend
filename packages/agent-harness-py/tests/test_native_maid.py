"""Native private-body contract, including dropped replies and retained server receipts."""
from __future__ import annotations

import asyncio
import json
from typing import Any

import httpx
import pytest

from agent_mc_harness import BodyAction, Scope
from agent_mc_harness.body.maid import MaidBody, reply_status
from agent_mc_harness.bridges import ControlChanged, NativeMaidBridge

OWNER = "00000000-0000-4000-8000-000000000001"
MAID = "00000000-0000-4000-8000-000000000002"
CONTROLLER = "00000000-0000-4000-8000-000000000003"
OTHER = "00000000-0000-4000-8000-000000000004"
SCOPE = Scope(realm="isolation", account="original-owner", agent="original-companion")
TOKEN = "isolated-test-token"
ENDPOINT = "http://127.0.0.1:19087/maid-body"


class NativeServer:
    """Protocol fixture. Actual game integration is verified separately against the Java endpoint."""

    def __init__(self) -> None:
        self.controller: str | None = None
        self.generation = "server-boot-a:1"
        self.calls: list[dict[str, Any]] = []
        self.writes: list[dict[str, Any]] = []
        self.receipts: dict[str, dict[str, Any]] = {}
        self.position = {"x": 3.0, "y": 65.0, "z": 4.0}
        self.life = "alive"
        self.drop_reply = False
        self.reply_override: dict[str, Any] | None = None
        self.actions = ["list", "context", "inventory", "tasks", "brain", "receipt", "walk", "follow", "stay", "speak"]

    def __call__(self, request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer " + TOKEN
        assert str(request.url) == ENDPOINT
        payload = json.loads(request.content)
        self.calls.append(payload)
        if payload["ownerId"] != OWNER or payload["maidId"] != MAID:
            return httpx.Response(403, json={"error": "IDENTITY_MISMATCH"})
        if self.controller is not None and self.controller != payload["controllerId"]:
            return httpx.Response(409, json={"error": "CONTROL_CHANGED"})
        envelope = {"protocol": NativeMaidBridge.protocol, "ownerId": OWNER, "maidId": MAID,
                    "controllerId": payload["controllerId"], "generation": self.generation}
        if payload["operation"] == "bind":
            self.controller = payload["controllerId"]
            envelope["tools"] = [{"name": "mc_maids", "inputSchema": {"type": "object", "properties": {
                "action": {"enum": self.actions}}}}]
            return httpx.Response(200, json=envelope)
        if payload["generation"] != self.generation:
            return httpx.Response(409, json={"error": "CONTROL_CHANGED"})
        if payload["operation"] == "release":
            self.controller = None
            return httpx.Response(200, json=envelope)
        assert payload["name"] == "mc_maids"
        args = payload["arguments"]
        action = args["action"]
        data: dict[str, Any] = {"maidId": MAID, "ownerId": OWNER}
        if action == "list":
            data["maids"] = [{"maidId": MAID, "ownerId": OWNER, "name": "Existing companion"}]
        elif action == "context":
            data.update(lifeState=self.life, dimension="minecraft:overworld", ownerOnline=False)
            if self.life == "alive":
                data["position"] = self.position
            else:
                data["lastSeenAlive"] = {"position": self.position, "dimension": "minecraft:overworld"}
                data["historicalDeath"] = {"at": "2026-01-01T00:00:00Z"}
        elif action == "inventory":
            data["slots"] = [{"slot": 0, "itemId": "minecraft:iron_sword", "count": 1}]
        elif action == "receipt":
            data.update(self.reply_override or self.receipts.get(args["operationId"], {
                "operationId": args["operationId"], "action": "walk", "status": "unknown"}))
        elif action in ("tasks", "brain") and "choice" not in args:
            data["tasks"] = []
        else:
            assert args["requestId"] == payload["requestId"]
            rid = args["requestId"]
            if rid not in self.receipts:
                self.writes.append(args)
                self.receipts[rid] = {"operationId": rid, "action": action, "status": "applied"}
                if action == "walk":
                    self.position = {axis: args[axis] for axis in ("x", "y", "z")}
                    self.receipts[rid].update(status="completed", goalCompleted=True, actualPosition=self.position)
            data.update(self.receipts[rid])
            if action == "walk":
                data["status"] = "accepted"
            if self.drop_reply:
                self.drop_reply = False
                raise httpx.ReadTimeout("injected after commit", request=request)
        reply = {"ok": True, "data": data}
        envelope["result"] = {"content": [{"type": "text", "text": json.dumps(reply)}]}
        return httpx.Response(200, json=envelope)


def make(server: NativeServer, *, controller_id: str = CONTROLLER) -> MaidBody:
    http = httpx.AsyncClient(transport=httpx.MockTransport(server))
    bridge = NativeMaidBridge(ENDPOINT, TOKEN, owner_id=OWNER, maid_id=MAID, controller_id=controller_id, http=http)
    return MaidBody(bridge, scope=SCOPE, owner_id=OWNER, maid_id=MAID, server_id="qa-server", world_key="qa-world",
                    poll_seconds=0, result_poll_seconds=0, context_poll_seconds=0)


@pytest.mark.parametrize("endpoint", ["http://example.com:80/maid-body", "https://127.0.0.1:19087/maid-body",
    "http://user:password@127.0.0.1:19087/maid-body", ENDPOINT + "?token=private", ENDPOINT + "#fragment",
    "http://127.0.0.1:19087/core", "http://localhost:19087/maid-body"])
def test_transport_restricts_destination(endpoint: str) -> None:
    with pytest.raises(ValueError, match="loopback"):
        NativeMaidBridge(endpoint, TOKEN, owner_id=OWNER, maid_id=MAID, controller_id=CONTROLLER)


def test_offline_owner_original_identity_and_actual_receipt(run: Any) -> None:
    async def scenario() -> None:
        server = NativeServer()
        body = make(server)
        await body.spawn()
        try:
            ident = body.identity()
            assert ident and (ident.body_id, ident.owner_id, ident.scope, ident.generation) == (MAID, OWNER, SCOPE, server.generation)
            group = ident.group_id()
            assert body.capabilities().supports("move")
            assert not body.capabilities().supports("craft")
            assert not body.capabilities().supports("cast")
            move = BodyAction(verb="move", args={"x": 7, "y": 65, "z": 3}, request_id="original-move-001")
            accepted = await body.act(move)
            assert accepted.status == "accepted" and not accepted.terminal
            completed = await body.result(move.request_id)
            assert completed.status == "completed"
            snap = await body.snapshot()
            assert snap.position == {"x": 7.0, "y": 65.0, "z": 3.0}
            assert snap.inventory["slots"][0]["itemId"] == "minecraft:iron_sword"
            await body.reconnect()
            assert body.identity().group_id() == group
            assert sum(c["operation"] == "bind" for c in server.calls) == 1
            assert (await body.stop()).status == "completed"
        finally:
            await body.destroy()
        assert server.controller is None and server.calls[-1]["operation"] == "release"
    run(scenario())


def test_duplicate_concurrent_submission_and_parameter_conflict(run: Any) -> None:
    async def scenario() -> None:
        server = NativeServer()
        body = make(server)
        await body.spawn()
        try:
            action = BodyAction(verb="chat", args={"text": "hello"}, request_id="same-speech-001")
            receipts = await asyncio.gather(*(body.act(action) for _ in range(8)))
            assert all(r == receipts[0] for r in receipts) and len(server.writes) == 1
            changed = await body.act(action.model_copy(update={"args": {"text": "different"}}))
            assert changed.status == "rejected" and "request_id_conflict" in changed.text
            assert len(server.writes) == 1
        finally:
            await body.destroy()
    run(scenario())


def test_dropped_reply_and_rebuilt_adapter_only_query_original_request(run: Any) -> None:
    async def scenario() -> None:
        server = NativeServer()
        body = make(server)
        await body.spawn()
        server.drop_reply = True
        move = BodyAction(verb="move", args={"x": 8, "y": 65, "z": 3}, request_id="lost-move-001")
        lost = await body.act(move)
        assert lost.status == "unknown" and not lost.retry_allowed
        assert (await body.act(move)).status == "unknown" and len(server.writes) == 1
        await body.destroy()
        restored = make(server)
        await restored.spawn()
        try:
            final = await restored.result("lost-move-001")
            assert final.status == "completed" and len(server.writes) == 1
            assert (await restored.result("old-unknown-001")).status == "unknown"
            assert len(server.writes) == 1
        finally:
            await restored.destroy()
    run(scenario())


@pytest.mark.parametrize("change", [{"operationId": "another-request-01"}, {"maidId": OTHER}, {"ownerId": OTHER}, {"action": "speak"}])
def test_unrelated_receipt_cannot_complete_request(change: dict[str, Any], run: Any) -> None:
    async def scenario() -> None:
        server = NativeServer()
        body = make(server)
        await body.spawn()
        try:
            await body.act(BodyAction(verb="move", args={"x": 8, "y": 65, "z": 3}, request_id="move-verify-001"))
            server.reply_override = {**server.receipts["move-verify-001"], **change}
            assert (await body.result("move-verify-001")).status == "accepted"
            server.reply_override = None
            assert (await body.result("move-verify-001")).status == "completed"
        finally:
            await body.destroy()
    run(scenario())


def test_walk_mode_ack_requires_arrival_receipt(run: Any) -> None:
    async def scenario() -> None:
        server = NativeServer()
        body = make(server)
        await body.spawn()
        try:
            await body.act(BodyAction(verb="move", args={"x": 8, "y": 65, "z": 3}, request_id="walk-not-arrived"))
            for status in ("applied", "completed"):
                server.reply_override = {"operationId": "walk-not-arrived", "action": "walk", "status": status,
                                         "goalCompleted": False}
                assert (await body.result("walk-not-arrived")).status == "accepted"
            server.reply_override = None
            assert (await body.result("walk-not-arrived")).status == "completed"
        finally:
            await body.destroy()
    run(scenario())


def test_stale_generation_blocks_rebind_and_further_writes(run: Any) -> None:
    async def scenario() -> None:
        server = NativeServer()
        body = make(server)
        await body.spawn()
        server.generation = "server-boot-b:1"
        stale = await body.act(BodyAction(verb="follow", request_id="stale-follow-001"))
        assert stale.status == "unknown" and body.lifecycle() == "error"
        count = len(server.calls)
        with pytest.raises(ControlChanged):
            await body.reconnect()
        assert len(server.calls) == count and not server.writes
        await body.destroy()
        assert len(server.calls) == count
    run(scenario())


def test_other_controller_cannot_bind_and_native_cannot_target_other_maid(run: Any) -> None:
    async def scenario() -> None:
        server = NativeServer()
        body = make(server)
        other = make(server, controller_id=OTHER)
        await body.spawn()
        try:
            with pytest.raises(ControlChanged):
                await other.spawn()
            before = len(server.calls)
            refused = await body.act(BodyAction(verb="native", name="follow", args={"maidId": OTHER}, request_id="wrong-body-001"))
            assert refused.status == "rejected" and len(server.calls) == before
        finally:
            await other.destroy()
            await body.destroy()
    run(scenario())


def test_unloaded_is_not_historical_death_or_current_position(run: Any) -> None:
    async def scenario() -> None:
        server = NativeServer()
        body = make(server)
        await body.spawn()
        try:
            server.life = "unloaded_or_unavailable"
            snap = await body.snapshot()
            assert snap.life_state == "unloaded" and snap.position is None
            assert snap.raw["historicalDeath"] and snap.raw["lastSeenAlive"]
        finally:
            await body.destroy()
    run(scenario())


def test_brain_selection_requires_original_write_id(run: Any) -> None:
    async def scenario() -> None:
        server = NativeServer()
        body = make(server)
        await body.spawn()
        try:
            await body.act(BodyAction(verb="native", name="brain", args={"choice": "dsh"}, request_id="brain-choice-001"))
            assert server.writes[0]["requestId"] == "brain-choice-001"
        finally:
            await body.destroy()
    run(scenario())


@pytest.mark.parametrize("field,value", [("ownerId", OTHER), ("maidId", OTHER), ("controllerId", OTHER),
                                          ("generation", "stale-generation")])
def test_wrong_envelope_fences_adapter(field: str, value: str, run: Any) -> None:
    async def scenario() -> None:
        server = NativeServer()
        body = make(server)
        await body.spawn()
        original = server.__call__

        def changed(request: httpx.Request) -> httpx.Response:
            response = original(request)
            return httpx.Response(200, json={**response.json(), field: value})

        await body.bridge.http.aclose()
        body.bridge.http = httpx.AsyncClient(transport=httpx.MockTransport(changed))
        with pytest.raises(ControlChanged):
            await body.snapshot()
        assert body.lifecycle() == "error" and not server.writes
        await body.destroy()
    run(scenario())


def test_missing_capabilities_release_the_confirmed_binding(run: Any) -> None:
    async def scenario() -> None:
        server = NativeServer()
        server.actions.remove("receipt")
        body = make(server)
        with pytest.raises(RuntimeError, match="invalid_capabilities"):
            await body.spawn()
        assert server.controller is None and server.calls[-1]["operation"] == "release"
        await body.destroy()
    run(scenario())


def test_release_failure_is_visible_to_the_host(run: Any) -> None:
    async def scenario() -> None:
        server = NativeServer()
        body = make(server)
        await body.spawn()

        def broken(request: httpx.Request) -> httpx.Response:
            return httpx.Response(503, json={"error": "unavailable"})

        await body.bridge.http.aclose()
        body.bridge.http = httpx.AsyncClient(transport=httpx.MockTransport(broken))
        with pytest.raises(RuntimeError, match="unknown"):
            await body.destroy()
        assert body.lifecycle() == "error" and body.bridge.http.is_closed
    run(scenario())


def test_missing_historical_receipt_and_request_conflict_do_not_change_control(run: Any) -> None:
    async def scenario() -> None:
        server = NativeServer()
        body = make(server)
        await body.spawn()

        def historical(request: httpx.Request) -> httpx.Response:
            payload = json.loads(request.content)
            if payload.get("arguments", {}).get("action") == "receipt":
                return httpx.Response(409, json={"error": "receipt_missing"})
            if payload.get("arguments", {}).get("requestId") == "legacy-conflict-001":
                return httpx.Response(409, json={"error": "REQUEST_CONFLICT_LEGACY_QUERY_ORIGINAL"})
            return server(request)

        await body.bridge.http.aclose()
        body.bridge.http = httpx.AsyncClient(transport=httpx.MockTransport(historical))
        try:
            assert (await body.result("historical-missing-001")).status == "unknown"
            conflict = await body.act(BodyAction(verb="chat", args={"text": "hello"}, request_id="legacy-conflict-001"))
            assert conflict.status == "unknown" and not server.writes
            assert body.lifecycle() == "ready"
            assert (await body.stop()).status == "completed"
        finally:
            await body.destroy()
    run(scenario())


@pytest.mark.parametrize("reply", [None, "success", {}, {"ok": True, "status": "unavailable"}])
def test_ambiguous_reply_cannot_complete_action(reply: Any) -> None:
    assert reply_status(reply, False) == "unknown"


@pytest.mark.parametrize("missing", ["data", "operationId", "action"])
def test_native_write_needs_an_identified_receipt(missing: str, run: Any) -> None:
    async def scenario() -> None:
        server = NativeServer()
        body = make(server)
        await body.spawn()

        def incomplete(request: httpx.Request) -> httpx.Response:
            response = server(request)
            if json.loads(request.content).get("arguments", {}).get("action") == "speak":
                envelope = response.json()
                reply = json.loads(envelope["result"]["content"][0]["text"])
                if missing == "data":
                    reply.pop("data")
                else:
                    reply["data"].pop(missing)
                envelope["result"]["content"][0]["text"] = json.dumps(reply)
                return httpx.Response(200, json=envelope)
            return response

        await body.bridge.http.aclose()
        body.bridge.http = httpx.AsyncClient(transport=httpx.MockTransport(incomplete))
        try:
            receipt = await body.act(BodyAction(verb="chat", args={"text": "hello"}, request_id="missing-evidence-001"))
            assert receipt.status == "unknown"
            assert (await body.result(receipt.request_id)).status == "completed"
            assert len(server.writes) == 1
        finally:
            await body.destroy()
    run(scenario())


def test_failed_context_during_bind_releases_control(run: Any) -> None:
    async def scenario() -> None:
        server = NativeServer()
        body = make(server)

        def unavailable(request: httpx.Request) -> httpx.Response:
            if json.loads(request.content).get("arguments", {}).get("action") == "context":
                return httpx.Response(503, json={"error": "unavailable"})
            return server(request)

        await body.bridge.http.aclose()
        body.bridge.http = httpx.AsyncClient(transport=httpx.MockTransport(unavailable))
        with pytest.raises(RuntimeError, match="unknown"):
            await body.spawn()
        assert body.lifecycle() == "error" and server.controller is None
        assert server.calls[-1]["operation"] == "release" and body.bridge.http.is_closed
    run(scenario())


def test_server_conflict_remains_queryable_by_original_id(run: Any) -> None:
    async def scenario() -> None:
        server = NativeServer()
        original_id = "legacy-original-001"
        server.receipts[original_id] = {"operationId": original_id, "action": "speak", "status": "applied"}
        body = make(server)
        await body.spawn()

        def conflict(request: httpx.Request) -> httpx.Response:
            if json.loads(request.content).get("arguments", {}).get("requestId") == original_id:
                return httpx.Response(409, json={"error": "REQUEST_CONFLICT_LEGACY_QUERY_ORIGINAL"})
            return server(request)

        await body.bridge.http.aclose()
        body.bridge.http = httpx.AsyncClient(transport=httpx.MockTransport(conflict))
        try:
            receipt = await body.act(BodyAction(verb="chat", args={"text": "hello"}, request_id=original_id))
            assert receipt.status == "unknown" and not receipt.retry_allowed
            assert (await body.result(original_id)).status == "completed"
            assert not server.writes
        finally:
            await body.destroy()
    run(scenario())


def test_native_context_coordinate_array_and_health_are_observable(run: Any) -> None:
    async def scenario() -> None:
        server = NativeServer()
        body = make(server)

        def native_shape(request: httpx.Request) -> httpx.Response:
            response = server(request)
            if json.loads(request.content).get("arguments", {}).get("action") == "context":
                envelope = response.json()
                reply = json.loads(envelope["result"]["content"][0]["text"])
                reply["data"].update(position=[3.25, 81.0, 4.75], health=15.5, maxHealth=20.0)
                envelope["result"]["content"][0]["text"] = json.dumps(reply)
                return httpx.Response(200, json=envelope)
            return response

        await body.bridge.http.aclose()
        body.bridge.http = httpx.AsyncClient(transport=httpx.MockTransport(native_shape))
        await body.spawn()
        try:
            snapshot = await body.snapshot()
            assert snapshot.position == {"x": 3.25, "y": 81.0, "z": 4.75}
            assert (snapshot.health, snapshot.max_health) == (15.5, 20.0)
        finally:
            await body.destroy()
    run(scenario())

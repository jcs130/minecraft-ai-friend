"""Native private-body contract, including dropped replies and retained server receipts."""
from __future__ import annotations

import asyncio
import json
from contextlib import suppress
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest

from agent_mc_harness import BodyAction, Scope
from agent_mc_harness.body.maid import MaidBody, legacy_cast_outcome, reply_status
from agent_mc_harness.bridges import ControlChanged, MaidApiBridge, NativeMaidBridge
from agent_mc_harness.journal import ActionJournal
from agent_mc_harness.npc import NpcHost, NpcRole
from agent_mc_harness.runtime import Step

OWNER = "00000000-0000-4000-8000-000000000001"
MAID = "00000000-0000-4000-8000-000000000002"
CONTROLLER = "00000000-0000-4000-8000-000000000003"
OTHER = "00000000-0000-4000-8000-000000000004"
SCOPE = Scope(realm="isolation", account="original-owner", agent="original-companion")
TOKEN = "isolated-test-token"
ENDPOINT = "http://127.0.0.1:19087/maid-body"
API_ENDPOINT = "https://maids.example.test/api/v1/maid-body"


@pytest.mark.parametrize("endpoint", [
    "http://maids.example.test/api/v1/maid-body",
    "https://alice@maids.example.test/api/v1/maid-body",
    "https://maids.example.test/api/v1/maid-body?target=other",
    "https://maids.example.test/maid-body",
])
def test_remote_maid_bridge_requires_the_scoped_https_route(endpoint: str) -> None:
    with pytest.raises(ValueError, match="maid_api_requires_https_endpoint"):
        MaidApiBridge(endpoint, TOKEN, owner_id=OWNER, maid_id=MAID, controller_id=CONTROLLER)


def test_remote_maid_identity_never_forwards_the_key_on_redirect(run: Any) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == API_ENDPOINT
        assert request.headers["authorization"] == "Bearer " + TOKEN
        assert json.loads(request.content) == {"operation": "identity"}
        return httpx.Response(307, headers={"Location": "https://other.example.test/api/v1/maid-body"})

    async def go() -> None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler), follow_redirects=True) as http:
            with pytest.raises(RuntimeError, match="maid_api_identity_unavailable"):
                await MaidApiBridge.identify(API_ENDPOINT, TOKEN, http=http)

    run(go())


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
        self.cast_observation: dict[str, Any] | None = None
        self.actions = ["list", "context", "inventory", "tasks", "brain", "receipt", "walk", "follow", "stay", "speak"]
        self.messages: list[dict[str, Any]] = []

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
            data.update(sessionKey=f"qiandengji:maid:{MAID}", memoryNamespace=f"qiandengji:maid:{MAID}")
            if self.life == "alive":
                data["position"] = self.position
            else:
                data["lastSeenAlive"] = {"position": self.position, "dimension": "minecraft:overworld"}
                data["historicalDeath"] = {"at": "2026-01-01T00:00:00Z"}
        elif action == "inventory":
            data["slots"] = [{"slot": 0, "itemId": "minecraft:iron_sword", "count": 1}]
        elif action == "workshop":
            data["workshops"] = []
        elif action == "inbox":
            data["messages"] = self.messages
        elif action == "receipt":
            data.update(self.reply_override or self.receipts.get(args["operationId"], {
                "operationId": args["operationId"], "action": "walk", "status": "unknown"}))
        elif action in ("tasks", "brain") and "choice" not in args:
            data["tasks"] = []
        else:
            assert args["requestId"] == payload["requestId"]
            rid = args["requestId"]
            if action == "walk" and args.get("dimension", "minecraft:overworld") != "minecraft:overworld":
                return httpx.Response(400, json={"error": "DIMENSION_MISMATCH"})
            if rid not in self.receipts:
                self.writes.append(args)
                self.receipts[rid] = {"operationId": rid, "action": action, "status": "applied"}
                if action == "cast" and self.cast_observation is not None:
                    self.receipts[rid] = old_cast_receipt(args, self.cast_observation)
                if action == "ack":
                    self.messages = [item for item in self.messages if item["eventId"] != args["eventId"]]
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


def make(server: NativeServer, *, controller_id: str = CONTROLLER, scope: Scope = SCOPE) -> MaidBody:
    http = httpx.AsyncClient(transport=httpx.MockTransport(server))
    bridge = NativeMaidBridge(ENDPOINT, TOKEN, owner_id=OWNER, maid_id=MAID, controller_id=controller_id, http=http)
    return MaidBody(bridge, scope=scope, owner_id=OWNER, maid_id=MAID, server_id="qa-server", world_key="qa-world",
                    poll_seconds=0, result_poll_seconds=0, context_poll_seconds=0)


def old_cast_receipt(args, observation):
    return {"schema": 1, "namespace": "native-body", "maidId": MAID, "ownerId": OWNER,
            "operationId": args["requestId"], "requestId": args["requestId"], "action": "cast",
            "arguments": json.dumps(args), "status": "unknown", "terminal": False, "retryAllowed": False,
            "observation": {"spellId": args["spellId"], **observation}}


def test_native_inbox_distinguishes_legacy_addressed_chat_from_overheard_voice(run):
    async def scenario():
        server = NativeServer()
        server.actions += ["inbox"]
        client = make(server)
        events = []
        unsubscribe = client.subscribe(events.append)
        try:
            await client.spawn()
            server.messages = [
                {"eventId": f"{OWNER}:near_test", "senderUuid": OWNER, "text": "能一起过来吗？"},
                {"eventId": f"qdvoice:{OWNER}:voice_test", "senderUuid": OWNER, "text": "可米，等一下。"},
                {"eventId": f"{OTHER}:near_test", "senderUuid": OWNER, "text": "我在这。"},
            ]
            await client.poll_once()
            direct, ambient, mismatch = [event.data for event in events if event.kind == "dialogue"]
            assert direct["recipientId"] == MAID and direct["deliveryScope"] == "addressed"
            assert "recipientId" not in ambient and ambient["deliveryScope"] == "nearby"
            assert "recipientId" not in mismatch
        finally:
            unsubscribe()
            await client.destroy()
    run(scenario())


@pytest.mark.parametrize(("observation", "expected"), [
    ({"state": "rpg_cast_hit", "effectsApplied": True, "hitTargetIds": [OTHER], "manaRemaining": 2.3}, "completed"),
    ({"state": "rpg_cast_healed", "effectsApplied": True, "healedTargetIds": [OWNER], "manaRemaining": 0}, "completed"),
    ({"state": "rpg_mana_low", "error": "rpg_mana_low", "effectsApplied": False}, "failed"),
    ({"state": "rpg_hit_blocked", "error": "rpg_hit_blocked", "effectsApplied": False,
      "hitTargetIds": [], "healedTargetIds": [], "manaRemaining": 2.3}, "failed"),
])
def test_direct_cast_legacy_observation_has_a_terminal_outcome(run, observation, expected):
    async def scenario():
        server = NativeServer()
        server.actions += ["cast"]
        server.cast_observation = observation
        client = make(server)
        await client.spawn()
        try:
            action = BodyAction(verb="cast", args={"spellId": "arcane_bolt"}, request_id="cast-direct")
            result = await client.act(action)
            assert result.status == expected and result.terminal and result.text == observation["state"]
            assert await client.act(action) == result and len(server.writes) == 1
        finally:
            await client.destroy()

    run(scenario())


def test_drop_cast_response_keeps_one_dispatch_and_read_recovers_reply_lane(run, tmp_path, monkeypatch):
    async def scenario():
        server = NativeServer()
        server.actions += ["cast", "inbox", "ack"]
        server.cast_observation = {"state": "rpg_cast_hit", "effectsApplied": True,
                                   "hitTargetIds": [OTHER], "manaRemaining": 2.3}
        action = BodyAction(verb="cast", args={"spellId": "arcane_bolt"}, request_id="original-cast")
        journal = ActionJournal(tmp_path / "actions.db")
        body = make(server)
        await body.spawn()
        try:
            journal.begin(MAID, action)
            server.drop_reply = True
            unknown = await body.act(action)
            assert unknown.status == "unknown"
            journal.settle(MAID, unknown)
        finally:
            await body.destroy()
        who = NpcRole(id="qa_maid", name="QA resident", owner_id=OWNER, character_id=MAID, body_id=MAID,
                      body_kind="maid", provider="tokenplan", model="qa", persona="Quiet unless addressed.",
                      allowed_tools=["body:chat"])
        replacement = make(server, scope=who.scope("qa-server"))
        now = datetime.now(UTC)
        server.messages = [
            {"eventId": "expired", "text": "yesterday's request", "senderUuid": OWNER,
             "receivedAt": (now - timedelta(hours=10)).isoformat()},
            {"eventId": "fresh", "text": "current hello", "senderUuid": OWNER, "receivedAt": now.isoformat()},
        ]
        planned = []

        async def planner(intent, context):
            planned.extend(event.data["eventId"] for event in context.dialogue)
            return [Step(tool="body:chat", args={"text": "测试回复"})] if context.dialogue else []

        served = asyncio.Event()
        original_spawn = replacement.spawn
        original_settle = journal.settle

        async def spawn_with_inbox():
            await original_spawn()
            await replacement.poll_once()

        def settle(body_id, receipt):
            original_settle(body_id, receipt)
            if journal.acknowledged(MAID, "fresh"):
                served.set()

        monkeypatch.setattr(replacement, "spawn", spawn_with_inbox)
        monkeypatch.setattr(journal, "settle", settle)
        host = NpcHost(who, replacement, planner, None, journal)
        running = asyncio.create_task(host.run())
        try:
            await asyncio.wait_for(served.wait(), 12)
            assert not journal.unresolved(MAID)
            assert journal.replied(MAID, "fresh") and not journal.replied(MAID, "expired")
            assert journal.acknowledged(MAID, "expired") and not server.messages
            assert planned == ["fresh"]
            assert [write["action"] for write in server.writes] == ["cast", "ack", "speak", "ack"]
        finally:
            running.cancel()
            with suppress(asyncio.CancelledError):
                await running
            await host.close()

    run(scenario())


@pytest.mark.parametrize(("record", "extra"), [
    ({"ownerId": OTHER}, {}), ({"maidId": OTHER}, {}), ({"operationId": "other-request"}, {}),
    ({"arguments": "{}"}, {}), ({"namespace": "legacy"}, {}), ({"terminal": True}, {}),
    ({}, {"spellId": "another_spell"}), ({}, {"status": "unknown"}),
    ({}, {"hitTargetIds": []}), ({}, {"manaRemaining": float("nan")}), ({}, {"effectsApplied": False}),
])
def test_wrong_or_unproven_cast_cannot_clear_an_unknown_write(record, extra):
    args = {"action": "cast", "maidId": MAID, "requestId": "original-cast", "spellId": "arcane_bolt"}
    proof = old_cast_receipt(args, {"state": "rpg_cast_hit", "effectsApplied": True,
                                   "hitTargetIds": [OTHER], "manaRemaining": 2.3, **extra}) | record
    assert legacy_cast_outcome(proof, owner=OWNER, maid=MAID, request="original-cast", spell="arcane_bolt") is None


def test_workshop_inventory_has_an_explicit_default_and_rejects_a_guessed_name(run: Any) -> None:
    async def scenario():
        server = NativeServer()
        server.actions.extend(["workshop", "make"])
        body = make(server)
        await body.spawn()
        try:
            order = {"workshopId": "fixture", "recipeId": "minecraft:torch", "quantity": 4}
            bad = await body.act(BodyAction(verb="craft", args={**order, "inventory": "supply"}, request_id="bad_inventory"))
            assert bad.status == "rejected" and "chest" in bad.text and "backpack" in bad.text
            assert not server.writes
            await body.act(BodyAction(verb="craft", args=order, request_id="default_inventory"))
            assert [write["inventory"] for write in server.writes] == ["chest"]
        finally:
            await body.destroy()

    run(scenario())


def test_unloaded_maid_snapshot_does_not_treat_inventory_as_available(run: Any) -> None:
    async def scenario():
        server = NativeServer()
        server.life = "unloaded_or_unavailable"
        body = make(server)
        await body.spawn()
        try:
            snapshot = await body.snapshot()
            assert snapshot.life_state == "unloaded" and snapshot.inventory is None
            assert not any(call.get("arguments", {}).get("action") == "inventory" for call in server.calls)
        finally:
            await body.destroy()

    run(scenario())


def test_native_argument_catalogue_preserves_action_specific_server_contract():
    body = make(NativeServer())
    body._actions = ["guard", "pickup", "walk", "dismount"]
    fields = {"guard": [], "pickup": ["enabled"], "walk": ["x", "y", "z", "dimension"], "dismount": []}
    body._schema = {"type": "object", "additionalProperties": False,
        "properties": {"action": {"enum": body._actions}, "maidId": {"type": "string"},
            "requestId": {"type": "string"}, "enabled": {"type": "boolean"},
            **{k: {"type": "number"} for k in ("x", "y", "z")}, "dimension": {"type": "string"}},
        "oneOf": [{"properties": {"action": {"const": action}},
            "propertyNames": {"enum": ["action", "maidId", "requestId", *names]},
            "required": ["action", "requestId", *[k for k in names if k != "dimension"]]}
            for action, names in fields.items()]}
    catalogue = {action.name: action.input_schema for action in body.capabilities().native_actions}
    for action, names in fields.items():
        schema = catalogue[action]
        assert set(schema["properties"]) == set(names)
        assert schema["additionalProperties"] is False
        assert set(schema["required"]) == set(names) - {"dimension"}
    assert catalogue["pickup"]["properties"]["enabled"] == {"type": "boolean"}


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


def test_maid_follow_never_silently_discards_a_target(run: Any) -> None:
    async def scenario() -> None:
        server = NativeServer()
        body = make(server)
        await body.spawn()
        try:
            for key in ("name", "target", "uuid"):
                response = await body.act(BodyAction(verb="follow", args={key: OTHER}, request_id="wrong-follow-" + key))
                assert response.status == "rejected" and "skill compass" in response.text
            assert not server.writes
            response = await body.act(BodyAction(verb="follow", request_id="owner-follow-001"))
            assert response.status == "completed"
            assert [write["action"] for write in server.writes] == ["follow"]
        finally:
            await body.destroy()

    run(scenario())


def test_social_walk_rejects_stale_dimension_before_movement(run: Any) -> None:
    async def scenario() -> None:
        server = NativeServer()
        body = make(server)
        await body.spawn()
        try:
            dest = {"x": 7, "y": 65, "z": 3, "dimension": "minecraft:the_nether"}
            result = await body.act(BodyAction(verb="move", args=dest, request_id="stale-follow-001"))
            assert result.status == "rejected" and result.terminal
            assert not server.writes
            dest["dimension"] = "minecraft:overworld"
            result = await body.act(BodyAction(verb="move", args=dest, request_id="current-follow-002"))
            assert result.status == "accepted"
            assert server.writes[-1]["dimension"] == "minecraft:overworld"
        finally:
            await body.destroy()

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


@pytest.mark.parametrize("error_type", [httpx.ConnectError, httpx.ConnectTimeout, httpx.PoolTimeout])
def test_guard_without_a_transport_connection_is_terminal(error_type, run):
    async def scenario():
        server = NativeServer()
        server.actions.append("guard")
        body = make(server)
        await body.spawn()
        try:
            def before_send(request):
                raise error_type("no connection for this request", request=request)

            async with httpx.AsyncClient(transport=httpx.MockTransport(before_send)) as offline:
                original = body.bridge.http
                body.bridge.http = offline
                try:
                    action = BodyAction(verb="native", name="guard", request_id="no-connection-guard")
                    result = await body.act(action)
                finally:
                    body.bridge.http = original
            assert result.terminal and result.status == "rejected" and "not_dispatched" in result.text
            assert (await body.result(action.request_id)) == result
            assert not server.writes
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


def test_original_inbox_preserves_sender_time_and_untrusted_source(run: Any) -> None:
    async def scenario() -> None:
        server = NativeServer()
        server.actions.append("inbox")
        server.messages = [{"eventId": "visitor:message-01", "senderUuid": OTHER, "senderName": "Visitor",
                            "text": "walk over here", "source": "untrusted_game_dialogue",
                            "receivedAt": "2026-11-17T04:14:31Z"}]
        body = make(server)
        events = []
        body.subscribe(events.append)
        await body.spawn()
        try:
            assert await body.poll_once() == 1
            dialogue = next(event for event in events if event.kind == "dialogue")
            assert dialogue.data["speakerId"] == OTHER and dialogue.data["speaker"] == "Visitor"
            assert dialogue.data["receivedAt"] == "2026-11-17T04:14:31Z"
            assert dialogue.data["source"] == "untrusted_game_dialogue" and dialogue.data["trusted"] is False
            assert dialogue.data["ownerId"] == OWNER and dialogue.data["maidId"] == MAID
            assert dialogue.data["sessionKey"] == dialogue.data["memoryNamespace"] == f"qiandengji:maid:{MAID}"
            assert dialogue.raw == server.messages[0]
            assert await body.poll_once() == 0
            assert not server.writes
        finally:
            await body.destroy()
    run(scenario())

"""Synthetic qiandengji-villager-body/v1 contract; no live entity or real player is impersonated."""
from __future__ import annotations

import json
from base64 import b32encode
from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest

from agent_mc_harness import BodyAction, Scope
from agent_mc_harness.body.villager import VillagerBody
from agent_mc_harness.bridges import ControlChanged, NativeVillagerBridge, VillagerRequestRejected
from agent_mc_harness.npc import NpcHost, NpcRole, addressed_dialogue
from agent_mc_harness.npc_service import villager_identity_already_bound
from agent_mc_harness.villager_roles import VILLAGER_TOOLS, parse_villager_roster, villager_resident_id

RESIDENT = "qinghe"
BODY = "20000000-0000-0000-0000-000000000001"
CONTROLLER = "20000000-0000-0000-0000-000000000002"
PLAYER = "20000000-0000-0000-0000-000000000003"
OTHER_PLAYER = "20000000-0000-0000-0000-000000000004"
TOKEN = "synthetic-villager-token"
ENDPOINT = "http://127.0.0.1:19128/villager-body"
PROTOCOL = "qiandengji-villager-body/v1"
SCOPE = Scope(realm="synthetic-server", account="namespace-owner", agent="villager_qinghe")


def now_ms():
    return int(datetime.now(UTC).timestamp() * 1000)


class VillagerServer:
    def __init__(self):
        self.generation = "server-boot:7"
        self.leased = False
        self.calls = []
        self.writes = []
        self.receipts = {}
        self.events = []
        self.position = {"x": 1.0, "y": 70.0, "z": 2.0}
        self.drop_write = False
        self.envelope_override = None
        self.status_override = None
        self.inbox_override = None
        self.actions = ["context", "inbox", "walk", "speak", "stop", "receipt"]

    def __call__(self, request: httpx.Request) -> httpx.Response:
        assert str(request.url) == ENDPOINT
        assert request.headers["authorization"] == "Bearer " + TOKEN
        payload = json.loads(request.content)
        self.calls.append(payload)
        if payload["operation"] == "roster":
            return httpx.Response(200, json={"protocol": PROTOCOL, "villagers": self.events})
        envelope = {"protocol": PROTOCOL, "residentId": RESIDENT, "bodyId": BODY,
                    "controllerId": payload.get("controllerId", CONTROLLER), "generation": self.generation}
        if self.envelope_override:
            envelope.update(self.envelope_override)
        if payload["operation"] == "bind":
            if self.leased:
                return httpx.Response(409, json={"error": "BODY_CONTROLLER_ACTIVE"})
            self.leased = True
            envelope["tools"] = [{"name": "mc_villager", "inputSchema": {"type": "object", "properties": {
                "action": {"enum": self.actions}}}}]
            return httpx.Response(200, json=envelope)
        if payload.get("generation") != self.generation:
            return httpx.Response(409, json={"error": "GENERATION_MISMATCH"})
        if not self.leased:
            return httpx.Response(409, json={"error": "CONTROL_EXPIRED"})
        if payload["operation"] == "release":
            self.leased = False
            return httpx.Response(200, json=envelope | {"released": True})
        assert payload["operation"] == "call" and payload["tool"] == "mc_villager"
        args = payload["arguments"]
        action = args["action"]
        data = {"residentId": RESIDENT, "bodyId": BODY, "action": action, "observedAt": now_ms()}
        if action == "context":
            data.update(name="青禾", profession="minecraft:farmer", level=3, health=20, maxHealth=20,
                        position=self.position, dimension="minecraft:overworld", world="world", gameTime=100,
                        sleeping=False, ai=True, trader={}, home={"x": 1, "y": 70, "z": 2}, jobSite={},
                        nearbyPlayers=[{"uuid": PLAYER, "name": "SyntheticPlayer", "dimension": "minecraft:overworld",
                                        "position": {"x": 1, "y": 70, "z": 3}}], hostilesNearby=0,
                        openCommissions=[])
        elif action == "inbox":
            cursor = args.get("cursor")
            offset = int(cursor or 0)
            if self.inbox_override is not None:
                inbox = self.inbox_override
            else:
                inbox = {"events": self.events[offset:offset + 2], "nextCursor": min(offset + 2, len(self.events))}
            data.update(inbox)
        elif action == "receipt":
            operation_id = args["operationId"]
            value = self.receipts.get(operation_id, {"schemaVersion": 1, "residentId": RESIDENT, "bodyId": BODY,
                                                     "operationId": operation_id, "action": args["operationAction"],
                                                     "status": "unknown", "terminal": False, "retryAllowed": False,
                                                     "observedAt": now_ms(), "data": {}})
            return httpx.Response(200, json=envelope | {"result": {"content": [{"type": "text", "text": json.dumps({"ok": True, "data": value})}]}})
        else:
            rid = args["requestId"]
            assert payload["requestId"] == rid
            if rid not in self.receipts:
                self.writes.append(args)
                self.receipts[rid] = {"schemaVersion": 1, "residentId": RESIDENT, "bodyId": BODY,
                                      "operationId": rid, "action": action, "status": "accepted", "terminal": False,
                                      "retryAllowed": False, "observedAt": now_ms(), "data": {}}
                if action == "walk":
                    self.position = {key: args[key] for key in "xyz"}
            value = dict(self.receipts[rid])
            if self.status_override:
                value["status"] = self.status_override
                value["terminal"] = self.status_override not in {"accepted", "unknown"}
            if action == "walk":
                value.update(status="accepted", terminal=False)
            if self.drop_write:
                self.drop_write = False
                raise httpx.ReadTimeout("injected after the server commit", request=request)
            data.update(value)
        reply = {"ok": True, "data": data}
        envelope["result"] = {"content": [{"type": "text", "text": json.dumps(reply)}]}
        if self.envelope_override:
            envelope.update(self.envelope_override)
        return httpx.Response(200, json=envelope)


def make(server: VillagerServer):
    http = httpx.AsyncClient(transport=httpx.MockTransport(server))
    bridge = NativeVillagerBridge(ENDPOINT, TOKEN, resident_id=RESIDENT, body_id=BODY,
                                  controller_id=CONTROLLER, http=http)
    body = VillagerBody(bridge, scope=SCOPE, server_id="synthetic-server", poll_seconds=0, result_poll_seconds=0)
    return body


def row(**changes):
    value = {"residentId": RESIDENT, "bodyId": BODY, "controllerId": CONTROLLER, "name": "青禾",
             "managed": True, "loaded": True, "profession": "minecraft:farmer"}
    return value | changes


@pytest.mark.parametrize("endpoint", [
    "http://localhost:19128/villager-body", "http://127.0.0.1:19128/maid-body",
    "https://127.0.0.1:19128/villager-body", "http://127.0.0.1:19128/villager-body?x=1",
    "http://user@127.0.0.1:19128/villager-body",
])
def test_villager_transport_is_authenticated_explicit_loopback_only(endpoint):
    with pytest.raises(ValueError, match="loopback"):
        NativeVillagerBridge(endpoint, TOKEN, resident_id=RESIDENT, body_id=BODY, controller_id=CONTROLLER)


@pytest.mark.parametrize("token", ["", " ", "a\nb", "a\rb"])
def test_villager_transport_rejects_empty_or_injected_token(token):
    with pytest.raises(ValueError, match="token"):
        NativeVillagerBridge(ENDPOINT, token, resident_id=RESIDENT, body_id=BODY, controller_id=CONTROLLER)


def test_bridge_roster_bind_generation_fence_and_release(run):
    async def scenario():
        server = VillagerServer()
        server.events = [row()]
        async with httpx.AsyncClient(transport=httpx.MockTransport(server)) as http:
            roster = await NativeVillagerBridge.roster(ENDPOINT, TOKEN, http=http)
            assert roster["villagers"] == [row()]
            bridge = NativeVillagerBridge(ENDPOINT, TOKEN, resident_id=RESIDENT, body_id=BODY,
                                          controller_id=CONTROLLER, http=http)
            await bridge.open()
            await bridge.open()
            assert [call["operation"] for call in server.calls] == ["roster", "bind"]
            assert bridge.tools[0]["name"] == "mc_villager"
            duplicate = NativeVillagerBridge(ENDPOINT, TOKEN, resident_id=RESIDENT, body_id=BODY,
                                             controller_id="20000000-0000-0000-0000-000000000099", http=http)
            with pytest.raises(ControlChanged):
                await duplicate.open()
            server.generation = "server-boot:8"
            with pytest.raises(ControlChanged):
                await bridge.call("mc_villager", {"action": "context"})
            await bridge.close()
            assert bridge.generation is None and not bridge.tools
            assert server.calls[-1]["operation"] == "call"
            assert all(call["operation"] != "release" for call in server.calls)
    run(scenario())


@pytest.mark.parametrize("field", ["residentId", "bodyId", "controllerId", "generation", "protocol"])
def test_wrong_envelope_identity_fences_without_a_call(run, field):
    async def scenario():
        server = VillagerServer()
        server.envelope_override = {field: "wrong" if field == "protocol" else str(uuid4())}
        if field == "generation":
            server.envelope_override = {field: "x" * 257}
        body = make(server)
        with pytest.raises(ControlChanged):
            await body.spawn()
        assert not any(call["operation"] == "call" for call in server.calls)
    run(scenario())


def test_unknown_write_is_queried_by_original_id_and_never_replayed(run):
    async def scenario():
        server = VillagerServer()
        body = make(server)
        await body.spawn()
        try:
            server.drop_write = True
            action = BodyAction(verb="move", args={"x": 4, "y": 70, "z": 5}, request_id="original_walk_1")
            unknown = await body.act(action)
            assert unknown.status == "unknown" and not unknown.terminal and not unknown.retry_allowed
            assert await body.act(action) == unknown
            assert len(server.writes) == 1
            server.receipts["original_walk_1"].update(status="completed", terminal=True, goalCompleted=True,
                                                      data={"position": {"x": 4, "y": 70, "z": 5}})
            completed = await body.result("original_walk_1")
            assert completed.status == "completed" and completed.terminal
            assert len(server.writes) == 1
            assert server.calls[-1]["arguments"] == {"action": "receipt", "operationId": "original_walk_1", "operationAction": "walk"}
        finally:
            await body.destroy()
    run(scenario())


def test_wrong_receipt_cannot_settle_unknown_write(run):
    async def scenario():
        server = VillagerServer()
        body = make(server)
        await body.spawn()
        try:
            server.drop_write = True
            await body.act(BodyAction(verb="stop", request_id="original_stop_1"))
            server.receipts["original_stop_1"].update(status="completed", terminal=True)
            original = server.receipts["original_stop_1"]
            for changes in ({"bodyId": str(uuid4())}, {"operationId": "other"}, {"retryAllowed": True},
                            {"terminal": False}, {"schemaVersion": 2}, {"action": "walk"}):
                server.receipts["original_stop_1"] = original | changes
                result = await body.result("original_stop_1")
                assert result.status == "unknown" and not result.terminal
            server.receipts["original_stop_1"] = original
            assert (await body.result("original_stop_1")).status == "completed"
            assert len(server.writes) == 1
        finally:
            await body.destroy()
    run(scenario())


def test_connect_failure_is_not_dispatched_and_reads_do_not_create_writes(run):
    async def scenario():
        server = VillagerServer()
        body = make(server)
        original = body.bridge.http
        disconnected = httpx.AsyncClient(transport=httpx.MockTransport(
            lambda request: (_ for _ in ()).throw(httpx.ConnectError("no listener", request=request))))
        body.bridge.http = disconnected
        with pytest.raises(httpx.ConnectError):
            await body.spawn()
        await disconnected.aclose()
        replacement = make(server)
        body.bridge = replacement.bridge
        await body.spawn()
        try:
            disconnected = httpx.AsyncClient(transport=httpx.MockTransport(
                lambda request: (_ for _ in ()).throw(httpx.ConnectError("no listener", request=request))))
            body.bridge.http = disconnected
            result = await body.act(BodyAction(verb="stop", request_id="not_dispatched_1"))
            assert result.status == "rejected" and result.terminal
            assert not server.writes
        finally:
            body.bridge.http = original
            await body.destroy()
    run(scenario())


def test_cursor_events_are_deduplicated_and_malformed_page_does_not_advance(run):
    async def scenario():
        server = VillagerServer()
        server.events = [
            {"sequence": 1, "eventId": "event-1", "residentId": RESIDENT, "bodyId": BODY, "listenerId": BODY,
             "speakerId": PLAYER, "speaker": "SyntheticPlayer", "text": "你好",
             "channel": "chat", "deliveryScope": "nearby", "occurredAt": now_ms(), "world": "world"},
            {"sequence": 2, "eventId": "event-2", "residentId": RESIDENT, "bodyId": BODY, "listenerId": BODY,
             "speakerId": PLAYER, "speaker": "SyntheticPlayer", "text": "还在吗",
             "channel": "chat", "deliveryScope": "nearby", "occurredAt": now_ms(), "world": "world"},
            {"sequence": 3, "eventId": "event-3", "residentId": RESIDENT, "bodyId": BODY, "listenerId": BODY,
             "speakerId": PLAYER, "speaker": "SyntheticPlayer", "text": "再来",
             "channel": "chat", "deliveryScope": "nearby", "occurredAt": now_ms(), "world": "world"},
        ]
        body = make(server)
        events = []
        unsubscribe = body.subscribe(events.append)
        try:
            await body.spawn()
            assert await body.poll_once() == 2 and body.cursor == 2
            assert await body.poll_once() == 1 and body.cursor == 3
            assert await body.poll_once() == 0
            assert [event.data["eventId"] for event in events if event.kind == "dialogue"] == ["event-1", "event-2", "event-3"]
            assert all(event.data["serverAttributed"] is True and event.data["trusted"] is False for event in events if event.kind == "dialogue")
            original = server.events
            server.inbox_override = {"events": [{"bad": True}]}
            with pytest.raises(RuntimeError, match="inbox_invalid_page"):
                await body.poll_once()
            assert body.cursor == 3
            server.inbox_override = None
            server.events = original
        finally:
            unsubscribe()
            await body.destroy()
    run(scenario())


def test_snapshot_reads_context_and_destroy_releases_without_entity_delete(run):
    async def scenario():
        server = VillagerServer()
        body = make(server)
        await body.spawn()
        snapshot = await body.snapshot()
        assert snapshot.life_state == "alive" and snapshot.position == {"x": 1.0, "y": 70.0, "z": 2.0}
        assert snapshot.raw["profession"] == "minecraft:farmer" and snapshot.dimension == "minecraft:overworld"
        assert body.identity().owner_id != PLAYER and body.identity().owner_id != BODY
        assert set(body.capabilities().actions) == {"observe", "chat", "move", "stop"}
        assert body.capabilities().lifecycle.spawn == "bind-existing"
        await body.destroy()
        assert server.leased is False and server.calls[-1]["operation"] == "release"
        assert not any(call["operation"] in {"delete", "remove", "spawn"} for call in server.calls)
    run(scenario())


def test_chat_binds_newest_fresh_original_event_and_listener(run):
    async def scenario():
        server = VillagerServer()
        server.events = [
            {"sequence": 1, "eventId": "old-event", "residentId": RESIDENT, "bodyId": BODY, "listenerId": BODY,
             "speakerId": PLAYER, "text": "旧话", "occurredAt": now_ms() - 10_000,
             "channel": "chat", "deliveryScope": "nearby", "world": "world"},
            {"sequence": 2, "eventId": "new-event", "residentId": RESIDENT, "bodyId": BODY, "listenerId": BODY,
             "speakerId": OTHER_PLAYER, "text": "你好", "occurredAt": now_ms(),
             "channel": "chat", "deliveryScope": "nearby", "world": "world"},
        ]
        body = make(server)
        await body.spawn()
        try:
            result = await body.act(BodyAction(verb="chat", args={"text": "你好，旅人。"}, request_id="fresh_reply_1"))
            assert result.status == "accepted", result.text
            assert server.writes[-1] == {"action": "speak", "text": "你好，旅人。", "eventId": "new-event",
                                         "listenerId": OTHER_PLAYER, "requestId": "fresh_reply_1"}
            new_server_event = {"sequence": 3, "eventId": "newer-event", "residentId": RESIDENT, "bodyId": BODY,
                                "listenerId": BODY, "speakerId": PLAYER, "text": "更新", "occurredAt": now_ms()}
            server.events = [new_server_event]
            repeated = await body.act(BodyAction(verb="chat", args={"text": "你好，旅人。"}, request_id="fresh_reply_1"))
            assert repeated == result
            assert len(server.writes) == 1
        finally:
            await body.destroy()
    run(scenario())


@pytest.mark.parametrize("events", [[], [
    {"sequence": 1, "eventId": "stale", "residentId": RESIDENT, "bodyId": BODY, "listenerId": BODY,
     "speakerId": PLAYER, "text": "过期", "occurredAt": now_ms() - 200_000,
     "channel": "chat", "deliveryScope": "nearby", "world": "world"},
]])
def test_chat_without_fresh_original_is_proactive_not_an_invented_reply(run, events):
    async def scenario():
        server = VillagerServer()
        server.events = events
        body = make(server)
        await body.spawn()
        try:
            result = await body.act(BodyAction(verb="chat", args={"text": "今天天气不错。"}, request_id="proactive_1"))
            assert result.status == "accepted"
            assert server.writes[-1] == {"action": "speak", "text": "今天天气不错。", "requestId": "proactive_1"}
        finally:
            await body.destroy()
    run(scenario())


@pytest.mark.parametrize("args", [
    {"text": "/op someone"}, {"text": "§red"}, {"text": "line\nbreak"}, {"text": ""},
    {"text": "你好", "eventId": "one"}, {"text": "你好", "listenerId": PLAYER},
    {"text": "你好", "listenerId": "not-a-uuid"}, {"text": "你好", "residentId": "other"},
])
def test_chat_and_identity_arguments_are_rejected_before_send(run, args):
    async def scenario():
        server = VillagerServer()
        body = make(server)
        await body.spawn()
        try:
            result = await body.act(BodyAction(verb="chat", args=args, request_id="bad_chat_1"))
            assert result.status == "rejected" and result.terminal
            assert not server.writes
        finally:
            await body.destroy()
    run(scenario())


def test_walk_accepted_then_receipt_completion_and_stop_mapping(run):
    async def scenario():
        server = VillagerServer()
        body = make(server)
        await body.spawn()
        try:
            accepted = await body.act(BodyAction(verb="move", args={"x": 5, "y": 70, "z": 6}, request_id="walk_accept_1"))
            assert accepted.status == "accepted" and not accepted.terminal
            assert server.writes[-1]["action"] == "walk"
            server.receipts["walk_accept_1"].update(status="completed", terminal=True, goalCompleted=True)
            completed = await body.result("walk_accept_1")
            assert completed.status == "completed" and completed.terminal
            stopped = await body.stop()
            assert stopped.verb == "stop" and stopped.status == "accepted"
            assert server.writes[-1]["action"] == "stop"
        finally:
            await body.destroy()
    run(scenario())


def test_villager_roles_are_stable_managed_only_and_never_player_owned():
    original = row(persona="住在村边，说话慢条斯理。")
    ignored = row(residentId="wild", bodyId=str(uuid4()), controllerId=str(uuid4()), managed=False)
    roles, controllers = parse_villager_roster({"protocol": PROTOCOL, "villagers": [original, ignored]},
                                               "server-a", {"model": "fixture", "provider": "tokenplan", "intervalSeconds": 45})
    assert len(roles) == 1 and controllers[next(iter(roles))] == CONTROLLER
    role = next(iter(roles.values()))
    renamed = next(iter(parse_villager_roster({"protocol": PROTOCOL, "villagers": [original | {"name": "青禾二号"}]},
                                              "server-a", {"model": "fixture"})[0].values()))
    assert role.id == renamed.id and role.character_id == renamed.character_id and role.body_id == renamed.body_id
    assert role.owner_id != BODY and role.owner_id != PLAYER
    assert role.allowed_tools == VILLAGER_TOOLS
    assert "住在村边" in role.persona and "不能执行命令、Lua" in role.persona
    other_server = next(iter(parse_villager_roster({"protocol": PROTOCOL, "villagers": [original]},
                                                   "server-b", {"model": "fixture"})[0].values()))
    assert other_server.owner_id != role.owner_id
    empty, empty_controllers = parse_villager_roster({"protocol": PROTOCOL, "villagers": []}, "server-a", {"model": "fixture"})
    assert empty == {} and empty_controllers == {}


@pytest.mark.parametrize("rows", [
    [row(), row()],
    [row(), row(bodyId=str(uuid4()))],
    [row(), row(controllerId=str(uuid4()))],
    [row(bodyId="not-uuid")], [row(controllerId="not-uuid")], [row(residentId="../other")],
    [row(name="")], [row(profession="")], [row(managed="true")],
])
def test_unsafe_or_duplicate_managed_roster_fails_closed(rows):
    with pytest.raises(ValueError, match="villager_roster"):
        parse_villager_roster({"protocol": PROTOCOL, "villagers": rows}, "server-a", {"model": "fixture"})


def test_nested_native_errors_fence_or_reject_before_dispatch(run):
    async def scenario():
        for code, expected in (("controller_conflict", ControlChanged), ("generation_mismatch", ControlChanged),
                               ("lease_expired", ControlChanged), ("body_unavailable", VillagerRequestRejected),
                               ("request_id_conflict", VillagerRequestRejected)):
            def handler(request, code=code):
                return httpx.Response(409, json={"protocol": PROTOCOL, "error": {"code": code, "message": code}})
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
                bridge = NativeVillagerBridge(ENDPOINT, TOKEN, resident_id=RESIDENT, body_id=BODY,
                                              controller_id=CONTROLLER, http=http)
                with pytest.raises(expected):
                    await bridge.open()
    run(scenario())


def test_restart_restores_original_write_for_receipt_query_without_replay(run):
    async def scenario():
        server = VillagerServer()
        body = make(server)
        await body.spawn()
        action = BodyAction(verb="move", args={"x": 4, "y": 70, "z": 5}, request_id="restart_walk_1")
        server.drop_write = True
        assert (await body.act(action)).status == "unknown"
        await body.destroy()
        server.receipts[action.request_id].update(status="completed", terminal=True, goalCompleted=True)
        restarted = make(server)
        await restarted.spawn()
        try:
            restarted.restore_request(action)
            result = await restarted.result(action.request_id)
            assert result.status == "completed" and result.terminal
            assert len(server.writes) == 1
        finally:
            await restarted.destroy()
    run(scenario())


def test_unloaded_managed_villager_is_not_attached_and_resident_id_round_trips():
    roles, _ = parse_villager_roster({"protocol": PROTOCOL, "villagers": [row(loaded=False)]},
                                    "server-a", {"model": "fixture"})
    assert roles == {}
    role_id = "villager_" + b32encode(RESIDENT.encode()).decode().rstrip("=").lower()
    assert villager_resident_id(role_id) == RESIDENT


def test_consumed_dialogue_keeps_exact_reply_target(run):
    async def scenario():
        server = VillagerServer()
        server.events = [{"sequence": 1, "eventId": "consumed-event", "residentId": RESIDENT, "bodyId": BODY,
                          "listenerId": BODY, "speakerId": PLAYER, "text": "你好", "occurredAt": now_ms(),
                          "channel": "chat", "deliveryScope": "nearby", "world": "world"}]
        body = make(server)
        await body.spawn()
        try:
            assert await body.poll_once() == 1
            result = await body.act(BodyAction(verb="chat", args={"text": "我听见了。", "eventId": "consumed-event",
                                                                  "listenerId": PLAYER}, request_id="consumed_reply_1"))
            assert result.status == "accepted"
            assert server.writes[-1]["eventId"] == "consumed-event"
            assert server.writes[-1]["listenerId"] == PLAYER
        finally:
            await body.destroy()
    run(scenario())


def test_private_and_addressed_villager_events_are_recognized():
    from agent_mc_harness.models import BodyEvent
    base = {"eventId": "addressed_chat_" + str(uuid4()) + "_" + BODY, "bodyId": BODY, "listenerId": BODY,
            "residentId": RESIDENT, "speakerId": PLAYER, "serverAttributed": True, "occurredAt": now_ms()}
    event = BodyEvent(kind="dialogue", body_kind="villager", body_id=BODY, text="你好", data=base | {"deliveryScope": "private"})
    assert addressed_dialogue(event, BODY, ("QA Villager",))
    assert addressed_dialogue(event.model_copy(update={"data": base | {"deliveryScope": "nearby"}}), BODY)
    assert not addressed_dialogue(event.model_copy(update={"data": base | {"listenerId": OTHER_PLAYER}}), BODY)


def test_terminal_speech_refreshes_original_voice_status_without_replay(run):
    async def scenario():
        server = VillagerServer()
        body = make(server)
        await body.spawn()
        try:
            action = BodyAction(verb="chat", args={"text": "你好。"}, request_id="voice_status_1")
            await body.act(action)
            server.receipts[action.request_id].update(status="completed", terminal=True,
                                                      voiceStatus={"state": "sent", "requestId": "voice-request"})
            refreshed = await body.result(action.request_id)
            assert refreshed.status == "completed"
            assert refreshed.data["reply"]["data"]["voiceStatus"]["state"] == "sent"
            assert len(server.writes) == 1
        finally:
            await body.destroy()
    run(scenario())


def test_villager_discovery_checks_existing_resident_host_role():
    role = SimpleNamespace(id="villager_existing", body_id=BODY)
    resident = SimpleNamespace(host=SimpleNamespace(role=role))
    assert villager_identity_already_bound(role, [], {}, {"existing": resident})
    assert not villager_identity_already_bound(SimpleNamespace(id="villager_new", body_id=str(uuid4())), [], {}, {"existing": resident})


def test_villager_profile_keeps_maid_numen_guards_and_four_tool_limit():
    base = {"id": "qa_villager", "name": "青禾", "character_id": str(uuid4()), "owner_id": str(uuid4()),
            "body_id": BODY, "body_kind": "villager", "provider": "tokenplan", "model": "fixture",
            "persona": "村民人设", "allowed_tools": VILLAGER_TOOLS}
    assert NpcRole(**base).body_kind == "villager"
    for tools in (["body:observe"], VILLAGER_TOOLS + ["body:observe"], VILLAGER_TOOLS + ["body:attack"],
                  ["body:command"], ["body:native:lua"]):
        with pytest.raises(ValueError):
            NpcRole(**(base | {"allowed_tools": tools}))
    for kind in ("maid", "numen"):
        with pytest.raises(ValueError, match="independent_owner"):
            NpcRole(**(base | {"body_kind": kind, "owner_id": BODY}))
        with pytest.raises(ValueError, match="default_guard"):
            NpcRole(**(base | {"body_kind": kind, "allowed_tools": ["body:observe"], "default_native_guard": True}))


def test_host_ignores_stale_or_unattributed_villager_dialogue(tmp_path):
    roles, _ = parse_villager_roster({"protocol": PROTOCOL, "villagers": [row()]}, "server-a", {"model": "fixture"})
    role = next(iter(roles.values()))
    body = SimpleNamespace(kind="villager", subscribe=lambda listener: (lambda: None))
    host = NpcHost(role, body, lambda *_: None, None, SimpleNamespace())
    event = {"eventId": "event-original", "speakerId": PLAYER, "bodyId": BODY,
             "serverAttributed": True, "occurredAt": now_ms()}
    from agent_mc_harness.models import BodyEvent
    host._event(BodyEvent(kind="dialogue", body_kind="villager", body_id=BODY, text="你好", data=event))
    assert "event-original" in host.pending_dialogue
    for changes in ({"occurredAt": now_ms() - 200_000}, {"speakerId": "not-attributed"}, {"bodyId": str(uuid4())}):
        host._event(BodyEvent(kind="dialogue", body_kind="villager", body_id=BODY, text="忽略", data=event | changes | {"eventId": "bad-" + str(uuid4())}))
    assert list(host.pending_dialogue) == ["event-original"]

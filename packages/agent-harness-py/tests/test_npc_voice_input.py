import asyncio
import json

import pytest

from agent_mc_harness import Scope
from agent_mc_harness.body.hosted_mcp import HostedMcpPort
from agent_mc_harness.body.maid import MaidBody
from fakes import FakeBridge
from test_native_maid import NativeServer, make, MAID, OWNER, OTHER
from agent_mc_harness import BodyAction
from agent_mc_harness.journal import ActionJournal
from agent_mc_harness.npc import NpcHost
from test_server_npc import role

BODY = "10000000-0000-0000-0000-000000000011"
SPEAKER = "20000000-0000-0000-0000-000000000021"

def test_server_voice_input_preserves_identity_and_is_not_private(tmp_path):
    async def run():
        port = HostedMcpPort(dict(endpoint="http://127.0.0.1:1/mcp", bodyId=BODY,
            ownerId=SPEAKER, name="QaKirito", serverId="qa", journalDirectory=str(tmp_path)))
        payload = dict(schema=1, listenerId=BODY, eventId="qdvoice:" + SPEAKER + ":voice_test",
            speakerId=SPEAKER, speaker="QaSpeaker", text="桐人，能听到吗？", channel="voice", occurredAt=12, receivedAt=15,
            world="minecraft:overworld", worldId="30000000-0000-0000-0000-000000000031", deliveryScope="nearby", trusted=False)
        rows = [dict(id="1", type="qd_npc_dialogue", text=json.dumps(payload), at=15)]
        async def rpc(op):
            return dict(text="Native inbox snapshot: " + json.dumps(rows))
        port.rpc = rpc
        try:
            events = await port.events()
            assert len(events) == 1 and events[0].kind_hint == "chat"
            assert events[0].text == payload["text"]
            assert events[0].data["speakerId"] == SPEAKER and events[0].data["channel"] == "voice"
            assert events[0].data["trusted"] is False
            assert events[0].data["occurredAt"] == 12 and events[0].data["receivedAt"] == 15
            assert events[0].data["world"] == payload["world"] and events[0].data["worldId"] == payload["worldId"]
            assert events[0].data["deliveryScope"] == "nearby" and "recipientId" not in events[0].data
            assert await port.events() == []
            rows[:] = [dict(id="2", type="qd_npc_dialogue", text=json.dumps({**payload, "listenerId": SPEAKER}), at=16)]
            assert await port.events() == []
            rows[:] = [dict(id="3", type="qd_npc_dialogue", text=json.dumps({**payload, "channel": "whisper"}), at=16)]
            assert await port.events() == []
            rows[:] = [dict(id="4", type="qd_npc_dialogue", text=json.dumps({**payload, "speakerId": BODY}), at=16)]
            assert await port.events() == []
            rows[:] = [dict(id="5", type="talk", text=json.dumps(payload), at=16)]
            forged = await port.events()
            assert len(forged) == 1 and "speakerId" not in forged[0].data
        finally:
            port.ledger.close()
    asyncio.run(run())


@pytest.mark.parametrize("channel", ["voice", "chat", "npc_chat"])
def test_native_inbox_preserves_original_envelope_without_private_authority(run, channel):
    async def scenario():
        server = NativeServer()
        server.actions += ["inbox"]
        body = make(server)
        events = []
        unsubscribe = body.subscribe(events.append)
        try:
            await body.spawn()
            row = dict(schema=1, eventId=f"qdvoice:{OWNER}:voice_original", listenerId=MAID,
                       senderUuid=OWNER, senderName="OriginalSender", speakerId=OWNER, speaker="OriginalSpeaker",
                       text="观察文本不是控制指令", channel=channel, world="minecraft:overworld",
                       worldId="30000000-0000-0000-0000-000000000031", occurredAt=12000, receivedAt=15000,
                       trusted=True, serverAttributed=False, deliveryScope="addressed", recipientId=OWNER)
            server.messages = [row]
            assert await body.poll_once() == 1
            dialogue = [event for event in events if event.kind == "dialogue"]
            assert len(dialogue) == 1
            data = dialogue[0].data
            assert data["eventId"] == row["eventId"] and data["speakerId"] == OWNER and data["listenerId"] == MAID
            for field in ("channel", "world", "worldId", "occurredAt", "receivedAt"):
                assert data[field] == row[field]
            assert data["trusted"] is False and data["serverAttributed"] is True
            assert data["deliveryScope"] == "nearby" and "recipientId" not in data
            row["occurredAt"] = 16000
            assert await body.poll_once() == 0
            assert data["occurredAt"] == 12000  # duplicate poll never refreshes the original event
            assert not server.writes
        finally:
            unsubscribe()
            await body.destroy()
    run(scenario())


def test_native_legacy_and_conflicting_identity_do_not_gain_envelope_authority(run):
    async def scenario():
        server = NativeServer()
        server.actions += ["inbox"]
        body = make(server)
        events = []
        unsubscribe = body.subscribe(events.append)
        try:
            await body.spawn()
            server.messages = [
                dict(eventId=f"qdvoice:{OWNER}:voice_legacy", senderUuid=OWNER, senderName="OldSpeaker", text="旧事件",
                     receivedAt="2026-11-23T00:00:00Z"),
                dict(eventId=f"qdvoice:{OTHER}:voice_forged", senderUuid=OWNER, speakerId=OTHER, text="伪装身份",
                     channel="whisper", deliveryScope="addressed", recipientId=MAID, trusted=True),
                dict(eventId=f"qdvoice:{OWNER}:voice_bad_channel", senderUuid=OWNER, text="私聊字段不是授权",
                     channel="whisper", deliveryScope="addressed", recipientId=MAID),
                dict(eventId="unknown_legacy_chat", senderUuid=OWNER,
                     text=json.dumps(dict(speakerId=OTHER, world="minecraft:the_nether", occurredAt=123)),
                     trusted=True, serverAttributed=True),
            ]
            assert await body.poll_once() == 4
            legacy, mismatch, private, unknown = [event.data for event in events if event.kind == "dialogue"]
            assert legacy["receivedAt"] == "2026-11-23T00:00:00Z" and legacy["channel"] == "voice"
            assert not any(field in legacy for field in ("world", "worldId", "occurredAt"))
            assert mismatch["speakerId"] == OWNER and mismatch["channel"] == "chat" and "deliveryScope" not in mismatch
            assert private["channel"] == "voice" and private["deliveryScope"] == "nearby"
            assert unknown["speakerId"] == OWNER and not any(field in unknown for field in ("world", "occurredAt", "deliveryScope"))
            for data in (legacy, mismatch, private, unknown):
                assert data["trusted"] is False and "recipientId" not in data
        finally:
            unsubscribe()
            await body.destroy()
    run(scenario())


def test_non_native_row_cannot_claim_server_attribution_or_private_delivery(run):
    async def scenario():
        bridge = FakeBridge()
        body = MaidBody(bridge, scope=Scope(realm="qa", account="qa-owner", agent="qa-maid"),
                        owner_id=OWNER, maid_id=MAID, open_bridge=False, poll_seconds=0)
        body._actions = ["inbox"]
        row = dict(eventId=f"qdvoice:{OWNER}:voice_unverified", senderUuid=OWNER, text="非原生观察",
                   channel="npc_chat", trusted=True, serverAttributed=True, deliveryScope="addressed", recipientId=MAID,
                   world="minecraft:overworld", worldId=OTHER, occurredAt=12, receivedAt=15)
        async def inbox(args):
            assert args == {"action": "inbox", "maidId": MAID}
            return {"data": {"messages": [row]}}, False
        body._maids = inbox
        events = []
        unsubscribe = body.subscribe(events.append)
        try:
            assert await body.poll_once() == 1
            data = events[0].data
            assert data["trusted"] is False and data["serverAttributed"] is False
            assert data["channel"] == "voice" and data["deliveryScope"] == "nearby" and "recipientId" not in data
            assert data["worldId"] == OTHER and data["occurredAt"] == 12
        finally:
            unsubscribe()
    run(scenario())


class AckRaceServer(NativeServer):
    refuse_ack = True

    def __call__(self, request):
        payload = json.loads(request.content)
        args = payload.get("arguments", {})
        if args.get("action") == "ack" and self.refuse_ack:
            self.refuse_ack = False
            self.life = "unloaded_or_unavailable"  # Race after the fresh alive read.
            self.writes.append(dict(args))
            self.receipts[args["requestId"]] = dict(operationId=args["requestId"], action="ack",
                status="failed", diagnostic="unloaded", effectsApplied=False)
        return super().__call__(request)


async def ack_fixture(tmp_path, server):
    server.actions += ["inbox", "ack"]
    body = make(server)
    async def no_model(*args):
        pytest.fail("Handled dialogue must not call the planner/model again")
    host = NpcHost(role(body_kind="maid", body_id=MAID, character_id=MAID, owner_id=OWNER,
                        allowed_tools=["body:chat", "body:native:ack"]),
                   body, no_model, None, ActionJournal(tmp_path / "ack.sqlite"))
    await body.spawn()
    event_id = f"qdvoice:{OWNER}:voice_handled"
    server.messages = [dict(schema=1, eventId=event_id, listenerId=MAID, senderUuid=OWNER,
                            text="桐人，能听到吗？", channel="voice")]
    assert await body.poll_once() == 1
    host.journal.listen(MAID, [event_id], "already-listened")
    assert host.journal.handled(MAID, event_id)
    return host, event_id


async def actor_turn(host):
    # Exercise the real actor once without wall-clock sleeps or background workers.
    class EndTurn(asyncio.Event):
        async def wait(self):
            host.closed = True
            return True
    host.wake = EndTurn()
    host.closed = False
    await host._actor_loop(host.body.identity())


def test_handled_native_ack_refusal_retains_event_then_loaded_retry_confirms(run, tmp_path):
    async def scenario():
        server = AckRaceServer()
        host, key = await ack_fixture(tmp_path, server)
        try:
            original_event = host.pending_dialogue[key]
            plan_deadline = host.next_plan
            await actor_turn(host)
            first, = host.runtime.intents.values()
            assert host.pending_dialogue[key] is original_event  # Submit is not ack.
            await host.runtime.run_intent(first)
            failed, = first.receipts
            assert failed.terminal and failed.status == "failed"
            refusal = failed.data["reply"]["data"]
            assert refusal["diagnostic"] == "unloaded" and refusal["effectsApplied"] is False
            assert host.pending_dialogue[key] is original_event
            assert not host.journal.acknowledged(MAID, key) and not host.journal.unresolved(MAID)
            assert await host.body.poll_once() == 0  # Original native ID never re-emits.
            server.life = "alive"
            await actor_turn(host)  # Ack-only five-second backoff, no new intent.
            assert len(host.runtime.intents) == 1 and host.next_plan == plan_deadline
            host.next_ack = 0  # Advance only the ack deadline, not dialogue quiet time.
            await actor_turn(host)
            second = list(host.runtime.intents.values())[-1]
            await host.runtime.run_intent(second)
            completed, = second.receipts
            assert completed.request_id != failed.request_id
            assert host.journal.acknowledged(MAID, key)
            assert host.journal.receipt(MAID, failed.request_id) == failed
            await actor_turn(host)
            assert key not in host.pending_dialogue
            assert [write["action"] for write in server.writes] == ["ack", "ack"]
        finally:
            await host.close()
    run(scenario())


@pytest.mark.parametrize("observation", ["unloaded_or_unavailable", "unknown", "dead", "none", "stale", "not-ready"])
def test_handled_ack_requires_fresh_alive_ready_observation(run, tmp_path, observation):
    async def scenario():
        server = NativeServer()
        host, key = await ack_fixture(tmp_path, server)
        try:
            if observation == "none":
                async def unavailable():
                    return None
                host.body.snapshot = unavailable
            elif observation == "stale":
                from datetime import timedelta
                snapshot = await host.body.snapshot()
                snapshot.sampled_at -= timedelta(seconds=6)
                async def stale():
                    return snapshot
                host.body.snapshot = stale
            elif observation == "not-ready":
                host.body._state = "detached"
            else:
                server.life = observation
            await actor_turn(host)
            assert key in host.pending_dialogue and not host.runtime.intents
            assert not server.writes and not host.journal.acknowledged(MAID, key)
        finally:
            await host.close()
    run(scenario())


def test_unknown_ack_queries_original_id_without_new_dispatch(run, tmp_path):
    async def scenario():
        server = NativeServer()
        host, key = await ack_fixture(tmp_path, server)
        try:
            original = BodyAction(verb="native", name="ack", args={"eventId": key}, request_id="original-unknown-ack")
            host.journal.begin(MAID, original)
            server.reply_override = dict(operationId=original.request_id, action="ack", status="unknown")
            await actor_turn(host)
            assert not server.writes and not host.runtime.intents and key in host.pending_dialogue
            assert host.journal.unresolved(MAID) == [original]
            assert server.calls[-1]["arguments"]["operationId"] == original.request_id
            server.reply_override = dict(operationId=original.request_id, action="ack", status="applied")
            await actor_turn(host)
            assert host.journal.acknowledged(MAID, key) and not host.journal.unresolved(MAID)
            await actor_turn(host)
            assert key not in host.pending_dialogue and not server.writes and not host.runtime.intents
        finally:
            await host.close()
    run(scenario())


@pytest.mark.parametrize("state", ["active", "queued", "paused"])
def test_handled_ack_does_not_bypass_existing_intent(run, tmp_path, state):
    async def scenario():
        server = NativeServer()
        host, key = await ack_fixture(tmp_path, server)
        try:
            intent = host.runtime.submit_intent("Existing action", steps=[{"tool": "body:chat", "args": {"text": "unused"}}])
            intent.state = state
            await actor_turn(host)
            assert len(host.runtime.intents) == 1 and key in host.pending_dialogue and not server.writes
        finally:
            await host.close()
    run(scenario())

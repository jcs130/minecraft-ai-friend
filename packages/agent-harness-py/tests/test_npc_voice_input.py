import asyncio
import json

import pytest

from agent_mc_harness import Scope
from agent_mc_harness.body.hosted_mcp import HostedMcpPort
from agent_mc_harness.body.maid import MaidBody
from fakes import FakeBridge
from test_native_maid import NativeServer, make, MAID, OWNER, OTHER

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

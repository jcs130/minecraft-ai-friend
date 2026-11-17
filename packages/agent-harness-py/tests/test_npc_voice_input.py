import asyncio
import json
from agent_mc_harness.body.hosted_mcp import HostedMcpPort

BODY = "10000000-0000-0000-0000-000000000011"
SPEAKER = "20000000-0000-0000-0000-000000000021"

def test_server_voice_input_preserves_identity_and_is_not_private(tmp_path):
    async def run():
        port = HostedMcpPort(dict(endpoint="http://127.0.0.1:1/mcp", bodyId=BODY,
            ownerId=SPEAKER, name="QaKirito", serverId="qa", journalDirectory=str(tmp_path)))
        payload = dict(schema=1, listenerId=BODY, eventId="qdvoice:" + SPEAKER + ":voice_test",
            speakerId=SPEAKER, speaker="QaSpeaker", text="桐人，能听到吗？", channel="voice", occurredAt=12, receivedAt=15)
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

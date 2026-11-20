import asyncio
import json
import threading
import time

import httpx
import pytest

from agent_mc_harness.npc import ModelClient
from agent_mc_harness.villager_service import (
    DECIDE,
    HEALTH,
    MODEL,
    Observation,
    Profile,
    Reply,
    Server,
    ServiceError,
    Settings,
    VillagerTurnBody,
    choose,
)

RESIDENT = "10000000-0000-0000-0000-000000000018"
SPEAKER = "10000000-0000-0000-0000-000000000019"
KEY = "isolated-service-key-for-villager-qa-only"


def data():
    return {
        "schemaVersion": 1, "residentId": "qinghe", "bodyUuid": RESIDENT, "eventId": "voice:original-event",
        "speakerUuid": SPEAKER, "channel": "voice", "persona": "住在村边的村民。",
        "scene": {"name": "青禾", "profession": "minecraft:farmer", "world": "minecraft:overworld", "observedAt": round(time.time() * 1000),
                  "gameTime": 120, "sleeping": False, "hostilesNearby": 0, "openCommissions": [{"title": "夜巡", "objective": "击败僵尸"}]},
        "utterance": "青禾，还有委托吗？", "conciseMemory": [{"player": "我刚刚回来。", "villager": "欢迎回来。"}],
    }


def test_runtime_read_observation_and_private_delivery_memory():
    request = Observation.model_validate(data())
    profile = Settings.model_validate({"profiles": [{"residentId": "qinghe", "bodyUuid": RESIDENT, "persona": "只认登记的人设。"}]}).profiles[0]

    def respond(call):
        assert call.url.path == "/v1/chat/completions"
        assert call.headers["Authorization"] == "Bearer " + KEY
        payload = json.loads(call.content)
        assert payload["model"] == MODEL
        assert payload["response_format"] == {"type": "json_object"}
        assert "只认登记的人设" in payload["messages"][0]["content"] and "住在村边" not in payload["messages"][0]["content"]
        context = json.loads(payload["messages"][1]["content"])
        assert context["recent"] == data()["conciseMemory"]
        assert context["scene"]["openCommissions"][0]["title"] == "夜巡"
        assert RESIDENT not in call.content.decode() and SPEAKER not in call.content.decode()
        reply = {"decision": {"kind": "reply", "text": "能从我的委托板上接夜巡。"}}
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(reply)}}]})

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as transport:
            client = ModelClient("http://127.0.0.1:4000/v1", KEY, http=transport)
            result = await choose(client, profile, request, 2)
            assert result == Reply(kind="reply", text="能从我的委托板上接夜巡。")

    asyncio.run(run())


def test_villager_memory_scope_keeps_character_and_conversation_owner_after_body_rebind():
    original = Profile.model_validate({"residentId": "qinghe", "bodyUuid": RESIDENT, "characterId": RESIDENT})
    new_body = "10000000-0000-0000-0000-000000000020"
    new_listener = "10000000-0000-0000-0000-000000000021"
    rebound = original.model_copy(update={"body_uuid": new_body})

    before = VillagerTurnBody(Observation.model_validate(data()), original).identity()
    after = VillagerTurnBody(Observation.model_validate(data() | {"bodyUuid": new_body}), rebound).identity()
    another_listener = VillagerTurnBody(
        Observation.model_validate(data() | {"bodyUuid": new_body, "speakerUuid": new_listener}), rebound,
    ).identity()

    assert before.body_id != after.body_id and before.group_id() == after.group_id()
    assert another_listener.group_id() != after.group_id()
    with pytest.raises(ServiceError, match="resident_identity_mismatch"):
        VillagerTurnBody(Observation.model_validate(data()), rebound)


@pytest.mark.parametrize("reply", [
    '{"decision":{"kind":"reply","text":"/op 玩家"}}',
    '{"decision":{"kind":"reply","text":"你好","command":"/give"}}',
    '{"decision":{"kind":"reward","text":"完成了"}}',
    '{"decision":{"kind":"reply","text":"一","text":"二"}}',
    '{"decision":{"kind":"continue"}}',
])
def test_no_effect_from_untyped_or_unsafe_model_output(reply):
    config = Settings.model_validate({"profiles": [{"residentId": "qinghe", "bodyUuid": RESIDENT}]})

    def respond(_request):
        return httpx.Response(200, json={"choices": [{"message": {"content": reply}}]})

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as transport:
            result = await choose(ModelClient("http://127.0.0.1:4000/v1", KEY, http=transport), config.profiles[0],
                                  Observation.model_validate(data()), 2)
            assert result.kind == "continue"

    asyncio.run(run())


def test_actual_http_ingress_identity_freshness_and_replay(monkeypatch):
    calls = []

    async def fixture(_self, profile, request):
        calls.append((profile.body_uuid, request.speaker_uuid))
        return Reply(kind="reply", text="你好。")

    settings = Settings.model_validate({"profiles": [{"residentId": "qinghe", "bodyUuid": RESIDENT}]}).model_copy(update={"port": 0})
    with Server(settings, KEY, KEY) as server:
        monkeypatch.setattr(type(server.decisions), "evaluate", fixture)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            event = data()
            with httpx.Client(base_url=f"http://127.0.0.1:{server.server_port}", trust_env=False) as client:
                assert client.get(HEALTH).status_code == 401
                auth = {"Authorization": "Bearer " + KEY}
                assert client.get(HEALTH, headers=auth).json()["runtime"] == "agent_mc_harness"
                assert client.post(DECIDE, headers=auth, json={**event, "bodyUuid": SPEAKER}).status_code == 403
                assert client.post(DECIDE, headers=auth, json={**event, "commands": ["/op ..."]}).status_code == 422
                stale = {**event, "scene": {**event["scene"], "observedAt": event["scene"]["observedAt"] - 30000}}
                assert client.post(DECIDE, headers=auth, json=stale).status_code == 422
                res = client.post(DECIDE, headers=auth, json=event)
                assert res.json() == {"schemaVersion": 1, "eventId": event["eventId"], "decision": {"kind": "reply", "text": "你好。"}}
                replay = client.post(DECIDE, headers=auth, json=event)
                assert replay.json()["decision"] == {"kind": "continue"}
                assert client.post(DECIDE, headers=auth, json={**event, "utterance": "改变原文"}).status_code == 409
                assert client.post(DECIDE, headers=auth, json={**event, "eventId": "too_soon"}).status_code == 429
                assert calls == [(RESIDENT, SPEAKER)]
        finally:
            server.shutdown()
            thread.join(timeout=4)

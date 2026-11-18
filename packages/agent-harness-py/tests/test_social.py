import asyncio
from dataclasses import replace
import json
from uuid import UUID

import httpx

from agent_mc_harness.models import BodyEvent
from agent_mc_harness.npc import ModelClient, NpcPlanner
from agent_mc_harness.runtime import Intent, PlanContext
from agent_mc_harness.social import DAY_MS, SocialEvent, SocialWorld, publish_json, relationship_view, stamped_contact
from test_server_npc import role


KIRITO, YUI, ALICE, BOB, OLD = [str(UUID(int=i)) for i in range(11, 16)]
DAY = DAY_MS * 20_700


def setup_world(tmp_path, *, enabled=True):
    roles = [role(body_id=KIRITO, social_previous_bodies=[OLD], social_memory=enabled),
             role(id="yui", body_id=YUI, character_id=YUI, social_memory=True)]
    social = SocialWorld(tmp_path / "data", "qa", roles)
    return social, roles


def result(social, body, speaker, number, *, channel="private", status="answered", **extra):
    request = str(UUID(int=number))
    row = {"schemaVersion": 1, "maidId": body, "speakerId": speaker, "id": request,
           "at": DAY + number, "channel": channel, "status": status, "message": "练习暗号"} | extra
    directory = social.root / "tlm-companion-memory" / body
    publish_json(directory / f"{request}-result.json", row)
    return row, directory


def travel(social, follower, leader, number, contract, at, *, status="completed", **extra):
    request, contract = str(UUID(int=number)), str(UUID(int=contract))
    proof = {"schemaVersion": 1, "requestId": request, "contractId": contract, "at": at,
             "followerId": follower, "leaderId": leader, "arrived": True, "visibility": "peer_only"} | extra
    publish_json(social.root / "tlm-companion-travel" / follower / f"{request}.json",
                 {"maidId": follower, "status": status, "completed": status == "completed",
                  "requestId": request, "contractId": contract, "socialArrival": proof})


def test_scoring_is_deterministic_and_applies_daily_and_contract_caps_before_display():
    reached = SocialEvent("player", ALICE, DAY + 1000, "shared_activity_completed", "travel", "a",
                          "peer_only", "抵达", "one")
    evidence = [reached, reached, replace(reached, source_id="b", contract="two", at=DAY + 20),
                replace(reached, source_id="c", at=DAY + DAY_MS),
                replace(reached, source_id="d", contract="three", at=DAY + 2 * DAY_MS),
                SocialEvent("player", ALICE, DAY - 1, "dialogue_completed", "chat", "p", "public", "早安")]
    private = relationship_view("player", ALICE, evidence, False)
    assert private == relationship_view("player", ALICE, evidence[::-1], False)
    assert private["scores"] == {"familiarity": 4, "trust": 4}
    assert (private["familiarity"], private["trust"], private["sourceCount"]) == ("熟悉", "信赖", 5)
    public = relationship_view("player", ALICE, evidence, True)
    assert public["scores"] == {"familiarity": 1, "trust": 0}
    assert [entry["summary"] for entry in public["evidence"]] == ["早安"]


def test_stable_identity_replay_and_only_original_verified_arrivals(tmp_path):
    social, roles = setup_world(tmp_path)
    assert social.lookup(KIRITO, "player", ALICE, public=False) is None
    result(social, OLD, ALICE, 30)
    result(social, KIRITO, BOB, 31, status="accepted")
    result(social, KIRITO, BOB, 32, channel="unknown")
    travel(social, YUI, KIRITO, 33, 90, DAY)
    travel(social, YUI, KIRITO, 34, 90, DAY + DAY_MS)
    travel(social, YUI, KIRITO, 35, 91, DAY + DAY_MS, status="unknown")
    travel(social, YUI, KIRITO, 36, 92, DAY + DAY_MS, requestId=str(UUID(int=99)))
    travel(social, YUI, ALICE, 37, 93, DAY + DAY_MS, arrived=False)
    social.refresh()
    alice = social.lookup(KIRITO, "player", ALICE, public=False)
    assert alice["familiarity"] == "认识" and len(alice["evidence"]) == 1
    assert social.lookup(KIRITO, "player", BOB, public=False)["familiarity"] == "初识"
    assert social.lookup(KIRITO, "player", ALICE, public=True)["evidence"] == []
    assert social.lookup(YUI, "player", ALICE, public=False)["evidence"] == []
    assert social.lookup(YUI, "npc", str(roles[0].character_id), public=False)["trust"] == "愿意合作"
    assert social.lookup(KIRITO, "npc", YUI, public=False)["trust"] == "愿意合作"
    pair = social.root / "tlm-companion-memory" / KIRITO / f"relationship-player-{ALICE}.json"
    before = pair.read_bytes()
    resumed = SocialWorld(social.root, social.realm, roles)
    resumed.refresh()
    assert pair.read_bytes() == before
    # Late but independently verified next-day proof updates both registered directions.
    travel(social, YUI, OLD, 38, 94, DAY - 1)
    resumed.refresh()
    assert resumed.lookup(KIRITO, "npc", YUI, public=False)["trust"] == "信赖"


def test_private_result_requires_matching_original_and_excludes_disconnected_or_forged_sources(tmp_path):
    social, roles = setup_world(tmp_path)
    answered, directory = result(social, KIRITO, ALICE, 40, kind="social_dialogue", completedAt=DAY + 50)
    request = directory / f"{answered['id']}-request.json"
    publish_json(request, answered | {"status": "accepted", "speakerId": BOB})
    social.refresh()
    assert social.lookup(KIRITO, "player", ALICE, public=False)["evidence"] == []
    publish_json(request, answered | {"status": "accepted"})
    social.refresh()
    assert social.lookup(KIRITO, "player", ALICE, public=False)["familiarity"] == "认识"
    assert social.lookup(KIRITO, "player", ALICE, public=True)["familiarity"] == "初识"
    assert social.lookup(KIRITO, "player", BOB, public=False)["evidence"] == []
    disabled = SocialWorld(social.root, social.realm, [roles[0].model_copy(update={"social_memory": False}), roles[1]])
    disabled.refresh()
    assert disabled.lookup(KIRITO, "player", ALICE, public=False) is None
    assert request.is_file()


def test_hosted_dialogue_counts_only_after_actual_public_delivery(tmp_path):
    social, roles = setup_world(tmp_path)
    first = BodyEvent(kind="chat", body_kind="numen", text="公示", data={
        "listenerId": KIRITO, "speakerId": ALICE, "eventId": "qdvoice-verified", "channel": "public", "occurredAt": DAY})
    assert stamped_contact(first, KIRITO, social.registered) is None
    first.data["serverAttributed"] = True
    assert stamped_contact(first, KIRITO, social.registered) == {"peerId": ALICE, "peerType": "player"}
    answered, directory = result(social, KIRITO, ALICE, 45, kind="social_dialogue", channel="public", status="failed")
    request = directory / f"{answered['id']}-request.json"
    publish_json(request, answered | {"status": "accepted"})
    publish_json(directory / f"{answered['id']}-answer.json", answered | {"status": "prepared"})
    social.refresh()
    assert social.lookup(KIRITO, "player", ALICE, public=True)["evidence"] == []
    publish_json(directory / f"{answered['id']}-result.json", answered | {"status": "answered", "completedAt": DAY + 49})
    social.refresh()
    social.refresh()
    pair = social.root / "tlm-companion-memory" / KIRITO / f"relationship-player-{ALICE}.json"
    proof = json.loads(pair.read_bytes())["public"]
    assert proof["sourceCount"] == 1 and proof["evidence"][0]["sourceRequestId"] == answered["id"]
    assert proof["scores"] == {"familiarity": 1, "trust": 0}
    assert social.lookup(KIRITO, "player", BOB, public=False)["evidence"] == []


def test_nearby_voice_receipt_is_recalled_by_the_pair_only(tmp_path):
    social, _ = setup_world(tmp_path)
    answered, directory = result(social, KIRITO, ALICE, 46, kind="social_dialogue", channel="nearby", completedAt=DAY + 49)
    publish_json(directory / f"{answered['id']}-request.json", answered | {"status": "accepted"})
    social.refresh()
    assert social.lookup(KIRITO, "player", ALICE, public=False)["familiarity"] == "认识"
    assert social.lookup(KIRITO, "player", ALICE, public=True)["evidence"] == []
    assert social.lookup(KIRITO, "player", BOB, public=False)["evidence"] == []


def test_topic_recall_combines_old_chinese_matches_and_validated_ids_without_crossing_visibility(tmp_path):
    social, _ = setup_world(tmp_path)
    mine, _ = result(social, KIRITO, ALICE, 20, channel="public", message="在北风矿井修了通路")
    mill, _ = result(social, KIRITO, ALICE, 21, channel="public", message="旧水车旁边留了灯笼")
    secret, _ = result(social, KIRITO, ALICE, 22, channel="nearby", message="只有我听到的矿井暗号")
    foreign, _ = result(social, KIRITO, BOB, 23, channel="public", message="别人的矿井暗号")
    for number in range(70, 96):
        result(social, KIRITO, ALICE, number, channel="public", message="早安")
    social.refresh()
    snapshot = social.root / "tlm-companion-memory" / KIRITO / f"relationship-player-{ALICE}.json"
    assert len(json.loads(snapshot.read_bytes())["public"]["evidence"]) == 24
    lexical = social.lookup(KIRITO, "player", ALICE, public=True, topic="还记得北风矿井怎么走吗？")
    assert "北风矿井" in lexical["evidence"][0]["summary"]
    semantic = social.lookup(KIRITO, "player", ALICE, public=True, topic="曾经借宿的地方",
                             ranked=(foreign["id"], secret["id"], mill["id"]))
    assert "旧水车" in semantic["evidence"][0]["summary"]
    assert "暗号" not in str(semantic)
    private = social.lookup(KIRITO, "player", ALICE, public=False, topic="矿井", ranked=(secret["id"], mine["id"]))
    assert "只有我听到" in private["evidence"][0]["summary"]


def test_planner_requests_use_exact_pair_and_exclude_private_legacy_recall(tmp_path):
    social, roles = setup_world(tmp_path)
    result(social, KIRITO, ALICE, 50)
    result(social, KIRITO, ALICE, 51, channel="public", message="公共锚点")
    social.refresh()
    sent = []

    def answer(request):
        facts = json.loads(json.loads(request.content)["messages"][1]["content"])
        sent.append(facts)
        response = {"reply": "记得"} if "message" in facts else {"steps": []}
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(response)}}]})

    async def run():
        client = ModelClient("http://127.0.0.1:4000/v1", "fixture",
                             http=httpx.AsyncClient(transport=httpx.MockTransport(answer)))
        planner = NpcPlanner(roles[0], client)
        for peer in (ALICE, BOB):
            for public in (False, True):
                relationship = social.lookup(KIRITO, "player", peer, public=public)
                if not public:
                    assert await planner.answer_dialogue("上次聊了什么？", relationship, public=False) == "记得"
                else:
                    context = PlanContext(social_relationship=relationship, memories=[{"source": "local", "fact": "练习暗号"}])
                    await planner(Intent(id="synthetic", agent="kirito", goal="answer"), context)
        await client.close()

    asyncio.run(run())
    assert "练习暗号" in str(sent[0]) and "公共锚点" in str(sent[0])
    assert "练习暗号" not in str(sent[1]) and "公共锚点" in str(sent[1])
    assert "练习暗号" not in str(sent[2:]) and "公共锚点" not in str(sent[2:])
    assert [packet["socialRelationship"]["peer"]["id"] for packet in sent] == [ALICE, ALICE, BOB, BOB]

import asyncio
import json
import time
from pathlib import Path
from uuid import UUID

import httpx
import yaml
from simbody import SimBody
from test_npc_native_continuity import maid_context
from test_server_npc import role

from agent_mc_harness.companion_adventure import CompanionAdventure
from agent_mc_harness.journal import ActionJournal
from agent_mc_harness.models import ActionSupport, BodyEvent
from agent_mc_harness.npc import DIALOGUE_GOAL, IDLE_GOAL, ModelClient, NpcHost, NpcPlanner
from agent_mc_harness.npc_service import adventure_source
from agent_mc_harness.runtime import Intent

OWNER = UUID("00000000-0000-4000-8000-000000000001")
OTHER = "00000000-0000-4000-8000-000000000002"
READER = Path(__file__).resolve().parents[3] / "paper/ops/agentfriend_state.py"


def write(path, name, value):
    (path / name).write_text(yaml.safe_dump(value, allow_unicode=True), encoding="utf-8")


def source(path, **changes):
    now = int(time.time() * 1000)
    config = {"dungeon-built": True, "dungeon-expanded": True,
              "dungeon-active-run": {"floor": 9, "participants": [OTHER]},
              "dungeon-activity-outcomes": {
                  str(OWNER): {"floor": 5, "outcome": "failed", "reason": "party_defeated", "endedAt": now - 5000},
                  OTHER: {"reason": "hidden-other-player"},
              },
              "guild-players": {str(OWNER): {"completed": 73, "everDone": {"tm_survey": "2026-11-18"},
                                               "active": {"id": "tm_photo"}}},
              "site-dungeons": {
                  "runs": {"occupied": {"stage": 1, "party": [OTHER]}, "stalled": {"stage": 0, "fault": "io"}},
                  "cooldowns": {"cooling": now - 5000},
                  "outcomes": {str(OWNER): {"occupied": {"endedAt": now - 10000, "reason": "completed", "clearedRooms": 3}}},
              }}
    write(path, "config.yml", config | changes)
    write(path, "dungeons.yml", {"sites": {key: {"name": name, "world": "world", "rooms": [1, 2, 3], "hint": "三室守卫挑战"}
                                          for key, name in [("occupied", "旧墓室"), ("cooling", "赤焰洞"),
                                                            ("stalled", "迷雾谷"), ("ready", "潮汐圣所")]}})
    write(path, "world-life.yml", {"season": "远行季", "contracts": ["tm_survey", "tm_photo"]})
    write(path, "route-contracts.yml", {"tasks": {
        "survey": {"title": "海岸测绘", "steps": [{"goal": "biome"}]},
        "photo": {"title": "旅途相册", "steps": [{"goal": "photo"}]},
    }})
    (path / "exploration-landmarks.json").write_text(json.dumps({
        "schemaVersion": 1, "source": "formal_anvil_structure_and_block_records", "verifiedAt": "2026-11-18T12:00:00Z",
        "places": [{"id": "shipwreck", "name": "原版珊瑚沉船", "world": "minecraft:overworld",
                    "x": -101, "z": 290, "entranceVerified": False, "precision": "horizontal_structure_reference"}],
    }), encoding="utf-8")
    return CompanionAdventure(*adventure_source({"directory": str(path), "stateReader": str(READER)}), OWNER)


def view(adviser, audience="addressed_partner", speech=()):
    return asyncio.run(adviser.view(audience=audience, dimension="minecraft:overworld", recent_speech=speech))


def test_checkpoint_distinguishes_other_run_actual_outcome_and_routes(tmp_path):
    result = view(source(tmp_path))
    assert result["state"] == "checkpoint" and result["observedAt"] >= result["stateSavedAt"]
    assert result["trial"]["status"] == "active"
    assert "floor" not in result["trial"] and not result["activeWithPartner"]
    progress = result["partnerProgress"]
    assert progress["lastTrial"]["floor"] == 5 and progress["lastTrial"]["outcome"] == "failed"
    assert "cleared" not in progress["lastTrial"]
    assert progress["recentDungeonOutcomes"][0]["clearedRooms"] == 3
    assert progress["guildCompleted"] == 73 and progress["activeCommission"]["id"] == "tm_photo"
    assert progress["recentCompletedCommissions"][0]["id"] == "tm_survey"
    assert {choice["id"] for choice in result["choices"]} == {"shipwreck", "ready", "tm_photo"}
    assert next(choice for choice in result["choices"] if choice["id"] == "ready")["hint"] == "三室守卫挑战"
    place = result["choices"][0]
    assert (place["world"], place["x"], place["z"], place["entranceVerified"]) == ("minecraft:overworld", -101, 290, False)
    assert "y" not in place
    assert OTHER not in json.dumps(result) and "hidden-other-player" not in json.dumps(result)
    assert result["recentEnding"]["reason"] == "party_defeated"


def test_owner_run_suppresses_destinations_and_public_turn_does_not_reveal_it(tmp_path):
    adviser = source(tmp_path, **{"site-dungeons": {"runs": {
        "ready": {"stage": 1, "party": [str(OWNER), OTHER], "phase": "fighting", "pausedAt": 123},
    }}})
    result = view(adviser, "nearby_partner")
    active = result["activeWithPartner"][0]
    assert active["room"] == 2 and active["status"] == "paused"
    assert active["readCommand"] == "/mycli dungeon status ready"
    assert not result["choices"] and "partnerProgress" not in result
    public = view(adviser, "public")
    assert not public["activeWithPartner"] and "partnerProgress" not in public
    assert OWNER.hex not in json.dumps(public) and OTHER not in json.dumps(public)
    assert "room" not in next(site for site in public["dungeons"] if site["id"] == "ready")


def test_recent_speech_and_failed_checkpoint_do_not_make_invalid_offers(tmp_path):
    adviser = source(tmp_path)
    result = view(adviser, speech=["去珊瑚沉船转一圈？", "想不想看看潮汐圣所？"])
    assert {choice["id"] for choice in result["choices"]} == {"tm_photo"}
    adviser.saved_at -= 16 * 60_000
    result = view(adviser)
    assert result["state"] == "stale" and {choice["kind"] for choice in result["choices"]} == {"landmark"}
    (tmp_path / "config.yml").write_text("not: [valid", encoding="utf-8")
    adviser.next_refresh = 0
    result = view(adviser)
    assert result["state"] == "unavailable" and result["partnerProgress"]["guildCompleted"] is None
    assert {choice["kind"] for choice in result["choices"]} == {"landmark"}


def test_recently_ended_activity_is_not_its_own_recommendation(tmp_path):
    adviser = source(tmp_path, **{"dungeon-active-run": {}})
    result = view(adviser, "nearby_partner")
    assert result["trial"]["status"] == "verify_entry"
    assert result["recentEnding"]["id"] == "trial_tower"
    assert "trial_tower" not in {choice["id"] for choice in result["choices"]}


def guarded():
    actor = role(body_kind="maid", default_native_guard=True, adventure_advice=True,
                 allowed_tools=["body:chat", "body:native:guard", "body:stay"])
    context = maid_context(nativeGuardDelegated=True, canMove=True, passenger=False, sitting=False, homeMode=False,
                           taskId="touhou_little_maid:idle", ownerDistance=3, companion={"state": "following_ready"},
                           follow={"active": True, "temporaryWait": False}, conversation={"partnerRange": 24})
    context.capabilities.actions["chat"] = ActionSupport(native="speak")
    context.snapshot.health = 28
    context.snapshot.dimension = "minecraft:overworld"
    return actor, context


def test_quiet_delegation_keeps_thought_for_useful_occasion_and_only_allows_speech(tmp_path):
    async def run():
        actor, context = guarded()
        adviser = source(tmp_path)
        context.companion_adventure = await adviser.view(audience="nearby_partner", dimension=context.snapshot.dimension, recent_speech=[])
        requests = []

        def answer(request):
            payload = json.loads(request.content)
            facts = json.loads(payload["messages"][1]["content"])
            requests.append(facts)
            assert list(facts["capabilities"]["actions"]) == ["chat"]
            text = "想去珊瑚沉船看看吗？先找找入口。" if len(requests) == 1 else "去没有记录的秘密关卡吧。"
            return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(
                {"steps": [{"tool": "body:chat", "args": {"text": text}}]}, ensure_ascii=False)}}]})

        client = ModelClient("http://127.0.0.1:4000/v1", "synthetic", http=httpx.AsyncClient(transport=httpx.MockTransport(answer)))
        try:
            planner = NpcPlanner(actor, client)
            intent = Intent(id="idle", agent=actor.id, goal=IDLE_GOAL)
            planner.next_companion_check_in = 0
            assert (await planner(intent, context))[0].tool == "body:chat"
            assert requests[0]["companionOpportunity"] == "activity_ended"
            assert planner.companion_anchor is None
            # This is a synthetic delivered-caption receipt, not a claim about a game client.
            intent.action_receipts["synthetic-caption"] = {"verb": "chat", "status": "completed", "terminal": True}
            intent.state = "completed"
            context.communication_receipts = [{"requestId": "synthetic-caption", "status": "completed", "captionRecipients": 1}]
            assert await planner(Intent(id="next-idle", agent=actor.id, goal=IDLE_GOAL), context) == [] and len(requests) == 1
            context.snapshot.position["x"] += 20
            planner.next_companion_check_in = planner.next_companion_attempt = 0
            assert await planner(Intent(id="travel-idle", agent=actor.id, goal=IDLE_GOAL), context) == [] and len(requests) == 2
            assert requests[-1]["companionOpportunity"] == "settled_after_travel"
        finally:
            await client.close()
    asyncio.run(run())


def test_current_agenda_gets_physical_turn_and_guard_returns_after_it_ends():
    async def run():
        actor, context = guarded()
        actor.allowed_tools.append("body:move")
        context.capabilities.actions["move"] = ActionSupport(native="walk")
        context.agenda = {"current": {"goal": "查看旁边的路口"}, "upcoming": []}
        calls = []

        def choose(request):
            facts = json.loads(json.loads(request.content)["messages"][1]["content"])
            calls.append(facts)
            assert facts["agenda"]["current"]["goal"] == "查看旁边的路口"
            assert "move" in facts["capabilities"]["actions"]
            assert "companionOpportunity" not in facts
            return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(
                {"steps": [{"tool": "body:move", "args": {"x": 6, "y": 64, "z": 8}}]})}}]})

        client = ModelClient("http://127.0.0.1:1/v1", "synthetic",
                             http=httpx.AsyncClient(transport=httpx.MockTransport(choose)))
        try:
            planner = NpcPlanner(actor, client)
            planner.next_companion_check_in = 0
            intent = Intent(id="guard-agenda", agent=actor.id, goal=IDLE_GOAL)
            assert [step.tool for step in await planner(intent, context)] == ["body:move"]
            context.snapshot.raw["nativeGuardDelegated"] = False
            context.agenda["current"] = None
            assert [step.tool for step in await planner(intent, context)] == ["body:native:guard"]
            assert len(calls) == 1
        finally:
            await client.close()
    asyncio.run(run())


def test_explicit_advice_uses_verified_owner_and_body_binding(tmp_path):
    async def run():
        actor, context = guarded()
        body = SimBody()
        results = []

        async def planner(_intent, view_context):
            results.append(view_context.companion_adventure)
            return []

        journal = ActionJournal(tmp_path / "actions.sqlite3")
        host = NpcHost(actor, body, planner, None, journal, companion_adventure=source(tmp_path))
        body_id = str(actor.body_id)
        try:
            for speaker, attributed in [(OTHER, True), (str(OWNER), False), (str(OWNER), True)]:
                event = BodyEvent(kind="dialogue", body_kind="maid", body_id=body_id, text="上回打到哪？", data={
                    "eventId": "test-dialogue", "recipientId": body_id, "maidId": body_id, "speakerId": speaker,
                    "deliveryScope": "addressed", "serverAttributed": attributed,
                })
                host.pending_dialogue = {"test-dialogue": event}
                await host._plan(Intent(id="reply", agent=actor.id, goal=DIALOGUE_GOAL, source_events=["test-dialogue"]),
                                 context.model_copy(deep=True))
            assert "partnerProgress" not in results[0]
            assert results[1] is None
            assert results[2]["partnerProgress"]["lastTrial"]["floor"] == 5
        finally:
            host.unsubscribe()
            journal.close()
    asyncio.run(run())


def test_resident_check_in_uses_same_adviser_with_public_facts_for_non_owner_leader(tmp_path):
    async def run():
        actor, context = guarded()
        actor.activity_review_seconds = 90
        context.snapshot.raw.pop("ownerDistance")
        expedition = {"leaderId": OTHER, "leaderDimension": context.snapshot.dimension,
                      "state": "nearby", "distanceBlocks": 3}
        context.snapshot.raw["resident"] = {"loaded": True, "expedition": expedition}
        seen = []

        async def planner(_intent, view_context):
            seen.append(view_context.companion_adventure)
            return []

        journal = ActionJournal(tmp_path / "actions.sqlite3")
        host = NpcHost(actor, SimBody(), planner, None, journal, companion_adventure=source(tmp_path))
        intent = Intent(id="idle", agent=actor.id, goal=IDLE_GOAL)
        try:
            await host._plan(intent, context.model_copy(deep=True))
            assert seen[-1]["choices"]
            assert "partnerProgress" not in seen[-1]
            assert seen[-1]["activeWithPartner"] == []
            expedition.update(state="waiting_to_regroup", leaderDimension="minecraft:aincrad")
            await host._plan(intent, context.model_copy(deep=True))
            assert seen[-1] is None
        finally:
            journal.close()

    asyncio.run(run())

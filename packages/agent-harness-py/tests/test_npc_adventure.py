import asyncio
import time
from types import SimpleNamespace

import pytest

from agent_mc_harness.body import adventure as life
from agent_mc_harness.body.base import ArgumentError
from agent_mc_harness.body.numen import NumenBody, PortResult
from agent_mc_harness.journal import ActionJournal
from agent_mc_harness.models import BodyAction, BodySnapshot, Scope
from agent_mc_harness.runtime import PlanContext


@pytest.mark.parametrize(("name", "kind", "args"), [
    (life.ACT, "invite_partner", {"peer": "someone"}), (life.ACT, "start_ruin", {}),
    (life.ACT, "accept_quest", {"id": "-x"}), (life.ACT, "accept_quest", {"id": "cave other"}),
    (life.QUERY, "ruin_info", {"id": "cave\nother"}), (life.ACT, "kick", {}),
    (life.QUERY, "start_trial", {}), (life.ACT, "ruins", {}), (life.QUERY, "party", {"id": "x"}),
])
def test_only_exact_typed_player_actions(name, kind, args):
    with pytest.raises(ArgumentError):
        life.player_command(name, {"kind": kind, **args}, "Kirito", "ag_CorMy")


def test_actual_names_and_live_ids_only():
    assert life.player_command(life.QUERY, {"kind": "plan_joining"}, "Kirito", "ag_CorMy") == "/mycli guild party plan ag_CorMy Kirito --json"
    assert life.player_command(life.ACT, {"kind": "travel_ruin", "id": "undead_crypt"}, "Kirito", "ag_CorMy") == "/mycli dungeon travel undead_crypt --json"
    with pytest.raises(ArgumentError):
        life.player_command(life.QUERY, {"kind": "party"}, "kirito", "Kirito")


def test_quest_lifecycle_and_catalogue_paging_use_server_formats():
    def command(name, kind, **args):
        return life.player_command(name, {"kind": kind, **args}, "Kirito", "ag_CorMy")
    assert command(life.ACT, "accept_quest", id="tm_frontier") == "/mycli guild accept tm_frontier"
    assert command(life.ACT, "turn_in_quest") == "/mycli guild claim"
    assert command(life.QUERY, "quest_status") == "/mycli tasks status --json"
    assert command(life.QUERY, "ruins", page=2) == "/mycli dungeon list --page 2 --json"
    snapshot = "89593746-83a0-42cc-bdf6-dd3abc09d207"
    assert command(life.QUERY, "detail_page", id=snapshot, page=2) == f"/mycli page {snapshot} 2"
    for args in ({"page": True}, {"page": "2"}, {"page": 0}, {"page": 101}):
        with pytest.raises(ArgumentError):
            command(life.QUERY, "exploration", **args)
    with pytest.raises(ArgumentError):
        command(life.QUERY, "detail_page", id="some_task", page=1)


def test_partial_and_unrelated_feedback_cannot_confirm_a_write():
    broken = PortResult("completed", 'stdout:\nMC_TASKS {"items":[{"id":"unfinished')
    assert life.game_result(broken, life.QUERY, {"kind": "exploration"}).status == "failed"
    unrelated = PortResult("completed", 'stdout:\nMC_RPG {"success":true,"type":"other"}')
    assert life.game_result(unrelated, life.ACT, {"kind": "invite_partner"}).data["adventure"]["effect"] == "dispatched"
    reply = PortResult("completed", "stdout:\n已安全抵达 Friend 身边。 dimension=minecraft:overworld x=-6 y=72 z=102")
    assert life.game_result(reply, life.ACT, {"kind": "meet_partner"}, peer="Friend").data["adventure"]["effect"] == "confirmed"
    assert life.game_result(reply, life.ACT, {"kind": "meet_partner"}, peer="Other").data["adventure"]["effect"] == "unverified"


def test_guild_messages_identify_offers_limits_and_actual_settlement():
    def reply(name, kind, lines):
        return life.game_result(PortResult("completed", "stdout:\n" + lines), name, {"kind": kind})
    board = reply(life.QUERY, "guild_board", "今日委托\ndb_potato 热乎乎的晚饭\n需要12个马铃薯")
    assert board.data["adventure"]["offers"] == ["db_potato 热乎乎的晚饭"]
    assert reply(life.ACT, "accept_quest", "已有在途任务；先查进度。").status == "rejected"
    assert reply(life.ACT, "turn_in_quest", "委托交付成功！声望 +6。").data["adventure"]["effect"] == "confirmed"
    assert reply(life.QUERY, "quest_status", "QD_GUILD_STATUS\n尚未加入冒险者公会").data["adventure"]["source"] == "guild status"


@pytest.mark.parametrize("stage", ["before_read", "waiting_read", "after_read", "after_dispatch"])
def test_recover_party_change_only_queries_original_calls(stage):
    request_id = "original_party_123"
    check_id = NumenBody._party_check_id(request_id)
    recorded = {"before_read": set(), "waiting_read": {check_id}, "after_read": {check_id},
                "after_dispatch": {check_id, request_id}}[stage]
    queries = []

    async def result(key):
        queries.append(key)
        if key == request_id:
            return PortResult("completed", 'stdout:\nMC_RPG {"type":"party","success":true}')
        return PortResult("unknown" if stage == "waiting_read" else "completed")

    port = SimpleNamespace(transport="numen-hosted-mcp", recorded=recorded.__contains__, result=result)
    body = NumenBody(port, scope=Scope(realm="qa", account="owner", agent="actor"), adventure_partner="Friend")
    body.restore_request(BodyAction(verb="native", name=life.ACT, args={"kind": "invite_partner"}, request_id=request_id))
    actual = asyncio.run(body.result(request_id))
    assert actual.status == {"before_read": "rejected", "waiting_read": "unknown",
                             "after_read": "rejected", "after_dispatch": "completed"}[stage]
    assert queries == ([] if stage == "before_read" else [request_id] if stage == "after_dispatch" else [check_id])
    if stage == "after_dispatch":
        assert actual.data["adventure"]["at"] == 0


def test_world_feedback_instead_of_lua_transport_success():
    returned = PortResult("completed", 'returned: {"success":true}\nstdout:\nMC_RPG {"success":false,"reason":"player_offline"}')
    out = life.game_result(returned, life.ACT, {"kind":"invite_partner"})
    assert out.status == "rejected"
    assert out.data["adventure"]["records"][0]["value"]["reason"] == "player_offline"
    dispatched = life.game_result(PortResult("completed", "dispatch"), life.ACT, {"kind":"start_trial"})
    assert dispatched.data["adventure"]["effect"] == "dispatched"
    assert life.game_result(PortResult("unknown"), life.ACT, {"kind":"invite_partner"}).status == "unknown"
    assert life.game_result(PortResult("unknown"), life.QUERY, {"kind":"party"}).status == "failed"
    assert life.game_result(PortResult("completed", "stdout:\nQD_ADVENTURE_NOT_CONFIGURED"), life.QUERY, {"kind":"party"}).status == "rejected"


def test_invites_and_meet_require_current_native_partner():
    plan = {"type":"partyPlan", "nextAction":"invite","requested":[{"name":"Partner","online":True}]}
    assert life.coordination_check("invite_partner", "Partner", plan)
    assert not life.coordination_check("invite_partner", "Partner", {**plan,"nextAction":"wait"})
    assert not life.coordination_check("invite_partner", "Partner", {**plan,"requested":[{"name":"Somebody","online":True}]})
    assert not life.coordination_check("meet_partner", "Partner", plan)
    assert life.coordination_check("meet_partner", "Partner", {"inParty": True, "members":[{"name":"Partner","online":True}]})


def test_grounded_walks_end_before_obstacles_and_corners():
    rows=[["."]*17 for _ in range(17)]
    rows[8][8]="@"
    rows[8][9]="#"
    rows[6][8]="!"
    raw="stdout:\nGROUND 47 62 -11 minecraft:overworld\n"+"\n".join("ROW "+" ".join(row) for row in rows)
    raw+="\nPLAYER Partner 47.5 62 -10\nHOSTILE minecraft:husk 2.5 12.0\nSURVEY_END"
    sampled=life.survey_result(PortResult("completed",raw)).data["survey"]
    dest=sampled["walkTo"]
    assert sampled["hostiles"] == [{"type": "minecraft:husk", "distance": 2.5, "health": 12.0}]
    assert {"x":47, "y":62, "z":-12} in dest and all(p["x"] <=47 for p in dest)
    assert life.survey_result(PortResult("completed",raw.split("SURVEY_END")[0])).status=="failed"
    caps=PlanContext(snapshot=BodySnapshot(life_state="alive", dimension="minecraft:overworld",position={"x":47,"y":62,"z":-11}),body_results=[{"survey":sampled}])
    assert life.partner_nearby("Partner",caps)
    assert not life.partner_nearby("Stranger",caps)
    caps.snapshot.dimension="minecraft:the_nether"
    assert not life.partner_nearby("Partner",caps)
    caps.snapshot.dimension="minecraft:overworld"
    sampled["at"]=int(time.time())-76
    assert not life.partner_nearby("Partner",caps)


def test_contact_cooldowns_survive_restart_and_are_per_body(tmp_path):
    path=tmp_path/"actions.sqlite3"
    j=ActionJournal(path)
    j.begin("a",BodyAction(verb="native",name=life.ACT,args={"kind":"invite_partner"},request_id="invite_001"))
    j.begin("a",BodyAction(verb="chat",args={"text":"汇合吧"},request_id="speech_001"))
    j.close()
    j=ActionJournal(path)
    assert j.contacted_recently("a","invite",1800) and j.contacted_recently("a","speech",600)
    assert not j.contacted_recently("b","invite",1800)
    j.close()


def test_only_the_unsent_invitation_releases_its_cooldown(tmp_path):
    from agent_mc_harness.models import ActionReceipt
    journal = ActionJournal(tmp_path / "actions.sqlite3")
    def invite(request):
        journal.begin("actor", BodyAction(verb="native", name=life.ACT, args={"kind": "invite_partner"}, request_id=request))
    def unsent(request):
        journal.settle("actor", ActionReceipt(verb="native", request_id=request, status="rejected", terminal=True,
                                              data={"partyWriteSent": False}))
    invite("old_invite")
    unsent("old_invite")
    assert not journal.contacted_recently("actor", "invite", 1800)
    invite("new_invite")
    unsent("old_invite")
    assert journal.contacted_recently("actor", "invite", 1800)
    journal.close()


@pytest.mark.parametrize("action", ["clean", "store", "donate"])
def test_inventory_shortcuts(action):
    import json
    body = "10000000-0000-0000-0000-000000000011"
    kind = "inventory_" + action
    for name, preview in [(life.QUERY, True), (life.ACT, False)]:
        expected = f"/mycli inventory {action}" + (" --dry-run" if preview else "") + " --json"
        assert life.player_command(name, {"kind": kind}, "Kirito", "ag_CorMy") == expected
        row = {"action": action, "dryRun": preview, "success": True, "playerUuid": body,
               "reason": "preview" if preview else "partial", "leftForCapacity": 8}
        result = PortResult("completed", "stdout:\nMC_INVENTORY_BATCH " + json.dumps(row))
        evidence = life.game_result(result, name, {"kind": kind}, body_id=body)
        assert evidence.status == "completed" and evidence.data["adventure"]["receipt"] == row
        mismatch = life.game_result(result, name, {"kind": kind}, body_id="another")
        assert mismatch.status == ("failed" if preview else "unknown") and not mismatch.data["adventure"]["retryWrite"]


def test_compass_catalogue_exact_name_and_verified_cross_world_travel():
    import json
    uid = "cd861923-2f54-4dd2-8b8f-6cf10fbf9ece"
    actor = "8d6aa54b-98f7-4147-99d4-fe91ee8cd1fb"
    def cmd(name, **args):
        return life.player_command(name, args, "Kirito", "ag_CorMy")
    assert cmd(life.QUERY, kind="characters", page=2) == "/mycli locate list 2 --json"
    assert cmd(life.QUERY, kind="characters", page=101) == "/mycli locate list 101 --json"
    assert cmd(life.QUERY, kind="locate_character", target="肥鱼") == "/mycli locate info 肥鱼 --json"
    assert cmd(life.ACT, kind="meet_character", targetUuid=uid) == f"/mycli locate tp {uid} --json"
    with pytest.raises(ValueError):
        cmd(life.QUERY, kind="locate_character", target="other --op")
    with pytest.raises(ValueError):
        cmd(life.ACT, kind="meet_character", targetUuid="Somebody")
    location = {"dimension": "world_nether", "x": 5, "y": 80, "z": 12}
    good = {"ok": True, "status": "arrived", "arrivalConfirmed": True, "action": "tp", "actorUuid": actor,
            "targetUuid": uid, "actualPosition": location, "targetPosition": location}
    def outcome(row):
        reply = PortResult("completed", "stdout:\nMC_LOCATE " + json.dumps(row))
        return life.game_result(reply, life.ACT, {"kind": "meet_character", "targetUuid": uid}, body_id=actor)
    assert outcome(good).status == "completed"
    assert outcome(good | {"targetUuid": actor}).status == "unknown"
    assert outcome(good | {"actorUuid": uid}).status == "unknown"
    assert outcome(good | {"actualPosition": {}}).status == "unknown"
    assert outcome(good | {"actualPosition": location | {"x": 9}}).status == "completed"
    assert outcome(good | {"actualPosition": location | {"x": 9.0001}}).status == "unknown"
    assert outcome(good | {"status": "refused", "ok": False, "reason": "no_safe_landing"}).status == "rejected"
    def read(kind, row, **args):
        reply = PortResult("completed", "stdout:\nMC_LOCATE " + json.dumps(row))
        return life.game_result(reply, life.QUERY, {"kind": kind, **args}, body_id=actor).status
    entry = {"uuid": uid, "name": "ag_CorMy", "aliases": ["可米"], **location}
    page = {"action": "list", "actorUuid": actor, "ok": True, "page": 2, "characters": [entry]}
    assert read("characters", page, page=2) == "completed"
    assert read("characters", page, page=1) == "failed"
    assert read("characters", page | {"actorUuid": uid}, page=2) == "failed"
    where = {"action": "info", "actorUuid": actor, "ok": True, "character": entry}
    assert read("locate_character", where, target="可米") == "completed"
    assert read("locate_character", where, target="肥鱼") == "failed"
    assert read("locate_character", where | {"ok": False, "reason": "ambiguous_name"}, target="肥鱼") == "rejected"

"""Native party channel, reinforcement and normal player loadout regression tests."""
import json
import time
from types import SimpleNamespace

import pytest

from agent_mc_harness.body import adventure
from agent_mc_harness.body.base import ArgumentError
from agent_mc_harness.body.numen import PortResult

PEER = "LifePeerQA"
SELF = "QaKirito"
PARTY = "8c165cfd-0c8d-4bcd-9160-edfd13db3311"


def result(kind, line, **args):
    return adventure.game_result(PortResult("completed", "stdout:\n"+line), adventure.ACT,
                                 {"kind": kind, **args}, account=SELF, body_id="572cfa2c-7c6d-412f-ab03-678131545e80", peer=PEER)


def test_actual_equipment_refusal_is_terminal_and_actionable():
    r = result("meet_partner", "[equipment_required] 增援需补齐：护腿、头盔；/mycli shop menu 购买或 /mycli stash 打开个人箱。 未传送、未耗魔。")
    evidence = r.data["adventure"]
    assert r.status == "rejected" and evidence["effect"] == "refused"
    assert evidence["reason"] == "equipment_required" and evidence["missingEquipment"] == ["护腿","头盔"]
    assert "护腿" in r.text and "头盔" in r.text


@pytest.mark.parametrize(("message","reason"), [
    ("[team_no_safe_ground] 队友附近没有可站立的安全地面，未耗魔。", "team_no_safe_ground"),
    ("传送冷却还剩 12 秒；等待结束再传一次。", "cooldown"),
    ("传送被保护规则取消；未耗魔。", "protected"),
    ("魔力不足，需要 8 魔力。", "insufficient_mana"),
])
def test_travel_denials_are_not_completed(message, reason):
    r = result("meet_partner", message)
    assert r.status == "rejected" and r.data["adventure"]["reason"] == reason


def test_unconfirmed_landing_needs_readback_and_not_another_write():
    r = result("meet_partner", "请求已发送")
    assert r.status != "completed" and r.data["adventure"]["effect"] == "unverified"
    assert r.data["adventure"]["retryWrite"] is False


def test_party_channel_uses_current_party_and_real_sender_echo():
    args = {"kind":"party_chat", "partyId":PARTY, "text":"在试炼塔入口会合吧"}
    assert adventure.player_command(adventure.ACT, args, SELF, PEER) == "/mycli guild party chat 在试炼塔入口会合吧"
    assert result("party_chat","VortexRPG » [Party] ★ QaKirito: 在试炼塔入口会合吧",**{k:v for k,v in args.items() if k!="kind"}).data["adventure"]["effect"] == "sent"
    for message in ["VortexRPG » [Party] Someone: 在试炼塔入口会合吧","已处理"]:
        assert result("party_chat",message,**{k:v for k,v in args.items() if k!="kind"}).data["adventure"]["effect"] != "sent"
    for value in ["", "多行\n文本", "--json", "字"*101]:
        with pytest.raises(ArgumentError):
            adventure.player_command(adventure.ACT, {**args,"text":value}, SELF, PEER)


def test_team_output_is_classified_only_inside_native_party_envelope():
    now=int(time.time()*1000)
    def event(words, native="server_message"):
        return SimpleNamespace(id="native_12",text=words,data={"nativeKind":native,"occurredAt":now})
    raw=event('<event kind="server_message" day="1" t="05:22" where="chat">VortexRPG » [Party] ★ LifePeerQA: 入口见！</event>')
    msg=adventure.party_line(raw)
    assert msg and msg["speaker"]==PEER and msg["text"]=="入口见！"
    assert adventure.party_line(event(raw.text, "talk")) is None
    assert adventure.party_line(event('[附近][主世界] LifePeerQA: 入口见！')) is None
    assert adventure.party_line(event(raw.text.replace("VortexRPG »", "[附近] Someone: VortexRPG »"))) is None


def test_live_party_brand_on_both_sides_of_a_conversation():
    line = "千灯纪 » [Party] ★ QaKirito: 附近巡逻？"
    event = SimpleNamespace(id="native_31", text=f'<event kind="server_message" where="chat">{line}</event>',
                            data={"nativeKind": "server_message", "occurredAt": 123})
    assert result("party_chat", line, partyId=PARTY, text="附近巡逻？").data["adventure"]["effect"] == "sent"
    assert adventure.party_line(event) == {"eventId": "party:native_31", "at": 123, "speaker": SELF, "text": "附近巡逻？"}
    assert result("party_chat", line.replace("千灯纪", "另一座城"), partyId=PARTY, text="附近巡逻？").data["adventure"]["effect"] == "sent"
    for different in (line.replace(SELF, PEER), line.replace("巡逻", "集合"), "[附近] Other: " + line):
        assert result("party_chat", different, partyId=PARTY, text="附近巡逻？").data["adventure"]["effect"] == "unverified"


def test_party_receipt_does_not_use_display_and_stays_private():
    uid = "572cfa2c-7c6d-412f-ab03-678131545e80"
    peer = "44bfa35b-fb76-458b-99f3-f10207dc442f"
    mid = "cb7b8c1a-a31b-4bdd-9f86-9795ff760b05"
    row = {"schema": 1, "id": mid, "partyId": PARTY, "recipientId": uid, "speakerId": uid,
           "speaker": SELF, "text": "入口见！"}
    wire = lambda item: "MC_PARTY_CHAT " + json.dumps(item, ensure_ascii=False)
    def send(item):
        return result("party_chat", wire(item), partyId=PARTY, text="入口见！").data["adventure"]
    receipt = send(row)
    assert (receipt["effect"], receipt["messageId"], receipt["records"], receipt["messages"]) == ("sent", mid, [], [])
    for wrong in ({"partyId": uid}, {"speakerId": peer}, {"recipientId": peer}, {"speakerId": peer, "recipientId": peer},
                  {"id": "x"}, {"text": "另一条"}):
        assert send(row | wrong)["effect"] == "unverified"
    event = SimpleNamespace(id="frame", text='<event kind="server_message" where="chat">' + wire(row | {"recipientId":peer}) + '</event>',
                            data={"nativeKind": "server_message", "occurredAt": 123})
    assert adventure.party_line(event, peer)["eventId"] == "party:" + mid
    assert adventure.party_line(event, uid) is None
    from xml.sax.saxutils import escape
    escaped = escape(wire(row | {"recipientId": peer, "text": '路牌写着 "A & B"'}), {'"': "&quot;"})
    event.text = '<event kind="server_message" where="chat">' + escaped + '</event>'
    assert adventure.party_line(event, peer)["text"] == '路牌写着 "A & B"'


def test_only_ordinary_armor_slots_can_be_prepared():
    from agent_mc_harness.body.loadout import armor_lua
    for slot in ("head","chest","legs","feet"):
        code=armor_lua(slot,False,SELF)
        assert "arena status --json" in code and "numen_hosted" in code
    with pytest.raises(ArgumentError): armor_lua("main",True,SELF)
    with pytest.raises(ArgumentError): armor_lua("head",1,SELF)

@pytest.mark.parametrize(("phase", "expected"), [
    ("payment_unconfirmed", "unknown"), ("verify_equipment", "failed"), ("verify_inventory", "failed"),
    ("insufficient_balance", "rejected"), ("purchased_to_queue", "completed"), ("equipped", "completed"),
])
def test_prepare_receipt_distinguishes_payment_collection_and_wear(phase, expected):
    from agent_mc_harness.body.loadout import armor_result
    receipt = armor_result(PortResult("completed", f"stdout:\nQD_ARMOR {phase} legs iron_leggings"), "legs")
    assert receipt.status == expected
    assert receipt.data["adventure"]["ready"] == (phase == "equipped")
    if expected in {"unknown", "failed"}:
        assert receipt.data["adventure"]["retryWrite"] is False


def test_ruin_prefers_real_equipment_blocker_over_generic_navigation():
    import json
    evidence = {"action": "start", "id": "temple", "success": False, "reason": "walk_to_first_room",
                "guidance": {"reason": "EQUIPMENT_REQUIRED", "nextAction": "缺少头盔、靴子。请先补齐装备"}}
    receipt = result("start_ruin", "MC_SITE_DUNGEON_RESULT " + json.dumps(evidence, ensure_ascii=False), id="temple")
    assert receipt.status == "rejected" and "头盔" in receipt.text
    assert receipt.data["adventure"]["missingEquipment"] == ["头盔", "靴子"]
    assert receipt.data["adventure"]["records"][0]["value"] == evidence


@pytest.mark.parametrize(("channel", "bound", "expect"), [
    ("mcp-event", PARTY, True), ("mcp-event", "23f101b4-77c4-4dc7-9329-74c7836ead1a", False),
    ("mcp-event", None, False),
])
def test_host_refreshes_membership_and_answers_only_once_in_same_party(tmp_path, channel, bound, expect):
    import asyncio
    import uuid
    from simbody import SimBody
    from test_server_npc import role
    from agent_mc_harness.journal import ActionJournal
    from agent_mc_harness.models import ActionReceipt, BodyAction
    from agent_mc_harness.npc import IDLE_GOAL, NpcHost
    from agent_mc_harness.runtime import PlanContext, Step

    async def run():
        cfg = role(adventure_partner=PEER, allowed_tools=["body:chat", "body:native:survey", "body:native:adventure_action", "body:native:adventure_query"])
        body, journal = SimBody(), ActionJournal(tmp_path / "party.sqlite")
        async def plan(_intent, ctx):
            if (ctx.party_context or {}).get("message"):
                assert ctx.party_context["message"]["replyChannel"] == "party_only"
                return [Step(tool="body:chat", args={"text": "入口见"})]
            return []
        host = NpcHost(cfg, body, plan, None, journal)
        event_id = "party:" + channel
        body.party_message = {"eventId": event_id, "at": int(time.time()*1000), "speaker": PEER, "text": "何处会合？", "partyId": bound}
        body_id = str(cfg.body_id)
        intent = host.runtime.submit_intent(IDLE_GOAL, agent=cfg.id)
        first = await host._plan(intent, PlanContext())
        assert [s.args for s in first] == [{"kind": "party"}]
        request = "qa_" + uuid.uuid4().hex
        journal.begin(body_id, BodyAction(verb="native", name=adventure.QUERY, args={"kind":"party"}, request_id=request))
        team = {"type": "party", "partyId": PARTY, "inParty": True, "phase": "together",
                "members": [{"name": PEER, "online": True, "sameWorld": True}]}
        fact = {"kind": "party", "at": int(time.time()), "records": [{"type":"MC_RPG","value":team}]}
        journal.settle(body_id, ActionReceipt(verb="native", status="completed", request_id=request, terminal=True, data={"adventure":fact}))
        steps = await host._plan(intent, PlanContext())
        if expect:
            assert [(s.tool, s.args) for s in steps] == [("body:native:adventure_action", {"kind":"party_chat","partyId":PARTY,"text":"入口见"})]
        else:
            assert not steps
        assert journal.handled(body_id, event_id)
        assert not await host._plan(intent, PlanContext())
        await host.close()
    asyncio.run(run())


def test_old_refused_dispatch_and_empty_wallet_offer_public_trial_entrance():
    at = int(time.time()) - 3
    old = {"at": at, "effect": "dispatched", "messages": ["[equipment_required] 增援需补齐：护腿；/mycli shop menu 购买或 /mycli stash 打开个人箱。 未传送、未耗魔。"]}
    prepared = {"at": at+1, "phase": "insufficient_balance"}
    evidence = adventure.meeting_recovery(old, prepared)
    assert evidence["effect"] == "refused" and evidence["alternative"] == "travel_trial"
    assert adventure.meeting_recovery({**old, "at": at-1000}, prepared) is None


def test_native_frame_handles_unescaped_ampersand_and_authored_punctuation():
    words = '<event kind="server_message" where="chat">VortexRPG » [Party] LifePeerQA: 甲 & 乙 &lt;入口&gt;</event>'
    event = SimpleNamespace(id="party-1", data={"nativeKind":"server_message","occurredAt":1000}, text=words)
    assert adventure.party_line(event)["text"] == "甲 & 乙 <入口>"

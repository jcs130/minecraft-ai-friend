import asyncio
import json
import time

import httpx
import pytest

from agent_mc_harness.body import adventure
from agent_mc_harness.journal import ActionJournal
from agent_mc_harness.models import BodyEvent, BodySnapshot, NativeAction
from agent_mc_harness.npc import DIALOGUE_GOAL, ModelClient, NpcHost, NpcPlanner, addressed_dialogue, reviewed_steps
from agent_mc_harness.runtime import Intent, PlanContext
from simbody import SimBody
from test_public_outing import NOW, PEER, record
from test_server_npc import role

SPEAKER = "20000000-0000-0000-0000-000000000021"


def nearby(actor, text, **changes):
    body = str(actor.body_id)
    return BodyEvent(kind="dialogue" if actor.body_kind == "maid" else "chat", body_kind=actor.body_kind, body_id=body, text=text,
                     data={"eventId": f"qdvoice:{SPEAKER}:npc_spoke", "speakerId": SPEAKER, "listenerId": body,
                           "serverAttributed": True, "deliveryScope": "nearby", "channel": "npc_chat", **changes})


@pytest.mark.parametrize(("kind", "name", "account"), [("numen", "桐人", "kirito"), ("maid", "结衣", "yui"), ("maid", "肥鱼", "feiyu")])
def test_named_nearby_teammate_evidence_is_bound_to_the_listener(kind, name, account):
    actor = role(id=account, name=name, body_kind=kind)
    accepts = lambda event: addressed_dialogue(event, str(actor.body_id), (name, account))
    assert accepts(nearby(actor, f"@{account} 一起走吗？"))
    assert accepts(nearby(actor, f"{name}，我们在入口碰面？"))
    assert not accepts(nearby(actor, f"我刚才跟{name}说过了。"))
    assert not accepts(nearby(actor, f"{name}，我们在入口碰面？", serverAttributed=False))
    assert not accepts(nearby(actor, f"{name}，我们在入口碰面？", listenerId=SPEAKER))
    assert not accepts(nearby(actor, f"{name}，我们在入口碰面？", eventId="plain-chat"))
    assert not accepts(nearby(actor, "可米，你先准备装备。"))


def test_direct_teammate_question_does_not_get_filtered_as_background_chat():
    async def run():
        actor = role()
        context = PlanContext(capabilities=SimBody().capabilities(), dialogue=[nearby(actor, "桐人，我们去门口会合？")])

        def answer(request):
            message = json.loads(request.content)["messages"][1]["content"]
            assert json.loads(message)["addressedEventIds"] == [context.dialogue[0].data["eventId"]]
            content = '{"steps":[{"tool":"body:chat","args":{"text":"好，在入口桥等你。"}}]}'
            return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})

        class Attention:
            async def allow_reply(self, *_args):
                pytest.fail("A named teammate question should reach the direct dialogue branch")

        client = ModelClient("http://127.0.0.1:4221/v1", "test", http=httpx.AsyncClient(transport=httpx.MockTransport(answer)))
        try:
            planner = NpcPlanner(actor, client, fast=Attention())
            steps = await planner(Intent(id="question", agent=actor.id, goal=DIALOGUE_GOAL), context)
            assert steps[0].args["text"] == "好，在入口桥等你。"
        finally:
            await client.close()
    asyncio.run(run())


def test_whale_profile_changes_both_sentence_suffixes_and_closing_only():
    action = {"tool": "body:chat", "args": {"text": "好喵，我们去看看喵～！"}}
    actor = role(body_kind="maid", speech_profile="whale")
    assert reviewed_steps(actor, PlanContext(), [action])[0].args["text"] == "好，我们去看看！"
    assert reviewed_steps(actor, PlanContext(), [{"tool": "body:chat", "args": {"text": "喵～"}}]) == []
    quoted = '牌子上写着「喵！」'
    assert reviewed_steps(actor, PlanContext(), [{"tool": "body:chat", "args": {"text": quoted}}])[0].args["text"] == quoted
    assert reviewed_steps(role(body_kind="maid"), PlanContext(), [action])[0].args["text"] == action["args"]["text"]


def party(actor, **changes):
    return {"type": "party", "available": True, "inviteStateKnown": True, "selfUuid": actor,
            "inParty": False, "phase": "not_in_party", "memberCount": 0, **changes}


def test_assembly_respects_current_roster_and_the_actual_inviter(monkeypatch):
    monkeypatch.setattr(adventure, "time", lambda: NOW)
    actor = "own-body"
    row = party(actor)
    assert adventure.assembly_action(record("MC_RPG", row), PEER, actor) == "create_party"
    assert adventure.assembly_action(record("MC_RPG", row, NOW - 91), PEER, actor) is None
    assert adventure.assembly_action(record("MC_RPG", row), PEER, "someone-else") is None
    invite = row | {"phase": "invited", "pendingInvite": {"inviter": PEER, "expiresInSeconds": 15}}
    assert adventure.assembly_action(record("MC_RPG", invite), PEER, actor) == "accept_invitation"
    assert adventure.assembly_action(record("MC_RPG", invite, NOW - 16), PEER, actor) is None
    assert adventure.assembly_action(record("MC_RPG", invite), "Visitor", actor) is None
    solo = row | {"inParty": True, "phase": "awaiting_teammates", "memberCount": 1, "leaderUuid": actor}
    assert adventure.assembly_action(record("MC_RPG", solo), PEER, actor) == "invite_partner"
    assert adventure.assembly_action(record("MC_RPG", solo | {"memberCount": 2}), PEER, actor) is None


def test_host_dispatches_one_bounded_rendezvous_then_reads_original_state(monkeypatch, tmp_path):
    actor = role(adventure_partner=PEER, autonomous_rendezvous=True,
                 allowed_tools=["body:native:adventure_query", "body:native:adventure_action", "body:native:survey"])
    journal = ActionJournal(tmp_path / "actions.sqlite3")
    body = SimBody()
    caps = body.capabilities()
    caps.native_actions += [NativeAction(name="adventure_action"), NativeAction(name="adventure_query")]
    context = PlanContext(capabilities=caps, snapshot=BodySnapshot(life_state="alive", health=20, max_health=20,
                            dimension="minecraft:overworld", position={"x": 5, "y": 67, "z": 10}))
    host = NpcHost(actor, body, None, None, journal)
    own = str(actor.body_id)
    current = record("MC_RPG", party(own), time.time())
    monkeypatch.setattr(journal, "last_adventure", lambda body_id, kind: current if body_id == own and kind == "party" else {})
    try:
        assert host._party_turn(own, context)[2].args == {"kind": "party"}
        assert host._party_turn(own, context)[2].args == {"kind": "create_party"}
        assert host._party_turn(own, context)[2].args == {"kind": "party"}
        assert host._party_turn(own, context)[2] is None
        context.snapshot.health = 2
        current["records"][0]["value"] = party(own, inParty=True, phase="awaiting_teammates", memberCount=1, leaderUuid=own)
        assert host._party_turn(own, context)[2] is None
    finally:
        host.unsubscribe()
        journal.close()

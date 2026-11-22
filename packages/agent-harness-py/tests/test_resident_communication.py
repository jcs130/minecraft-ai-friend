import asyncio
import hashlib
import json
from uuid import UUID, uuid4

import httpx
import pytest

from agent_mc_harness.journal import ActionJournal
from agent_mc_harness.models import ActionReceipt, BodyAction, BodyEvent
from agent_mc_harness.npc import DIALOGUE_GOAL, IDLE_GOAL, NpcHost, NpcPlanner
from agent_mc_harness.resident_protocol import prepare_scene, social_communication, speech_receipt, translate_answer
from agent_mc_harness.resident_turns import ResidentTurnsClient
from agent_mc_harness.runtime import Intent, PlanContext, intent_health
from simbody import SimBody
from test_server_npc import role


def event_for(actor, channel, text):
    body = str(actor.body_id)
    speaker = str(uuid4())
    return BodyEvent(kind="dialogue", body_kind=actor.body_kind, body_id=body, text=text,
                     data={"eventId": f"qdvoice:{speaker}:{channel}_{uuid4()}", "serverAttributed": True,
                           "listenerId": body, "maidId": body, "speaker": "Alice", "speakerId": speaker,
                           "deliveryScope": "nearby", "channel": channel})


@pytest.mark.parametrize("kind", ["maid", "numen"])
def test_body_replies_once_for_selected_speaker_and_leaves_other_event_pending(kind, tmp_path):
    async def run():
        actor = role(body_kind=kind)
        body = SimBody(body_id=str(actor.body_id))
        await body.spawn()
        one, two = event_for(actor, "chat", "看这里"), event_for(actor, "voice", "听得到吗")
        selected = two.data["eventId"]
        def handle(req):
            scene = json.loads(req.content)["scene"]
            messages = scene["communication"]["messages"]
            assert [(m["medium"], m["speakerId"]) for m in messages] == [
                ("text", one.data["speakerId"]), ("voice", two.data["speakerId"])]
            assert all(m["listenerId"] == str(actor.body_id) for m in messages)
            assert scene["communication"]["outputs"] == [
                {"mode": "native", "scope": "nearby", "sourceEventId": e.data["eventId"]} for e in (one,two)]
            assert "body:move" in {t["tool"] for t in scene["bodyTools"]}
            assert not any(t["tool"] == "body:native:lua" for t in scene["bodyTools"])
            return httpx.Response(200,json={"state":"answered","id":"owned-turn",
                "answer":{"communication":{"mode":"native","sourceEventId":selected,"text":"听得到。"}}})
        token = tmp_path/"token"
        token.write_text("key")
        client = ResidentTurnsClient(actor, {"endpoint":"https://example.test/api/v1/resident-turns/kirito","tokenFile":token},
                                     http=httpx.AsyncClient(transport=httpx.MockTransport(handle)))
        planner = NpcPlanner(actor, None, resident_turns=client)
        journal = ActionJournal(tmp_path/"journal.sqlite")
        host = NpcHost(actor, body, planner, None, journal)
        try:
            host._event(one)
            host._event(two)
            intent = Intent(id="two-speakers", agent=actor.id, goal=DIALOGUE_GOAL, source_events=list(host.pending_dialogue))
            steps = await host._plan(intent, PlanContext(snapshot=await body.snapshot(), capabilities=body.capabilities()))
            assert intent.source_events == [selected]
            assert steps[0].tool == "body:chat" and steps[0].args == {"text":"听得到。"}
            assert [s.args for s in steps[1:]] == ([{"eventId":selected}] if kind == "maid" else [])
            assert not journal.handled(str(actor.body_id), one.data["eventId"])
            secret = event_for(actor, "private", "只让本人看到")
            host._event(secret)
            host.runtime._on_body_event(secret)
            assert secret.data["eventId"] not in host.pending_dialogue
            assert all(row.text != secret.text for row in host.runtime.events)
        finally:
            host.unsubscribe()
            journal.close()
            await client.close()
    asyncio.run(run())


def test_social_mailbox_keeps_private_voice_tied_to_original_request():
    actor = role()
    row = {"id":str(uuid4()), "speakerId":str(uuid4()), "channel":"private", "medium":"voice",
           "message":"悄悄说", "replyModes":["native","text","speech"]}
    scene = prepare_scene(actor, "dialogue", {"communication":social_communication(actor,row)})
    send = {"sourceEventId":row["id"], "mode":"speech", "text":"听到了。"}
    answer, meta = translate_answer("dialogue", scene, {"communication":send})
    assert answer == {"reply":"听到了。"} and meta["residentCommunication"]["scope"] == "private"
    assert scene["bodyTools"] == [] and scene["communication"]["messages"][0]["medium"]=="voice"
    for change in ({"sourceEventId":str(uuid4())},{"mode":"public"},{"recipientId":str(uuid4())},{"sourceEventId":None}):
        with pytest.raises(ValueError):
            translate_answer("dialogue", scene, {"communication":{**send, **change}})
    older = social_communication(actor, {k:v for k,v in row.items() if k not in ("replyModes","medium")})
    assert "medium" not in older["messages"][0] and [o["mode"] for o in older["outputs"]] == ["native"]


def test_party_can_only_reply_in_current_team_and_proactive_only_nearby():
    actor = role(allowed_tools=["body:chat","body:native:adventure_action"])
    caps = {"actions":{"chat":{"native":"say","args":["text"]}},
            "native":[{"name":"adventure_action","schema":"a"}],"nativeSchemas":{"a":{"type":"object"}}}
    party={"message":{"from":"peer","eventId":"party:123","replyChannel":"party_only","text":"集合"}}
    scene=prepare_scene(actor,"plan",{"capabilities":caps,"adventuring":{"currentParty":party}})
    assert scene["communication"]["outputs"] == [{"scope":"party","mode":"text","sourceEventId":"party:123"}]
    assert scene["bodyTools"][0]["parameters"]["required"] == ["text"]
    with pytest.raises(ValueError):
        translate_answer("plan",scene,{"communication":{"mode":"native","sourceEventId":"party:123","text":"集合"}})
    scene=prepare_scene(actor,"plan",{"capabilities":caps})
    answer, route=translate_answer("plan",scene,{"communication":{"mode":"native","text":"早上好"}})
    assert answer["steps"][0]["args"]["text"]=="早上好" and route["residentCommunication"]["scope"]=="nearby"


def test_receipt_does_not_attribute_another_voice_job_to_this_reply():
    operation="req-original"
    voice_id="r_"+str(UUID(bytes=hashlib.md5(operation.encode()).digest(),version=3))
    observed={"deliveredPlayers":2,"voice":{"requestId":voice_id,"state":"sent"}}
    receipt=ActionReceipt(request_id=operation,verb="chat",status="completed",terminal=True,
                          data={"reply":{"data":{"operationId":operation,"observation":observed}}})
    assert speech_receipt(receipt)=={"requestId":operation,"status":"completed","captionRecipients":2,
                                     "hearingVerified":False,"voice":{"requestId":voice_id,"state":"sent"}}
    observed["voice"]["requestId"]="another-utterance"
    assert "voice" not in speech_receipt(receipt)


@pytest.mark.parametrize(("audience_distance", "leaves", "offered", "spoken"), [
    (None, False, False, False),
    (9, False, False, False),
    (5, False, True, True),
    (5, True, True, False),
])
def test_quiet_desktop_maid_can_greet_observed_nearby_players(audience_distance, leaves, offered, spoken, tmp_path):
    async def run():
        actor = role(body_kind="maid")
        listener = {"uuid": str(uuid4()), "name": "Alice", "dimension": "minecraft:overworld",
                    "position": {"x": audience_distance or 1, "y": 64, "z": 0}}

        class Maid(SimBody):
            nearby = [listener] if audience_distance is not None else []

            async def snapshot(self):
                snapshot = await super().snapshot()
                snapshot.raw.update({"nearbyPlayers": self.nearby, "characterDirectory": [listener]})
                return snapshot

        body = Maid(body_id=str(actor.body_id))
        await body.spawn()
        turn_id = str(uuid4())
        seen = []

        def handle(req):
            payload = json.loads(req.content)
            outputs = payload["scene"]["communication"]["outputs"]
            seen.append(outputs)
            assert payload["scene"]["communication"]["messages"] == []
            assert "If outputs is empty, skip game communication" in payload["instructions"]
            if leaves:
                body.nearby = []
            answer = {"communication": {"mode": "native", "text": "你好。"}} if outputs else {"steps": []}
            return httpx.Response(200, json={"state": "answered", "id": turn_id, "answer": answer})

        token = tmp_path / "token"
        token.write_text("fixture")
        client = ResidentTurnsClient(actor, {"endpoint": "https://example.test/api/v1/resident-turns/kirito", "tokenFile": token},
                                     http=httpx.AsyncClient(transport=httpx.MockTransport(handle)))
        journal = ActionJournal(tmp_path / "journal.sqlite")
        host = NpcHost(actor, body, NpcPlanner(actor, None, resident_turns=client), None, journal)
        try:
            intent = Intent(id="quiet-turn", agent=actor.id, goal=IDLE_GOAL, state="active")
            steps = await host._plan(intent, PlanContext(snapshot=await body.snapshot(), capabilities=body.capabilities()))
            assert seen == [[{"mode": "native", "scope": "nearby"}] if offered else []]
            assert [step.tool for step in steps] == (["body:chat"] if spoken else [])
            if spoken:
                game_receipt = await host.runtime._execute(steps[0], intent)
                await host._plan(Intent(id="next-quiet-turn", agent=actor.id, goal=IDLE_GOAL),
                                 context := PlanContext(snapshot=await body.snapshot(), capabilities=body.capabilities()))
                assert seen[-1] == []
                [receipt] = context.communication_receipts
                assert receipt["requestId"] == game_receipt.request_id
                assert receipt["turnHash"] == hashlib.sha256(turn_id.encode()).hexdigest()[:12]
        finally:
            await host.close()
            await client.close()
    asyncio.run(run())


@pytest.mark.parametrize(("answer", "rejection", "execute"), [
    ({"steps": []}, None, False),
    ({"steps": [{"tool": "body:move", "args": {"x": 5, "y": 64, "z": 0}}]}, None, True),
    ({"communication": {"mode": "text", "text": "private test marker"}}, ("translate_answer", "communication_not_available_for_this_turn"), False),
    ({"steps": [{"tool": "body:move", "args": {"ownerId": "private test marker"}}]}, ("validate_actions", "model_cannot_change_body_or_request_identity"), False),
    ({"steps": [{"tool": "body:move", "note": ["private test marker"]}]}, ("validate_actions", "schema_validation_error"), False),
])
def test_resident_turn_trace_distinguishes_planning_from_action_receipts(answer, rejection, execute, tmp_path, capsys):
    async def run():
        actor = role()
        body_id = str(actor.body_id)
        body = SimBody(body_id=body_id)
        body.effects["move"] = {"x": 5}
        await body.spawn()
        turn_id = str(uuid4())
        turn_hash = hashlib.sha256(turn_id.encode()).hexdigest()[:12]
        token = tmp_path / "token"
        token.write_text("private-token")
        def handle(req):
            return httpx.Response(200, json={"state": "answered", "id": turn_id, "answer": answer})
        client = ResidentTurnsClient(actor, {"endpoint": "https://example.test/api/v1/resident-turns/kirito", "tokenFile": token},
                                     http=httpx.AsyncClient(transport=httpx.MockTransport(handle)))
        journal_path = tmp_path / "journal.sqlite"
        journal = ActionJournal(journal_path)
        host = NpcHost(actor, body, NpcPlanner(actor, None, resident_turns=client), None, journal)
        try:
            intent = host.runtime.submit_intent(IDLE_GOAL, agent=actor.id)
            await host.runtime.run_intent(intent)
            status = intent_health(intent, journal, body_id)
            output = capsys.readouterr().out
            rows = [json.loads(line.removeprefix("resident_turn ")) for line in output.splitlines()
                    if line.startswith("resident_turn ")]
            assert rows[0]["stage"] == "decision_received"
            assert status["turnHash"] == turn_hash == host.planner.last_route["turnHash"]
            assert all(row["turnHash"] == turn_hash for row in rows)
            assert all(private not in output for private in (turn_id, "private test marker", "private-token"))
            completions = [e for e in host.runtime.events if e.kind == "task_completed"]
            if rejection:
                step, code = rejection
                assert status["planningStatus"] == "rejected"
                assert status["planningError"] == {"step": step, "code": code}
                assert status["completionKind"] is None and status["actionReceipts"] == [] and not completions
                rejected = rows[1]
                assert rejected["stage"] == "decision_rejected" and rejected["step"] == step and rejected["errorCode"] == code
                assert not body.acts and len(rows) == 2
            else:
                assert status["planningStatus"] == "completed"
                assert status["completionKind"] == ("body_actions" if execute else "planning")
                assert rows[1]["stage"] == "plan_completed" and rows[1]["plannedActionCount"] == int(execute)
                [event] = completions
                assert event.data["completionKind"] == status["completionKind"]
                assert event.data["bodyActionReceipts"] == status["actionReceipts"]
                assert event.data["turnHash"] == turn_hash and event.data["goalVerified"] is None
            if execute:
                [action] = body.acts
                [receipt] = status["actionReceipts"]
                request_hash = hashlib.sha256(action.request_id.encode()).hexdigest()[:12]
                assert receipt == {"requestHash": request_hash, "verb": "move", "status": "completed", "terminal": True}
                assert [row["stage"] for row in rows[2:]] == ["action_dispatched", "action_terminal"]
                assert all(row["requestHash"] == request_hash for row in rows[2:])
                assert action.request_id not in output
                assert (await body.snapshot()).position["x"] == 5
                reopened = ActionJournal(journal_path)
                try:
                    assert reopened.resident_turn_hash(action.request_id) == turn_hash
                    assert reopened.receipt(body_id, action.request_id).status == "completed"
                finally:
                    reopened.close()
        finally:
            await host.close()
            await client.close()
    asyncio.run(run())


def test_reconciliation_preserves_the_original_turn_and_request_hashes(tmp_path, capsys):
    path = tmp_path / "actions.sqlite"
    request_id = "original-move"
    turn_hash = "012345abcdef"
    receipt = ActionReceipt(request_id=request_id, verb="move", status="unknown", terminal=False)
    journal = ActionJournal(path)
    journal.begin("body", BodyAction(verb="move", request_id=request_id), resident_turn_hash=turn_hash)
    journal.settle("body", receipt)
    journal.close()

    journal = ActionJournal(path)
    try:
        [pending] = journal.unresolved("body")
        assert pending.request_id == request_id
        result = receipt.model_copy(update={"status": "completed", "terminal": True})
        journal.settle("body", result)
        journal.settle("body", result)
        assert not journal.unresolved("body")
    finally:
        journal.close()

    rows = [json.loads(line.removeprefix("resident_turn ")) for line in capsys.readouterr().out.splitlines()]
    assert [(row["stage"], row["status"]) for row in rows] == [("action_result", "unknown"), ("action_terminal", "completed")]
    assert {row["turnHash"] for row in rows} == {turn_hash}
    assert {row["requestHash"] for row in rows} == {hashlib.sha256(request_id.encode()).hexdigest()[:12]}

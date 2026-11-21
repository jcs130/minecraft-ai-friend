import asyncio
import json
from types import SimpleNamespace

import pytest

from agent_mc_harness.body import adventure
from agent_mc_harness.body.base import ArgumentError
from agent_mc_harness.body.numen import NumenBody, PortResult
from agent_mc_harness.models import BodyAction, BodyIdentity, NativeAction, Scope


ACTOR = "75ef67b3-b865-49ba-807f-447a46248b44"
CID = "vq_6a13bc7d10dd4f43"
OTHER = "vq_c0213456789abcde"


def card(state="open", progress=0):
    return {"id": CID, "title": "给面包房送小麦", "issuer": "青禾", "type": "gather",
            "target": "minecraft:wheat", "quantity": 6, "progress": progress, "status": state,
            "deadlineAt": 1795500000000, "location": {"world": "minecraft:overworld", "x": -7, "y": 74, "z": 9}}


def wire(action, outcome="observed", **fields):
    envelope = {"schemaVersion": 1, "observedAt": 1795400000100, "source": "villager_quests",
                "action": action, "status": outcome, **fields}
    return PortResult("completed", "stdout:\nMC_VILLAGE_GUILD " + json.dumps(envelope, ensure_ascii=False))


def read(native, kind, **args):
    name = adventure.ACT if kind in {"accept", "deliver"} else adventure.QUERY
    return adventure.game_result(native, name, {"kind": "village_" + kind, **args}, body_id=ACTOR)


@pytest.mark.parametrize(("name", "args", "expected"), [
    (adventure.QUERY, {"kind": "village_list", "page": 2}, "list 2"),
    (adventure.QUERY, {"kind": "village_list"}, "list"),
    (adventure.QUERY, {"kind": "village_info", "id": CID}, f"info {CID}"),
    (adventure.QUERY, {"kind": "village_status"}, "status"),
    (adventure.ACT, {"kind": "village_accept", "id": CID}, f"accept {CID}"),
    (adventure.ACT, {"kind": "village_deliver", "id": CID}, f"deliver {CID}"),
])
def test_scoped_command(name, args, expected):
    assert adventure.player_command(name, args, "QaKirito", None) == "/mycli guild village " + expected


@pytest.mark.parametrize("args", [
    {"kind": "village_accept"}, {"kind": "village_deliver", "id": "some_quest"},
    {"kind": "village_accept", "id": CID + " next"}, {"kind": "village_deliver", "id": CID, "actorUuid": ACTOR},
    {"kind": "village_list", "page": False}, {"kind": "village_list", "page": 10000},
])
def test_reject_unscoped_arguments(args):
    with pytest.raises(ArgumentError):
        adventure.player_command(adventure.QUERY if "list" in args["kind"] else adventure.ACT, args, "QaKirito", None)


def test_live_board_uses_server_clamped_page_and_owner_status():
    result = read(wire("list", cards=[card()], page=1, pageSize=12, pages=1, total=1), "list", page=3)
    assert result.status == "completed"
    value = result.data["adventure"]["records"][0]["value"]
    assert value["cards"][0]["id"] == CID and value["page"] == 1
    assert read(wire("list", cards=[], page=1, pageSize=12, pages=1, total=0), "list").status == "completed"
    assert read(wire("status", active=[card("accepted")]), "status").status == "completed"
    assert read(wire("info", card=card()), "info", id=CID).status == "completed"
    assert read(wire("info", card=card()), "info", id=OTHER).status == "failed"


def test_long_index_requires_complete_count_distinct_valid_ids_and_exposes_detail_route():
    receipt = wire("list", cards=[{"id": CID}, {"id": OTHER}], indexOnly=True, page=1, pages=1, pageSize=12, total=2)
    sample = read(receipt, "list")
    assert sample.status == "completed" and "village_info" in sample.text
    for ids, total in (([CID, CID], 2), ([CID], 2), (["not_a_quest"], 1)):
        bad = wire("list", cards=[{"id": requested} for requested in ids], indexOnly=True,
                   page=1, pages=1, pageSize=12, total=total)
        assert read(bad, "list").status == "failed"


@pytest.mark.parametrize(("action", "outcome", "state", "progress", "counted"), [
    ("accept", "accepted", "accepted", 0, None), ("accept", "already_accepted", "accepted", 2, None),
    ("deliver", "progress", "accepted", 2, 2), ("deliver", "completed", "completed", 6, 4),
])
def test_native_effects_distinguish_settlement(action, outcome, state, progress, counted):
    extra = {"counted": counted} if counted is not None else {}
    sample = read(wire(action, outcome, card=card(state, progress), **extra), action, id=CID)
    assert sample.status == "completed" and sample.data["adventure"]["effect"] == outcome
    assert sample.data["adventure"]["retryWrite"] is False


@pytest.mark.parametrize(("action", "outcome"), [
    ("accept", "offer_unavailable"), ("accept", "hero_uses_bridge"), ("accept", "permission_denied"),
    ("deliver", "no_delivery"), ("deliver", "issuer_out_of_reach"), ("deliver", "nothing_delivered"),
])
def test_native_refusals_are_explained(action, outcome):
    receipt = read(wire(action, outcome), action, id=CID)
    assert receipt.status == "rejected" and outcome in receipt.text


@pytest.mark.parametrize("bad", [
    wire("deliver", "completed", card=card("completed", 6), counted=0),
    wire("deliver", "completed", card=card("accepted", 2), counted=2),
    wire("deliver", "progress", card=card("accepted", 2), counted=3),
    wire("deliver", "completed", card={**card("completed", 6), "type": "slay"}, counted=6),
    wire("deliver", "completed", card={**card("completed", 6), "id": OTHER}, counted=2),
    wire("accept", "accepted", card=card("accepted")),
    wire("deliver", "completed", source="other", card=card("completed", 6), counted=6),
    wire("deliver", "completed", actorUuid="wrong", card=card("completed", 6), counted=6),
    wire("deliver", ["completed"], card=card("completed", 6), counted=6),
    wire("deliver", "unavailable"), PortResult("completed", 'stdout:\nMC_VILLAGE_GUILD {"schemaVersion":1'),
])
def test_uncertain_write_never_becomes_completed_or_repeatable(bad):
    receipt = read(bad, "deliver", id=CID)
    assert receipt.status == "unknown" and receipt.data["adventure"]["retryWrite"] is False


def test_original_body_queries_original_uncertain_write_without_resending():
    async def run():
        writes, reads = [], []

        async def call(name, args, request_id):
            writes.append((name, args, request_id))
            return PortResult("unknown", "Connection interrupted")

        async def result(request_id):
            reads.append(request_id)
            return wire("deliver", "completed", card=card("completed", 6), counted=4)

        port = SimpleNamespace(transport="numen-hosted-mcp", dialect="numen-hosted-0.1.5",
                               catalog=lambda: [NativeAction(name="lua")], call=call, result=result)
        body = NumenBody(port, scope=Scope(realm="qa", account="owner", agent="actor"))
        body._identity = BodyIdentity(kind="numen", body_id=ACTOR, name="QaKirito", scope=body.scope)
        body._set_state("ready")
        action = BodyAction(verb="native", name=adventure.ACT, args={"kind": "village_deliver", "id": CID},
                            request_id="qa_village_delivery_01")
        assert (await body.act(action)).status == "unknown"
        complete = await body.result(action.request_id)
        assert complete.status == "completed" and complete.data["adventure"]["effect"] == "completed"
        assert (await body.act(action)).request_id == action.request_id and len(writes) == 1
        assert writes[0][2] == action.request_id and reads == [action.request_id]
        assert "allow command(mycli) @QaKirito" in writes[0][1]["code"]
        assert f"/mycli guild village deliver {CID}" in writes[0][1]["code"]

    asyncio.run(run())


def test_old_accept_quest_name_reads_exact_village_receipt_from_the_original_request():
    async def run():
        reads = []

        async def result(request_id):
            reads.append(request_id)
            return wire("accept", "accepted", card=card("accepted"))

        async def no_send(*args):
            pytest.fail("recovering a previous request sent a new command")

        port = SimpleNamespace(transport="numen-hosted-mcp", dialect="numen-hosted-0.1.5",
                               catalog=lambda: [NativeAction(name="lua")], result=result, call=no_send)
        body = NumenBody(port, scope=Scope(realm="qa", account="owner", agent="actor"))
        body._identity = BodyIdentity(kind="numen", body_id=ACTOR, name="QaKirito", scope=body.scope)
        action = BodyAction(verb="native", name=adventure.ACT, args={"kind": "accept_quest", "id": CID},
                            request_id="qa_old_vq_accept")
        # Restore the unknown request recorded by the old process with its original spelling.
        body.restore_request(action)
        original = await body.result(action.request_id)
        assert reads == [action.request_id] and original.status == "completed"
        assert original.data["adventure"]["kind"] == "accept_quest" and original.data["adventure"]["effect"] == "accepted"
        assert adventure.player_command(action.name, action.args, "QaKirito", None) == "/mycli guild accept " + CID
        mismatched = adventure.game_result(wire("accept", "accepted", card=card("accepted")), action.name,
                                           {"kind": "accept_quest", "id": OTHER}, body_id=ACTOR)
        assert mismatched.status == "unknown"

    asyncio.run(run())

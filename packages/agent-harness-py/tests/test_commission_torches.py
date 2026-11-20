import asyncio
import json
from types import SimpleNamespace

import pytest

from agent_mc_harness.body import adventure
from agent_mc_harness.body.numen import NumenBody, PortResult
from agent_mc_harness.models import BodyAction, Scope


def guild(**changes):
    market = {"id": "tm_local_mine_journal", "available": True, "stage": 1, "goal": "CRAFT",
              "progress": 0, "target": 1, "ready": False, "guidance": {"nextAction": "亲手合成 TORCH；完成后查进度。"}}
    market.update(changes)
    return "MC_ADVENTURE " + json.dumps({"guild": {"activeId": market["id"], "status": "active", "market": market}},
                                         ensure_ascii=False, separators=(",", ":"))


def controller(lines, recovered=None):
    calls = []
    async def call(tool, args, request_id):
        calls.append((request_id, args["code"]))
        return lines.pop(0)
    async def result(request_id):
        calls.append((request_id, None))
        return recovered
    port = SimpleNamespace(transport="numen-hosted-mcp", call=call, result=result, recorded=lambda _: True)
    body = NumenBody(port, scope=Scope(realm="qa", account="qa", agent="qa"), adventure_partner="QaFriend")
    body._identity = SimpleNamespace(name="QaKirito", body_id="qa")
    return body, calls


@pytest.mark.parametrize("change", [{"ready": True}, {"progress": 1}, {"goal": "KILL"}, {"stage": 2},
                                    {"id":"other"}, {"guidance":{"nextAction": "亲手合成 SHIELD"}}])
def test_refuses_stale_or_other_contract_before_native_craft(change):
    body, calls = controller([PortResult("completed", "stdout:\n" + guild(**change))])
    actual = asyncio.run(body._adventure(adventure.ACT, {"kind": "craft_torches", "expectedProgress": 0}, "torch_old"))
    assert actual.status == "rejected" and len(calls) == 1
    assert "inv.craft" not in calls[0][1]


@pytest.mark.parametrize(("evidence", "status"), [
    ("QD_TORCH missing_materials", "rejected"), ("QD_TORCH stage_changed", "rejected"),
    ("QD_TORCH counts 2 1 3 11 1 1 2 15 4", "completed"),
    ("QD_TORCH counts 0 1 2 0 0 0 1 4 4", "completed"),
    ("QD_TORCH counts 2 1 3 11 2 1 3 11 error", "failed"),
    ("QD_TORCH counts 2 1 3 11 1 1 2 11 error", "unknown"),
    ("QD_TORCH counts 2 1 3 11 1 1 2 11 4", "unknown"), ("success", "unknown"),
])
def test_worker_verifies_actual_backpack_deltas(evidence, status):
    current = guild()
    body, calls = controller([PortResult("completed", "stdout:\n" + current), PortResult("completed", "stdout:\n" + evidence)])
    result = asyncio.run(body._adventure(adventure.ACT, {"kind": "craft_torches", "expectedProgress": 0}, "torch_qa"))
    assert calls[-1][0] == "torch_qa" and calls[-1][1].count("inv.craft(") == 1
    assert "/mycli guild shared" not in calls[-1][1]
    assert result.status == status
    if status == "completed":
        assert result.data["adventure"]["crafted"] == 4
        assert result.data["adventure"]["creditVerified"] is False


def test_lookup_after_restart_reads_only_original_id():
    body, calls = controller([], recovered=PortResult("completed","stdout:\nQD_TORCH counts 1 0 1 0 0 0 0 4 4"))
    original = "qa_original_craft"
    body.restore_request(BodyAction(verb="native", name=adventure.ACT, args={"kind":"craft_torches","expectedProgress":0},
                                    request_id=original))
    result = asyncio.run(body.result(original))
    assert calls == [(original, None)] and result.status == "completed"
    assert result.data["adventure"]["crafted"] == 4


def test_interrupted_stage_read_cannot_submit_a_new_craft():
    body, calls = controller([])
    body.port.recorded = lambda _: False
    original = "qa_read_interrupted"
    body.restore_request(BodyAction(verb="native", name=adventure.ACT,
                                    args={"kind":"craft_torches","expectedProgress":0}, request_id=original))
    assert asyncio.run(body.result(original)).status == "rejected"
    assert calls == []

def test_planner_can_choose_one_batch_and_observes_stale_or_missing_stock(tmp_path):
    from simbody import SimBody
    from test_server_npc import role
    from agent_mc_harness.journal import ActionJournal
    from agent_mc_harness.models import ActionReceipt
    from agent_mc_harness.npc import IDLE_GOAL, NpcHost, NpcPlanner
    from agent_mc_harness.runtime import PlanContext

    async def run():
        body = SimBody()
        await body.spawn()
        allowed = ["body:native:adventure_query", "body:native:adventure_action", "body:inventory", "body:native:survey"]
        cfg = role(adventure_partner="QaFriend", allowed_tools=allowed)
        journal = ActionJournal(tmp_path/"actions.sqlite3")
        facts = []
        async def reply(path, data, timeout):
            ctx = json.loads(data["messages"][1]["content"])
            stage = ctx["adventuring"].get("currentCraftStage") or {}
            facts.append(stage)
            proposed = {"tool":"body:native:adventure_action","args":{"kind":"craft_torches","expectedProgress":0}}
            return {"choices":[{"message":{"content":json.dumps({"steps":[proposed]})}}]}
        host = NpcHost(cfg, body, NpcPlanner(cfg, SimpleNamespace(request=reply)), None, journal)
        caps = body.capabilities()
        caps.native_actions = adventure.catalogue("QaFriend")
        context = PlanContext(snapshot=await body.snapshot(),capabilities=caps)
        host.next_roster_check = float("inf")
        intent = host.runtime.submit_intent(IDLE_GOAL, agent=cfg.id)
        owner = str(cfg.body_id)
        def record(action, data):
            journal.begin(owner, action)
            journal.settle(owner, ActionReceipt(verb=action.verb, request_id=action.request_id,
                                                status="completed", terminal=True, data=data))
        def quest(rid):
            response = PortResult("completed","stdout:\n"+guild())
            sample = adventure.game_result(response, adventure.QUERY, {"kind":"quest_status"})
            record(BodyAction(verb="native",name=adventure.QUERY,args={"kind":"quest_status"},request_id=rid),sample.data)
        def attempted(rid, effect):
            record(BodyAction(verb="native",name=adventure.ACT,args={"kind":"craft_torches","expectedProgress":0},request_id=rid),
                   {"adventure":{"kind":"craft_torches","effect":effect,"requestId":rid,"progressBefore":0}})
        try:
            quest("qa_read_0001")
            choices = await host._plan(intent,context)
            assert facts[-1]["craftOption"]["args"] == choices[0].args == {"kind":"craft_torches","expectedProgress":0}
            attempted("qa_miss_0001","missing_materials")
            assert [s.args for s in await host._plan(intent,context)] == [{"kind":"quest_status"}]
            quest("qa_read_0002")
            assert await host._plan(intent,context) == [] and "craftOption" not in facts[-1]
            assert "public supply chest" in facts[-1]["materials"] and facts[-1]["otherActivities"]
            record(BodyAction(verb="inventory",request_id="qa_stock_001"),
                   {"inventory":[{"itemId":"minecraft:charcoal","count":1},{"itemId":"minecraft:stick","count":1}]})
            assert [s.args for s in await host._plan(intent,context)] == [{"kind":"craft_torches","expectedProgress":0}]
            attempted("qa_craft_0001","crafted")
            quest("qa_read_0003")  # Artifacts exist, but the guild has not credited this stage.
            assert await host._plan(intent,context) == [] and "craftOption" not in facts[-1]
        finally:
            await host.close()
            journal.close()
    asyncio.run(run())

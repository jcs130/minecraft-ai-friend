"""Exercise received messages through the actual request/acknowledgement seam."""
import copy
import json

from agent_mc_autonomy.context import assemble
from test_controller import choose, setup


def private(cursor=1):
    return {"run": "run-1", "cursor": cursor, "type": "minecraft.chat", "trigger": "interrupt",
            "text": "[MC 私聊] Alex: 东边的树有保护，请到河对岸采集。", "senderKey": "Alex",
            "meta": {"uname": "Alex", "socialScope": "minecraft-server",
                     "identityEvidence": "packet-sender", "senderUuid": "uuid-alex"}}


def noise(cursor):
    return {"run": "run-1", "cursor": cursor, "type": "minecraft.chat", "trigger": "piggyback",
            "text": "[MC 系统] MC_STATUS 当前读数 " + str(cursor)}


def test_private_identity_and_earlier_rejection_survive_telemetry_and_budget():
    denial = {"run": "run-1", "cursor": 2, "type": "minecraft.task", "trigger": "flush",
              "text": "[MC 系统] 这块属于村庄原有建筑，不允许破坏。",
              "execution": {"id": "task-1", "terminal": True, "phase": "blocked"}}
    events = [private(), denial, *[noise(i) for i in range(3, 64)]]
    before = copy.deepcopy(events)
    messages, budget = assemble("stable", [], "survive", {"parts": []}, events, [],
                                context_tokens=9000, reserved_output=1024)
    shown = json.loads(messages[-1]["content"])["events"]
    assert any(e["cursor"] == 2 and "村庄原有建筑" in e["text"] for e in shown)
    received = next(e for e in shown if e["cursor"] == 1)
    assert received["senderKey"] == "Alex"
    assert received["meta"]["identityEvidence"] == "packet-sender"
    assert received["original"]["after"] == 0
    assert len(shown) <= 24 and budget["total"] <= 9000
    assert budget["event_delivery"]["included_indices"] == [events.index(e) for e in events if e["cursor"] in {row["cursor"] for row in shown}]
    assert events == before


def test_only_events_in_actual_model_request_are_consumed(framework_module, tmp_path, run_async):
    captured = []

    async def decide(messages, _):
        captured.append(messages)
        return choose()

    module, bridge, controller = setup(framework_module, tmp_path, decide)
    supplied = [private(), *[noise(i) for i in range(2, 51)]]
    controller.receipt({"events": supplied})
    run_async(controller.turn_once("survive", "stable", module.model_tools(bridge.tools)))
    shown = json.loads(captured[0][-1]["content"])["events"]
    shown_ids = {e["cursor"] for e in shown}
    assert 1 in shown_ids
    assert {e["cursor"] for e in controller.recent} == {e["cursor"] for e in supplied} - shown_ids
    recorded = json.loads((tmp_path / "decisions.jsonl").read_text(encoding="utf-8"))
    refs = recorded["context_delivery"]["included_refs"]
    assert {ref["cursor"] for ref in refs} == shown_ids
    assert all(ref["run"] == "run-1" for ref in refs)
    assert "河对岸" not in json.dumps(recorded["context_delivery"], ensure_ascii=False)


def test_pending_private_message_survives_bounded_backlog(framework_module, tmp_path):
    async def unused(*_):
        raise AssertionError("No inference in receipt retention test")

    _, _, controller = setup(framework_module, tmp_path, unused)
    controller.receipt({"events": [private()]})
    controller.receipt({"events": [noise(i) for i in range(2, 102)]})
    assert len(controller.recent) == 64
    assert controller.recent[0]["cursor"] == 1
    assert [e["cursor"] for e in controller.recent] == sorted(e["cursor"] for e in controller.recent)

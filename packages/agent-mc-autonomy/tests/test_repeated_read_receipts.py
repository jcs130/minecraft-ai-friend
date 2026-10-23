"""A native same-turn read pointer must survive planner history eviction."""

import copy
import json

import pytest
from test_controller import setup

from agent_mc_autonomy.context import assemble, encode

REPEATED = "这轮已经答过了,答案不会变,先看上一条。"
READ_TOOLS = ("mc_bag", "mc_queue", "mc_blocked")
BAG = ("[背包] 11/36 格占着,空 25 格。\n"
       "包里:橡木原木×22、梯子×3、木锹 耐久59/59×3、工作台×2、"
       "木锄 耐久59/59×2、箱子×1、木镐 耐久59/59×1、皮革×1。\n"
       "工具物品名:ladder、chest、wooden_pickaxe、wooden_shovel、oak_log、"
       "crafting_table、wooden_hoe、leather。\n手里拿着木镐。\n鼠标光标空着。\n身上没穿护甲。\n副手空着。")


def receipt(text, request_id, turn="native-turn", **changes):
    return {"protocol": "agent-mc/v1", "text": text, "failed": False,
            "endsTurn": False, "execution": None, "events": [], "blobs": [],
            "control": {"requestId": request_id, "turnId": turn, "barrierAfter": False,
                        "endTurnRequested": False, "turnEnded": False}, **changes}


def exchange(call_id, tool, content):
    return [{"role": "assistant", "content": None, "tool_calls": [{
        "id": call_id, "type": "function", "function": {"name": tool, "arguments": "{}"}}]},
        {"role": "tool", "tool_call_id": call_id, "content": content}]


@pytest.mark.parametrize("name", READ_TOOLS)
def test_repeat_resolves_same_turn_projected_answer_without_requery(
        framework_module, tmp_path, run_async, name):
    _, bridge, controller = setup(framework_module, tmp_path, None)
    controller.turn = "native-turn"
    first = receipt(BAG, "first")
    repeated = receipt(REPEATED, "repeat", endsTurn=True)
    before = copy.deepcopy((first, repeated))
    answer = run_async(controller.archive_receipt("first", name, first))
    view = json.loads(run_async(controller.archive_receipt("repeat", name, repeated)))
    assert view["resolved_same_turn"] is True
    assert view["previous_answer"] == {
        "request_id": "first", "turn_id": "native-turn", "answer": json.loads(answer)}
    assert view["text"] == REPEATED
    assert view["failed"] is False and view["endsTurn"] is True and view["execution"] is None
    assert bridge.calls == []
    assert (first, repeated) == before
    journal = [json.loads(line) for line in (tmp_path / "receipts.jsonl").read_text(encoding="utf-8").splitlines()]
    assert [row["result"] for row in journal] == [first, repeated]
    assert "previous_answer" not in journal[-1]["result"]


def test_full_bag_then_scout_then_pointer_only_request_keeps_the_actual_answer(
        framework_module, tmp_path, run_async):
    _, bridge, controller = setup(framework_module, tmp_path, None)
    controller.turn = "native-turn"
    bag = run_async(controller.archive_receipt("bag-1", "mc_bag", receipt(BAG, "bag-1")))
    scout = run_async(controller.archive_receipt("scout-1", "mc_scout", receipt(
        "任务#8 收下了，读取射线和体素，尚未完成。", "scout-1",
        execution={"kind": "task", "id": "8", "phase": "accepted", "terminal": False})))
    pointer = run_async(controller.archive_receipt("bag-2", "mc_bag", receipt(REPEATED, "bag-2")))
    groups = [exchange("bag-1", "mc_bag", bag), exchange("scout-1", "mc_scout", scout),
              exchange("bag-2", "mc_bag", pointer)]
    facts = {"parts": [{"key": "body", "text": "health 10/20, food 13/20"},
                       {"key": "lastTask", "text": "task#8 completed: " + "observed rays; " * 80,
                        "original": "log:completed-scout"}]}
    empty, _ = assemble("stable", [], "Find food, then build a safe shelter.", facts, [], [],
                        context_tokens=32768, reserved_output=2048)
    expected = empty[:2] + groups[-1] + empty[-1:]
    limit = len(encode({"messages": expected, "tools": []}).encode()) + 2048 + 1024 + 30
    messages, budget = assemble("stable", [], "Find food, then build a safe shelter.", facts, [], groups,
                                context_tokens=limit, reserved_output=2048)
    assert [m["tool_call_id"] for m in messages if m["role"] == "tool"] == ["bag-2"]
    view = json.loads(next(m["content"] for m in messages if m["role"] == "tool"))
    assert view["previous_answer"]["answer"]["text"] == BAG
    assert view["previous_answer"]["request_id"] == "bag-1"
    assert view["resolved_same_turn"] is True and budget["total"] <= limit
    assert bridge.calls == []


@pytest.mark.parametrize("changed_text", ["橡木原木库存：22；对应参数 item=oak_log", "橡木原木库存：21；状态已改变"])
def test_new_substantive_answer_replaces_previous_and_failures_do_not(
        framework_module, tmp_path, run_async, changed_text):
    _, bridge, controller = setup(framework_module, tmp_path, None)
    controller.turn = "native-turn"
    run_async(controller.archive_receipt("first", "mc_bag", receipt(BAG, "first")))
    changed = run_async(controller.archive_receipt("changed", "mc_bag", receipt(changed_text, "changed")))
    run_async(controller.archive_receipt("failed", "mc_bag", receipt("Read failed", "failed", failed=True)))
    for request_id in ("repeat-1", "repeat-2"):
        view = json.loads(run_async(controller.archive_receipt(request_id, "mc_bag", receipt(REPEATED, request_id))))
        assert view["previous_answer"] == {
            "request_id": "changed", "turn_id": "native-turn", "answer": json.loads(changed)}
        assert "previous_answer" not in view["previous_answer"]["answer"]
    assert bridge.calls == []


@pytest.mark.parametrize("turn", [None, "different-turn"])
def test_missing_same_turn_answer_is_explicitly_unresolved(framework_module, tmp_path, run_async, turn):
    _, bridge, controller = setup(framework_module, tmp_path, None)
    controller.turn = "native-turn"
    run_async(controller.archive_receipt("first", "mc_bag", receipt(BAG, "first")))
    controller.turn = turn
    view = json.loads(run_async(controller.archive_receipt("repeat", "mc_bag", receipt(REPEATED, "repeat", turn))))
    assert view["resolved_same_turn"] is False
    assert view["unresolved_reference"] and "previous_answer" not in view
    assert view["text"] == REPEATED and bridge.calls == []


def test_failed_only_answer_cannot_resolve_a_repeat(framework_module, tmp_path, run_async):
    _, bridge, controller = setup(framework_module, tmp_path, None)
    controller.turn = "native-turn"
    run_async(controller.archive_receipt("failure", "mc_bag", receipt("Read failed", "failure", failed=True)))
    view = json.loads(run_async(controller.archive_receipt("repeat", "mc_bag", receipt(REPEATED, "repeat"))))
    assert view["resolved_same_turn"] is False and "previous_answer" not in view
    assert bridge.calls == []


def test_repeat_projection_preserves_current_failure_and_execution(framework_module, tmp_path, run_async):
    _, bridge, controller = setup(framework_module, tmp_path, None)
    controller.turn = "native-turn"
    run_async(controller.archive_receipt("first", "mc_queue", receipt("Current queue", "first")))
    execution = {"kind": "task", "id": "current", "phase": "failed", "terminal": True}
    repeated = receipt(REPEATED, "repeat", failed=True, endsTurn=True, execution=execution)
    view = json.loads(run_async(controller.archive_receipt("repeat", "mc_queue", repeated)))
    assert view["failed"] is True and view["endsTurn"] is True and view["execution"] == execution
    assert view["previous_answer"]["request_id"] == "first"
    assert bridge.calls == []


def test_queue_burst_notice_cannot_replace_substantive_answer(framework_module, tmp_path, run_async):
    _, bridge, controller = setup(framework_module, tmp_path, None)
    controller.turn = "native-turn"
    answer = run_async(controller.archive_receipt("queue", "mc_queue", receipt("任务#8 正在执行", "queue")))
    notice = receipt("[mc_queue] 队列状态未变；等任务或战斗结果事件再查。", "burst", endsTurn=True)
    burst = json.loads(run_async(controller.archive_receipt("burst", "mc_queue", notice)))
    assert burst["text"] == notice["text"] and burst["endsTurn"] is True
    assert "resolved_same_turn" not in burst
    view = json.loads(run_async(controller.archive_receipt("repeat", "mc_queue", receipt(REPEATED, "repeat", endsTurn=True))))
    assert view["previous_answer"]["answer"] == json.loads(answer)
    assert view["previous_answer"]["request_id"] == "queue" and view["endsTurn"] is True
    assert bridge.calls == []


@pytest.mark.parametrize(("name", "text"), [("mc_help", REPEATED), ("mc_bag", REPEATED + " "), ("mc_bag", "\n" + REPEATED)])
def test_only_known_native_tools_and_exact_receipt_are_resolved(
        framework_module, tmp_path, run_async, name, text):
    _, _, controller = setup(framework_module, tmp_path, None)
    controller.turn = "native-turn"
    run_async(controller.archive_receipt("first", name, receipt("Original", "first")))
    view = json.loads(run_async(controller.archive_receipt("next", name, receipt(text, "next"))))
    assert "resolved_same_turn" not in view and "previous_answer" not in view
    assert view["text"] == text


def test_large_answer_reuses_compact_preview_and_existing_original_handles(
        framework_module, tmp_path, run_async):
    _, bridge, controller = setup(framework_module, tmp_path, None)
    controller.turn = "native-turn"
    large = receipt("完整原始背包详情。" * 3000, "large")
    first = json.loads(run_async(controller.archive_receipt("large", "mc_bag", large)))
    calls_before = copy.deepcopy(bridge.calls)
    view = json.loads(run_async(controller.archive_receipt("repeat", "mc_bag", receipt(REPEATED, "repeat"))))
    assert view["previous_answer"]["answer"] == first
    assert first["original_chunks"] and len(first["text"].encode()) <= 2800
    assert len(encode(view).encode()) < 6000
    assert all(name == "mc_artifact" and args["action"] == "put" for name, args, _ in calls_before)
    assert bridge.calls == calls_before


def test_cache_is_bounded_to_three_tools_and_cleared_on_turn_change(framework_module, tmp_path, run_async):
    _, bridge, controller = setup(framework_module, tmp_path, None)
    controller.turn = "native-turn"
    for name in (*READ_TOOLS, "mc_help", "mc_scout"):
        run_async(controller.archive_receipt(name, name, receipt("Answer for " + name, name)))
    assert set(controller._read_once_answers) == set(READ_TOOLS)
    controller.turn = "next-turn"
    run_async(controller.archive_receipt("unrelated", "mc_help", receipt("Help", "unrelated", "next-turn")))
    assert controller._read_once_answers == {}
    assert bridge.calls == []

import json
import uuid
from datetime import datetime, timezone

import pytest

from agent_mc_autonomy.host_context import HostContextPort
from agent_mc_autonomy.review import ReviewPolicy, ReviewPort


def snapshot(now, **changes):
    return {"phase": "running", "game_connected": True, "owner_pid": 123,
            "updated_at": datetime.fromtimestamp(now, timezone.utc).isoformat(), "standing_goal": "安全生存",
            "current_goal": None, "pending": [], "facts": {"parts": [
                {"key": "body", "text": "生命20/20，饥饿20/20"}, {"key": "gear", "text": "木镐×1"},
                {"key": "foodReserve", "text": "随身口粮0个"}, {"key": "queue", "text": "手上没有在做的事"}]}, **changes}


@pytest.fixture
def runtime(tmp_path):
    clock = [10000]
    port = ReviewPort(tmp_path, now=lambda: clock[0])
    port.configure(ReviewPolicy(enabled=True))

    def publish(**changes):
        value = snapshot(clock[0], **changes)
        (tmp_path / "status.json").write_text(json.dumps(value), encoding="utf-8")
        port.observe(value)
        return value

    return port, clock, publish


def test_review_shares_context_after_its_own_intent_revision_and_keeps_private_data_out_of_state(runtime):
    port, _, publish = runtime
    publish()
    review_id = port.offer()["review"]["id"]
    context = {"agent_name": "TestRole", "persona": "有耐心", "current_intent": "收集食物",
               "memories": [{"id": "m-1", "source": "recall", "text": "不要破坏建筑"}]}
    assert port.decide(review_id, "inspect", host_context=context)["error"] == "inspect_is_read_only"
    result = port.decide(review_id, "insert", "没有口粮", "收集食物", host_context=context)
    assert result["dispatched"] and result["host_context"]["memory_count"] == 1
    value = HostContextPort(port.directory, now=port.now).read(port.mailbox.intent_revision())
    assert value["dynamic"]["memories"][0]["id"] == "m-1"
    assert "不要破坏建筑" not in json.dumps(port.state(), ensure_ascii=False)
    assert "有耐心" not in json.dumps(port.state(), ensure_ascii=False)
    assert port.decide(review_id, "insert", "没有口粮", "收集食物", host_context=context) == result
    port.mailbox.submit("feedback", {"goal": "保护营地", "mode": "insert"}, str(uuid.uuid4()))
    assert HostContextPort(port.directory, now=port.now).read(port.mailbox.intent_revision()) is None


@pytest.mark.parametrize("change", ["stop", "expired", "new_session"])
def test_invalid_review_cannot_refresh_host_context(runtime, change):
    port, clock, publish = runtime
    publish()
    review_id = port.offer()["review"]["id"]
    if change == "stop":
        port.mailbox.submit("stop", {}, str(uuid.uuid4()))
    elif change == "expired":
        clock[0] += 181
    else:
        publish(owner_pid=124)
    result = port.decide(review_id, "continue", "继续", host_context={"agent_name": "TestRole"})
    assert result["is_error"] and not (port.directory / "host-context.json").exists()


def test_runtime_owns_creation_and_periodic_review_without_user_chat(runtime):
    port, clock, publish = runtime
    assert not port.offer()["offered"]  # A frontend cannot manufacture a heartbeat.
    publish()
    first = port.offer()["review"]
    assert "生命20/20" in first["summary"] and "口粮0个" in first["summary"]
    assert port.decide(first["id"], "continue", "正常推进")["acknowledged"]
    clock[0] += 60
    publish()
    assert not port.offer()["offered"]
    clock[0] += 120
    publish()
    assert port.offer()["review"]["trigger"] == "periodic_review"


def test_periodic_context_delivery_can_defer_without_main_acknowledgement(runtime):
    port, clock, publish = runtime
    publish()
    first = port.offer()["review"]
    assert port.defer(first["id"], True)["error"] == "meaningful_review_requires_decision"
    port.decide(first["id"], "continue", "继续")
    prior = port.state()["last_decision"]
    clock[0] += 180
    publish()
    periodic = port.offer()["review"]
    rejected = port.defer(periodic["id"], False)
    assert not rejected["deferred"] and not port.state()["review"].get("result")
    result = port.defer(periodic["id"], True)
    assert result == {"acknowledged": False, "dispatched": False, "verified": False, "deferred": True, "context_only": True}
    assert port.state()["last_decision"] == prior
    assert not port.offer()["offered"]
    assert not (port.directory / "host-context.json").exists()


@pytest.mark.parametrize("change", ["stop", "stale", "intent"])
def test_defer_preserves_stop_freshness_and_intent_checks(runtime, change):
    port, clock, publish = runtime
    publish()
    port.decide(port.offer()["review"]["id"], "continue", "继续")
    clock[0] += 180
    publish()
    periodic = port.offer()["review"]
    if change == "stop":
        port.mailbox.submit("stop", {}, str(uuid.uuid4()))
    elif change == "stale":
        clock[0] += 181
    else:
        port.mailbox.submit("feedback", {"goal": "用户新目标", "mode": "insert"}, str(uuid.uuid4()))
    assert port.defer(periodic["id"], True)["is_error"]
    assert not port.state()["review"].get("result")


def test_review_summary_keeps_tools_and_material_stagnation_visible(runtime):
    port, clock, publish = runtime
    facts = snapshot(clock[0])["facts"]
    facts["parts"][1]["text"] = "手里拿着木斧。包里有：橡木原木×34、橡木木板×8、木棍×8、泥土×3、工作台×1、木斧耐久14/59×1、木镐耐久59/59×1。"
    goal = "在这个原版生存世界持续安全生存。先观察周围，采集少量原木，制作木板、工作台和基础工具，再逐步获取食物并准备庇护所。"
    publish(facts=facts, standing_goal=goal)
    port.decide(port.offer()["review"]["id"], "continue", "先按原目标观察")
    clock[0] += 180
    publish(facts=facts, standing_goal=goal, read_activity={"mc_bag": 9, "mc_scout": 5})
    review = port.offer()["review"]
    assert review["trigger"] == "periodic_review"  # No extra calls due to a counter.
    assert "工作台×1" in review["summary"] and "木镐" in review["summary"]
    assert "获取食物" in review["summary"] and "庇护所" in review["summary"]
    assert "180秒" in review["summary"] and "查询14次" in review["summary"]
    assert review["evidence"]["read_activity"] == {"mc_bag": 9, "mc_scout": 5}
    assert len(review["summary"].encode("utf-8")) < 1800


def test_review_keeps_observed_structures_and_terminal_outcome(runtime):
    port, clock, publish = runtime
    facts = snapshot(clock[0])["facts"]
    facts["parts"].extend([
        {"key": "structure", "text": "crafting_table at (-73,71,302)"},
        {"key": "terrain", "text": "east is loaded and level"},
        {"key": "lastTask", "text": "task ended: " + "geometry " * 500 + "\nplacement failed: occupied", "original": "log:terminal"}])
    publish(facts=facts)
    review = port.offer()["review"]
    inspected = port.decide(review["id"], "inspect")
    assert inspected["facts"]["structure"] == "crafting_table at (-73,71,302)"
    assert inspected["facts"]["terrain"] == "east is loaded and level"
    assert "task ended" in inspected["facts"]["lastTask"] and "placement failed: occupied" in inspected["facts"]["lastTask"]
    assert inspected["fact_originals"]["lastTask"] == "log:terminal"
    assert len(inspected["facts"]["lastTask"].encode("utf-8")) <= 1000
    assert "standing goal" in inspected["next"] and "fresh evidence" in inspected["next"]


def test_review_transports_exact_unresolved_tool_error_with_bounded_receipt_reference(runtime):
    port, clock, publish = runtime
    failure = {"tool": "mc_scout", "error": "pitch must be within -90..90; yaw within -180..180",
               "next_step": "Read the skill documentation and correct the arguments.",
               "receipt": {"request_id": "native-rejected-1", "turn_id": "turn-1", "archive": "receipts.jsonl"}}
    publish(tool_failure=failure, planner_error="repeated_invalid_tool_call")
    first = port.offer()["review"]
    inspection = port.decide(first["id"], "inspect")
    assert inspection["tool_failure"] == failure
    assert "mc_scout" in first["summary"] and "pitch" in first["summary"]
    port.decide(first["id"], "continue", "Read the referenced failure before choosing an alternate plan.")
    clock[0] += 180
    publish(tool_failure=failure, planner_error=None, read_activity={"mc_help": 3})
    second = port.offer()["review"]
    assert second["evidence"]["tool_failure"] == failure  # A successful model/help reply did not repair it.
    port.decide(second["id"], "continue", "Still awaiting a corrected plan.")
    clock[0] += 180
    publish(tool_failure=None)
    cleared = port.offer()["review"]
    assert cleared["evidence"]["tool_failure"] is None
    assert "pitch" not in cleared["summary"]


def test_review_limits_tool_diagnostic_without_transporting_arguments_or_unrelated_fields(runtime):
    port, _, publish = runtime
    publish(tool_failure={"tool": "mc_scout", "error": "错" * 9000, "next_step": "修订" * 9000,
                          "arguments": "not for the host", "receipt": {"request_id": "r", "turn_id": "t", "archive": "receipts.jsonl", "extra": "private"}})
    first = port.offer()["review"]
    diagnostic = first["evidence"]["tool_failure"]
    assert set(diagnostic) == {"tool", "error", "next_step", "receipt"}
    assert len(diagnostic["error"].encode()) <= 900 and len(diagnostic["next_step"].encode()) <= 400
    assert set(diagnostic["receipt"]) == {"request_id", "turn_id", "archive"}
    assert len(first["summary"].encode()) < 2000


@pytest.mark.parametrize("changes", [
    {"updated_at": datetime.fromtimestamp(9900, timezone.utc).isoformat()},
    {"updated_at": datetime.fromtimestamp(10031, timezone.utc).isoformat()},
    {"game_connected": False}, {"phase": "stopped"}, {"facts": {"parts": []}},
])
def test_stale_future_disconnected_stopped_or_missing_facts_never_wake(runtime, changes):
    port, _, publish = runtime
    publish(**changes)
    assert not port.offer()["offered"]


def test_disabled_and_stop_never_wake_or_dispatch(runtime):
    port, _, publish = runtime
    port.configure(ReviewPolicy())
    publish()
    assert not port.offer()["offered"]
    port.configure(ReviewPolicy(enabled=True))
    publish()
    review_id = port.offer()["review"]["id"]
    port.mailbox.submit("stop", {}, str(uuid.uuid4()))
    assert not port.offer()["offered"]
    assert port.decide(review_id, "insert", "缺食物", "采集食物")["error"] == "disabled_or_stopped"


def test_durable_delivery_is_deduplicated_bounded_and_backed_off(runtime):
    port, clock, publish = runtime
    publish()
    first = port.offer()["review"]
    assert not port.offer()["offered"]
    clock[0] += 90
    publish()
    assert port.offer()["review"]["id"] == first["id"]
    clock[0] += 91
    publish()
    assert not port.offer()["offered"]
    assert port.state()["review"]["result"]["error"] == "main_brain_not_acknowledged"
    clock[0] += 180
    publish()
    assert not port.offer()["offered"]


def test_insert_is_idempotent_safe_and_pending_goal_is_not_replaced(runtime):
    port, clock, publish = runtime
    publish(pending=[{"id": "body-1", "phase": "running", "terminal": False}])
    first = port.offer()["review"]
    args = (first["id"], "insert", "没有口粮", "收集食物然后返回")
    result = port.decide(*args)
    assert result == port.decide(*args)
    assert result["dispatched"] and result["verified"] is False
    with port.mailbox.connection() as db:
        rows = db.execute("SELECT kind,payload FROM commands").fetchall()
    assert len(rows) == 1 and rows[0]["kind"] == "feedback"
    assert json.loads(rows[0]["payload"])["mode"] == "insert"
    clock[0] += 60
    publish()
    second = port.offer()["review"]
    assert port.decide(second["id"], "insert", "重复", "更多食物")["error"] == "previous_intent_pending"


def test_new_user_intent_fences_old_review_and_failed_insert_can_be_retried(runtime):
    port, _, publish = runtime
    publish()
    review_id = port.offer()["review"]["id"]
    assert port.decide(review_id, "insert", "重复", "安全生存")["error"] == "goal_already_active"
    port.mailbox.submit("feedback", {"goal": "用户改为探索河边", "mode": "insert"}, str(uuid.uuid4()))
    assert port.decide(review_id, "insert", "旧计划", "砍树")["error"] == "intent_revision_changed"
    with pytest.raises(ValueError, match="intent_revision_changed"):
        port.mailbox.submit("goal", {"goal": "迟到"}, str(uuid.uuid4()), expected_revision=0)


def test_recheck_session_and_staleness_before_dispatch(runtime):
    port, clock, publish = runtime
    publish()
    review_id = port.offer()["review"]["id"]
    # Change the published snapshot without giving the runtime another scheduling tick.
    (port.directory / "status.json").write_text(json.dumps(snapshot(clock[0], owner_pid=456)), encoding="utf-8")
    assert port.decide(review_id, "insert", "缺食物", "采集")["error"] == "review_expired_or_game_unavailable"
    clock[0] += 40
    assert not port.offer()["offered"]


def test_successful_look_chatter_is_not_progress_but_task_result_and_death_are_events(runtime):
    port, clock, publish = runtime
    publish()
    port.decide(port.offer()["review"]["id"], "continue", "正常")
    clock[0] += 60
    facts = snapshot(clock[0])["facts"]
    facts["parts"].append({"key": "lastTask", "text": '任务#22完成: {"skill":"observe"}'})
    publish(facts=facts)
    assert not port.offer()["offered"]
    facts["parts"][-1]["text"] = '任务#23完成: {"skill":"craft"}'
    publish(facts=facts)
    previous = port.offer()["review"]["id"]
    clock[0] += 10
    facts["parts"][0]["text"] = "生命 0/20"
    from test_death_memory import event, SCOPE
    from agent_mc_autonomy.death_memory import DeathMemory
    episode = DeathMemory(port.directory).record(event(), facts, [], [], [])
    publish(facts=facts, death_episode=episode, game_identity=SCOPE)
    assert port.offer()["review"]["id"] != previous


def test_lost_review_commit_recovers_mailbox_receipt_and_blocks_duplicate_goal(runtime, monkeypatch):
    port, clock, publish = runtime
    publish()
    review_id = port.offer()["review"]["id"]
    original = port.mailbox.submit

    def response_lost(*args, **kwargs):
        original(*args, **kwargs)
        raise RuntimeError("simulated process loss after durable mailbox commit")

    monkeypatch.setattr(port.mailbox, "submit", response_lost)
    with pytest.raises(RuntimeError):
        port.decide(review_id, "insert", "缺口粮", "收集食物")
    monkeypatch.setattr(port.mailbox, "submit", original)
    # Restart another frontend; no in-memory state survives.
    recovered = ReviewPort(port.directory, now=lambda: clock[0])
    result = recovered.decide(review_id, "insert", "缺口粮", "收集食物")
    assert result["recovered"] and result["verified"] is False
    clock[0] += 60
    publish()
    assert port.decide(port.offer()["review"]["id"], "insert", "重复", "继续采集")["error"] == "previous_intent_pending"
    with port.mailbox.connection() as db:
        assert db.execute("SELECT count(*) FROM commands").fetchone()[0] == 1


def test_failed_game_can_be_reported_but_not_restarted_by_review(runtime):
    port, _, publish = runtime
    publish(phase="failed", game_connected=False, error="connection_lost")
    review_id = port.offer()["review"]["id"]
    assert port.decide(review_id, "inspect")["runtime_error"] == "connection_lost"
    assert port.decide(review_id, "insert", "尝试", "重连")["error"] == "game_not_running"
    assert port.decide(review_id, "continue", "报告断连")["acknowledged"]


def activate_review_stage(port, clock, publish):
    publish()
    first = port.decide(port.offer()["review"]["id"], "insert", "需要工具", "制作工具再找食物")
    port.mailbox.activate_feedback(port.mailbox.claim())
    clock[0] += 180
    publish(current_goal=port.mailbox.active_goal(), read_activity={"mc_bag": 18})
    return first, port.offer()["review"]


def test_delivered_stage_can_be_revised_without_stacking_or_claiming_success(runtime):
    port, clock, publish = runtime
    first, review = activate_review_stage(port, clock, publish)
    inspected = port.decide(review["id"], "inspect")
    assert inspected["stage_delivery"]["delivery"] == "planning"
    assert inspected["stage_delivery"]["can_revise"]
    args = (review["id"], "revise", "木剑已完成，队列空闲但反复查询", "寻找食物并按回执推进")
    revised = port.decide(*args)
    assert revised == port.decide(*args) and revised["verified"] is False
    command = port.mailbox.claim()
    assert command["payload"]["revision_of"] == first["request_id"]
    assert port.mailbox.activate_feedback(command)
    assert port.mailbox.get(first["request_id"])["delivery"] == "revised"
    assert port.mailbox.active_goal()["id"] == revised["request_id"]
    with port.mailbox.connection() as db:
        assert db.execute("SELECT count(*) FROM commands WHERE state='paused'").fetchone()[0] == 0


def test_review_revision_cannot_amend_a_new_user_stage_or_override_new_feedback(runtime):
    port, clock, publish = runtime
    _, review = activate_review_stage(port, clock, publish)
    user = str(uuid.uuid4())
    port.mailbox.submit("feedback", {"goal": "用户要求原地等候", "mode": "insert"}, user)
    assert port.decide(review["id"], "revise", "想采集", "去远方")["error"] == "intent_revision_changed"
    port.mailbox.activate_feedback(port.mailbox.claim())
    clock[0] += 180
    publish(current_goal=port.mailbox.active_goal())
    latest = port.offer()["review"]
    assert not port.decide(latest["id"], "inspect")["stage_delivery"]["can_revise"]
    assert port.decide(latest["id"], "revise", "想采集", "去远方")["error"] == "no_active_review_stage"


def test_review_revision_recovers_after_lost_confirmation(runtime, monkeypatch):
    port, clock, publish = runtime
    _, review = activate_review_stage(port, clock, publish)
    original = port.mailbox.submit

    def lost(*args, **kwargs):
        original(*args, **kwargs)
        raise RuntimeError("lost confirmation")

    monkeypatch.setattr(port.mailbox, "submit", lost)
    args = (review["id"], "revise", "工具已有", "寻找食物")
    with pytest.raises(RuntimeError, match="lost confirmation"):
        port.decide(*args)
    recovered = ReviewPort(port.directory, now=lambda: clock[0])
    result = recovered.decide(*args)
    assert result["decision"] == "revise" and result["recovered"]
    assert result["dispatched"] and not result["verified"]

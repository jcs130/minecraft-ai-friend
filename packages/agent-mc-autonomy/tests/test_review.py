import json
import uuid
from datetime import datetime, timezone

import pytest

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
    publish(facts=facts)
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

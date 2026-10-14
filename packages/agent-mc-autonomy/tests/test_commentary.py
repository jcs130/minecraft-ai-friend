from datetime import datetime, timezone

from agent_mc_autonomy.commentary import commentary_changes, commentary_observation


def sample(now=10000, *, health=20, hunger=20, gear="手里拿着工作台。包里有：白桦木板×12、木斧 耐久20/59×1。鼠标光标空着。", task=""):
    return {"phase": "running", "game_connected": True, "owner_pid": 123,
            "updated_at": datetime.fromtimestamp(now, timezone.utc).isoformat(),
            "facts": {"parts": [{"key": "body", "text": f"生命 {health}/20，饥饿 {hunger}/20"},
                                {"key": "gear", "text": gear}, {"key": "lastTask", "text": task},
                                {"key": "queue", "text": "正在采集白桦原木"}]}}


def test_inventory_quantities_durability_and_held_item_are_not_commentary():
    first = commentary_observation(sample(), 10000)
    later = commentary_observation(sample(10010, gear="两手空空。包里有：白桦木板×20、木斧 耐久12/59×1。鼠标光标空着。"), 10010)
    assert commentary_changes(later, first["baseline"]) == {"topics": [], "urgent": False}


def test_new_item_type_is_a_topic_but_not_an_inventory_readout():
    first = commentary_observation(sample(), 10000)
    later = commentary_observation(sample(10010, gear="包里有：白桦木板×12、木斧 耐久19/59×1、石镐 耐久131/131×1。"), 10010)
    assert commentary_changes(later, first["baseline"])["topics"] == ["new_resources"]
    assert "inventory" not in later["payload"]


def test_critical_health_is_timely_and_repeated_snapshot_is_quiet():
    first = commentary_observation(sample(), 10000)
    critical = commentary_observation(sample(10010, health=4), 10010)
    assert commentary_changes(critical, first["baseline"]) == {"topics": ["health_changed"], "urgent": True}
    same_band = commentary_observation(sample(10011, health=3), 10011)
    assert commentary_changes(same_band, critical["baseline"]) == {"topics": [], "urgent": False}


def test_death_and_recovery_are_real_state_changes():
    critical = commentary_observation(sample(health=4), 10000)
    dead = commentary_observation(sample(10010, health=0), 10010)
    assert commentary_changes(dead, critical["baseline"])["urgent"]
    recovered = commentary_observation(sample(10020), 10020)
    assert "health_changed" in commentary_changes(recovered, dead["baseline"])["topics"]


def test_reads_and_failed_task_do_not_become_achievements():
    first = commentary_observation(sample(), 10000)
    for text in ('任务#1完成: {"skill":"observe"} 读取现场成功', '任务#2完成: {"skill":"craft"} 失败:缺煤炭'):
        later = commentary_observation(sample(10010, task=text), 10010)
        assert not commentary_changes(later, first["baseline"])["topics"]
    built = commentary_observation(sample(10010, task='任务#3完成: {"skill":"build"} 放好了工作台'), 10010)
    assert commentary_changes(built, first["baseline"])["topics"] == ["task_progress"]


def test_baseline_and_freshness():
    first = commentary_observation(sample(), 10000)
    assert commentary_changes(first, None)["topics"] == ["session_started"]
    for now in (9999, 10031):
        assert commentary_observation(sample(), now) is None

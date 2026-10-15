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


def test_actual_mixed_receipt_keeps_verified_steps_without_claiming_the_failed_goal():
    receipt = ('[最近一单] 任务#73「烧原木;挖石头」:\n'
               '第 1 步 {"skill":"smelt"} 用时 0s: 没做成(包里没有煤炭)\n'
               '做成的: 第 2 步 {"skill":"excavate"} 用时 2m: 挖开了 75/75 块。\n'
               '[背包] 圆石×69')
    event = commentary_observation(sample(task=receipt), 10000)
    assert event["baseline"]["progress"]
    assert "挖开了 75/75" in event["payload"]["progress"]
    assert "没做成" not in event["payload"]["progress"]
    assert event["payload"]["task_outcome"] == "partial"


def test_noop_or_only_read_steps_after_a_failure_do_not_become_achievements():
    for ending in ('第 2 步 {"skill":"observe"} 读取现场成功',
                   '第 2 步 {"skill":"build"} 本来就是箱子;核验:达成'):
        receipt = '任务#1:\n第 1 步 {"skill":"craft"} 没做成(缺材料)\n做成的:\n' + ending
        assert not commentary_observation(sample(task=receipt), 10000)["baseline"]["progress"]


def test_real_detailed_terminal_receipt_does_not_require_a_completed_header():
    receipt = ('[最近一单] 任务#4「合成工作台」:\n'
               '第 1 步 {"skill":"craft","item":"crafting_table"} 用时 1s: '
               '合成出来:工作台×1;该步核验:达成(实测 1)')
    event = commentary_observation(sample(task=receipt), 10000)
    assert event["payload"]["task_outcome"] == "completed"
    assert "合成出来" in event["payload"]["progress"]

"""Strategic inputs must distinguish repeated activity from project advancement."""
from copy import deepcopy

import pytest

from agent_mc_autonomy.review import ReviewPort, review_observation
from agent_mc_autonomy.review_evidence import compact, encoded
from test_review import runtime, snapshot
from test_review_budget import read_original


@pytest.mark.parametrize("standing", [
    "按兴趣选择持续项目。" * 40 + "适合复用的操作可以自行编写、验证、运行、复盘和修订；采用须有实际证据。",
    '雪"\\' * 900 + "Preserve failed versions; registration is not achievement.",
], ids=["long-instruction", "unicode-and-escapes"])
def test_complete_bounded_standing_instruction_reaches_actual_inspection(runtime, standing):
    port, clock, publish = runtime
    source = publish(standing_goal=standing)
    assert review_observation(source, clock[0])["evidence"]["standing_goal"] == standing
    rid = port.offer()["review"]["id"]
    result = port.decide(rid, "inspect", compact=True)
    assert result["standing_goal"] == standing
    assert read_original(port, rid, result["evidence_ref"], ["evidence", "standing_goal"]) == standing


def test_oversize_instruction_has_explicit_original_query(runtime):
    port, _, publish = runtime
    standing = "Explicit public game instruction 雪" * 2000
    publish(standing_goal=standing)
    rid = port.offer()["review"]["id"]
    result = port.decide(rid, "inspect", compact=True)
    assert result["standing_goal"]["abridged"] is True
    query = result["standing_goal_details"]
    assert query["json_characters"] == len(encoded(standing))
    assert read_original(port, rid, result["evidence_ref"], query["detail_path"]) == standing


def project_facts(now, *, progress="1/4", gear="小麦×1", run="run-a"):
    facts = snapshot(now)["facts"]
    facts["run"] = run
    facts["parts"][1]["text"] = gear
    facts["parts"] += [{"key": "goals", "text": f"项目#1 v12，里程碑{progress}；下一条件：收割后记录位置"},
                       {"key": "methods", "text": "已保存方法0；没有采用或复用证据"}]
    return facts


def inspect(port):
    rid = port.offer()["review"]["id"]
    return rid, port.decide(rid, "inspect", compact=True)


def test_inventory_activity_does_not_erase_unchanged_project_samples(runtime):
    port, clock, publish = runtime
    start = clock[0]
    for index in range(5):
        publish(facts=project_facts(clock[0], gear=f"小麦×{index + 1}"))
        rid, result = inspect(port)
        assert port.decide(rid, "continue", "保留待核实的项目")["acknowledged"]
        clock[0] += 180
    history = result["project_observations"]
    assert history["sampled_summaries_unchanged_seconds"] == 720
    assert history["samples"][0]["sampled_at"] == snapshot(start)["updated_at"]
    assert all("1/4" in row["goals"] for row in history["samples"])
    assert all("方法0" in row["methods"] for row in history["samples"])
    assert history["verified_progress"] is False
    assert "sampled" in history["meaning"]
    assert read_original(port, rid, result["evidence_ref"], ["evidence", "project_observations"])["samples"]
    assert not port.mailbox.ready()  # Observation/continue does not dispatch a body stage.


@pytest.mark.parametrize("boundary", ["run", "owner", "intent", "world", "episode"])
def test_project_comparisons_do_not_cross_identity_or_intent_boundaries(runtime, boundary):
    port, clock, publish = runtime
    publish(facts=project_facts(clock[0]))
    rid, _ = inspect(port)
    port.decide(rid, "continue", "等待证据")
    clock[0] += 300
    changes = {"facts": project_facts(clock[0])}
    if boundary == "run":
        changes["facts"]["run"] = "new-run"
    elif boundary == "owner":
        changes["owner_pid"] = 456
    elif boundary == "intent":
        changes["standing_goal"] = "按新的兴趣探索"
    elif boundary == "world":
        changes["game_identity"] = {"realm": "another-world", "account": "anonymous", "agent": "anonymous"}
    else:
        changes["facts"]["parts"].append({"key": "deathLifecycle", "text": '{"phase":"alive","episodeId":"new-death"}'})
    publish(**changes)
    _, result = inspect(port)
    history = result["project_observations"]
    assert len(history["samples"]) == 1
    assert history["sampled_summaries_unchanged_seconds"] == 0


def test_project_change_and_sparse_history_are_bounded_and_read_only(runtime):
    port, clock, publish = runtime
    for index in range(30):
        publish(facts=project_facts(clock[0], progress=f"{index}/40"))
        rid, _ = inspect(port)
        port.decide(rid, "continue", "继续核对")
        clock[0] += 180
    publish(facts=project_facts(clock[0], progress="30/40"))
    rid, result = inspect(port)
    full = port.decide(rid, "inspect")
    rows = full["project_observations"]["samples"]
    assert len(rows) <= 8 and len(result["project_observations"]["samples"]) <= 3
    assert "30/40" in rows[-1]["goals"]
    assert full["project_observations"]["sampled_summaries_unchanged_seconds"] == 0
    before = deepcopy(port.state())
    reopened = ReviewPort(port.directory, now=port.now)
    assert reopened.decide(rid, "inspect", compact=True)["project_observations"] == result["project_observations"]
    assert port.state()["project_observation_window"] == before["project_observation_window"]
    assert len(encoded(result["project_observations"]).encode()) <= 5000


def test_query_only_publication_does_not_trigger_extra_review_or_append_every_tick(runtime):
    port, clock, publish = runtime
    publish(facts=project_facts(clock[0]))
    rid, _ = inspect(port)
    port.decide(rid, "continue", "等待实际变化")
    for _ in range(20):
        clock[0] += 1
        publish(facts=project_facts(clock[0]))
    assert not port.offer()["offered"]
    assert len(port.state()["project_observation_window"]["samples"]) == 1
    assert not port.mailbox.ready()

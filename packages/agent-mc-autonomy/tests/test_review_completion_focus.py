"""Keep live body facts and recovery completion usable within a short host turn."""
import json
from copy import deepcopy
from unittest.mock import Mock

from agent_mc_autonomy.review_evidence import compact, encoded
from test_death_reflection_contract import death_review


def test_long_inventory_never_hides_current_place_body_or_queue():
    facts = {"body": "生命20/20，饥饿20/20", "gear": "圆石×34、火把×1、木棍×4。" * 50,
             "foodReserve": "牛排×8，熟食储备充足", "place": "出生村 (-545,67,-442)，站在地表",
             "clock": "夜晚", "queue": "没有正在执行或等待的动作",
             "lastTask": "观察附近地形 " * 300}
    result = compact({"facts": facts}, "a" * 24)
    assert result["facts"]["place"] == facts["place"]
    assert result["facts"]["body"] == facts["body"]
    assert result["facts"]["queue"] == facts["queue"]
    assert result["facts"]["foodReserve"] == facts["foodReserve"]
    assert len(encoded(result["facts"]).encode()) <= 3200
    assert isinstance(result["facts"]["gear"], str) and "abridged" in result["facts"]["gear"]


def test_field_limits_count_escaped_quotes_and_unicode():
    facts = {key: '雪"\\' * 500 for key in ("body", "place", "queue", "clock", "bodyRestriction",
        "foodReserve", "gear", "life", "structure", "terrain", "lastTask")}
    result = compact({"facts": facts}, "a" * 24)
    assert set(result["facts"]) == set(facts)
    assert len(encoded(result["facts"]).encode()) <= 3200
    assert all(isinstance(value, str) and "abridged" in value for value in result["facts"].values())


def test_recovery_completion_is_before_large_evidence_and_has_a_short_output_contract(tmp_path):
    port, _, _, _, review = death_review(tmp_path)
    result = port.decide(review["id"], "inspect", compact=True)
    prefix = encoded_in_order(result)[:2400]
    assert '"completion_contract"' in prefix
    assert result["evidence_ref"] in prefix
    assert "death_reflection" in prefix
    assert "short" in result["completion_contract"]["output_guidance"]
    assert not port.state()["review"].get("result") and not port.mailbox.ready()


def encoded_in_order(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def test_missing_reflection_returns_the_same_bound_completion_without_another_inspect(tmp_path):
    port, _, _, _, review = death_review(tmp_path)
    inspected = port.decide(review["id"], "inspect", compact=True)
    before = deepcopy(port.state())
    speak = Mock()
    rejected = port.decide(review["id"], "continue", "重新按出生村规划", before_dispatch=speak)
    assert rejected["error"] == "death_reflection_required"
    assert rejected["completion_contract"] == inspected["completion_contract"]
    assert "same inspection" in rejected["next"]
    assert port.state() == before and not port.mailbox.ready()
    speak.assert_not_called()
    result = port.decide(review["id"], "continue", "重新按出生村规划", death_reflection={
        "evidence_ref": inspected["evidence_ref"], "outcome": "deferred", "reason": "缺少完整受击资料"})
    assert result["acknowledged"] and not result["reflection_pending"]

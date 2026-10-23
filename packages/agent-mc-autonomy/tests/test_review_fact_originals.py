"""Abbreviated host facts retain an honestly queryable dated source."""

import json

import pytest
import test_review
from test_review import snapshot


@pytest.fixture
def runtime(tmp_path):
    return test_review.runtime.__wrapped__(tmp_path)


def original(port, rid, reference, path):
    chunks, offset = [], 0
    while True:
        page = port.decide(rid, "inspect", evidence_ref=reference, detail_path=path, detail_offset=offset)
        assert not page.get("is_error"), page
        assert page["historical"] and not page["grants_inspection"]
        chunks.append(page["json_chunk"])
        if not page["has_more"]:
            return json.loads("".join(chunks))
        offset = page["next_offset"]


def test_server_denial_beyond_host_preview_remains_queryable(runtime):
    port, clock, publish = runtime
    text = "ordinary field data " * 200 + "ACTION_NOT_COUNTED: use the original harvested site"
    facts = snapshot(clock[0])["facts"]
    facts["parts"].append({"key": "serverFeedback", "text": text})
    publish(facts=facts)
    rid = port.offer()["review"]["id"]
    inspected = port.decide(rid, "inspect", compact=True)
    assert "ACTION_NOT_COUNTED" not in inspected["facts"]["serverFeedback"]
    query = inspected.get("fact_detail_queries", {}).get("serverFeedback")
    assert query and query["available"], inspected.keys()
    assert query["json_characters"] == len(json.dumps(text, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
    assert original(port, rid, inspected["evidence_ref"], query["detail_path"]) == text
    assert not port.state()["review"].get("result")


def test_original_fact_is_immutable_after_later_body_text_changes(runtime):
    port, clock, publish = runtime
    facts = snapshot(clock[0])["facts"]
    text = "exact historical task evidence " * 100
    facts["parts"].append({"key": "lastTask", "text": text})
    publish(facts=facts)
    rid = port.offer()["review"]["id"]
    inspected = port.decide(rid, "inspect", compact=True)
    clock[0] += 1
    facts["parts"][-1]["text"] = "A newer task result"
    publish(facts=facts)
    assert original(port, rid, inspected["evidence_ref"],
                    ["evidence", "original_facts", "lastTask"]) == text


def test_oversized_fact_is_marked_unavailable_and_never_called_an_original(runtime):
    port, clock, publish = runtime
    facts = snapshot(clock[0])["facts"]
    facts["parts"].extend([{"key": "serverFeedback", "text": "X" * 32769},
                            {"key": "private_memory", "text": "never a game review fact"}])
    publish(facts=facts)
    rid = port.offer()["review"]["id"]
    inspected = port.decide(rid, "inspect", compact=True)
    query = inspected["fact_detail_queries"]["serverFeedback"]
    assert query["available"] is False and "detail_path" not in query
    full = port.decide(rid, "inspect")
    assert "serverFeedback" not in full["original_facts"]
    assert "private_memory" not in full["original_facts"]


def test_original_store_budget_is_bytes_and_never_slices_a_field():
    from agent_mc_autonomy.review_evidence import original_facts
    facts = {"serverFeedback": "A" * 32768, "lastTask": "B" * 32768,
             "messages": "small but outside remaining budget", "goals": "田" * 11000}
    saved, status = original_facts(facts, {key: "preview" for key in facts})
    assert sum(len(value.encode("utf-8")) for value in saved.values()) == 65536
    assert saved == {"serverFeedback": facts["serverFeedback"], "lastTask": facts["lastTask"]}
    assert not status["messages"]["available"] and not status["goals"]["available"]

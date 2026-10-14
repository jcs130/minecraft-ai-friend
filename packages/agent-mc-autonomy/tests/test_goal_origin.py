import json
import uuid
from datetime import datetime, timezone

import pytest

from agent_mc_autonomy.mailbox import Mailbox
from agent_mc_autonomy.review import ReviewPolicy, ReviewPort


def submit(box, goal, **metadata):
    request_id = str(uuid.uuid4())
    payload = {"goal": goal, "mode": "insert", **metadata}
    box.submit("feedback", payload, request_id)
    assert box.activate_feedback(box.claim())
    return request_id


def test_legacy_goal_origin_is_unknown_without_rewriting_payload(tmp_path):
    box = Mailbox(tmp_path)
    request_id = submit(box, "legacy stage")
    assert box.active_goal()["origin"] == "unknown"
    assert box.current_user_goal(request_id) is None
    assert box.goal_lineage(request_id)[0]["origin"] == "unknown"
    with box.connection() as db:
        assert json.loads(db.execute("SELECT payload FROM commands").fetchone()[0]) == {"goal": "legacy stage", "mode": "insert"}


def test_host_review_revisions_preserve_user_ancestor_and_full_original_chain(tmp_path):
    box = Mailbox(tmp_path)
    user = submit(box, "Find food, not another workbench", origin="user")
    stage = submit(box, "Observe food sources", origin="host_review", parent_id=user)
    revised = submit(box, "Gather observed berries", origin="host_review", parent_id=stage, revision_of=stage)
    assert box.current_user_goal(revised)["id"] == user
    chain = box.goal_lineage(revised)
    assert [row["id"] for row in chain] == [revised, stage, user]
    assert [row["origin"] for row in chain] == ["host_review", "host_review", "user"]
    assert [row["state"] for row in chain] == ["planning", "revised", "paused"]
    assert chain[-1]["goal"] == "Find food, not another workbench"
    box.report_goal(revised, {"outcome": "completed"})
    assert box.resume_goal()["id"] == user


@pytest.mark.parametrize("metadata", [{"origin": "assistant"}, {"parent_id": "bad"}, {"parent_id": str(uuid.uuid4())}])
def test_invalid_goal_provenance_is_not_accepted(tmp_path, metadata):
    with pytest.raises(ValueError):
        submit(Mailbox(tmp_path), "stage", **metadata)


def test_review_marks_stage_and_keeps_authoritative_goal_before_own_prior_decision(tmp_path):
    clock = [10000]
    port = ReviewPort(tmp_path, now=lambda: clock[0])
    port.configure(ReviewPolicy(enabled=True))
    user = submit(port.mailbox, "Find food", origin="user")

    def publish():
        value = {"phase": "running", "game_connected": True, "owner_pid": 1,
                 "updated_at": datetime.fromtimestamp(clock[0], timezone.utc).isoformat(),
                 "standing_goal": "Survive safely", "current_goal": port.mailbox.active_goal(),
                 "facts": {"parts": [{"key": "body", "text": "health=10"}, {"key": "gear", "text": "logs=10"}]}}
        (tmp_path / "status.json").write_text(json.dumps(value), encoding="utf-8")
        port.observe(value)

    publish()
    first = port.decide(port.offer()["review"]["id"], "insert", "need food", "Look for berries")
    port.mailbox.activate_feedback(port.mailbox.claim())
    active = port.mailbox.active_goal()
    assert active["origin"] == "host_review" and active["parent_id"] == user
    clock[0] += 180
    publish()
    review = port.offer()["review"]
    inspected = port.decide(review["id"], "inspect")
    assert inspected["current_user_goal"]["goal"] == "Find food"
    assert inspected["current_goal"]["origin"] == "host_review"
    assert list(inspected).index("standing_goal") < list(inspected).index("last_decision")
    assert "Survive safely" in review["summary"]
    assert "Find food" in review["summary"]
    assert "goal_lineage" not in inspected  # Full history is an explicit query.
    queried = port.decide(review["id"], "inspect", lineage_offset=0)
    assert [row["id"] for row in queried["goal_lineage"]] == [first["request_id"], user]
    assert not queried["has_more"]


def test_lineage_query_pages_without_truncating_original_goal_text(tmp_path):
    box = Mailbox(tmp_path)
    full_goal = "survive " * 400
    parent = submit(box, full_goal, origin="user")
    ids = [parent]
    for index in range(7):
        parent = submit(box, f"stage {index}", origin="host_review", parent_id=parent)
        ids.append(parent)
    chain = box.goal_lineage(parent)
    assert [row["id"] for row in chain] == list(reversed(ids))
    assert chain[-1]["goal"] == full_goal
    port = ReviewPort(tmp_path, now=lambda: 10000)
    port.configure(ReviewPolicy(enabled=True))
    value = {"phase": "running", "game_connected": True, "owner_pid": 1,
             "updated_at": datetime.fromtimestamp(10000, timezone.utc).isoformat(),
             "standing_goal": "survive", "current_goal": box.active_goal(),
             "facts": {"parts": [{"key": "body", "text": "health=20"}, {"key": "gear", "text": "food=0"}]}}
    (tmp_path / "status.json").write_text(json.dumps(value), encoding="utf-8")
    port.observe(value)
    review_id = port.offer()["review"]["id"]
    first = port.decide(review_id, "inspect", lineage_offset=0)
    assert len(first["goal_lineage"]) == 4 and first["has_more"]
    second = port.decide(review_id, "inspect", lineage_offset=first["next_offset"])
    assert first["goal_lineage"] + second["goal_lineage"] == chain
    assert not second["has_more"] and second["goal_lineage"][-1]["goal"] == full_goal
    assert port.decide(review_id, "inspect", lineage_offset=True)["error"] == "invalid_lineage_offset"


@pytest.mark.parametrize("kind,payload", [("goal", {"goal": "find food"}), ("feedback", {"goal": "find food", "mode": "insert"})])
def test_explicit_user_entry_preserves_legacy_uuid_retries_and_marks_only_new_commands(tmp_path, kind, payload):
    box = Mailbox(tmp_path)
    old, new = str(uuid.uuid4()), str(uuid.uuid4())
    receipt = box.submit(kind, payload, old)
    assert box.submit_user_intent(kind, payload, old) == receipt
    assert box.goal_lineage(old)[0]["origin"] == "unknown"
    new_receipt = box.submit_user_intent(kind, payload, new)
    assert box.goal_lineage(new)[0]["origin"] == "user"
    assert box.submit_user_intent(kind, payload, new) == new_receipt
    with pytest.raises(ValueError, match="request_id_conflict"):
        box.submit_user_intent(kind, {**payload, "goal": "changed"}, old)

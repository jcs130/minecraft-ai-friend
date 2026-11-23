import hashlib
import sqlite3
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path

import pytest

from agent_mc_harness.journal import ActionJournal
from agent_mc_harness.memory.base import episode_from_receipt
from agent_mc_harness.memory.history import project_action_history
from agent_mc_harness.models import ActionReceipt, BodyAction, BodyIdentity, Scope, WorldRef

SNAPSHOT_TIME = datetime(2026, 11, 21, 5, tzinfo=UTC)
RECEIPT_TIME = datetime(2026, 11, 21, 4, tzinfo=UTC)
SOURCE = BodyIdentity(kind="maid", body_id="original", world=WorldRef(server_id="s1", world_key="save1"),
                      scope=Scope(realm="s1", account="owner1", agent="old_profile", character="stable_actor"))
TARGET = SOURCE.model_copy(update={
    "kind": "numen", "body_id": "rebound", "scope": SOURCE.scope.model_copy(update={"agent": "canonical_profile"}),
})


def _snapshot(tmp_path: Path) -> tuple[Path, ActionReceipt]:
    journal = ActionJournal(tmp_path / "active.sqlite3")
    quest = {"kind": "turn_in_quest", "id": "vq_issuer", "at": int(RECEIPT_TIME.timestamp()), "effect": "confirmed"}
    native = BodyAction(verb="native", name="adventure_action", request_id="hs_original", args=quest | {"text": "private trace"})
    receipt = ActionReceipt(request_id="hs_original", verb="native", status="completed", terminal=True, text="raw chat",
                            data={"adventure": quest | {"messages": ["another secret"]}})
    for rid, body, action, finished in [
        ("hs_original", "original", native, receipt),
        ("hs_otherbody", "outsider", native, receipt.model_copy(update={"request_id": "hs_otherbody"})),
        ("hs_badverb", "original", BodyAction(verb="chat", args={"text": "raw private chat"}), receipt),
        ("hs_pending", "original", native, None),
        ("hs_unknown", "original", native, receipt.model_copy(update={"terminal": False, "status": "unknown"})),
        ("hs_query", "original", native.model_copy(update={"name": "adventure_query"}), receipt),
        ("hs_wrongquest", "original", native.model_copy(update={"args": quest | {"id": "vq_other"}}), receipt),
        ("hs_badjson", "original", native, receipt),
    ]:
        journal.begin(body, action.model_copy(update={"request_id": rid}))
        if finished:
            journal.settle(body, finished.model_copy(update={"request_id": rid}))
    with journal.db:
        journal.db.execute("UPDATE dispatch SET receipt=? WHERE id='hs_badjson'", ("not JSON text",))
    copy = tmp_path / "copy.sqlite3"
    with closing(sqlite3.connect(copy)) as backup:
        journal.db.backup(backup)
    journal.close()
    return copy, receipt


def test_projects_original_id_and_safe_facts_without_writes(tmp_path: Path) -> None:
    snapshot, original = _snapshot(tmp_path)
    digest = hashlib.sha256(snapshot.read_bytes()).hexdigest()
    requests = ["hs_original", "hs_otherbody", "hs_badverb", "hs_pending", "hs_unknown", "hs_query",
                "hs_wrongquest", "hs_badjson", "hs_missing", "hs_original"]
    result = project_action_history(snapshot, source=SOURCE, target=TARGET, request_ids=requests, snapshot_at=SNAPSHOT_TIME)
    assert result.group_id == TARGET.group_id() and result.group_id != SOURCE.group_id()
    assert len(result.episodes) == 1
    fact = result.episodes[0]
    assert fact.id == episode_from_receipt(original).id
    assert fact.body == "已确认交付公会委托 vq_issuer。" and fact.reference_time == RECEIPT_TIME
    assert fact.provenance == {"sourceId": "hs_original", "referenceTimeSource": "server_receipt_observed_at"}
    assert result.skipped == {
        "hs_otherbody": "original_receipt_unavailable", "hs_badverb": "original_receipt_mismatch",
        "hs_pending": "original_receipt_unavailable", "hs_unknown": "no_verified_milestone",
        "hs_query": "no_verified_milestone", "hs_wrongquest": "no_verified_milestone",
        "hs_badjson": "invalid_original_receipt", "hs_missing": "original_receipt_unavailable",
    }
    assert hashlib.sha256(snapshot.read_bytes()).hexdigest() == digest
    assert not list(tmp_path.glob("*-wal")) and not list(tmp_path.glob("*-shm"))


def test_refuses_unproven_account_character_and_world(tmp_path: Path) -> None:
    snapshot, _ = _snapshot(tmp_path)
    for profile in (
        TARGET.model_copy(update={"scope": TARGET.scope.model_copy(update={"account": "owner2"})}),
        TARGET.model_copy(update={"scope": TARGET.scope.model_copy(update={"character": "other"})}),
        TARGET.model_copy(update={"scope": TARGET.scope.model_copy(update={"character": None})}),
        TARGET.model_copy(update={"world": TARGET.world.model_copy(update={"world_key": "other"})}),
    ):
        with pytest.raises(ValueError, match="history_scope_mismatch"):
            project_action_history(snapshot, source=SOURCE, target=profile, request_ids=["hs_original"], snapshot_at=SNAPSHOT_TIME)
    snapshot.with_name(snapshot.name + "-wal").touch()
    with pytest.raises(ValueError, match="history_requires_standalone_snapshot"):
        project_action_history(snapshot, source=SOURCE, target=TARGET, request_ids=["hs_original"], snapshot_at=SNAPSHOT_TIME)


def test_missing_action_timestamp_uses_labeled_snapshot_observation(tmp_path: Path) -> None:
    journal = ActionJournal(tmp_path / "active.sqlite3")
    rid = "hs_make_original"
    action = BodyAction(verb="craft", request_id=rid)
    journal.begin(SOURCE.body_id, action)
    detail = {"verified": True, "effectsApplied": True, "inventory": "backpack", "itemId": "minecraft:torch", "count": 4}
    row = {"goalCompleted": True, "status": "completed", "action": "make", "operationId": rid, "observation": detail}
    receipt = ActionReceipt(request_id=rid, verb="craft", status="completed", terminal=True,
                            data={"maidAction": "make", "reply": {"data": row}})
    journal.settle(SOURCE.body_id, receipt)
    snapshot = tmp_path / "copy.sqlite3"
    with closing(sqlite3.connect(snapshot)) as backup:
        journal.db.backup(backup)
    journal.close()
    result = project_action_history(snapshot, source=SOURCE, target=TARGET, request_ids=[rid], snapshot_at=SNAPSHOT_TIME)
    assert not result.skipped
    fact, = result.episodes
    assert fact.kind == "craft_completed" and fact.reference_time == SNAPSHOT_TIME
    assert fact.provenance == {"sourceId": rid, "referenceTimeSource": "snapshot_observed_at"}

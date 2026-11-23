"""Read-only projection from a trusted, consistent action-journal snapshot."""
from __future__ import annotations

import sqlite3
from collections.abc import Sequence
from contextlib import closing
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from pydantic import ValidationError

from ..models import REQUEST_ID, ActionReceipt, BodyAction, BodyIdentity
from .base import MemoryEpisode, episode_from_receipt


@dataclass(frozen=True)
class HistoryProjection:
    group_id: str
    episodes: tuple[MemoryEpisode, ...]
    skipped: dict[str, str]


def _scope(identity: BodyIdentity) -> tuple[str | None, ...]:
    return (identity.world.server_id, identity.world.world_key, identity.scope.realm,
            identity.scope.account, identity.scope.character)


def project_action_history(snapshot: Path, *, source: BodyIdentity, target: BodyIdentity,
                           request_ids: Sequence[str], snapshot_at: datetime) -> HistoryProjection:
    """Select confirmed facts by original request from a standalone SQLite backup.

    Both identities and the snapshot's provenance must come from the deployment registry,
    including its logical account and verified physical body. There is no name lookup,
    memory write or body command. A source without a verified canonical role is ineligible.
    """
    scope = _scope(source)
    if not all(scope) or scope != _scope(target):
        raise ValueError("history_scope_mismatch")
    if snapshot_at.utcoffset() is None:
        raise ValueError("history_snapshot_time_requires_zone")
    if not request_ids or len(request_ids) > 200 or any(not REQUEST_ID.fullmatch(rid) for rid in request_ids):
        raise ValueError("history_requires_1_to_200_original_request_ids")
    snapshot = snapshot.resolve(strict=True)
    if not snapshot.is_file() or any(snapshot.with_name(snapshot.name + suffix).exists()
                                     for suffix in ("-wal", "-shm", "-journal")):
        raise ValueError("history_requires_standalone_snapshot")

    episodes, skipped = [], {}
    with closing(sqlite3.connect(snapshot.as_uri() + "?mode=ro&immutable=1", uri=True)) as db:
        for rid in dict.fromkeys(request_ids):
            row = db.execute("SELECT action, receipt FROM dispatch WHERE id=? AND body=?", (rid, source.body_id)).fetchone()
            if row is None or row[1] is None:
                skipped[rid] = "original_receipt_unavailable"
                continue
            try:
                action = BodyAction.model_validate_json(row[0])
                receipt = ActionReceipt.model_validate_json(row[1])
            except ValidationError:
                skipped[rid] = "invalid_original_receipt"
                continue
            if action.request_id != rid or receipt.request_id != rid or action.verb != receipt.verb:
                skipped[rid] = "original_receipt_mismatch"
                continue
            episode = _project(action, receipt, snapshot_at)
            if episode is None:
                skipped[rid] = "no_verified_milestone"
            else:
                episodes.append(episode)
    return HistoryProjection(target.group_id(), tuple(episodes), skipped)


def _project(action: BodyAction, receipt: ActionReceipt, snapshot_at: datetime) -> MemoryEpisode | None:
    if not isinstance(receipt.data, dict):
        return None
    observed = snapshot_at.astimezone(UTC)
    time_source = "snapshot_observed_at"
    if isinstance(effect := receipt.data.get("adventure"), dict):
        if (action.verb, action.name) != ("native", "adventure_action") or (
                effect.get("kind"), effect.get("id")) != (action.args.get("kind"), action.args.get("id")):
            return None
        at = effect.get("at")
        if type(at) is int and 0 < at <= observed.timestamp():
            observed = datetime.fromtimestamp(at, UTC)
            time_source = "server_receipt_observed_at"
    elif action.verb != "craft" and (action.verb, action.name) != ("native", "make"):
        return None
    episode = episode_from_receipt(receipt, observed)
    if episode is not None:
        episode.provenance["referenceTimeSource"] = time_source
    return episode

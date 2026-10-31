"""Read-only local evidence for one account's receive/decision/send boundaries.

This never constructs a controller, creates a database, contacts a host, infers
online presence from an old snapshot or joins two clients by matching text.
"""
from __future__ import annotations

import json
import sqlite3
import time
import uuid

from .mailbox import observation
from .social import _digest


def inspect_social(directory, settings, *, clock=time.time):
    social = settings.social
    generation = _digest([settings.username.casefold(), sorted(social.members)])
    snapshot = observation(directory)
    expected = next((body for name, body in social.members if name.casefold() == settings.username.casefold()), None)
    scope = snapshot.get("game_identity")
    account = scope.get("account") if isinstance(scope, dict) else None
    try:
        observed = str(uuid.UUID(account.rsplit(":", 1)[-1])) if isinstance(account, str) else None
    except ValueError:
        observed = None
    report = {
        "schema": "agent-mc-social-diagnostics/v1", "live_verified": False,
        "account": settings.username, "runtime_identity": settings.identity,
        "self_binding": {"configured_uuid": expected, "snapshot_account": account,
                         "snapshot_uuid_matches_roster": observed == expected if observed and expected else None},
        "host_adapter": "unverified", "host_installation_version": "unverified",
        "snapshot": {key: snapshot[key] for key in (
            "phase", "source", "game_identity", "game_connected", "autonomy_running", "native_run"
        ) if key in snapshot},
        "configured_policy": {key: getattr(social, key) for key in social.__dataclass_fields__ if key != "members"},
        "peers": [{"name": name, "uuid": body, "hearing": "not_observed",
                   "decision": "not_observed", "states": {}, "reasons": {}, "latest_input": None}
                  for name, body in social.members if name.casefold() != settings.username.casefold()],
        "outgoing": {"client_transport_sent": 0, "latest": None, "recipient_heard": "unknown",
                     "dedup_window_seconds": social.duplicate_seconds},
        "cross_client_correlation": "unverified", "action_completion_inferred": False,
    }
    if not social.enabled:
        return {**report, "ledger": "disabled"}
    path = directory / "social.sqlite3"
    if not path.is_file():
        return {**report, "ledger": "not_observed"}
    now = clock()
    try:
        db = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True, timeout=5)
    except sqlite3.Error:
        raise ValueError("social_ledger_unavailable") from None
    db.row_factory = sqlite3.Row
    try:
        db.execute("BEGIN")  # One consistent snapshot; no schema migration or expiry writes.
        row = db.execute("SELECT value FROM meta WHERE key='generation'").fetchone()
        if row is None or json.loads(row[0]) != generation:
            return {**report, "ledger": "binding_mismatch"}
        rows = db.execute("SELECT sender,payload,state,reason,model_request,received,ready,expires "
                          "FROM events WHERE generation=? ORDER BY received,rowid", (generation,)).fetchall()
        peers = {peer["name"].casefold(): peer for peer in report["peers"]}
        for row in rows:
            peer = peers.get(row["sender"].casefold())
            if peer is None:
                continue
            for field, value in (("states", row["state"]), ("reasons", row["reason"])):
                peer[field][value] = peer[field].get(value, 0) + 1
            if row["reason"] == "identity_unverified":
                continue  # Same name is not verified companion hearing.
            event = json.loads(row["payload"])
            meta = event.get("meta") or {}
            peer["hearing"] = "local_receive_observed"
            peer["latest_input"] = {
                "run": event["run"], "cursor": event["cursor"], "at": event.get("ts"),
                "channel": meta.get("channel"), "identity_evidence": meta.get("identityEvidence"),
                "state": row["state"], "reason": row["reason"], "model_request": row["model_request"],
                "ready_at": row["ready"], "expires_at": row["expires"],
                "expired_at_inspection": row["expires"] <= now,
            }
        for peer in report["peers"]:
            latest = peer["latest_input"]
            if latest:
                peer["decision"] = {
                    "consumed": "model_observed", "unknown": "model_outcome_unknown",
                    "pending": "awaiting_model", "context": "historical_context_only",
                }.get(latest["state"], "unverified")
        report["outgoing"]["client_transport_sent"] = db.execute(
            "SELECT count(*) FROM outgoing WHERE generation=?", (generation,)).fetchone()[0]
        # Prior candidate ledgers have dedup hashes but no transcript payload.
        if "payload" in {row[1] for row in db.execute("PRAGMA table_info(outgoing)")}:
            row = db.execute("SELECT payload FROM outgoing WHERE generation=? AND payload IS NOT NULL "
                             "ORDER BY at DESC,rowid DESC LIMIT 1", (generation,)).fetchone()
            if row:
                payload = json.loads(row[0])
                report["outgoing"]["latest"] = {key: payload.get(key) for key in ("id", "at", "channel", "to")}
        return {**report, "ledger": "observed"}
    except (sqlite3.DatabaseError, ValueError, KeyError, TypeError):
        raise ValueError("social_ledger_unreadable") from None
    finally:
        db.close()

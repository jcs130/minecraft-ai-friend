"""Operator-only offline acknowledgement. Never starts/replays a native request.

Prepared -> state CAS -> committed receipt is deliberately recoverable rather
than pretending that two filesystem writes are one atomic transaction. Every
new kernel refuses an unfinished prepared acknowledgement before body startup.
"""

import hashlib
import json
import os
import re
import sqlite3
import uuid
from datetime import datetime, timezone

from .ownership import session_is_owned, session_lease


def _hash(body):
    return hashlib.sha256(body).hexdigest()


def _encode(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _read(path, limit=4 * 1024 * 1024):
    if path.is_symlink():
        raise RuntimeError("recovery_symlink_refused")
    with path.open("rb") as stream:
        body = stream.read(limit + 1)
    if len(body) > limit:
        raise RuntimeError("recovery_evidence_limit")
    return body


def _json(path, limit=4 * 1024 * 1024):
    value = json.loads(_read(path, limit).decode("utf-8-sig"))
    if not isinstance(value, dict):
        raise RuntimeError("recovery_evidence_object_required")
    return value


def _uuid(value):
    if not isinstance(value, str) or str(uuid.UUID(value)) != value:
        raise ValueError("recovery_uuid_required")
    return value


def _text(value, limit):
    if not isinstance(value, str) or not value.strip() or len(value.encode("utf-8")) > limit or any(ord(c) < 32 for c in value):
        raise ValueError("recovery_bounded_operator_metadata_required")
    return value


def _root(settings, data_root):
    if settings.body_provider != "mineflayer":
        raise RuntimeError("recovery_generic_local_body_required")
    host = data_root / "sessions" / settings.identity / "host"
    if not host.is_dir() or host.is_symlink():
        raise RuntimeError("recovery_existing_host_required")
    return host


def _transactions(host):
    root = host / "recovery-acknowledgements"
    if root.is_symlink():
        raise RuntimeError("recovery_symlink_refused")
    entries = list(root.iterdir()) if root.exists() else []
    if len(entries) > 256:
        raise RuntimeError("recovery_receipt_limit")
    return entries


def _receipt(transaction):
    prepared = _json(transaction / "prepared.json", 65536)
    committed = _json(transaction / "committed.json", 65536)
    if committed.get("prepared_sha256") != _hash(_read(transaction / "prepared.json", 65536)):
        raise RuntimeError("recovery_receipt_conflict")
    if committed.get("signature") != prepared.get("signature") or committed.get("state_sha256") != prepared.get("after_state_sha256"):
        raise RuntimeError("recovery_receipt_conflict")
    if (committed.get("id") != transaction.name or prepared.get("id") != transaction.name
            or committed.get("classification") != "acknowledged_unknown" or committed.get("verified") is not False
            or committed.get("native_replay") is not False or committed.get("autostart") is not False):
        raise RuntimeError("recovery_receipt_conflict")
    if (_hash(_read(transaction / "before-state.json", 65536)) != prepared.get("before_state_sha256")
            or _hash(_read(transaction / "before-status.json")) != prepared.get("before_status_sha256")):
        raise RuntimeError("recovery_original_evidence_changed")
    return prepared, committed


def require_no_pending_acknowledgement(host, *, same_id=None):
    for transaction in _transactions(host):
        if transaction.is_symlink():
            raise RuntimeError("outcome_unknown: recovery receipt requires inspection")
        if not (transaction / "prepared.json").exists() and not (transaction / "prepared.json.staging").exists():
            continue  # No durable intent and no state mutation yet.
        if (transaction / "committed.json").exists():
            try:
                _receipt(transaction)
            except (OSError, ValueError, RuntimeError):
                raise RuntimeError("outcome_unknown: recovery receipt requires inspection") from None
        elif transaction.name != same_id:
            raise RuntimeError("outcome_unknown: prepared operator acknowledgement requires its original receipt")


def _evidence(host, status, run, native_request_ids):
    ids = list(native_request_ids)
    if len(ids) > 8 or len(set(ids)) != len(ids):
        raise ValueError("recovery_native_request_limit")
    client = host.parent / "client"
    if client.is_symlink() or (client / "requests").is_symlink():
        raise RuntimeError("recovery_symlink_refused")
    archive = client / f"events-{run}.jsonl"
    raw = _read(archive)
    terminals, previous = {}, 0
    for line in raw.splitlines():
        if not line.strip():
            continue
        event = json.loads(line)
        if not isinstance(event, dict):
            raise RuntimeError("recovery_archive_binding_invalid")
        cursor = event.get("cursor")
        if event.get("run") != run or type(cursor) is not int or cursor <= previous:
            raise RuntimeError("recovery_archive_binding_invalid")
        previous = cursor
        execution = event.get("execution")
        if isinstance(execution, dict) and execution.get("terminal") is True:
            terminals[execution.get("id")] = execution.get("phase")
    sources = [{"role": "native_archive", "sha256": _hash(raw)}]
    work = []
    pending = status.get("pending", [])
    if not isinstance(pending, list) or len(pending) > 32:
        raise RuntimeError("recovery_status_pending_invalid")
    if any(not isinstance(item, dict) or not isinstance(item.get("id"), str) for item in pending):
        raise RuntimeError("recovery_status_pending_invalid")
    pending_ids = {item["id"] for item in pending}
    for request in ids:
        _uuid(request)
        path = client / "requests" / (_hash(request.encode()) + ".json")
        raw_request = _read(path, 1024 * 1024)
        record = json.loads(raw_request.decode("utf-8-sig"))
        if not isinstance(record, dict) or not isinstance(record.get("outcome"), dict) or not isinstance(record["outcome"].get("execution"), dict):
            raise RuntimeError("recovery_request_binding_invalid")
        execution = (record.get("outcome") or {}).get("execution") or {}
        execution_id = execution.get("id")
        if (record.get("requestId") != request or record.get("phase") != "returned"
                or execution.get("phase") != "accepted" or execution.get("terminal") is not False
                or not isinstance(execution_id, str) or not re.fullmatch(r"[a-zA-Z0-9_.:-]{1,160}", execution_id)
                or execution_id not in pending_ids):
            raise RuntimeError("recovery_request_binding_invalid")
        sources.append({"role": "native_request", "request_id": request, "sha256": _hash(raw_request)})
        terminal = terminals.get(execution_id)
        work.append({"request_id": request, "execution_id": execution_id,
                     "classification": "archived_terminal" if terminal is not None else "accepted_only_unknown",
                     "terminal_phase": terminal, "verified": False})
    for execution_id in pending_ids - {item["execution_id"] for item in work}:
        if not isinstance(execution_id, str) or not re.fullmatch(r"[a-zA-Z0-9_.:-]{1,160}", execution_id):
            raise RuntimeError("recovery_execution_identity_invalid")
        work.append({"execution_id": execution_id, "classification": "unlinked_unknown", "verified": False})
    return {"old_work": work, "sources": sources, "archive_last_cursor": previous,
            "archive_file_scanned": True, "old_run_completion_verified": False}


def assess(settings, data_root, *, native_request_ids=()):
    """Readonly local evidence. An eligible shape is never automatic success."""
    host = _root(settings, data_root)
    state_raw, status_raw = _read(host / "host-state.json", 65536), _read(host / "status.json")
    state, status = json.loads(state_raw), json.loads(status_raw)
    if not isinstance(state, dict) or not isinstance(status, dict):
        raise RuntimeError("recovery_evidence_object_required")
    session, run = _uuid(status.get("runtime_session")), _uuid(status.get("native_run"))
    if status.get("settings_identity") != settings.identity:
        raise RuntimeError("recovery_settings_identity_mismatch")
    database = host / "commands.sqlite3"
    # Canonical Mailbox uses rollback journaling. A readonly SQLite connection
    # can create/update WAL shared-memory sidecars; never do that in assessment,
    # and never use immutable=1 (which would silently ignore pending WAL rows).
    if database.is_symlink() or any(database.with_name(database.name + suffix).exists() for suffix in ("-wal", "-shm")):
        raise RuntimeError("recovery_quiescent_rollback_mailbox_required")
    with sqlite3.connect(database.as_uri() + "?mode=ro", uri=True) as db:
        dispatching = db.execute("SELECT count(*) FROM commands WHERE state='dispatching'").fetchone()[0]
    evidence = _evidence(host, status, run, native_request_ids)
    owner = session_is_owned(host)
    shape = (status.get("phase") == "failed" and status.get("game_connected") is False
             and status.get("autonomy_running") is False and state.get("stopped") is True
             and state.get("uncertain") is True and state.get("pending") == []
             and "inflight_request" in state and state["inflight_request"] is None and not dispatching and not owner)
    pending_ack = False
    try:
        require_no_pending_acknowledgement(host)
    except RuntimeError:
        pending_ack = True
    return {"identity": settings.identity, "runtime_session": session, "native_run": run,
            "state_sha256": _hash(state_raw), "status_sha256": _hash(status_raw),
            "stopped": state.get("stopped") is True, "uncertain": state.get("uncertain") is True,
            "pending_empty": state.get("pending") == [], "inflight_empty": "inflight_request" in state and state["inflight_request"] is None,
            "dispatching_count": dispatching, "owner_held": owner, "pending_acknowledgement": pending_ack,
            "eligible_shape": shape and not pending_ack, "classification": "unknown", "verified": False, **evidence}


def _write_immutable(path, body):
    if path.exists():
        if _read(path) != body:
            raise RuntimeError("recovery_immutable_record_conflict")
        return
    temporary = path.with_name(path.name + ".staging")
    if temporary.exists():
        if _read(temporary) != body:
            raise RuntimeError("recovery_staging_record_requires_inspection")
        mode = "r+b"
    else:
        mode = "xb"
    with temporary.open(mode) as stream:
        if mode == "xb":
            stream.write(body)
        stream.flush()
        os.fsync(stream.fileno())
    # The account lease excludes other conforming writers. Publish only after
    # flushing the complete record; a failed flush leaves no committed receipt.
    if path.exists():
        raise RuntimeError("recovery_immutable_record_conflict")
    temporary.rename(path)


def _replace_state(path, body, expected):
    if _hash(_read(path, 65536)) != expected:
        raise RuntimeError("recovery_state_changed")
    temporary = path.parent / "recovery-state.tmp"
    with temporary.open("wb") as stream:
        stream.write(body)
        stream.flush()
        os.fsync(stream.fileno())
    if _hash(_read(path, 65536)) != expected:
        raise RuntimeError("recovery_state_changed")
    temporary.replace(path)


def acknowledge_unknown(settings, data_root, *, expected_identity, expected_session, expected_run,
                        expected_state_sha256, expected_status_sha256, acknowledgement_id,
                        operator, reason, evidence_id, attest_prior_processes_exited,
                        choice, native_request_ids):
    """Explicit administrator operation; never exported as a planner/host tool."""
    acknowledgement_id = _uuid(acknowledgement_id)
    _uuid(expected_session)
    _uuid(expected_run)
    for digest in (expected_state_sha256, expected_status_sha256):
        if not isinstance(digest, str) or not re.fullmatch("[a-f0-9]{64}", digest):
            raise ValueError("recovery_sha256_required")
    if expected_identity != settings.identity or choice != "acknowledge-unknown" or attest_prior_processes_exited is not True:
        raise ValueError("recovery_explicit_operator_attestation_required")
    if not native_request_ids:
        raise ValueError("recovery_original_native_request_required")
    metadata = {"operator": _text(operator, 120), "reason": _text(reason, 600), "evidence_id": _text(evidence_id, 200),
                "prior_processes_exited": "externally_attested_not_independently_verified"}
    contract = {"identity": expected_identity, "runtime_session": expected_session, "native_run": expected_run,
                "state_sha256": expected_state_sha256, "status_sha256": expected_status_sha256,
                "native_request_ids": list(native_request_ids), "choice": choice, **metadata}
    signature = _hash(_encode(contract))
    host = _root(settings, data_root)
    transaction = host / "recovery-acknowledgements" / acknowledgement_id

    def committed_first():
        if not (transaction / "committed.json").exists():
            return None
        prepared, committed = _receipt(transaction)
        if prepared.get("signature") != signature:
            raise RuntimeError("recovery_stable_id_conflict")
        return committed

    if receipt := committed_first():
        return receipt  # Readonly retry does not touch a later run or its owner.
    with session_lease(host):
        if receipt := committed_first():
            return receipt
        require_no_pending_acknowledgement(host, same_id=acknowledgement_id)
        observed = assess(settings, data_root, native_request_ids=native_request_ids)
        if (observed["runtime_session"] != expected_session or observed["native_run"] != expected_run
                or observed["status_sha256"] != expected_status_sha256 or observed["dispatching_count"]):
            raise RuntimeError("recovery_binding_changed")
        before_state, before_status = _read(host / "host-state.json", 65536), _read(host / "status.json")
        state = json.loads(before_state)
        if (transaction / "prepared.json").exists():
            prepared = _json(transaction / "prepared.json", 65536)
            if prepared.get("signature") != signature:
                raise RuntimeError("recovery_stable_id_conflict")
            if observed["state_sha256"] not in {expected_state_sha256, prepared["after_state_sha256"]}:
                raise RuntimeError("recovery_state_changed")
            if _hash(_read(transaction / "before-state.json", 65536)) != expected_state_sha256 or _hash(_read(transaction / "before-status.json")) != expected_status_sha256:
                raise RuntimeError("recovery_original_evidence_changed")
            if prepared["sources"] != observed["sources"]:
                raise RuntimeError("recovery_native_evidence_changed")
            after_state = _encode({**json.loads(_read(transaction / "before-state.json", 65536)), "uncertain": False})
        else:
            # We hold the owner lock ourselves: owner_held is expected here.
            if (observed["state_sha256"] != expected_state_sha256 or not observed["stopped"] or not observed["uncertain"]
                    or not observed["pending_empty"] or not observed["inflight_empty"]):
                raise RuntimeError("recovery_empty_stopped_unknown_required")
            status = json.loads(before_status)
            if status.get("phase") != "failed" or status.get("game_connected") is not False or status.get("autonomy_running") is not False:
                raise RuntimeError("recovery_failed_offline_status_required")
            if any(row["classification"] == "unlinked_unknown" for row in observed["old_work"]):
                raise RuntimeError("recovery_unlinked_old_work")
            after_state = _encode({**state, "uncertain": False})
            transaction.mkdir(parents=True, exist_ok=True)
            _write_immutable(transaction / "before-state.json", before_state)
            _write_immutable(transaction / "before-status.json", before_status)
            prepared = {"id": acknowledgement_id, "signature": signature, "contract": contract,
                        "prepared_at": datetime.now(timezone.utc).isoformat(),
                        "before_state_sha256": expected_state_sha256, "before_status_sha256": expected_status_sha256,
                        "after_state_sha256": _hash(after_state), "sources": observed["sources"], "old_work": observed["old_work"]}
            staged = transaction / "prepared.json.staging"
            if staged.exists():
                original = _json(staged, 65536)
                prepared["prepared_at"] = original.get("prepared_at")
                if _encode(prepared) != _read(staged, 65536):
                    raise RuntimeError("recovery_staging_record_requires_inspection")
            _write_immutable(transaction / "prepared.json", _encode(prepared))
        # Recheck both authoritative files after preparing the immutable evidence.
        if _hash(_read(host / "status.json")) != expected_status_sha256:
            raise RuntimeError("recovery_status_changed")
        if _evidence(host, json.loads(before_status), expected_run, native_request_ids)["sources"] != prepared["sources"]:
            raise RuntimeError("recovery_native_evidence_changed")
        if _hash(_read(host / "host-state.json", 65536)) == expected_state_sha256:
            _replace_state(host / "host-state.json", after_state, expected_state_sha256)
        if _hash(_read(host / "host-state.json", 65536)) != _hash(after_state):
            raise RuntimeError("recovery_state_readback_failed")
        if _hash(_read(host / "status.json")) != expected_status_sha256:
            raise RuntimeError("recovery_status_changed")
        receipt = {"id": acknowledgement_id, "signature": signature, "classification": "acknowledged_unknown",
                   "verified": False, "stopped": True, "autostart": False, "native_replay": False,
                   "identity": expected_identity, "runtime_session": expected_session, "native_run": expected_run,
                   "state_sha256": _hash(after_state), "original_state_sha256": expected_state_sha256,
                   "original_status_sha256": expected_status_sha256,
                   "prepared_sha256": _hash(_read(transaction / "prepared.json", 65536)),
                   "prepared_at": prepared["prepared_at"]}
        _write_immutable(transaction / "committed.json", _encode(receipt))
        return _receipt(transaction)[1]

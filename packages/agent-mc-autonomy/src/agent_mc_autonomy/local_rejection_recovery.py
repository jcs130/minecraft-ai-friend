"""Explicit offline reconciliation of the historical invalid mc_original bug.

This is an administrator command, never a model/host tool. It cannot acknowledge
native actions, replay a request, start a game or infer success from missing data.
"""

import argparse
import json
import os
import sqlite3
import tomllib
from contextlib import closing
from pathlib import Path

from .original_query import original_query_error
from .ownership import session_lease
from .recovery import _encode, _hash, _json, _read, _replace_state, _root, _text, _uuid


def durable_write(path, body):
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("wb") as stream:
        stream.write(body)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


def require_no_pending_local_reconciliation(host):
    root = host / "local-read-reconciliations"
    if root.is_symlink():
        raise RuntimeError("recovery_symlink_refused")
    entries = list(root.iterdir()) if root.exists() else []
    if len(entries) > 256:
        raise RuntimeError("recovery_receipt_limit")
    for entry in entries:
        if entry.is_symlink():
            raise RuntimeError("recovery_symlink_refused")
        if (entry / "prepared.json").exists():
            if not (entry / "receipt.json").exists() or _json(
                entry / "prepared.json"
            ) != _json(entry / "receipt.json"):
                raise RuntimeError(
                    "outcome_unknown: unfinished local read reconciliation requires its original receipt"
                )


def latest_decision(host):
    path = host / "decisions.jsonl"
    if path.is_symlink():
        raise RuntimeError("recovery_symlink_refused")
    with path.open("rb") as stream:
        stream.seek(0, 2)
        stream.seek(max(0, stream.tell() - 65536))
        lines = stream.read(65537).splitlines()
    if not lines or len(lines[-1]) > 32768:
        raise RuntimeError("recovery_decision_evidence_required")
    return lines[-1], json.loads(lines[-1])


def reconcile_local_original_rejection(
    settings,
    data_root,
    *,
    expected_state_sha256,
    expected_status_sha256,
    expected_decision_sha256,
    request_id,
    operator,
    evidence_id,
    attest_prior_processes_exited,
):
    host = _root(settings, data_root)
    request_id = _uuid(request_id)
    metadata = {
        "operator": _text(operator, 120),
        "evidence_id": _text(evidence_id, 200),
    }
    if attest_prior_processes_exited is not True:
        raise ValueError("recovery_explicit_operator_attestation_required")
    audit = host / "local-read-reconciliations" / request_id
    if audit.is_symlink():
        raise RuntimeError("recovery_symlink_refused")
    contract = {
        "state_sha256": expected_state_sha256,
        "status_sha256": expected_status_sha256,
        "decision_sha256": expected_decision_sha256,
        **metadata,
    }
    with session_lease(host):
        receipt_path = audit / "receipt.json"
        if receipt_path.exists():
            receipt = _json(receipt_path)
            if receipt["contract"] != contract:
                raise RuntimeError("recovery_stable_id_conflict")
            return receipt
        prepared_path = audit / "prepared.json"
        if prepared_path.exists():
            prepared = _json(prepared_path)
            if prepared["contract"] != contract:
                raise RuntimeError("recovery_stable_id_conflict")
            if (
                _hash(_read(audit / "before-state.json", 65536))
                != expected_state_sha256
                or _hash(_read(audit / "before-status.json")) != expected_status_sha256
                or _hash(_read(audit / "decision.json", 65536))
                != expected_decision_sha256
            ):
                raise RuntimeError("recovery_original_evidence_changed")
            if (
                _hash(_read(host / "host-state.json", 65536))
                == prepared["after_state_sha256"]
            ):
                if (
                    _hash(_read(host / "status.json")) != expected_status_sha256
                    or _hash(latest_decision(host)[0]) != expected_decision_sha256
                ):
                    raise RuntimeError("recovery_evidence_changed")
                durable_write(receipt_path, _encode(prepared))
                return prepared
        state_raw, status_raw = (
            _read(host / "host-state.json", 65536),
            _read(host / "status.json"),
        )
        decision_raw, decision = latest_decision(host)
        if (
            _hash(state_raw) != expected_state_sha256
            or _hash(status_raw) != expected_status_sha256
            or _hash(decision_raw) != expected_decision_sha256
        ):
            raise RuntimeError("recovery_evidence_changed")
        state, status = json.loads(state_raw), json.loads(status_raw)
        if (
            state.get("stopped") is not True
            or state.get("pending") != []
            or state.get("uncertain") is not True
            or status.get("phase") != "failed"
            or status.get("game_connected") is not False
            or status.get("autonomy_running") is not False
            or status.get("settings_identity") != settings.identity
        ):
            raise RuntimeError("recovery_quiescent_failed_owner_required")
        inflight = _uuid(state.get("inflight_request"))
        calls = decision.get("response", {}).get("tool_calls", [])
        if len(calls) != 1 or calls[0].get("function", {}).get("name") != "mc_original":
            raise RuntimeError("recovery_only_invalid_local_original_allowed")
        args = calls[0]["function"]["arguments"]
        args = json.loads(args) if isinstance(args, str) else args
        offset, limit = args.get("offset", 0), args.get("limit", 1000)
        if (
            not original_query_error(args)
            or type(offset) is int
            and offset >= 0
            and type(limit) is int
            and 1 <= limit <= 1000
        ):
            raise RuntimeError("recovery_only_invalid_local_original_allowed")
        # Require the actual historical local validation traceback, not a model
        # report. These exact invalid pagination checks precede every body call.
        error = _read(host / "host-error.log", 262144).decode("utf-8", errors="replace")
        if (
            "in original_page" not in error
            or "ValueError: Invalid original artifact page" not in error
        ):
            raise RuntimeError("recovery_original_validation_trace_required")
        database = host / "commands.sqlite3"
        if database.is_symlink() or any(
            database.with_name(database.name + suffix).exists()
            for suffix in ("-wal", "-shm")
        ):
            raise RuntimeError("recovery_quiescent_rollback_mailbox_required")
        with closing(sqlite3.connect(database.as_uri() + "?mode=ro", uri=True)) as db:
            if db.execute(
                "SELECT count(*) FROM commands WHERE state='dispatching'"
            ).fetchone()[0]:
                raise RuntimeError("recovery_dispatching_command")
        audit.mkdir(parents=True, exist_ok=True)
        for name, body in [
            ("before-state.json", state_raw),
            ("before-status.json", status_raw),
            ("decision.json", decision_raw),
        ]:
            target = audit / name
            if target.exists() and target.read_bytes() != body:
                raise RuntimeError("recovery_original_evidence_changed")
            durable_write(target, body)
        after = _encode({**state, "inflight_request": None, "uncertain": False})
        receipt = {
            "id": request_id,
            "contract": contract,
            "classification": "local_validation_rejected",
            "request_id": inflight,
            "tool": "mc_original",
            "dispatched": False,
            "native_replay": False,
            "autostart": False,
            "goal_verified": False,
            "after_state_sha256": _hash(after),
            "prior_processes_exited": "externally_attested",
        }
        durable_write(audit / "prepared.json", _encode(receipt))
        _replace_state(host / "host-state.json", after, expected_state_sha256)
        durable_write(receipt_path, _encode(receipt))
        return receipt


def main():
    from .configuration import Settings

    parser = argparse.ArgumentParser(description=__doc__)
    for field in [
        "config",
        "data",
        "expected-state-sha256",
        "expected-status-sha256",
        "expected-decision-sha256",
        "request-id",
        "operator",
        "evidence-id",
    ]:
        parser.add_argument("--" + field, required=True)
    parser.add_argument("--attest-prior-processes-exited", action="store_true")
    args = vars(parser.parse_args())
    settings = Settings.parse(
        tomllib.loads(Path(args.pop("config")).read_text(encoding="utf-8-sig"))
    )
    data = Path(args.pop("data"))
    print(
        json.dumps(reconcile_local_original_rejection(settings, data, **args), indent=2)
    )


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Read-only migration inventory. Never releases leases, changes config or replays actions.

Output is an audit, NOT a deployment approval. No credentials, dialogue or memory text
are emitted. Run again immediately before a reviewed handoff; a live snapshot can drift.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
from uuid import UUID

CONFIGS = {
    "legacyBrain": "plugins/QiandengjiMaidBridge/brain-routing.json",
    "legacyRegistry": "plugins/QiandengjiMaidBridge/native-registry.json",
    "speech": "plugins/QiandengjiMaidBridge/companion-speech.json",
    "legacyResidence": "plugins/QiandengjiMaidBridge/residence.json",
    "agents": "config/tlm-maid-agents.json",
    "residents": "config/tlm-residents.json",
    "companions": "config/tlm-companions.json",
}
TERMINAL = {"applied", "completed", "failed", "blocked", "rejected", "cancelled", "expired", "partial", "replied", "closed"}


def digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def audit(server: Path, maid_id: str, owner_id: str) -> dict:
    maid_id, owner_id = str(UUID(maid_id)), str(UUID(owner_id))
    root = server.resolve(strict=True)
    report = {
        "schemaVersion": 1, "mode": "read_only", "observedAt": datetime.now(timezone.utc).isoformat(),
        "maidId": maid_id, "expectedOwnerId": owner_id,
        "deploymentReady": False, "runtimeVerified": False,
        "snapshotSemantics": "files_sampled_sequentially_not_an_atomic_world_snapshot",
        "configs": {}, "findings": [],
        "requiredRuntimeChecks": ["single_controller_handoff", "original_body_and_owner", "original_inventory_and_model",
                                  "same_memory_scope", "speech_and_dialogue", "query_original_pending_requests",
                                  "native_navigation_and_stop", "restart_and_reconnect_without_replay"],
    }
    findings = report["findings"]
    docs = {}
    for name, relative in CONFIGS.items():
        path = root / relative
        if not path.exists():
            report["configs"][name] = {"present": False}
            docs[name] = {}
            continue
        try:
            if not path.resolve().is_relative_to(root):
                raise ValueError("external_path")
            if path.stat().st_size > 2 * 1024 * 1024:
                raise ValueError("too_large")
            raw = path.read_bytes()
            if len(raw) > 2 * 1024 * 1024:
                raise ValueError("too_large")
            doc = json.loads(raw.decode("utf-8-sig"))
            if not isinstance(doc, dict):
                raise ValueError("not_object")
            docs[name] = doc
            report["configs"][name] = {"present": True, "sha256": digest(raw), "bytes": len(raw)}
        except (ValueError, UnicodeError, OSError):
            docs[name] = {}
            report["configs"][name] = {"present": True, "readable": False}
            findings.append({"code": "config_unreadable", "source": name})

    def own_binding(doc, source):
        bound = isinstance(doc, dict) and doc.get("maidId") == maid_id
        if bound and doc.get("ownerId") != owner_id:
            findings.append({"code": "owner_mismatch", "source": source})
        return bound

    def rows(source, key):
        values = docs[source].get(key, [])
        if not isinstance(values, list) or any(not isinstance(x, dict) for x in values):
            findings.append({"code": "invalid_binding_list", "source": source})
            return []
        found = [x for x in values if x.get("maidId") == maid_id]
        if len(found) > 1:
            findings.append({"code": "duplicate_binding", "source": source})
        return found

    legacy = own_binding(docs["legacyBrain"], "legacyBrain")
    agents = rows("agents", "maids")
    for a in agents:
        own_binding(a, "agents")
    residents = rows("residents", "residents")
    offers = rows("companions", "offers")
    report["bindings"] = {"legacyBrain": legacy, "standaloneAgent": bool(agents), "resident": bool(residents),
                          "publicRecruitment": bool(offers), "legacyResidence": own_binding(docs["legacyResidence"], "legacyResidence")}
    if legacy and agents:
        findings.append({"code": "duplicate_brain_controller", "effect": "MaidBrainControl.bind_rejects_second_active_handler"})
    if not residents:
        findings.append({"code": "not_registered_as_resident"})
    if residents and not agents:
        findings.append({"code": "resident_without_agent_binding"})
    if residents and report["bindings"]["legacyResidence"]:
        findings.append({"code": "legacy_navigation_requires_explicit_handoff"})

    registry = docs["legacyRegistry"].get("maids", {})
    row = registry.get(maid_id, {}) if isinstance(registry, dict) else {}
    if not isinstance(row, dict):
        findings.append({"code": "invalid_original_registry_entry"})
        row = {}
    if row:
        own_binding(row, "legacyRegistry")
    else:
        findings.append({"code": "original_registry_entry_missing"})
    # Fingerprints only. Session/binding keys and memory namespace must stay private.
    report["originalRegistry"] = {"present": bool(row), "identityFields": {
        k: {"present": k in row, "sha256": digest(json.dumps(row[k], ensure_ascii=False, sort_keys=True).encode()) if k in row else None}
        for k in ("maidId", "ownerId", "sessionKey", "agentBindingKey", "memoryNamespace", "inferenceOwner")}}
    speech = docs["speech"]
    speech_bound = own_binding(speech, "speech")
    voice = speech.get("voice")
    safe_voice = voice if isinstance(voice, str) and re.fullmatch(r"[a-zA-Z0-9_.:-]{1,128}", voice) else None
    report["speech"] = {"boundToOriginal": speech_bound, "voice": safe_voice if speech_bound else None,
                        "backendConfigured": bool(speech.get("backend")), "tokenConfigured": bool(speech.get("tokenFile"))}

    ledger = root / "plugins/QiandengjiMaidBridge/native-receipts"
    status_counts: Counter = Counter()
    unreadable = 0
    limited = False
    if ledger.is_dir():
        for index, path in enumerate(ledger.glob(maid_id + "_*.json")):
            if index >= 50000:
                limited = True
                break
            try:
                if not path.resolve().is_relative_to(root) or path.stat().st_size > 256 * 1024:
                    raise ValueError("unbounded_receipt")
                raw = path.read_bytes()
                if len(raw) > 256 * 1024:
                    raise ValueError("unbounded_receipt")
                entry = json.loads(raw.decode("utf-8-sig"))
                # This is the legacy journal schema, not a guess at a resident receipt.
                if not isinstance(entry, dict):
                    raise ValueError("invalid_receipt")
                status = entry.get("status", "unclassified")
                known = TERMINAL | {"unknown", "pending", "accepted", "reserved", "running", "queued", "timeout"}
                status_counts[status if isinstance(status, str) and status in known else "unclassified"] += 1
            except (ValueError, UnicodeError, OSError):
                unreadable += 1
    report["legacyReceipts"] = {"readable": sum(status_counts.values()), "unreadable": unreadable,
        "statuses": dict(sorted(status_counts.items())), "partial": limited,
        "containsUncertainHistory": any(k not in TERMINAL for k in status_counts) or bool(unreadable) or limited,
        "activeOperationVerified": False,
        "terminalMeaning": "dialogue_replied_or_closed_does_not_prove_a_world_action_completed",
        "policy": "query_original_request_in_original_ledger_never_replay_or_invent_terminal_status"}
    report["finishedAt"] = datetime.now(timezone.utc).isoformat()
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--server", type=Path, required=True)
    parser.add_argument("--maid-id", required=True)
    parser.add_argument("--owner-id", required=True)
    args = parser.parse_args()
    try:
        result = audit(args.server, args.maid_id, args.owner_id)
    except (ValueError, OSError):
        parser.exit(2, "Invalid server directory or UUID; no files were changed.\n")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

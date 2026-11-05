"""Read-only party4 artifact and host evidence audit. No network, model or game calls.

An artifact symbol check is not a JVM/linkage test. An evidence audit checks supplied
exports, not their authenticity or current process liveness. Never deploys or repairs.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import struct
import sys
import tomllib
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path

COMPONENTS = {"native": "VortexRPG", "bridge": "QiandengjiRpg", "friend": "AgentFriend"}
REQUIREMENTS = {
    "native": {"io/vortexcore/world/ExpeditionPartyManager.class":
               {"createParty", "invite", "acceptInvite", "partyOf", "pendingInviteOf"}},
    "bridge": {
        "org/qiandengji/vortex/NativeParties.class": {"plan", "org/qiandengji/vortex/PartyFormation"},
        "org/qiandengji/vortex/NativePartyView.class": {"selfUuid", "partyId", "memberCount"},
        "org/qiandengji/vortex/PartyFormation.class": {"plan", "nativeCapacity", "membershipConfirmed"},
        **{f"org/qiandengji/vortex/PartyFormation${name}.class": {name}
           for name in ("Actor", "Team", "Invitation")},
    },
    "friend": {"org/afuhome/agentfriend/AgentCliCatalog.class": {"guild.party.plan"}},
}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def package_version(path):
    if Path(path).suffix == ".toml":
        return tomllib.loads(Path(path).read_text(encoding="utf-8"))["project"]["version"]
    return read_json(path).get("version")


def stamp(value):
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("timezone_required")
    return parsed.timestamp()


def identity(value):
    return str(uuid.UUID(value))


def class_symbols(data):
    """Parse JVM constant-pool UTF8 entries, never load or execute a class."""
    if data[:4] != b"\xca\xfe\xba\xbe":
        raise ValueError("invalid_class_magic")
    count = struct.unpack_from(">H", data, 8)[0]
    offset, index, symbols = 10, 1, set()
    widths = {3: 4, 4: 4, 5: 8, 6: 8, 7: 2, 8: 2, 9: 4, 10: 4, 11: 4,
              12: 4, 15: 3, 16: 2, 17: 4, 18: 4, 19: 2, 20: 2}
    while index < count:
        tag = data[offset]
        offset += 1
        if tag == 1:
            length = struct.unpack_from(">H", data, offset)[0]
            offset += 2
            if offset + length > len(data):
                raise ValueError("truncated_class")
            # Required symbols are ASCII; modified UTF8 elsewhere is immaterial.
            symbols.add(data[offset:offset + length].decode("utf-8", errors="replace"))
            offset += length
        else:
            if tag not in widths:
                raise ValueError("unknown_class_constant")
            offset += widths[tag]
            if tag in (5, 6):
                index += 1
        if offset > len(data):
            raise ValueError("truncated_class")
        index += 1
    return symbols


def expected_digests(manifest, component):
    # Only the current top-level digest map; nested history is not a live baseline.
    return sorted(set(value.lower() for name, value in manifest.get("liveArtifactDigests", {}).items()
                      if re.match(re.escape(component) + r"(?:-|\.jar$)", name.replace("\\", "/").split("/")[-1])))


def inspect_artifacts(manifest, files):
    rows = {}
    for key, name in COMPONENTS.items():
        expected = expected_digests(manifest, name)
        row = {"component": name, "recordedVersion": manifest.get("runtime", {}).get(name),
               "recordedSha256": expected, "artifact": "not_supplied", "matchesRecordedDigest": None,
               "recordedDigestUnique": len(expected) == 1, "symbolsPresent": None}
        rows[key] = row
        if not files.get(key):
            continue
        data = Path(files[key]).read_bytes()
        row.update(artifact="inspected", sha256=digest(data), matchesRecordedDigest=digest(data) in expected)
        with zipfile.ZipFile(files[key]) as jar:
            names = jar.namelist()
            if len(names) != len(set(names)):
                raise ValueError("duplicate_jar_entries")
            descriptor = "\n".join(jar.read("plugin.yml").decode("utf-8-sig").splitlines())
            for field in ("name", "version"):
                found = re.findall(r"(?m)^" + field + r":\s*([^\r\n]+)$", descriptor)
                if len(found) != 1:
                    raise ValueError("invalid_plugin_descriptor")
                row[field] = found[0].strip().strip("\"'")
            if row["name"] != name:
                raise ValueError("wrong_plugin_identity")
            checks = {}
            for entry, required in REQUIREMENTS[key].items():
                observed = class_symbols(jar.read(entry)) if entry in names else set()
                checks[entry] = {"present": entry in names, "missingSymbols": sorted(required - observed)}
            row["checks"] = checks
            row["symbolsPresent"] = all(v["present"] and not v["missingSymbols"] for v in checks.values())
    complete = all(row["symbolsPresent"] is True and row["matchesRecordedDigest"] is True
                   and row["recordedDigestUnique"] for row in rows.values())
    return {"schema": "party4-artifact-audit/v1", "productionChanged": False, "networkCalled": False,
            "runtimeVerified": False, "binaryCompatibilityVerified": False,
            "recordedAt": manifest.get("verifiedAt"), "components": rows,
            "status": "recorded_artifact_symbols_present" if complete else "needs_artifact_review",
            "nextStep": "Run marked isolated client acceptance; never install the frozen AF.39 party4 candidate over a newer baseline."}


def audit(spec_path):
    """Audit original, local host exports; never infer replies from matching text."""
    spec_path = Path(spec_path).resolve()
    spec = read_json(spec_path)
    if spec.get("schema") != "party4-evidence-spec/v1":
        raise ValueError("unsupported_evidence_spec")
    actors = spec.get("actors", [])
    if len(actors) != 4 or len({a["account"].casefold() for a in actors}) != 4:
        raise ValueError("exactly_four_distinct_accounts_required")
    start, end = stamp(spec["window"]["start"]), stamp(spec["window"]["end"])
    if start >= end:
        raise ValueError("invalid_observation_window")
    ids = [identity(a["uuid"]) for a in actors if a.get("uuid")]
    if len(set(ids)) != len(ids):
        raise ValueError("duplicate_actor_uuid")
    actor_ids = set(ids)
    valid_roster = len(ids) == 4
    files, rows, statuses, errors = {}, [], [], []

    def read(relative, *, lines=False):
        path = Path(relative)
        if not path.is_absolute():
            path = spec_path.parent / path
        data = path.read_bytes()
        files[str(relative)] = digest(data)
        text = data.decode("utf-8-sig")
        return [json.loads(line) for line in text.splitlines() if line.strip()] if lines else json.loads(text)

    for actor in actors:
        account, uid = actor["account"], actor.get("uuid")
        row = {"account": account, "uuid": uid, "gaps": [], "hostCaptureConsistent": False,
               "receivedFrom": [], "modelObservedFrom": [], "replyTurns": [], "survivalTasks": []}
        rows.append(row)
        if not uid:
            row["gaps"].append("actual_uuid_not_supplied")
            continue
        uid = identity(uid)
        if not actor.get("host") or not actor.get("events"):
            row["gaps"].append("host_or_event_export_not_supplied")
            continue
        host, events = read(actor["host"]), read(actor["events"], lines=True)
        host_ok = (host.get("schema") == "party4-host-capture/v1" and host.get("account") == account
                   and host.get("uuid") == uid and host.get("runId") == spec["runId"]
                   and host.get("serverId") == spec["serverId"] and start <= stamp(host["capturedAt"]) <= end
                   and host.get("connectionId") and host.get("family") and host.get("version")
                   and host.get("coreVersion") and host.get("modelRoute")
                   and isinstance(host.get("wakePolicy"), dict) and host["wakePolicy"]
                   and type(host.get("process", {}).get("pid")) is int and host["process"]["pid"] > 0
                   and stamp(host["process"]["startedAt"]) <= stamp(host["capturedAt"]))
        if host_ok:
            # Hash the actual exported installation files. No command line/env/config values are copied.
            for field in ("entrypoint", "hostPackage", "corePackage"):
                file = actor.get(field)
                if not file:
                    host_ok = False
                    break
                path = Path(file)
                if not path.is_absolute():
                    path = spec_path.parent / path
                actual = digest(path.read_bytes())
                files[file] = actual
                if host.get("installationSha256", {}).get(field) != actual:
                    host_ok = False
            if host_ok:
                for field, version in (("hostPackage", "version"), ("corePackage", "coreVersion")):
                    file = Path(actor[field])
                    if not file.is_absolute():
                        file = spec_path.parent / file
                    if package_version(file) != host[version]:
                        host_ok = False
        row["hostCaptureConsistent"] = bool(host_ok)
        if not host_ok:
            row["gaps"].append("host_binding_or_installation_unverified")
            continue
        row["host"] = {key: host[key] for key in ("family", "version", "coreVersion")}
        row["host"]["wakePolicy"] = {key: host["wakePolicy"][key] for key in
            ("enabled", "categories", "paused", "socialEnabled", "batchSeconds", "cooldownSeconds", "maxPeerTurns")
            if key in host["wakePolicy"]}
        by_id = {}
        for event in events:
            if (event.get("account") != account or event.get("uuid") != uid
                    or event.get("runId") != spec["runId"] or event.get("serverId") != spec["serverId"]
                    or event.get("connectionId") != host["connectionId"]):
                errors.append({"account": account, "reason": "event_binding_mismatch"})
                continue
            if not start <= stamp(event["at"]) <= end:
                continue
            if not event.get("id") or event["id"] in by_id:
                errors.append({"account": account, "reason": "missing_or_duplicate_event_id"})
                continue
            by_id[event["id"]] = event
        receives, inputs, results, sends, receive_keys = {}, {}, {}, [], set()
        party = []
        for eid, event in by_id.items():
            kind = event.get("kind")
            if kind == "party.status":
                party.append(event)  # Later negative snapshots must supersede earlier success.
            elif kind == "chat.received":
                native = event.get("event", {})
                meta = native.get("meta", {})
                sender = meta.get("senderUuid")
                if (native.get("type") in ("minecraft.chat", "chat") and native.get("run")
                        and type(native.get("cursor")) is int and native["cursor"] >= 0
                        and isinstance(native.get("text"), str) and native["text"].strip()
                        and meta.get("channel") in ("public", "private")
                        and sender in actor_ids - {uid} and not meta.get("outgoing")
                        and meta.get("identityEvidence") in ("packet-sender", "player-list-format")
                        and not meta.get("staleEpoch") and native.get("contextDelivery") != "archive-only"
                        and start <= stamp(native["ts"]) <= stamp(event["at"]) + 5):
                    key = (native["run"], native["cursor"])
                    if key in receive_keys:
                        errors.append({"account": account, "reason": "duplicate_native_receive_cursor"})
                    else:
                        receives[eid] = event
                        receive_keys.add(key)
            elif kind == "model.input":
                inputs[eid] = event
            elif kind == "model.result":
                results[eid] = event
            elif kind == "chat.sent":
                sends.append(event)
            elif kind == "activity.completed":
                terminal = by_id.get(event.get("nativeReceiptRef"), {})
                if (event.get("taskId") and event.get("status") == "completed"
                        and terminal.get("kind") == "task.receipt" and terminal.get("status") == "completed"
                        and terminal.get("taskId") == event["taskId"] and terminal.get("receipt")
                        and stamp(terminal["at"]) <= stamp(event["at"])
                        and event.get("activity") in ("gather", "craft", "farm", "explore", "build", "follow")):
                    row["survivalTasks"].append(event["taskId"])
        row["receivedFrom"] = sorted({e["event"]["meta"]["senderUuid"] for e in receives.values()})
        observed = set()
        for result in results.values():
            inp = inputs.get(result.get("inputId"))
            if (not inp or result.get("status") != "completed" or result.get("modelInvocation") != "real"
                    or not (result.get("providerRequestId") or result.get("modelTraceId")) or not result.get("turnId")
                    or result.get("turnId") != inp.get("turnId")
                    or stamp(inp["at"]) > stamp(result["at"])):
                continue
            seen = [receives[ref] for ref in inp.get("receivedEventIds", [])
                    if ref in receives and stamp(receives[ref]["at"]) <= stamp(inp["at"])]
            if not seen:
                continue
            observed.update(e["event"]["meta"]["senderUuid"] for e in seen)
            calls = {call.get("id") for call in result.get("chatToolCalls", []) if call.get("id")}
            for sent in sends:
                receipt = sent.get("chatDelivery", {})
                if (sent.get("turnId") == result["turnId"] and sent.get("toolCallId") in calls
                        and stamp(result["at"]) <= stamp(sent["at"])
                        and receipt.get("protocol") == "agent-mc/chat-delivery/v1"
                        and receipt.get("status") == "sent" and receipt.get("boundary") == "client-transport"
                        and receipt.get("id") and isinstance(receipt.get("text"), str) and receipt["text"].strip()
                        and receipt.get("channel") in ("public", "private")
                        and (receipt["channel"] != "public" or not receipt["text"].lstrip().startswith("/"))
                        and (receipt["channel"] != "private" or receipt.get("to") in
                             {a["account"] for a in actors if a["uuid"] != uid})
                        and stamp(result["at"]) <= stamp(receipt["sentAt"]) <= stamp(sent["at"]) + 5):
                    row["replyTurns"].append(result["turnId"])
        row["replyTurns"] = sorted(set(row["replyTurns"]))
        row["modelObservedFrom"] = sorted(observed)
        party_ok = False
        if party:
            latest = max(party, key=lambda e: stamp(e["at"]))
            value = latest.get("value", {})
            members = [m.get("uuid") for m in value.get("members", [])]
            party_ok = (value.get("type") == "party" and value.get("queryOnly") is True
                        and value.get("selfUuid") == uid and value.get("inParty") is True
                        and valid_roster and len(members) == 4 and len(set(members)) == 4
                        and set(members) == actor_ids and value.get("memberCount") == 4
                        and value.get("partyId"))
            if party_ok:
                statuses.append((value["partyId"], stamp(latest["at"])))
        if not party_ok:
            row["gaps"].append("native_four_member_status_missing")
        for key, reason in (("receivedFrom", "partner_receive_incomplete"), ("modelObservedFrom", "model_consumption_incomplete")):
            if len(row[key]) != 3:
                row["gaps"].append(reason)
        if not row["replyTurns"]:
            row["gaps"].append("model_to_game_reply_not_observed")
        if not row["survivalTasks"]:
            row["gaps"].append("normal_survival_activity_not_observed")
    membership = (len(statuses) == 4 and len({pid for pid, _ in statuses}) == 1
                  and max(t for _, t in statuses) - min(t for _, t in statuses) <= 30)
    complete = membership and not errors and not any(row["gaps"] for row in rows)
    if spec.get("environment") not in ("isolated-real-hosts", "production-passive-export"):
        complete = False
        errors.append({"reason": "fixture_or_unknown_environment_is_not_real_host_acceptance"})
    return {"schema": "party4-evidence-audit/v1", "productionChanged": False, "networkCalled": False,
            "runtimeVerified": False, "evidenceAuthenticityVerified": False, "naturalConversationQualityVerified": False,
            "status": "evidence_complete_pending_human_review" if complete else "incomplete",
            "recordedMembershipConsistent": membership, "fifthSlotFree": membership,
            "directedReceiveRelations": sum(len(r["receivedFrom"]) for r in rows),
            "directedModelRelations": sum(len(r["modelObservedFrom"]) for r in rows),
            "actors": rows, "errors": errors, "sourceSha256": files,
            "crossClientAcknowledgement": "not_inferred", "actionCompletionInferredFromChat": False,
            "window": spec["window"], "auditedAt": datetime.now(timezone.utc).isoformat()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    artifacts = sub.add_parser("artifacts", help="Read current manifest and optional JARs; never install")
    artifacts.add_argument("--manifest", type=Path, required=True)
    for key in COMPONENTS:
        artifacts.add_argument("--" + key, type=Path)
    evidence = sub.add_parser("audit", help="Audit four original host exports; no synthetic conversation")
    evidence.add_argument("--spec", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.action == "artifacts":
            result = inspect_artifacts(read_json(args.manifest), {k: getattr(args, k) for k in COMPONENTS})
        else:
            result = audit(args.spec)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0 if result["status"] in ("recorded_artifact_symbols_present", "evidence_complete_pending_human_review") else 2
    except (OSError, ValueError, KeyError, TypeError, IndexError, AttributeError, struct.error, zipfile.BadZipFile) as error:
        # No original config/chat/credential text in error output.
        print(json.dumps({"status": "invalid_input", "errorType": type(error).__name__,
                          "productionChanged": False, "runtimeVerified": False}))
        return 1


if __name__ == "__main__":
    sys.exit(main())

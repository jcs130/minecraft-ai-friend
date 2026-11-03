"""Local world-operations evidence and durable work queue. Never executes game writes.

Run with the existing QwenPaw Python. JSON inputs are files, not shell fragments.
Native QwenPaw remains the only planner/scheduler; actual construction uses existing
server tools and their authorization, backup and verification procedures.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

ID = re.compile(r"[a-z0-9][a-z0-9_.-]{0,95}\Z")
PHASES = {
    "planned": {"surveyed", "blocked"},
    "surveyed": {"staged", "blocked"},
    "staged": {"applied", "unknown", "blocked"},
    "applied": {"verified", "unknown", "blocked"},
    "unknown": {"staged", "applied", "blocked"},
    "verified": {"reviewed", "blocked"},
    "reviewed": {"surveyed", "blocked"},
    "blocked": {"planned", "surveyed", "staged", "applied", "unknown"},
}
LIVE_READS = ["version AgentFriend", "minecraft:list uuids", "neoforge tps",
              "mycli admin dungeonaudit", "mycli admin dungeons audit",
              "mycli admin worldlife audit", "mycli admin board list"]


def contract():
    return {
        "schemaVersion": 1, "operation": "record", "sideEffects": "local_ledger_only",
        "required": ["request_id", "project_id", "expected_revision", "category", "title", "phase", "next_action"],
        "ids": "lower-case a-z0-9_.-, start alphanumeric, 1..96 characters",
        "expected_revision": "integer from status, never guess; same request_id/content replays only original receipt",
        "category": ["story", "npc", "village", "exploration", "dungeon", "operations"],
        "transitions": {k: sorted(v) for k, v in PHASES.items()},
        "transition_guards": "Same-phase updates are allowed. blocked resumes only its last non-blocked phase. unknown must reconcile to applied, or staged only if it originated there; never directly verified.",
        "evidence": {"required_after_planned": True, "max_items": 20, "max_file_bytes": 16777216,
                     "item": {"path": "existing absolute file", "sha256": "SHA256 of exact file bytes"}},
        "checks": {"required_for": ["verified", "reviewed"], "max_items": 40,
                   "item": {"name": "actual check", "observed_at": "ISO8601 time", "expected": "expected result",
                            "actual": "observed result", "passed": True, "evidence_index": 0}},
        "reason": "required for blocked/unknown; include next safe read and original action ID",
        "outcome": "required for reviewed; actual uptake/sample, failures and limits",
        "minimal_example": {"request_id": "npc-route-plan-20261026", "project_id": "village-npc-routes",
                            "expected_revision": 0, "category": "npc", "title": "NPC通行复查", "phase": "planned",
                            "next_action": "核查原UUID与当前地形", "evidence": []},
        "shell": "QwenPaw Windows shell is cmd.exe by default: write JSON/Python files first; no bash heredoc",
    }


def now():
    return datetime.now(timezone.utc).isoformat()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def atomic(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + f".{os.getpid()}.tmp")
    try:
        with tmp.open("x", encoding="utf-8", newline="\n") as f:
            json.dump(value, f, ensure_ascii=False, indent=2, allow_nan=False)
            f.write("\n")
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            tmp.unlink()


class Conflict(ValueError):
    pass


class Ledger:
    def __init__(self, root):
        self.root = Path(root)
        self.path = self.root / "projects.json"

    def read(self):
        if not self.path.exists():
            return {"schemaVersion": 1, "revision": 0, "projects": {}, "requests": {}, "lease": None}
        return read_json(self.path)

    @contextmanager
    def transaction(self):
        self.root.mkdir(parents=True, exist_ok=True)
        lock = self.root / "ledger.lock"
        try:
            fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            raise Conflict("ledger_busy: inspect the existing lock; never steal it automatically")
        try:
            os.write(fd, json.dumps({"pid": os.getpid(), "at": now()}).encode())
            os.close(fd)
            yield
        finally:
            lock.unlink()

    def submit(self, req):
        if not isinstance(req, dict):
            raise ValueError("request: expected a JSON object; run schema for a minimal example")
        for name in ("request_id", "project_id"):
            if not isinstance(req.get(name), str) or not ID.fullmatch(req[name]):
                raise ValueError(f"{name}: expected lower-case stable ID, 1..96 characters")
        fingerprint = digest(json.dumps(req, sort_keys=True, ensure_ascii=False, allow_nan=False).encode())
        with self.transaction():
            state = self.read()
            previous = state["requests"].get(req["request_id"])
            if previous:
                if previous["fingerprint"] != fingerprint:
                    raise Conflict("request_id_conflict: same ID has different content")
                return dict(previous["receipt"], replayed=True)
            if type(req.get("expected_revision")) is not int or req["expected_revision"] != state["revision"]:
                raise Conflict(f"revision_conflict: read current revision {state['revision']} before editing")
            project = state["projects"].get(req["project_id"])
            phase = req.get("phase")
            allowed = {"planned"}
            if project:
                current = project["phase"]
                allowed = PHASES[current] | {current}
                if current == "blocked":
                    checkpoint = next((h["phase"] for h in reversed(project["history"]) if h["phase"] != "blocked"), "planned")
                    allowed = {"blocked", checkpoint}
                elif current == "unknown":
                    checkpoint = next((h["phase"] for h in reversed(project["history"]) if h["phase"] not in ("blocked", "unknown")), None)
                    if checkpoint != "staged":
                        allowed.discard("staged")
            if not isinstance(phase, str) or phase not in allowed:
                raise ValueError("phase: invalid transition; never jump from a plan to verified")
            for name in ("title", "next_action"):
                if not isinstance(req.get(name), str) or not req[name].strip() or len(req[name]) > 1200:
                    raise ValueError(f"{name}: expected nonempty text <=1200 characters")
            if not isinstance(req.get("category"), str) or req["category"] not in ("story", "npc", "village", "exploration", "dungeon", "operations"):
                raise ValueError("category: expected story|npc|village|exploration|dungeon|operations")
            evidence = req.get("evidence", [])
            if not isinstance(evidence, list) or len(evidence) > 20:
                raise ValueError("evidence: expected at most 20 file references")
            checked = []
            for i, ref in enumerate(evidence):
                if not isinstance(ref, dict) or not isinstance(ref.get("path"), str) or not isinstance(ref.get("sha256"), str):
                    raise ValueError(f"evidence[{i}]: path and sha256 required")
                path = Path(ref["path"])
                if not path.is_absolute() or not path.is_file() or path.stat().st_size > 16 * 1024 * 1024:
                    raise ValueError(f"evidence[{i}].path: existing absolute file <=16 MiB required")
                if digest(path.read_bytes()) != ref["sha256"]:
                    raise Conflict(f"evidence[{i}]: content changed")
                checked.append(dict(ref))
            if phase != "planned" and not checked:
                raise ValueError("evidence: an observation/receipt file is required")
            checks = req.get("checks", [])
            if phase in ("verified", "reviewed"):
                if not isinstance(checks, list) or not checks or len(checks) > 40:
                    raise ValueError("checks: actual post-change checks are required")
                for i, check in enumerate(checks):
                    if (not isinstance(check, dict) or check.get("passed") is not True or
                            not all(check.get(k) for k in ("name", "observed_at", "expected", "actual")) or
                            type(check.get("evidence_index")) is not int or
                            not 0 <= check["evidence_index"] < len(checked)):
                        raise ValueError(f"checks[{i}]: passed, name, time, expected, actual and evidence_index required")
                if phase == "reviewed" and not req.get("outcome"):
                    raise ValueError("outcome: player uptake, success/failure and observed limits required")
            if phase in ("blocked", "unknown") and not req.get("reason"):
                raise ValueError("reason: explain blocker/unknown and next safe read")
            record = {k: req[k] for k in ("project_id", "category", "title", "phase", "next_action")}
            record.update(updated_at=now(), evidence=checked, checks=checks,
                          reason=req.get("reason"), outcome=req.get("outcome"),
                          history=(project or {}).get("history", []) + [{"at": now(), "phase": phase, "request_id": req["request_id"], "evidence": checked}])
            state["projects"][req["project_id"]] = record
            state["revision"] += 1
            receipt = {"status": "recorded", "request_id": req["request_id"], "project_id": req["project_id"],
                       "phase": phase, "revision": state["revision"], "replayed": False,
                       "gameExecuted": False, "verification": "operator_evidence_not_independent_game_validation"}
            state["requests"][req["request_id"]] = {"fingerprint": fingerprint, "receipt": receipt}
            atomic(self.path, state)
            return receipt

    def lease(self, owner, release=False):
        if not ID.fullmatch(owner):
            raise ValueError("owner: stable lower-case run ID required")
        with self.transaction():
            state = self.read()
            old = state.get("lease")
            if old and old["owner"] != owner:
                raise Conflict("world_work_busy: reconcile previous run before transferring the lease")
            state["lease"] = None if release else {"owner": owner, "since": (old or {}).get("since", now()), "renewed_at": now()}
            atomic(self.path, state)
            return {"status": "released" if release else "acquired", "lease": state["lease"]}


def storage_audit(text):
    lines=re.findall(r'^MC_AGENT_STATE_STORAGE (\{[^\r\n]{1,2000}\})\s*$',text,re.M)
    if len(lines)!=1:return None
    try:value=json.loads(lines[0])
    except ValueError:return None
    required={'durableRevision','publishedRevision','projectionPending','cleanupPending','commitUnknown','lastMirrorError'}
    if not isinstance(value,dict)or set(value)!=required:return None
    if any(type(value[key])is not int or value[key]<0 for key in ['durableRevision','publishedRevision']):return None
    if any(type(value[key])is not bool for key in ['projectionPending','cleanupPending','commitUnknown']):return None
    if value['publishedRevision']>value['durableRevision']or not isinstance(value['lastMirrorError'],str):return None
    return dict(value,lastMirrorError=value['lastMirrorError'][:100],state='commit_unknown'if value['commitUnknown']else'projection_delayed'if value['projectionPending']else'published',
                guidance='提交结果未知，核对原记录，勿重放游戏动作'if value['commitUnknown']else'游戏提交已保存；快照延迟不需要重打、重领或重开副本')

def snapshot(server, ops, node):
    server, ops = Path(server), Path(ops)
    started = now()
    result = {"schemaVersion": 1, "observed_at": started, "server": str(server),
              "scope": "configured Java server; features require their own actual receipts", "reads": [], "plugins": [], "datapacks": []}
    for key, path, pattern in (("plugins", server / "plugins", "*.jar"), ("datapacks", server / "world/datapacks", "*.zip")):
        result[key] = sorted(p.name for p in path.glob(pattern))
    module = (ops / "rcon-client.mjs").resolve().as_uri()
    # The command list is fixed here. Caller input is never interpolated into JS or RCON.
    code = "import {command} from " + json.dumps(module) + "; console.log(await command(process.argv[1],Number(process.argv[2])));"
    deadline = time.monotonic() + 45
    for command in LIVE_READS:
        at = now()
        remaining = deadline - time.monotonic()
        if remaining < 1:
            result["reads"].append({"command": command, "observed_at": at, "status": "unknown", "reason": "snapshot_budget_exhausted"})
            continue
        try:
            limit = min(7, remaining)
            p = subprocess.run([node, "--input-type=module", "-e", code, command, str(int((limit-.5)*1000))], capture_output=True, text=True, encoding="utf-8", timeout=limit)
            text = p.stdout.strip() if p.returncode == 0 else "read failed; inspect local service"
            status = "received" if p.returncode == 0 else "error"
            if status == "received" and not text:
                status = "unknown"
            row = {"command": command, "observed_at": at, "status": status, "text": text[:18000], "truncated": len(text) > 18000}
            if command=="mycli admin dungeons audit"and status=="received":
                state=storage_audit(text)
                if state is not None:result['stateStore']=state
            if command == "neoforge tps" and status == "received":
                match = re.search(r"^\s*Overall:\s*(\d+(?:\.\d+)?) TPS \((\d+(?:\.\d+)?) ms/tick\)\s*$", re.sub(r"\u00a7[0-9a-fklmnor]", "", text, flags=re.I), re.M)
                if match and 0 <= float(match[1]) <= 20:
                    result["metrics"] = {"source": "youer_neoforge", "tps": float(match[1]), "mspt": float(match[2])}
                else:
                    row.update(status="unknown", reason="performance_reply_unrecognized")
            result["reads"].append(row)
        except subprocess.TimeoutExpired:
            result["reads"].append({"command": command, "observed_at": at, "status": "unknown", "reason": "read_timeout"})
    # Aggregate activity only. Never forward raw chat, login commands or player inventories.
    log = server / "logs/latest.log"
    if log.exists():
        with log.open("rb") as f:
            size = f.seek(0, 2)
            f.seek(max(0, size - 2_000_000))
            data = f.read().decode("utf-8", errors="replace")
        lines = data.splitlines()[1:] if size > 2_000_000 else data.splitlines()
        result["activity"] = {"scope": "bounded tail of latest.log, not a full day", "bytes": min(size, 2_000_000),
                              "counts": {k: sum(bool(re.search(pattern, l)) for l in lines) for k, pattern in {
                                  "warnings": r"/WARN\]", "errors": r"/ERROR\]", "disconnects": r"lost connection:",
                                  "joins": r"joined the game", "task_queries": r"issued server command: /mycli (tasks|guild)",
                                  "dungeon_commands": r"issued server command: /mycli (arena|dungeon)",
                              }.items()}}
        events=[]
        header=re.compile(r"^\[(\d\d:\d\d:\d\d)\] \[[^\]\r\n]+/(?:WARN|ERROR)\](?: \[[A-Za-z0-9_-]+\])?: (.*)$")
        kinds={"MC_SITE_DUNGEON_SAVE_FAILURE":"dungeon_save_failure","Site dungeon paused for explicit retry":"dungeon_paused","Could not find suitable meteor location":"encounter_search_failed","Can't keep up!":"tick_lag","MC_AGENT_STATE_PROJECTION_DELAYED":"state_projection_delayed"}
        for line in lines:
            match=header.match(line)
            if match:
                for prefix,kind in kinds.items():
                    if match[2].startswith(prefix):events.append({"time":match[1],"kind":kind})
        result["activity"]["recentAlerts"]=events[-8:]
    result["finished_at"] = now()
    result["complete"] = all(x["status"] == "received" and not x.get("truncated") for x in result["reads"])
    result["note"] = "Received text must still be inspected for usage/permission/business failure. Installed JAR does not prove feature readiness. Unknown is not zero."
    return result


def snapshot_brief(value, projects):
    """Bound model input, while the full original receipts stay in the saved file."""
    active=[dict(id=key, title=str(row.get("title",""))[:100], phase=row.get("phase"), next_action=str(row.get("next_action",""))[:180])
            for key,row in sorted(projects.get("projects",{}).items(),key=lambda item:str(item[1].get("updated_at","")),reverse=True)
            if row.get("phase") not in ("reviewed",)]
    return {"observed_at":value["observed_at"],"complete":value["complete"],"metrics":value.get("metrics"),
            "stateStore":value.get('stateStore'),
            "readStatus":[{"command":row["command"],"status":row["status"],"reason":row.get("reason")}for row in value["reads"]],
            "activity":value.get("activity"),"projectRevision":projects.get("revision"),"activeProjectCount":len(active),"projects":active[:8],
            "policy":"本轮只核实并记录最多一个异常；unknown不是正常或零值。建设/长调查交原建设任务，不在巡检循环中重试。"}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--root", type=Path, default=Path(r"D:\qwenpaw\home\workspaces\mc_godness\state\world-evolution"))
    sub = p.add_subparsers(dest="op", required=True)
    sub.add_parser("status")
    sub.add_parser("schema", help="record fields, budgets, transitions and minimal JSON example")
    s = sub.add_parser("record", description="Record a project transition. Run schema for all fields; status for current revision.")
    s.add_argument("--file", type=Path, required=True)
    s = sub.add_parser("lease"); s.add_argument("owner"); s.add_argument("--release", action="store_true")
    s = sub.add_parser("snapshot"); s.add_argument("--out", type=Path, help="optional new evidence file; default is a unique file under the existing ledger")
    s.add_argument("--server", default=r"E:\MC\server"); s.add_argument("--ops", default=r"E:\MC\ops")
    s.add_argument("--node", default=r"C:\Users\lzl19\AppData\Local\hermes\node\node.exe")
    args = p.parse_args()
    try:
        ledger = Ledger(args.root)
        if args.op == "schema":
            out = contract()
        elif args.op == "status":
            state = ledger.read()
            out = {k: state[k] for k in ("schemaVersion", "revision", "lease", "projects")}
        elif args.op == "record":
            out = ledger.submit(read_json(args.file))
        elif args.op == "lease":
            out = ledger.lease(args.owner, args.release)
        else:
            if args.out is None:
                args.out=args.root/"snapshots"/(f"snapshot-{time.time_ns()}-{os.getpid()}.json")
            if args.out.exists():
                raise Conflict("snapshot_exists: use a new path, preserve previous evidence")
            out = snapshot(args.server, args.ops, args.node)
            atomic(args.out, out)
            out = {"status": "saved", "path": str(args.out.resolve()), "sha256": digest(args.out.read_bytes()), "complete": out["complete"], "summary": snapshot_brief(out, ledger.read())}
        print(json.dumps(out, ensure_ascii=False))
    except (ValueError, OSError) as e:
        print(json.dumps({"status": "blocked" if isinstance(e, Conflict) else "invalid", "reason": str(e), "gameExecuted": False, "retryable": False,
                          "next_safe_read": "status" if isinstance(e, Conflict) else "schema"}, ensure_ascii=False))
        raise SystemExit(2)


if __name__ == "__main__":
    main()

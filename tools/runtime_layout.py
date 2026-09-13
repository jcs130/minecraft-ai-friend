"""Audit the game's Compose storage and back up stopped world/agent state.

Never print Compose environment variables or credential contents. Backups copy
only existing D-project state into a new D-project directory; no source moves.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import uuid

ROOT = Path(__file__).resolve().parents[1]
BACKUP_PATHS = ("mc/shadow", "mc/config", "mc/data", "mc/database.db", "mc/server.properties",
                "mc/usercache.json", "mc/ops.json", "mc/whitelist.json", "agents",
                "operations-agent-state", "survival-agent-state", "world-data", "mcdata",
                "team-state", "admin-state", "engineering/config.json", "engineering/requests",
                "engineering/receipts", "engineering/state")


def docker(*args):
    result = subprocess.run(["docker", *args], cwd=ROOT, capture_output=True, text=True,
                            encoding="utf8", errors="replace", timeout=60,
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if result.returncode:
        raise RuntimeError("Docker query failed; inspect Docker Desktop separately")
    return result.stdout


def compose():
    return json.loads(docker("compose", "--profile", "legacy-operations", "config", "--format", "json"))


def layout():
    config = compose()
    rows, failures = [], []
    for name, service in config["services"].items():
        mounts = []
        for volume in service.get("volumes", []):
            source = volume.get("source", "")
            if source == "/var/run/docker.sock" and volume["target"] == source:
                mounts.append({"source": source, "target": source, "kind": "docker-engine-interface"})
                continue
            path = Path(source)
            within = path.resolve().is_relative_to(ROOT.resolve())
            exists = path.exists()
            if volume.get("type") != "bind" or not within or not exists:
                failures.append({"service": name, "source": source, "exists": exists, "withinProject": within})
            mounts.append({"source": source, "target": volume["target"], "readOnly": volume.get("read_only", False),
                           "exists": exists, "withinProject": within})
        image = service["image"]
        try:
            identity = docker("image", "inspect", image, "--format", "{{.Id}}").strip()
        except RuntimeError:
            identity = None
        rows.append({"service": name, "profiles": service.get("profiles", []), "image": image,
                     "imageId": identity, "restart": service.get("restart"), "mounts": mounts})
    active = [row for row in rows if not row["profiles"]]
    return {"schema": 1, "projectRoot": str(ROOT), "checkedAt": datetime.now(timezone.utc).isoformat(),
            "allGameBindsWithinProject": not failures, "storageIssues": failures,
            "activeImagesReady": all(row["imageId"] for row in active), "services": rows,
            "scope": "Game bind data and source; Docker Desktop's image disk is separately managed."}


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def backup():
    running = [json.loads(line) for line in docker(
        "ps", "--filter", "label=com.docker.compose.project=qiandengji", "--format", "json").splitlines()]
    if any(row["Names"] != "qiandengji-tts-1" for row in running):
        raise ValueError("Stop the game state writers before taking this recovery backup")
    sources = []
    for relative in BACKUP_PATHS:
        source = ROOT / "server" / relative
        if source.is_file():
            sources.append(source)
        elif source.is_dir():
            sources.extend(path for path in source.rglob("*") if path.is_file())
    if not (ROOT / "server/mc/shadow/level.dat").is_file():
        raise ValueError("The original shadow world is missing")
    for path in sources:
        if not path.resolve().is_relative_to((ROOT / "server").resolve()):
            raise ValueError("Backup source escapes the project state directory")
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]
    destination = ROOT / "runtime/backups" / ("service-recovery-" + stamp)
    destination.mkdir(parents=True, exist_ok=False)
    records = []
    for path in sources:
        relative = path.relative_to(ROOT / "server")
        target = destination / "server" / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        expected = digest(path)
        shutil.copy2(path, target)
        if digest(target) != expected or digest(path) != expected:
            raise ValueError("State changed or copy verification failed: " + str(relative))
        records.append({"path": relative.as_posix(), "bytes": path.stat().st_size, "sha256": expected})
    report = {"schema": 1, "producer": "runtime_layout.py", "createdAt": datetime.now(timezone.utc).isoformat(),
              "backupRoot": str(destination), "sourceRoot": str(ROOT / "server"), "files": records,
              "fileCount": len(records), "bytes": sum(row["bytes"] for row in records), "allHashesVerified": True}
    (destination / "manifest.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf8")
    return {key: report[key] for key in ("backupRoot", "fileCount", "bytes", "allHashesVerified")}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backup", action="store_true", help="Copy stopped world and agent data to a new verified backup")
    args = parser.parse_args()
    result = backup() if args.backup else layout()
    if not args.backup:
        output = ROOT / "runtime/game-recovery-20260913/layout.json"
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf8")
        print(json.dumps({"allGameBindsWithinProject": result["allGameBindsWithinProject"],
                          "activeImagesReady": result["activeImagesReady"], "storageIssues": result["storageIssues"],
                          "report": str(output)}, ensure_ascii=False))
    else:
        print(json.dumps(result, ensure_ascii=False))

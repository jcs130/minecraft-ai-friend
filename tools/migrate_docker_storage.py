"""Move the audited Docker Desktop WSL disk through its own settings service.

Default invocation only reads state. Stop builds and game containers before
--migrate. The Desktop backend performs the move/restart; this tool never copies
a live VHDX, changes settings-store.json, or restarts WSL itself. The private GUI
contract is pinned to the installed source reviewed on 2026-09-13, not presented
as a stable public Docker API. Run --verify RECEIPT after the engine returns.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import http.client
import io
import json
import os
from pathlib import Path
import queue
import shutil
import struct
import subprocess
import sys
import threading
import uuid

ROOT = Path(__file__).resolve().parents[1]
TARGET = Path(r"D:\docker-data\DockerDesktopWSL")
SETTING = "vm.resources.wslDataFolder"
PROJECTS = {"qiandengji", "qiandengji-ops"}
SOURCE_HASHES = {
    "build/desktop-ui-build/assets/WslAdvancedSettingsScreen-DGMDfeFH.js":
        "92683adfd8223802db24ef60d6760d5a016faf3eb1a1e3fa81d412d9ff9276f8",
    "build/entry-main.main.js":
        "49622ff16d204211f578d82213de8fd1ec2bd02ae63f3d5bb47e59e6d6d4a257",
}


def stamp():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def run(*args):
    result = subprocess.run(args, cwd=ROOT, capture_output=True, text=True,
                            encoding="utf-8", errors="replace", timeout=60,
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if result.returncode:
        raise RuntimeError(f"Read command failed: {args[0]} {args[1]}")
    return result.stdout.strip()


def api(method, path, body=None, timeout=30):
    """One HTTP request, no retry, over the actual Desktop named pipe."""
    result = queue.Queue(maxsize=1)

    def request():
        try:
            class Pipe:
                def __init__(self):
                    self.f = open(r"\\.\pipe\dockerBackendApiServer", "r+b", buffering=0)

                def makefile(self, *args, **kwargs):
                    # Raw Windows pipe reads may be shorter than requested.
                    return io.BufferedReader(self.f)

            pipe = Pipe()
            payload = json.dumps(body).encode() if body is not None else b""
            header = (f"{method} {path} HTTP/1.1\r\nHost: ipc\r\n"
                      "Connection: close\r\nContent-Type: application/json\r\n"
                      f"Content-Length: {len(payload)}\r\n\r\n").encode()
            try:
                pipe.f.write(header + payload)
                response = http.client.HTTPResponse(pipe)
                response.begin()
                data = response.read()
                if response.status != 200:
                    raise RuntimeError(f"Desktop settings HTTP {response.status}")
                result.put((True, json.loads(data) if data else None))
            finally:
                pipe.f.close()
        except Exception as exc:
            result.put((False, exc))

    threading.Thread(target=request, daemon=True).start()
    try:
        ok, value = result.get(timeout=timeout)
    except queue.Empty:
        raise TimeoutError("Desktop request timed out; do not replay a migration POST") from None
    if not ok:
        raise value
    return value


def source_contract():
    asar = Path(os.environ["ProgramFiles"]) / "Docker/Docker/frontend/resources/app.asar"
    actual = {}
    with asar.open("rb") as stream:
        _, header_size, _, text_size = struct.unpack("<4I", stream.read(16))
        header = json.loads(stream.read(text_size))
        for path, expected in SOURCE_HASHES.items():
            entry = header
            for part in path.split("/"):
                entry = entry["files"][part]
            stream.seek(8 + header_size + int(entry["offset"]))
            actual[path] = hashlib.sha256(stream.read(entry["size"])).hexdigest()
            if actual[path] != expected:
                raise RuntimeError("Docker Desktop GUI changed; re-audit the migration API first")
    return actual


def containers():
    ids = run("docker", "ps", "-aq", "--no-trunc").splitlines()
    if not ids:
        return []
    data = json.loads(run("docker", "inspect", *ids))
    return canonical_records("containers", [{"id": x["Id"], "name": x["Name"], "image": x["Image"],
             "project": (x["Config"].get("Labels") or {}).get("com.docker.compose.project"),
             "state": x["State"]["Status"], "mounts": x["Mounts"]} for x in data])


def canonical_records(kind, records):
    """Docker builds Mounts from a map; order is not part of mount identity."""
    result = []
    for record in records:
        row = dict(record)
        if kind == "containers":
            row["mounts"] = sorted(row["mounts"], key=lambda x: json.dumps(x, sort_keys=True))
        elif kind == "images":
            row["tags"] = sorted(row["tags"])
        result.append(row)
    return sorted(result, key=lambda x: x["id"])


def inventory_diff(before, after):
    differences = {}
    for kind in ("images", "containers"):
        old = {x["id"]: x for x in canonical_records(kind, before[kind])}
        new = {x["id"]: x for x in canonical_records(kind, after[kind])}
        delta = {}
        for label, ids in (("addedIds", new.keys() - old.keys()), ("removedIds", old.keys() - new.keys())):
            if ids:
                delta[label] = sorted(ids)
        changed = {}
        for ident in sorted(old.keys() & new.keys()):
            fields = {key: {"before": old[ident].get(key), "after": new[ident].get(key)}
                      for key in sorted(old[ident].keys() | new[ident].keys())
                      if old[ident].get(key) != new[ident].get(key)}
            if fields:
                changed[ident] = fields
        if changed:
            delta["changedFields"] = changed
        if delta:
            differences[kind] = delta
    return differences


def container_errors(items):
    errors = []
    for item in items:
        if item["project"] not in PROJECTS:
            errors.append(f"Unrelated container present: {item['name']}")
        if item["state"] not in {"created", "exited"}:
            errors.append(f"Container must be stopped: {item['name']} ({item['state']})")
    return errors


def images():
    ids = sorted(set(run("docker", "image", "ls", "-aq", "--no-trunc").splitlines()))
    if not ids:
        return []
    data = json.loads(run("docker", "image", "inspect", *ids))
    return canonical_records("images", [{"id": x["Id"], "tags": x.get("RepoTags") or []} for x in data])


def build_errors():
    # The audited local builders share one engine. Reject unknown builders rather
    # than silently missing a concurrent remote/container driver build.
    builders = [json.loads(line) for line in run("docker", "buildx", "ls", "--format", "json").splitlines()]
    errors = []
    for builder in builders:
        if builder["Driver"] != "docker" or builder["Name"] not in {"default", "desktop-linux"}:
            errors.append(f"Unreviewed build engine: {builder['Name']}")
            continue
        history = run("docker", "--context", builder["Name"], "buildx", "history", "ls", "--format", "json")
        for line in history.splitlines():
            row = json.loads(line)
            if row.get("status", "").lower() not in {"completed", "error", "canceled", "cancelled"}:
                errors.append(f"Build is active or unknown: {row.get('ref')}")
    ps = ("@(Get-CimInstance Win32_Process | Where-Object { "
          "$_.Name -in @('docker.exe','docker-buildx.exe') -and "
          "$_.CommandLine -match '\\bbuild\\b' } | Select-Object ProcessId,Name) | ConvertTo-Json -Compress")
    native = json.loads(run("powershell.exe", "-NoProfile", "-Command", ps) or "[]")
    if native:
        errors.append("A native Docker build process is still running")
    return errors


def preflight():
    if os.name != "nt":
        raise RuntimeError("This helper is for this Windows Docker Desktop installation")
    contract = source_contract()
    current = api("GET", "/app/settings/gui")["settings"][SETTING]
    delta = {"settings": {SETTING: str(TARGET)}}
    disk = Path(current) / "disk/docker_data.vhdx"
    state = {"observedAt": stamp(), "source": current, "target": str(TARGET),
             "dataDiskBytes": disk.stat().st_size, "sourceContract": contract,
             "containers": containers(), "images": images(), "errors": []}
    if TARGET.exists():
        state["errors"].append("Target already exists; do not overwrite or merge a Docker disk")
    if str(TARGET.resolve()).lower() != str(TARGET).lower():
        state["errors"].append("Target resolves through a junction or another location")
    if shutil.disk_usage(TARGET.parent).free < disk.stat().st_size + 5 * 1024**3:
        state["errors"].append("Target has insufficient free space for disk plus 5 GiB headroom")
    state["errors"] += container_errors(state["containers"]) + build_errors()
    state["requiresEngineRestart"] = api("GET", "/app/settings/gui/do_changes_need_restart", delta)
    state["readyToMigrate"] = not state["errors"]
    return state


def save(path, report):
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temp, path)


def verify(path):
    path = path.resolve()
    path.relative_to(ROOT / "runtime")
    report = json.loads(path.read_text(encoding="utf-8"))
    current = api("GET", "/app/settings/gui")["settings"][SETTING]
    current_images = images()
    current_containers = containers()
    missing = sorted({x["id"] for x in report["before"]["images"]} - {x["id"] for x in current_images})
    current_tags = {tag: x["id"] for x in current_images for tag in x["tags"]}
    missing_tags = sorted(tag for x in report["before"]["images"] for tag in x["tags"]
                          if current_tags.get(tag) != x["id"])
    before_by_id = {x["id"]: x for x in canonical_records("containers", report["before"]["containers"])}
    after_by_id = {x["id"]: x for x in canonical_records("containers", current_containers)}
    changed = [ident for ident, old in before_by_id.items()
               if ident not in after_by_id or old["mounts"] != after_by_id[ident]["mounts"]
               or old["image"] != after_by_id[ident]["image"]]
    disk = Path(current) / "disk/docker_data.vhdx"
    result = {"observedAt": stamp(), "actualWslDataFolder": current,
              "dataDiskExists": disk.exists(), "dataDiskBytes": disk.stat().st_size if disk.exists() else 0,
              "missingImageIds": missing, "missingOrChangedImageTags": missing_tags,
              "changedContainerIds": changed}
    result["ok"] = (str(Path(current)).lower() == str(TARGET).lower() and disk.exists()
                    and not missing and not missing_tags and not changed)
    report["verification"] = result
    save(path, report)
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result["ok"] else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--migrate", action="store_true")
    group.add_argument("--verify", type=Path, metavar="RECEIPT")
    args = parser.parse_args()
    if args.verify:
        return verify(args.verify)
    state = preflight()
    if not args.migrate:
        print(json.dumps(state, ensure_ascii=False, indent=2))
        return 0 if state["readyToMigrate"] else 1
    if state["errors"]:
        print(json.dumps({"migrated": False, "errors": state["errors"]}, ensure_ascii=False))
        return 1
    work = ROOT / "runtime" / ("docker-migration-" + dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8])
    work.mkdir(parents=True)
    settings_path = Path(os.environ["APPDATA"]) / "Docker/settings-store.json"
    shutil.copy2(settings_path, work / "settings-store.before.json")
    receipt = work / "receipt.json"
    report = {"schema": 1, "before": state, "createdAt": stamp(), "dispatchState": "prepared"}
    save(receipt, report)
    # Recheck immediately before sending. Other operators must not start builds
    # during the maintenance window; the Desktop GUI has the same boundary.
    final = preflight()
    diff = inventory_diff(state, final)
    if final["errors"]:
        diff["preflightErrors"] = final["errors"]
    if final["source"] != state["source"]:
        diff["source"] = {"before": state["source"], "after": final["source"]}
    report["preSubmitDiff"] = diff
    report["preSubmitObservedAt"] = final["observedAt"]
    if diff:
        report["dispatchState"] = "not_submitted_state_changed"
        save(receipt, report)
        print(json.dumps({"message": "State changed before migration", "receipt": str(receipt),
                          "preSubmitDiff": diff}, ensure_ascii=False))
        return 1
    report["dispatchState"] = "submitted_pending_verification"
    report["submittedAt"] = stamp()
    save(receipt, report)
    print(f"Submitting one Desktop-managed migration. Receipt: {receipt}", flush=True)
    try:
        answer = api("POST", "/app/settings/gui", {"settings": {SETTING: str(TARGET)}}, timeout=900)
        report["response"] = {"sseSequenceID": answer.get("sseSequenceID") if isinstance(answer, dict) else None}
    except Exception as exc:
        # A disconnect is not proof of failure. Never replay this POST.
        report["responseUnknown"] = type(exc).__name__
    save(receipt, report)
    print(f"Desktop manages the move and engine restart. Do not submit again; verify with --verify \"{receipt}\".", flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"Storage migration stopped: {type(exc).__name__}: {exc}", file=sys.stderr)
        raise SystemExit(1)

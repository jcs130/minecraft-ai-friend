"""Stage audited local IndexTTS source and optionally build a new named image.

No model download, runtime-data rewrite, container start, or old image-ID alias.
The generated context and build receipts stay below the project's runtime/.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
from urllib.parse import urlsplit
import uuid

PROJECT = Path(__file__).resolve().parents[1]
SOURCE = Path("C:/Users/lzl19/.copaw/workspaces/default/minecraft-ai-friend/ops/docker/shadow/gpu-tts/repo")
IMAGE = "qiandengji-tts:2.5-qd1"
BASE_IMAGE = "python:3.11-slim-bookworm@sha256:528257d48c1da0dcecc2e725d1ae34498d60c965f1241e39cd6a85a8859bdf84"
INFER_SHA256 = "9049c151924cb003968df12957816dff31fc0cb983adf2e364219ef941930093"
ROOT_FILES = ("pyproject.toml", "README.md", "LICENSE", "LICENSE_ZH.txt", "DISCLAIMER", "MANIFEST.in", "uv.lock")
REQUIRED_FILES = ("pyproject.toml", "README.md", "LICENSE", "indextts/infer_v2_5.py", "checkpoints/pinyin.vocab")
EXCLUDE_DIRS = frozenset((".git", ".venv", "venv", "__pycache__", ".pytest_cache", ".cache", "node_modules", "checkpoints", "hf_cache"))
EXCLUDE_SUFFIXES = frozenset((".pyc", ".pyo", ".pth", ".pt", ".safetensors", ".ckpt", ".bin", ".t7", ".wav", ".mp3", ".ogg", ".log"))
MAX_FILE_BYTES = 16 * 1024 * 1024


def linked(path: Path) -> bool:
    info = path.lstat()
    return path.is_symlink() or bool(getattr(info, "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT)


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def selected_source_files(source: Path) -> list[Path]:
    """Select package source and small shipped resources; never traverse weights."""
    source = source.resolve(strict=True)
    selected = []
    package = source / "indextts"
    if not package.is_dir() or linked(package):
        raise ValueError("Missing or linked IndexTTS package")
    for current, directories, files in os.walk(package, followlinks=False):
        directories[:] = sorted(name for name in directories if name not in EXCLUDE_DIRS and not name.startswith("."))
        for name in directories:
            if linked(Path(current) / name):
                raise ValueError("Linked package directory is not build source")
        for name in sorted(files):
            path = Path(current) / name
            if name.startswith(".") or path.suffix.lower() in EXCLUDE_SUFFIXES:
                continue
            selected.append(path)
    selected.extend(source / name for name in ROOT_FILES if (source / name).is_file())
    # This vocabulary is a source resource, distinct from the model mount.
    selected.append(source / "checkpoints/pinyin.vocab")
    for path in selected:
        if not path.is_file() or linked(path) or not path.resolve().is_relative_to(source):
            raise ValueError("Missing, linked or escaping build source")
        if path.stat().st_size > MAX_FILE_BYTES:
            raise ValueError("Unexpected large resource in source package: " + path.relative_to(source).as_posix())
    names = {path.relative_to(source).as_posix() for path in selected}
    if not set(REQUIRED_FILES) <= names:
        raise ValueError("Required IndexTTS source resources are missing")
    if digest(source / "indextts/infer_v2_5.py") != INFER_SHA256:
        raise ValueError("IndexTTS inference source differs from the audited revision")
    return sorted(selected)


def copy_source(source: Path, destination: Path) -> dict:
    before = source.stat()
    source_hash = digest(source)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with source.open("rb") as original, destination.open("xb") as target:
        shutil.copyfileobj(original, target)
    after = source.stat()
    if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns) or digest(destination) != source_hash:
        raise ValueError("Source changed while staging")
    return {"bytes": before.st_size, "sha256": source_hash}


def stage(source: Path = SOURCE, *, project: Path = PROJECT) -> tuple[Path, dict]:
    source = source.resolve(strict=True)
    files = selected_source_files(source)
    project = project.resolve(strict=True)
    runtime = project / "runtime"
    if runtime.exists() and linked(runtime):
        raise ValueError("Runtime build directory must not be linked")
    runtime.mkdir(exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    context = runtime / ("tts-build-" + stamp + "-" + uuid.uuid4().hex[:8])
    context.mkdir()
    records = []
    for path in files:
        relative = path.relative_to(source).as_posix()
        records.append({"path": relative, **copy_source(path, context / "source" / relative)})
    api = copy_source(project / "world/tts/tts_api.py", context / "tts_api.py")
    dockerfile = copy_source(project / "world/tts/Dockerfile", context / "Dockerfile")
    canonical = json.dumps(records, sort_keys=True, separators=(",", ":")).encode("utf-8")
    manifest = {
        "schema": 1, "createdAt": datetime.now(timezone.utc).isoformat(),
        "sourceRoot": str(source), "sourceInferenceSha256": INFER_SHA256,
        "sourceTreeSha256": hashlib.sha256(canonical).hexdigest(),
        "sourceFileCount": len(records), "sourceBytes": sum(row["bytes"] for row in records),
        "files": records, "api": api, "dockerfile": dockerfile,
        "weightsIncluded": False, "voicesIncluded": False,
        "runtimeData": "Existing server/tts-state checkpoints and voices are mounted only when separately starting the service.",
    }
    (context / "source-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return context, manifest


def validate_build_options(image: str, base_image: str, index_url: str) -> None:
    if not re.fullmatch(r"qiandengji-tts:[A-Za-z0-9_.-]{1,100}", image):
        raise ValueError("Use a named qiandengji-tts image tag; never alias the vanished historical image ID")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_./:@-]{0,255}", base_image):
        raise ValueError("Invalid base image reference")
    parsed = urlsplit(index_url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("Package index must be a credential-free HTTPS URL")


def build(context: Path, *, image: str = IMAGE, base_image: str = BASE_IMAGE,
          index_url: str = "https://pypi.org/simple", runner=subprocess.run) -> dict:
    validate_build_options(image, base_image, index_url)
    record = {"schema": 1, "startedAt": datetime.now(timezone.utc).isoformat(), "imageTag": image,
              "baseImage": base_image, "packageIndex": index_url, "status": "building", "serviceStarted": False}
    receipt = context / "build-result.json"
    command = ["docker", "build", "--progress=plain", "--tag", image,
               "--build-arg", "BASE_IMAGE=" + base_image, "--build-arg", "PIP_INDEX_URL=" + index_url, str(context)]
    receipt.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    try:
        runner(command, check=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        inspected = runner(["docker", "image", "inspect", image, "--format", "{{json .}}"],
                           check=True, capture_output=True, text=True, timeout=30,
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        actual = json.loads(inspected.stdout)
        image_id = actual.get("Id", "")
        if not re.fullmatch(r"sha256:[0-9a-f]{64}", image_id):
            raise ValueError("Docker did not report the built image identity")
        record.update(status="built_not_started", imageId=image_id, imageBytes=actual.get("Size"), imageCreatedAt=actual.get("Created"))
    except Exception as exc:
        record.update(status="build_failed", errorType=type(exc).__name__)
        raise
    finally:
        record["finishedAt"] = datetime.now(timezone.utc).isoformat()
        receipt.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    return record


def publish_runtime_image(context: Path, *, project: Path = PROJECT, runner=subprocess.run) -> Path:
    """Publish a receipt for this actual image, without rewriting old ownership."""
    project = project.resolve(strict=True)
    context = context.resolve(strict=True)
    if not context.is_relative_to(project / "runtime"):
        raise ValueError("Build evidence must belong to this project's runtime directory")
    source = json.loads((context / "source-manifest.json").read_text(encoding="utf-8"))
    result = json.loads((context / "build-result.json").read_text(encoding="utf-8"))
    if result.get("status") != "built_not_started" or source.get("sourceInferenceSha256") != INFER_SHA256:
        raise ValueError("Only a successful audited build can be published")
    validate_build_options(result["imageTag"], result["baseImage"], result["packageIndex"])
    inspected = runner(["docker", "image", "inspect", result["imageTag"], "--format", "{{.Id}}"],
                       check=True, capture_output=True, text=True, timeout=30,
                       creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if inspected.stdout.strip() != result.get("imageId"):
        raise ValueError("Image tag no longer identifies the recorded build")
    if digest(context / "tts_api.py") != source["api"]["sha256"]:
        raise ValueError("Staged API differs from its build evidence")
    destination = project / "server/tts-state/runtime-image.json"
    for path in (project / "server", destination.parent, destination):
        if path.exists() and linked(path):
            raise ValueError("Runtime image evidence must not use linked paths")
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        previous = json.loads(destination.read_text(encoding="utf-8"))
        if previous.get("producer") != "build_tts_runtime.py":
            raise ValueError("Existing image evidence has a different owner")
        copy_source(destination, context / ("previous-runtime-image-" + uuid.uuid4().hex[:8] + ".json"))
    record = {
        "schema": 1, "producer": "build_tts_runtime.py", "createdAt": datetime.now(timezone.utc).isoformat(),
        "image": {"id": result["imageId"], "tag": result["imageTag"]},
        "adapterSha256": source["api"]["sha256"], "inferSha256": source["sourceInferenceSha256"],
        "sourceRecords": source["files"], "sourceTreeSha256": source["sourceTreeSha256"],
        "baseImage": result["baseImage"], "buildReceipt": str(context / "build-result.json"),
        "sourceManifest": str(context / "source-manifest.json"), "serviceStarted": False,
    }
    temporary = destination.with_name(destination.name + ".tmp-" + uuid.uuid4().hex[:8])
    with temporary.open("x", encoding="utf-8") as stream:
        stream.write(json.dumps(record, ensure_ascii=False, indent=2) + "\n")
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(destination)
    return destination


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=SOURCE)
    parser.add_argument("--build", action="store_true", help="Build the staged source; never starts a service")
    parser.add_argument("--publish-context", type=Path, help="Publish an already completed build receipt without rebuilding")
    parser.add_argument("--image", default=IMAGE)
    parser.add_argument("--base-image", default=BASE_IMAGE)
    parser.add_argument("--index-url", default="https://pypi.org/simple")
    args = parser.parse_args()
    validate_build_options(args.image, args.base_image, args.index_url)
    if args.publish_context:
        if args.build:
            parser.error("--build and --publish-context are mutually exclusive")
        print(json.dumps({"runtimeImage": str(publish_runtime_image(args.publish_context))}), flush=True)
        return 0
    context, manifest = stage(args.source)
    print(json.dumps({"context": str(context), "sourceFiles": manifest["sourceFileCount"],
                      "sourceBytes": manifest["sourceBytes"], "weightsIncluded": False}, ensure_ascii=False), flush=True)
    if args.build:
        print(json.dumps(build(context, image=args.image, base_image=args.base_image, index_url=args.index_url)), flush=True)
        print(json.dumps({"runtimeImage": str(publish_runtime_image(context))}), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

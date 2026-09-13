"""Stage the existing C-drive Kokoro model as verified, ordinary D-drive files.

This preparer never starts a service, installs host packages, or changes the
IndexTTS runtime. The four allowed assets are pinned to the audited HF revision.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import uuid


PROJECT = Path(__file__).resolve().parents[1]
REVISION = "01e7505bd6a7a2ac4975463114c3a7650a9f7218"
REPO_ID = "hexgrad/Kokoro-82M-v1.1-zh"
SOURCE = Path("C:/xiaozhi/hf_cache_kokoro/hub/models--hexgrad--Kokoro-82M-v1.1-zh/snapshots") / REVISION
TARGET = PROJECT / "server/kokoro-state"
BASE_IMAGE = "qiandengji-tts:2.5-qd1"
BASE_IMAGE_ID = "sha256:2419c6efd2c3f0802cfa6cd39f1ad2073cc6b488f4c3c5c131bf9531869ed677"
IMAGE = "qiandengji-tts:kokoro-1.1-qd1"
ASSETS = {
    "config.json": (3228, "bc333efa5ce4ceff433c8c8e5d027a1eca0166001e4e4a62bea2d26ff7a46890"),
    "kokoro-v1_1-zh.pth": (327247856, "b1d8410fa44dfb5c15471fd6c4225ea6b4e9ac7fa03c98e8bea47a9928476e2b"),
    "voices/zf_001.pt": (523331, "9bdc9a87e13e9bb1ea3e7803259c2ecbfebaeeb2ff80b5d0c76df1a464c1c962"),
    "voices/zm_010.pt": (523331, "d2eeba86192eee269f600ca6821038034abd017532a1fe68ff7b0e86c2983b2a"),
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def verify(path: Path, expected: tuple[int, str]) -> None:
    if not path.is_file() or path.stat().st_size != expected[0] or sha256(path) != expected[1]:
        raise ValueError("Kokoro asset differs from the pinned revision: " + path.name)


def ordinary_destination(root: Path, relative: str) -> Path:
    destination = root / relative
    if not destination.resolve().is_relative_to(root.resolve()):
        raise ValueError("Kokoro destination escapes its data root")
    for path in (destination, *destination.parents):
        if path.is_symlink() or (hasattr(path, "is_junction") and path.is_junction()):
            raise ValueError("Kokoro destination must not use linked paths")
    return destination


def stage(source: Path = SOURCE, target: Path = TARGET) -> dict:
    source = Path(source)
    target = Path(target)
    manifest_path = ordinary_destination(target, "source-manifest.json")
    if manifest_path.exists():
        previous = json.loads(manifest_path.read_text(encoding="utf-8"))
        if previous.get("producer") != "prepare_kokoro_runtime.py" or previous.get("revision") != REVISION:
            raise ValueError("Existing Kokoro manifest has a different owner or revision")

    # Validate every pinned source and existing destination before copying.
    records = []
    for relative, expected in ASSETS.items():
        original = source / relative
        verify(original, expected)  # follows audited HF symlinks to their bytes
        destination = ordinary_destination(target, "model/" + relative)
        if destination.exists():
            verify(destination, expected)
        records.append({"path": "model/" + relative, "bytes": expected[0], "sha256": expected[1],
                        "source": str(original), "resolvedSource": str(original.resolve(strict=True))})

    for record in records:
        destination = ordinary_destination(target, record["path"])
        if destination.exists():
            continue
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_name(destination.name + ".stage-" + uuid.uuid4().hex)
        try:
            with Path(record["source"]).open("rb") as original, temporary.open("xb") as output:
                shutil.copyfileobj(original, output, 4 * 1024 * 1024)
                output.flush()
                os.fsync(output.fileno())
            verify(temporary, (record["bytes"], record["sha256"]))
            if destination.exists():
                raise ValueError("Kokoro destination appeared while staging")
            # Windows rename refuses to replace an existing destination.
            temporary.rename(destination)
        finally:
            if temporary.exists():
                temporary.unlink()

    manifest = {
        "schema": 1, "producer": "prepare_kokoro_runtime.py", "repoId": REPO_ID,
        "revision": REVISION, "sourceRoot": str(source),
        "preparedAt": datetime.now(timezone.utc).isoformat(),
        "status": "assets_copied_and_verified_service_not_started", "files": records,
        "fileCount": len(records), "bytes": sum(row["bytes"] for row in records),
        "symlinksDereferenced": True, "inferenceTested": False, "switched": False,
    }
    if manifest_path.exists():
        # Preserve the original staging time and any separate deployment notes.
        if previous.get("files") != records:
            raise ValueError("Existing Kokoro source records differ; review before replacing")
        return previous
    with manifest_path.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(manifest, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    return manifest


def verify_base_image(runner=subprocess.run) -> str:
    result = runner(["docker", "image", "inspect", BASE_IMAGE, "--format", "{{.Id}}"],
                    capture_output=True, text=True, check=True, timeout=30,
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if result.stdout.strip() != BASE_IMAGE_ID:
        raise ValueError("Kokoro base tag differs from the audited local IndexTTS image")
    return BASE_IMAGE_ID


def record_image(image: str = IMAGE, *, project: Path = PROJECT, runner=subprocess.run) -> dict:
    """Verify built COPY files in a disposable container and record the image.

    No GPU, model mounts, ports or production service are used by this check.
    """
    import re
    if not re.fullmatch(r"qiandengji-tts:kokoro-[A-Za-z0-9_.-]+", image):
        raise ValueError("Use an explicit Kokoro image tag")
    verify_base_image(runner)
    target = project / "server/kokoro-state"
    source_manifest = ordinary_destination(target, "source-manifest.json")
    manifest = json.loads(source_manifest.read_text(encoding="utf-8"))
    if manifest.get("producer") != "prepare_kokoro_runtime.py" or manifest.get("revision") != REVISION:
        raise ValueError("Kokoro asset manifest is not the pinned staging record")
    for relative, expected in ASSETS.items():
        verify(ordinary_destination(target, "model/" + relative), expected)
    source_hashes = {name: sha256(project / "world/tts" / name) for name in ("tts_api.py", "kokoro_engine.py")}
    inspected = runner(["docker", "image", "inspect", image, "--format", "{{.Id}}"],
                       capture_output=True, text=True, check=True, timeout=30,
                       creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    image_id = inspected.stdout.strip()
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", image_id):
        raise ValueError("Built Kokoro image identity is unavailable")
    check = "import hashlib,json,pathlib; print(json.dumps({n:hashlib.sha256((pathlib.Path('/app')/n).read_bytes()).hexdigest() for n in ['tts_api.py','kokoro_engine.py']}))"
    checked = runner(["docker", "run", "--rm", "--network", "none", "--entrypoint", "python3", image_id, "-c", check],
                     capture_output=True, text=True, check=True, timeout=30,
                     creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if json.loads(checked.stdout) != source_hashes:
        raise ValueError("Built Kokoro adapter does not match current project source")
    record = {"schema": 1, "producer": "prepare_kokoro_runtime.py",
              "createdAt": datetime.now(timezone.utc).isoformat(), "image": {"id": image_id, "tag": image},
              "baseImage": {"id": BASE_IMAGE_ID, "tag": BASE_IMAGE},
              "adapterSha256": source_hashes["tts_api.py"], "engineSha256": source_hashes["kokoro_engine.py"],
              "assetsManifestSha256": sha256(source_manifest), "serviceStarted": False}
    destination = ordinary_destination(target, "runtime-image.json")
    if destination.exists():
        previous = json.loads(destination.read_text(encoding="utf-8"))
        if previous.get("producer") != "prepare_kokoro_runtime.py":
            raise ValueError("Existing Kokoro image record has a different owner")
    temporary = destination.with_name(destination.name + ".stage-" + uuid.uuid4().hex)
    try:
        temporary.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temporary.replace(destination)
    finally:
        if temporary.exists():
            temporary.unlink()
    return record


def build(image: str = IMAGE, index_url: str = "https://pypi.org/simple", *, project: Path = PROJECT,
          runner=subprocess.run) -> dict:
    """Build using the verified local CUDA base, then verify actual COPY bytes."""
    import re
    from urllib.parse import urlsplit
    if not re.fullmatch(r"qiandengji-tts:kokoro-[A-Za-z0-9_.-]+", image):
        raise ValueError("Use an explicit Kokoro image tag")
    parsed = urlsplit(index_url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("Package index must be a credential-free HTTPS URL")
    verify_base_image(runner)
    command = ["docker", "build", "--pull=false", "--progress=plain", "--build-arg", "PIP_INDEX_URL=" + index_url,
               "-f", "world/tts/Dockerfile.kokoro", "-t", image, "world/tts"]
    runner(command, cwd=project, check=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    return record_image(image, project=project, runner=runner)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=SOURCE, help="Existing HF snapshot; hashes remain pinned")
    parser.add_argument("--verify-base", action="store_true", help="Verify the local Docker base before building")
    parser.add_argument("--record-image", action="store_true", help="Verify and record the separately built Kokoro image")
    parser.add_argument("--build", action="store_true", help="Stage assets, build the image and record it; does not start TTS")
    parser.add_argument("--image", default=IMAGE)
    parser.add_argument("--index-url", default="https://pypi.org/simple")
    args = parser.parse_args()
    if sum((args.verify_base, args.record_image, args.build)) > 1:
        parser.error("Choose only one of --verify-base, --record-image and --build")
    if args.verify_base:
        print(json.dumps({"baseImage": verify_base_image(), "serviceStarted": False}))
        return 0
    if args.record_image:
        print(json.dumps(record_image(args.image), ensure_ascii=False))
        return 0
    result = stage(args.source)
    print(json.dumps({key: result[key] for key in ("status", "revision", "fileCount", "bytes", "switched")}, ensure_ascii=False))
    if args.build:
        print(json.dumps(build(args.image, args.index_url), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

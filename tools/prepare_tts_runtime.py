"""Prepare an independent D-owned TTS data tree; never starts/stops services.

Copies only the audited API, model tree and WAV references. No old generated
speech, logs, credentials, Python environment or container writable layer.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import subprocess
import tempfile
import uuid


PROJECT = Path(__file__).resolve().parents[1]
TARGET = PROJECT / "server/tts-state"
SOURCE = Path("C:/Users/lzl19/.copaw/workspaces/default/minecraft-ai-friend/ops/docker/shadow")
IMAGE_ID = "sha256:9da38721708a19a1c0528b5224a2d9e464453bd56f46f51e9c595dd27e0f56bb"
INFER_SHA256 = "9049c151924cb003968df12957816dff31fc0cb983adf2e364219ef941930093"
REQUIRED_MODELS = {
    "config.yaml", "gpt.pth", "codec.pth", "s2mel.pth", "feat1.pt", "feat2.pt",
    "wav2vec2bert_stats.pt", "multilingual_zh_ja_yue_char_del.tiktoken",
    "hf_cache/campplus_cn_common.bin", "hf_cache/bigvgan/config.json",
    "hf_cache/bigvgan/bigvgan_generator.pt", "hf_cache/w2v-bert-2.0/config.json",
    "hf_cache/w2v-bert-2.0/model.safetensors", "hf_cache/w2v-bert-2.0/preprocessor_config.json",
    "qwen0.6bemo4-merge/config.json", "qwen0.6bemo4-merge/model.safetensors",
    "qwen0.6bemo4-merge/tokenizer.json", "qwen0.6bemo4-merge/tokenizer_config.json",
}


def linked(path: Path) -> bool:
    info = path.lstat()
    return path.is_symlink() or bool(getattr(info, "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT)


def safe_target(root: Path, relative: str) -> Path:
    rel = PurePosixPath(relative)
    if rel.is_absolute() or not rel.parts or any(p in ("", ".", "..") or ":" in p or "\\" in p for p in rel.parts):
        raise ValueError("Unsafe target path")
    target = root.joinpath(*rel.parts)
    if not target.resolve().is_relative_to(root.resolve()):
        raise ValueError("Target escapes TTS data root")
    if root.exists() and linked(root):
        raise ValueError("Linked TTS data root is not permitted")
    cursor = target
    while cursor != root:
        if cursor.exists() and linked(cursor):
            raise ValueError("Linked target is not permitted")
        cursor = cursor.parent
    return target


def files_in(root: Path) -> list[Path]:
    if not root.is_dir() or linked(root):
        raise ValueError(f"Missing or linked source directory: {root.name}")
    result = []
    for current, directories, files in os.walk(root, followlinks=False):
        for name in directories + files:
            path = Path(current) / name
            if linked(path):
                raise ValueError("Linked source assets are not permitted")
        result.extend(Path(current) / name for name in files)
    return sorted(result)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(4 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def copy_verified(source: Path, root: Path, relative: str) -> dict:
    target = safe_target(root, relative)
    before = source.stat()
    expected = sha256(source)
    if target.exists():
        if not target.is_file() or target.stat().st_size != before.st_size or sha256(target) != expected:
            raise ValueError(f"Refusing to overwrite a different existing asset: {relative}")
    else:
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_name(target.name + ".stage-" + uuid.uuid4().hex)
        try:
            with source.open("rb") as src, temporary.open("xb") as dst:
                shutil.copyfileobj(src, dst, 4 * 1024 * 1024)
                dst.flush()
                os.fsync(dst.fileno())
            if temporary.stat().st_size != before.st_size or sha256(temporary) != expected:
                raise ValueError(f"Copy verification failed: {relative}")
            # Windows rename does not replace an existing target. Do not clobber
            # files another preparer may have created while this copy ran.
            if target.exists():
                raise ValueError(f"Target appeared during preparation: {relative}")
            temporary.rename(target)
        finally:
            if temporary.exists():
                temporary.unlink()  # one exact, freshly created temporary file
    after = source.stat()
    if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
        raise ValueError(f"Source changed during preparation: {relative}")
    return {"path": relative, "bytes": before.st_size, "sha256": expected,
            "source": str(source), "verified": True}


def compose_service() -> dict:
    probe = "import json,urllib.request; assert json.load(urllib.request.urlopen('http://127.0.0.1:8100/health',timeout=5)).get('ok') is True"
    return {"services": {"tts": {
        "image": IMAGE_ID, "pull_policy": "never", "restart": "unless-stopped",
        "working_dir": "/app", "entrypoint": ["python3", "-u", "/app/tts_api.py"],
        "ports": ["127.0.0.1:8100:8100"],
        "environment": {"TZ": "Asia/Shanghai", "TTS_CKPT": "/checkpoints", "TTS_VOICES": "/voices",
                        "TTS_DEFAULT_VOICE": "goddess", "TTS_HOST": "0.0.0.0", "TTS_PORT": "8100",
                        "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1"},
        "volumes": [
            {"type": "bind", "source": str(TARGET / "app/tts_api.py"), "target": "/app/tts_api.py", "read_only": True, "bind": {"create_host_path": False}},
            {"type": "bind", "source": str(TARGET / "checkpoints"), "target": "/checkpoints", "read_only": True, "bind": {"create_host_path": False}},
            {"type": "bind", "source": str(TARGET / "voices"), "target": "/voices", "read_only": True, "bind": {"create_host_path": False}},
            {"type": "bind", "source": str(TARGET / "tmp"), "target": "/tmp", "bind": {"create_host_path": False}},
        ],
        "deploy": {"resources": {"reservations": {"devices": [{"driver": "nvidia", "count": "all", "capabilities": ["gpu"]}]}}},
        "healthcheck": {"test": ["CMD", "python3", "-c", probe], "interval": "30s", "timeout": "8s", "start_period": "180s", "retries": 10},
    }}}


def write_owned_json(relative: str, value: dict) -> None:
    target = safe_target(TARGET, relative)
    if target.exists():
        previous = json.loads(target.read_text(encoding="utf-8"))
        if relative == "source-manifest.json" and previous.get("producer") != "prepare_tts_runtime.py":
            raise ValueError("Existing manifest is not owned by this preparer")
        if relative == "compose.service.json" and previous != value:
            raise ValueError("Existing Compose suggestion differs; review it without overwriting")
    temporary = target.with_name(target.name + ".stage-" + uuid.uuid4().hex)
    try:
        with temporary.open("x", encoding="utf-8", newline="\n") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        os.replace(temporary, target)
    finally:
        if temporary.exists():
            temporary.unlink()


def prepare() -> dict:
    if not TARGET.resolve().is_relative_to(PROJECT.resolve()) or PROJECT.drive.upper() != "D:":
        raise ValueError("Preparation is restricted to this D project")
    for ancestor in (PROJECT, PROJECT / "server"):
        if ancestor.exists() and linked(ancestor):
            raise ValueError("Project data ancestors must not be linked")
    inspected = subprocess.run(["docker", "image", "inspect", IMAGE_ID, "--format", "{{.Id}}"],
        capture_output=True, text=True, timeout=20, check=True,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if inspected.stdout.strip() != IMAGE_ID:
        raise ValueError("Audited immutable TTS image is not available locally")
    model_root, voice_root = SOURCE / "tts/checkpoints", SOURCE / "tts/voices"
    models, voices = files_in(model_root), files_in(voice_root)
    names = {p.relative_to(model_root).as_posix() for p in models}
    if not REQUIRED_MODELS <= names:
        raise ValueError("Required local model dependencies are missing")
    if any(p.suffix.lower() != ".wav" or p.parent != voice_root for p in voices):
        raise ValueError("Voice tree contains unexpected non-WAV assets")
    if not {"goddess.wav", "touhou_little_maid.wav"} <= {p.name for p in voices}:
        raise ValueError("Required goddess/maid reference voices are missing")
    api = SOURCE / "gpu-tts/tts_api.py"
    if not api.is_file() or linked(api):
        raise ValueError("Audited API source is missing or linked")
    compile(api.read_text(encoding="utf-8-sig"), str(api), "exec")  # parse only; never import/infer
    assets = [(api, "app/tts_api.py")]
    assets += [(p, "checkpoints/" + p.relative_to(model_root).as_posix()) for p in models]
    assets += [(p, "voices/" + p.name) for p in voices]
    missing_bytes = sum(p.stat().st_size for p, rel in assets if not safe_target(TARGET, rel).exists())
    free = shutil.disk_usage(PROJECT).free
    if free < missing_bytes + 64 * 1024 * 1024:
        raise ValueError("Insufficient D disk space for verified staging")
    TARGET.mkdir(parents=True, exist_ok=True)
    records = []
    for source, relative in assets:
        records.append(copy_verified(source, TARGET, relative))
        print(json.dumps({"verified": relative, "bytes": records[-1]["bytes"]}), flush=True)
    safe_target(TARGET, "tmp").mkdir(exist_ok=True)
    manifest = {
        "schema": 1, "producer": "prepare_tts_runtime.py", "preparedAt": datetime.now(timezone.utc).isoformat(),
        "status": "assets_copied_and_verified_service_not_started", "sourceContainer": "shadow-tts",
        "image": {"id": IMAGE_ID, "historicalTag": "mc-tts:1.0", "bytes": 4990222488},
        "workers": [
            {"path": "/app/tts_api.py", "origin": "D bind copy from audited source", "sha256": records[0]["sha256"]},
            {"path": "/app/indextts/infer_v2_5.py", "origin": "immutable image; running source matched local source", "sha256": INFER_SHA256},
            {"path": "/app/checkpoints/pinyin.vocab", "origin": "immutable image; not the /checkpoints bind"},
            {"path": "Python packages /app and /usr/local/lib/python3.11/site-packages", "origin": "immutable image; no old writable layer copied"},
        ],
        "modelFiles": len(models), "voiceFiles": len(voices), "fileCount": len(records),
        "bytes": sum(x["bytes"] for x in records), "freeBytesBefore": free, "files": records,
        "runtimeWrites": ["D server/tts-state/tmp", "new container compiler/font caches"],
        "inferenceTested": False, "switched": False,
    }
    write_owned_json("source-manifest.json", manifest)
    write_owned_json("compose.service.json", compose_service())
    return {key: manifest[key] for key in ("status", "modelFiles", "voiceFiles", "fileCount", "bytes", "inferenceTested", "switched")}


def self_test() -> dict:
    checks = 0
    temporary = Path(tempfile.mkdtemp(prefix="qd-tts-prepare-"))
    try:
        root = temporary / "target"
        root.mkdir()
        for invalid in ("../outside", "/absolute", "C:/outside", "a\\b"):
            try:
                safe_target(root, invalid)
                raise AssertionError("unsafe path accepted")
            except ValueError:
                checks += 1
        source = temporary / "source.wav"
        source.write_bytes(b"fixture-only")
        first = copy_verified(source, root, "voices/fixture.wav")
        assert copy_verified(source, root, "voices/fixture.wav") == first
        checks += 1
        (root / "voices/fixture.wav").write_bytes(b"do-not-overwrite")
        try:
            copy_verified(source, root, "voices/fixture.wav")
            raise AssertionError("different target overwritten")
        except ValueError:
            assert (root / "voices/fixture.wav").read_bytes() == b"do-not-overwrite"
            checks += 1
        service = compose_service()["services"]["tts"]
        assert service["image"] == IMAGE_ID and service["ports"] == ["127.0.0.1:8100:8100"]
        assert all(v["read_only"] for v in service["volumes"][:3])
        assert all(str(PROJECT) in v["source"] for v in service["volumes"])
        checks += 3
        return {"ok": True, "checks": checks, "offline": True}
    finally:
        resolved = temporary.resolve()
        if not resolved.is_relative_to(Path(tempfile.gettempdir()).resolve()) or not resolved.name.startswith("qd-tts-prepare-"):
            raise ValueError("Refusing unexpected self-test cleanup target")
        shutil.rmtree(resolved)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepare", action="store_true", help="Copy and SHA-256 verify assets into D; no service actions")
    parser.add_argument("--self-test", action="store_true", help="Small offline path and overwrite checks")
    args = parser.parse_args()
    if args.prepare == args.self_test:
        parser.error("Choose exactly one of --prepare or --self-test")
    print(json.dumps(prepare() if args.prepare else self_test(), ensure_ascii=False, indent=2))

"""Verify the rebuilt game TTS with three short, unplayed synthesis requests.

Requires an already running Compose service and its build receipt. Never starts
services, calls a chat model, rewrites manifests, or touches player audio queues.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import time
import urllib.parse
import urllib.request
import uuid

from smoke_tts_ownership import command, inspect, pcm_check, sha, verify_assets

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / "server/tts-state"
CONTAINER = "qiandengji-tts-1"
BASE = "http://127.0.0.1:8100"
REPORT_DIR = ROOT / "runtime/cloud-tts-20260913"
BUILD_RECEIPT = STATE / "runtime-image.json"
ASSET_MANIFEST = STATE / "source-manifest.json"
MAID_SITE = ROOT / "server/mc/config/touhou_little_maid/sites/tts.json"
HASH = re.compile(r"[0-9a-f]{64}")


def host_path(value: str) -> str:
    """Compare Windows and Docker Desktop bind-mount representations."""
    value = value.replace("\\", "/").rstrip("/").lower()
    return re.sub(r"^/run/desktop/mnt/host/([a-z])/", r"\1:/", value)


def validate_receipt(receipt: dict) -> None:
    if receipt.get("schema") != 1 or receipt.get("producer") != "build_tts_runtime.py":
        raise ValueError("Expected the new TTS builder's schema 1 runtime receipt")
    image = receipt.get("image", {})
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", image.get("id", "")):
        raise ValueError("Build receipt has no immutable image ID")
    if not re.fullmatch(r"qiandengji-tts:[A-Za-z0-9_.-]{1,100}", image.get("tag", "")):
        raise ValueError("Build receipt has an unexpected image tag")
    for key in ("adapterSha256", "inferSha256"):
        if not HASH.fullmatch(receipt.get(key, "")):
            raise ValueError("Build receipt is missing " + key)
    records = receipt.get("sourceRecords")
    if not isinstance(records, list) or not records:
        raise ValueError("Build receipt is missing staged source records")
    names = set()
    for row in records:
        path = row.get("path", "")
        relative = PurePosixPath(path)
        if (not path or relative.is_absolute() or ".." in relative.parts or "\\" in path
                or ":" in path or path in names or not HASH.fullmatch(row.get("sha256", ""))):
            raise ValueError("Invalid staged source record")
        names.add(path)


def verify_container(current: dict | None, old: dict | None, receipt: dict) -> dict:
    if not current or current.get("Image") != receipt["image"]["id"]:
        raise ValueError("Running TTS does not match the rebuilt image receipt")
    config = current.get("Config", {})
    labels = config.get("Labels") or {}
    if (config.get("Image") != receipt["image"]["tag"]
            or labels.get("com.docker.compose.project") != "qiandengji"
            or labels.get("com.docker.compose.service") != "tts"):
        raise ValueError("TTS is not the expected game Compose service")
    state = current.get("State", {})
    if not state.get("Running") or state.get("Health", {}).get("Status") != "healthy":
        raise ValueError("Game TTS is not running and healthy")
    if old and old.get("State", {}).get("Running"):
        raise ValueError("The retired shadow TTS is still running")
    ports = current.get("HostConfig", {}).get("PortBindings")
    if ports != {"8100/tcp": [{"HostIp": "127.0.0.1", "HostPort": "8100"}]}:
        raise ValueError("TTS must publish only localhost:8100")
    expected = {
        "/app/tts_api.py": (STATE / "app/tts_api.py", False),
        "/checkpoints": (STATE / "checkpoints", False),
        "/voices": (STATE / "voices", False),
        "/tmp": (STATE / "tmp", True),
    }
    mounts = {row["Destination"]: row for row in current.get("Mounts", [])}
    if set(mounts) != set(expected):
        raise ValueError("TTS has missing or unexpected runtime mounts")
    for destination, (source, writable) in expected.items():
        row = mounts[destination]
        if (row.get("Type") != "bind" or row.get("RW") is not writable
                or host_path(row.get("Source", "")) != host_path(str(source))):
            raise ValueError("Unexpected TTS data ownership or mount mode: " + destination)
    return {"containerId": current["Id"], "image": receipt["image"],
            "oldTtsState": old.get("State", {}).get("Status") if old else "absent",
            "localhostOnly": True, "modelsAndVoicesReadOnly": True}


def verify_health(health: dict) -> None:
    device = health.get("device")
    if (health.get("ok") is not True or not isinstance(device, str)
            or not re.fullmatch(r"cuda(?::[0-9]+)?", device)
            or health.get("textEmotionModelLoaded") is not False
            or health.get("maidEndpoint") != "/tts/maid"
            or health.get("maidMediaType") != "audio/mpeg"):
        raise ValueError("TTS must report CUDA, no text-emotion LLM, and the MP3 maid endpoint")


def request(endpoint: str, payload: dict | None = None) -> tuple[bytes, str, float]:
    data = json.dumps(payload, ensure_ascii=False).encode("utf8") if payload is not None else None
    headers = {"Content-Type": "application/json"} if data is not None else {}
    req = urllib.request.Request(BASE + endpoint, data=data, headers=headers)
    started = time.monotonic()
    with urllib.request.urlopen(req, timeout=180) as response:
        return response.read(), response.headers.get("Content-Type", ""), round(time.monotonic() - started, 3)


def verify_sources(receipt: dict) -> dict:
    expected = receipt["adapterSha256"]
    if any(sha(path) != expected for path in (ROOT / "world/tts/tts_api.py", STATE / "app/tts_api.py")):
        raise ValueError("Source/API bind differs from the rebuilt adapter receipt")
    records = receipt["sourceRecords"] + [
        {"path": "tts_api.py", "sha256": expected},
        {"path": "indextts/infer_v2_5.py", "sha256": receipt["inferSha256"]},
    ]
    script = """import hashlib,json,pathlib,sys
rows=json.load(sys.stdin)
for row in rows:
    path=pathlib.Path('/app')/row['path']
    with path.open('rb') as stream:
        actual=hashlib.file_digest(stream,'sha256').hexdigest()
    if actual != row['sha256']:
        raise ValueError('Running source differs: '+row['path'])
print(json.dumps({'allSha256Match':True,'records':len(rows)}))
"""
    result = command(["docker", "exec", "-i", CONTAINER, "python3", "-c", script],
                     input=json.dumps(records).encode("utf8"), timeout=60)
    return {**json.loads(result.stdout), "adapterSha256": expected, "inferSha256": receipt["inferSha256"]}


def gpu_sample() -> dict:
    try:
        result = command(["nvidia-smi", "--query-gpu=name,memory.used,memory.total,utilization.gpu",
                          "--format=csv,noheader,nounits"], timeout=10, allow_failure=True)
        if result.returncode == 0:
            return {"available": True, "columns": ["name", "usedMiB", "totalMiB", "utilizationPercent"],
                    "rows": [row.strip().split(", ") for row in result.stdout.decode("utf8", "replace").splitlines()]}
    except (OSError, subprocess.TimeoutExpired):
        pass
    return {"available": False}


def main() -> int:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]
    work = REPORT_DIR / ("smoke-" + stamp)
    work.mkdir(parents=True, exist_ok=False)
    record = {"schema": 1, "startedAt": datetime.now(timezone.utc).isoformat(), "ok": False,
              "checks": [], "artifactDirectory": str(work), "playbackTested": False,
              "microphoneUsed": False, "realPlayerQueueWritten": False, "serviceActions": False,
              "generativeLlmCalls": 0, "synthesisRequests": 0}
    manifest = None
    baseline = {}
    assets_checked = False
    try:
        receipt = json.loads(BUILD_RECEIPT.read_text(encoding="utf-8-sig"))
        validate_receipt(receipt)
        current, old = inspect(CONTAINER), inspect("shadow-tts")
        record["checks"].append({"name": "rebuilt_compose_runtime", "ok": True,
                                 **verify_container(current, old, receipt)})
        for path in (BUILD_RECEIPT, ASSET_MANIFEST, MAID_SITE, ROOT / "world/tts/tts_api.py"):
            baseline[str(path)] = sha(path)
        manifest = json.loads(ASSET_MANIFEST.read_text(encoding="utf-8-sig"))
        if len(manifest.get("files", [])) != 79:
            raise ValueError("Expected the existing 79-file model, voice, and adapter manifest")
        record["checks"].append({"name": "assets_before", "ok": True, **verify_assets(manifest)})
        assets_checked = True
        record["checks"].append({"name": "running_source_hashes", "ok": True, **verify_sources(receipt)})
        health = json.loads(request("/health")[0])
        verify_health(health)
        actual = json.loads(request("/voices")[0])["voices"]
        expected = {Path(row["path"]).stem for row in manifest["files"] if row["path"].startswith("voices/")}
        if len(actual) != len(set(actual)) or set(actual) != expected or len(actual) != 47:
            raise ValueError("Voice catalogue differs from the existing 47 reference voices")
        record["checks"].append({"name": "cuda_and_voice_catalogue", "ok": True,
                                 "voiceCount": len(actual), "health": health})
        record["gpuBefore"] = gpu_sample()
        for fmt in ("wav", "mp3"):
            query = urllib.parse.urlencode({"text": "千灯纪语音测试。", "voice": "goddess", "format": fmt})
            record["synthesisRequests"] += 1
            audio, content_type, elapsed = request("/tts?" + query)
            if fmt == "wav" and not (audio[:4] == b"RIFF" and audio[8:12] == b"WAVE"):
                raise ValueError("GET WAV returned a non-WAV response")
            if fmt == "mp3" and "audio/mpeg" not in content_type:
                raise ValueError("GET MP3 returned unexpected content type")
            (work / ("get-goddess." + fmt)).write_bytes(audio)
            record["checks"].append({"name": "get_" + fmt, "ok": True, "latencySeconds": elapsed,
                                     "contentType": content_type, **pcm_check(audio)})
        raw = json.loads(MAID_SITE.read_text(encoding="utf-8-sig"))
        site = raw.get("sites", raw).get("gpt-sovits", {})
        if site.get("enabled") is not True or site.get("url") != "http://host.docker.internal:8100/tts/maid":
            raise ValueError("Current TLM site is not using the local MP3 adapter")
        payload = {key: site[key] for key in ("ref_audio_path", "prompt_lang", "prompt_text",
                   "aux_ref_audio_paths", "text_split_method") if key in site}
        payload.update(text="伙伴语音接口测试。", text_lang="zh")
        record["synthesisRequests"] += 1
        audio, content_type, elapsed = request("/tts/maid", payload)
        if "audio/mpeg" not in content_type:
            raise ValueError("POST /tts/maid must return MPEG audio for TLM")
        (work / "post-maid.mp3").write_bytes(audio)
        record["checks"].append({"name": "post_existing_maid_parameters_mp3", "ok": True,
                                 "referenceVoice": Path(payload["ref_audio_path"]).name,
                                 "latencySeconds": elapsed, "contentType": content_type, **pcm_check(audio)})
        final_health = json.loads(request("/health")[0])
        verify_health(final_health)
        record["checks"].append({"name": "cuda_after_synthesis", "ok": True, "health": final_health})
        record["gpuAfter"] = gpu_sample()
        record["ok"] = True
    except Exception as error:
        record["error"] = {"type": type(error).__name__, "message": str(error)[:400]}
    finally:
        if assets_checked:
            try:
                record["checks"].append({"name": "assets_after", "ok": True, **verify_assets(manifest)})
                if any(sha(Path(path)) != expected for path, expected in baseline.items()):
                    raise ValueError("A manifest, adapter source, or maid configuration changed during QA")
                record["checks"].append({"name": "manifests_and_configuration_unchanged", "ok": True,
                                         "sha256": baseline})
            except Exception as error:
                record["ok"] = False
                record["integrityError"] = {"type": type(error).__name__, "message": str(error)[:400]}
        record["finishedAt"] = datetime.now(timezone.utc).isoformat()
        data = json.dumps(record, ensure_ascii=False, indent=2) + "\n"
        (work / "result.json").write_text(data, encoding="utf8")
        report = REPORT_DIR / "tts-runtime-smoke.json"
        report.write_text(data, encoding="utf8")
        print(json.dumps({"ok": record["ok"], "synthesisRequests": record["synthesisRequests"],
                          "checks": len(record["checks"]), "error": record.get("error"),
                          "integrityError": record.get("integrityError"), "report": str(report)}, ensure_ascii=False))
    return 0 if record["ok"] else 1


def self_test() -> int:
    import copy
    valid = {"schema": 1, "producer": "build_tts_runtime.py", "image": {
        "id": "sha256:" + "a" * 64, "tag": "qiandengji-tts:fixture"},
        "adapterSha256": "b" * 64, "inferSha256": "c" * 64,
        "sourceRecords": [{"path": "indextts/infer_v2_5.py", "sha256": "c" * 64}]}
    validate_receipt(valid)
    bad = copy.deepcopy(valid)
    bad["sourceRecords"][0]["path"] = "../outside"
    try:
        validate_receipt(bad)
    except ValueError:
        pass
    else:
        raise AssertionError("Escaping source path was accepted")
    health = {"ok": True, "device": "cuda:0", "textEmotionModelLoaded": False,
              "maidEndpoint": "/tts/maid", "maidMediaType": "audio/mpeg"}
    verify_health(health)
    for changed in ({"device": "cpu"}, {"textEmotionModelLoaded": True}):
        try:
            verify_health({**health, **changed})
        except ValueError:
            pass
        else:
            raise AssertionError("Unexpected inference configuration was accepted")
    assert host_path("/run/desktop/mnt/host/d/Projects/QiandengJi/") == host_path("D:\\Projects\\QiandengJi")
    current = {"Id": "fixture", "Image": valid["image"]["id"],
               "Config": {"Image": valid["image"]["tag"], "Labels": {
                   "com.docker.compose.project": "qiandengji", "com.docker.compose.service": "tts"}},
               "State": {"Running": True, "Health": {"Status": "healthy"}},
               "HostConfig": {"PortBindings": {"8100/tcp": [{"HostIp": "127.0.0.1", "HostPort": "8100"}]}},
               "Mounts": [{"Type": "bind", "Source": str(STATE / source),
                           "Destination": target, "RW": writable} for source, target, writable in (
                   ("app/tts_api.py", "/app/tts_api.py", False),
                   ("checkpoints", "/checkpoints", False), ("voices", "/voices", False), ("tmp", "/tmp", True))]}
    assert verify_container(current, None, valid)["oldTtsState"] == "absent"
    assert verify_container(current, {"State": {"Running": False, "Status": "exited"}}, valid)["oldTtsState"] == "exited"
    for changed, old in ((current, {"State": {"Running": True}}),
                         ({**current, "Image": "sha256:" + "d" * 64}, None)):
        try:
            verify_container(changed, old, valid)
        except ValueError:
            pass
        else:
            raise AssertionError("Unrelated image or running legacy service was accepted")
    print(json.dumps({"ok": True, "offline": True, "checks": 10, "synthesisRequests": 0}))
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test", action="store_true", help="Small offline receipt/health checks; no service access")
    args = parser.parse_args()
    raise SystemExit(self_test() if args.self_test else main())

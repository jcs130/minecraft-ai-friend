"""Real D TTS/isolated-consumer QA. No playback or real player queue writes."""
from __future__ import annotations
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import struct
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]
IMAGE = "sha256:9da38721708a19a1c0528b5224a2d9e464453bd56f46f51e9c595dd27e0f56bb"
REPORT = ROOT / "reports/tts-ownership-smoke.json"
RUN = uuid.uuid4().hex[:12]
WORK = ROOT / ("runtime/tts-ownership-qa-" + RUN)
QA_NAME = "qd-tts-smoke-" + RUN
BASE = "http://127.0.0.1:8100"

def sha(path):
    h = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(4 * 1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()

def command(args, *, input=None, timeout=30, allow_failure=False):
    result = subprocess.run(args, input=input, capture_output=True, timeout=timeout,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if result.returncode and not allow_failure:
        raise RuntimeError(f"{args[0]} operation failed: " + result.stderr.decode("utf8", "replace")[:300])
    return result

def inspect(name):
    r = command(["docker", "inspect", name], allow_failure=True)
    return json.loads(r.stdout)[0] if r.returncode == 0 else None

def request(endpoint, payload=None):
    req = urllib.request.Request(BASE + endpoint,
        data=json.dumps(payload, ensure_ascii=False).encode("utf8") if payload is not None else None,
        headers={"Content-Type": "application/json"} if payload is not None else {})
    with urllib.request.urlopen(req, timeout=150) as response:
        return response.read(), response.headers.get("Content-Type", "")

def pcm_check(audio):
    # The TTS image includes ffmpeg; the lightweight voice image does not.
    # stdin/stdout only, with no playback or server-side artifact writes.
    result = command(["docker", "exec", "-i", "qiandengji-tts-1", "ffmpeg", "-v", "error",
        "-i", "pipe:0", "-f", "s16le", "-ac", "1", "-ar", "16000", "pipe:1"], input=audio, timeout=60)
    if not result.stdout or len(result.stdout) % 2:
        raise ValueError("Audio decoder returned no complete PCM samples")
    values = [x[0] for x in struct.iter_unpack("<h", result.stdout)]
    peak = max(abs(x) for x in values)
    if peak < 10 or len(values) < 1600:
        raise ValueError("Decoded audio was empty/silent/too short")
    return {"bytes": len(audio), "sha256": hashlib.sha256(audio).hexdigest(),
            "decodedSeconds": round(len(values) / 16000, 3), "peak": peak,
            "rms": round(math.sqrt(sum(x*x for x in values) / len(values)), 2)}

def verify_assets(manifest):
    base = ROOT / "server/tts-state"
    total = 0
    for row in manifest["files"]:
        path = (base / row["path"]).resolve()
        if not path.is_relative_to(base.resolve()) or not path.is_file():
            raise ValueError("Manifest path missing or outside TTS data tree")
        if path.stat().st_size != row["bytes"] or sha(path) != row["sha256"]:
            raise ValueError("TTS asset differs from copied source manifest: " + row["path"])
        total += row["bytes"]
    return {"files": len(manifest["files"]), "bytes": total, "allSha256Match": True}

def main():
    if ROOT.drive.upper() != "D:" or not WORK.resolve().is_relative_to((ROOT / "runtime").resolve()):
        raise ValueError("QA artifacts must stay in this D project")
    record = {"schema": 1, "startedAt": datetime.now(timezone.utc).isoformat(), "ok": False,
              "checks": [], "playbackTested": False, "microphoneUsed": False,
              "realPlayerQueueWritten": False, "artifactDirectory": str(WORK),
              "postMp3Supported": False, "postMp3Note": "Existing API POST /tts returns WAV; MP3 is GET format=mp3 only."}
    qa_id = None
    cleanup_ok = True
    manifest_path = ROOT / "server/tts-state/source-manifest.json"
    maid_path = ROOT / "server/mc/config/touhou_little_maid/sites/tts.json"
    before_hashes = {}
    try:
        current, old, voice = inspect("qiandengji-tts-1"), inspect("shadow-tts"), inspect("qiandengji-voice-1")
        if not current or current["Image"] != IMAGE or current["Config"]["Labels"].get("com.docker.compose.project") != "qiandengji":
            raise ValueError("Expected D-owned TTS immutable image was not running")
        if not current["State"]["Running"] or current["State"].get("Health", {}).get("Status") != "healthy":
            raise ValueError("D TTS is not healthy")
        if not old or old["State"]["Running"]:
            raise ValueError("Old TTS must be stopped before QA")
        if current["HostConfig"]["PortBindings"] != {"8100/tcp": [{"HostIp":"127.0.0.1", "HostPort":"8100"}]}:
            raise ValueError("Unexpected 8100 publication")
        for mount in current["Mounts"]:
            if not Path(mount["Source"]).resolve().is_relative_to((ROOT / "server/tts-state").resolve()):
                raise ValueError("TTS still mounts data outside the D ownership tree")
            if mount["Destination"] in ("/checkpoints", "/voices", "/app/tts_api.py") and mount["RW"]:
                raise ValueError("Immutable TTS assets must be read-only")
        if not voice or not voice["State"]["Running"]:
            raise ValueError("Current D voice consumer is not running")
        record["checks"].append({"name":"d_owner_and_old_stopped", "ok":True, "imageId":IMAGE,
                                  "ttsContainerId":current["Id"], "oldState":old["State"]["Status"]})
        WORK.mkdir(exist_ok=False)
        before = WORK / "before"
        before.mkdir()
        for path in (manifest_path, maid_path):
            before_hashes[str(path)] = sha(path)
            shutil.copyfile(path, before / path.name)
        manifest = json.loads(manifest_path.read_text(encoding="utf8"))
        record["checks"].append({"name":"assets_match_source_manifest_before", "ok":True, **verify_assets(manifest)})
        health, _ = request("/health")
        if json.loads(health).get("ok") is not True:
            raise ValueError("D health endpoint returned false")
        voices, _ = request("/voices")
        actual = set(json.loads(voices)["voices"])
        expected = {Path(x["path"]).stem for x in manifest["files"] if x["path"].startswith("voices/")}
        if actual != expected:
            raise ValueError("Voice catalogue differs from migrated references")
        record["checks"].append({"name":"health_and_voice_catalogue", "ok":True, "voiceCount":len(actual)})
        for fmt in ("wav", "mp3"):
            query = urllib.parse.urlencode({"text":"千灯纪语音接管测试。", "voice":"goddess", "format":fmt})
            audio, content_type = request("/tts?" + query)
            if fmt == "wav" and not (audio[:4] == b"RIFF" and audio[8:12] == b"WAVE"):
                raise ValueError("GET WAV returned a non-WAV response")
            if fmt == "mp3" and "audio/mpeg" not in content_type:
                raise ValueError("GET MP3 returned unexpected content type")
            (WORK / ("get-goddess." + fmt)).write_bytes(audio)
            record["checks"].append({"name":"get_" + fmt, "ok":True, "contentType":content_type, **pcm_check(audio)})
        raw_maids = json.loads(maid_path.read_text(encoding="utf-8-sig"))
        sites = raw_maids.get("sites", raw_maids)
        site = sites.get("gpt-sovits")
        if not isinstance(site, dict) or site.get("enabled") is not True:
            raise ValueError("Existing maid GPT-SoVITS site is not enabled")
        payload = {k:site[k] for k in ("ref_audio_path", "prompt_lang", "prompt_text", "aux_ref_audio_paths", "text_split_method") if k in site}
        payload.update(text="女仆语音接口接管测试。", text_lang="zh")
        audio, content_type = request("/tts", payload)
        if not (audio[:4] == b"RIFF" and audio[8:12] == b"WAVE"):
            raise ValueError("Maid POST returned a non-WAV response")
        (WORK / "post-maid.wav").write_bytes(audio)
        record["checks"].append({"name":"post_existing_maid_parameters_wav", "ok":True,
            "referenceVoice":Path(payload["ref_audio_path"]).name, "contentType":content_type, **pcm_check(audio)})
        try:
            request("/tts?text=")
            raise ValueError("Empty text was not rejected")
        except urllib.error.HTTPError as error:
            if error.code != 400:
                raise
        record["checks"].append({"name":"empty_text_rejected", "ok":True, "httpStatus":400})
        queue = WORK / "isolated-queue"
        text_queue = queue / "text-queue"
        text_queue.mkdir(parents=True)
        job_id = "qd_tts_" + RUN
        entity = str(uuid.uuid4())  # never registered; no MC/playback mount exists
        (text_queue / (job_id + ".json")).write_text(json.dumps({"id":job_id, "entity":entity,
            "voice":"goddess", "text":"隔离队列验收。"}, ensure_ascii=False), encoding="utf8")
        args = ["docker", "run", "-d", "--rm", "--name", QA_NAME, "--label", "qiandeng.qa.tts=" + RUN,
            "--network", "qiandengji_default", "--env", "GV_BASE=/godvoice",
            "--env", "TTS_LOCAL_URL=http://host.docker.internal:8100", "--env", "VOICE_ALLOW_EDGE_FALLBACK=0",
            "--mount", f"type=bind,source={ROOT / 'world/sidecar'},target=/opt/sidecar,readonly",
            "--mount", f"type=bind,source={queue},target=/godvoice", "--entrypoint", "python",
            voice["Image"], "-u", "/opt/sidecar/god-voice-watcher.py"]
        qa_id = command(args, timeout=45).stdout.decode().strip()
        deadline = time.monotonic() + 120
        output = queue / "tts-queue" / (job_id + ".json")
        while not output.is_file():
            if list(queue.rglob("*.err")):
                raise ValueError("Isolated consumer rejected QA task")
            if time.monotonic() > deadline:
                raise TimeoutError("Isolated consumer did not publish within 120 seconds")
            time.sleep(0.5)
        job = json.loads(output.read_text(encoding="utf8"))
        if job.get("id") != job_id or job.get("entity") != entity or job.get("engine") != "local":
            raise ValueError("Isolated consumer publication mismatch")
        mp3 = queue / "tts-queue" / (job_id + ".mp3")
        decoded = pcm_check(mp3.read_bytes())
        time.sleep(1)
        if (text_queue / (job_id + ".json")).exists() or list((text_queue / ".claimed").glob("*.json")):
            raise ValueError("Isolated task claim was not completed")
        record["checks"].append({"name":"real_consumer_isolated_queue", "ok":True,
            "workerSha256":sha(ROOT / "world/sidecar/god-voice-watcher.py"),
            "engine":"local", "claimedRemoved":True, "playbackConsumerMounted":False, **decoded})
        record["checks"].append({"name":"assets_match_source_manifest_after", "ok":True, **verify_assets(manifest)})
        if any(sha(Path(path)) != expected for path, expected in before_hashes.items()):
            raise ValueError("Manifest or maid site changed during inference QA")
        record["checks"].append({"name":"manifest_and_maid_configuration_unchanged", "ok":True,
            "manifestSha256":before_hashes[str(manifest_path)], "maidConfigSha256":before_hashes[str(maid_path)]})
        record["ok"] = True
    except Exception as error:
        record["error"] = {"type":type(error).__name__, "message":str(error)[:400]}
    finally:
        candidate = inspect(qa_id or QA_NAME)
        if candidate:
            if candidate["Config"].get("Labels", {}).get("qiandeng.qa.tts") != RUN or candidate.get("Name") != "/" + QA_NAME:
                cleanup_ok = False
            else:
                stopped = command(["docker", "stop", "--time", "5", candidate["Id"]], timeout=20, allow_failure=True)
                cleanup_ok = stopped.returncode == 0 and inspect(candidate["Id"]) is None
        record["cleanup"] = {"ownQaContainerRemoved":cleanup_ok, "audioArtifactsRetainedUnplayed":True}
        record["ok"] = record["ok"] and cleanup_ok
        record["finishedAt"] = datetime.now(timezone.utc).isoformat()
        REPORT.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf8")
        print(json.dumps({"ok":record["ok"], "checks":len(record["checks"]), "cleanup":record["cleanup"], "error":record.get("error"), "report":str(REPORT)}, ensure_ascii=False))
    return 0 if record["ok"] else 1

if __name__ == "__main__":
    raise SystemExit(main())

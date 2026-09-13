"""Verify the installed Kokoro service with unplayed speech and warm timings.

No service starts, language-model calls, real-player queue writes or playback.
Every request is decoded; five short requests measure full HTTP response time.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import io
import json
import math
from pathlib import Path
import re
import statistics
import subprocess
import time
import urllib.parse
import urllib.request
import uuid
import wave

from smoke_tts_ownership import command, inspect, pcm_check, sha

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / "server/kokoro-state"
RECEIPT = STATE / "runtime-image.json"
MANIFEST = STATE / "source-manifest.json"
ALIASES = ROOT / "config/kokoro-voices.json"
VOICE_ROOT = ROOT / "server/tts-state/voices"
MAID_SITE = ROOT / "server/mc/config/touhou_little_maid/sites/tts.json"
REPORT_DIR = ROOT / "runtime/kokoro-20260913"
INDEX_BASELINE = ROOT / "runtime/cloud-tts-20260913/tts-runtime-smoke.json"
CONTAINER = "qiandengji-tts-1"
TAG = "qiandengji-tts:kokoro-1.1-qd1"
ENGINE = "Kokoro-82M-v1.1-zh"
BASE = "http://127.0.0.1:8100"
NATIVE_VOICES = {"zf_001", "zm_010"}
ASSET_PATHS = {"model/config.json", "model/kokoro-v1_1-zh.pth", "model/voices/zf_001.pt", "model/voices/zm_010.pt"}
JAR = ROOT / "server/mc/mods/touhoulittlemaid-1.5.3-neoforge+mc1.21.1.jar"
JAR_SHA256 = "ac7c07068be61216180a75e6845dc1e91f8c95a7c2e19ad241b81a127e7802dd"


def host_path(value: str) -> str:
    value = value.replace("\\", "/").rstrip("/").lower()
    return re.sub(r"^/run/desktop/mnt/host/([a-z])/", r"\1:/", value)


def verify_receipt(receipt: dict) -> None:
    if receipt.get("schema") != 1 or receipt.get("producer") != "prepare_kokoro_runtime.py":
        raise ValueError("Expected the Kokoro builder's schema 1 runtime receipt")
    image = receipt.get("image", {})
    if image.get("tag") != TAG or not re.fullmatch(r"sha256:[0-9a-f]{64}", image.get("id", "")):
        raise ValueError("Kokoro runtime image identity is missing")
    for key in ("adapterSha256", "engineSha256", "assetsManifestSha256"):
        if not re.fullmatch(r"[0-9a-f]{64}", receipt.get(key, "")):
            raise ValueError("Kokoro build receipt is missing " + key)


def verify_container(current: dict | None, receipt: dict) -> dict:
    if not current or current.get("Image") != receipt["image"]["id"]:
        raise ValueError("Running service differs from the new Kokoro image")
    config, state = current.get("Config", {}), current.get("State", {})
    labels = config.get("Labels") or {}
    if (config.get("Image") != TAG or labels.get("com.docker.compose.project") != "qiandengji"
            or labels.get("com.docker.compose.service") != "tts"
            or not state.get("Running") or state.get("Health", {}).get("Status") != "healthy"):
        raise ValueError("The game Compose TTS service is not running and healthy")
    ports = current.get("HostConfig", {}).get("PortBindings")
    if ports != {"8100/tcp": [{"HostIp": "127.0.0.1", "HostPort": "8100"}]}:
        raise ValueError("Kokoro must publish only localhost:8100")
    expected = {"/kokoro": (STATE / "model", False), "/app/kokoro-voices.json": (ALIASES, False),
                "/voices": (VOICE_ROOT, False), "/tmp": (STATE / "tmp", True)}
    mounts = {row["Destination"]: row for row in current.get("Mounts", [])}
    if set(mounts) != set(expected):
        raise ValueError("Unexpected Kokoro mounts; API and engine must come from the image")
    for destination, (source, writable) in expected.items():
        row = mounts[destination]
        if (row.get("Type") != "bind" or row.get("RW") is not writable
                or host_path(row.get("Source", "")) != host_path(str(source))):
            raise ValueError("Unexpected Kokoro mount ownership: " + destination)
    return {"containerId": current["Id"], "image": receipt["image"], "localhostOnly": True,
            "sourceCopiedIntoImage": True, "modelAndAliasesReadOnly": True}


def verify_assets(manifest: dict) -> dict:
    rows = manifest.get("files", [])
    if (manifest.get("schema") != 1 or manifest.get("producer") != "prepare_kokoro_runtime.py"
            or len(rows) != 4 or {row.get("path") for row in rows} != ASSET_PATHS):
        raise ValueError("Expected exactly four staged Kokoro model assets")
    total = 0
    for row in rows:
        path = STATE / row["path"]
        if not path.is_file() or path.stat().st_size != row["bytes"] or sha(path) != row["sha256"]:
            raise ValueError("Kokoro model asset changed: " + row["path"])
        total += row["bytes"]
    return {"files": 4, "bytes": total, "allSha256Match": True}


def verify_source(receipt: dict, manifest: dict) -> dict:
    rows = []
    for name, key in (("tts_api.py", "adapterSha256"), ("kokoro_engine.py", "engineSha256")):
        if sha(ROOT / "world/tts" / name) != receipt[key]:
            raise ValueError("Current source differs from Kokoro build: " + name)
        rows.append({"path": "/app/" + name, "sha256": receipt[key]})
    rows += [{"path": "/kokoro/" + row["path"].removeprefix("model/"), "sha256": row["sha256"]}
             for row in manifest["files"]]
    rows.append({"path": "/app/kokoro-voices.json", "sha256": sha(ALIASES)})
    script = """import hashlib,json,pathlib,sys
rows=json.load(sys.stdin)
for row in rows:
    with pathlib.Path(row['path']).open('rb') as stream:
        actual=hashlib.file_digest(stream,'sha256').hexdigest()
    if actual != row['sha256']:
        raise ValueError('Running Kokoro source/asset differs: '+row['path'])
print(json.dumps({'allSha256Match':True,'records':len(rows)}))
"""
    result = command(["docker", "exec", "-i", CONTAINER, "python3", "-c", script],
                     input=json.dumps(rows).encode("utf8"), timeout=90)
    return json.loads(result.stdout)


def verify_health(value: dict) -> None:
    if (value.get("ok") is not True or value.get("engine") != ENGINE or value.get("device") != "cuda:0"
            or value.get("textEmotionModelLoaded") is not False or value.get("voiceCloning") is not False
            or value.get("emotionsSupported") is not False or set(value.get("nativeVoices", [])) != NATIVE_VOICES
            or value.get("maidEndpoint") != "/tts/maid" or value.get("maidMediaType") != "audio/mpeg"):
        raise ValueError("Kokoro must report CUDA, its two voices, and unsupported cloning/emotion honestly")


def verify_catalogue(value: dict, config: dict) -> dict:
    aliases = config.get("aliases", {})
    expected = {path.stem for path in VOICE_ROOT.glob("*.wav") if path.is_file()}
    voices = value.get("voices", [])
    if (config.get("schema") != 1 or config.get("engine") != ENGINE
            or len(expected) != 47 or len(voices) != 47 or set(voices) != expected
            or set(aliases) != expected or value.get("voiceMappings") != aliases
            or set(aliases.values()) != NATIVE_VOICES or set(value.get("nativeVoices", [])) != NATIVE_VOICES
            or value.get("voiceCloning") is not False or value.get("emotions") != []
            or aliases.get("cosy_male") != "zm_010" or aliases.get("cosy_female") != "zf_001"
            or aliases.get("goddess") != "zf_001"):
        raise ValueError("Character alias catalogue does not match installed voices")
    return {"aliasCount": len(voices), "nativeVoices": sorted(NATIVE_VOICES), "voiceCloning": False,
            "kirito": aliases["cosy_male"], "yui": aliases["cosy_female"], "goddess": aliases["goddess"]}


def request(endpoint: str, payload: dict | None = None) -> tuple[bytes, str, float]:
    data = json.dumps(payload, ensure_ascii=False).encode("utf8") if payload is not None else None
    headers = {"Content-Type": "application/json"} if data is not None else {}
    started = time.perf_counter()
    with urllib.request.urlopen(urllib.request.Request(BASE + endpoint, data=data, headers=headers), timeout=180) as response:
        body = response.read(16 * 1024 * 1024 + 1)
        if len(body) > 16 * 1024 * 1024:
            raise ValueError("Unexpectedly large TTS response")
        return body, response.headers.get("Content-Type", ""), time.perf_counter() - started


def benchmark_stats(seconds: list[float]) -> dict:
    if len(seconds) < 5 or any(not math.isfinite(n) or n <= 0 for n in seconds):
        raise ValueError("At least five positive full-response timings are required")
    values = sorted(seconds)
    return {"count": len(values), "medianSeconds": round(statistics.median(values), 4),
            "p95Seconds": round(values[math.ceil(len(values) * .95) - 1], 4),
            "p95Method": "nearest-rank", "measurement": "Host HTTP request through complete response body; decode excluded",
            "samplesSeconds": [round(value, 4) for value in seconds]}


def java_decode(mp3: Path, wav: Path) -> dict:
    if sha(JAR) != JAR_SHA256:
        raise ValueError("Installed TLM JAR changed; re-audit its decoder")
    result = command(["java", "--class-path", str(JAR), str(ROOT / "world/tts/tests/DecodeTlmAudio.java"),
                      str(mp3), str(wav)], timeout=60)
    output = result.stdout.decode("utf8", "replace")
    if (not re.search(r"TLM_MP3_DECODED_PCM_BYTES=[1-9][0-9]*", output)
            or "TLM_MP3_DECODED_RATE=24000.0" not in output or "TLM_PCM_WAV_REJECTED=true" not in output):
        raise ValueError("The installed TLM decoder did not confirm 24 kHz MPEG audio")
    return {"jarSha256": JAR_SHA256, "source": "Installed TLM bundled MPEG reader and AudioSystem conversion provider",
            "sampleRate": 24000, "output": output.strip().splitlines(), "audioPlayback": False}


def main() -> int:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]
    work = REPORT_DIR / ("kokoro-smoke-" + stamp)
    work.mkdir(parents=True, exist_ok=False)
    report = {"schema": 1, "engine": ENGINE, "startedAt": datetime.now(timezone.utc).isoformat(),
              "ok": False, "checks": [], "synthesisRequests": 0, "generativeLlmCalls": 0,
              "serviceActions": False, "playbackTested": False, "realPlayerQueueWritten": False,
              "artifactDirectory": str(work)}
    protected, manifest = {}, None
    timings = []
    try:
        receipt = json.loads(RECEIPT.read_text(encoding="utf8"))
        verify_receipt(receipt)
        if sha(MANIFEST) != receipt["assetsManifestSha256"]:
            raise ValueError("Kokoro asset manifest differs from the build receipt")
        manifest = json.loads(MANIFEST.read_text(encoding="utf8"))
        report["checks"].append({"name": "compose_ownership", "ok": True, **verify_container(inspect(CONTAINER), receipt)})
        old = inspect("shadow-tts")
        if old and old.get("State", {}).get("Running"):
            raise ValueError("Retired shadow TTS unexpectedly running")
        for path in (RECEIPT, MANIFEST, ALIASES, MAID_SITE, ROOT / "world/tts/tts_api.py", ROOT / "world/tts/kokoro_engine.py",
                     ROOT / "server/tts-state/source-manifest.json", ROOT / "server/tts-state/runtime-image.json",
                     *VOICE_ROOT.glob("*.wav")):
            protected[str(path)] = sha(path)
        report["checks"].append({"name": "assets_before", "ok": True, **verify_assets(manifest)})
        report["checks"].append({"name": "running_sources_and_model", "ok": True, **verify_source(receipt, manifest)})
        health = json.loads(request("/health")[0])
        verify_health(health)
        config = json.loads(ALIASES.read_text(encoding="utf8"))
        catalogue = json.loads(request("/voices")[0])
        report["checks"].append({"name": "health_and_aliases", "ok": True, "health": health,
                                 **verify_catalogue(catalogue, config)})
        raw_site = json.loads(MAID_SITE.read_text(encoding="utf-8-sig"))
        site = raw_site.get("sites", raw_site).get("gpt-sovits", {})
        if site.get("enabled") is not True or site.get("url") != "http://host.docker.internal:8100/tts/maid":
            raise ValueError("TLM is not configured for the existing local MP3 endpoint")
        maid_payload = {key: site[key] for key in ("ref_audio_path", "prompt_lang", "prompt_text", "aux_ref_audio_paths", "text_split_method") if key in site}
        maid_payload.update(text="伙伴语音接口测试。", text_lang="zh")

        def synthesize(name, text, voice="goddess", fmt="mp3", payload=None):
            endpoint = "/tts/maid" if payload is not None else "/tts?" + urllib.parse.urlencode({"text": text, "voice": voice, "format": fmt})
            report["synthesisRequests"] += 1
            audio, content_type, elapsed = request(endpoint, payload)
            if fmt == "wav":
                with wave.open(io.BytesIO(audio), "rb") as stream:
                    if (stream.getframerate(), stream.getnchannels(), stream.getsampwidth()) != (24000, 1, 2):
                        raise ValueError("Expected 24 kHz mono PCM16 WAV")
            elif "audio/mpeg" not in content_type:
                raise ValueError("Expected MPEG audio")
            artifact = work / (name + "." + fmt)
            artifact.write_bytes(audio)
            decoded = pcm_check(audio)
            row = {"name": name, "ok": True, "text": text, "voice": voice, "format": fmt,
                   "latencySeconds": round(elapsed, 4), "contentType": content_type, **decoded}
            row["realTimeFactor"] = round(elapsed / decoded["decodedSeconds"], 4)
            report["checks"].append(row)
            return elapsed, artifact

        # Identical text, voice, format and maid parameters to the Index baseline.
        _, wav = synthesize("get_wav", "千灯纪语音测试。", fmt="wav")
        synthesize("get_mp3", "千灯纪语音测试。")
        _, maid = synthesize("post_existing_maid_parameters_mp3", maid_payload["text"], voice=Path(maid_payload["ref_audio_path"]).stem, payload=maid_payload)
        report["checks"].append({"name": "installed_tlm_decoder_24khz", "ok": True, **java_decode(maid, wav)})
        synthesize("kirito", "结衣，我们先准备装备，再去探索村庄。", voice="cosy_male")
        synthesize("yui", "爸爸，我会陪你一起行动，遇到问题我们一起解决。", voice="cosy_female")
        long_text = ("清晨，桐人检查背包里的面包、木材和铁锭，准备修好营地旁的小路。"
                     "结衣整理探索记录，提醒他先制作工具，再去村庄寻找新的公会任务。"
                     "他们沿河观察农田与森林，记下矿洞入口和安全返回的路线。"
                     "傍晚回到营地以后，两人总结今天遇到的问题，讨论明天的计划。")
        synthesize("long_chinese", long_text)
        synthesize("mixed_english", "结衣，请检查 Minecraft 服务器的 health status，我们完成 quest 之后回到 home。")
        for index in range(5):
            elapsed, _ = synthesize("warm_short_" + str(index + 1), "千灯纪语音测试。")
            timings.append(elapsed)
        report["warmShortBenchmark"] = {**benchmark_stats(timings), "warmup": "Seven decoded speech requests completed before these samples",
                                        "text": "千灯纪语音测试。", "voice": "goddess", "format": "mp3"}
        baseline_path = INDEX_BASELINE
        if baseline_path.is_file():
            baseline = json.loads(baseline_path.read_text(encoding="utf8"))
            if baseline.get("ok"):
                old_rows = {row["name"]: row for row in baseline.get("checks", [])}
                comparisons = []
                for row in report["checks"]:
                    old_row = old_rows.get(row["name"], {})
                    old_seconds = old_row.get("latencySeconds")
                    if row["name"] in {"get_wav", "get_mp3", "post_existing_maid_parameters_mp3"} and isinstance(old_seconds, (int, float)) and old_seconds > 0:
                        comparisons.append({"name": row["name"], "indexSeconds": old_seconds, "kokoroSeconds": row["latencySeconds"],
                                            "latencyRatio": round(row["latencySeconds"] / old_seconds, 4)})
                report["previousIndexBaseline"] = {"path": str(baseline_path), "sha256": sha(baseline_path), "comparisons": comparisons,
                                                    "scope": "Three matching fixed requests; a single historical sample each, not a latency distribution"}
        health = json.loads(request("/health")[0])
        verify_health(health)
        report["checks"].append({"name": "health_after", "ok": True, "health": health})
        report["ok"] = True
    except Exception as error:
        report["error"] = {"type": type(error).__name__, "message": str(error)[:600]}
    finally:
        try:
            if manifest is not None:
                report["checks"].append({"name": "assets_after", "ok": True, **verify_assets(manifest)})
            if protected:
                if any(sha(Path(path)) != expected for path, expected in protected.items()):
                    raise ValueError("A protected configuration, source, reference voice or Index historical manifest changed during smoke")
                report["checks"].append({"name": "sources_configuration_and_index_history_unchanged", "ok": True, "files": len(protected)})
        except Exception as error:
            report["ok"] = False
            report["integrityError"] = {"type": type(error).__name__, "message": str(error)[:600]}
        report["finishedAt"] = datetime.now(timezone.utc).isoformat()
        data = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
        (work / "result.json").write_text(data, encoding="utf8")
        path = REPORT_DIR / "kokoro-runtime-smoke.json"
        path.write_text(data, encoding="utf8")
        print(json.dumps({"ok": report["ok"], "synthesisRequests": report["synthesisRequests"], "error": report.get("error"),
                          "integrityError": report.get("integrityError"), "warmShortBenchmark": report.get("warmShortBenchmark"), "report": str(path)}, ensure_ascii=False))
    return 0 if report["ok"] else 1


def self_test() -> int:
    valid = {"schema": 1, "producer": "prepare_kokoro_runtime.py", "image": {"id": "sha256:" + "a" * 64, "tag": TAG},
             "adapterSha256": "b" * 64, "engineSha256": "c" * 64, "assetsManifestSha256": "d" * 64}
    verify_receipt(valid)
    health = {"ok": True, "engine": ENGINE, "device": "cuda:0", "textEmotionModelLoaded": False,
              "voiceCloning": False, "emotionsSupported": False, "nativeVoices": sorted(NATIVE_VOICES),
              "maidEndpoint": "/tts/maid", "maidMediaType": "audio/mpeg"}
    verify_health(health)
    for changed in ({"device": "cpu"}, {"voiceCloning": True}, {"emotionsSupported": True}, {"engine": "IndexTTS-2.5"}):
        try:
            verify_health({**health, **changed})
        except ValueError:
            pass
        else:
            raise AssertionError("Unsupported capability or engine was accepted")
    stats = benchmark_stats([.3, .1, .4, .2, .5])
    assert stats["medianSeconds"] == .3 and stats["p95Seconds"] == .5
    assert host_path("/run/desktop/mnt/host/d/Projects/QiandengJi/") == host_path("D:\\Projects\\QiandengJi")
    print(json.dumps({"ok": True, "offline": True, "checks": 8, "synthesisRequests": 0}))
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    raise SystemExit(self_test() if args.self_test else main())

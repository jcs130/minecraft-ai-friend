"""Real LAN-address Drama 3 smoke and evidence capture for the drama-rs cutover."""

from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
from pathlib import Path
import time
from urllib.request import Request, urlopen
import wave


ROOT = Path(__file__).resolve().parents[2]
STATE = ROOT / "server" / "drama3-service"
BENCH = Path(r"E:\ai-models\drama3-compare-20261029\drama-rs\audio")


def get(url: str) -> object:
    with urlopen(url, timeout=10) as response:
        return json.load(response)


def post(url: str, body: dict) -> tuple[bytes, dict, float, float]:
    request = Request(url, data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
                      headers={"Content-Type": "application/json"})
    started = time.monotonic()
    with urlopen(request, timeout=240) as response:
        first = response.read(4096)
        first_s = time.monotonic() - started
        data = first + response.read()
        total_s = time.monotonic() - started
        headers = dict(response.headers)
    return data, headers, first_s, total_s


def wav_info(data: bytes) -> dict:
    with wave.open(io.BytesIO(data), "rb") as wav:
        pcm = wav.readframes(wav.getnframes())
        if len(pcm) % (wav.getnchannels() * wav.getsampwidth()):
            raise AssertionError("incomplete PCM sample")
        samples = len(pcm) // (wav.getnchannels() * wav.getsampwidth())
        result = {"sample_rate": wav.getframerate(), "channels": wav.getnchannels(),
                  "bits": wav.getsampwidth() * 8, "samples": samples,
                  "duration_seconds": round(samples / wav.getframerate(), 3),
                  "pcm_sha256": hashlib.sha256(pcm).hexdigest()}
    if (result["sample_rate"], result["channels"], result["bits"]) != (44100, 1, 16):
        raise AssertionError(f"unexpected WAV format: {result}")
    result["sha256"] = hashlib.sha256(data).hexdigest()
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="http://192.168.3.133:18120")
    parser.add_argument("--quick", action="store_true")
    parser.add_argument("--register-qa", action="store_true")
    args = parser.parse_args()
    base = args.base.rstrip("/")
    output = STATE / "drama-rs-acceptance"
    output.mkdir(parents=True, exist_ok=True)
    health = get(base + "/health")
    assert health["status"] == "ok" and health["runtime"] == "drama-rs", health
    voices = get(base + "/v1/audio/voices")["data"]
    statuses = {item["voice_id"]: item["status"] for item in voices}
    for name in ("none", "kirito", "yui", "cast", "cormy", "qa_kirito_20261028"):
        assert statuses.get(name) == "ready", statuses
    reports: dict[str, object] = {"health": health, "voices": statuses, "cases": {}}
    cases: list[tuple[str, dict, float]] = [
        ("cormy_short", json.loads((BENCH / "short-drama-rs-cormy.request.json").read_text(encoding="utf-8")), 3),
        ("kirito", {"text": "大家晚上好，我是桐人。今天继续在这个世界冒险。",
                    "voice": "kirito", "seed": 17, "split": False, "stream": True}, 1),
        ("yui", {"text": "桐人，我看到前面有怪物。先别急，我来帮你。",
                 "voice": "yui", "seed": 17, "split": False, "stream": True}, 1),
        ("cast", {"text": "<|speaker:0|> 结衣，我们先去那座山上看看。<|speaker:1|> 好呀，桐人，我会跟着你。",
                  "voice": "cast", "seed": 17, "split": False, "stream": True}, 1),
    ]
    if not args.quick:
        cases += [
            ("cormy_long", json.loads((BENCH / "long-drama-rs-cormy.request.json").read_text(encoding="utf-8")), 40),
            ("cormy_names", json.loads((BENCH / "names-drama-rs-cormy.request.json").read_text(encoding="utf-8")), 4),
            ("cormy_whisper", {"text": "[whisper] 可米轻声提醒大家，前面的树林里好像有动静。",
                               "voice": "cormy", "seed": 17, "split": False, "stream": True}, 1),
        ]
    for label, body, minimum in cases:
        data, headers, first, total = post(base + "/v1/speak", body)
        info = wav_info(data)
        assert info["duration_seconds"] >= minimum, (label, info)
        assert first < total, (label, first, total)
        (output / f"{label}.request.json").write_text(json.dumps(body, ensure_ascii=False, indent=2), encoding="utf-8")
        (output / f"{label}.wav").write_bytes(data)
        reports["cases"][label] = {**info, "first_audio_seconds": round(first, 3),
                                   "total_seconds": round(total, 3), "headers": headers}
        print(f"{label}: first={first:.3f}s total={total:.3f}s audio={info['duration_seconds']:.3f}s", flush=True)
    legacy = {"model": "drama-3", "input": "你好，我是可米。", "voice": "cormy",
              "response_format": "pcm", "stream_format": "sse", "seed": 20261021,
              "max_seconds": 10, "max_new": 2048}
    data, headers, first, total = post(base + "/v1/audio/speech", legacy)
    events = [json.loads(line[6:]) for line in data.decode().splitlines() if line.startswith("data: ")]
    pcm = b"".join(base64.b64decode(item["audio"]) for item in events[:-1])
    done = events[-1]
    assert done["type"] == "speech.audio.done" and done["samples"] == len(pcm) // 2, done
    assert done["stop"] == "unknown", done
    assert done["legacy_max_seconds_enforced"] is False, done
    assert "advisory-only" in headers["X-Legacy-Max-Seconds"], headers
    reports["legacy_sse"] = {"first_audio_seconds": round(first, 3), "total_seconds": round(total, 3),
                             "samples": done["samples"], "stop": done["stop"], "headers": headers}
    if args.register_qa:
        name = "qa_rs_kirito_20261029"
        existing = {item["voice_id"] for item in get(base + "/v1/audio/voices")["data"]}
        if name not in existing:
            folder = STATE / "voices" / "qa_kirito_20261028"
            audio = (folder / "reference.wav").read_bytes()
            transcript = (folder / "reference.txt").read_text(encoding="utf-8")
            from urllib.parse import quote
            request = Request(base + "/v1/voices?name=" + name + "&text=" + quote(transcript),
                              data=audio, headers={"Content-Type": "audio/wav"})
            with urlopen(request, timeout=120) as response:
                assert response.status == 200 and response.read().strip() == b"ok"
        entry = get(base + "/v1/audio/voices/" + name)
        assert entry["status"] == "ready", entry
        reports["qa_registration"] = entry
    report_name = "acceptance-quick.json" if args.quick else "acceptance.json"
    (output / report_name).write_text(json.dumps(reports, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"verified {len(cases)} native cases and legacy SSE; evidence={output}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

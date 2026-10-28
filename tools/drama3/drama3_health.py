"""Probe the dedicated Drama 3 LAN service and optionally render real voice samples."""

from __future__ import annotations

import argparse
from array import array
import json
from pathlib import Path
import sys
import time
import urllib.error
import urllib.request
import wave


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT = ROOT / "server" / "drama3-service" / "smoke"
SAMPLES = (
    ("kirito", "<|speaker:0|> 大家晚上好，我是桐人。今天继续在这个世界冒险。", 123),
    ("yui", "<|speaker:0|> 桐人，我看到前面有怪物。先别急，我来帮你。", 123),
    ("cast", "<|speaker:0|> 结衣，我们先去那座山上看看。<|speaker:1|> 好呀，桐人，我会跟着你。", 456),
)


def get_json(url: str, timeout: float = 5.0) -> dict:
    with urllib.request.urlopen(url, timeout=timeout) as response:
        return json.load(response)


def check_service(base: str) -> dict:
    health = get_json(base + "/health")
    if health.get("status") != "ok":
        raise RuntimeError(f"bad health response: {health!r}")
    models = get_json(base + "/v1/models")
    data = models.get("data")
    if not isinstance(data, list) or not any(
        "drama" in str(item.get("id", "")).lower() for item in data
    ):
        raise RuntimeError("Drama 3 model absent from /v1/models")
    return {"ok": True, "model_ids": [item["id"] for item in data]}


def synthesize(
    base: str, output_dir: Path, label: str, prompt: str, seed: int,
    max_seconds: float | None = None,
) -> dict:
    payload = {
        "input": prompt,
        "voice": label,
        "seed": seed,
        "top_k": 4097,
        "response_format": "pcm",
    }
    if max_seconds is not None:
        payload["max_seconds"] = max_seconds
    request = urllib.request.Request(
        base + "/v1/audio/speech",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    started = time.monotonic()
    with urllib.request.urlopen(request, timeout=180) as response:
        first = response.read(2)
        first_seconds = time.monotonic() - started
        rate = int(response.headers["X-Sample-Rate"])
        payload = first + response.read(10 * 1024 * 1024 + 1)
        total_seconds = time.monotonic() - started
    if len(payload) > 10 * 1024 * 1024 or len(payload) < rate or len(payload) % 2:
        raise RuntimeError(f"invalid PCM size for {label}: {len(payload)}")
    samples = array("h")
    samples.frombytes(payload)
    peak = max(abs(value) for value in samples)
    if peak < 100:
        raise RuntimeError(f"silent PCM for {label}: peak={peak}")
    output_dir.mkdir(parents=True, exist_ok=True)
    target = output_dir / f"{label}.wav"
    with wave.open(str(target), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes(payload)
    return {
        "voice": label,
        "first_audio_seconds": round(first_seconds, 3),
        "total_seconds": round(total_seconds, 3),
        "audio_seconds": round(len(samples) / rate, 3),
        "sample_rate": rate,
        "peak_sample": peak,
        "output": str(target),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="http://127.0.0.1:18120")
    parser.add_argument("--smoke", action="store_true", help="render real Kirito, Yui and cast samples")
    parser.add_argument("--max-seconds", type=float, help="send an explicit request limit; omission tests the service default")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    base = args.base.rstrip("/")
    try:
        result = check_service(base)
        if args.smoke:
            result["samples"] = [
                synthesize(base, args.output_dir, label, prompt, seed, args.max_seconds)
                for label, prompt, seed in SAMPLES
            ]
        print(json.dumps(result, ensure_ascii=True))
        return 0
    except urllib.error.HTTPError as error:
        detail = error.read(1024).decode("utf-8", "replace")
        print(json.dumps({"ok": False, "error": f"HTTP {error.code}: {detail}"}, ensure_ascii=True), file=sys.stderr)
        return 1
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=True), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

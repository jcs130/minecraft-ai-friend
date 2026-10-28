"""Capture one Drama 3 SSE request as a WAV and a checkable event log.

The source file contains only test speech. Output belongs in the ignored local
server/drama3-service/longform-acceptance directory, not in Git.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
from pathlib import Path
import sys
import time
from urllib.request import Request, urlopen
import wave


PROMPTS = {
    "short": "可米，今天我们沿着河边慢慢走，先看看前面有没有安全的路。",
    "names": "可米，桐人和结衣现在在坐标 X=128、Y=64、Z=-302，请核对地图后告诉大家下一步往哪里走。",
    "long": (
        "今晚的风把村口的灯吹得轻轻摇晃，可米和桐人沿着石桥走到河边，结衣在后面提醒我们别踩进浅水。"
        "地图上显示营地在东侧的山坡，坐标是X一百二十八、Y六十四、Z负三百零二，我们先核对方位，再沿着火把一直向前。"
        "到了树林边缘，我发现一只小狐狸躲在倒下的树旁，背包里的面包还剩三块，大家可以在聊天里帮我决定先补给还是先搭一座桥。"
        "如果夜色突然变深，我们就回到亮着灯的屋子，记下今天看到的路标，明天继续探索这片陌生又漂亮的世界。"
    ),
}


def probe(base: str, label: str, text: str, seed: int, max_seconds: float,
          output_dir: Path, expected_stop: str) -> dict:
    output_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "model": "drama-3", "input": text, "voice": "cormy", "seed": seed,
        "response_format": "pcm", "stream_format": "sse",
        "max_seconds": max_seconds, "top_k": 4097,
    }
    stem = f"{label}-max{max_seconds:g}-seed{seed}"
    (output_dir / f"{stem}.request.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    request = Request(
        base.rstrip("/") + "/v1/audio/speech",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json", "Accept": "text/event-stream"},
        method="POST",
    )
    started = time.monotonic()
    pcm = bytearray()
    events: list[dict] = []
    first_audio = None
    done = None
    error = None
    status = None
    rate = None
    header_seed = None
    try:
        with urlopen(request, timeout=600) as response:
            status = response.status
            rate = int(response.headers["X-Sample-Rate"])
            header_seed = int(response.headers["X-Speech-Seed"])
            if response.headers.get_content_type() != "text/event-stream":
                raise AssertionError("response is not SSE")
            for raw in response:
                if not raw.startswith(b"data: "):
                    continue
                event = json.loads(raw[6:])
                elapsed = round(time.monotonic() - started, 3)
                kind = event.get("type")
                if kind == "speech.audio.delta":
                    chunk = base64.b64decode(event["audio"], validate=True)
                    if len(chunk) % 2:
                        raise AssertionError("PCM16 chunk has an odd byte count")
                    pcm.extend(chunk)
                    if first_audio is None:
                        first_audio = elapsed
                    events.append({"type": kind, "at_seconds": elapsed,
                                   "samples": len(chunk) // 2})
                elif kind == "speech.audio.done":
                    done = event
                    events.append({**event, "at_seconds": elapsed})
                else:
                    events.append({**event, "at_seconds": elapsed})
                    if kind == "speech.audio.error":
                        error = event
    except Exception as exc:
        error = {"type": type(exc).__name__, "message": str(exc)}
    ended = round(time.monotonic() - started, 3)
    wav_path = output_dir / f"{stem}.wav"
    if rate and pcm:
        with wave.open(str(wav_path), "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(rate)
            wav.writeframes(pcm)
    summary = {
        "label": label, "input_characters": len(text), "input_utf8_bytes": len(text.encode()),
        "http_status": status, "sample_rate": rate, "header_seed": header_seed,
        "first_audio_seconds": first_audio, "total_seconds": ended,
        "pcm_samples": len(pcm) // 2, "pcm_seconds": round(len(pcm) / 2 / rate, 3) if rate else None,
        "pcm_sha256": hashlib.sha256(pcm).hexdigest(), "done": done,
        "error": error, "wav": str(wav_path) if wav_path.is_file() else None,
        "events": events,
    }
    problems = []
    if status != 200 or rate != 44100 or header_seed != seed:
        problems.append("HTTP/rate/seed mismatch")
    if first_audio is None or first_audio >= ended:
        problems.append("no audio before completion")
    if done is None:
        problems.append("missing speech.audio.done")
    elif (done.get("seed") != seed or done.get("samples") != len(pcm) // 2 or
          done.get("stop") != expected_stop):
        problems.append("terminal seed/sample/stop mismatch")
    if error:
        problems.append(f"stream error: {error}")
    summary["ok"] = not problems
    summary["problems"] = problems
    (output_dir / f"{stem}.log.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps({key: value for key, value in summary.items() if key != "events"},
                     ensure_ascii=False, indent=2))
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="http://192.168.3.133:18120")
    parser.add_argument("--case", choices=tuple(PROMPTS), default="long")
    parser.add_argument("--seed", type=int, default=20261021)
    parser.add_argument("--max-seconds", type=float, default=30)
    parser.add_argument("--expect-stop", default="complete")
    parser.add_argument("--output-dir", type=Path, default=Path(__file__).resolve().parents[2] /
                        "server" / "drama3-service" / "longform-acceptance")
    args = parser.parse_args()
    result = probe(args.base, args.case, PROMPTS[args.case], args.seed,
                   args.max_seconds, args.output_dir, args.expect_stop)
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())

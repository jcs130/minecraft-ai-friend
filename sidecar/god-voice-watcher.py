# -*- coding: utf-8 -*-
"""
god-voice-watcher.py —— 天音中继:女神侧文本任务 → edge-tts mp3 → god-voice mod 队列。

链路(2026-08-29 天音接线):
  女神容器(shadow-world) goddessSayPublic 写文本任务
    → ops/docker/shadow/mc/data/godvoice/text-queue/<id>.json
       {"id","entity","text","voice"(角色名)}
  本 watcher(宿主,god-voice venv)轮询 0.6s:
    edge-tts 合成 mp3 → tts-queue/<id>.mp3 + mod 任务 <id>.json
      {"id","entity","file":"data/godvoice/tts-queue/<id>.mp3","text","voice"(edge音色)}
    → god-voice mod TtsQueueWatcher 消费 → SVC EntityAudioChannel 在实体头顶播放
  合成失败的任务改名 .err 防死循环重试。

启动: Start-Process god-voice venv python -WindowStyle Hidden
"""
import asyncio
import json
import sys
import time
import traceback
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = Path(__file__).resolve().parent          # sidecar/
ROOT = BASE.parent / "ops" / "docker" / "shadow" / "mc" / "data" / "godvoice"
TEXT_Q = ROOT / "text-queue"
TTS_Q = ROOT / "tts-queue"
PID_FILE = Path(__file__).with_suffix(".pid")

VOICES = {
    "goddess": "zh-CN-XiaoxiaoNeural",   # 女神/旁白:温柔女声
    "kirito": "zh-CN-YunjianNeural",     # 桐人:沉稳男声
    "naruto": "zh-CN-YunxiNeural",       # 鸣人:少年活力
    "villager": "zh-CN-XiaoyiNeural",    # 村民/孩童向
}


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


async def synth(text: str, voice: str, out: Path) -> None:
    import edge_tts
    tts = edge_tts.Communicate(text, voice)
    await tts.save(str(out))


def main() -> int:
    TEXT_Q.mkdir(parents=True, exist_ok=True)
    TTS_Q.mkdir(parents=True, exist_ok=True)
    PID_FILE.write_text(str(time.time()), encoding="ascii")
    log(f"god-voice-watcher armed: text-queue={TEXT_Q}")

    while True:
        try:
            for f in sorted(TEXT_Q.glob("*.json")):
                try:
                    job = json.loads(f.read_text(encoding="utf-8"))
                    role = str(job.get("voice") or "goddess")
                    voice = VOICES.get(role, VOICES["goddess"])
                    text = str(job.get("text") or "").strip()[:220]
                    entity = str(job.get("entity") or "")
                    jid = str(job.get("id") or f"{int(time.time()*1000)}")
                    if not text or not entity:
                        raise ValueError("empty text/entity")
                    mp3 = TTS_Q / f"{jid}.mp3"
                    asyncio.run(synth(text, voice, mp3))
                    if not mp3.is_file() or mp3.stat().st_size == 0:
                        raise RuntimeError("empty mp3")
                    modjob = {
                        "id": jid,
                        "entity": entity,
                        "file": f"data/godvoice/tts-queue/{mp3.name}",
                        "text": text,
                        "voice": voice,
                    }
                    (TTS_Q / f"{jid}.json").write_text(
                        json.dumps(modjob, ensure_ascii=False), encoding="utf-8"
                    )
                    log(f"tts queued {jid} {mp3.stat().st_size}B role={role} text={text[:30]}")
                except Exception as e:
                    log(f"job {f.name} failed: {e}")
                    try:
                        f.rename(f.with_suffix(".err"))
                    except OSError:
                        pass
                else:
                    try:
                        f.unlink()
                    except OSError:
                        pass
        except Exception:
            traceback.print_exc()
        time.sleep(0.6)


if __name__ == "__main__":
    raise SystemExit(main())

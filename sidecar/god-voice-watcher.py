# -*- coding: utf-8 -*-
"""
god-voice-watcher.py —— 天音中继：女神侧文本任务 → edge-tts mp3 → god-voice mod 队列。

链路（2026-08-31 进程收编 docker：本文件即 shadow-voice 容器主程序）：
  女神容器(shadow-world) goddessSayPublic 写文本任务
    → <GV_BASE>/text-queue/<id>.json  {"id","entity","text","voice"(角色名)}
  本 watcher 轮询：edge-tts 合成 mp3 → tts-queue/<id>.mp3 + mod 任务 <id>.json
    → god-voice mod TtsQueueWatcher 消费 → SVC EntityAudioChannel 在实体头顶播放
  合成失败的任务改名 .err 防死循环重试。
认领防双投（同 shadow-asr 姊妹坑）：任务先 rename 进 text-queue/.claimed/ 再合成。
"""
import asyncio
import json
import os
import subprocess
import sys
import time
import traceback
import urllib.parse
import urllib.request
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# 路径参数化：容器 env 注入；无 env 回退 B 仓宿主路径（渡备用）
_DEFAULT_ROOT = (Path(__file__).resolve().parent.parent
                 / "ops" / "docker" / "shadow" / "mc" / "data" / "godvoice")
ROOT = Path(os.environ.get("GV_BASE", str(_DEFAULT_ROOT)))
TEXT_Q = ROOT / "text-queue"
CLAIM_Q = TEXT_Q / ".claimed"
TTS_Q = ROOT / "tts-queue"

VOICES = {
    "goddess": "zh-CN-XiaoxiaoNeural",   # 女神/旁白：温柔女声（edge 回退嗓）
    "kirito": "zh-CN-YunjianNeural",     # 桐人：沉稳男声
    "naruto": "zh-CN-YunxiNeural",       # 鸣人：少年活力
    "villager": "zh-CN-XiaoyiNeural",    # 村民/孩童向
}

# 神语阁（shadow-tts / IndexTTS 2.5 本地克隆嗓）：优先走它，失败回退 edge-tts。
# role 名即 /voices/<role>.wav 嗓子文件名；缺嗓 404 自动回退，平滑迁移。
TTS_LOCAL_URL = os.environ.get("TTS_LOCAL_URL", "").rstrip("/")


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def synth_local(text: str, role: str, mp3: Path) -> None:
    """本地 TTS 合成 wav → ffmpeg 转 mp3（SVC mod 队列认 mp3）。失败抛异常。"""
    if not TTS_LOCAL_URL:
        raise RuntimeError("tts-local disabled")
    qs = urllib.parse.urlencode({"text": text, "voice": role})
    with urllib.request.urlopen(f"{TTS_LOCAL_URL}/tts?{qs}", timeout=90) as r:
        wav = r.read()
    if not wav:
        raise RuntimeError("tts-local empty response")
    tmp = mp3.with_suffix(".local.wav")
    tmp.write_bytes(wav)
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
             "-i", str(tmp), "-codec:a", "libmp3lame", "-qscale:a", "3", str(mp3)],
            check=True, timeout=30,
        )
    finally:
        try:
            tmp.unlink()
        except OSError:
            pass


async def synth(text: str, voice: str, out: Path) -> None:
    import edge_tts
    tts = edge_tts.Communicate(text, voice)
    await tts.save(str(out))


def main() -> int:
    for d in (TEXT_Q, CLAIM_Q, TTS_Q):
        d.mkdir(parents=True, exist_ok=True)
    log(f"god-voice-watcher armed (edge-tts): text-queue={TEXT_Q}")

    while True:
        try:
            for f in sorted(TEXT_Q.glob("*.json")):
                # 认领：抢进 .claimed/ 才算拿到（多实例并存杜绝双合成双播）
                claimed = CLAIM_Q / f.name
                try:
                    f.rename(claimed)
                except OSError:
                    continue
                try:
                    job = json.loads(claimed.read_text(encoding="utf-8"))
                    role = str(job.get("voice") or "goddess")
                    voice = VOICES.get(role, VOICES["goddess"])
                    text = str(job.get("text") or "").strip()[:220]
                    entity = str(job.get("entity") or "")
                    jid = str(job.get("id") or f"{int(time.time()*1000)}")
                    if not text or not entity:
                        raise ValueError("empty text/entity")
                    mp3 = TTS_Q / f"{jid}.mp3"
                    engine = "edge"
                    try:
                        synth_local(text, role, mp3)
                        engine = "local"
                    except Exception as le:
                        log(f"tts-local miss {jid}: {le}; fallback edge-tts")
                        asyncio.run(synth(text, voice, mp3))
                    if not mp3.is_file() or mp3.stat().st_size == 0:
                        raise RuntimeError("empty mp3")
                    modjob = {
                        "id": jid,
                        "entity": entity,
                        "file": f"data/godvoice/tts-queue/{mp3.name}",
                        "text": text,
                        "voice": voice,
                        "engine": engine,
                    }
                    (TTS_Q / f"{jid}.json").write_text(
                        json.dumps(modjob, ensure_ascii=False), encoding="utf-8"
                    )
                    log(f"tts queued {jid} {mp3.stat().st_size}B role={role} "
                        f"engine={engine} text={text[:30]}")
                except Exception as e:
                    log(f"job {f.name} failed: {e}")
                    try:
                        claimed.rename(claimed.with_suffix(".err"))
                    except OSError:
                        pass
                else:
                    try:
                        claimed.unlink()
                    except OSError:
                        pass
            # .claimed 里超 5 分钟的遗留（崩溃丢的）放回重试
            for st in CLAIM_Q.glob("*.json"):
                try:
                    if time.time() - st.stat().st_mtime > 300:
                        st.rename(TEXT_Q / st.name)
                except OSError:
                    pass
        except Exception:
            traceback.print_exc()
        time.sleep(0.6)


if __name__ == "__main__":
    raise SystemExit(main())

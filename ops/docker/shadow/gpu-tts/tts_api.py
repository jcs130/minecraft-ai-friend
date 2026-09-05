# -*- coding: utf-8 -*-
"""神语阁 API — IndexTTS 2.5 本地克隆 TTS（2026-08-31 首建）。

GET /tts?text=...&voice=goddess&lang=ZH&emo=happy:0.6&speed=1.0          -> wav
GET /tts?...&format=mp3                                                  -> mp3（直出，voice 侧零 ffmpeg）
GET /voices   -> 可用嗓子列表
GET /health   -> 就绪探针
"""
import os
import threading
import uuid

os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse

CKPT_DIR = os.environ.get("TTS_CKPT", "/checkpoints")
VOICE_DIR = os.environ.get("TTS_VOICES", "/voices")
DEFAULT_VOICE = os.environ.get("TTS_DEFAULT_VOICE", "goddess")

EMO_ORDER = ["happy", "angry", "sad", "afraid",
             "disgusted", "melancholic", "surprised", "calm"]

app = FastAPI(title="shenyuge-tts")
_tts = None
_lock = threading.Lock()


def _parse_emo(s: str):
    """'happy:0.6,calm:0.3' 或 '0,0,0.8,0,0,0,0,0' -> 8 维向量或 None。"""
    if not s:
        return None
    s = s.strip()
    if ":" in s:
        vec = [0.0] * 8
        for part in s.split(","):
            part = part.strip()
            if not part:
                continue
            name, _, val = part.partition(":")
            name = name.strip().lower()
            if name not in EMO_ORDER:
                raise HTTPException(400, f"unknown emo '{name}'; use {EMO_ORDER}")
            vec[EMO_ORDER.index(name)] = float(val)
        return vec
    try:
        vec = [float(x) for x in s.split(",")]
    except ValueError:
        raise HTTPException(400, "emo must be 'name:alpha,...' or 8 floats")
    if len(vec) != 8:
        raise HTTPException(400, "emo vector needs 8 floats: " + ",".join(EMO_ORDER))
    return vec


def _voice_path(voice: str) -> str:
    name = voice if voice.endswith((".wav", ".mp3")) else voice + ".wav"
    p = os.path.join(VOICE_DIR, os.path.basename(name))
    if not os.path.isfile(p):
        avail = sorted(f for f in os.listdir(VOICE_DIR) if f.endswith(".wav")) \
            if os.path.isdir(VOICE_DIR) else []
        raise HTTPException(404, f"voice '{voice}' not found; have: {avail}")
    return p


@app.on_event("startup")
def _boot():
    global _tts
    from indextts.infer_v2_5 import IndexTTS2
    _tts = IndexTTS2(cfg_path=os.path.join(CKPT_DIR, "config.yaml"),
                     model_dir=CKPT_DIR, use_bf16=True)
    # 预热一次，首次真实请求不吃加载延迟
    try:
        spk = _voice_path(DEFAULT_VOICE)
        _tts.infer(spk_audio_prompt=spk, text="神谕预热。", lang="ZH",
                   output_path="/tmp/warmup.wav", verbose=False)
    except HTTPException:
        pass  # 嗓子目录还没备好也不拦启动
    except Exception as e:
        print("[warmup] skipped:", e)


def _wav_to_mp3(wav_path: str, mp3_path: str) -> str:
    """wav(16-bit PCM) -> mp3 128kbps。lameenc 纯 python 轮子，无 ffmpeg 依赖。"""
    import wave
    import lameenc
    with wave.open(wav_path, "rb") as w:
        nch, rate = w.getnchannels(), w.getframerate()
        pcm = w.readframes(w.getnframes())
    enc = lameenc.Encoder()
    enc.set_bit_rate(128)
    enc.set_in_sample_rate(rate)
    enc.set_channels(nch)
    enc.set_quality(2)
    data = enc.encode(bytes(pcm)) + enc.flush()
    with open(mp3_path, "wb") as f:
        f.write(data)
    return mp3_path


@app.get("/tts")
def tts(text: str, voice: str = DEFAULT_VOICE, lang: str = "ZH",
        emo: str = "", speed: float = 1.0, emo_alpha: float = 1.0,
        format: str = "wav",
        text_lang: str = "", ref_audio_path: str = "",
        prompt_lang: str = "", prompt_text: str = "",
        text_split_method: str = "", streaming: bool = False,
        aux_ref_audio_paths: str = "", media_type: str = "wav",
        cut5: str = ""):
    # ── GPT-SoVITS 兼容层（2026-09-06：TLM 女仆 tts.json api_type=gpt-sovits 直连本阁）─
    # TLM 以 GPT-SoVITS v2 格式调用：text/text_lang/ref_audio_path/prompt_lang…
    # 本阁按自家参数合成；ref_audio_path 若指向 /voices 下的嗓子则采纳。
    if text_lang:
        tl = text_lang.lower()
        lang = "ZH" if tl in ("zh", "zh-cn", "chinese", "中文") else lang.upper()
    if ref_audio_path:
        base = os.path.basename(ref_audio_path)
        cand = os.path.splitext(base)[0]
        if os.path.isfile(os.path.join(VOICE_DIR, cand + ".wav")) or \
           os.path.isfile(os.path.join(VOICE_DIR, base)):
            voice = cand
    if not text.strip():
        raise HTTPException(400, "empty text")
    spk = _voice_path(voice)
    emo_vec = _parse_emo(emo)
    out = f"/tmp/{uuid.uuid4().hex}.wav"
    kw = dict(spk_audio_prompt=spk, text=text, lang=lang,
              output_path=out, verbose=False,
              duration_factor=max(0.5, min(2.0, float(speed))))
    if emo_vec is not None:
        kw["emo_vector"] = emo_vec
        kw["emo_alpha"] = max(0.0, min(1.0, float(emo_alpha)))
    with _lock:
        _tts.infer(**kw)
    if not os.path.isfile(out):
        raise HTTPException(500, "synthesis produced no file")
    if format.lower() == "mp3":
        mp3 = out[:-4] + ".mp3"
        try:
            _wav_to_mp3(out, mp3)
        except Exception as e:
            raise HTTPException(500, f"mp3 encode failed: {e}")
        finally:
            os.unlink(out)
        return FileResponse(mp3, media_type="audio/mpeg",
                            filename=os.path.basename(mp3))
    return FileResponse(out, media_type="audio/wav", filename=os.path.basename(out))


@app.get("/voices")
def voices():
    if not os.path.isdir(VOICE_DIR):
        return {"voices": []}
    return {"voices": sorted(f[:-4] for f in os.listdir(VOICE_DIR)
                             if f.endswith(".wav")),
            "emotions": EMO_ORDER}


@app.get("/health")
def health():
    return {"ok": _tts is not None}


if __name__ == "__main__":
    import uvicorn
    # 宿主常驻版只听回环（TTS_HOST=127.0.0.1）；容器版默认全网卡
    uvicorn.run(app, host=os.environ.get("TTS_HOST", "0.0.0.0"),
                port=int(os.environ.get("TTS_PORT", "8100")))

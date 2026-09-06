# -*- coding: utf-8 -*-
"""stt_gateway.py —— TLM STT 网关（whisper/openai 兼容端点，本地 paraformer-small）。

为 TLM（车万女仆）1.5.3 的 STT（按住键说话→AI 聊天）提供零云费通道：
TLM 客户端把录音 POST 到 /v1/audio/transcription（multipart form，file 字段），
本网关用 sherpa-onnx paraformer-small（CPU int8，82MB）转写，回 {"text": "..."}。

部署：compose 服务 stt-gateway（端口 4322），模型 bind 只读复用天耳同款。
TLM 侧：config/touhou_little_maid/sites/stt.json 加 siliconflow 条目，
url 指本机局域网 http://192.168.3.133:4322/v1/audio/transcription 即可。
2026-09-06 为萌萌（5 岁语音玩家）与女仆 AI 聊天而立。
"""
import io
import os
import time
import wave

import numpy as np
import sherpa_onnx
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.responses import JSONResponse
import uvicorn

MODEL_DIR = os.environ.get('ASR_MODEL_DIR', '/model')
LISTEN = os.environ.get('STT_LISTEN', '0.0.0.0:4322')

print(f"[stt-gateway] loading paraformer from {MODEL_DIR} ...", flush=True)
_t0 = time.time()
REC = sherpa_onnx.OfflineRecognizer.from_paraformer(
    paraformer=os.path.join(MODEL_DIR, 'model.int8.onnx'),
    tokens=os.path.join(MODEL_DIR, 'tokens.txt'),
    num_threads=2,
    sample_rate=16000,
    feature_dim=80,
    decoding_method='greedy_search',
)
print(f"[stt-gateway] model ready in {time.time()-_t0:.1f}s", flush=True)

app = FastAPI()


def transcribe_pcm16(pcm: bytes, sample_rate: int) -> str:
    """int16 PCM bytes → 文本（非 16k 先走 sherpa 重采样）。"""
    import array
    data = array.array('h')
    data.frombytes(pcm)
    if len(data) == 0:
        return ""
    stream = REC.create_stream()
    stream.accept_waveform(sample_rate, data.tolist())
    REC.decode_stream(stream)
    return (stream.result.text or "").strip()


def sniff_and_decode(raw: bytes) -> tuple[np.ndarray, int]:
    """wav → (int16 ndarray, sample_rate)；裸 PCM 按 16k 处理。"""
    try:
        with wave.open(io.BytesIO(raw), 'rb') as w:
            sr = w.getframerate()
            nch = w.getnchannels()
            sw = w.getsampwidth()
            frames = w.readframes(w.getnframes())
        if sw != 2:
            raise ValueError(f"sampwidth={sw}")
        arr = np.frombuffer(frames, dtype=np.int16)
        if nch > 1:
            arr = arr.reshape(-1, nch).mean(axis=1).astype(np.int16)
        return arr, sr
    except Exception:
        return np.frombuffer(raw, dtype=np.int16), 16000


@app.get("/health")
async def health():
    return {"ok": True, "model": "paraformer-small-int8"}


@app.post("/v1/audio/transcription")
async def transcription(file: UploadFile = File(...), model: str = Form(default="")):
    raw = await file.read()
    if len(raw) < 1600:  # <50ms 音频，视作误触
        return JSONResponse({"text": "", "dur_ms": 0})
    t0 = time.time()
    arr, sr = sniff_and_decode(raw)
    if sr != 16000:
        import numpy as _np
        dur = len(arr) / sr
        arr = _np.interp(
            _np.arange(int(dur * 16000)) * sr / 16000,
            _np.arange(len(arr)), arr.astype(_np.float64)).astype(_np.int16)
    stream = REC.create_stream()
    stream.accept_waveform(16000, arr.tolist())
    REC.decode_stream(stream)
    text = (stream.result.text or "").strip()
    ms = int((time.time() - t0) * 1000)
    print(f"[stt-gateway] {file.filename or ''} {len(raw)}B {ms}ms -> {text!r}", flush=True)
    return JSONResponse({"text": text, "dur_ms": ms, "model": "paraformer-small"})


if __name__ == '__main__':
    host, port = LISTEN.rsplit(':', 1)
    uvicorn.run(app, host=host, port=int(port), log_level='info')

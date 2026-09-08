"""IndexTTS 2.5 HTTP adapter; models/reference audio stay in local runtime data.

GET /tts keeps its WAV/default and format=mp3 contract. POST /tts remains WAV.
POST /tts/maid accepts the TLM GPT-SoVITS JSON shape and always returns MP3:
TLM 1.5.3's MPEG reader rejects PCM WAV, even though Java AudioSystem knows WAV.
No endpoint calls a language model, streams partial speech, or plays audio.
"""
from __future__ import annotations

import math
import os
from pathlib import Path
import tempfile
import threading
import wave

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse

CKPT_DIR = os.environ.get("TTS_CKPT", "/checkpoints")
VOICE_DIR = os.environ.get("TTS_VOICES", "/voices")
DEFAULT_VOICE = os.environ.get("TTS_DEFAULT_VOICE", "goddess")
TMP_DIR = os.environ.get("TTS_TMP", tempfile.gettempdir())
MAX_TEXT_CHARS = 600
MAX_BODY_BYTES = 32768
EMO_ORDER = ["happy", "angry", "sad", "afraid", "disgusted", "melancholic", "surprised", "calm"]
_tts = None
_lock = threading.Lock()


class BodyLimit:
    """Bound JSON before FastAPI parses it, including chunked requests."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] != "POST":
            return await self.app(scope, receive, send)
        body = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            body.extend(message.get("body", b""))
            if len(body) > MAX_BODY_BYTES:
                return await JSONResponse({"detail": "request body too large"}, 413)(scope, receive, send)
            if not message.get("more_body", False):
                break
        pending = True

        async def replay():
            nonlocal pending
            if pending:
                pending = False
                return {"type": "http.request", "body": bytes(body), "more_body": False}
            return await receive()

        await self.app(scope, replay, send)


class EphemeralAudio(FileResponse):
    """Clean our one request directory after sending, also on disconnect/error."""
    def __init__(self, path: Path, directory, media_type: str):
        super().__init__(path, media_type=media_type, filename=path.name)
        self.directory = directory

    async def __call__(self, scope, receive, send):
        try:
            await super().__call__(scope, receive, send)
        finally:
            self.directory.cleanup()


app = FastAPI(title="qiandeng-tts")
app.add_middleware(BodyLimit)


def _string(value, name: str, limit: int, *, empty: bool = True) -> str:
    if not isinstance(value, str) or len(value) > limit:
        raise HTTPException(400, f"{name} must be a string of at most {limit} characters")
    if "\x00" in value or (not empty and not value.strip()):
        raise HTTPException(400, f"invalid or empty {name}")
    return value


def _finite(value: float, name: str) -> float:
    try:
        if not math.isfinite(value):
            raise ValueError()
        return float(value)
    except (ValueError, TypeError, OverflowError):
        raise HTTPException(400, f"{name} must be finite") from None


def _parse_emo(value: str):
    value = _string(value, "emo", 256).strip()
    if not value:
        return None
    try:
        if ":" in value:
            vector = [0.0] * 8
            for part in value.split(","):
                if not part.strip():
                    continue
                name, alpha = part.split(":", 1)
                vector[EMO_ORDER.index(name.strip().lower())] = float(alpha)
        else:
            vector = [float(part) for part in value.split(",")]
        if len(vector) != 8 or any(not math.isfinite(n) or not 0 <= n <= 1 for n in vector):
            raise ValueError()
        return vector
    except (ValueError, OverflowError):
        raise HTTPException(400, "emo requires known names or 8 finite values in [0,1]") from None


def _voice_path(voice: str) -> str:
    voice = _string(voice, "voice", 128, empty=False)
    # Legacy callers can send an absolute reference path; it is only a local
    # basename lookup, never a path to read outside the configured voices root.
    name = voice.replace("\\", "/").rsplit("/", 1)[-1]
    name = name if name.endswith((".wav", ".mp3")) else name + ".wav"
    root = Path(VOICE_DIR).resolve()
    path = root / name
    if not path.is_file() or not path.resolve().is_relative_to(root):
        raise HTTPException(404, "reference voice not found")
    return str(path)


def _reference(ref: str, voice: str, *, strict: bool = False) -> str:
    ref = _string(ref, "ref_audio_path", 512)
    if not ref:
        return voice
    base = ref.replace("\\", "/").rsplit("/", 1)[-1]
    candidate = os.path.splitext(base)[0]
    for name in (candidate + ".wav", base):
        try:
            _voice_path(name)
            return name
        except HTTPException as error:
            if error.status_code != 404:
                raise
    if strict:
        raise HTTPException(404, "requested reference voice not found")
    return voice  # Existing GET/POST /tts fallback semantics.


def _wav_to_mp3(wav_path: Path, mp3_path: Path) -> None:
    import lameenc
    with wave.open(str(wav_path), "rb") as source:
        channels, rate = source.getnchannels(), source.getframerate()
        if source.getsampwidth() != 2 or channels not in (1, 2) or not 8000 <= rate <= 48000:
            raise ValueError("Expected 16-bit mono/stereo PCM WAV")
        if source.getnframes() > rate * 300:
            raise ValueError("Unexpectedly long synthesized audio")
        encoder = lameenc.Encoder()
        encoder.set_bit_rate(128)
        encoder.set_in_sample_rate(rate)
        encoder.set_channels(channels)
        encoder.set_quality(2)
        with mp3_path.open("xb") as destination:
            while pcm := source.readframes(65536):
                destination.write(encoder.encode(pcm))
            destination.write(encoder.flush())


def _render(text: str, voice: str, lang: str, *, mp3: bool = False, **options):
    text = _string(text, "text", MAX_TEXT_CHARS, empty=False)
    lang = _string(lang, "lang", 32, empty=False)
    spk = _voice_path(voice)
    if _tts is None:
        raise HTTPException(503, "synthesizer not ready")
    # A bounded queue protects GPU work; callers receive a clear busy result,
    # not a success receipt or an unbounded thread waiting for another request.
    if not _lock.acquire(timeout=2):
        raise HTTPException(429, "synthesizer busy", headers={"Retry-After": "3"})
    directory = None
    try:
        directory = tempfile.TemporaryDirectory(prefix="qd-tts-", dir=TMP_DIR)
        wav_path = Path(directory.name) / "speech.wav"
        _tts.infer(spk_audio_prompt=spk, text=text, lang=lang,
                   output_path=str(wav_path), verbose=False, **options)
        if not wav_path.is_file() or wav_path.stat().st_size <= 44:
            raise RuntimeError("Synthesis produced no audio")
        output = wav_path
        if mp3:
            output = wav_path.with_suffix(".mp3")
            _wav_to_mp3(wav_path, output)
            wav_path.unlink()
        return EphemeralAudio(output, directory, "audio/mpeg" if mp3 else "audio/wav")
    except Exception:
        if directory is not None:
            directory.cleanup()
        # Do not echo engine exceptions containing private utterances or paths.
        raise HTTPException(500, "speech synthesis or encoding failed") from None
    finally:
        _lock.release()


@app.on_event("startup")
def _boot():
    global _tts
    from indextts.infer_v2_5 import IndexTTS2
    _tts = IndexTTS2(cfg_path=os.path.join(CKPT_DIR, "config.yaml"),
                     model_dir=CKPT_DIR, use_bf16=True)
    if os.environ.get("TTS_WARMUP", "1") != "0":
        try:
            # Warmup is local only and leaves no generated speech behind.
            with tempfile.TemporaryDirectory(prefix="qd-tts-warmup-", dir=TMP_DIR) as temporary:
                _tts.infer(spk_audio_prompt=_voice_path(DEFAULT_VOICE), text="神谕预热。",
                           lang="ZH", output_path=str(Path(temporary) / "warmup.wav"), verbose=False)
        except Exception:
            print("[warmup] skipped")


@app.get("/tts")
def tts(text: str, voice: str = DEFAULT_VOICE, lang: str = "ZH",
        emo: str = "", speed: float = 1.0, emo_alpha: float = 1.0,
        format: str = "wav", text_lang: str = "", ref_audio_path: str = "",
        prompt_lang: str = "", prompt_text: str = "", text_split_method: str = "",
        streaming: bool = False, aux_ref_audio_paths: str = "", media_type: str = "wav", cut5: str = ""):
    if text_lang:
        tl = _string(text_lang, "text_lang", 32).lower()
        lang = "ZH" if tl in ("zh", "zh-cn", "chinese", "中文") else lang.upper()
    voice = _reference(ref_audio_path, voice)
    options = {"duration_factor": max(0.5, min(2.0, _finite(speed, "speed")))}
    vector = _parse_emo(emo)
    alpha = _finite(emo_alpha, "emo_alpha")
    if vector is not None:
        options.update(emo_vector=vector, emo_alpha=max(0.0, min(1.0, alpha)))
    return _render(text, voice, lang, mp3=format.lower() == "mp3", **options)


def _post(payload: dict, *, maid: bool):
    text = _string(payload.get("text", ""), "text", MAX_TEXT_CHARS, empty=False).strip()
    ref = payload.get("ref_audio_path") or ""
    voice = _reference(ref, DEFAULT_VOICE, strict=maid)
    tl = _string(payload.get("text_lang") or "", "text_lang", 32).lower()
    lang = "ZH" if tl in ("zh", "zh-cn", "chinese", "中文") else tl.upper() or "ZH"
    # GPT-SoVITS prompt/splitting/media_type/streaming fields remain accepted.
    # IndexTTS uses the local reference itself; responses are complete files.
    return _render(text, voice, lang, mp3=maid)


@app.post("/tts")
def tts_post(payload: dict):
    return _post(payload, maid=False)


@app.post("/tts/maid")
def tts_maid(payload: dict):
    return _post(payload, maid=True)


@app.get("/voices")
def voices():
    if not os.path.isdir(VOICE_DIR):
        return {"voices": []}
    return {"voices": sorted(p.stem for p in Path(VOICE_DIR).glob("*.wav") if p.is_file()), "emotions": EMO_ORDER}


@app.get("/health")
def health():
    return {"ok": _tts is not None, "apiVersion": 2, "maidEndpoint": "/tts/maid",
            "maidMediaType": "audio/mpeg", "maxTextChars": MAX_TEXT_CHARS}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=os.environ.get("TTS_HOST", "0.0.0.0"),
                port=int(os.environ.get("TTS_PORT", "8100")), access_log=False)

"""Durable Drama 3 voice registration with one-time native reference encoding."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import io
import json
import os
from pathlib import Path
import re
import threading
import uuid
import wave


VOICE_ID = re.compile(r"^[a-z][a-z0-9_-]{0,31}$")
BUILTINS = ("none", "kirito", "yui", "cast")
MAX_UPLOAD_BYTES = 16 * 1024 * 1024
MIN_DURATION = 3.0
MAX_DURATION = 20.0
SCHEMA_VERSION = 1


class ConflictError(ValueError):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _file_sha(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _atomic(path: Path, data: bytes) -> None:
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    try:
        with temporary.open("xb") as target:
            target.write(data)
            target.flush()
            os.fsync(target.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _audio_info(audio: bytes) -> dict:
    if not audio or len(audio) > MAX_UPLOAD_BYTES:
        raise ValueError(f"audio must be a WAVE file of at most {MAX_UPLOAD_BYTES} bytes")
    try:
        with wave.open(io.BytesIO(audio), "rb") as source:
            channels, width, rate, frames = (
                source.getnchannels(), source.getsampwidth(), source.getframerate(), source.getnframes()
            )
            decoded_bytes = len(source.readframes(frames))
    except (wave.Error, EOFError) as exc:
        raise ValueError("audio must be an uncompressed PCM WAVE file") from exc
    if channels not in (1, 2) or width not in (2, 3, 4) or not (8000 <= rate <= 96000):
        raise ValueError("audio must be 16/24/32-bit PCM WAV, mono/stereo, 8–96 kHz")
    if decoded_bytes != frames * channels * width:
        raise ValueError("audio WAVE data is incomplete")
    duration = frames / rate
    if not (MIN_DURATION <= duration <= MAX_DURATION):
        raise ValueError(f"audio duration must be {MIN_DURATION:g}–{MAX_DURATION:g} seconds")
    return {"channels": channels, "sample_width_bits": 8 * width,
            "sample_rate": rate, "frames": frames, "duration_seconds": round(duration, 3)}


class VoiceRegistry:
    def __init__(self, root: Path, engine: object) -> None:
        self.root = Path(root)
        self.engine = engine
        self.root.mkdir(parents=True, exist_ok=True)
        self._entries: dict[str, dict] = {}
        self._lock = threading.RLock()
        self._workers = ThreadPoolExecutor(max_workers=1, thread_name_prefix="drama3-voice")

    def close(self) -> None:
        self._workers.shutdown(wait=True)

    def _folder(self, voice_id: str) -> Path:
        return self.root / voice_id

    def _save(self, entry: dict) -> None:
        _atomic(self._folder(entry["voice_id"]) / "manifest.json",
                json.dumps(entry, ensure_ascii=False, indent=2).encode("utf-8") + b"\n")

    @staticmethod
    def _builtin(voice_id: str) -> dict:
        return {"voice_id": voice_id, "model": "drama-3", "status": "ready",
                "source": "built_in", "error": None, "schema_version": SCHEMA_VERSION}

    def get(self, voice_id: str) -> dict | None:
        with self._lock:
            if voice_id in BUILTINS:
                return self._builtin(voice_id)
            item = self._entries.get(voice_id)
            return json.loads(json.dumps(item)) if item else None

    def list(self) -> list[dict]:
        with self._lock:
            return [self._builtin(item) for item in BUILTINS] + [
                json.loads(json.dumps(self._entries[key])) for key in sorted(self._entries)
            ]

    def register(self, voice_id: str, audio: bytes, reference_text: str) -> dict:
        if not isinstance(voice_id, str) or not VOICE_ID.fullmatch(voice_id):
            raise ValueError("voice_id must match [a-z][a-z0-9_-]{0,31}")
        if not isinstance(reference_text, str) or not reference_text.strip():
            raise ValueError("reference_text is required and must be the exact spoken transcript")
        if len(reference_text.encode("utf-8")) > 4096:
            raise ValueError("reference_text exceeds 4096 UTF-8 bytes")
        info = _audio_info(audio)
        with self._lock:
            folder = self._folder(voice_id)
            if voice_id in BUILTINS or voice_id in self._entries or folder.exists():
                raise ConflictError(f'voice_id "{voice_id}" already exists; use a new ID for a new reference')
            folder.mkdir()
            now = _now()
            entry = {"voice_id": voice_id, "model": "drama-3", "status": "pending",
                     "source": "reference_audio", "error": None, "schema_version": SCHEMA_VERSION,
                     "engine_version": self.engine.version, "voice_codec": self.engine.codec,
                     "created_at": now, "updated_at": now,
                     "reference": {**info, "sha256": _sha(audio),
                                   "text_sha256": _sha(reference_text.encode("utf-8")),
                                   "text_characters": len(reference_text)},
                     "voice_file_sha256": None}
            # The pending record comes first, so an interrupted write remains visible on restart.
            try:
                self._save(entry)
                _atomic(folder / "reference.wav", audio)
                _atomic(folder / "reference.txt", reference_text.encode("utf-8"))
            except Exception as exc:
                entry.update(status="failed", error=f"reference persistence failed: {exc}", updated_at=_now())
                self._entries[voice_id] = entry
                self._save(entry)
                raise
            self._entries[voice_id] = entry
            result = json.loads(json.dumps(entry))
        self._workers.submit(self._encode_and_add, voice_id)
        return result

    def recover(self) -> None:
        """Load cached GGUF voices; resume only unfinished registrations."""
        with self._lock:
            for folder in sorted(self.root.iterdir()):
                if not folder.is_dir() or not VOICE_ID.fullmatch(folder.name) or folder.name in BUILTINS:
                    continue
                manifest = folder / "manifest.json"
                try:
                    entry = json.loads(manifest.read_text(encoding="utf-8"))
                    if entry.get("voice_id") != folder.name or entry.get("schema_version") != SCHEMA_VERSION:
                        raise ValueError("unsupported or mismatched manifest version")
                except (OSError, ValueError, json.JSONDecodeError) as exc:
                    entry = {"voice_id": folder.name, "model": "drama-3", "status": "failed",
                             "source": "reference_audio", "schema_version": SCHEMA_VERSION,
                             "error": f"registry manifest unreadable: {exc}",
                             "created_at": _now(), "updated_at": _now()}
                    self._save(entry)
                self._entries[folder.name] = entry
                if entry["status"] == "ready":
                    try:
                        self._verify(entry, ready=True)
                        self.engine.add_voice(folder.name, folder / "voice.gguf")
                    except Exception as exc:
                        self._fail(folder.name, f"cached voice could not be loaded: {exc}")
                elif entry["status"] == "pending":
                    self._workers.submit(self._encode_and_add, folder.name)
                elif entry["status"] != "failed":
                    self._fail(folder.name, "invalid voice status in manifest")

    def _verify(self, entry: dict, *, ready: bool = False) -> None:
        folder = self._folder(entry["voice_id"])
        if entry.get("voice_codec") != self.engine.codec:
            raise ValueError("reference voice codec differs from loaded Drama 3 model")
        if _file_sha(folder / "reference.wav") != entry["reference"]["sha256"]:
            raise ValueError("reference audio SHA-256 mismatch")
        if _file_sha(folder / "reference.txt") != entry["reference"]["text_sha256"]:
            raise ValueError("reference transcript SHA-256 mismatch")
        if ready and _file_sha(folder / "voice.gguf") != entry["voice_file_sha256"]:
            raise ValueError("encoded GGUF SHA-256 mismatch")

    def _fail(self, voice_id: str, reason: str) -> None:
        with self._lock:
            entry = self._entries[voice_id]
            entry.update(status="failed", error=reason[:2000], updated_at=_now())
            self._save(entry)

    def _encode_and_add(self, voice_id: str) -> None:
        folder = self._folder(voice_id)
        final = folder / "voice.gguf"
        partial = folder / "voice.gguf.part"
        try:
            with self._lock:
                entry = self._entries[voice_id]
                self._verify(entry)
            if not final.exists():
                partial.unlink(missing_ok=True)
                transcript = (folder / "reference.txt").read_text(encoding="utf-8")
                self.engine.make_voice(folder / "reference.wav", transcript, partial)
                if not partial.is_file() or partial.stat().st_size < 1024:
                    raise RuntimeError("native encoder did not create a valid GGUF voice file")
                with partial.open("r+b") as output:
                    os.fsync(output.fileno())
                os.replace(partial, final)
            voice_sha = _file_sha(final)
            self.engine.add_voice(voice_id, final)
            with self._lock:
                entry.update(status="ready", error=None, updated_at=_now(), voice_file_sha256=voice_sha)
                self._save(entry)
        except Exception as exc:
            partial.unlink(missing_ok=True)
            self._fail(voice_id, f"{type(exc).__name__}: {exc}")

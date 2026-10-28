"""LAN gateway and supervised launcher for the tested WSL drama-rs runtime.

The native server owns the GPU on WSL loopback. This process owns the LAN port,
durable reference catalog and the speech.cpp compatibility routes.
"""

from __future__ import annotations

import argparse
import base64
from email import policy
from email.parser import BytesParser
import hashlib
from http.client import HTTPConnection
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import logging
import os
from pathlib import Path
import re
import secrets
import socket
import struct
import subprocess
import threading
import time
from urllib.parse import parse_qs, quote, urlsplit

from voice_registry import MAX_UPLOAD_BYTES, VOICE_ID, _audio_info


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_STATE = ROOT / "server" / "drama3-service"
MODEL = "/mnt/e/ai-models/drama3-compare-20261029/drama-rs/model"
BINARY = ("/mnt/e/ai-models/drama3-compare-20261029/drama-rs/"
          "drama-rs-v0.3.0-x86_64-unknown-linux-gnu/drama")
CUDA_LIBS = "/opt/drama3-compare-20261029/venv/lib/python3.12/site-packages/nvidia"
LIBRARY_PATH = ":".join(f"{CUDA_LIBS}/{part}/lib" for part in ("cuda_runtime", "cublas", "nvrtc"))
BACKEND_HOST, BACKEND_PORT = "127.0.0.1", 18121
SAMPLE_RATE = 44100
MAX_BODY = MAX_UPLOAD_BYTES + 16384
MAX_NEW = 2048
NATIVE_FIELDS = {"text", "voice", "voices", "stream", "split", "seed", "top_k", "top_p",
                 "temperature", "max_new"}
LEGACY_FIELDS = {"model", "input", "voice", "response_format", "stream_format", "seed",
                 "top_k", "top_p", "temperature", "max_new", "max_seconds"}
BUILTINS = ("none", "kirito", "yui", "cast")


class APIError(Exception):
    def __init__(self, status: int, message: str, *, param: str | None = None,
                 code: str = "invalid_request") -> None:
        super().__init__(message)
        self.status, self.param, self.code = status, param, code


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _win_to_wsl(path: Path) -> str:
    path = path.resolve()
    return f"/mnt/{path.drive[0].lower()}{path.as_posix()[2:]}"


def _atomic(path: Path, data: bytes) -> None:
    tmp = path.with_name(path.name + "." + secrets.token_hex(8) + ".tmp")
    try:
        with tmp.open("xb") as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


class VoiceStore:
    """Existing speech.cpp assets stay untouched; new references use a separate catalog."""

    def __init__(self, state: Path) -> None:
        self.state = state
        self.new_root = state / "drama-rs-voices"
        self.new_root.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.entries: dict[str, dict] = {}
        self._load()

    def _load(self) -> None:
        old = self.state / "voices"
        for folder in old.iterdir() if old.exists() else ():
            if not folder.is_dir() or not VOICE_ID.fullmatch(folder.name):
                continue
            try:
                entry = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
                if entry.get("status") != "ready":
                    self.entries[folder.name] = entry
                    continue
                audio = (folder / "reference.wav").read_bytes()
                transcript = (folder / "reference.txt").read_bytes()
                if (_sha(audio) != entry["reference"]["sha256"] or
                        _sha(transcript) != entry["reference"]["text_sha256"]):
                    raise ValueError("reference SHA-256 mismatch")
                self.entries[folder.name] = entry | {"runtime": "drama-rs"}
            except Exception as exc:
                self.entries[folder.name] = self._failed(folder.name, str(exc))
        for folder in self.new_root.iterdir():
            if not folder.is_dir() or not VOICE_ID.fullmatch(folder.name):
                continue
            try:
                entry = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
                audio = (folder / "reference.wav").read_bytes()
                transcript = (folder / "reference.txt").read_bytes()
                if (_sha(audio) != entry["reference"]["sha256"] or
                        _sha(transcript) != entry["reference"]["text_sha256"]):
                    raise ValueError("reference SHA-256 mismatch")
                if entry.get("status") == "pending":
                    entry["status"] = "ready"  # launch preloads the durable reference
                self.entries[folder.name] = entry
            except Exception as exc:
                self.entries[folder.name] = self._failed(folder.name, str(exc))

    @staticmethod
    def _failed(name: str, reason: str) -> dict:
        return {"voice_id": name, "model": "drama-3", "status": "failed", "error": reason}

    def source(self, name: str) -> tuple[Path, str]:
        if name == "kirito":
            audio = Path(r"E:\ai-models\drama3-20261028\ComfyUI\input\kirito_drama3_ref.wav")
            transcript = "これからも皆様の応援によってなんかいろいろ展開していく作品だと本当に思いますので。"
        elif name == "yui":
            audio = Path(r"E:\ai-models\drama3-20261028\ComfyUI\input\yui_drama3_ref.wav")
            transcript = "ここに出たのかな。あ上？下？ここ？ここ？ここに出たのかな。ここら辺出てるかな。はい、かなえるというタイトルでございます。"
        else:
            folder = (self.new_root if (self.new_root / name).exists() else self.state / "voices") / name
            audio = folder / "reference.wav"
            transcript = (folder / "reference.txt").read_text(encoding="utf-8")
        if not audio.is_file() or not transcript.strip():
            raise ValueError(f"missing reference for {name}")
        return audio, transcript.strip()

    def launch_voices(self) -> list[str]:
        names = ["kirito", "yui"] + [name for name, entry in sorted(self.entries.items())
                                      if entry.get("status") == "ready" and name not in BUILTINS]
        args: list[str] = []
        for name in names:
            audio, transcript = self.source(name)
            args += ["--voice", f"{name}={_win_to_wsl(audio)}={transcript}"]
        return args

    def get(self, name: str) -> dict | None:
        if name in BUILTINS:
            return {"voice_id": name, "model": "drama-3", "status": "ready",
                    "source": "built_in", "error": None,
                    "runtime": "drama-rs", "virtual": name in ("none", "cast")}
        with self.lock:
            item = self.entries.get(name)
            return json.loads(json.dumps(item)) if item else None

    def list(self) -> list[dict]:
        with self.lock:
            return [self.get(name) for name in BUILTINS] + [self.get(name) for name in sorted(self.entries)
                                                            if name not in BUILTINS]

    def create(self, name: str, audio: bytes, transcript: str, register: object) -> dict:
        if not VOICE_ID.fullmatch(name) or name in BUILTINS:
            raise APIError(400, "voice_id must match [a-z][a-z0-9_-]{0,31} and not be reserved",
                           param="voice_id")
        if not transcript.strip() or len(transcript.encode("utf-8")) > 4096:
            raise APIError(400, "the exact reference_text is required (up to 4096 UTF-8 bytes)",
                           param="reference_text")
        try:
            info = _audio_info(audio)
        except ValueError as exc:
            raise APIError(400, str(exc), param="audio") from exc
        with self.lock:
            if name in self.entries or (self.new_root / name).exists():
                raise APIError(409, f'voice "{name}" already exists', param="voice_id", code="voice_id_exists")
            folder = self.new_root / name
            folder.mkdir()
            now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            entry = {"voice_id": name, "model": "drama-3", "status": "pending", "error": None,
                     "source": "reference_audio", "runtime": "drama-rs", "schema_version": 2,
                     "created_at": now, "updated_at": now,
                     "reference": {**info, "sha256": _sha(audio),
                                   "text_sha256": _sha(transcript.encode("utf-8")),
                                   "text_characters": len(transcript)}}
            _atomic(folder / "reference.wav", audio)
            _atomic(folder / "reference.txt", transcript.encode("utf-8"))
            self._save(folder, entry)
            self.entries[name] = entry
            try:
                register(name, audio, transcript)
                entry["status"] = "ready"
            except Exception as exc:
                entry.update(status="failed", error=str(exc)[:2000])
            entry["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            self._save(folder, entry)
            return json.loads(json.dumps(entry))

    @staticmethod
    def _save(folder: Path, entry: dict) -> None:
        _atomic(folder / "manifest.json", (json.dumps(entry, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))


def backend_request(method: str, path: str, body: bytes | None = None,
                    content_type: str | None = None, timeout: float = 180) -> tuple[HTTPConnection, object]:
    connection = HTTPConnection(BACKEND_HOST, BACKEND_PORT, timeout=timeout)
    headers = {"Connection": "close"}
    if content_type:
        headers["Content-Type"] = content_type
    connection.request(method, path, body=body, headers=headers)
    return connection, connection.getresponse()


def backend_ready() -> bool:
    try:
        connection, response = backend_request("GET", "/health", timeout=2)
        result = response.status == 200 and response.read(32).strip() == b"ok"
        connection.close()
        return result
    except (OSError, TimeoutError):
        return False


def backend_has_voices(store: VoiceStore) -> bool:
    if not backend_ready():
        return False
    try:
        connection, response = backend_request("GET", "/v1/voices", timeout=5)
        names = set(json.loads(response.read(65536))) if response.status == 200 else set()
        connection.close()
        required = {"kirito", "yui"} | {name for name, item in store.entries.items()
                                          if item.get("status") == "ready"}
        return required <= names
    except (OSError, ValueError, TimeoutError):
        return False


class WavStripper:
    """Remove a streamed RIFF header, validating the real output format."""

    def __init__(self) -> None:
        self.buffer = bytearray()
        self.ready = False
        self.offset = 12
        self.fmt_seen = False

    def feed(self, piece: bytes) -> bytes:
        if self.ready:
            return piece
        self.buffer.extend(piece)
        if len(self.buffer) < 12:
            return b""
        if self.buffer[:4] != b"RIFF" or self.buffer[8:12] != b"WAVE":
            raise ValueError("native engine did not send RIFF/WAVE")
        while len(self.buffer) >= self.offset + 8:
            kind, size = struct.unpack_from("<4sI", self.buffer, self.offset)
            if kind == b"data":
                if not self.fmt_seen:
                    raise ValueError("WAV data preceded fmt chunk")
                result = bytes(self.buffer[self.offset + 8:])
                self.buffer.clear()
                self.ready = True
                return result
            end = self.offset + 8 + size + (size & 1)
            if len(self.buffer) < end:
                return b""
            if kind == b"fmt ":
                if size < 16:
                    raise ValueError("invalid WAV fmt chunk")
                fmt, channels, rate, _, _, bits = struct.unpack_from("<HHIIHH", self.buffer, self.offset + 8)
                if (fmt, channels, rate, bits) != (1, 1, SAMPLE_RATE, 16):
                    raise ValueError(f"unexpected WAV format {(fmt, channels, rate, bits)}")
                self.fmt_seen = True
            self.offset = end
        if len(self.buffer) > 65536:
            raise ValueError("native WAV header exceeds 64 KiB")
        return b""


class Gateway(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address: tuple[str, int], store: VoiceStore) -> None:
        super().__init__(address, Handler)
        self.store = store
        self.model_lock = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server: Gateway

    def log_message(self, fmt: str, *args: object) -> None:
        logging.info("%s %s", self.client_address[0], fmt % args)

    def json_reply(self, status: int, value: object) -> None:
        body = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def fail(self, error: APIError) -> None:
        logging.warning("request rejected client=%s path=%s status=%s param=%s code=%s message=%s",
                        self.client_address[0], self.path, error.status, error.param, error.code, error)
        self.close_connection = True
        self.json_reply(error.status, {"error": {"message": str(error), "param": error.param,
                                                 "code": error.code}})

    def read_body(self, limit: int = MAX_BODY) -> bytes:
        try:
            length = int(self.headers["Content-Length"])
        except (KeyError, ValueError):
            raise APIError(411, "Content-Length is required") from None
        if length < 1 or length > limit:
            raise APIError(413, f"request must be 1–{limit} bytes")
        result = self.rfile.read(length)
        if len(result) != length:
            raise APIError(400, "incomplete request body")
        return result

    def read_json(self) -> dict:
        if self.headers.get("Content-Type", "").split(";", 1)[0].strip() != "application/json":
            raise APIError(415, "application/json is required")
        try:
            value = json.loads(self.read_body(65536))
        except (UnicodeDecodeError, ValueError):
            raise APIError(400, "invalid JSON body") from None
        if not isinstance(value, dict):
            raise APIError(400, "JSON object is required")
        return value

    def do_GET(self) -> None:
        path = urlsplit(self.path).path
        try:
            if path == "/health":
                if backend_has_voices(self.server.store):
                    self.json_reply(200, {"status": "ok", "runtime": "drama-rs", "native_port": BACKEND_PORT})
                else:
                    self.json_reply(503, {"status": "loading", "runtime": "drama-rs"})
            elif path == "/v1/models":
                self.json_reply(200, {"object": "list", "data": [{"id": "drama-3", "object": "model",
                    "owned_by": "drama-rs", "version": "0.3.0", "sample_rate": SAMPLE_RATE,
                    "defaults": {"split": False, "max_new": MAX_NEW},
                    "limitations": {"numeric_speed": "unsupported", "stop_reason": "not_exposed_by_engine",
                                    "legacy_max_seconds": "advisory_only_not_enforced",
                                    "restart_reference_encoding": "recomputed_from_durable_WAV"}}]})
            elif path == "/v1/audio/voices":
                self.json_reply(200, {"object": "list", "data": self.server.store.list()})
            elif path.startswith("/v1/audio/voices/"):
                name = path.removeprefix("/v1/audio/voices/")
                item = self.server.store.get(name)
                if item is None:
                    raise APIError(404, f'voice "{name}" was not found', param="voice_id", code="voice_not_found")
                self.json_reply(200, item)
            elif path == "/v1/voices":
                self.json_reply(200, [item["voice_id"] for item in self.server.store.list()
                                      if item["status"] == "ready" and item["voice_id"] != "none"])
            elif path == "/v1/capabilities":
                self.json_reply(200, {"runtime": "drama-rs 0.3.0", "sample_rate": SAMPLE_RATE,
                    "format": "mono PCM16 WAV (streaming)", "voice_clone": True,
                    "voice_selection": True, "multi_speaker": True, "speaker_map": True,
                    "plain_text": True,
                    "inline_delivery_tags": True, "numeric_speed": False,
                    "sampling": ["seed", "temperature", "top_k", "top_p", "max_new"],
                    "default_split": False, "stop_reason_known": False,
                    "legacy_max_seconds": "advisory_only_not_enforced",
                    "native_api": "/v1/speak", "legacy_api": "/v1/audio/speech"})
            else:
                self.proxy("GET", self.path)
        except APIError as exc:
            self.fail(exc)
        except (OSError, TimeoutError) as exc:
            logging.exception("GET backend failure")
            self.fail(APIError(502, str(exc), code="backend_unavailable"))

    def do_POST(self) -> None:
        path = urlsplit(self.path).path
        try:
            if path == "/v1/speak":
                content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip()
                if content_type == "text/plain":
                    try:
                        body = {"text": self.read_body(16000).decode("utf-8")}
                    except UnicodeDecodeError:
                        raise APIError(400, "plain text must be UTF-8", param="text") from None
                else:
                    body = self.read_json()
                self.validate_native(body)
                body.setdefault("split", False)
                body.setdefault("stream", True)
                self.speak(body, "wav", legacy=False)
            elif path == "/v1/audio/speech":
                body = self.read_json()
                self.legacy_speak(body)
            elif path == "/v1/voices":
                query = parse_qs(urlsplit(self.path).query)
                name, transcript = query.get("name", [""])[0], query.get("text", [""])[0]
                entry = self.register(name, self.read_body(), transcript)
                if entry["status"] != "ready":
                    raise APIError(502, entry["error"] or "registration failed", code="registration_failed")
                self.send_response(200)
                self.send_header("Content-Type", "text/plain")
                self.send_header("Content-Length", "3")
                self.end_headers()
                self.wfile.write(b"ok\n")
            elif path == "/v1/audio/voices":
                self.legacy_register()
            else:
                self.proxy("POST", self.path, self.read_body())
        except APIError as exc:
            self.fail(exc)
        except (OSError, TimeoutError) as exc:
            logging.exception("POST backend failure")
            try:
                self.fail(APIError(502, str(exc), code="backend_unavailable"))
            except OSError:
                self.close_connection = True

    def validate_native(self, body: dict) -> None:
        extra = set(body) - NATIVE_FIELDS
        if extra:
            name = sorted(extra)[0]
            raise APIError(400, f'unsupported member "{name}"', param=name)
        text = body.get("text")
        if not isinstance(text, str) or not text.strip() or len(text.encode("utf-8")) > 16000:
            raise APIError(400, "text must be nonempty UTF-8, at most 16000 bytes", param="text")
        if body.get("split", False) is not False:
            raise APIError(400, "split=true would make independent utterances; use split=false", param="split")
        if "seed" in body and (type(body["seed"]) is not int or body["seed"] < 0):
            raise APIError(400, "seed must be a nonnegative integer", param="seed")
        if "max_new" in body and (type(body["max_new"]) is not int or not 1 <= body["max_new"] <= MAX_NEW):
            raise APIError(400, f"max_new must be 1–{MAX_NEW}", param="max_new")
        if "voice" in body and "voices" in body:
            raise APIError(400, "choose voice or voices, not both", param="voices")
        if "voice" in body:
            name = body["voice"]
            if not isinstance(name, str) or self.server.store.get(name) is None:
                raise APIError(400, f'unknown voice "{name}"', param="voice", code="voice_not_found")
            if self.server.store.get(name)["status"] != "ready":
                raise APIError(409, f'voice "{name}" is not ready', param="voice", code="voice_not_ready")
            if name == "none":
                body.pop("voice")
            elif name == "cast":
                body.pop("voice")
                body["voices"] = ["kirito", "yui"]
        if "voices" in body:
            voices = body["voices"]
            if isinstance(voices, dict):
                if not 1 <= len(voices) <= 16 or any(not re.fullmatch(r"(?:[0-9]|1[0-5])", key)
                                                  for key in voices):
                    raise APIError(400, "voices keys must be speaker numbers 0–15", param="voices")
                names = voices.values()
            elif isinstance(voices, list) and 1 <= len(voices) <= 16:
                names = voices
            else:
                raise APIError(400, "voices must be a list or speaker-ID map of registered voices", param="voices")
            for name in names:
                item = self.server.store.get(name) if isinstance(name, str) else None
                if item is None or item["status"] != "ready" or name in ("none", "cast"):
                    raise APIError(400, f'unknown or virtual voice "{name}"', param="voices", code="voice_not_found")

    def legacy_speak(self, old: dict) -> None:
        extra = set(old) - LEGACY_FIELDS
        if extra:
            name = sorted(extra)[0]
            raise APIError(400, f'unsupported member "{name}"', param=name)
        if old.get("model", "drama-3") != "drama-3":
            raise APIError(404, "model was not found", param="model", code="model_not_found")
        legacy_max_seconds = old.get("max_seconds")
        if legacy_max_seconds is not None and (type(legacy_max_seconds) not in (int, float) or
                                               not 0 < legacy_max_seconds <= 30):
            raise APIError(400, "legacy max_seconds must be a number greater than 0 and at most 30",
                           param="max_seconds", code="unsupported_value")
        fmt = old.get("response_format", "wav")
        sse = old.get("stream_format")
        if fmt not in ("wav", "pcm") or (sse is not None and (fmt != "pcm" or sse != "sse")):
            raise APIError(400, "response_format must be wav or pcm; sse requires pcm", param="response_format")
        body = {"text": old.get("input"), "voice": old.get("voice"), "stream": True,
                "split": False, "max_new": old.get("max_new", MAX_NEW),
                "seed": old.get("seed", secrets.randbelow(2**32))}
        for key in ("top_k", "top_p", "temperature"):
            if key in old:
                body[key] = old[key]
        self.validate_native(body)
        self.speak(body, "sse" if sse else fmt, legacy=True, legacy_max_seconds=legacy_max_seconds)

    def register(self, name: str, audio: bytes, transcript: str) -> dict:
        def native_register(voice_id: str, wav: bytes, text: str) -> None:
            path = "/v1/voices?name=" + quote(voice_id) + "&text=" + quote(text)
            connection, response = backend_request("POST", path, wav, "audio/wav")
            result = response.read(4096)
            status = response.status
            connection.close()
            if status != 200 or result.strip() != b"ok":
                raise RuntimeError(f"native registration HTTP {status}: {result[:1000]!r}")
        with self.server.model_lock:
            return self.server.store.create(name, audio, transcript, native_register)

    def legacy_register(self) -> None:
        content_type = self.headers.get("Content-Type", "")
        if not content_type.lower().startswith("multipart/form-data;"):
            raise APIError(415, "multipart/form-data is required")
        raw = self.read_body()
        try:
            message = BytesParser(policy=policy.default).parsebytes(
                ("MIME-Version: 1.0\r\nContent-Type: " + content_type + "\r\n\r\n").encode("ascii") + raw)
        except UnicodeEncodeError:
            raise APIError(400, "multipart Content-Type must be ASCII") from None
        if not message.is_multipart():
            raise APIError(400, "invalid multipart body")
        parts: dict[str, bytes] = {}
        for part in message.iter_parts():
            name = part.get_param("name", header="content-disposition")
            if name not in ("voice_id", "audio", "reference_text", "model") or name in parts:
                raise APIError(400, f"unexpected or duplicate field: {name}")
            parts[name] = part.get_payload(decode=True) or b""
        try:
            name = parts["voice_id"].decode("utf-8")
            transcript = parts["reference_text"].decode("utf-8")
            audio = parts["audio"]
            model = parts.get("model", b"drama-3").decode("utf-8")
        except (KeyError, UnicodeDecodeError) as exc:
            raise APIError(400, f"invalid multipart field: {exc}") from None
        if model != "drama-3":
            raise APIError(404, "model was not found", param="model")
        entry = self.register(name, audio, transcript)
        self.json_reply(201 if entry["status"] == "ready" else 502, entry)

    def proxy(self, method: str, path: str, body: bytes | None = None) -> None:
        connection, response = backend_request(method, path, body,
            self.headers.get("Content-Type") if body is not None else None)
        try:
            self.stream_response(response, content_type=response.getheader("Content-Type", "application/octet-stream"))
        finally:
            connection.close()

    def speak(self, body: dict, mode: str, *, legacy: bool,
              legacy_max_seconds: float | None = None) -> None:
        # A gateway queue prevents already-disconnected requests entering the native model.
        while not self.server.model_lock.acquire(timeout=0.1):
            if self.peer_left():
                self.close_connection = True
                return
        started = time.monotonic()
        request_id = secrets.token_hex(6)
        try:
            if self.peer_left():
                self.close_connection = True
                return
            encoded = json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            connection, response = backend_request("POST", "/v1/speak", encoded, "application/json", timeout=240)
            try:
                if response.status != 200:
                    error = response.read(8192)
                    raise APIError(response.status, error.decode("utf-8", "replace"), code="native_error")
                if mode == "wav":
                    self.stream_response(response, content_type="audio/wav", seed=body["seed"] if legacy else None,
                                         legacy_max_seconds=legacy_max_seconds)
                else:
                    self.stream_pcm(response, sse=(mode == "sse"), seed=body["seed"], request_id=request_id,
                                    legacy_max_seconds=legacy_max_seconds)
            finally:
                connection.close()
        finally:
            self.server.model_lock.release()
            logging.info("speech request=%s voice=%s chars=%s elapsed=%.3f runtime=drama-rs",
                         request_id, body.get("voice", body.get("voices", "none")), len(body["text"]),
                         time.monotonic() - started)

    def peer_left(self) -> bool:
        try:
            self.connection.setblocking(False)
            try:
                return self.connection.recv(1, socket.MSG_PEEK) == b""
            except BlockingIOError:
                return False
            finally:
                self.connection.setblocking(True)
        except OSError:
            return True

    def stream_response(self, response: object, *, content_type: str, seed: int | None = None,
                        legacy_max_seconds: float | None = None) -> None:
        self.send_response(response.status)
        self.send_header("Content-Type", content_type)
        self.send_header("Transfer-Encoding", "chunked")
        self.send_header("X-Sample-Rate", str(SAMPLE_RATE))
        if seed is not None:
            self.send_header("X-Speech-Seed", str(seed))
            self.send_header("X-Speech-Stop", "unknown")
        if legacy_max_seconds is not None:
            self.send_header("X-Legacy-Max-Seconds", "advisory-only; use max_new")
        self.end_headers()
        try:
            while chunk := response.read(8192):
                self.chunk(chunk)
            self.wfile.write(b"0\r\n\r\n")
            self.wfile.flush()
        except OSError:
            self.close_connection = True

    def chunk(self, data: bytes) -> None:
        self.wfile.write(f"{len(data):X}\r\n".encode("ascii") + data + b"\r\n")
        self.wfile.flush()

    def stream_pcm(self, response: object, *, sse: bool, seed: int, request_id: str,
                   legacy_max_seconds: float | None = None) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream" if sse else "audio/pcm")
        self.send_header("Transfer-Encoding", "chunked")
        self.send_header("X-Sample-Rate", str(SAMPLE_RATE))
        self.send_header("X-Speech-Seed", str(seed))
        self.send_header("X-Request-Id", request_id)
        if legacy_max_seconds is not None:
            self.send_header("X-Legacy-Max-Seconds", "advisory-only; use max_new")
        if sse:
            self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        stripper = WavStripper()
        samples = 0
        try:
            while piece := response.read(8192):
                pcm = stripper.feed(piece)
                if pcm:
                    if len(pcm) & 1:
                        raise ValueError("odd number of PCM bytes")
                    if sse:
                        event = {"type": "speech.audio.delta", "audio": base64.b64encode(pcm).decode("ascii")}
                        self.chunk(("data: " + json.dumps(event, separators=(",", ":")) + "\n\n").encode())
                    else:
                        self.chunk(pcm)
                    samples += len(pcm) // 2
            if not stripper.ready:
                raise ValueError("native stream ended before WAV data")
            if sse:
                # v0.3.0 exposes neither EOS nor frame-cap reason. Never invent "complete".
                event = {"type": "speech.audio.done", "seed": seed, "samples": samples,
                         "stop": "unknown", "reason": "native_engine_does_not_expose_stop_reason"}
                if legacy_max_seconds is not None:
                    event["legacy_max_seconds_enforced"] = False
                self.chunk(("data: " + json.dumps(event, separators=(",", ":")) + "\n\n").encode())
            self.wfile.write(b"0\r\n\r\n")
            self.wfile.flush()
        except Exception as exc:
            logging.exception("speech stream error request=%s samples=%s", request_id, samples)
            if sse:
                try:
                    event = {"type": "speech.audio.done", "seed": seed, "samples": samples,
                             "stop": "error", "error": str(exc)}
                    self.chunk(("data: " + json.dumps(event, separators=(",", ":")) + "\n\n").encode())
                    self.wfile.write(b"0\r\n\r\n")
                    self.wfile.flush()
                except OSError:
                    self.close_connection = True
            else:
                self.close_connection = True


def native_command(store: VoiceStore) -> list[str]:
    return [r"C:\Windows\System32\wsl.exe", "-d", "Ubuntu-24.04", "--", "env", f"LD_LIBRARY_PATH={LIBRARY_PATH}",
            BINARY, "serve", "--model", MODEL, "--experts", "q4", "--addr",
            f"{BACKEND_HOST}:{BACKEND_PORT}", "--no-split", "--max-new", str(MAX_NEW),
            "--first-chunk", "4", "--stream-chunk", "16", *store.launch_voices()]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=18120)
    parser.add_argument("--state", type=Path, default=DEFAULT_STATE)
    args = parser.parse_args()
    args.state.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(filename=args.state / "drama-rs-gateway.log", level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s", encoding="utf-8")
    store = VoiceStore(args.state)
    process = None
    native_log = None
    if not backend_has_voices(store):
        # An earlier Windows task can leave the exact WSL binary alive. It may
        # be missing references added since that task started; free its VRAM.
        subprocess.run([r"C:\Windows\System32\wsl.exe", "-d", "Ubuntu-24.04", "--",
                        "pkill", "-TERM", "-x", "drama"], capture_output=True, timeout=15)
        for _ in range(20):
            if not backend_ready():
                break
            time.sleep(0.25)
        native_log = (args.state / "drama-rs-native.log").open("ab", buffering=0)
        process = subprocess.Popen(native_command(store), cwd=ROOT, stdout=native_log,
                                   stderr=subprocess.STDOUT, creationflags=subprocess.CREATE_NO_WINDOW)
        for _ in range(180):
            if backend_ready():
                break
            if process.poll() is not None:
                raise RuntimeError(f"drama-rs exited during startup: {process.returncode}")
            time.sleep(1)
        else:
            raise TimeoutError("drama-rs did not become ready within 180 seconds")
    server = Gateway((args.host, args.port), store)
    logging.info("ready on %s:%s; voices=%s", args.host, args.port,
                 [item["voice_id"] for item in store.list() if item["status"] == "ready"])
    try:
        server.serve_forever(poll_interval=0.5)
    finally:
        server.server_close()
        if process and process.poll() is None:
            process.terminate()
        if native_log:
            native_log.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

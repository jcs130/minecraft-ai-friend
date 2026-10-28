"""Drama 3 LAN speech API with persistent, native custom voice registration."""

from __future__ import annotations

import argparse
import base64
from email import policy
from email.parser import BytesParser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import logging
from pathlib import Path
import secrets
import select
import socket
import sys
import threading
import time
from urllib.parse import urlsplit
import wave

from speech_native import SpeechEngine, SpeechError
from voice_registry import BUILTINS, ConflictError, MAX_UPLOAD_BYTES, VoiceRegistry


ROOT = Path(__file__).resolve().parents[2]
RUNTIME = Path(r"E:\ai-models\drama3-20261028\speechcpp")
DEFAULT_STATE = ROOT / "server" / "drama3-service"
MAX_JSON_BYTES = 64 * 1024
MAX_MULTIPART_BYTES = MAX_UPLOAD_BYTES + 16 * 1024
MODEL_OPTIONS = {"language", "seed", "max_seconds", "top_k", "top_p", "temperature", "experts_on_cpu"}
MAX_CHUNK_SECONDS = 30.0


class APIError(Exception):
    def __init__(self, status: int, message: str, *, param: str | None = None, code: str = "invalid_request") -> None:
        super().__init__(message)
        self.status, self.param, self.code = status, param, code


class PeerCancellation:
    """A queued request can check its socket immediately after acquiring the model lock."""

    def __init__(self, connection: socket.socket) -> None:
        self.connection = connection
        self.event = threading.Event()

    def is_set(self) -> bool:
        if self.event.is_set():
            return True
        try:
            readable, _, _ = select.select([self.connection], [], [], 0)
            if readable and not self.connection.recv(1, socket.MSG_PEEK):
                self.event.set()
        except (OSError, ValueError):
            self.event.set()
        return self.event.is_set()

    def wait(self, timeout: float) -> bool:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self.is_set():
                return True
            self.event.wait(min(0.05, deadline - time.monotonic()))
        return self.is_set()


class VoiceHTTPServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address: tuple[str, int], engine: SpeechEngine, registry: VoiceRegistry) -> None:
        super().__init__(address, VoiceHandler)
        self.engine, self.registry = engine, registry


class VoiceHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server: VoiceHTTPServer

    def log_message(self, fmt: str, *args: object) -> None:
        logging.info("%s %s", self.address_string(), fmt % args)

    def _json(self, status: int, value: dict, *, headers: dict | None = None) -> None:
        data = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        if headers:
            for name, item in headers.items():
                self.send_header(name, str(item))
        self.end_headers()
        self.wfile.write(data)

    def _error(self, error: APIError) -> None:
        self.close_connection = True
        self._json(error.status, {"error": {"message": str(error),
                                          "type": "invalid_request_error" if error.status < 500 else "server_error",
                                          "param": error.param, "code": error.code}},
                   headers={"Connection": "close"})

    def _read(self, limit: int) -> bytes:
        try:
            length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            raise APIError(411, "Content-Length is required") from None
        if length < 1 or length > limit:
            raise APIError(413, f"request body must be 1–{limit} bytes")
        data = self.rfile.read(length)
        if len(data) != length:
            raise APIError(400, "request body ended before Content-Length")
        return data

    def do_GET(self) -> None:
        path = urlsplit(self.path).path
        try:
            if path == "/health":
                self._json(200, {"status": "ok"})
            elif path == "/v1/models":
                info = self.server.engine.info()
                self._json(200, {"object": "list", "data": [{
                    "id": "drama-3", "object": "model", "created": int(time.time()),
                    "owned_by": "speech.cpp", "version": self.server.engine.version,
                    "defaults": {"top_k": 4097, "max_seconds": MAX_CHUNK_SECONDS},
                    "chunking": {"mode": "native_context", "max_seconds_scope": "per_chunk",
                                 "max_seconds_limit": MAX_CHUNK_SECONDS,
                                 "chunk_bytes": "about 300 UTF-8 bytes; fixed by model"},
                    "speech": info,
                }]})
            elif path == "/v1/audio/voices":
                self._json(200, {"object": "list", "data": self.server.registry.list()})
            elif path.startswith("/v1/audio/voices/"):
                voice_id = path.removeprefix("/v1/audio/voices/")
                item = self.server.registry.get(voice_id)
                if item is None:
                    raise APIError(404, f'voice "{voice_id}" was not found', param="voice_id", code="voice_not_found")
                self._json(200, item)
            else:
                raise APIError(404, "unknown endpoint", code="not_found")
        except APIError as exc:
            self._error(exc)
        except Exception:
            logging.exception("GET failed")
            self._error(APIError(500, "internal service error", code="internal_error"))

    def do_POST(self) -> None:
        path = urlsplit(self.path).path
        try:
            if path == "/v1/audio/voices":
                self._register()
            elif path == "/v1/audio/speech":
                self._speech()
            else:
                raise APIError(404, "unknown endpoint", code="not_found")
        except APIError as exc:
            self._error(exc)
        except Exception:
            logging.exception("POST failed")
            try:
                self._error(APIError(500, "internal service error", code="internal_error"))
            except OSError:
                self.close_connection = True

    def _register(self) -> None:
        content_type = self.headers.get("Content-Type", "")
        if not content_type.lower().startswith("multipart/form-data;"):
            raise APIError(415, "multipart/form-data is required")
        raw = self._read(MAX_MULTIPART_BYTES)
        try:
            header = ("MIME-Version: 1.0\r\nContent-Type: " + content_type + "\r\n\r\n").encode("ascii", "strict")
        except UnicodeEncodeError:
            raise APIError(400, "multipart Content-Type must be ASCII") from None
        message = BytesParser(policy=policy.default).parsebytes(header + raw)
        if not message.is_multipart():
            raise APIError(400, "invalid multipart body")
        parts: dict[str, bytes] = {}
        for part in message.iter_parts():
            if part.get_content_disposition() != "form-data":
                raise APIError(400, "each part must be form-data")
            name = part.get_param("name", header="content-disposition")
            if name not in ("voice_id", "audio", "reference_text", "model") or name in parts:
                raise APIError(400, f"unexpected or duplicate multipart field: {name}")
            parts[name] = part.get_payload(decode=True) or b""
        try:
            voice_id = parts["voice_id"].decode("utf-8")
            reference_text = parts["reference_text"].decode("utf-8")
            audio = parts["audio"]
            model = parts.get("model", b"drama-3").decode("utf-8")
        except (KeyError, UnicodeDecodeError) as exc:
            raise APIError(400, f"missing or invalid multipart field: {exc}") from None
        if model != "drama-3":
            raise APIError(404, f'model "{model}" was not found', param="model", code="model_not_found")
        try:
            entry = self.server.registry.register(voice_id, audio, reference_text)
        except ConflictError as exc:
            raise APIError(409, str(exc), param="voice_id", code="voice_id_exists") from None
        except ValueError as exc:
            raise APIError(400, str(exc), code="invalid_reference") from None
        self._json(202, entry, headers={"Location": f"/v1/audio/voices/{voice_id}"})

    def _speech(self) -> None:
        if self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "application/json":
            raise APIError(415, "application/json is required")
        try:
            body = json.loads(self._read(MAX_JSON_BYTES))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise APIError(400, "invalid JSON body") from None
        if not isinstance(body, dict):
            raise APIError(400, "JSON body must be an object")
        allowed = {"model", "input", "voice", "response_format", "stream_format"} | MODEL_OPTIONS
        extra = set(body) - allowed
        if extra:
            name = sorted(extra)[0]
            raise APIError(400, f'unsupported member "{name}"', param=name)
        model = body.get("model", "drama-3")
        if model != "drama-3":
            raise APIError(404, f'model "{model}" was not found', param="model", code="model_not_found")
        prompt, voice = body.get("input"), body.get("voice")
        if not isinstance(prompt, str) or not prompt.strip() or len(prompt.encode("utf-8")) > 16000:
            raise APIError(400, "input must be nonempty UTF-8 text of at most 16000 bytes", param="input")
        if not isinstance(voice, str) or not voice:
            raise APIError(400, "voice is required", param="voice")
        entry = self.server.registry.get(voice)
        if entry is None:
            raise APIError(400, f'drama-3 has no voice named "{voice}"', param="voice", code="unsupported_value")
        if entry["status"] != "ready":
            raise APIError(409, f'voice "{voice}" is {entry["status"]}: {entry.get("error") or "encoding in progress"}',
                           param="voice", code="voice_not_ready")
        fmt = body.get("response_format", "wav")
        stream_format = body.get("stream_format")
        if fmt not in ("wav", "pcm") or (stream_format is not None and (fmt != "pcm" or stream_format != "sse")):
            raise APIError(400, "response_format must be wav or pcm; stream_format may be sse only for pcm",
                           param="response_format")
        options = {"voice": voice, "max_seconds": MAX_CHUNK_SECONDS, "top_k": 4097,
                   "seed": secrets.randbelow(2**53)}
        for name in MODEL_OPTIONS:
            if name in body:
                value = body[name]
                if name in ("seed", "top_k") and (type(value) is not int):
                    raise APIError(400, f"{name} must be an integer", param=name)
                if name in ("max_seconds", "top_p", "temperature") and (
                    isinstance(value, bool) or not isinstance(value, (int, float))
                ):
                    raise APIError(400, f"{name} must be a number", param=name)
                if name == "experts_on_cpu" and type(value) is not bool:
                    raise APIError(400, "experts_on_cpu must be a boolean", param=name)
                if name == "language" and not isinstance(value, str):
                    raise APIError(400, "language must be a string", param=name)
                options[name] = float(value) if name in ("max_seconds", "top_p", "temperature") else value
        if not (0 < options["max_seconds"] <= MAX_CHUNK_SECONDS):
            raise APIError(400, f"max_seconds is per native chunk and must be greater than 0 and at most {MAX_CHUNK_SECONDS:g} on this host",
                           param="max_seconds")
        request_id = secrets.token_hex(6)
        if fmt == "wav":
            chunks: list[bytes] = []
            try:
                result = self._synthesize(prompt, options, chunks.append, request_id)
            except SpeechError as exc:
                raise APIError(400 if exc.status in (-1, -2, -3) else 500,
                               str(exc), param=exc.option or None, code="native_synthesis_error") from None
            if result["stop"] == "cancelled":
                self.close_connection = True
                return
            if result["samples"] == 0:
                raise APIError(500, "native synthesis returned no audio", code="empty_audio")
            if result["samples"] != sum(len(chunk) // 2 for chunk in chunks):
                raise APIError(500, "native and WAV sample counts differ", code="sample_count_mismatch")
            with io.BytesIO() as output:
                with wave.open(output, "wb") as wav:
                    wav.setnchannels(1)
                    wav.setsampwidth(2)
                    wav.setframerate(self.server.engine.SAMPLE_RATE)
                    for chunk in chunks:
                        wav.writeframes(chunk)
                data = output.getvalue()
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("X-Sample-Rate", str(self.server.engine.SAMPLE_RATE))
            self.send_header("X-Speech-Seed", str(result["seed"]))
            self.send_header("X-Speech-Stop", result["stop"])
            self.send_header("X-Request-Id", request_id)
            self.end_headers()
            try:
                self.wfile.write(data)
            except (BrokenPipeError, ConnectionResetError):
                logging.info("speech client disconnected request=%s voice=%s", request_id, voice)
                self.close_connection = True
        else:
            self._stream_pcm(prompt, options, sse=stream_format == "sse", request_id=request_id)

    def _synthesize(self, prompt: str, options: dict, on_pcm: object, request_id: str) -> dict:
        """Cancel this request if its HTTP peer leaves, including while it waits for the model."""
        disconnected = PeerCancellation(self.connection)
        finished = threading.Event()

        def watch_peer() -> None:
            while not finished.wait(0.05):
                if disconnected.is_set():
                    return

        watcher = threading.Thread(target=watch_peer, name="drama3-http-disconnect", daemon=True)
        watcher.start()
        started = time.monotonic()
        try:
            result = self.server.engine.synthesize(prompt, options, on_pcm, cancellation=disconnected)
            logging.info("speech request=%s client=%s voice=%s seed=%s chars=%s max_chunk_seconds=%s "
                         "stop=%s samples=%s elapsed=%.3f",
                         request_id, self.client_address[0], options["voice"], result["seed"], len(prompt),
                         options["max_seconds"], result["stop"], result["samples"], time.monotonic() - started)
            return result
        except Exception:
            logging.exception("speech request=%s client=%s voice=%s seed=%s chars=%s failed after %.3f s",
                              request_id, self.client_address[0], options["voice"], options["seed"],
                              len(prompt), time.monotonic() - started)
            raise
        finally:
            finished.set()
            watcher.join()

    def _stream_pcm(self, prompt: str, options: dict, *, sse: bool, request_id: str) -> None:
        started = False
        sent_samples = 0

        def begin() -> None:
            nonlocal started
            if started:
                return
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream" if sse else "audio/pcm")
            self.send_header("Transfer-Encoding", "chunked")
            self.send_header("X-Sample-Rate", str(self.server.engine.SAMPLE_RATE))
            self.send_header("X-Speech-Seed", str(options["seed"]))
            self.send_header("X-Request-Id", request_id)
            if sse:
                self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            started = True

        def send(data: bytes) -> None:
            begin()
            self.wfile.write(f"{len(data):X}\r\n".encode("ascii") + data + b"\r\n")
            self.wfile.flush()

        def on_pcm(data: bytes) -> None:
            nonlocal sent_samples
            if sse:
                event = {"type": "speech.audio.delta", "audio": base64.b64encode(data).decode("ascii")}
                send(("data: " + json.dumps(event, separators=(",", ":")) + "\n\n").encode())
            else:
                send(data)
            sent_samples += len(data) // 2

        try:
            result = self._synthesize(prompt, options, on_pcm, request_id)
            if result["stop"] == "cancelled":
                self.close_connection = True
                return
            if result["samples"] != sent_samples:
                raise RuntimeError(f"native samples {result['samples']} differ from streamed {sent_samples}")
            if sse:
                event = {"type": "speech.audio.done", "seed": result["seed"],
                         "samples": sent_samples, "stop": result["stop"]}
                send(("data: " + json.dumps(event, separators=(",", ":")) + "\n\n").encode())
            begin()
            self.wfile.write(b"0\r\n\r\n")
            self.wfile.flush()
        except Exception as exc:
            if started:
                logging.exception("PCM stream failed after headers: %s", exc)
                if sse:
                    try:
                        event = {"type": "speech.audio.done", "seed": options["seed"],
                                 "samples": sent_samples, "stop": "error", "error": str(exc)}
                        send(("data: " + json.dumps(event, separators=(",", ":")) + "\n\n").encode())
                        self.wfile.write(b"0\r\n\r\n")
                        self.wfile.flush()
                    except OSError:
                        self.close_connection = True
                else:
                    self.close_connection = True
            elif isinstance(exc, SpeechError):
                raise APIError(400 if exc.status in (-1, -2, -3) else 500,
                               str(exc), param=exc.option or None, code="native_synthesis_error") from None
            else:
                raise


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=18120)
    parser.add_argument("--state", type=Path, default=DEFAULT_STATE)
    parser.add_argument("--runtime", type=Path, default=RUNTIME)
    args = parser.parse_args()
    args.state.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(filename=args.state / "voice-service.log", level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s", encoding="utf-8")
    runtime = args.runtime
    engine = SpeechEngine(runtime / "runtime" / "speech.dll",
                          runtime / "models" / "Drama-35B-A3B-v3-Q4_K.gguf")
    logging.info("loading Drama 3 on %s with %s MiB temporary VRAM reservation",
                 engine.device, engine.reserve_vram_mib)
    engine.load()
    try:
        for name in BUILTINS[1:]:
            engine.add_voice(name, runtime / f"{name}.voice.gguf")
        registry = VoiceRegistry(args.state / "voices", engine)
        registry.recover()
        server = VoiceHTTPServer((args.host, args.port), engine, registry)
        logging.info("ready on %s:%s; voices=%s", args.host, args.port,
                     [item["voice_id"] for item in registry.list()])
        try:
            server.serve_forever(poll_interval=0.5)
        finally:
            server.server_close()
            registry.close()
    finally:
        engine.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())

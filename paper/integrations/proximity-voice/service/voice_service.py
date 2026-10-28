"""Loopback media adapter. Existing TTS stays on its original GPU; ASR is CPU-only."""
from __future__ import annotations

import argparse
import hashlib
import hmac
import io
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import urllib.request
import uuid
import wave

MAX_AUDIO = 4 * 1024 * 1024
MAX_SECONDS = 30


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


class MediaError(ValueError):
    pass


def identifier(value):
    try:
        return str(uuid.UUID(str(value)))
    except (ValueError, AttributeError):
        raise MediaError("INVALID_REQUEST_ID") from None


def read_wav(blob, *, minimum=0.1):
    """Decode actual PCM WAV; never interpret MP3/WebM/Opus bytes as PCM."""
    if len(blob) > MAX_AUDIO:
        raise MediaError("AUDIO_TOO_LARGE")
    try:
        with wave.open(io.BytesIO(blob), "rb") as audio:
            channels, width, rate, count = (
                audio.getnchannels(), audio.getsampwidth(), audio.getframerate(), audio.getnframes()
            )
            if channels not in (1, 2) or width != 2 or not 8000 <= rate <= 96000:
                raise MediaError("WAV_PCM16_REQUIRED")
            if not minimum <= count / rate <= MAX_SECONDS:
                raise MediaError("AUDIO_DURATION_OUT_OF_RANGE")
            pcm = audio.readframes(count + 1)
            if len(pcm) != count * channels * width:
                raise MediaError("WAV_TRUNCATED")
    except (wave.Error, EOFError):
        raise MediaError("WAV_PCM16_REQUIRED") from None
    import numpy as np
    values = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768
    if channels == 2:
        values = values.reshape((-1, 2)).mean(axis=1)
    return rate, values


def normalized_wav(blob):
    rate, values = read_wav(blob)
    if rate != 48000:
        from scipy.signal import resample_poly
        divisor = math.gcd(rate, 48000)
        values = resample_poly(values, 48000 // divisor, rate // divisor)
    import numpy as np
    pcm = (np.clip(values, -1, 32767 / 32768) * 32768).round().astype("<i2").tobytes()
    output = io.BytesIO()
    with wave.open(output, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(48000)
        audio.writeframes(pcm)
    return output.getvalue()


class ReceiptStore:
    """Durable identity and unknown-result barrier; failed requests are not replayed."""
    def __init__(self, root):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.root / "receipts.sqlite", check_same_thread=False)
        self.lock = threading.Lock()
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("CREATE TABLE IF NOT EXISTS jobs (key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, state TEXT NOT NULL, result TEXT, changed REAL NOT NULL)")
        self.db.execute("UPDATE jobs SET state='unknown', changed=? WHERE state='running'", (time.time(),))
        self.db.commit()

    def begin(self, key, fingerprint):
        with self.lock:
            row = self.db.execute("SELECT fingerprint,state,result FROM jobs WHERE key=?", (key,)).fetchone()
            if row:
                if row[0] != fingerprint:
                    raise MediaError("REQUEST_ID_REUSED")
                return row[1], json.loads(row[2]) if row[2] else None
            self.db.execute("INSERT INTO jobs VALUES (?,?,'running',NULL,?)", (key, fingerprint, time.time()))
            self.db.commit()
            return "new", None

    def finish(self, key, state, result):
        with self.lock:
            self.db.execute("UPDATE jobs SET state=?,result=?,changed=? WHERE key=?", (state, json.dumps(result, ensure_ascii=False), time.time(), key))
            self.db.commit()

    def close(self):
        self.db.close()


class VoiceService:
    def __init__(self, config, *, recognizer=None, opener=None):
        self.config = config
        endpoint = config["tts_endpoint"]
        from urllib.parse import urlsplit
        import ipaddress
        parts = urlsplit(endpoint)
        try:
            address = ipaddress.ip_address(parts.hostname)
        except (ValueError, TypeError):
            raise MediaError("TTS_NUMERIC_PRIVATE_ADDRESS_REQUIRED") from None
        private = address.is_loopback or address.version == 4 and any(address in ipaddress.ip_network(network) for network in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"))
        if parts.scheme != "http" or not private or parts.username or parts.password or parts.fragment:
            raise MediaError("TTS_PRIVATE_ENDPOINT_REQUIRED")
        self.store = ReceiptStore(config["state_directory"])
        self.opener = opener or urllib.request.build_opener(NoRedirect).open
        self.recognizer = recognizer
        self.asr_lock = threading.Lock()
        self.tts_lock = threading.Lock()
        self.started = time.time()
        self.counts = {"tts": 0, "asr": 0, "silence": 0, "errors": 0}
        self.prune_audio()

    def prune_audio(self):
        # Evict audio, never receipt tombstones: an old request cannot synthesize again.
        files = sorted(self.store.root.glob("[0-9a-f]" * 64 + ".wav"), key=lambda p: p.stat().st_mtime, reverse=True)
        total = 0
        maximum = max(MAX_AUDIO, int(self.config.get("audio_cache_bytes", 64 * 1024 * 1024)))
        for index, file in enumerate(files):
            total += file.stat().st_size
            if index >= 64 or total > maximum or time.time() - file.stat().st_mtime > 3600:
                file.unlink()

    def voices(self):
        from urllib.parse import urlsplit, urlunsplit
        parts = urlsplit(self.config["tts_endpoint"])
        endpoint = urlunsplit((parts.scheme, parts.netloc, "/v1/audio/voices", "", ""))
        with self.opener(endpoint, timeout=10) as response:
            blob = response.read(256 * 1024 + 1)
        if len(blob) > 256 * 1024:
            raise MediaError("VOICE_CATALOG_TOO_LARGE")
        catalog = json.loads(blob)
        rows = catalog.get("voices", catalog.get("data", []))
        rows = [{"id": row} if isinstance(row, str) else row for row in rows[:128]]
        return {"voices": [{"id": row["id"], "label": str(row.get("label", row["id"]))[:96]} for row in rows if isinstance(row, dict) and re.fullmatch(r"[A-Za-z0-9_.-]{1,96}", str(row.get("id", "")))]}

    def load_asr(self):
        if self.recognizer is None:
            import sherpa_onnx
            model = Path(self.config["asr_model_directory"])
            self.recognizer = sherpa_onnx.OfflineRecognizer.from_paraformer(
                paraformer=str(model / "model.int8.onnx"), tokens=str(model / "tokens.txt"),
                num_threads=max(1, min(4, int(self.config.get("asr_threads", 2)))),
                provider="cpu", debug=False,
            )

    def _once(self, kind, actor, request_id, fingerprint, operation):
        key = f"{kind}:{identifier(actor)}:{identifier(request_id)}"
        state, result = self.store.begin(key, fingerprint)
        if state == "done":
            return result
        if state != "new":
            raise MediaError("RESULT_" + state.upper() + "_DO_NOT_REPLAY")
        try:
            result = operation(key)
            self.store.finish(key, "done", result)
            self.counts[kind] += 1
            return result
        except Exception:
            self.store.finish(key, "unknown", {"error": "RESULT_UNKNOWN_DO_NOT_REPLAY"})
            self.counts["errors"] += 1
            raise

    def tts(self, data):
        text = data.get("text")
        voice = data.get("voice")
        if not isinstance(text, str) or not 1 <= len(text.strip()) <= 1200 or "\x00" in text:
            raise MediaError("TEXT_REQUIRED_MAX_1200")
        if not isinstance(voice, str) or not re.fullmatch(r"[A-Za-z0-9_.-]{1,96}", voice):
            raise MediaError("VOICE_ID_REQUIRED")
        content = {"input": text, "voice": voice, "model": self.config.get("tts_model", "Cormy-TTS"), "response_format": "wav"}
        fingerprint = hashlib.sha256(json.dumps(content, ensure_ascii=False, sort_keys=True).encode()).hexdigest()

        def synthesize(key):
            request = urllib.request.Request(self.config["tts_endpoint"], data=json.dumps(content, ensure_ascii=False).encode(), headers={"Content-Type": "application/json"}, method="POST")
            with self.tts_lock, self.opener(request, timeout=90) as response:
                raw = response.read(MAX_AUDIO + 1)
            audio = normalized_wav(raw)
            name = hashlib.sha256(key.encode()).hexdigest() + ".wav"
            destination = self.store.root / name
            temporary = destination.with_suffix(".writing")
            temporary.write_bytes(audio)
            temporary.replace(destination)
            self.prune_audio()
            return {"file": name, "sha256": hashlib.sha256(audio).hexdigest(), "bytes": len(audio), "sampleRate": 48000}

        result = self._once("tts", data.get("actor"), data.get("requestId"), fingerprint, synthesize)
        try:
            audio = (self.store.root / result["file"]).read_bytes()
        except FileNotFoundError:
            raise MediaError("CACHED_AUDIO_EXPIRED_DO_NOT_REPLAY") from None
        if hashlib.sha256(audio).hexdigest() != result["sha256"]:
            raise MediaError("CACHED_AUDIO_UNAVAILABLE")
        return audio

    def transcribe(self, actor, request_id, blob):
        rate, samples = read_wav(blob, minimum=0.2)
        import numpy as np
        duration_ms = round(len(samples) * 1000 / rate)
        fingerprint = hashlib.sha256(blob).hexdigest()

        def recognize(_key):
            if float(np.sqrt(np.mean(samples * samples))) < 0.003:
                self.counts["silence"] += 1
                return {"text": "", "durationMs": duration_ms, "state": "silence"}
            with self.asr_lock:
                self.load_asr()
                stream = self.recognizer.create_stream()
                stream.accept_waveform(rate, samples)
                self.recognizer.decode_stream(stream)
                text = stream.result.text
            text = re.sub(r"[\x00-\x1f\x7f]", " ", str(text)).strip()[:1200]
            return {"text": text, "durationMs": duration_ms, "state": "transcribed", "provider": "sherpa-onnx-cpu"}

        return self._once("asr", actor, request_id, fingerprint, recognize)


class Handler(BaseHTTPRequestHandler):
    server_version = "QiandengVoice/0.1.0"

    def log_message(self, *_args):
        pass  # Never log speech, credentials or request bodies.

    def answer(self, code, data, content_type="application/json"):
        if isinstance(data, dict):
            data = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            service = self.server.service
            return self.answer(200, {"ok": True, "version": "0.1.0", "asrDevice": "cpu", "asrLoaded": service.recognizer is not None, "counts": service.counts})
        if self.path == "/v1/voices":
            if self.headers.get("Origin") or not hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + self.server.token):
                return self.answer(403, {"error": "BRIDGE_AUTH_REQUIRED"})
            try:
                return self.answer(200, self.server.service.voices())
            except Exception:
                return self.answer(502, {"error": "VOICE_CATALOG_UNAVAILABLE"})
        self.answer(404, {"error": "NOT_FOUND"})

    def do_POST(self):
        if self.headers.get("Origin") or not hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + self.server.token):
            return self.answer(403, {"error": "BRIDGE_AUTH_REQUIRED"})
        if not self.server.capacity.acquire(blocking=False):
            return self.answer(429, {"error": "VOICE_BACKEND_BUSY"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= MAX_AUDIO:
                raise MediaError("BODY_TOO_LARGE_OR_EMPTY")
            self.connection.settimeout(15)
            blob = self.rfile.read(length)
            if len(blob) != length:
                raise MediaError("BODY_TRUNCATED")
            if self.path == "/v1/tts":
                if length > 8192:
                    raise MediaError("TTS_BODY_TOO_LARGE")
                return self.answer(200, self.server.service.tts(json.loads(blob)), "audio/wav")
            if self.path == "/v1/asr":
                result = self.server.service.transcribe(self.headers.get("X-Actor"), self.headers.get("X-Request-Id"), blob)
                return self.answer(200, result)
            if self.path == "/v1/normalize":
                return self.answer(200, normalized_wav(blob), "audio/wav")
            self.answer(404, {"error": "NOT_FOUND"})
        except (MediaError, ValueError, TypeError, KeyError) as error:
            code = str(error)
            self.answer(400, {"error": code if re.fullmatch(r"[A-Z0-9_]{1,96}", code) else "INVALID_REQUEST"})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            self.answer(502, {"error": "VOICE_BACKEND_FAILED_QUERY_ORIGINAL_REQUEST"})
        finally:
            self.server.capacity.release()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    args = parser.parse_args()
    config = json.loads(Path(args.config).read_text(encoding="utf-8-sig"))
    token = Path(config["token_file"]).read_text().strip()
    if len(token) < 32:
        raise MediaError("PRIVATE_BRIDGE_TOKEN_REQUIRED")
    os.environ.setdefault("OMP_NUM_THREADS", "2")
    os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
    service = VoiceService(config)
    service.load_asr()
    server = ThreadingHTTPServer(("127.0.0.1", int(config.get("port", 8857))), Handler)
    server.daemon_threads = True
    server.service, server.token = service, token
    server.capacity = threading.BoundedSemaphore(8)
    print(json.dumps({"ready": True, "port": server.server_port, "asrDevice": "cpu"}), flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()
        service.store.close()


if __name__ == "__main__":
    main()

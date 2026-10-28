"""Registry and HTTP contract tests without loading the 20.8 GB model."""

from __future__ import annotations

from array import array
import io
import json
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
import wave

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from voice_registry import VoiceRegistry  # noqa: E402
from voice_service import VoiceHTTPServer  # noqa: E402


def reference_wav() -> bytes:
    output = io.BytesIO()
    with wave.open(output, "wb") as file:
        file.setnchannels(1)
        file.setsampwidth(2)
        file.setframerate(8000)
        file.writeframes(array("h", [1000] * (3 * 8000)).tobytes())
    return output.getvalue()


class FakeEngine:
    version = "0.9.0"
    codec = "test-codec"
    SAMPLE_RATE = 44100

    def __init__(self, *, fail_encode: bool = False, gate: threading.Event | None = None) -> None:
        self.fail_encode = fail_encode
        self.gate = gate
        self.encoded = 0
        self.added: list[str] = []
        self.spoken: list[str] = []

    def make_voice(self, reference: Path, transcript: str, output: Path) -> None:
        if self.gate is not None:
            self.gate.wait(timeout=5)
        self.encoded += 1
        if self.fail_encode:
            raise RuntimeError("encoder rejected reference")
        self.assert_source(reference, transcript)
        output.write_bytes(b"GGUF" + b"z" * 2048)

    @staticmethod
    def assert_source(reference: Path, transcript: str) -> None:
        assert reference.is_file()
        assert transcript == "测试参考原文。"

    def add_voice(self, name: str, path: Path) -> None:
        assert path.read_bytes().startswith(b"GGUF")
        self.added.append(name)

    def info(self) -> dict:
        return {"name": "drama-3", "voices": [{"name": name} for name in ("none", *self.added)]}

    def synthesize(self, text: str, options: dict, on_pcm: object) -> dict:
        self.spoken.append(options["voice"])
        on_pcm(array("h", [2000] * 4410).tobytes())
        return {"samples": 4410, "stop": "complete", "seed": options["seed"]}


def wait_status(registry: VoiceRegistry, voice_id: str, status: str) -> dict:
    end = time.monotonic() + 5
    while time.monotonic() < end:
        value = registry.get(voice_id)
        if value and value["status"] == status:
            return value
        time.sleep(0.02)
    raise AssertionError(f"{voice_id} did not reach {status}: {registry.get(voice_id)}")


class RegistryTests(unittest.TestCase):
    def test_one_time_encoding_and_restart_reuse(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            first_engine = FakeEngine()
            first = VoiceRegistry(root, first_engine)
            pending = first.register("cormy", reference_wav(), "测试参考原文。")
            self.assertEqual(pending["status"], "pending")
            ready = wait_status(first, "cormy", "ready")
            self.assertEqual(first_engine.encoded, 1)
            self.assertEqual(first_engine.added, ["cormy"])
            self.assertEqual(len(ready["voice_file_sha256"]), 64)
            first._workers.shutdown(wait=True)
            second_engine = FakeEngine()
            second = VoiceRegistry(root, second_engine)
            second.recover()
            self.assertEqual(second.get("cormy")["status"], "ready")
            self.assertEqual(second_engine.added, ["cormy"])
            self.assertEqual(second_engine.encoded, 0)
            second._workers.shutdown(wait=True)

    def test_failure_is_visible_and_never_ready(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            engine = FakeEngine(fail_encode=True)
            registry = VoiceRegistry(Path(directory), engine)
            registry.register("cormy", reference_wav(), "测试参考原文。")
            failed = wait_status(registry, "cormy", "failed")
            self.assertIn("encoder rejected reference", failed["error"])
            self.assertEqual(engine.added, [])
            registry._workers.shutdown(wait=True)

    def test_corrupted_cached_voice_fails_closed_on_restart(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            first = VoiceRegistry(root, FakeEngine())
            first.register("qa_voice", reference_wav(), "测试参考原文。")
            wait_status(first, "qa_voice", "ready")
            first._workers.shutdown(wait=True)
            (root / "qa_voice" / "voice.gguf").write_bytes(b"corrupt")
            engine = FakeEngine()
            second = VoiceRegistry(root, engine)
            second.recover()
            failed = second.get("qa_voice")
            self.assertEqual(failed["status"], "failed")
            self.assertIn("SHA-256 mismatch", failed["error"])
            self.assertEqual(engine.added, [])
            second._workers.shutdown(wait=True)

    def test_rejects_missing_transcript_and_bad_audio(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            registry = VoiceRegistry(Path(directory), FakeEngine())
            with self.assertRaisesRegex(ValueError, "reference_text is required"):
                registry.register("cormy", reference_wav(), "")
            with self.assertRaisesRegex(ValueError, "WAVE"):
                registry.register("cormy", b"not audio", "测试参考原文。")
            self.assertIsNone(registry.get("cormy"))
            registry._workers.shutdown(wait=True)


class HTTPTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.engine = FakeEngine()
        self.registry = VoiceRegistry(Path(self.tmp.name), self.engine)
        self.server = VoiceHTTPServer(("127.0.0.1", 0), self.engine, self.registry)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)
        self.registry._workers.shutdown(wait=True)
        self.tmp.cleanup()

    def request(self, path: str, data: bytes | None = None, content_type: str = "application/json") -> tuple[int, bytes]:
        request = urllib.request.Request(self.base + path, data=data,
                                         headers={"Content-Type": content_type},
                                         method="POST" if data is not None else "GET")
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                return response.status, response.read()
        except urllib.error.HTTPError as error:
            with error:
                return error.code, error.read()

    def test_register_query_synthesize_and_reject_unknown(self) -> None:
        boundary = "test-drama3-boundary"
        body = b""
        for name, value in (("voice_id", b"cormy"), ("reference_text", "测试参考原文。".encode()),
                            ("audio", reference_wav())):
            body += (f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n".encode()
                     + value + b"\r\n")
        body += f"--{boundary}--\r\n".encode()
        status, response = self.request("/v1/audio/voices", body, f"multipart/form-data; boundary={boundary}")
        self.assertEqual(status, 202, response)
        self.assertEqual(json.loads(response)["status"], "pending")
        status, response = self.request("/v1/audio/voices", body, f"multipart/form-data; boundary={boundary}")
        self.assertEqual(status, 409)
        self.assertEqual(json.loads(response)["error"]["code"], "voice_id_exists")
        wait_status(self.registry, "cormy", "ready")
        status, response = self.request("/v1/audio/voices/cormy")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(response)["status"], "ready")
        status, response = self.request("/v1/audio/voices")
        self.assertEqual(status, 200)
        self.assertEqual([item["voice_id"] for item in json.loads(response)["data"]],
                         ["none", "kirito", "yui", "cast", "cormy"])
        payload = json.dumps({"model": "drama-3", "input": "你好，我是可米。", "voice": "cormy",
                              "response_format": "wav", "max_seconds": 10, "top_k": 4097}).encode()
        status, response = self.request("/v1/audio/speech", payload)
        self.assertEqual(status, 200, response[:200])
        self.assertTrue(response.startswith(b"RIFF"))
        self.assertEqual(self.engine.spoken, ["cormy"])
        payload = json.dumps({"input": "测试", "voice": "missing"}).encode()
        status, response = self.request("/v1/audio/speech", payload)
        self.assertEqual(status, 400)
        self.assertEqual(json.loads(response)["error"]["code"], "unsupported_value")
        self.assertEqual(self.engine.spoken, ["cormy"])
        payload = json.dumps({"input": "测试", "voice": "cormy", "max_seconds": 11}).encode()
        status, response = self.request("/v1/audio/speech", payload)
        self.assertEqual(status, 400)
        self.assertEqual(json.loads(response)["error"]["param"], "max_seconds")
        self.assertEqual(self.engine.spoken, ["cormy"])

    def test_cast_tags_and_streaming_pcm(self) -> None:
        payload = json.dumps({"input": "<|speaker:0|>你好。<|speaker:1|>好呀。",
                              "voice": "cast", "response_format": "pcm"}).encode()
        status, response = self.request("/v1/audio/speech", payload)
        self.assertEqual(status, 200)
        self.assertEqual(len(response), 8820)
        self.assertEqual(self.engine.spoken, ["cast"])
        payload = json.dumps({"input": "<|speaker:0|>你好。<|speaker:1|>好呀。",
                              "voice": "cast", "response_format": "pcm", "stream_format": "sse"}).encode()
        status, response = self.request("/v1/audio/speech", payload)
        self.assertEqual(status, 200)
        self.assertIn(b"speech.audio.delta", response)
        self.assertIn(b"speech.audio.done", response)

    def test_pending_voice_returns_conflict_until_hot_add(self) -> None:
        gate = threading.Event()
        self.engine.gate = gate
        self.registry.register("slow_voice", reference_wav(), "测试参考原文。")
        self.assertEqual(self.registry.get("slow_voice")["status"], "pending")
        payload = json.dumps({"input": "测试", "voice": "slow_voice"}).encode()
        status, response = self.request("/v1/audio/speech", payload)
        self.assertEqual(status, 409)
        self.assertEqual(json.loads(response)["error"]["code"], "voice_not_ready")
        self.assertEqual(self.engine.spoken, [])
        gate.set()
        wait_status(self.registry, "slow_voice", "ready")


if __name__ == "__main__":
    unittest.main()

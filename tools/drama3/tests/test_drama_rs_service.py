"""Gateway contract tests with a fake native server; no GPU or production ports."""

import base64
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import wave

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import drama_rs_service as service


def tiny_wav() -> bytes:
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(service.SAMPLE_RATE)
        wav.writeframes(b"\x01\x00" * 12000)
    return output.getvalue()


def reference_wav() -> bytes:
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(service.SAMPLE_RATE)
        wav.writeframes(b"\x00\x00" * (service.SAMPLE_RATE * 3))
    return output.getvalue()


class FakeNative(BaseHTTPRequestHandler):
    wav = tiny_wav()
    requests: list[dict] = []
    voices: dict[str, bytes] = {}

    def log_message(self, *_args):
        pass

    def do_GET(self):
        body = b"ok" if self.path == "/health" else b"[]"
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        body = self.rfile.read(int(self.headers["Content-Length"]))
        if self.path == "/v1/speak":
            self.requests.append(json.loads(body))
            response = self.wav
            content_type = "audio/wav"
        elif self.path.startswith("/v1/voices?"):
            self.voices[self.path] = body
            response, content_type = b"ok\n", "text/plain"
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(response)))
        self.end_headers()
        for offset in range(0, len(response), 113):
            self.wfile.write(response[offset:offset + 113])


class GatewayTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.native = ThreadingHTTPServer(("127.0.0.1", 0), FakeNative)
        cls.native_thread = threading.Thread(target=cls.native.serve_forever, daemon=True)
        cls.native_thread.start()
        cls.old_port = service.BACKEND_PORT
        service.BACKEND_PORT = cls.native.server_port
        cls.gateway = service.Gateway(("127.0.0.1", 0), service.VoiceStore(Path(cls.temp.name)))
        cls.gateway_thread = threading.Thread(target=cls.gateway.serve_forever, daemon=True)
        cls.gateway_thread.start()
        cls.base = f"http://127.0.0.1:{cls.gateway.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.gateway.shutdown()
        cls.native.shutdown()
        cls.gateway.server_close()
        cls.native.server_close()
        service.BACKEND_PORT = cls.old_port
        cls.temp.cleanup()

    def post_json(self, path: str, body: dict):
        data = json.dumps(body, ensure_ascii=False).encode()
        return urlopen(Request(self.base + path, data=data,
                               headers={"Content-Type": "application/json"}), timeout=5)

    def test_native_cormy_selection_and_split_false(self):
        # The test catalog is empty: use the virtual cast, which maps to the two source voices.
        with self.post_json("/v1/speak", {"text": "<|speaker:0|>你好。<|speaker:1|>好呀。",
                                          "voice": "cast", "seed": 15}) as response:
            self.assertEqual(response.read(), FakeNative.wav)
        body = FakeNative.requests[-1]
        self.assertEqual(body["voices"], ["kirito", "yui"])
        self.assertFalse(body["split"])
        self.assertTrue(body["stream"])
        self.assertEqual(body["seed"], 15)

    def test_native_speaker_map_and_plain_text(self):
        with self.post_json("/v1/speak", {"text": "<|speaker:0|>你好。<|speaker:1|>好呀。",
                                          "voices": {"0": "kirito", "1": "yui"}}) as response:
            self.assertEqual(response.read(), FakeNative.wav)
        self.assertEqual(FakeNative.requests[-1]["voices"], {"0": "kirito", "1": "yui"})
        with urlopen(Request(self.base + "/v1/speak", data="你好".encode("utf-8"),
                             headers={"Content-Type": "text/plain"}), timeout=5) as response:
            self.assertEqual(response.read(), FakeNative.wav)
        self.assertEqual(FakeNative.requests[-1]["text"], "你好")

    def test_legacy_sse_counts_real_pcm_and_has_honest_stop(self):
        with self.post_json("/v1/audio/speech", {"model": "drama-3", "input": "你好",
                "voice": "kirito", "response_format": "pcm", "stream_format": "sse", "seed": 12}) as response:
            self.assertEqual(response.headers["X-Sample-Rate"], "44100")
            events = [json.loads(line[6:]) for line in response.read().decode().splitlines()
                      if line.startswith("data: ")]
        pcm = b"".join(base64.b64decode(event["audio"]) for event in events[:-1])
        self.assertEqual(pcm, FakeNative.wav[44:])
        self.assertEqual(events[-1]["samples"], len(pcm) // 2)
        self.assertEqual(events[-1]["stop"], "unknown")
        self.assertEqual(events[-1]["seed"], 12)

    def test_unknown_voice_and_unsupported_speed_fail(self):
        for path, body, wanted in (
            ("/v1/speak", {"text": "你好", "voice": "fake"}, 400),
            ("/v1/speak", {"text": "你好", "voice": "kirito", "speed": 2}, 400),
            ("/v1/audio/speech", {"input": "你好", "voice": "kirito", "max_seconds": -1}, 400),
        ):
            with self.subTest(body=body), self.assertRaises(HTTPError) as error:
                self.post_json(path, body)
            self.assertEqual(error.exception.code, wanted)
            error.exception.close()

    def test_legacy_seconds_is_explicitly_advisory(self):
        with self.post_json("/v1/audio/speech", {"input": "你好", "voice": "kirito",
                "response_format": "pcm", "stream_format": "sse", "max_seconds": 10, "seed": 9}) as response:
            self.assertIn("advisory-only", response.headers["X-Legacy-Max-Seconds"])
            events = [json.loads(line[6:]) for line in response.read().decode().splitlines()
                      if line.startswith("data: ")]
        self.assertFalse(events[-1]["legacy_max_seconds_enforced"])
        self.assertEqual(events[-1]["stop"], "unknown")

    def test_native_voice_upload_is_durable_and_selectable(self):
        audio = reference_wav()
        path = "/v1/voices?name=testvoice&text=" + "%E4%BD%A0%E5%A5%BD"
        with urlopen(Request(self.base + path, data=audio,
                             headers={"Content-Type": "audio/wav"}), timeout=5) as response:
            self.assertEqual(response.read(), b"ok\n")
        with urlopen(self.base + "/v1/audio/voices/testvoice", timeout=5) as response:
            entry = json.load(response)
        self.assertEqual(entry["status"], "ready")
        self.assertEqual(entry["reference"]["sha256"], service._sha(audio))
        restored = service.VoiceStore(Path(self.temp.name))
        self.assertEqual(restored.get("testvoice")["status"], "ready")
        self.assertIn("testvoice", restored.launch_voices()[-1])

    def test_multipart_legacy_registration_uses_same_durable_store(self):
        boundary = "drama-rs-test-boundary"
        fields = [("voice_id", b"testmultipart"), ("model", b"drama-3"),
                  ("reference_text", "你好".encode("utf-8")), ("audio", reference_wav())]
        body = bytearray()
        for name, value in fields:
            body += (f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n").encode()
            body += value + b"\r\n"
        body += f"--{boundary}--\r\n".encode()
        request = Request(self.base + "/v1/audio/voices", data=bytes(body),
                          headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
        with urlopen(request, timeout=5) as response:
            self.assertEqual(response.status, 201)
            self.assertEqual(json.load(response)["status"], "ready")
        self.assertEqual(service.VoiceStore(Path(self.temp.name)).get("testmultipart")["status"], "ready")


if __name__ == "__main__":
    unittest.main()

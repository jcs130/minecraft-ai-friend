"""Offline PCM fixture tests; no model weights, private voices or playback."""
import asyncio
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import wave

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("qd_tts_api", ROOT / "world/tts/tts_api.py")
api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(api)


class SyntheticTTS:
    def __init__(self):
        self.calls = []

    def infer(self, **kwargs):
        self.calls.append(kwargs)
        with wave.open(kwargs["output_path"], "wb") as stream:
            stream.setnchannels(1)
            stream.setsampwidth(2)
            stream.setframerate(22050)
            stream.writeframes(b"\x00\x00" * 2205)


class TtsApiTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="qd-tts-api-test-")
        self.root = Path(self.temporary.name)
        self.voices = self.root / "voices"
        self.voices.mkdir()
        (self.voices / "goddess.wav").write_bytes(b"fixture-reference-not-read")
        (self.voices / "touhou_little_maid.wav").write_bytes(b"fixture-reference-not-read")
        self.output = self.root / "output"
        self.output.mkdir()
        self.engine = SyntheticTTS()
        self.patches = patch.multiple(api, VOICE_DIR=str(self.voices), TMP_DIR=str(self.output), _tts=self.engine)
        self.patches.start()
        # No lifecycle startup: the fixture is deliberately not an IndexTTS model.
        self.client = TestClient(api.app)

    def tearDown(self):
        self.client.close()
        self.patches.stop()
        self.temporary.cleanup()

    def assert_clean(self):
        self.assertEqual(list(self.output.iterdir()), [])

    def test_existing_get_and_post_remain_wav_and_get_mp3_works(self):
        for method, arguments in (("get", {"params": {"text": "测试"}}),
                                  ("post", {"json": {"text": "测试", "media_type": "ogg", "streaming_mode": True}})):
            with self.subTest(method=method):
                response = getattr(self.client, method)("/tts", **arguments)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.headers["content-type"], "audio/wav")
                with wave.open(io.BytesIO(response.content)) as audio:
                    self.assertEqual(audio.getsampwidth(), 2)
                self.assert_clean()
        response = self.client.get("/tts", params={"text": "测试", "format": "mp3"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "audio/mpeg")
        self.assertFalse(response.content.startswith(b"RIFF"))
        self.assert_clean()

    def test_maid_returns_real_mp3_and_uses_requested_local_reference(self):
        response = self.client.post("/tts/maid", json={
            "text": "本地测试。", "text_lang": "zh", "ref_audio_path": "/voices/touhou_little_maid.wav",
            "media_type": "ogg", "streaming_mode": True, "prompt_text": "ignored compatibility field",
            "aux_ref_audio_paths": [], "text_split_method": "cut5"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "audio/mpeg")
        self.assertTrue(response.content[:2] in (b"\xff\xf3", b"\xff\xfb", b"\xff\xf2", b"\xff\xfa"))
        self.assertEqual(Path(self.engine.calls[-1]["spk_audio_prompt"]).name, "touhou_little_maid.wav")
        self.assertEqual(self.engine.calls[-1]["lang"], "ZH")
        self.assert_clean()

    def test_bad_or_long_text_does_not_infer(self):
        for text in (None, 42, [], "", "  ", "hello\x00", "语" * (api.MAX_TEXT_CHARS + 1)):
            with self.subTest(text_type=type(text).__name__):
                self.assertEqual(self.client.post("/tts/maid", json={"text": text}).status_code, 400)
        self.assertEqual(self.client.get("/tts", params={"text": "语" * 601}).status_code, 400)
        self.assertEqual(self.engine.calls, [])
        self.assert_clean()

    def test_oversized_json_is_rejected_before_inference(self):
        body = json.dumps({"text": "small", "ignored": "a" * api.MAX_BODY_BYTES})
        response = self.client.post("/tts/maid", content=body, headers={"Content-Type": "application/json"})
        self.assertEqual(response.status_code, 413)
        self.assertEqual(self.engine.calls, [])

    def test_unknown_maid_reference_fails_but_legacy_keeps_fallback(self):
        payload = {"text": "测试", "ref_audio_path": "/voices/not-present.wav"}
        self.assertEqual(self.client.post("/tts/maid", json=payload).status_code, 404)
        self.assertEqual(self.engine.calls, [])
        self.assertEqual(self.client.post("/tts", json=payload).status_code, 200)
        self.assertEqual(Path(self.engine.calls[-1]["spk_audio_prompt"]).name, "goddess.wav")
        self.assert_clean()

    def test_invalid_emotion_or_nonfinite_speed_never_reaches_engine(self):
        for extra in ({"emo": "happy:nan"}, {"emo": "unknown:1"}, {"emo": "1,2,3"},
                      {"speed": "nan"}, {"emo_alpha": "inf"}):
            response = self.client.get("/tts", params={"text": "test", **extra})
            self.assertEqual(response.status_code, 400)
        self.assertEqual(self.engine.calls, [])

    def test_engine_failure_and_encoder_failure_clean_partial_files(self):
        def broken(**kwargs):
            Path(kwargs["output_path"]).write_bytes(b"partial")
            raise RuntimeError("private text must not be echoed")
        with patch.object(self.engine, "infer", side_effect=broken):
            response = self.client.post("/tts/maid", json={"text": "test"})
            self.assertEqual(response.status_code, 500)
            self.assertNotIn("private", response.text)
            self.assert_clean()
        with patch.object(api, "_wav_to_mp3", side_effect=ValueError("bad PCM")):
            self.assertEqual(self.client.post("/tts/maid", json={"text": "test"}).status_code, 500)
            self.assert_clean()

    def test_send_failure_also_cleans_response_directory(self):
        response = api._render("test", "goddess", "ZH")
        async def receive():
            return {"type": "http.disconnect"}
        async def send(_message):
            raise ConnectionError("test disconnected")
        with self.assertRaises(ConnectionError):
            asyncio.run(response({"type": "http", "method": "GET", "headers": [], "extensions": {}}, receive, send))
        self.assert_clean()

    def test_busy_and_health_do_not_call_engine(self):
        with patch.object(api, "_lock") as lock:
            lock.acquire.return_value = False
            response = self.client.post("/tts/maid", json={"text": "test"})
            self.assertEqual(response.status_code, 429)
            lock.release.assert_not_called()
        health = self.client.get("/health").json()
        self.assertTrue(health["ok"])
        self.assertEqual(health["maidEndpoint"], "/tts/maid")
        self.assertEqual(self.engine.calls, [])
        self.assert_clean()

    def test_missing_output_is_error_not_audio_success(self):
        with patch.object(self.engine, "infer", return_value=None):
            self.assertEqual(self.client.post("/tts/maid", json={"text": "test"}).status_code, 500)
        self.assert_clean()


if __name__ == "__main__":
    unittest.main()

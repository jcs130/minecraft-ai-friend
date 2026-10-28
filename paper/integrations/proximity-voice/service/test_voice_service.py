import io
import json
import os
import time
from pathlib import Path
import tempfile
import unittest
import uuid
import wave

import numpy as np
from voice_service import MediaError, ReceiptStore, VoiceService, normalized_wav, read_wav


def wav(rate=24000, seconds=0.5, channels=1, silent=False):
    samples = np.zeros(round(rate * seconds)) if silent else np.sin(np.arange(round(rate * seconds)) * 2 * np.pi * 440 / rate) * 0.2
    if channels == 2:
        samples = np.stack((samples, samples), axis=1)
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(channels)
        out.setsampwidth(2)
        out.setframerate(rate)
        out.writeframes((samples * 32767).astype("<i2").tobytes())
    return buffer.getvalue()


class FakeRecognizer:
    calls = 0
    def create_stream(self):
        class Stream:
            def accept_waveform(self, rate, samples):
                assert rate == 24000 and len(samples) == 12000
            class result:
                text = "去公会拿装备"
        return Stream()
    def decode_stream(self, _stream):
        self.calls += 1


class VoiceServiceTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.config = {"state_directory": self.directory.name, "tts_endpoint": "http://127.0.0.1:8017/v1/audio/speech"}
        self.actor, self.request = str(uuid.uuid4()), str(uuid.uuid4())
    def tearDown(self):
        self.directory.cleanup()
    def test_wav_stereo_and_resample_preserve_duration_and_signal(self):
        output = normalized_wav(wav(channels=2))
        rate, samples = read_wav(output)
        self.assertEqual(rate, 48000)
        self.assertEqual(len(samples), 24000)
        self.assertGreater(float(np.sqrt(np.mean(samples ** 2))), 0.1)
    def test_invalid_wav_and_truncation_are_rejected(self):
        for value in (b"mp3-content", wav()[:-4]):
            with self.assertRaises(MediaError):
                read_wav(value)
    def test_duration_limit_is_not_silent_truncation(self):
        with self.assertRaisesRegex(MediaError, "DURATION"):
            read_wav(wav(seconds=30.1))
    def test_reused_request_with_changed_content_is_rejected(self):
        store = ReceiptStore(self.directory.name)
        self.assertEqual(store.begin("same", "a")[0], "new")
        with self.assertRaisesRegex(MediaError, "REQUEST_ID_REUSED"):
            store.begin("same", "b")
        store.close()
    def test_interrupted_request_remains_unknown_after_restart(self):
        store = ReceiptStore(self.directory.name)
        store.begin("request", "fingerprint")
        store.close()
        store = ReceiptStore(self.directory.name)
        self.assertEqual(store.begin("request", "fingerprint")[0], "unknown")
        store.close()
    def test_asr_once_and_no_audio_persisted(self):
        recognizer = FakeRecognizer()
        service = VoiceService(self.config, recognizer=recognizer)
        try:
            first = service.transcribe(self.actor, self.request, wav())
            self.assertEqual(first["text"], "去公会拿装备")
            self.assertEqual(first, service.transcribe(self.actor, self.request, wav()))
            self.assertEqual(recognizer.calls, 1)
            self.assertEqual(list(Path(self.directory.name).glob("*.wav")), [])
        finally:
            service.store.close()
    def test_silence_does_not_call_asr(self):
        recognizer = FakeRecognizer()
        service = VoiceService(self.config, recognizer=recognizer)
        try:
            self.assertEqual(service.transcribe(self.actor, self.request, wav(silent=True))["state"], "silence")
            self.assertEqual(recognizer.calls, 0)
        finally:
            service.store.close()
    def test_tts_uses_original_backend_once_and_replays_cached_audio_only(self):
        calls = []
        def opener(request, timeout):
            calls.append(json.loads(request.data))
            self.assertEqual(timeout, 90)
            return io.BytesIO(wav())
        service = VoiceService(self.config, opener=opener)
        request = {"actor": self.actor, "requestId": self.request, "voice": "existing-voice", "text": "去公会拿装备"}
        try:
            first = service.tts(request)
            self.assertEqual(first, service.tts(request))
            self.assertEqual(len(calls), 1)
            self.assertEqual(calls[0]["voice"], "existing-voice")
            self.assertEqual(read_wav(first)[0], 48000)
        finally:
            service.store.close()
    def test_non_private_backend_is_not_accepted(self):
        with self.assertRaises(MediaError):
            VoiceService({**self.config, "tts_endpoint": "https://example.com/tts"})

    def test_string_voice_catalog_from_actual_tts_schema(self):
        service = VoiceService(self.config, opener=lambda *_a, **_kw: io.BytesIO(b'{"voices":["cormi-F6","bad id"]}'))
        try:
            self.assertEqual(service.voices(), {"voices": [{"id": "cormi-F6", "label": "cormi-F6"}]})
        finally:
            service.store.close()

    def test_evicted_audio_keeps_receipt_and_never_resynthesizes(self):
        calls = []
        def opener(*_a, **_kw):
            calls.append(1)
            return io.BytesIO(wav())
        service = VoiceService(self.config, opener=opener)
        request = {"actor": self.actor, "requestId": self.request, "voice": "existing", "text": "去冒险"}
        try:
            service.tts(request)
            file = next(Path(self.directory.name).glob("*.wav"))
            os.utime(file, (time.time() - 7200, time.time() - 7200))
            service.prune_audio()
            with self.assertRaisesRegex(MediaError, "EXPIRED_DO_NOT_REPLAY"):
                service.tts(request)
            self.assertEqual(calls, [1])
        finally:
            service.store.close()


if __name__ == "__main__":
    unittest.main()

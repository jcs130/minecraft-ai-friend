import base64
from collections import OrderedDict
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from urllib.request import Request, urlopen
from urllib.error import HTTPError
import numpy as np
import soundfile as sf

sys.path.insert(0, str(Path(__file__).parent))
from managed_voices import ManagedVoiceCatalog, VoiceError, parse_upload
from voxcpm2_server import VoiceEngine, VoiceServer
from synthesis_metrics import SynthesisMetrics


def audio(rate=24000, frequency=200):
    data = np.sin(np.arange(rate) * frequency * 2 * np.pi / rate) * 0.15
    output = io.BytesIO()
    sf.write(output, data, rate, format='WAV', subtype='PCM_16')
    return output.getvalue()


class VoicesTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        ref = self.root / 'preset.wav'
        ref.write_bytes(audio())
        self.cfg = dict(voice='preset', reference_file=str(ref), reference_text='原来音色。',
                        reference_sha256=hashlib.sha256(ref.read_bytes()).hexdigest(),
                        managed_voice_dir=str(self.root / 'managed'))
        self.catalog = ManagedVoiceCatalog(self.cfg)

    def tearDown(self):
        self.temp.cleanup()

    def create(self, **extra):
        return self.catalog.put(dict(id='my-voice', audio=audio(), reference_text='参考音原文。', **extra))

    def test_create_survives_restart_and_preserves_default(self):
        result = self.create(label='我的音色')
        other = ManagedVoiceCatalog(self.cfg)
        self.assertEqual(other.resolve('my-voice'), self.catalog.resolve('my-voice'))
        self.assertEqual(other.default_id, 'preset')
        self.assertEqual(result['label'], '我的音色')
        self.assertNotIn(str(self.root), json.dumps(other.public()))

    def test_auto_id_and_multiple_voices(self):
        first = self.catalog.put(dict(audio=audio(), prompt_text='准确原文。'))
        second = self.catalog.put(dict(audio=audio(), transcript='准确原文。'))
        self.assertNotEqual(first['id'], second['id'])

    def test_conflicts_and_missing_updates(self):
        self.create()
        with self.assertRaises(VoiceError) as fail:
            self.create()
        self.assertEqual(fail.exception.status, 409)
        with self.assertRaises(VoiceError):
            self.catalog.put({}, 'missing', create=False)

    def test_update_keeps_immutable_inflight_reference(self):
        self.create()
        old = self.catalog.resolve('my-voice')
        self.catalog.put(dict(audio=audio(frequency=400), reference_text='新的原文。'), 'my-voice', create=False)
        self.assertNotEqual(old.reference_sha256, self.catalog.resolve('my-voice').reference_sha256)
        self.assertTrue(Path(old.reference_file).is_file())
        self.assertIs(self.catalog.resolve(old), old)

    def test_metadata_update_retains_audio(self):
        self.create()
        old = self.catalog.resolve('my-voice')
        self.catalog.put(dict(label='新名称'), 'my-voice', create=False)
        self.assertEqual(self.catalog.resolve('my-voice').reference_sha256, old.reference_sha256)

    def test_delete_durable_but_retains_queued_audio(self):
        self.create()
        old = self.catalog.resolve('my-voice')
        self.catalog.delete('my-voice')
        with self.assertRaises(ValueError):
            ManagedVoiceCatalog(self.cfg).resolve('my-voice')
        self.assertTrue(Path(old.reference_file).is_file())

    def test_presets_not_accidentally_overwritten_or_deleted(self):
        with self.assertRaises(VoiceError):
            self.catalog.put(dict(label='覆盖'), 'preset', create=False)
        with self.assertRaises(VoiceError):
            self.catalog.delete('preset')

    def test_atomic_failure_does_not_publish_or_lose_old_voice(self):
        self.create()
        old = self.catalog.resolve('my-voice')
        before = self.catalog.index.read_bytes()
        with patch('managed_voices.os.replace', side_effect=OSError('test full disk')):
            with self.assertRaises(OSError):
                self.catalog.put(dict(label='不该生效'), 'my-voice', create=False)
        self.assertEqual(old, self.catalog.resolve('my-voice'))
        self.assertEqual(before, self.catalog.index.read_bytes())

    def test_concurrent_creates_preserve_all_rows(self):
        errors = []
        def create(i):
            try:
                self.catalog.put(dict(id=f'voice-{i}', audio=audio(), reference_text='原文。'))
            except Exception as exc:
                errors.append(exc)
        threads = [threading.Thread(target=create, args=(i,)) for i in range(6)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(errors, [])
        self.assertEqual(len(ManagedVoiceCatalog(self.cfg).references), 7)

    def test_wav_resampling_and_invalid_input(self):
        self.catalog.put(dict(id='resampled', audio=audio(44100), reference_text='原文。'))
        self.assertEqual(sf.info(self.catalog.resolve('resampled').reference_file).samplerate, 24000)
        for body in [dict(audio=b'bad', reference_text='原文'), dict(audio=audio()),
                     dict(audio=audio(), reference_text='原文', id='../escape'),
                     dict(reference_file='/etc/passwd', reference_text='原文')]:
            with self.assertRaises(VoiceError):
                self.catalog.put(body)

    def test_json_base64_and_multipart(self):
        raw = audio()
        result = parse_upload('application/json', json.dumps(dict(reference_audio=base64.b64encode(raw).decode(), reference_text='原文。')).encode())
        self.assertEqual(result['audio'], raw)
        multipart = (b'--test\r\nContent-Disposition: form-data; name="file"; filename="voice.wav"\r\nContent-Type: audio/wav\r\n\r\n' + raw + b'\r\n--test\r\nContent-Disposition: form-data; name="reference_text"\r\n\r\n' + '原文。'.encode() + b'\r\n--test--\r\n')
        result = parse_upload('multipart/form-data; boundary=test', multipart)
        self.assertEqual(result['audio'], raw)
        self.assertEqual(result['reference_text'], '原文。')

    def test_cache_keys_change_for_audio_and_transcript(self):
        self.create()
        engine = VoiceEngine.__new__(VoiceEngine)
        engine.voices, engine.voice, engine.config = self.catalog, 'preset', {}
        engine._prompt_caches, engine.max_cached_voices = OrderedDict(), 2
        engine.cuda_stream = None
        counter = []
        def cache(**kwargs):
            counter.append(kwargs)
            return dict(mode='ref_continuation', count=len(counter))
        engine.model = SimpleNamespace(tts_model=SimpleNamespace(build_prompt_cache=cache))
        engine._voice_caches('preset')
        old = self.catalog.resolve('my-voice')
        first = engine._voice_caches(old)
        self.catalog.put(dict(reference_text='不同原文'), 'my-voice', create=False)
        second = engine._voice_caches('my-voice')
        self.assertNotEqual(first, second)
        third = engine._voice_caches(old)
        self.assertNotEqual(third, second)
        self.assertIn('preset', engine.cached_voice_ids)
        self.assertEqual(len(engine._prompt_caches), 2)

    def test_real_http_create_update_delete_cors_and_404(self):
        engine = SimpleNamespace(voices=self.catalog)
        server = VoiceServer(('127.0.0.1', 0), engine)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f'http://127.0.0.1:{server.server_address[1]}/v1/audio/voices'
        def request(method, suffix='', data=None):
            req = Request(base + suffix, method=method, data=json.dumps(data).encode() if data is not None else None,
                          headers={'Content-Type': 'application/json'})
            with urlopen(req, timeout=5) as reply:
                return reply.status, reply.read(), reply.headers
        try:
            status, body, headers = request('POST', data=dict(id='http', reference_audio=base64.b64encode(audio()).decode(), reference_text='原文。'))
            self.assertEqual(status, 201)
            self.assertEqual(headers['Access-Control-Allow-Origin'], '*')
            self.assertEqual(request('GET', '/http/audio')[1][:4], b'RIFF')
            self.assertEqual(request('PUT', '/http', dict(label='更名'))[0], 200)
            self.assertEqual(request('OPTIONS')[0], 204)
            self.assertEqual(request('DELETE', '/http')[0], 200)
            with self.assertRaises(HTTPError) as fail:
                request('GET', '/http')
            self.assertEqual(fail.exception.code, 404)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_uploaded_voice_reaches_regular_and_streaming_speech(self):
        self.create()
        seen = []
        engine = SimpleNamespace(voices=self.catalog, config={'segment_chars': 80},
                                 metrics=SynthesisMetrics(), lock=threading.Lock(),
                                 rate=24000, completed=0, failed=0, cancelled=0)
        def generate(text, seed, *, voice, **kwargs):
            seen.append(voice)
            yield b'\x01\x00' * 2400
        engine.generate = generate
        server = VoiceServer(('127.0.0.1', 0), engine)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            for suffix in ('', '/stream'):
                req = Request(f'http://127.0.0.1:{server.server_address[1]}/v1/audio/speech{suffix}',
                              data=json.dumps({'input': '你好。', 'voice': 'my-voice'}).encode(),
                              headers={'Content-Type': 'application/json'})
                with urlopen(req, timeout=5) as reply:
                    self.assertEqual(reply.read()[:4], b'RIFF')
            self.assertEqual(engine.completed, 2)
            self.assertTrue(all(ref.id == 'my-voice' and ref.reference_text == '参考音原文。' for ref in seen))
            self.assertEqual(engine.last_request['reference_sha256'], self.catalog.resolve('my-voice').reference_sha256)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_invalid_and_silent_audio_never_registers(self):
        silent = io.BytesIO()
        sf.write(silent, np.zeros(24000), 24000, format='WAV')
        with self.assertRaises(VoiceError):
            self.catalog.put(dict(audio=silent.getvalue(), reference_text='原文。'))
        for raw in [b'[]', b'{"reference_audio":"!!!"}']:
            with self.assertRaises(ValueError):
                parse_upload('application/json', raw)
        self.assertEqual(list(self.catalog.references), ['preset'])


if __name__ == '__main__':
    unittest.main()

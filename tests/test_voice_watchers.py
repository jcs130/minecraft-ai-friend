"""Offline voice path and queue-publication tests; no audio or services are used."""
import importlib.util
import json
import os
import sys
import wave
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('voice_paths', ROOT/'world/sidecar/voice_paths.py')
voice = importlib.util.module_from_spec(spec)
spec.loader.exec_module(voice)


class VoiceIsolation(unittest.TestCase):
    def test_paths_must_be_explicit_and_isolated(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(RuntimeError): voice.voice_root()
        with patch.dict(os.environ, {'GV_BASE':'C:/production/godvoice'}):
            with self.assertRaises(RuntimeError): voice.voice_root()
        expected = ROOT/'server/mc/data/godvoice' if os.name=='nt' else Path('/godvoice')
        with patch.dict(os.environ, {'GV_BASE':str(expected),'MIC_BASE':str(expected/'mic')}):
            self.assertEqual(voice.voice_root(), expected.resolve())
            self.assertEqual(voice.voice_root('MIC_BASE','mic'), (expected/'mic').resolve())

    def test_tts_only_existing_local_endpoint(self):
        self.assertEqual(voice.local_tts_url('http://host.docker.internal:8100/'), 'http://host.docker.internal:8100')
        for url in ['http://remote:8100', 'http://localhost:8080', 'http://user:secret@localhost:8100', 'http://localhost:8100/path']:
            with self.assertRaises(RuntimeError): voice.local_tts_url(url)

    def test_ids_cannot_escape_output_queue(self):
        self.assertEqual(voice.job_id('voice-123_abc'), 'voice-123_abc')
        for value in ['../../escape', 'foo/bar', 'foo\\bar', '', 'bad.json', 'x'*121]:
            with self.assertRaises(ValueError): voice.job_id(value)

    def test_queue_json_publishes_complete_file(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'runtime') as temp:
            path=Path(temp)/'job.json'
            voice.atomic_json(path, {'text':'hello','id':'test'})
            self.assertEqual(json.loads(path.read_text(encoding='utf-8')), {'text':'hello','id':'test'})
            self.assertFalse(path.with_name('job.json.tmp').exists())


class AsrRecordingQueue(unittest.TestCase):
    """Exercise the watcher's real file claim/filter/publish/retry logic."""
    NOW = 1_800_000_000_000

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=ROOT/'runtime')
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        module_spec = importlib.util.spec_from_file_location('voice_asr_under_test', ROOT/'world/sidecar/mic_asr_watcher.py')
        self.asr = importlib.util.module_from_spec(module_spec)
        with patch.dict(sys.modules, {'voice_paths': voice}), patch.object(voice, 'voice_root', return_value=self.base), \
                patch.dict(os.environ, {'VOICE_ALLOWED_PLAYERS': 'MengMeng'}):
            module_spec.loader.exec_module(self.asr)
        for name in ['inbox', 'outbox', 'processed', 'processing']:
            (self.base/name).mkdir()
        self.clock = patch.object(self.asr.time, 'time', return_value=self.NOW/1000).start()
        self.addCleanup(patch.stopall)
        patch.object(self.asr.time, 'sleep').start()
        self.recognize = patch.object(self.asr, 'transcribe', return_value='咏唱：烟花术').start()

    def recording(self, name='voice-123', metadata=None, seconds=1):
        path = self.base/'inbox'/f'{name}.wav'
        with wave.open(str(path), 'wb') as audio:
            audio.setnchannels(1); audio.setsampwidth(2); audio.setframerate(16000)
            audio.writeframes(b'\0\0' * int(16000*seconds))
        os.utime(path, (self.NOW/1000, self.NOW/1000))
        if metadata is not False:
            value = metadata if metadata is not None else self.metadata(samples=int(16000*seconds))
            path.with_suffix('.txt').write_text(json.dumps(value), encoding='utf-8')
        return path

    def metadata(self, **changes):
        return {'schema': 2, 'player': 'MengMeng', 'ts': self.NOW-2500,
                'recordingEndedAt': self.NOW-1500, 'emittedAt': self.NOW-100, 'samples': 16000, **changes}

    def run_recording(self, path):
        return self.asr.process_recording(object(), str(path))

    def test_capture_metadata_time_survives_real_queue_publication(self):
        path = self.recording()
        def recognition(_rec, _path):
            self.clock.return_value = (self.NOW+2750)/1000
            return '咏唱：烟花术'
        self.recognize.side_effect = recognition
        self.assertEqual(self.run_recording(path), 'published')
        output = json.loads((self.base/'outbox/voice-123.json').read_text(encoding='utf-8'))
        self.assertEqual(output, {'schema': 2, 'id': 'voice-123', 'player': 'MengMeng', 'text': '咏唱：烟花术',
            'ts': self.NOW+2750, 'recordedAt': self.NOW-2500, 'recordingEndedAt': self.NOW-1500,
            'emittedAt': self.NOW-100, 'wav': 'voice-123.wav'})
        self.assertTrue((self.base/'processed/voice-123.wav').exists())

    def test_missing_invalid_timestamp_never_reaches_recognizer(self):
        for index, timestamp in enumerate([None, True, '1800000000000', 0, -1, 1.5,
                                           float('nan'), float('inf'), 9_007_199_254_740_992, 10**400]):
            with self.subTest(timestamp=timestamp):
                path = self.recording(f'invalid-{index}', self.metadata(ts=timestamp))
                self.assertEqual(self.run_recording(path), 'invalid_recorded_at')
        self.recognize.assert_not_called()

    def test_stale_and_future_recordings_rejected(self):
        for name, timestamp, code in [('old', self.NOW-120001, 'stale_recording'), ('future', self.NOW+1, 'future_recording')]:
            path = self.recording(name, self.metadata(ts=timestamp))
            self.assertEqual(self.run_recording(path), code)
        self.recognize.assert_not_called()

    def test_120_second_boundary_and_normal_recognition_latency(self):
        path = self.recording(metadata=self.metadata(ts=self.NOW-120000))
        def recognition(_rec, _path):
            self.clock.return_value = (self.NOW+4000)/1000
            return '查状态'
        self.recognize.side_effect = recognition
        self.assertEqual(self.run_recording(path), 'published')
        output = json.loads((self.base/'outbox/voice-123.json').read_text(encoding='utf-8'))
        self.assertEqual(output['recordedAt'], self.NOW-120000)
        self.assertEqual(output['ts'], self.NOW+4000)

    def test_identity_is_never_defaulted_or_case_folded(self):
        for index, player in enumerate([None, '', 'QDGuildProbe', 'mengmeng', ['MengMeng']]):
            path = self.recording(f'identity-{index}', self.metadata(player=player))
            self.assertEqual(self.run_recording(path), 'player_not_allowed')
        self.recognize.assert_not_called()
        self.assertEqual(self.asr.VOICE_ALLOWED_PLAYERS, {'MengMeng'})

    def test_old_or_missing_schema_is_never_inferred_from_emission_time(self):
        for index, schema in enumerate([None, 1, True, '2', 2.0, 3]):
            with self.subTest(schema=schema):
                path = self.recording(f'schema-{index}', self.metadata(schema=schema))
                self.assertEqual(self.run_recording(path), 'unsupported_recording_schema')
        legacy = self.recording('schema-missing', {'player': 'MengMeng', 'ts': self.NOW-500, 'samples': 16000})
        self.assertEqual(self.run_recording(legacy), 'unsupported_recording_schema')
        self.recognize.assert_not_called()

    def test_end_and_emission_require_valid_bounded_integer_timestamps(self):
        for key in ['recordingEndedAt', 'emittedAt']:
            for index, stamp in enumerate([None, True, '1800000000000', 0, -1, 1.5,
                                           float('nan'), float('inf'), 9_007_199_254_740_992, 10**400]):
                with self.subTest(key=key, stamp=stamp):
                    path = self.recording(f'{key}-{index}', self.metadata(**{key: stamp}))
                    self.assertEqual(self.run_recording(path), 'invalid_recording_interval')
        self.recognize.assert_not_called()

    def test_capture_interval_ordering_and_future_bounds(self):
        invalid = [
            ({'ts': self.NOW-1499}, 'invalid_recording_interval'),
            ({'recordingEndedAt': self.NOW-99}, 'invalid_recording_interval'),
            ({'emittedAt': self.NOW-1501}, 'invalid_recording_interval'),
            ({'recordingEndedAt': self.NOW+1}, 'future_recording'),
            ({'emittedAt': self.NOW+1}, 'future_recording'),
        ]
        for index, (change, code) in enumerate(invalid):
            with self.subTest(change=change):
                self.assertEqual(self.run_recording(self.recording(f'order-{index}', self.metadata(**change))), code)
        self.recognize.assert_not_called()
        equal = self.recording('equal-times', self.metadata(ts=self.NOW, recordingEndedAt=self.NOW, emittedAt=self.NOW))
        self.assertEqual(self.run_recording(equal), 'published')

    def test_missing_interval_fields_are_not_guessed_from_wav_duration(self):
        for key in ['recordingEndedAt', 'emittedAt']:
            metadata = self.metadata()
            del metadata[key]
            self.assertEqual(self.run_recording(self.recording('missing-'+key, metadata)), 'invalid_recording_interval')
        self.recognize.assert_not_called()

    def test_retry_keeps_exact_capture_start_end_and_emission(self):
        path = self.recording()
        original = path.with_suffix('.txt').read_bytes()
        self.recognize.side_effect = RuntimeError('offline retry')
        self.assertEqual(self.run_recording(path), 'asr_retry')
        self.assertEqual((self.base/'processing/voice-123.txt').read_bytes(), original)
        self.recognize.side_effect = None
        self.clock.return_value = (self.NOW+5000)/1000
        self.assertEqual(self.run_recording(path), 'published')
        output = json.loads((self.base/'outbox/voice-123.json').read_text(encoding='utf-8'))
        self.assertEqual(output['recordedAt'], self.NOW-2500)
        self.assertEqual(output['recordingEndedAt'], self.NOW-1500)
        self.assertEqual(output['emittedAt'], self.NOW-100)
        self.assertEqual(output['ts'], self.NOW+5000)

    def test_missing_metadata_waits_briefly_then_rejects_without_identity(self):
        path = self.recording(metadata=False)
        self.assertEqual(self.run_recording(path), 'metadata_pending')
        self.assertTrue(path.exists())
        self.clock.return_value = (self.NOW+6000)/1000
        self.assertEqual(self.run_recording(path), 'missing_metadata')
        self.recognize.assert_not_called()

    def test_audio_too_short_or_long_is_not_transcribed(self):
        for name, seconds, code in [('tap', 0.1, 'short_recording'), ('long', 120.1, 'long_recording')]:
            self.assertEqual(self.run_recording(self.recording(name, seconds=seconds)), code)
        self.recognize.assert_not_called()

    def test_filename_id_is_bounded_and_cannot_escape(self):
        for name in ['bad.name', 'bad name', 'x'*101]:
            self.assertEqual(self.run_recording(self.recording(name)), 'invalid_filename')
        self.assertEqual(self.asr.process_recording(None, str(self.base/'outside.wav')), 'invalid_path')
        self.recognize.assert_not_called()

    def test_replayed_id_after_outbox_consumption_is_not_republished(self):
        path = self.recording()
        self.assertEqual(self.run_recording(path), 'published')
        archived_meta = (self.base/'processed/voice-123.txt').read_bytes()
        (self.base/'outbox/voice-123.json').unlink()  # Simulate world consuming it.
        self.assertEqual(self.run_recording(self.recording()), 'duplicate_recording')
        self.assertFalse((self.base/'outbox/voice-123.json').exists())
        self.assertEqual((self.base/'processed/voice-123.txt').read_bytes(), archived_meta)
        self.assertEqual(self.recognize.call_count, 1)

    def test_retry_preserves_recording_identity_and_age(self):
        path = self.recording()
        self.recognize.side_effect = RuntimeError('recognizer temporarily unavailable')
        self.assertEqual(self.run_recording(path), 'asr_retry')
        self.assertTrue(path.exists())
        self.clock.return_value = (self.NOW+120000)/1000
        self.recognize.side_effect = None
        self.assertEqual(self.run_recording(path), 'stale_recording')
        self.assertEqual(self.recognize.call_count, 1)

    def test_publication_uncertainty_does_not_replay_possible_command(self):
        path = self.recording()
        original = self.asr.atomic_json
        def publish(output, data):
            if Path(output).parent.name == 'outbox':
                raise OSError('simulated publication failure')
            return original(output, data)
        with patch.object(self.asr, 'atomic_json', side_effect=publish):
            self.assertEqual(self.run_recording(path), 'publication_uncertain')
        self.assertEqual(self.run_recording(self.recording()), 'duplicate_recording')
        self.assertEqual(self.recognize.call_count, 1)

    def test_seen_history_is_bounded_and_has_no_transcript(self):
        self.asr.SEEN_LIMIT = 2
        for number in range(3):
            self.assertEqual(self.run_recording(self.recording(f'job-{number}')), 'published')
            self.clock.return_value += 1
        seen = json.loads((self.base/'.asr-seen.json').read_text(encoding='utf-8'))
        self.assertEqual(list(seen), ['job-1', 'job-2'])
        self.assertTrue(all(isinstance(value, int) for value in seen.values()))

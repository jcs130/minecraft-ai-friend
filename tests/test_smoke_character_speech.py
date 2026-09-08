import importlib.util
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('speech_smoke_under_test', ROOT / 'tools/smoke_character_speech.py')
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)


class CharacterSpeechSmokeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def put(self, relative, value):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value), encoding='utf-8')
        return path

    def native(self):
        return [{'name': name, 'enabled': True} for name in smoke.TOOLS]

    def test_actual_python_fixtures_use_no_network_or_model(self):
        with patch.object(smoke, 'http', side_effect=AssertionError('network prohibited')):
            result = smoke.isolated_contracts(ROOT)
        self.assertEqual(set(result), {'actor-voice-isolation', 'lease-bound-speech', 'late-synthesis-cancelled'})
        self.assertTrue(result['actor-voice-isolation']['crossActorReceiptRejected'])
        self.assertFalse(result['actor-voice-isolation']['productionQueueWritten'])
        self.assertTrue(result['lease-bound-speech']['actionLeaseUnchanged'])
        self.assertFalse(result['late-synthesis-cancelled']['nativeJobPublished'])

    def test_native_api_exact_agent_header_and_enabled_tools(self):
        calls = []
        def fetch(url, headers):
            calls.append((url, headers))
            return self.native()
        result = smoke.native_tools(fetch)
        self.assertEqual(result['modelRequests'], 0)
        self.assertEqual(calls, [('http://127.0.0.1:18089/api/mcp/tools/numen_survival', {'X-Agent-Id': 'qd-survivor'})])
        for rows in (self.native()[:2], [dict(row, enabled=False) for row in self.native()], self.native() + self.native()):
            with self.subTest(rows=rows), self.assertRaisesRegex(ValueError, 'native_speech_tools_unavailable'):
                smoke.native_tools(lambda *_: rows)

    def build(self):
        source = self.root / 'world/god-voice-src'
        files = []
        for name in ('build.py', 'source-origin.json', 'META-INF/neoforge.mods.toml',
                     'dev/god/godvoice/TtsQueueWatcher.java', 'dev/god/godvoice/SpeechHealth.java',
                     'tests/SpeechContractTest.java', 'tests/SpeechHealthTest.java'):
            path = source / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('isolated fixture ' + name)
            files.append({'path': path.relative_to(self.root).as_posix(), 'sha256': smoke.digest(path)})
        jar = self.root / 'runtime/build/god-voice-0.1.0.jar'
        jar.parent.mkdir(parents=True, exist_ok=True)
        jar.write_bytes(b'isolated-build-artifact')
        deployed = self.root / 'server/mc/mods/god-voice-0.1.0.jar'
        deployed.parent.mkdir(parents=True, exist_ok=True)
        deployed.write_bytes(jar.read_bytes())
        svc = deployed.parent / smoke.SVC
        svc.write_bytes(b'isolated-svc-dependency')
        results = {'CaptureFenceTest': 19, 'CaptureIntervalTest': 15, 'SpeechContractTest': 21,
            'SpeechQueueTest': 21, 'SpeechAudioPlayerContractTest': 8, 'SpeechHealthTest': 23,
            'StaffBoundaryRegistrationTest_absent': 3, 'StaffBoundaryRegistrationTest_present': 4}
        value = {'ok': True, 'speech_schema': 2, 'speech_protocol': 2, 'jar': str(jar), 'sha256': smoke.digest(jar),
            'tests': {name: {'ok': True, 'assertions': count} for name, count in results.items()},
            'source_files': files, 'unchanged_server_bytecode': {name: True for name in ('Mic', 'Fence', 'Mod', 'Plugin')},
            'classpath': [{'path': str(svc), 'sha256': smoke.digest(svc)}]}
        value['tests']['SpeechAudioPlayerContractTest']['liveAudio'] = False
        return self.put('runtime/build/build-record.json', value)

    def test_build_requires_installed_jar_and_exact_current_source(self):
        record = self.build()
        valid = smoke.validate_build(self.root, record)
        self.assertEqual(valid['assertions'], 114)
        source = self.root / 'world/god-voice-src/dev/god/godvoice/TtsQueueWatcher.java'
        source.write_text('changed after tests')
        with self.assertRaisesRegex(ValueError, 'speech_build_source_changed'):
            smoke.validate_build(self.root, record)

    def test_new_untested_source_cannot_reuse_old_green_record(self):
        record = self.build()
        (self.root / 'world/god-voice-src/dev/god/godvoice/NewSpeech.java').write_text('untested')
        with self.assertRaisesRegex(ValueError, 'speech_build_source_coverage_mismatch'):
            smoke.validate_build(self.root, record)

    def test_new_health_writer_proof_is_required(self):
        record = self.build()
        original = json.loads(record.read_text())
        for proof in (None, {'ok': False, 'assertions': 23}, {'ok': True, 'assertions': 22}):
            with self.subTest(proof=proof):
                value = json.loads(json.dumps(original))
                if proof is None:
                    value['tests'].pop('SpeechHealthTest')
                else:
                    value['tests']['SpeechHealthTest'] = proof
                record.write_text(json.dumps(value))
                with self.assertRaisesRegex(ValueError, 'speech_build_tests_incomplete'):
                    smoke.validate_build(self.root, record)

    def test_jar_mismatch_and_incomplete_assertions_are_rejected(self):
        record = self.build()
        deployed = self.root / 'server/mc/mods/god-voice-0.1.0.jar'
        original = deployed.read_bytes()
        deployed.write_bytes(b'old deployed jar')
        with self.assertRaisesRegex(ValueError, 'installed_speech_jar_mismatch'):
            smoke.validate_build(self.root, record)
        deployed.write_bytes(original)
        value = json.loads(record.read_text())
        value['tests']['SpeechQueueTest']['assertions'] = 1
        record.write_text(json.dumps(value))
        with self.assertRaisesRegex(ValueError, 'speech_build_tests_incomplete'):
            smoke.validate_build(self.root, record)

    def test_stale_or_legacy_live_protocol_never_green_from_report_alone(self):
        record = self.build()
        for value in ({'schema': 1}, {'schema': 2, 'protocol': 2, 'updatedAt': 1, 'activeCount': 0, 'queuedCount': 0}):
            self.put('server/mc/data/godvoice/.speech-health.json', value)
            with self.assertRaisesRegex(ValueError, 'live_speech_protocol_unavailable'):
                smoke.playback_contract(self.root, record, clock=lambda: 1000)
        self.put('server/mc/data/godvoice/.speech-health.json', {'schema': 2, 'protocol': 2, 'updatedAt': 1000000,
            'activeCount': 1, 'queuedCount': 3})
        self.assertEqual(smoke.playback_contract(self.root, record, clock=lambda: 1000)['queuedCount'], 3)

    def audio(self):
        for name, data in [('world/tts/tts_api.py', b'api'), ('server/mc/mods/' + smoke.MAID, b'maid'),
                           ('server/mc/mods/' + smoke.SVC, b'svc'), ('runtime/audio/maid.mp3', b'ID3qa'),
                           ('runtime/audio/legacy.wav', b'RIFFqa')]:
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        value = {'ok': True, 'mode': 'isolated_http_with_one_local_tts', 'llmRequests': 0,
            'localTtsRequests': 1, 'audioPlayback': False, 'isolatedServerStopped': True, 'maidMp3Bytes': 5,
            'apiSha256': smoke.digest(self.root / 'world/tts/tts_api.py'),
            'installedMaidJarSha256': smoke.digest(self.root / 'server/mc/mods' / smoke.MAID)}
        return self.put('runtime/audio/result.json', value)

    def health(self, *_):
        return {'ok': True, 'apiVersion': 2, 'maidEndpoint': '/tts/maid', 'maidMediaType': 'audio/mpeg'}

    def test_default_audio_validates_source_then_redecodes_without_post(self):
        evidence = self.audio()
        decoded = []
        result = smoke.audio_contract(self.root, self.root / 'runtime', evidence, fetch=self.health,
            request=lambda *_: self.fail('default must not POST'),
            decode=lambda root, work, audio: (decoded.append(audio) or {'ok': True, 'playback': False}))
        self.assertEqual(result['localTtsRequests'], 0)
        self.assertEqual(decoded, [evidence.parent / 'maid.mp3'])
        (self.root / 'world/tts/tts_api.py').write_text('changed')
        with self.assertRaisesRegex(ValueError, 'prior_audio_source_or_jar_changed'):
            smoke.audio_contract(self.root, self.root / 'runtime', evidence, fetch=self.health)

    def test_synthesis_is_one_request_and_mime_rejected_without_decode(self):
        self.audio()
        calls = []
        def request(url, payload):
            calls.append((url, payload))
            return b'RIFFnot-mp3', 'audio/wav'
        with self.assertRaisesRegex(ValueError, 'local_tts_mp3_invalid'):
            smoke.audio_contract(self.root, self.root / 'runtime', synthesize=True, fetch=self.health, request=request,
                decode=lambda *_: self.fail('bad audio cannot be decoded'))
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][0], 'http://127.0.0.1:8100/tts/maid')

    def test_read_only_failure_prevents_live_exercise(self):
        with patch.object(smoke, 'isolated_contracts', return_value={name: {'level': 'test'} for name in smoke.CHECKS[1:4]}), \
             patch.object(smoke, 'playback_contract', side_effect=ValueError('old_player')), \
             patch.object(smoke, 'audio_contract', return_value={'level': 'test'}), \
             patch.object(smoke, 'exercise', side_effect=AssertionError('must not exercise')):
            report = smoke.run(self.root, fetch=lambda *_: self.native(), exercise_project='qiandengji')
        self.assertFalse(report['ok'])
        self.assertFalse(report['productionSpeechSubmitted'])
        self.assertEqual(report['exercise']['error'], 'read_only_prerequisites_failed')
        self.assertEqual({row['name'] for row in report['checks']}, set(smoke.CHECKS))

    def test_no_listeners_in_exercise_is_failure_and_production_lease_unchanged(self):
        actor = '11111111-1111-4111-8111-111111111111'
        self.put('server/survival-agent-state/survival/settings.json', {'bodyName': 'Kirito', 'bodyUuid': actor})
        self.put('server/survival-agent-state/survival/lease.json', {'untouched': 'production'})
        self.put('server/survival-agent-state/survival/control.json', {'enabled': False})
        self.put('server/mc/data/godvoice/speech-profiles.json', {'schema': 1, 'actors': {
            actor: {'enabled': True, 'voiceId': 'qa_voice', 'version': 'v1'}}})
        work = self.root / 'runtime/isolated'
        work.mkdir(parents=True)
        _, _, _, _, read, write = smoke.load_shared(ROOT)
        def rcon(args, timeout):
            value = args[-1]
            if value == 'numen_act list':
                return 'count=1\nKirito|uuid=' + actor
            self.assertEqual(value, 'numen_act invoke "Kirito" get_self_status {}')
            return json.dumps({'dimension': 'minecraft:overworld'})
        def tick(_):
            request = next((self.root / 'server/mc/data/godvoice/speech-requests').glob('*.json'))
            job = read(request)
            write(self.root / 'server/mc/data/godvoice/speech-receipts' / request.name,
                {'schema': 2, 'id': job['id'], 'entity': actor, 'generation': job['generation'],
                 'status': 'failed', 'code': 'no_voicechat_listeners', 'updatedAt': int(time.time() * 1000)})
        with patch.object(smoke, 'command', side_effect=rcon), patch.object(smoke.time, 'sleep', side_effect=tick):
            result = smoke.exercise(self.root, work, 'qiandengji', wait_seconds=1)
        self.assertFalse(result['ok'])
        self.assertEqual(result['receipt']['code'], 'no_voicechat_listeners')
        self.assertTrue(result['productionLeaseAndBudgetUnchanged'])
        self.assertFalse(result['physicalListeningConfirmedByHuman'])


if __name__ == '__main__':
    unittest.main()

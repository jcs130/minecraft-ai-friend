import hashlib
import json
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/sidecar'))
from character_speech import SpeechBroker, SpeechWorker, read, write, delivery_order
import character_speech

ALICE = '11111111-1111-4111-8111-111111111111'
BOB = '22222222-2222-4222-8222-222222222222'


class SpeechTest(unittest.TestCase):
    def test_bind_mounted_speech_copies_have_identical_bytes(self):
        source = (ROOT / 'world/sidecar/character_speech.py').read_bytes()
        survivor = (ROOT / 'world/survival/character_speech.py').read_bytes()
        self.assertEqual(hashlib.sha256(source).digest(), hashlib.sha256(survivor).digest())

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.now = time.time()
        self.broker = SpeechBroker(self.root, clock=lambda: self.now)
        write(self.root / 'speech-profiles.json', {'schema': 1, 'actors': {
            actor: {'enabled': True, 'voiceId': voice, 'version': 'v1'}
            for actor, voice in [(ALICE, 'cosy_male'), (BOB, 'goddess')]}})
        self.calls = []

    def audio(self, text, voice):
        self.calls.append((text, voice))
        return b'ID3-test-audio'

    def submit(self, key='turn1', text='收到。', actor=ALICE, **kwargs):
        return self.broker.submit(actor, key, text, 'minecraft:overworld', **kwargs)

    def job(self, result):
        return read(self.root / 'speech-requests' / (result['utteranceId'] + '.json'))

    def test_idempotence_and_conflict(self):
        one = self.submit()
        self.assertEqual(one['utteranceId'], self.submit()['utteranceId'])
        with self.assertRaisesRegex(ValueError, 'conflict'):
            self.submit(text='不同的台词')
        self.assertEqual(len(list((self.root / 'text-queue').glob('*.json'))), 1)

    def test_missing_profile_and_cross_actor_receipt(self):
        one = self.submit()
        with self.assertRaisesRegex(ValueError, 'not_owned'):
            self.broker.receipt(BOB, one['utteranceId'])
        with self.assertRaisesRegex(ValueError, 'profile_unavailable'):
            self.submit(actor='33333333-3333-4333-8333-333333333333')

    def test_invalid_inputs(self):
        for text in ('', 'a' * 161, 'bad\ntext', '\0'):
            with self.subTest(text=text), self.assertRaises(ValueError):
                self.submit(text=text)
        with self.assertRaises(ValueError):
            self.broker.submit(ALICE, 'a', 'hello', '../world')

    def test_rate_and_bounded_queue(self):
        self.submit()
        with self.assertRaisesRegex(ValueError, 'rate_limited'):
            self.submit(key='turn2')
        for index in range(1, 5):
            self.now += 11
            self.submit(key='turn' + str(index + 1))
        self.now += 11
        with self.assertRaisesRegex(ValueError, 'queue_full'):
            self.submit(key='turn6')

    def test_hot_submit_never_scans_history_and_freshly_checks_active_receipts(self):
        one = self.submit()
        self.now += 11
        other_broker = SpeechBroker(self.root, clock=lambda: self.now)
        with patch.object(Path, 'glob', side_effect=AssertionError('hot global scan')):
            two = other_broker.submit(ALICE, 'two', 'two', 'minecraft:overworld')
            self.assertEqual(other_broker.submit(ALICE, 'two', 'two', 'minecraft:overworld')['utteranceId'], two['utteranceId'])
            with self.assertRaisesRegex(ValueError, 'rate_limited'):
                self.submit(key='three')
            SpeechWorker(self.broker, self.audio).report(self.job(one), 'completed')
            self.now += 11
            self.submit(key='three')
        state = read(self.root / 'speech-state' / (ALICE + '.json'))
        self.assertEqual(len(state['recentIndex']['reservations']), 2)

    def test_legacy_state_rebuild_preserves_rate_and_full_queue(self):
        for index in range(5):
            self.submit(key=str(index))
            self.now += 11
        state_path = self.root / 'speech-state' / (ALICE + '.json')
        state = read(state_path)
        state.pop('recentIndex', None)
        write(state_path, state)
        before = state_path.read_bytes()
        preview = self.broker.index_preview(ALICE)
        self.assertTrue(preview['needsRebuild'])
        self.assertEqual(preview['activeCount'], 5)
        self.assertEqual(state_path.read_bytes(), before)
        with self.assertRaisesRegex(ValueError, 'queue_full'):
            self.submit(key='six')
        self.assertIn('recentIndex', read(state_path))
        with patch.object(Path, 'glob', side_effect=AssertionError('rebuilt index rescanned')):
            with self.assertRaisesRegex(ValueError, 'queue_full'):
                self.submit(key='six')

    def test_corrupt_index_is_not_an_empty_queue(self):
        self.submit()
        self.now += 11
        state_path = self.root / 'speech-state' / (ALICE + '.json')
        state = read(state_path)
        state['recentIndex'] = {'schema': 1, 'reservations': []}
        write(state_path, state)
        with self.assertRaisesRegex(ValueError, 'speech_index_invalid'):
            self.submit(key='new')
        self.assertEqual(len(list((self.root / 'text-queue').glob('*.json'))), 1)

    def test_explicit_migration_preserves_generation_history_and_does_not_dispatch(self):
        one = self.submit()
        state_path = self.root / 'speech-state' / (ALICE + '.json')
        legacy = read(state_path)
        legacy.pop('recentIndex')
        write(state_path, legacy)
        before = {str(path.relative_to(self.root)): path.read_bytes()
                  for folder in ('speech-requests', 'text-queue') for path in (self.root / folder).glob('*.json')}
        self.assertTrue(self.broker.migrate_recent(ALICE)['needsRebuild'])
        self.assertEqual(read(state_path), legacy)
        result = self.broker.migrate_recent(ALICE, dry_run=False)
        self.assertTrue(result['migrated'])
        self.assertFalse(result['dispatched'])
        self.assertEqual(self.broker.generation(ALICE), legacy['generation'])
        after = {str(path.relative_to(self.root)): path.read_bytes()
                 for folder in ('speech-requests', 'text-queue') for path in (self.root / folder).glob('*.json')}
        self.assertEqual(before, after)
        with patch.object(Path, 'glob', side_effect=AssertionError('migration repeated global scan')):
            self.assertFalse(self.broker.migrate_recent(ALICE, dry_run=False)['migrated'])
            self.assertEqual(self.submit()['utteranceId'], one['utteranceId'])
            with self.assertRaisesRegex(ValueError, 'rate_limited'):
                self.submit(key='too-soon')

    def test_live_receipt_completion_frees_exactly_one_full_queue_slot(self):
        jobs = []
        for index in range(5):
            jobs.append(self.job(self.submit(key=str(index))))
            self.now += 11
        second = SpeechBroker(self.root, clock=lambda: self.now)
        with self.assertRaisesRegex(ValueError, 'queue_full'):
            second.submit(ALICE, 'six', 'six', 'minecraft:overworld')
        SpeechWorker(self.broker, self.audio).report(jobs[0], 'completed')
        with patch.object(Path, 'glob', side_effect=AssertionError('receipt refresh scanned history')):
            fresh = second.submit(ALICE, 'six', 'six', 'minecraft:overworld')
        self.assertEqual(fresh['status'], 'queued')
        state = read(self.root / 'speech-state' / (ALICE + '.json'))
        self.assertEqual(len(state['recentIndex']['reservations']), 5)
        self.assertNotIn(jobs[0]['id'], [row['id'] for row in state['recentIndex']['reservations']])

    def test_cancel_keeps_rate_and_durable_unknown_identity(self):
        def fail_after_index(path, value):
            write(path, value)
            if path.parent.name == 'speech-state':
                raise OSError('after_index')
        with patch('character_speech.write', side_effect=fail_after_index):
            with self.assertRaises(OSError):
                self.submit()
        before = self.broker.generation(ALICE)
        self.broker.cancel(ALICE)
        self.assertEqual(self.broker.generation(ALICE), before + 1)
        self.assertEqual(self.submit()['status'], 'cancellation_requested')
        self.assertFalse(list((self.root / 'text-queue').glob('*.json')))
        with self.assertRaisesRegex(ValueError, 'rate_limited'):
            self.submit(key='next')
        self.now += 11
        self.assertEqual(self.submit(key='next')['status'], 'queued')

    def test_index_only_crash_is_visible_to_read_only_receipt(self):
        def fail_after_index(path, value):
            write(path, value)
            if path.parent.name == 'speech-state':
                raise OSError('after_index')
        with patch('character_speech.write', side_effect=fail_after_index):
            with self.assertRaises(OSError):
                self.submit()
        state = read(self.root / 'speech-state' / (ALICE + '.json'))
        speech_id = state['recentIndex']['reservations'][0]['id']
        with patch.object(Path, 'glob', side_effect=AssertionError('receipt must not scan')), \
                patch('character_speech.write', side_effect=AssertionError('receipt must not write')):
            result = self.broker.receipt(ALICE, speech_id)
            self.assertEqual(result['status'], 'unknown')
            self.assertEqual(result['code'], 'speech_submission_unconfirmed')
            self.assertFalse(result['retryAutomatically'])
            self.now += 91
            self.assertEqual(self.broker.receipt(ALICE, speech_id)['status'], 'expired')
        self.assertFalse((self.root / 'speech-requests' / (speech_id + '.json')).exists())
        self.assertFalse(list((self.root / 'text-queue').glob('*.json')))

    def test_zero_clock_still_enforces_rate(self):
        self.now = 0
        self.submit()
        with self.assertRaisesRegex(ValueError, 'rate_limited'):
            self.submit(key='next')

    def test_index_job_dispatch_crashes_never_replay_or_lose_admission(self):
        for stage in ('index', 'request', 'dispatch'):
            with self.subTest(stage=stage), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                write(root / 'speech-profiles.json', read(self.root / 'speech-profiles.json'))
                broker = SpeechBroker(root, clock=lambda: self.now)
                parent = {'index': 'speech-state', 'request': 'speech-requests', 'dispatch': 'text-queue'}[stage]
                def fail_after_commit(path, value):
                    write(path, value)
                    if path.parent.name == parent:
                        raise OSError('fixture_crash_after_' + stage)
                with patch('character_speech.write', side_effect=fail_after_commit):
                    with self.assertRaises(OSError):
                        broker.submit(ALICE, 'crash', 'crash', 'minecraft:overworld')
                count = len(list((root / 'text-queue').glob('*.json')))
                retry = broker.submit(ALICE, 'crash', 'crash', 'minecraft:overworld')
                self.assertIn(retry['status'], ('unknown', 'queued'))
                self.assertEqual(len(list((root / 'text-queue').glob('*.json'))), count)
                with self.assertRaisesRegex(ValueError, 'rate_limited'):
                    broker.submit(ALICE, 'different', 'different', 'minecraft:overworld')
                for index in range(4):
                    self.now += 11
                    broker.submit(ALICE, str(index), 'next', 'minecraft:overworld')
                self.now += 11
                with self.assertRaisesRegex(ValueError, 'queue_full'):
                    broker.submit(ALICE, 'overflow', 'overflow', 'minecraft:overworld')
                self.now += 91
                broker.submit(ALICE, 'after-expiry', 'after-expiry', 'minecraft:overworld')
                count = len(list((root / 'text-queue').glob('*.json')))
                retry = broker.submit(ALICE, 'crash', 'crash', 'minecraft:overworld')
                self.assertEqual(retry['status'], 'expired')
                self.assertEqual(len(list((root / 'text-queue').glob('*.json'))), count)

    def test_cancel_before_synthesis_never_calls_tts(self):
        one = self.submit()
        self.broker.cancel(ALICE)
        SpeechWorker(self.broker, self.audio).process(self.job(one))
        self.assertEqual(self.calls, [])
        self.assertEqual(self.broker.receipt(ALICE, one['utteranceId'])['status'], 'cancelled')

    def test_cancel_during_synthesis_discards_late_audio(self):
        one = self.submit()
        def synth(text, voice):
            self.broker.cancel(ALICE)
            return self.audio(text, voice)
        SpeechWorker(self.broker, synth).process(self.job(one))
        self.assertFalse(list((self.root / 'tts-queue').glob('*.json')))
        self.assertEqual(self.broker.receipt(ALICE, one['utteranceId'])['status'], 'cancelled')

    def test_expiry_prevents_synthesis(self):
        one = self.submit()
        self.now += 91
        SpeechWorker(self.broker, self.audio).process(self.job(one))
        self.assertFalse(self.calls)
        self.assertEqual(self.broker.receipt(ALICE, one['utteranceId'])['status'], 'expired')

    def test_exact_audio_cache_and_cross_voice_isolation(self):
        worker = SpeechWorker(self.broker, self.audio)
        worker.process(self.job(self.submit()))
        self.now += 11
        worker.process(self.job(self.submit(key='turn2')))
        worker.process(self.job(self.submit(actor=BOB)))
        self.assertEqual(self.calls, [('收到。', 'cosy_male'), ('收到。', 'goddess')])

    def test_repeated_claim_does_not_replay_or_regress_receipt(self):
        one = self.submit()
        job, worker = self.job(one), SpeechWorker(self.broker, self.audio)
        worker.process(job)
        worker.report(job, 'completed')
        worker.process(job)
        self.assertEqual(len(self.calls), 1)
        self.assertTrue(self.broker.receipt(ALICE, one['utteranceId'])['playbackCompleted'])

    def test_profile_changed_rejects_old_job(self):
        one = self.submit()
        config = read(self.root / 'speech-profiles.json')
        config['actors'][ALICE]['voiceId'] = 'goddess'
        write(self.root / 'speech-profiles.json', config)
        SpeechWorker(self.broker, self.audio).process(self.job(one))
        self.assertEqual(self.calls, [])

    def test_disabled_profile_records_failure_without_waiting_for_expiry(self):
        one = self.submit()
        config = read(self.root / 'speech-profiles.json')
        config['actors'][ALICE]['enabled'] = False
        write(self.root / 'speech-profiles.json', config)
        SpeechWorker(self.broker, self.audio).process(self.job(one))
        self.assertEqual(self.calls, [])
        result = self.broker.receipt(ALICE, one['utteranceId'])
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(result['code'], 'speech_configuration_unavailable')

    def test_tampered_job_and_failed_synthesis(self):
        one = self.submit()
        worker = SpeechWorker(self.broker, self.audio)
        changed = dict(self.job(one), entity=BOB)
        with self.assertRaisesRegex(ValueError, 'mismatch'):
            worker.process(changed)
        worker = SpeechWorker(self.broker, lambda *_: (_ for _ in ()).throw(TimeoutError()))
        worker.process(self.job(one))
        self.assertEqual(self.broker.receipt(ALICE, one['utteranceId'])['status'], 'failed')

    def test_interrupt_is_explicit_and_keeps_other_actor(self):
        one, other = self.submit(), self.submit(actor=BOB)
        self.now += 11
        new = self.submit(key='urgent', interrupt=True)
        self.assertEqual(self.job(new)['generation'], self.job(one)['generation'] + 1)
        self.assertEqual(self.broker.receipt(ALICE, one['utteranceId'])['status'], 'cancellation_requested')
        self.assertEqual(self.broker.receipt(BOB, other['utteranceId'])['status'], 'queued')

    def test_delivery_sorts_created_time_before_hashed_filename(self):
        older, newer = self.root / 'z.json', self.root / 'a.json'
        write(older, {'schema': 2, 'createdAt': 1})
        write(newer, {'schema': 2, 'createdAt': 2})
        self.assertEqual(sorted([newer, older], key=delivery_order), [older, newer])

    def expired_artifacts(self, key='old', actor=ALICE):
        result = self.submit(key=key, actor=actor)
        job = self.job(result)
        SpeechWorker(self.broker, self.audio).report(job, 'completed')
        audio = self.root / 'tts-queue' / (result['utteranceId'] + '.mp3')
        audio.parent.mkdir(exist_ok=True)
        audio.write_bytes(b'old-audio')
        return (self.root / 'speech-requests' / (result['utteranceId'] + '.json'),
                self.root / 'speech-receipts' / (result['utteranceId'] + '.json'), audio)

    def test_expired_audio_permission_failure_preserves_identity_and_new_speech(self):
        request, receipt, audio = self.expired_artifacts()
        self.now += 8 * 86400
        original_unlink = Path.unlink
        def unlink(path, *args, **kwargs):
            if path == audio:
                raise PermissionError('fixture_audio_directory_not_writable')
            return original_unlink(path, *args, **kwargs)
        with patch.object(Path, 'unlink', unlink):
            maintenance = self.broker.maintain(ALICE)
            fresh = self.submit(key='fresh')
        self.assertEqual(fresh['status'], 'queued')
        self.assertTrue(self.job(fresh))
        self.assertTrue((self.root / 'text-queue' / (fresh['utteranceId'] + '.json')).exists())
        self.assertTrue(all(path.exists() for path in (request, receipt, audio)))
        self.assertEqual(maintenance['cleanup'], {'code': 'speech_cleanup_deferred', 'deferred': 1,
                                          'errors': [{'artifact': 'audio', 'error': 'PermissionError'}]})
        self.assertEqual(self.calls, [])

    def test_expired_audio_gc_keeps_exact_identity_and_playback_evidence(self):
        request, receipt, audio = self.expired_artifacts()
        before = request.read_bytes(), receipt.read_bytes()
        self.now += 8 * 86400
        maintenance = self.broker.maintain(ALICE)
        self.assertEqual(maintenance['removed'], 1)
        self.assertEqual((request.read_bytes(), receipt.read_bytes()), before)
        self.assertFalse(audio.exists())
        queued = list((self.root / 'text-queue').glob('*.json'))
        self.assertEqual(self.submit(key='old')['status'], 'completed')
        with self.assertRaisesRegex(ValueError, 'conflict'):
            self.submit(key='old', text='different')
        with self.assertRaisesRegex(ValueError, 'conflict'):
            self.broker.submit(ALICE, 'old', '收到。', 'minecraft:the_nether')
        self.assertEqual(list((self.root / 'text-queue').glob('*.json')), queued)
        self.assertFalse(audio.exists())

    def test_expired_cleanup_is_actor_bound_and_only_removes_audio(self):
        ours = self.expired_artifacts()
        theirs = self.expired_artifacts(actor=BOB)
        self.now += 8 * 86400
        original_unlink, removed = Path.unlink, []
        def unlink(path, *args, **kwargs):
            if path in ours:
                removed.append(path)
            return original_unlink(path, *args, **kwargs)
        with patch.object(Path, 'unlink', unlink):
            self.broker.maintain(ALICE)
            fresh = self.submit(key='fresh')
        self.assertEqual(removed, [ours[2]])
        self.assertTrue(ours[0].exists() and ours[1].exists())
        self.assertTrue(all(path.exists() for path in theirs))
        self.assertNotIn('cleanup', fresh)

    def test_expired_cleanup_diagnostics_are_bounded_and_exclude_error_text(self):
        old_audio = set()
        for index in range(5):
            old_audio.add(self.expired_artifacts(key='old-' + str(index))[2])
            self.now += 11
        self.now += 8 * 86400
        original_unlink = Path.unlink
        def unlink(path, *args, **kwargs):
            if path in old_audio:
                raise PermissionError('private-path-or-text-must-not-escape')
            return original_unlink(path, *args, **kwargs)
        with patch.object(Path, 'unlink', unlink):
            maintenance = self.broker.maintain(ALICE)
            fresh = self.submit(key='fresh')
        self.assertEqual(maintenance['cleanup']['deferred'], 5)
        self.assertEqual(maintenance['cleanup']['errors'], [{'artifact': 'audio', 'error': 'PermissionError'}])
        self.assertNotIn('private-path', json.dumps(maintenance))
        self.assertEqual(len(list((self.root / 'speech-requests').glob('*.json'))), 6)

    def test_receipt_keeps_failure_reason_and_checks_generation(self):
        one = self.submit()
        job = self.job(one)
        worker = SpeechWorker(self.broker, self.audio)
        worker.report(job, 'failed', 'no_voicechat_listeners')
        self.assertEqual(self.broker.receipt(ALICE, one['utteranceId'])['code'], 'no_voicechat_listeners')
        receipt = self.root / 'speech-receipts' / (one['utteranceId'] + '.json')
        value = read(receipt)
        value['generation'] += 1
        write(receipt, value)
        with self.assertRaisesRegex(ValueError, 'receipt_invalid'):
            self.broker.receipt(ALICE, one['utteranceId'])


if __name__ == '__main__':
    unittest.main()

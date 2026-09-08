import json
from pathlib import Path
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/sidecar'))
from character_speech import SpeechBroker, SpeechWorker, read, write, delivery_order

ALICE = '11111111-1111-4111-8111-111111111111'
BOB = '22222222-2222-4222-8222-222222222222'


class SpeechTest(unittest.TestCase):
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

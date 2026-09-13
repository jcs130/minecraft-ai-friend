"""Offline crash recovery preserves unknown outcomes and never replays work."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('orphan_recovery', ROOT / 'tools/recover_survivor_orphan.py')
recovery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recovery)

TASK = 'task-bd14f3422df7'
TURN = 'survival-' + 'a' * 32
NOW = 1800000000


class FakeRuntime:
    def __init__(self, state):
        base = {'id': 'b' * 64, 'running': True, 'status': 'running',
                'startedAt': '2027-01-01T00:00:00Z', 'project': 'qiandengji', 'stateMount': None}
        self.evidence = {
            'qwen': {**base, 'service': 'qwenpaw'},
            'survivor': {**base, 'id': 'c' * 64, 'service': 'survivor', 'running': False,
                         'status': 'exited', 'stateMount': str(state.parent)},
            'native': {'taskId': TASK, 'httpStatus': 404, 'exactTaskMissing': True,
                       'volatileTaskStoreVerified': True, 'consoleSourceSha256': 'd' * 64,
                       'agentId': 'qd-survivor', 'roleHttpStatus': 200,
                       'roleStatus': {'status': 'idle', 'running_task_count': 0}},
            'observedAt': NOW}
        self.calls = 0
        self.on_collect = None

    def collect(self, task):
        self.calls += 1
        if self.on_collect:
            self.on_collect(self.calls)
        return copy.deepcopy(self.evidence)


class OrphanRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.state = Path(self.temp.name) / 'survival'
        self.state.mkdir()
        self.runtime = FakeRuntime(self.state)
        active = {'taskId': TASK, 'turnId': TURN, 'phase': 'submitted', 'startedAt': NOW - 10000000,
                  'sessionId': 'life-original', 'chatId': 'chat-original', 'userId': 'survival-controller',
                  'channel': 'console', 'eventIds': ['event-1'], 'partyReplyEventIds': ['reply-1'],
                  'review': {'reviewId': 'review-170', 'watermark': 170}}
        self.put('controller.json', {'status': 'paused', 'pauseReason': 'cancellation_uncertain',
                 'active': active, 'decisions': [{'turnId': TURN, 'startedAt': active['startedAt']}],
                 'episodes': [], 'actionExecution': {'ok': True, 'inFlight': False},
                 'lastDecision': {'taskId': 'earlier-task', 'completed': True}, 'failures': 1,
                 'lastDecisionSignature': 'old', 'completedReviewConsumed': 'prior-review'})
        self.put('control.json', {'enabled': False, 'pauseReason': 'cancellation_uncertain', 'mission': 'original'})
        self.put('life-session.json', {'agentId': 'qd-survivor', 'bodyUuid': 'original-body',
                 'primarySessionId': active['sessionId'], 'chatId': active['chatId'],
                 'userId': active['userId'], 'channel': active['channel'], 'hasCompletedTask': True})
        self.put('settings.json', {'bodyUuid': 'original-body'})
        self.put('lease.json', {'turnId': TURN, 'status': 'closed', 'expiresAt': (NOW - 10) * 1000, 'actionsUsed': 1})
        self.put('skill-job.json', {'status': 'done'})
        self.put('turn-actions/' + TURN + '.json', {'turnId': TURN, 'actionIds': ['e' * 32]})
        self.put('action-receipts/' + 'e' * 32 + '.json',
                 {'turnId': TURN, 'actionId': 'e' * 32, 'status': 'observed_ended', 'completionConfirmed': False})

    def put(self, name, value):
        recovery.write_json(self.state / name, value)

    def read(self, name):
        return json.loads((self.state / name).read_text(encoding='utf-8'))

    def run_recovery(self, **kwargs):
        return recovery.recover(self.state, TASK, self.runtime, clock=lambda: NOW, **kwargs)

    def test_preview_never_writes(self):
        before = {p.relative_to(self.state): p.read_bytes() for p in self.state.rglob('*') if p.is_file()}
        result = self.run_recovery()
        self.assertTrue(result['preview'])
        self.assertFalse(result['applied'])
        self.assertEqual(before, {p.relative_to(self.state): p.read_bytes()
                                for p in self.state.rglob('*') if p.is_file()})

    def test_apply_archives_original_bytes_without_outcome_or_consumption_claim(self):
        originals = {p.relative_to(self.state): p.read_bytes() for p in self.state.rglob('*') if p.is_file()}
        original = self.read('controller.json')
        result = self.run_recovery(apply=True)
        after = self.read('controller.json')
        archive = Path(result['archive'])
        self.assertTrue(result['applied'])
        self.assertIsNone(after['active'])
        self.assertEqual('native_runtime_interrupted', after['cancellationStatus'])
        self.assertIsNone(after['orphanRecovery']['nativeTaskCompleted'])
        self.assertNotIn('completed', after['orphanRecovery'])
        for key in ('decisions', 'lastDecision', 'failures', 'completedReviewConsumed'):
            self.assertEqual(original[key], after[key])
        for name, raw in originals.items():
            self.assertEqual(raw, (archive / name).read_bytes())
            if str(name) != 'controller.json':
                self.assertEqual(raw, (self.state / name).read_bytes())
        self.assertEqual(original['active'], self.read(str(Path(after['orphanRecovery']['archive']) / 'controller.json'))['active'])
        self.assertFalse(self.read('control.json')['enabled'])
        self.assertEqual('prepared', json.loads((archive / 'recovery.json').read_text(encoding='utf-8'))['phase'])
        applied = json.loads((archive / 'applied.json').read_text(encoding='utf-8'))
        self.assertEqual('applied', applied['phase'])
        self.assertEqual(recovery.digest((self.state / 'controller.json').read_bytes()), applied['controllerSha256'])
        self.assertTrue(self.run_recovery(apply=True)['alreadyApplied'])
        self.assertEqual(2, self.runtime.calls)

    def test_404_alone_cannot_release(self):
        self.runtime.evidence['qwen']['startedAt'] = '2000-01-01T00:00:00Z'
        with self.assertRaisesRegex(recovery.RecoveryError, 'restart_after_submission'):
            self.run_recovery(apply=True)
        self.assertIsNotNone(self.read('controller.json')['active'])

    def test_running_survivor_can_preview_but_cannot_apply(self):
        self.runtime.evidence['survivor'].update(running=True, status='running')
        self.assertTrue(self.run_recovery()['stopRequired'])
        with self.assertRaisesRegex(recovery.RecoveryError, 'stop_survivor'):
            self.run_recovery(apply=True)

    def test_graceful_service_shutdown_status_is_supported(self):
        self.put('controller.json', {**self.read('controller.json'), 'status': 'stopped'})
        self.assertTrue(self.run_recovery(apply=True)['applied'])

    def test_last_action_from_another_turn_must_also_be_settled(self):
        action = 'f' * 32
        self.put('last-action.json', {'actionId': action})
        self.put('action-receipts/' + action + '.json', {'actionId': action, 'turnId': 'another-turn', 'status': 'in_flight'})
        with self.assertRaisesRegex(recovery.RecoveryError, 'receipt_not_settled'):
            self.run_recovery(apply=True)

    def test_unknown_inflight_and_unsettled_skill_are_preserved(self):
        for marker in ('unknown.json', 'inflight-action.json'):
            with self.subTest(marker=marker):
                self.put(marker, {'original': True})
                with self.assertRaisesRegex(recovery.RecoveryError, 'unresolved_action'):
                    self.run_recovery(apply=True)
                self.assertTrue((self.state / marker).exists())
                (self.state / marker).unlink()
        self.put('skill-job.json', {'status': 'dispatching'})
        with self.assertRaisesRegex(recovery.RecoveryError, 'skill_job_not_settled'):
            self.run_recovery(apply=True)

    def test_open_or_unexpired_lease_blocks(self):
        for update in ({'status': 'open'}, {'expiresAt': (NOW + 10) * 1000}):
            with self.subTest(update=update):
                original = self.read('lease.json')
                self.put('lease.json', {**original, **update})
                with self.assertRaisesRegex(recovery.RecoveryError, 'lease_not_closed_and_expired'):
                    self.run_recovery(apply=True)
                self.put('lease.json', original)

    def test_native_role_running_or_generic_404_blocks(self):
        for key, value in (('roleStatus', {'status': 'running', 'running_task_count': 1}),
                           ('exactTaskMissing', False), ('volatileTaskStoreVerified', False)):
            with self.subTest(key=key):
                original = self.runtime.evidence['native'][key]
                self.runtime.evidence['native'][key] = value
                with self.assertRaises(recovery.RecoveryError):
                    self.run_recovery(apply=True)
                self.runtime.evidence['native'][key] = original

    def test_runtime_restart_between_archive_and_apply_blocks(self):
        def change(call):
            if call == 2:
                self.runtime.evidence['qwen']['id'] = 'f' * 64
        self.runtime.on_collect = change
        with self.assertRaisesRegex(recovery.RecoveryError, 'state_or_runtime_changed'):
            self.run_recovery(apply=True)
        self.assertIsNotNone(self.read('controller.json')['active'])

    def test_state_change_between_archive_and_apply_blocks(self):
        def change(call):
            if call == 2:
                self.put('control.json', {**self.read('control.json'), 'mission': 'concurrent change'})
        self.runtime.on_collect = change
        with self.assertRaisesRegex(recovery.RecoveryError, 'state_or_runtime_changed'):
            self.run_recovery(apply=True)
        self.assertIsNotNone(self.read('controller.json')['active'])

    def test_missing_or_unsettled_receipt_blocks(self):
        name = 'action-receipts/' + 'e' * 32 + '.json'
        self.put(name, {**self.read(name), 'status': 'in_flight'})
        with self.assertRaisesRegex(recovery.RecoveryError, 'receipt_not_settled'):
            self.run_recovery(apply=True)


if __name__ == '__main__':
    unittest.main()

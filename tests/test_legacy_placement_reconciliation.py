import base64
import copy
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world' / 'survival'))
spec = importlib.util.spec_from_file_location('legacy_placement', ROOT / 'tools' / 'reconcile_legacy_placement.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding='utf8')


class Backend:
    def __init__(self):
        self.status = {'status': 'idle', 'running_task_count': 0}
        self.native = {'status': 'finished', 'result': {'status': 'completed', 'session_id': mod.SESSION,
            'output': [
                {'role': 'assistant', 'content': [{'data': {'name': 'numen_survival__place_block',
                    'call_id': 'original-call', 'arguments': json.dumps(mod.ARGS | {'turn_id': mod.TURN})}}]},
                {'role': 'tool', 'content': [{'data': {'name': 'numen_survival__place_block',
                    'call_id': 'original-call', 'state': 'success', 'output': json.dumps({
                        'ok': False, 'actionId': mod.ACTION, 'code': 'outcome_unknown'})}}]}]}}

    def api(self, method, path):
        assert method == 'GET' and path == '/agents/qd-survivor/agent-status'
        return copy.deepcopy(self.status)

    def poll(self, task):
        assert task == mod.TASK
        return copy.deepcopy(self.native)


class Gateway:
    def __init__(self):
        self.state = '.'
        self.body = {'ok': True, 'bodyUuid': mod.BODY, 'dimension': 'minecraft:overworld',
                     'hp': 17.66, 'task': {'busy': False}, 'counts': {'minecraft:oak_planks': 3}}

    def snapshot(self):
        return copy.deepcopy(self.body)


class ReconciliationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.state = Path(self.temp.name)
        self.gateway, self.backend = Gateway(), Backend()
        self.unknown = {'schema': 1, 'actionId': mod.ACTION, 'turnId': mod.TURN,
                        'tool': 'place_block', 'args': mod.ARGS, 'acceptedAt': mod.ACCEPTED_AT,
                        'result': 'unknown', 'before': {'bodyUuid': mod.BODY, 'counts': {'minecraft:oak_planks': 3}}}
        documents = {
            'settings.json': {'bodyUuid': mod.BODY},
            'life-session.json': {'agentId': 'qd-survivor', 'bodyUuid': mod.BODY, 'primarySessionId': mod.SESSION},
            'controller.json': {'status': 'paused', 'active': None, 'pauseReason': 'action_outcome_unknown'},
            'control.json': {'enabled': False, 'revision': 8},
            'lease.json': {'schema': 1, 'turnId': mod.TURN, 'actionId': mod.ACTION, 'status': 'unknown',
                           'expiresAt': mod.ACCEPTED_AT + 600000, 'actionLimit': 6, 'actionsUsed': 4},
            'unknown.json': self.unknown,
            'last-action.json': {'schema': 1, 'actionId': mod.ACTION},
            'skill-job.json': {'status': 'done'},
            'action-receipts/' + mod.ACTION + '.json': self.unknown | {
                'schema': 2, 'status': 'unknown', 'completionConfirmed': False}}
        for name, value in documents.items():
            save(self.state / name, value)
        blocks = [{'x': x, 'y': y, 'z': z, 'block': 'minecraft:air'}
                  for x in range(-640, -637) for y in range(63, 66) for z in range(1051, 1054)]
        next(b for b in blocks if (b['x'], b['y'], b['z']) == (-640, 64, 1051))['block'] = 'minecraft:short_grass'
        observation = {'body': self.gateway.body, 'counts': {'minecraft:oak_planks': 3}, 'blocks': blocks}
        log = ('2026-09-13T15:30:32.192472763Z [23:30:32] [Server thread/INFO] [NumenCore/]: '
               '[numen-task] InteractAtCompanionTask FAILED(OCCLUDED) ' + mod.NATIVE_FAILURE + '\n')
        self.evidence = {'nativeLogBase64': base64.b64encode(log.encode('utf8')).decode('ascii'),
                         'observationBase64': base64.b64encode(json.dumps(observation).encode('utf8')).decode('ascii')}
        self.target = {'ok': True, 'x': -639, 'y': 64, 'z': 1052, 'block': 'minecraft:air'}
        self.inspect = patch('world_actions.WorldActions.inspect', side_effect=lambda *a: self.target)
        self.inspect.start()
        self.addCleanup(self.inspect.stop)

    def run_reconcile(self, **kwargs):
        return mod.reconcile(self.state, self.evidence, self.gateway, self.backend, **kwargs)

    def files(self):
        return {str(p.relative_to(self.state)): p.read_bytes() for p in self.state.rglob('*') if p.is_file()}

    def test_preview_is_read_only_and_does_not_claim_native_request_receipt(self):
        before = self.files()
        result = self.run_reconcile()
        self.assertEqual(before, self.files())
        self.assertEqual(result['phase'], 'preview')
        self.assertFalse(result['sourceProof']['nativeRequestIdReceiptAvailable'])
        self.assertFalse(result['completionConfirmed'])

    def test_apply_archives_exact_originals_rejects_and_keeps_pause_budget(self):
        before = self.files()
        result = self.run_reconcile(execute=True)
        intent = mod.load(self.state / 'reconciled-actions' / mod.ACTION / 'intent.json')
        for name in ('unknown.json', 'lease.json', 'controller.json', 'control.json'):
            self.assertEqual(base64.b64decode(intent['originalFilesBase64'][name]), before[name])
        self.assertFalse((self.state / 'unknown.json').exists())
        receipt = mod.load(self.state / 'action-receipts' / (mod.ACTION + '.json'))
        self.assertEqual(receipt['status'], 'rejected')
        self.assertEqual(receipt['originalResult'], 'unknown')
        self.assertIs(receipt['result']['result']['success'], False)
        self.assertFalse(receipt['completionConfirmed'])
        lease = mod.load(self.state / 'lease.json')
        self.assertEqual((lease['status'], lease['actionsUsed']), ('closed', 4))
        self.assertEqual((self.state / 'controller.json').read_bytes(), before['controller.json'])
        self.assertEqual((self.state / 'control.json').read_bytes(), before['control.json'])
        self.assertEqual(intent['phase'], 'prepared')
        self.assertEqual(result['phase'], 'applied')
        self.assertTrue(self.run_reconcile(execute=True)['alreadyResolved'])

    def test_crash_at_every_commit_stage_recovers_without_reobserving_or_redispatching(self):
        baseline = self.files()
        for stop in ('archived', 'receipt_rejected', 'lease_closed', 'unknown_cleared'):
            with self.subTest(stop=stop), tempfile.TemporaryDirectory() as tmp:
                original_state = self.state
                self.state = Path(tmp)
                try:
                    for name, raw in baseline.items():
                        target = self.state / name
                        target.parent.mkdir(parents=True, exist_ok=True)
                        target.write_bytes(raw)
                    def crash(stage):
                        if stage == stop:
                            raise RuntimeError('simulated_crash')
                    with self.assertRaises(RuntimeError):
                        self.run_reconcile(execute=True, checkpoint=crash)
                    with patch.object(self.backend, 'poll', side_effect=AssertionError('must use archived proof')):
                        result = self.run_reconcile(execute=True)
                    self.assertTrue(result['applied'])
                    self.assertFalse((self.state / 'unknown.json').exists())
                finally:
                    self.state = original_state

    def test_lack_of_effect_without_native_failure_log_is_not_enough(self):
        self.evidence['nativeLogBase64'] = base64.b64encode(b'unrelated log').decode('ascii')
        before = self.files()
        with self.assertRaisesRegex(ValueError, 'native_failure_log'):
            self.run_reconcile(execute=True)
        self.assertEqual(before, self.files())

    def test_time_mismatch_or_ambiguous_logs_refused(self):
        raw = base64.b64decode(self.evidence['nativeLogBase64'])
        for invalid in (raw + raw, raw.replace(b'15:30:32', b'15:31:32')):
            with self.subTest(invalid=invalid):
                self.evidence['nativeLogBase64'] = base64.b64encode(invalid).decode('ascii')
                with self.assertRaisesRegex(ValueError, 'native_failure_'):
                    self.run_reconcile(execute=True)

    def test_wrong_native_call_or_running_task_refused(self):
        for mutate, expected in ((lambda: self.backend.native.update(status='running'), 'native_task_not_terminal'),
                (lambda: self.backend.native['result'].update(session_id='other'), 'native_session_mismatch'),
                (lambda: self.backend.native['result']['output'][0]['content'][0]['data'].update(arguments='{}'),
                 'native_original_arguments_mismatch')):
            self.backend = Backend()
            mutate()
            with self.assertRaisesRegex(ValueError, expected):
                self.run_reconcile(execute=True)

    def test_new_native_console_task_blocks(self):
        self.backend.status = {'status': 'running', 'running_task_count': 1}
        with self.assertRaisesRegex(ValueError, 'native_role_not_idle'):
            self.run_reconcile(execute=True)

    def test_new_controller_activity_and_inflight_block(self):
        save(self.state / 'controller.json', {'status': 'paused', 'active': {'taskId': 'new'}})
        with self.assertRaisesRegex(ValueError, 'controller_not_paused_idle'):
            self.run_reconcile(execute=True)
        save(self.state / 'controller.json', {'status': 'paused', 'active': None})
        save(self.state / 'inflight-action.json', {'actionId': 'new'})
        with self.assertRaisesRegex(ValueError, 'another_action_in_flight'):
            self.run_reconcile(execute=True)

    def test_changed_live_world_or_inventory_blocks(self):
        self.target['block'] = 'minecraft:oak_planks'
        with self.assertRaisesRegex(ValueError, 'live_target_changed'):
            self.run_reconcile(execute=True)
        self.target['block'] = 'minecraft:air'
        self.gateway.body['counts']['minecraft:oak_planks'] = 2
        with self.assertRaisesRegex(ValueError, 'live_material_count_changed'):
            self.run_reconcile(execute=True)

    def test_new_unknown_during_partial_commit_is_never_cleared(self):
        def interrupt(stage):
            if stage == 'lease_closed':
                save(self.state / 'unknown.json', self.unknown | {'actionId': 'b' * 32})
        with self.assertRaisesRegex(ValueError, 'unknown_changed_before_clear'):
            self.run_reconcile(execute=True, checkpoint=interrupt)
        self.assertEqual(mod.load(self.state / 'unknown.json')['actionId'], 'b' * 32)


if __name__ == '__main__':
    unittest.main()

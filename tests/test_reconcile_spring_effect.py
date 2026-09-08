import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/survival'))
spec = importlib.util.spec_from_file_location('reconcile_spring_effect', ROOT / 'tools/reconcile_spring_effect.py')
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)
from numen_gateway import write_json

AID = '1' * 32
RID = '12345678-1234-1234-1234-123456789abc'
TASK = 'task-existing'
UUID = '00000000-0000-0000-0000-000000000001'


class ReconcileTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.state = Path(self.temp.name) / 'state'
        self.queue = Path(self.temp.name) / 'queue'
        self.unknown = {'schema': 1, 'actionId': AID, 'requestId': RID, 'turnId': 'survival-original-turn',
            'tool': 'game_cast', 'args': {'skill_id': 'spring', 'params': {'distance': 1}},
            'result': 'unknown', 'acceptedAt': 10,
            'before': {'bodyUuid': UUID, 'position': {'x': -642.7, 'y': 51, 'z': 1058.3}, 'dimension': 'minecraft:overworld'}}
        self.lease = {'schema': 1, 'turnId': self.unknown['turnId'], 'actionId': AID,
                      'status': 'unknown', 'actionLimit': 6, 'actionsUsed': 3, 'expiresAt': 100}
        for name, value in {'unknown': self.unknown, 'lease': self.lease,
            'settings': {'bodyName': 'Kirito', 'bodyUuid': UUID, 'dimension': 'minecraft:overworld'},
            'control': {'enabled': False, 'pauseReason': 'action_outcome_unknown'},
            'controller': {'status': 'paused', 'active': None},
            'life-session': {'agentId': 'qd-survivor', 'bodyUuid': UUID, 'primarySessionId': 'life-original',
                             'channel': 'console', 'userId': 'original-user'}}.items():
            write_json(self.state / (name + '.json'), value)
        write_json(self.state / 'game-skill-requests' / (RID + '.json'),
                   {'requestId': RID, 'actor': 'Kirito', 'actorUuid': UUID, 'command': 'cast spring distance=1', 'submittedAt': 11})
        write_json(self.queue / 'processing' / RID / 'request.json',
                   {'id': RID, 'actor': 'Kirito', 'command': 'cast spring distance=1', 'submittedAt': 11, 'expiresAt': 100})
        write_json(self.queue / 'results' / (RID + '.json'),
                   {'requestId': RID, 'actor': 'Kirito', 'ok': False, 'code': 'outcome_unknown', 'skillId': 'spring'})
        self.native = {'status': 'finished', 'result': {'status': 'completed', 'session_id': 'life-original', 'output': [
            {'role': 'assistant', 'content': [{'type': 'data', 'data': {'name': 'numen_survival__game_cast',
                'call_id': 'exact-call', 'arguments': json.dumps(self.unknown['args'] | {'turn_id': self.unknown['turnId']})}}]},
            {'role': 'tool', 'content': [{'type': 'data', 'data': {'name': 'numen_survival__game_cast',
                'call_id': 'exact-call', 'state': 'success', 'output': json.dumps({
                    'actionId': AID, 'ok': False, 'code': 'outcome_unknown'})}}]}]}}
        self.gateway = type('Gateway', (), {'_check_binding': lambda _: ('Kirito', UUID),
            'snapshot': lambda _: {'ok': True, 'bodyName': 'Kirito', 'bodyUuid': UUID, 'hp': 20,
                                   'dimension': 'minecraft:overworld', 'task': {'busy': False}}})()
        self.gateway.state = self.state
        outer = self
        self.backend = type('Backend', (), {'api': lambda *a: {'running_task_count': 0},
                                           'poll': lambda _, task: outer.native})()
        self.observation = {'ok': True, 'x': -642, 'y': 50, 'z': 1058,
                            'block': 'minecraft:water', 'properties': {'level': '0'}, 'observedAt': 200}
        self.mock = patch('world_actions.WorldActions.inspect', side_effect=lambda *a: self.observation).start()
        self.addCleanup(patch.stopall)

    def call(self, **kwargs):
        return tool.reconcile(self.state, self.queue, AID, RID, TASK, self.gateway, self.backend, **kwargs)

    def test_preview_is_read_only_and_target_uses_original_origin(self):
        before = {p: p.read_bytes() for p in self.state.rglob('*.json')}
        result = self.call()
        self.assertEqual(result['status'], 'resolved_effect_observed')
        self.assertFalse(result['effectAttributionVerified'])
        self.assertEqual(result['target'], {'x': -642, 'y': 50, 'z': 1058, 'dimension': 'minecraft:overworld'})
        self.assertEqual(before, {p: p.read_bytes() for p in self.state.rglob('*.json')})
        self.assertFalse((self.state / 'reconciled-actions').exists())

    def test_apply_preserves_history_resources_and_pause(self):
        result_file = self.queue / 'results' / (RID + '.json')
        old_result = result_file.read_bytes()
        result = self.call(execute=True)
        self.assertFalse((self.state / 'unknown.json').exists())
        self.assertEqual(tool.load(self.state / 'lease.json')['status'], 'closed')
        self.assertEqual(result_file.read_bytes(), old_result)
        self.assertFalse(tool.load(self.state / 'control.json')['enabled'])
        for key in ('manaChanged', 'learningChanged', 'actionReplayed', 'controllerResumed'):
            self.assertFalse(result[key])
        archive = tool.load(self.state / 'reconciled-actions' / AID / 'intent.json')
        self.assertEqual(archive['originalUnknown'], self.unknown)
        self.assertEqual(archive['originalLease'], self.lease)
        self.assertTrue(self.call(execute=True)['alreadyResolved'])

    def test_each_interruption_recovers_without_new_intent_or_action(self):
        for phase in ('archived', 'lease_closed', 'unknown_cleared'):
            with self.subTest(phase=phase):
                # Each subtest starts from the original blocker; keep unrelated proofs isolated.
                temp = tempfile.TemporaryDirectory(); self.addCleanup(temp.cleanup)
                import shutil
                state = Path(temp.name) / 'state'; shutil.copytree(self.state, state)
                def checkpoint(value):
                    if value == phase:
                        raise RuntimeError('injected interruption')
                with self.assertRaises(RuntimeError):
                    tool.reconcile(state, self.queue, AID, RID, TASK, self.gateway, self.backend,
                                   execute=True, checkpoint=checkpoint)
                intent = state / 'reconciled-actions' / AID / 'intent.json'
                saved = intent.read_bytes()
                result = tool.reconcile(state, self.queue, AID, RID, TASK, self.gateway, self.backend, execute=True)
                self.assertEqual(intent.read_bytes(), saved)
                self.assertEqual(result['status'], 'resolved_effect_observed')
                self.assertFalse((state / 'unknown.json').exists())

    def test_another_unknown_is_never_cleared_during_recovery(self):
        def interrupt(_):
            raise RuntimeError('after archive')
        with self.assertRaises(RuntimeError):
            self.call(execute=True, checkpoint=interrupt)
        changed = self.unknown | {'actionId': '2' * 32}
        write_json(self.state / 'unknown.json', changed)
        with self.assertRaisesRegex(ValueError, 'unknown_identity_mismatch'):
            self.call(execute=True)
        self.assertEqual(tool.load(self.state / 'unknown.json'), changed)
        self.assertEqual(tool.load(self.state / 'lease.json'), self.lease)

    def test_fsynced_proof_survives_native_task_cache_loss_and_changed_world(self):
        def interrupt(_):
            raise RuntimeError('after archive')
        with self.assertRaises(RuntimeError):
            self.call(execute=True, checkpoint=interrupt)
        self.backend.poll = lambda _: (_ for _ in ()).throw(RuntimeError('native task no longer cached'))
        self.gateway.snapshot = lambda: (_ for _ in ()).throw(RuntimeError('body no longer loaded'))
        self.observation['block'] = 'minecraft:air'
        result = self.call(execute=True)
        self.assertEqual(result['status'], 'resolved_effect_observed')
        self.assertFalse((self.state / 'unknown.json').exists())
        self.assertFalse(result['effectAttributionVerified'])

    def test_unknown_native_or_wrong_session_or_wrong_call_cannot_resolve(self):
        for update, code in [({'status': 'running'}, 'native_task_not_terminal'),
                             ({'result': self.native['result'] | {'session_id': 'other'}}, 'native_session_mismatch'),
                             ({'result': self.native['result'] | {'output': []}}, 'native_original_action_receipt')]:
            old = self.native
            self.native = old | update
            with self.assertRaisesRegex(ValueError, code):
                self.call(execute=True)
            self.native = old
        self.assertTrue((self.state / 'unknown.json').exists())

    def test_current_water_alone_not_enough_for_other_spell_or_request(self):
        changed = self.unknown | {'args': {'skill_id': 'tp', 'params': {'distance': 1}}}
        write_json(self.state / 'unknown.json', changed)
        with self.assertRaises(ValueError):
            self.call(execute=True)
        self.assertTrue((self.state / 'unknown.json').exists())

    def test_no_source_water_or_changed_dimension_refuses(self):
        self.observation['properties']['level'] = '1'
        with self.assertRaisesRegex(ValueError, 'source_water_not_observed'):
            self.call(execute=True)
        self.assertFalse((self.state / 'reconciled-actions').exists())

    def test_running_role_or_enabled_controller_cannot_reconcile(self):
        self.backend.api = lambda *a: {'running_task_count': 1}
        with self.assertRaisesRegex(ValueError, 'native_role_not_idle'):
            self.call(execute=True)
        write_json(self.state / 'control.json', {'enabled': True})
        with self.assertRaisesRegex(ValueError, 'controller_not_paused_idle'):
            self.call(execute=True)


if __name__ == '__main__':
    unittest.main()

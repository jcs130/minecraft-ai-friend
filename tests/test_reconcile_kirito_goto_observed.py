"""Isolated operator commit/recovery tests; no live models, game or production writes."""
import copy
import importlib.util
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/survival'))
spec = importlib.util.spec_from_file_location('goto_reconciliation', ROOT / 'tools/reconcile_kirito_goto_observed.py')
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)
from numen_gateway import write_json


class ReconcileGotoTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.state = Path(temporary.name) / 'state'
        self.unknown = {'schema': 1, 'actionId': tool.ACTION, 'turnId': tool.TURN,
            'tool': 'goto', 'args': dict(tool.ARGS), 'result': 'unknown', 'acceptedAt': tool.ACCEPTED_AT,
            'before': {'bodyUuid': tool.BODY, 'navigationEpoch': tool.EPOCH}}
        self.lease = {'schema': 1, 'turnId': tool.TURN, 'actionId': tool.ACTION,
                      'status': 'unknown', 'actionsUsed': 4, 'actionLimit': 6, 'expiresAt': 1789375200128}
        for name, data in {'unknown': self.unknown, 'lease': self.lease,
            'settings': {'bodyName': 'Kirito', 'bodyUuid': tool.BODY, 'ownerUuid': tool.OWNER,
                         'dimension': tool.DIMENSION},
            'life-session': {'agentId': 'qd-survivor', 'bodyUuid': tool.BODY, 'primarySessionId': tool.SESSION,
                             'chatId': tool.CHAT, 'userId': 'survival-controller', 'channel': 'console'},
            'control': {'enabled': False, 'pauseReason': 'action_outcome_unknown'},
            'controller': {'status': 'paused', 'active': None}}.items():
            write_json(self.state / (name + '.json'), data)
        # Fixture bytes are synthetic; only the unknown-byte hash is patched.
        # The public production constant and all identity checks remain tested.
        self.addCleanup(patch.stopall)
        patch.object(tool, 'UNKNOWN_SHA', tool.digest((self.state / 'unknown.json').read_bytes())).start()
        self.nav = {'task_id': 't554', 'navigation_epoch': tool.EPOCH, 'state': 'success', 'success': True,
                    'finished_at': tool.FINISHED_AT, 'requested_y': 63.9375, 'arrival_mode': 'block_3d',
                    'navigation_mode': 'walk_only_v1', 'dry_supported': True, 'world_interaction_blocked': False,
                    'final_x': -638.6143343988516, 'final_y': 64.0, 'final_z': 1054.2937001980506}
        self.body = {'ok': True, 'bodyName': 'Kirito', 'bodyUuid': tool.BODY, 'dimension': tool.DIMENSION,
                     'hp': 13.966663, 'task': {'busy': False}, 'navigationEpoch': tool.EPOCH,
                     'navigationResult': self.nav, 'observedAt': tool.FINISHED_AT + 10000}
        self.native = {'status': 'finished', 'result': {'status': 'completed', 'session_id': tool.SESSION,
            'completed_at': '2026-09-14T08:33:07+00:00', 'output': [
                {'type': 'plugin_call', 'role': 'assistant', 'content': [{'data': {
                    'name': 'numen_survival__move', 'call_id': 'original-call',
                    'arguments': json.dumps(tool.ARGS | {'turn_id': tool.TURN})}}]},
                {'type': 'plugin_call_output', 'role': 'tool', 'content': [{'data': {
                    'name': 'numen_survival__move', 'call_id': 'original-call', 'state': 'success',
                    'output': json.dumps({'ok': False, 'code': 'outcome_unknown', 'actionId': tool.ACTION})}}]}]}}
        self.event = {'bodyUuid': tool.BODY, 'source': 'numen_event_outbox.dat', 'sourceSha256': 'a' * 64,
            'event': {'type': 'event', 'ts': tool.FINISHED_AT + 1,
                'text': '<event kind="task_finished" day="554" t="21:27" id="t554" task="goto" '
                        'status="done">reached the exact cell -639,64,1054.</event>'}}
        outer = self
        self.running = 0
        self.polls = 0
        class Gateway:
            def _check_binding(self): return 'Kirito', tool.BODY
            def snapshot(self): return copy.deepcopy(outer.body)
            def _invoke(self, tool_name):
                assert tool_name == 'get_self_status'
                return {'name': 'Kirito', 'dimension': tool.DIMENSION,
                        'navigation_epoch': outer.body['navigationEpoch'],
                        'last_navigation_result': copy.deepcopy(outer.nav)}
        class Backend:
            def api(self, method, route):
                assert (method, route) == ('GET', '/agents/qd-survivor/agent-status')
                return {'running_task_count': outer.running}
            def poll(self, task_id):
                assert task_id == tool.TASK
                outer.polls += 1
                return copy.deepcopy(outer.native)
        self.gateway, self.backend = Gateway(), Backend()
        self.history = self.state / 'action-receipts' / (tool.ACTION + '.json')
        write_json(self.history, {'status': 'unknown', 'completionConfirmed': False, 'original': 'untouched'})

    def call(self, state=None, **kwargs):
        return tool.reconcile(state or self.state, self.gateway, self.backend, self.event, **kwargs)

    def bytes(self, state=None):
        root = state or self.state
        return {str(p.relative_to(root)): p.read_bytes() for p in root.rglob('*') if p.is_file()}

    def test_production_unknown_pin_is_literal_and_not_runtime_discovered(self):
        text = (ROOT / 'tools/reconcile_kirito_goto_observed.py').read_text(encoding='utf8')
        self.assertIn("UNKNOWN_SHA = 'b1a70f91fb708c2aeb65524d7c67af7e648ddab5a3da80ef10a15a9cd71e7ddf'", text)

    def test_preview_has_no_filesystem_mutation_and_never_claims_ack_recovered(self):
        before = self.bytes()
        result = self.call()
        self.assertEqual(self.bytes(), before)
        self.assertFalse((self.state / 'reconciled-actions').exists())
        for key in ('execute', 'effectAttributionVerified', 'originalAckRecovered', 'actionReplayed', 'controllerResumed'):
            self.assertIs(result[key], False)
        self.assertEqual(result['observation']['nativeProof']['arguments'], tool.ARGS | {'turn_id': tool.TURN})

    def test_execute_only_closes_original_lease_and_unknown_after_durable_resolution(self):
        original = self.bytes()
        phases = []
        def check(phase):
            phases.append(phase)
            folder = self.state / 'reconciled-actions' / tool.ACTION
            if phase == 'resolution_archived':
                self.assertTrue((folder / 'intent.json').exists())
                self.assertTrue((folder / 'resolution.json').exists())
                self.assertEqual(tool.load(self.state / 'lease.json'), self.lease)
                self.assertTrue((self.state / 'unknown.json').exists())
        result = self.call(execute=True, checkpoint=check)
        self.assertTrue(result['localBlockerCommitComplete'])
        self.assertFalse(result['effectAttributionVerified'])
        self.assertEqual(phases, ['evidence_archived', 'intent_archived', 'resolution_archived', 'lease_closed', 'unknown_cleared'])
        current = self.bytes()
        for path, raw in original.items():
            if path not in ('unknown.json', 'lease.json'):
                self.assertEqual(current[path], raw)
        folder = self.state / 'reconciled-actions' / tool.ACTION
        self.assertEqual((folder / 'unknown-original.json').read_bytes(), original['unknown.json'])
        self.assertFalse((self.state / 'unknown.json').exists())
        self.assertEqual(tool.load(self.state / 'lease.json')['status'], 'closed')
        self.assertTrue(self.call(execute=True)['alreadyResolved'])
        self.assertEqual(current, self.bytes())

    def test_each_commit_interruption_recovers_without_replaying_or_rewriting_proof(self):
        for phase in ('evidence_archived', 'intent_archived', 'resolution_archived', 'lease_closed', 'unknown_cleared'):
            with self.subTest(phase=phase):
                temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
                state = Path(temporary.name) / 'state'; shutil.copytree(self.state, state)
                def crash(current):
                    if current == phase: raise RuntimeError('injected crash')
                with self.assertRaises(RuntimeError): self.call(state, execute=True, checkpoint=crash)
                archived = {k: v for k, v in self.bytes(state).items() if k.startswith('reconciled-actions')}
                self.body['observedAt'] += 100
                result = self.call(state, execute=True)
                self.assertTrue(result['localBlockerCommitComplete'])
                for name, raw in archived.items(): self.assertEqual(self.bytes(state)[name], raw)
                self.assertFalse((state / 'unknown.json').exists())

    def test_current_identity_epoch_busy_and_native_completion_are_required(self):
        cases = [('navigationEpoch', 'different-epoch', 'native_epoch_changed'),
                 ('bodyUuid', tool.OWNER, 'body_not_available_idle'),
                 ('task', {'busy': True}, 'body_not_available_idle')]
        for key, value, error in cases:
            with self.subTest(key=key):
                old = self.body[key]; self.body[key] = value
                before = self.bytes()
                with self.assertRaisesRegex(ValueError, error): self.call(execute=True)
                self.assertEqual(self.bytes(), before); self.body[key] = old
        self.native['result']['status'] = 'failed'
        with self.assertRaisesRegex(ValueError, 'native_task_not_completed'): self.call(execute=True)

    def test_previous_success_wrong_target_height_or_event_cannot_resolve(self):
        for key, value in [('task_id', 't549'), ('requested_y', 64), ('finished_at', tool.FINISHED_AT - 1),
                           ('final_x', -640.5), ('dry_supported', False)]:
            with self.subTest(key=key):
                old = self.nav[key]; self.nav[key] = value
                before = self.bytes()
                with self.assertRaises(ValueError): self.call(execute=True)
                self.assertEqual(self.bytes(), before); self.nav[key] = old
        self.event['bodyUuid'] = tool.OWNER
        with self.assertRaisesRegex(ValueError, 'event_source_mismatch'): self.call(execute=True)

    def test_wrong_unknown_bytes_even_semantically_same_and_native_call_are_refused(self):
        path = self.state / 'unknown.json'; raw = path.read_bytes(); path.write_bytes(raw + b' ')
        with self.assertRaisesRegex(ValueError, 'unknown_bytes_mismatch'): self.call(execute=True)
        path.write_bytes(raw)
        data = self.native['result']['output'][0]['content'][0]['data']
        data['arguments'] = json.dumps(tool.ARGS | {'turn_id': 'survival-other'})
        with self.assertRaisesRegex(ValueError, 'native_arguments_mismatch'): self.call(execute=True)

    def test_changed_new_unknown_is_never_removed_during_partial_recovery(self):
        def crash(phase):
            if phase == 'intent_archived': raise RuntimeError('injected')
        with self.assertRaises(RuntimeError): self.call(execute=True, checkpoint=crash)
        changed = self.unknown | {'actionId': 'a' * 32}
        write_json(self.state / 'unknown.json', changed)
        before = self.bytes()
        with self.assertRaisesRegex(ValueError, 'unknown_bytes_mismatch'): self.call(execute=True)
        self.assertEqual(before, self.bytes())

    def test_native_active_or_control_resume_prevents_commit(self):
        self.running = 1
        with self.assertRaisesRegex(ValueError, 'native_role_not_idle'): self.call(execute=True)
        self.running = 0
        def resume(phase):
            if phase == 'resolution_archived':
                write_json(self.state / 'control.json', {'enabled': True})
        with self.assertRaisesRegex(ValueError, 'controller_not_paused_idle'):
            self.call(execute=True, checkpoint=resume)
        self.assertTrue((self.state / 'unknown.json').exists())
        self.assertEqual(tool.load(self.state / 'lease.json'), self.lease)

    def test_archived_intent_recovers_without_native_task_cache_but_not_across_mc_epoch(self):
        def crash(phase):
            if phase == 'intent_archived': raise RuntimeError('injected')
        with self.assertRaises(RuntimeError): self.call(execute=True, checkpoint=crash)
        self.native = {}; polls = self.polls
        self.body['navigationEpoch'] = 'restarted-mc'
        with self.assertRaisesRegex(ValueError, 'native_epoch_changed'): self.call(execute=True)
        self.body['navigationEpoch'] = tool.EPOCH
        self.call(execute=True)
        self.assertEqual(self.polls, polls)

    def test_completed_proof_cannot_change_attribution_to_success(self):
        self.call(execute=True)
        path = self.state / 'reconciled-actions' / tool.ACTION / 'completed.json'
        done = tool.load(path); done['effectAttributionVerified'] = True; write_json(path, done)
        with self.assertRaisesRegex(ValueError, 'completed_proof_mismatch'): self.call(execute=True)


if __name__ == '__main__':
    unittest.main()

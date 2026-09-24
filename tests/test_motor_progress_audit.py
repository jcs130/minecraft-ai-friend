"""Receipt-backed advice never dispatches, retries, or buys a cognition turn."""
import copy
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'world/survival'))


class ProgressAuditTests(unittest.TestCase):
    def setUp(self):
        from motor_progress_audit import update
        self.update = update
        self.now = 1800000000.0
        self.body = {'ok': True, 'bodyUuid': 'body-1', 'dimension': 'overworld',
                     'position': {'x': 82, 'y': 64, 'z': 10}, 'counts': {'minecraft:bread': 3},
                     'hp': 20, 'hunger': 10, 'task': {'busy': False}, 'observedAt': self.now * 1000}
        self.rows, self.receipts, self.loads = [], {}, []
        self.scope = {'goal': 'find food', 'bodyUuid': 'body-1', 'life': 'life-1'}
        self.state = {}
        self.tick()

    def load(self, action_id):
        self.loads.append(action_id)
        return copy.deepcopy(self.receipts[action_id])

    def tick(self, **overrides):
        args = {'scope': self.scope, 'goal_state': 'ongoing', 'rows': self.rows,
                'body': self.body, 'now': self.now, 'load_receipt': self.load}
        args.update(overrides)
        self.state, self.hint = self.update(self.state, **args)
        return self.hint

    def add(self, status='failed', tool='goto', *, changed=False, code='unreachable'):
        n = len(self.rows) + 1
        rid, aid = f'{n:064x}', f'{n:032x}'
        args = {'x': 82, 'y': 64, 'z': 10} if tool == 'goto' else {'item_id': 'minecraft:bread'}
        before, after = copy.deepcopy(self.body), copy.deepcopy(self.body)
        if changed:
            after['position']['x'] += 3
        self.now += 5
        after['observedAt'] = self.now * 1000
        raw = {'actionId': aid, 'turnId': 'motor-' + rid[:32], 'tool': tool, 'args': args,
               'status': status, 'completionConfirmed': status in ('completed', 'failed'),
               'before': before, 'after': after, 'result': {'code': code, 'ok': status == 'completed'}}
        row = {'requestId': rid, 'kind': 'action', 'status': status, 'motorTurnId': raw['turnId'],
               'command': {'tool': tool, 'args': args}, 'receipt': {'actionId': aid, 'status': status}}
        self.rows.append(row)
        self.receipts[aid] = raw
        return row, raw

    def failures(self):
        for _ in range(3):
            self.add()
            self.tick()

    def test_three_distinct_failed_receipts_show_exact_ids_and_no_retry_advice(self):
        self.failures()
        self.assertEqual(self.hint['kind'], 'repeated_native_failure')
        self.assertEqual(self.hint['code'], 'unreachable')
        self.assertEqual(self.hint['count'], 3)
        self.assertEqual(self.hint['requestIds'], [r['requestId'] for r in self.rows])
        self.assertFalse(self.hint['goalSuccessInferred'])
        self.assertFalse(self.hint['retryAutomatically'])

    def test_same_network_read_never_adds_an_attempt_or_rereads_archive(self):
        self.add(); self.tick()
        for _ in range(100):
            self.tick()
        self.assertEqual(len(self.loads), 1)
        self.assertIsNone(self.hint)

    def test_arrival_inside_tolerance_can_be_completed_without_movement(self):
        for _ in range(3):
            self.add('completed', code='executed'); self.tick()
        self.assertEqual(self.hint['kind'], 'repeated_no_observed_effect')
        self.assertEqual(self.hint['evidence'], 'confirmed_goto_same_position')

    def test_goto_movement_clears_no_effect_without_asserting_goal_progress(self):
        for _ in range(3):
            self.add('completed', code='executed'); self.tick()
        self.add('completed', changed=True, code='executed'); self.tick()
        self.assertIsNone(self.hint)
        self.assertIsNone(self.state['run'])
        self.assertNotIn('goalProgress', self.state)

    def test_pending_unknown_cast_and_sleep_never_count_as_failures_or_no_effect(self):
        for status, tool in [('claimed', 'goto'), ('unknown', 'eat'), ('dispatched', 'game_cast'),
                             ('completed', 'sleep'), ('cancelled', 'goto')]:
            for _ in range(3):
                self.add(status, tool=tool); self.tick()
            self.assertIsNone(self.hint)

    def test_long_goto_or_pending_body_work_hides_advice_without_mutation(self):
        self.failures()
        self.body['task'] = {'busy': True, 'task_id': 'long-walk'}
        snapshot = copy.deepcopy(self.body)
        self.assertIsNone(self.tick())
        self.assertEqual(self.body, snapshot)
        self.body['task']['busy'] = False
        self.add('claimed')
        self.assertIsNone(self.tick())

    def test_goal_and_life_change_ignore_old_receipts(self):
        self.failures()
        for key, value in [('goal', 'rest at home'), ('life', 'life-2')]:
            self.scope[key] = value
            self.assertIsNone(self.tick())
            self.assertIsNone(self.state['run'])

    def test_rest_and_elapsed_window_clear_old_advice(self):
        self.failures()
        self.assertIsNone(self.tick(goal_state='resting'))
        self.assertIsNone(self.tick())
        self.failures()
        self.now += 601
        self.assertIsNone(self.tick())

    def test_wrong_action_turn_tool_or_body_identity_cannot_be_evidence(self):
        for field, value in [('actionId', 'e' * 32), ('turnId', 'foreign'), ('tool', 'attack')]:
            row, raw = self.add(); raw[field] = value; self.tick()
        for _ in range(3):
            row, raw = self.add(); raw['before']['bodyUuid'] = 'foreign'; self.tick()
        self.assertIsNone(self.hint)

    def test_missing_snapshot_and_nonconfirmed_completed_never_prove_no_effect(self):
        for _ in range(3):
            row, raw = self.add('completed'); raw['after'].pop('position'); self.tick()
        for _ in range(3):
            row, raw = self.add('completed'); raw['completionConfirmed'] = False; self.tick()
        self.assertIsNone(self.hint)

    def test_real_motor_payload_hash_uses_identical_unicode_encoding(self):
        import hashlib
        for _ in range(3):
            row, raw = self.add()
            raw['args']['note'] = '河边'
            payload = {'tool': raw['tool'], 'args': raw['args']}
            row['command'] = copy.deepcopy(payload)
            row['payloadHash'] = hashlib.sha256(json.dumps(payload, sort_keys=True,
                separators=(',', ':'), allow_nan=False).encode()).hexdigest()
            self.tick()
        self.assertIsNotNone(self.hint)

    def test_successful_eat_consumption_breaks_no_effect_sequence(self):
        for _ in range(3):
            self.add('completed', tool='eat', code='executed'); self.tick()
        self.assertEqual(self.hint['kind'], 'repeated_no_observed_effect')
        row, raw = self.add('completed', tool='eat', code='executed')
        raw['after']['counts']['minecraft:bread'] -= 1
        raw['after']['hunger'] += 5
        self.assertIsNone(self.tick())

    def test_explicit_native_rejection_without_completion_still_proves_refusal(self):
        for _ in range(3):
            row, raw = self.add()
            raw.update(status='rejected', completionConfirmed=False)
            self.tick()
        self.assertEqual(self.hint['kind'], 'repeated_native_failure')

    def test_first_deployment_does_not_relabel_historical_receipts(self):
        for _ in range(3):
            self.add()
        self.state = {}
        self.assertIsNone(self.tick())
        self.assertEqual(self.loads, [])

    def test_different_args_or_failure_code_breaks_consecutive_sequence(self):
        for _ in range(2):
            self.add(); self.tick()
        self.add(code='timeout'); self.tick()
        self.assertIsNone(self.hint)
        row, raw = self.add(code='timeout')
        raw['args']['x'] = 83; row['command']['args']['x'] = 83
        self.tick(); self.assertIsNone(self.hint)

    def test_partial_failed_effects_still_report_refusal_without_claiming_zero_effect(self):
        for _ in range(3):
            self.add(changed=True); self.tick()
        self.assertEqual(self.hint['kind'], 'repeated_native_failure')
        self.assertNotIn('no_effect', self.hint['evidence'])

    def test_receipt_load_and_state_are_bounded_and_restart_deduplicates(self):
        for _ in range(20):
            self.add()
        self.tick()
        self.assertLessEqual(len(self.loads), 6)
        for _ in range(25):
            self.tick()
        self.assertEqual(len(self.loads), 20)
        self.assertLess(len(json.dumps(self.state)), 7000)
        self.state = json.loads(json.dumps(self.state))
        self.tick(); self.assertEqual(len(self.loads), 20)


class ControllerProgressAuditTests(unittest.TestCase):
    def test_async_tick_collects_advice_but_does_not_buy_a_slow_turn(self):
        import test_survival_controller as fixtures
        from unittest.mock import patch
        harness = fixtures.ControllerTests(methodName='runTest')
        harness.setUp()
        try:
            c = harness.controller
            c.settings['asyncMotor'] = True
            c.data['active'] = {'taskId': 'existing', 'turnId': 'existing-turn'}
            hint = {'kind': 'repeated_native_failure', 'requestIds': ['r1', 'r2', 'r3']}
            with patch('motor_loop.tick'), patch('motor_progress_audit.observe', return_value=hint) as audit, \
                 patch.object(c, 'poll_model'), patch.object(c, 'submit_model') as submit:
                c.tick()
            audit.assert_called_once()
            submit.assert_not_called()
            self.assertEqual(c.data['motorProgressHint'], hint)
            c.data['wakeReason'] = 'autonomous_review'
            context = c.life_context(harness.gateway.body, {'mission': 'survive'}, 'test-turn')
            self.assertEqual(context['motorProgressHint'], hint)
        finally:
            harness.doCleanups()

    def test_actual_archive_evidence_reaches_incremental_native_envelope(self):
        import test_survival_controller as fixtures
        from numen_gateway import write_json
        from motor_progress_audit import observe
        from behavior_context import prepare
        harness = fixtures.ControllerTests(methodName='runTest')
        harness.setUp()
        probe = ProgressAuditTests(methodName='runTest')
        probe.setUp()
        try:
            c = harness.controller
            c.settings.update(asyncMotor=True, brainProtocol=1, memoryEpoch='audit-1')
            body = probe.body
            control = {'mission': 'find food'}
            write_json(c.root / 'motor-inbox.json', {'schema': 1, 'requests': []})
            c.clock = lambda: probe.now
            self.assertIsNone(observe(c, body, control))
            for _ in range(3):
                row, receipt = probe.add()
                write_json(c.root / 'action-receipts' / (receipt['actionId'] + '.json'), receipt)
                write_json(c.root / 'motor-inbox.json', {'schema': 1, 'requests': probe.rows})
                hint = observe(c, body, control)
            self.assertEqual(hint['count'], 3)
            c.data['motorProgressHint'] = hint
            c.data['wakeReason'] = 'autonomous_review'
            context = c.life_context(harness.gateway.body, control, 'survival-audit-1')
            self.assertEqual(context['motorProgressHint']['actionIds'], hint['actionIds'])
            _, envelope, _ = prepare(c.root, c.session, context, {})
            self.assertEqual(envelope['updates']['motorProgressHint'], hint)
            self.assertFalse(harness.gateway.actions)
            self.assertFalse(harness.backend.submitted)
        finally:
            harness.doCleanups()


if __name__ == '__main__':
    unittest.main()

"""Real admin mailbox, transport adapter and receipt reconciliation; no live writes."""
from contextlib import contextmanager, nullcontext
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'world/ops'), str(ROOT / 'world/sidecar'), str(ROOT / 'world/survival')]
from world_admin_tools import ADMIN_ACTOR, AdminStore
from world_admin_consumer import WorldAdminConsumer, NativeAdminRcon
from world_rescue import KIRITO, NativeRescue, RescueBusy, body_guard, native_id, PREFIX


class RescueTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(); self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.now = 1800000000.0
        self.clock = lambda: self.now
        self.store = AdminStore(self.root, self.clock)
        self.calls, self.receipts = [], {}
        self.before_write = lambda: None
        self.lose_reply = False
        self.target = {'bodyUuid': KIRITO, 'dimension': 'minecraft:overworld', 'position': [-642.5, 49, 1058.5]}
        self.consumer = WorldAdminConsumer(self.root, self.native_run, self.clock, rescue_guard=nullcontext)

    def native_run(self, command):
        self.calls.append(command)
        tokens = command.split()
        if tokens[1] == 'rescue_inspect':
            return PREFIX + json.dumps({'schema': 1, 'phase': 'observed', 'quoteId': tokens[2],
                'observedAt': int(self.now * 1000), 'pair': {'kirito': self.target}, 'safeLandings': {'kirito': {'position': [-642.5, 68, 1058.5]}}})
        if tokens[1] == 'rescue_status':
            return PREFIX + json.dumps(self.receipts[tokens[2]])
        self.before_write()
        receipt = {'schema': 1, 'phase': 'completed', 'requestId': tokens[2], 'quoteId': tokens[3],
            'target': tokens[4], 'executionConfirmed': True, 'before': self.target,
            'after': {**self.target, 'position': [-642.5, 68, 1058.5]}}
        self.receipts[tokens[2]] = receipt
        if self.lose_reply: raise TimeoutError('lost after actual native commit')
        return PREFIX + json.dumps(receipt)

    def inspect(self, request_id='inspect-test-0001', actor=ADMIN_ACTOR):
        self.store.submit(actor, request_id, 'rescue_inspect', {})
        self.consumer.tick()
        return self.store.receipt(actor, request_id)

    def rescue(self, request_id='rescue-test-0001', actor=ADMIN_ACTOR):
        return self.store.submit(actor, request_id, 'rescue', {'observationRequestId': 'inspect-test-0001', 'target': 'kirito', 'reason': 'Trapped in the mine with failed navigation.'})

    def test_one_write_has_durable_before_then_native_readback_and_engineering_case(self):
        self.assertEqual(self.inspect()['status'], 'completed')
        self.rescue()
        seen = []
        self.before_write = lambda: seen.append(self.store.receipt(ADMIN_ACTOR, 'rescue-test-0001'))
        self.consumer.tick()
        result = self.store.receipt(ADMIN_ACTOR, 'rescue-test-0001')
        self.assertEqual(seen[0]['status'], 'unknown')
        self.assertEqual(seen[0]['before']['position'][1], 49)
        self.assertTrue(result['executionConfirmed'])
        self.assertEqual(result['after']['position'][1], 68)
        from world_team import TeamStore, ENGINEER
        cases = TeamStore(ADMIN_ACTOR, self.root).cases(ENGINEER)['cases']
        self.assertEqual(len(cases), 1)
        from world_admin_tools import WorldAdminTools
        actual = WorldAdminTools(ADMIN_ACTOR, self.root).receipt('rescue-test-0001')
        self.assertEqual(actual['engineeringFeedback']['caseId'], cases[0]['id'])
        self.rescue(); self.consumer.tick()
        self.assertEqual(len([c for c in self.calls if c.startswith('qdmaid rescue ')]), 1)
        self.assertEqual(len(TeamStore(ADMIN_ACTOR, self.root).cases(ENGINEER)['cases']), 1)

    def test_lost_response_is_only_reconciled_by_original_native_status(self):
        self.inspect(); self.rescue(); self.lose_reply = True
        self.consumer.tick()
        self.assertEqual(self.store.receipt(ADMIN_ACTOR, 'rescue-test-0001')['status'], 'unknown')
        self.consumer.tick()
        result = self.store.receipt(ADMIN_ACTOR, 'rescue-test-0001')
        self.assertEqual(result['status'], 'completed')
        self.assertEqual(result['reconciledBy'], 'native-rescue-status')
        self.assertEqual(len([c for c in self.calls if c.startswith('qdmaid rescue ')]), 1)
        from world_team import TeamStore, ENGINEER
        self.assertEqual(len(TeamStore(ADMIN_ACTOR, self.root).cases(ENGINEER)['cases']), 1)

    def test_unproven_native_status_keeps_unknown_and_blocks_later_world_writes(self):
        self.inspect(); self.rescue(); self.lose_reply = True
        self.consumer.tick()
        self.receipts.clear()
        self.store.submit(ADMIN_ACTOR, 'later-rule-0001', 'rule', {'rule': 'keepInventory', 'value': True})
        self.consumer.tick()
        self.assertEqual(self.store.receipt(ADMIN_ACTOR, 'rescue-test-0001')['status'], 'unknown')
        self.assertEqual(self.store.receipt(ADMIN_ACTOR, 'later-rule-0001')['status'], 'queued')

    def test_crashed_claim_gets_unknown_feedback_without_replay_or_fake_terminal(self):
        self.inspect(); self.rescue(); self.store.claim()
        self.now += 31
        self.consumer.tick()
        with self.store.connect() as db:
            self.assertEqual(db.execute("SELECT status FROM requests WHERE id='rescue-test-0001'").fetchone()[0], 'claimed')
        from world_team import TeamStore, ENGINEER
        self.assertEqual(len(TeamStore(ADMIN_ACTOR, self.root).cases(ENGINEER)['cases']), 1)
        self.assertFalse(any(c.startswith('qdmaid rescue ') for c in self.calls))

    def test_missing_other_actor_or_stale_inspection_sends_no_rescue(self):
        self.rescue(); self.consumer.tick()
        self.assertEqual(self.store.receipt(ADMIN_ACTOR, 'rescue-test-0001')['code'], 'rescue_observation_required')
        self.inspect(); self.now += 181
        self.rescue('rescue-stale-0001'); self.consumer.tick()
        self.assertEqual(self.store.receipt(ADMIN_ACTOR, 'rescue-stale-0001')['code'], 'rescue_observation_expired')
        self.assertFalse(any(c.startswith('qdmaid rescue ') for c in self.calls))
        self.assertNotEqual(native_id(ADMIN_ACTOR, 'inspect-test-0001'), native_id('game:5swvhK', 'inspect-test-0001'))

    def test_busy_precondition_defers_same_request_without_mutation_or_unknown(self):
        self.inspect(); self.rescue()
        @contextmanager
        def busy():
            raise RescueBusy('body_task_in_flight')
            yield
        self.consumer.rescue.guard = busy
        self.consumer.tick()
        result = self.store.receipt(ADMIN_ACTOR, 'rescue-test-0001')
        self.assertEqual(result['status'], 'queued')
        self.assertFalse(result['executionConfirmed'])
        self.assertFalse(any(c.startswith('qdmaid rescue ') for c in self.calls))
        self.consumer.rescue.guard = nullcontext
        self.consumer.tick()
        self.assertEqual(self.store.receipt(ADMIN_ACTOR, 'rescue-test-0001')['status'], 'completed')

    def test_manifest_revocation_is_rechecked_before_dispatch(self):
        with patch('world_admin_tools.is_bound_yui', return_value=True):
            self.inspect(actor='game:5swvhK'); self.rescue(actor='game:5swvhK')
        self.consumer.tick()
        self.assertEqual(self.store.receipt('game:5swvhK', 'rescue-test-0001')['status'], 'rejected')
        self.assertFalse(any(c.startswith('qdmaid rescue ') for c in self.calls))

    def test_shared_body_guard_refuses_unsettled_actions_and_unknowns(self):
        state = self.root / 'survivor'; state.mkdir()
        (state / 'settings.json').write_text(json.dumps({'bodyName': 'Kirito', 'bodyUuid': KIRITO}))
        run = lambda _: json.dumps({'success': True, 'message': 'No background task'})
        with body_guard(run, state): pass
        (state / 'unknown.json').write_text('{}')
        with self.assertRaisesRegex(ValueError, 'body_outcome_unknown'):
            with body_guard(run, state): self.fail('must not enter mutation')
        (state / 'unknown.json').unlink()
        (state / 'inflight-action.json').write_text('{}')
        with self.assertRaises(RescueBusy):
            with body_guard(run, state): self.fail('must not enter mutation')

    def test_transport_only_allows_fixed_rescue_protocol(self):
        uid = native_id(ADMIN_ACTOR, 'request-0001')
        self.assertTrue(NativeAdminRcon.allowed('qdmaid rescue %s %s kirito' % (uid, uid)))
        for command in ('tp Kirito 0 100 0', 'qdmaid rescue %s %s other' % (uid, uid),
                        'qdmaid rescue_status ' + uid + '\nkill @e', 'numen_act invoke "Other" task_status {}'):
            self.assertFalse(NativeAdminRcon.allowed(command))

    def test_receipt_wait_reads_original_worker_result_without_dispatching(self):
        self.store.submit(ADMIN_ACTOR, 'inspect-test-0001', 'rescue_inspect', {})
        with patch('world_admin_tools.time.sleep', side_effect=lambda _: self.consumer.tick()):
            receipt = self.store.wait_receipt(ADMIN_ACTOR, 'inspect-test-0001', 50)
        self.assertEqual(receipt['status'], 'completed')
        self.assertEqual(len(self.calls), 1)
        for invalid in (-1, 51, True, 0.5):
            with self.assertRaises(ValueError): self.store.wait_receipt(ADMIN_ACTOR, 'inspect-test-0001', invalid)


if __name__ == '__main__': unittest.main()

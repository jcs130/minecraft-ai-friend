"""A confirmed meal can be followed by another; transport retries cannot buy one."""
import asyncio
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'world/survival'))
import motor_mailbox as mailbox
from numen_gateway import NumenGateway, action_lock, read_json, write_json

TURN = 'survival-plan-0001'
FOOD = {'tool': 'eat', 'args': {'item_id': 'minecraft:bread'}}
BODY_TOOLS = ('move', 'interact_at', 'mine', 'craft', 'eat', 'equip', 'place_block',
              'drop_items', 'farm', 'open_container', 'transfer_items', 'close_container',
              'sleep', 'trade', 'guild_claim', 'guild_release', 'guild_deliver', 'game_cast', 'game_learn')


class MotorOccurrenceTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.now = 1000
        write_json(self.root / 'control.json', {'schema': 1, 'enabled': True, 'mission': 'farm', 'missionChangedAt': 1})
        write_json(self.root / 'settings.json', {'asyncMotor': True})
        write_json(self.root / 'lease.json', {'schema': 1, 'status': 'open', 'turnId': 'skill-current'})
        mailbox.open_cognition(self.root, TURN, 1100000, lambda: self.now)

    def enqueue(self, previous=None, payload=None, turn=TURN):
        with action_lock(self.root):
            if previous is None:
                return mailbox.enqueue_locked(self.root, turn, 'action', payload or FOOD, lambda: self.now)
            return mailbox.enqueue_locked(self.root, turn, 'action', payload or FOOD, lambda: self.now,
                                          previous_request_id=previous)

    def settle(self, identity, status='completed', confirmed=True):
        with action_lock(self.root):
            claimed = mailbox.claim_locked(self.root, lambda: self.now)
            self.assertEqual(claimed['requestId'], identity)
            mailbox.finish_locked(self.root, identity, status,
                {'actionId': 'a' * 32, 'tool': 'eat', 'status': status, 'completionConfirmed': confirmed,
                 'result': {'code': 'partial_native_failure' if status == 'failed' else 'observed'},
                 'after': {'position': {'x': 2, 'y': 64, 'z': 3}}})

    def rows(self):
        return read_json(self.root / 'motor-inbox.json')['requests']

    def test_confirmed_duplicate_reports_actual_completion_and_repeat_identity(self):
        first = self.enqueue()
        self.settle(first['requestId'])
        duplicate = self.enqueue()
        self.assertEqual(duplicate['requestId'], first['requestId'])
        self.assertEqual(duplicate['code'], 'motor_completed')
        self.assertTrue(duplicate['executionConfirmed'])
        self.assertEqual(duplicate['receipt']['actionId'], 'a' * 32)
        self.assertEqual(duplicate['nextRepeat'], {'previousRequestId': first['requestId']})
        self.assertEqual(len(self.rows()), 1)

    def test_explicit_successor_is_durable_and_same_predecessor_retry_never_replays(self):
        body_before = (self.root / 'lease.json').read_bytes()
        first = self.enqueue()
        self.settle(first['requestId'])
        second = self.enqueue(first['requestId'])
        self.assertNotEqual(second['requestId'], first['requestId'])
        self.assertEqual(second['status'], 'queued')
        self.assertEqual(self.enqueue(first['requestId'])['requestId'], second['requestId'])
        self.settle(second['requestId'])
        self.assertEqual(self.enqueue(first['requestId'])['requestId'], second['requestId'])
        third = self.enqueue(second['requestId'])
        self.assertNotIn(third['requestId'], (first['requestId'], second['requestId']))
        self.assertEqual(read_json(self.root / 'cognition-lease.json')['actionsUsed'], 3)
        self.assertEqual(self.rows()[1]['previousRequestId'], first['requestId'])
        self.assertEqual((self.root / 'lease.json').read_bytes(), body_before)

    def test_unfinished_predecessor_returns_exact_identity_and_cannot_enqueue(self):
        first = self.enqueue()
        for status in ('queued', 'claimed', 'unknown', 'dispatched', 'failed', 'cancelled', 'expired', 'completed'):
            with self.subTest(status=status):
                data = mailbox.view(self.root)
                data['requests'][0].update(status=status, receipt={'status': status, 'completionConfirmed': False})
                write_json(self.root / 'motor-inbox.json', data)
                reply = self.enqueue(first['requestId'])
                self.assertEqual(reply['requestId'], first['requestId'])
                self.assertEqual(reply['status'], status)
                self.assertFalse(reply['executionConfirmed'])
                self.assertNotIn('nextRepeat', reply)
                self.assertFalse(reply['repeatAccepted'])
                self.assertEqual(len(self.rows()), 1)
        self.assertEqual(read_json(self.root / 'cognition-lease.json')['actionsUsed'], 1)

    def test_failed_partial_native_work_cannot_be_repeated_even_with_confirmed_receipt(self):
        first = self.enqueue()
        self.settle(first['requestId'], 'failed', True)
        reply = self.enqueue(first['requestId'])
        self.assertFalse(reply['ok'])
        self.assertEqual(reply['code'], 'motor_failed')
        self.assertEqual(reply['receipt']['outcomeDetail'], 'partial_native_failure')
        self.assertNotIn('nextRepeat', reply)
        self.assertEqual(len(self.rows()), 1)

    def test_predecessor_requires_exact_turn_tool_and_arguments_not_a_fresh_token(self):
        first = self.enqueue()
        self.settle(first['requestId'])
        for previous, payload in (('a' * 64, FOOD), ('new-call', FOOD),
                (first['requestId'], {'tool': 'eat', 'args': {'item_id': 'minecraft:apple'}}),
                (first['requestId'], {'tool': 'drop_items', 'args': {'item_id': 'minecraft:bread'}})):
            with self.subTest(previous=previous, payload=payload), self.assertRaisesRegex(ValueError, 'motor_previous_'):
                self.enqueue(previous, payload)
        mailbox.close_cognition(self.root, TURN)
        mailbox.open_cognition(self.root, 'survival-plan-0002', 1100000, lambda: self.now)
        with self.assertRaisesRegex(ValueError, 'motor_previous_'):
            self.enqueue(first['requestId'], turn='survival-plan-0002')
        self.assertEqual(len(self.rows()), 1)

    def test_existing_legacy_identity_survives_payload_removal_without_new_schema_reset(self):
        first = self.enqueue()
        expected = hashlib.sha256((TURN + '\0action\0' + json.dumps(FOOD, sort_keys=True,
            separators=(',', ':'))).encode()).hexdigest()
        self.assertEqual(first['requestId'], expected)
        self.settle(first['requestId'])
        data = mailbox.view(self.root)
        data['requests'][0].pop('payloadHash', None)
        data['requests'][0].pop('command', None)
        write_json(self.root / 'motor-inbox.json', data)
        self.assertNotEqual(self.enqueue(first['requestId'])['requestId'], first['requestId'])

    def test_large_truncated_command_uses_full_payload_hash_for_successor_binding(self):
        payload = {'tool': 'game_cast', 'args': {'skill_id': 'fixture', 'params': {'route': 'x' * 2000}}}
        first = self.enqueue(payload=payload)
        self.settle(first['requestId'])
        second = self.enqueue(first['requestId'], payload)
        self.settle(second['requestId'])
        self.assertTrue(self.rows()[1]['command']['argsTruncated'])
        changed = {'tool': 'game_cast', 'args': {'skill_id': 'fixture', 'params': {'route': 'y' * 2000}}}
        with self.assertRaisesRegex(ValueError, 'motor_previous_'):
            self.enqueue(second['requestId'], changed)
        self.assertNotEqual(self.enqueue(second['requestId'], payload)['requestId'], second['requestId'])

    def test_explicit_occurrences_keep_original_six_action_budget(self):
        previous = None
        predecessors = []
        for _ in range(6):
            predecessors.append(previous)
            row = self.enqueue(previous)
            self.settle(row['requestId'])
            previous = row['requestId']
        with self.assertRaisesRegex(ValueError, 'cognition_command_limit'):
            self.enqueue(previous)
        self.assertEqual(self.enqueue(predecessors[-1])['requestId'], previous)
        self.assertEqual(len(self.rows()), 6)

    def test_two_intended_meals_dispatch_twice_while_ten_transport_retries_do_not_eat_again(self):
        from motor_loop import dispatch
        body = {'hunger': 5, 'bread': 4}
        receipts, calls = {}, []
        def action(turn_id, tool, args):
            calls.append((turn_id, tool, args))
            body.update(hunger=body['hunger'] + 5, bread=body['bread'] - 1)
            receipt = {'actionId': f'{len(calls):032x}', 'tool': tool, 'args': args,
                       'turnId': turn_id, 'status': 'completed', 'completionConfirmed': True}
            receipts[turn_id] = [receipt]
            return {'ok': True, 'code': 'completed', 'actionId': receipt['actionId']}
        controller = SimpleNamespace(root=self.root, clock=lambda: self.now, data={},
            gateway=SimpleNamespace(open_lease=lambda *a: None, close_lease=lambda **kw: None,
                action=action, turn_receipts=lambda turn: receipts.get(turn, [])),
            collect_action_receipts=lambda turn: None, record=lambda *a, **kw: None,
            pause=lambda why: self.fail(why))
        first = self.enqueue()
        self.assertTrue(dispatch(controller))
        for _ in range(10):
            duplicate = self.enqueue()
            self.assertEqual(duplicate['requestId'], first['requestId'])
            self.assertFalse(dispatch(controller))
        self.assertEqual(body, {'hunger': 10, 'bread': 3})
        second = self.enqueue(duplicate['nextRepeat']['previousRequestId'])
        self.assertTrue(dispatch(controller))
        for _ in range(10):
            self.assertEqual(self.enqueue(first['requestId'])['requestId'], second['requestId'])
            self.assertFalse(dispatch(controller))
        self.assertEqual(body, {'hunger': 15, 'bread': 2})
        self.assertEqual(len(calls), 2)
        self.assertNotEqual(calls[0][0], calls[1][0])

    def test_lost_dispatch_ack_and_restart_keep_original_claim_without_repeat(self):
        from motor_loop import dispatch, reconcile
        calls, pauses = [], []
        def action(*args, **kwargs):
            calls.append((args, kwargs))
            raise TimeoutError('lost ACK after native admission')
        controller = SimpleNamespace(root=self.root, clock=lambda: self.now, data={},
            gateway=SimpleNamespace(open_lease=lambda *a: None, action=action, turn_receipts=lambda turn: []),
            pause=pauses.append)
        first = self.enqueue()
        with self.assertRaises(TimeoutError):
            dispatch(controller)
        self.assertEqual(self.enqueue(first['requestId'])['status'], 'claimed')
        reconcile(controller)  # A restarted loop has only the durable claim and no proven receipt.
        unknown = self.enqueue(first['requestId'])
        self.assertEqual(unknown['requestId'], first['requestId'])
        self.assertEqual(unknown['status'], 'unknown')
        self.assertFalse(dispatch(controller))
        self.assertEqual(len(calls), 1)
        self.assertEqual(len(self.rows()), 1)

    def test_status_projection_exposes_only_confirmed_completion_repeat_hint(self):
        first = self.enqueue()
        self.assertNotIn('nextRepeat', mailbox.public(self.root)['recent'][0])
        self.settle(first['requestId'])
        for detail in ('full', 'brief'):
            row = mailbox.public(self.root, detail)['recent'][0]
            self.assertEqual(row['nextRepeat'], {'previousRequestId': first['requestId']})

    def test_gateway_routes_repeat_metadata_only_to_queue_and_rejects_direct_lease(self):
        client = NumenGateway.__new__(NumenGateway)
        client.state, client.clock = self.root, lambda: self.now
        first = client.action(TURN, 'eat', FOOD['args'])
        self.settle(first['requestId'])
        with patch.object(client, 'snapshot', side_effect=AssertionError('body must not execute during enqueue')):
            second = client.action(TURN, 'eat', FOOD['args'], previous_request_id=first['requestId'])
        self.assertNotEqual(second['requestId'], first['requestId'])
        self.assertEqual(self.rows()[1]['payload'], FOOD)
        write_json(self.root / 'settings.json', {'asyncMotor': False})
        with patch.object(client, 'snapshot', side_effect=AssertionError('unsupported predecessor must not execute')):
            reply = client.action(TURN, 'eat', FOOD['args'], previous_request_id=first['requestId'])
        self.assertEqual(reply['code'], 'motor_previous_requires_cognition')

    def test_gateway_closed_or_expired_current_cognition_marks_turn_ended_without_enqueue_or_dispatch(self):
        client = NumenGateway.__new__(NumenGateway)
        client.state, client.clock = self.root, lambda: self.now
        original = read_json(self.root / 'cognition-lease.json')
        for status, expires, code in (('closed', 1100000, 'cognition_closed'),
                                      ('open', 1000000, 'cognition_expired')):
            with self.subTest(code=code):
                write_json(self.root / 'cognition-lease.json', original | {'status': status, 'expiresAt': expires})
                with patch.object(mailbox, 'enqueue_locked') as enqueue, \
                     patch.object(client, 'snapshot') as snapshot, patch.object(client, '_invoke') as invoke:
                    reply = client.action(TURN, 'eat', FOOD['args'])
                self.assertFalse(reply['ok'])
                self.assertEqual(reply['code'], code)
                self.assertEqual(reply['turnId'], TURN)
                self.assertEqual(reply['turnEnded'], {'contract': 'qiandeng-survival-authority-ended-v1',
                    'authorityEnded': True, 'gameOutcomeConfirmed': False})
                self.assertFalse(reply['dispatched'])
                self.assertFalse(reply['writePerformed'])
                enqueue.assert_not_called()
                snapshot.assert_not_called()
                invoke.assert_not_called()
                self.assertFalse((self.root / 'motor-inbox.json').exists())

    def test_public_mcp_schema_is_optional_and_eat_forwards_predecessor_outside_native_args(self):
        from mcp_server import make_server
        client = NumenGateway.__new__(NumenGateway)
        client.state, client.clock = self.root, lambda: self.now
        async def check():
            server = make_server(client)
            listed = {tool.name: tool for tool in await server.list_tools()}
            import native_tools
            self.assertTrue(native_tools.valid_tools([{'name': tool.name, 'enabled': True,
                'input_schema': tool.inputSchema} for tool in listed.values()]))
            for name in BODY_TOOLS:
                schema = listed[name].inputSchema
                self.assertIn('previous_request_id', schema['properties'], name)
                self.assertIsNone(schema['properties']['previous_request_id']['default'])
                self.assertNotIn('previous_request_id', schema.get('required', []))
            with patch.object(client, 'action', return_value={'ok': True}) as action:
                await server.call_tool('eat', {'turn_id': TURN, 'item_id': 'minecraft:bread'})
                action.assert_called_with(TURN, 'eat', FOOD['args'])
                await server.call_tool('eat', {'turn_id': TURN, 'item_id': 'minecraft:bread',
                    'previous_request_id': 'a' * 64})
                action.assert_called_with(TURN, 'eat', FOOD['args'], previous_request_id='a' * 64)
        asyncio.run(check())


if __name__ == '__main__':
    unittest.main()

"""One native drop with strict effect receipts; no live world or model requests."""
import base64
import asyncio
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
import uuid
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/survival'))
sys.path.insert(0, str(ROOT / 'tests'))
from test_survival_gateway import MockRcon, FakeSocket, BODY_UUID, NOW, TURN
from numen_gateway import NumenGateway, RconClient, GatewayError, TOOLS, DIRECT_ACTIONS, read_json, write_json
from drop_actions import DropActions, PREFIX, preflight

ARGS = {'item_id': 'minecraft:oak_log', 'count': 4}
ACTION = 'a' * 32
BEFORE = {'bodyUuid': BODY_UUID, 'dimension': 'minecraft:overworld'}
EPOCH = 'bdf75a12-887a-4d36-87b7-e678bcf00a6b'


def envelope(action=ACTION, args=ARGS, state='SUCCESS'):
    return {'schema': 1, 'capability': 'numen_interaction_receipt_v1', 'actorUuid': BODY_UUID,
        'requestId': action, 'epoch': EPOCH, 'tool': 'drop_items', 'args': dict(args),
        'observedAt': NOW * 1000, 'dispatched': True, 'nativeTaskId': 't18',
        'status': 'terminal', 'nativeState': state, 'completedAt': NOW * 1000,
        'result': {'success': state == 'SUCCESS', 'data': {
            'capability': 'component_preserving_drop_v1', 'item_id': args['item_id'],
            'requested_count': args['count'], 'dropped_count': args['count'] if state == 'SUCCESS' else 0,
            'inventory_before': 4, 'inventory_after': 4 - args['count'] if state == 'SUCCESS' else 4,
            'inventory_touched': True, 'dimension': 'minecraft:overworld', 'pickup_confirmed': False,
            'entities': [{'entityUuid': 'cd17ed1b-a9e4-4eb3-bfce-6cbcc19e5b37', 'sourceSlot': 0,
                'count': args['count'], 'itemId': args['item_id'], 'componentSha256': 'f' * 64,
                'componentsVerified': True, 'entityObserved': True, 'x': 100.0, 'y': 65.4, 'z': 100.0}]
                if state == 'SUCCESS' else []}}}


class DropRcon(MockRcon):
    def __init__(self):
        super().__init__()
        self.drop_state = 'SUCCESS'
        self.lose_ack = False
        self.accepted = False
        self.query_change = {}
        self.on_send = None
        self.drop = None

    def cmd(self, command):
        if command.startswith('qdworld drop '):
            self.calls.append(command)
            _, _, actor, action, payload = command.split()
            args = json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))
            assert actor == BODY_UUID
            if self.on_send: self.on_send(action)
            self.drop = envelope(action, args, self.drop_state)
            if self.lose_ack: raise TimeoutError('lost original native ACK')
            value = copy.deepcopy(self.drop)
            if self.accepted:
                value['status'] = 'accepted'
                for name in ('result', 'nativeState', 'completedAt'): value.pop(name)
            return PREFIX + json.dumps(value)
        if command.startswith('qdworld dropping '):
            self.calls.append(command)
            return PREFIX + json.dumps(self.drop | self.query_change)
        return super().cmd(command)


class DropReceiptTests(unittest.TestCase):
    def setUp(self):
        self.rcon = DropRcon()
        self.client = DropActions(NumenGateway(rcon=self.rcon), sleep=lambda _: None, max_polls=2)

    def send(self):
        return self.client.dispatch(ACTION, BEFORE, ARGS)

    def test_normal_terminal_ack_does_not_need_an_extra_query(self):
        result = self.send()
        self.assertTrue(result['success'])
        self.assertFalse(result['data']['pickup_confirmed'])
        self.assertEqual(len(self.rcon.calls), 1)

    def test_lost_ack_and_accepted_only_query_original_request(self):
        for option in ('lose_ack', 'accepted'):
            with self.subTest(option=option):
                self.rcon = DropRcon(); setattr(self.rcon, option, True)
                self.client.gateway.rcon = self.rcon
                self.assertTrue(self.send()['success'])
                self.assertEqual(len(self.rcon.calls), 2)
                self.assertTrue(self.rcon.calls[0].startswith('qdworld drop '))
                self.assertEqual(self.rcon.calls[1], f'qdworld dropping {BODY_UUID} {ACTION}')

    def test_real_rcon_decoder_preserves_large_receipt_and_lost_end_only_queries(self):
        args = {'item_id': ARGS['item_id'], 'count': 36}
        row = envelope(args=args)
        data = row['result']['data']
        data.update(inventory_before=36, inventory_after=0)
        sample = data['entities'][0]
        data['entities'] = [dict(sample, entityUuid=str(uuid.UUID(int=i+1)),
                                 sourceSlot=i, count=1) for i in range(36)]
        wire = PREFIX + json.dumps(row, separators=(',', ':'))
        self.assertGreater(len(wire), 8192)
        packet = RconClient._packet
        for lose_end in (False, True):
            with self.subTest(lose_end=lose_end), tempfile.TemporaryDirectory() as folder:
                secret = Path(folder) / 'secret'; secret.write_text('fixture-only')
                frames = [packet(1, 2, ''), *[packet(2, 0, wire[i:i+4096])
                                            for i in range(0, len(wire), 4096)]]
                sockets = [FakeSocket(frames + ([] if lose_end else [packet(3, 0, 'Unknown request 0')]))]
                if lose_end:
                    sockets.append(FakeSocket(frames + [packet(3, 0, 'Unknown request 0')]))
                client = DropActions(NumenGateway(rcon=RconClient(secret=secret)), sleep=lambda _: None)
                with patch('numen_gateway.socket.create_connection', side_effect=sockets):
                    result = client.dispatch(ACTION, BEFORE, args)
                self.assertTrue(result['success'])
                self.assertEqual(result['nativeDropReceipt'], row)
                commands = [raw[12:-2].decode('utf8') for sock in sockets for raw in sock.sent
                            if int.from_bytes(raw[8:12], 'little') == 2]
                self.assertEqual(len(commands), 2 if lose_end else 1)
                self.assertEqual(sum(c.startswith('qdworld drop ') for c in commands), 1)
                if lose_end:
                    self.assertEqual(commands[1], f'qdworld dropping {BODY_UUID} {ACTION}')

    def test_accepted_identity_epoch_or_task_must_never_change(self):
        for changes in ({'epoch': 'cd17ed1b-a9e4-4eb3-bfce-6cbcc19e5b37'},
                        {'nativeTaskId': 't19'}, {'actorUuid': 'other'}, {'requestId': 'c' * 32},
                        {'args': {'item_id': ARGS['item_id'], 'count': 3}}, {'tool': 'eat'}):
            with self.subTest(changes=changes):
                self.rcon = DropRcon(); self.rcon.accepted = True; self.rcon.query_change = changes
                self.client.gateway.rcon = self.rcon
                with self.assertRaises(GatewayError): self.send()
                self.assertEqual(len(self.rcon.calls), 2)

    def test_effect_requires_real_entity_component_and_inventory_evidence(self):
        mutations = [
            lambda row: row.update(schema=True),
            lambda row: row.update(nativeState='FAILED'),
            lambda row: row['result']['data'].update(dimension='minecraft:the_nether'),
            lambda row: row['result']['data'].update(pickup_confirmed=True),
            lambda row: row['result']['data'].update(inventory_after=4),
            lambda row: row['result']['data'].update(entities=[]),
            lambda row: row['result']['data']['entities'][0].update(componentsVerified=False),
            lambda row: row['result']['data']['entities'][0].update(entityObserved=False),
            lambda row: row['result']['data']['entities'][0].update(componentSha256='generic-item-id'),
            lambda row: row['result']['data']['entities'][0].update(count=3),
            lambda row: row['result']['data']['entities'][0].update(sourceSlot=40),
            lambda row: row['result']['data']['entities'][0].update(x=float('nan')),
            lambda row: row['result']['data']['entities'].append(copy.deepcopy(row['result']['data']['entities'][0])),
        ]
        for index, mutate in enumerate(mutations):
            with self.subTest(index=index):
                row = envelope(); mutate(row)
                with self.assertRaises(GatewayError):
                    self.client._read(PREFIX + json.dumps(row), ACTION, BEFORE, ARGS)

    def test_only_main_inventory_counts_and_existing_program_kernel_is_unchanged(self):
        before = {'inventory': [{'id': ARGS['item_id'], 'count': 2, 'slot': 0},
                                {'id': ARGS['item_id'], 'count': 64, 'slot': 100},
                                {'id': ARGS['item_id'], 'count': 64, 'slot': -106}]}
        with self.assertRaisesRegex(GatewayError, 'insufficient_main_inventory_items'): preflight(before, ARGS)
        before['inventory'].append({'id': ARGS['item_id'], 'count': 2, 'slot': 35})
        preflight(before, ARGS)
        import skill_library
        self.assertIn('drop_items', DIRECT_ACTIONS)
        self.assertNotIn('drop_items', TOOLS)
        self.assertNotIn('drop_items', skill_library.ACTION_TOOLS)


class DropGatewayTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.rcon = DropRcon()
        self.gateway = NumenGateway(self.root, self.rcon, clock=lambda: NOW)
        write_json(self.root / 'settings.json', {'schema': 1, 'bodyName': 'Kirito', 'bodyUuid': BODY_UUID,
            'workArea': {'minX': 64, 'maxX': 160, 'minZ': 64, 'maxZ': 160},
            'anchor': {'x': 0, 'z': 0}, 'protectedRadius': 32})
        write_json(self.root / 'control.json', {'schema': 1, 'enabled': True})
        self.gateway.open_lease(TURN, NOW * 1000 + 120000)
        p = patch('drop_actions.time.sleep', lambda _: None); p.start(); self.addCleanup(p.stop)

    def send(self, **changes):
        return self.gateway.action(TURN, 'drop_items', ARGS | changes)

    def sent(self):
        return [c for c in self.rcon.calls if c.startswith('qdworld drop ')]

    def test_marker_exists_before_send_and_native_terminal_completes(self):
        def verify(action):
            marker = read_json(self.root/'unknown.json')
            self.assertEqual((marker['actionId'], marker['tool']), (action, 'drop_items'))
            self.assertEqual(read_json(self.root/'lease.json')['status'], 'reserved')
        self.rcon.on_send = verify
        result = self.send()
        self.assertTrue(result['ok'], result)
        self.assertTrue(result['completionConfirmed'])
        self.assertEqual(result['receipt']['status'], 'completed')
        self.assertFalse((self.root/'unknown.json').exists())
        self.assertEqual(len(self.sent()), 1)

    def test_real_mcp_exposes_exact_drop_schema_and_forwards_lease_bound_action(self):
        from mcp_server import make_server, TOOL_NAMES
        async def check():
            server = make_server(self.gateway)
            listed = await server.list_tools()
            self.assertEqual(len(listed), 46)
            self.assertEqual({tool.name for tool in listed}, set(TOOL_NAMES))
            tool = next(tool for tool in listed if tool.name == 'drop_items')
            self.assertEqual(set(tool.inputSchema['required']), {'turn_id', 'item_id', 'count'})
            with patch.object(self.gateway, 'action', return_value={'ok': True}) as action:
                await server.call_tool('drop_items', {'turn_id': TURN, **ARGS})
                action.assert_called_once_with(TURN, 'drop_items', ARGS)
        asyncio.run(check())
        self.assertFalse(self.rcon.calls)

    def test_insufficient_or_invalid_quantity_consumes_no_lease_or_world_action(self):
        before = (self.root/'lease.json').read_bytes()
        for changes in ({'count': 5}, {'count': 0}, {'count': 65}, {'count': True},
                        {'count': 1.0}, {'item_id': 'missing_namespace'}, {'extra': True}):
            with self.subTest(changes=changes):
                result = self.send(**changes)
                self.assertFalse(result['ok'])
                self.assertEqual((self.root/'lease.json').read_bytes(), before)
                self.assertFalse((self.root/'unknown.json').exists())
                self.assertFalse(self.sent())

    def test_native_failed_task_is_confirmed_failed_not_unknown_or_success(self):
        self.rcon.drop_state = 'FAILED'
        result = self.send()
        self.assertFalse(result['ok'])
        self.assertTrue(result['completionConfirmed'])
        self.assertEqual(result['receipt']['status'], 'failed')
        self.assertFalse((self.root/'unknown.json').exists())

    def test_missing_receipt_after_lost_ack_blocks_replay_across_gateway_restart(self):
        self.rcon.lose_ack = True
        self.rcon.query_change = {'status': 'unknown', 'code': 'native_runtime_interrupted'}
        result = self.send()
        self.assertEqual(result['code'], 'outcome_unknown')
        self.assertTrue((self.root/'unknown.json').exists())
        marker = (self.root/'unknown.json').read_bytes()
        self.gateway = NumenGateway(self.root, self.rcon, clock=lambda: NOW)
        self.assertFalse(self.send()['ok'])
        self.assertEqual((self.root/'unknown.json').read_bytes(), marker)
        self.assertEqual(len(self.sent()), 1)


if __name__ == '__main__': unittest.main()

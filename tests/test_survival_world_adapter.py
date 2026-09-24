import ast
import base64
import inspect
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, call, patch

SURVIVAL = Path(__file__).resolve().parents[1] / 'world/survival'
sys.path.insert(0, str(SURVIVAL))
from body_reconnect import BodyReconnect
from drop_actions import DropActions
from fast_execution import OBSERVATION_LIMIT, program_observation
from food_actions import FoodActions
from numen_gateway import GatewayError, NumenGateway, read_json, write_json
from recipe_lookup import lookup_recipe
from world_actions import WorldActions
from world_adapter import WorldAdapter

BODY = 'd4ac9523-4962-43ed-98c5-19b49e104048'
OWNER = 'e5005711-be9f-44b7-aaad-6993c0ba5df4'
ACTION = 'a' * 32
TURN = 'turn_' + 'b' * 24
POINT = {'x': 10, 'y': 64, 'z': 11}
BINDING = {'bodyName': 'CheckedBody', 'bodyUuid': BODY, 'ownerUuid': OWNER}
SURFACE = {'snapshot', 'observe', 'open_lease', 'close_lease', 'action', 'action_status',
           'turn_receipts', 'inspect_block', 'inspect_container', 'sense', 'navigation_observation'}
DOMAINS = {'body_reconnect', 'drop_actions', 'food_actions', 'navigation_sense',
           'recipe_lookup', 'scene_view', 'world_actions'}


def payload(text):
    return base64.urlsafe_b64encode(text.encode('ascii')).decode('ascii').rstrip('=')


class FakeAdapter:
    def navigation_observation(self, body, args):
        self.reads.append(('navigation', body, args))
        return {'ok': False, 'code': 'navigation_sense_unavailable'}

    def sense(self, sensor='catalog', arguments=None):
        self.reads.append(('sense', sensor, arguments))
        return {'ok': True, 'sensor': sensor, 'source': 'other-world'}

    def __init__(self):
        self.reads = []

    def snapshot(self):
        return {'bodyUuid': 'other-world-body', 'dimension': 'other-world'}

    def observe(self, radius=8):
        return {'ok': True, 'radius': radius}

    def open_lease(self, turn_id, expires_at, action_limit=1):
        raise AssertionError('Observation must not open a lease')

    def close_lease(self, blocking=False):
        raise AssertionError('Observation must not close a lease')

    def action(self, turn_id, tool, args):
        raise AssertionError('Observation must not dispatch an action')

    def action_status(self, body=None):
        raise AssertionError('Observation must not poll an action')

    def turn_receipts(self, turn_id):
        raise AssertionError('Observation must not read action receipts')

    def inspect_block(self, x, y, z):
        self.reads.append(('block', x, y, z))
        return {'ok': True, 'block': 'other-world:block'}

    def inspect_container(self, x, y, z):
        self.reads.append(('container', x, y, z))
        return {'ok': True, 'contents': []}


class WorldAdapterTests(unittest.TestCase):
    def test_navigation_read_has_explicit_unavailable_on_other_world_without_effects(self):
        adapter = FakeAdapter()
        body = adapter.snapshot()
        request = {'tool': 'navigation_sense', 'args': dict(POINT)}
        result = program_observation(adapter, request, body, 1000)
        self.assertEqual(result['result'], {'ok': False, 'code': 'navigation_sense_unavailable'})
        self.assertEqual(adapter.reads, [('navigation', body, POINT)])

    def test_actual_gateway_structurally_conforms_with_exact_signatures(self):
        gateway = NumenGateway(rcon=Mock(), clock=lambda: 1000)
        self.assertNotIn(WorldAdapter, NumenGateway.__mro__)
        self.assertIsInstance(gateway, WorldAdapter)
        self.assertTrue(issubclass(NumenGateway, WorldAdapter))
        self.assertEqual(program_observation.__annotations__['gateway'], WorldAdapter)
        for name in SURFACE:
            with self.subTest(method=name):
                declared = inspect.signature(getattr(WorldAdapter, name))
                actual = inspect.signature(getattr(NumenGateway, name))
                shape = lambda sig: [(p.name, p.kind, p.default) for p in sig.parameters.values()]
                self.assertEqual(shape(declared), shape(actual))

    def test_protocol_has_only_the_approved_leased_and_read_surface(self):
        tree = ast.parse((SURVIVAL / 'world_adapter.py').read_text(encoding='utf8'))
        protocol = next(node for node in tree.body if isinstance(node, ast.ClassDef))
        self.assertEqual({node.name for node in protocol.body if isinstance(node, ast.FunctionDef)}, SURFACE)
        self.assertFalse(any(isinstance(node, (ast.Assign, ast.AnnAssign)) for node in protocol.body))
        for name in ('rcon', 'cmd', 'dispatch', 'prepare', '_invoke', '_native_interact', '_native_restore_existing'):
            self.assertFalse(hasattr(WorldAdapter, name), name)

    def test_protocol_imports_only_stdlib_without_loading_gateway_or_extensions(self):
        tree = ast.parse((SURVIVAL / 'world_adapter.py').read_text(encoding='utf8'))
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                self.assertEqual(node.level, 0)
                self.assertIn(node.module.split('.')[0], sys.stdlib_module_names)
            elif isinstance(node, ast.Import):
                for alias in node.names:
                    self.assertIn(alias.name.split('.')[0], sys.stdlib_module_names)
        result = subprocess.run([sys.executable, '-I', '-S', '-B', '-c',
            'import sys; sys.path.insert(0, sys.argv[1]); import world_adapter; '
            'assert not {"numen_gateway", "world_actions", "quickjs", "nbtlib", "PIL"} & sys.modules.keys()',
            str(SURVIVAL)], capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_fake_adapter_without_rcon_or_state_handles_both_program_observations(self):
        adapter = FakeAdapter()
        self.assertIsInstance(adapter, WorldAdapter)
        self.assertFalse(hasattr(adapter, 'rcon'))
        self.assertFalse(hasattr(adapter, 'state'))
        body = adapter.snapshot()
        with patch('world_actions.WorldActions', side_effect=AssertionError('Minecraft domain constructed')):
            for tool in ('inspect_block', 'inspect_container'):
                request = {'tool': tool, 'args': dict(POINT)}
                result = program_observation(adapter, request, body, 1000)
                self.assertTrue(result['result']['ok'])
                self.assertEqual(result['args'], POINT)
                self.assertEqual(result['bodyUuid'], body['bodyUuid'])
                self.assertEqual(result['dimension'], body['dimension'])
                self.assertEqual(result['observedAt'], 1000000)
        self.assertEqual(adapter.reads, [('block', 10, 64, 11), ('container', 10, 64, 11)])

    def test_program_read_keeps_exact_size_error_mapping_and_single_call(self):
        adapter = FakeAdapter()
        request = {'tool': 'inspect_block', 'args': POINT}
        exact = {'data': 'x' * (OBSERVATION_LIMIT - len(json.dumps({'data': ''})))}
        for value, expected in ((exact, exact), ({'data': exact['data'] + 'x'}, {'ok': False, 'code': 'ValueError'}),
                                ({'data': float('nan')}, {'ok': False, 'code': 'ValueError'}),
                                ([], {'ok': False, 'code': 'ValueError'})):
            with patch.object(adapter, 'inspect_block', return_value=value) as read:
                self.assertEqual(program_observation(adapter, request, adapter.snapshot(), 1000)['result'], expected)
                read.assert_called_once_with(**POINT)
        for error, code in ((GatewayError('physical_container_not_open'), 'physical_container_not_open'),
                            (OSError('private path'), 'OSError'), (TypeError('private detail'), 'TypeError')):
            with patch.object(adapter, 'inspect_block', side_effect=error) as read:
                self.assertEqual(program_observation(adapter, request, adapter.snapshot(), 1000)['result'],
                                 {'ok': False, 'code': code})
                read.assert_called_once_with(**POINT)
        with self.assertRaisesRegex(ValueError, '^unsupported_program_observation$'):
            program_observation(adapter, {'tool': 'dispatch', 'args': {}}, adapter.snapshot(), 1000)

    def test_gateway_read_wrappers_delegate_locally_and_preserve_errors(self):
        transport = Mock()
        gateway = NumenGateway(rcon=transport)
        for public, domain in (('inspect_block', 'inspect'), ('inspect_container', 'container_view')):
            with self.subTest(method=public), patch('world_actions.WorldActions', autospec=True) as actions:
                method = getattr(actions.return_value, domain)
                method.return_value = {'ok': True}
                self.assertEqual(getattr(gateway, public)(**POINT), {'ok': True})
                actions.assert_called_once_with(gateway)
                method.assert_called_once_with(10, 64, 11)
                method.side_effect = GatewayError('existing_read_rejection')
                with self.assertRaisesRegex(GatewayError, '^existing_read_rejection$'):
                    getattr(gateway, public)(**POINT)
        transport.cmd.assert_not_called()

    def test_direct_rcon_transport_is_confined_to_gateway_including_all_seven_domains(self):
        trees = {path.stem: ast.parse(path.read_text(encoding='utf8')) for path in SURVIVAL.glob('*.py')}
        self.assertLessEqual(DOMAINS | {'fast_execution', 'world_adapter', 'numen_gateway'}, trees.keys())
        callers = set()
        for module, tree in trees.items():
            for node in ast.walk(tree):
                if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                        and node.func.attr == 'cmd' and isinstance(node.func.value, ast.Attribute)
                        and node.func.value.attr == 'rcon'):
                    callers.add(module)
                if module in DOMAINS | {'fast_execution', 'world_adapter'} and isinstance(node, ast.Attribute):
                    self.assertNotEqual(node.attr, 'rcon', module)
        self.assertEqual(callers, {'numen_gateway'})


class NativeTransportTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.state = Path(temporary.name)
        self.rcon = Mock()
        self.gateway = NumenGateway(self.state, self.rcon, clock=lambda: 1000)

    def test_narrow_native_methods_preserve_exact_command_bytes_and_one_send(self):
        cases = [
            ('_native_roster', (), 'numen_act list'),
            ('_native_restore_existing', (BODY, OWNER, 'CheckedBody'), f'numen_restore_existing {BODY} {OWNER} CheckedBody'),
            ('_native_recipe', ('CheckedBody', 'example:item'), 'numen_act invoke "CheckedBody" lookup_recipe {"item_id": "example:item"}'),
            ('_native_scene', ('CheckedBody', 8), 'numen_act invoke "CheckedBody" look_around {"radius": 8}'),
            ('_native_navigation_sense', (BODY, None), f'qdworld navigation_sense {BODY}'),
            ('_native_navigation_sense', (BODY, {'z': -0.0, 'x': 10.0, 'y': 64}), f'qdworld navigation_sense {BODY} 10.0 64 -0.0'),
            ('_native_eat', (BODY, ACTION, {'item_id': 'minecraft:bread'}),
             f'qdworld eat {BODY} {ACTION} ' + payload('{"item_id":"minecraft:bread"}')),
            ('_native_eating', (BODY, ACTION), f'qdworld eating {BODY} {ACTION}'),
            ('_native_drop', (BODY, ACTION, {'count': 4, 'item_id': 'minecraft:oak_log'}),
             f'qdworld drop {BODY} {ACTION} ' + payload('{"count":4,"item_id":"minecraft:oak_log"}')),
            ('_native_dropping', (BODY, ACTION), f'qdworld dropping {BODY} {ACTION}'),
            ('_native_gui', (BODY, 12), f'qdworld gui {BODY} 12'),
            ('_native_scan', (BODY, 12, ['#minecraft:beds', 'minecraft:chest']), f'qdworld scan {BODY} 12 #minecraft:beds,minecraft:chest'),
            ('_native_offers', (BODY, 7, 4), f'qdtrade offers {BODY} 7 4'),
            ('_native_trade', (BODY, 7, 5, 'f' * 64), f'qdtrade trade {BODY} 7 5 ' + 'f' * 64),
            ('_native_interact', (BODY, ACTION, {'z': 11, 'y': 64, 'x': 10, 'button': 'right', 'hold_ticks': 0}),
             f'qdworld interact {BODY} {ACTION} ' + payload('{"button":"right","hold_ticks":0,"x":10,"y":64,"z":11}')),
            ('_native_interact', (BODY, ACTION, {'item_id': '\u96ea', 'button': 'right'}),
             f'qdworld interact {BODY} {ACTION} ' + payload('{"button":"right","item_id":"\\u96ea"}')),
            ('_native_interaction', (BODY, ACTION), f'qdworld interaction {BODY} {ACTION}'),
        ]
        with patch.object(self.gateway, '_settings', side_effect=AssertionError('checked name reread')):
            for method, args, command in cases:
                with self.subTest(method=method, args=args):
                    self.rcon.reset_mock()
                    self.rcon.cmd.return_value = 'raw native reply'
                    self.assertEqual(getattr(self.gateway, method)(*args), 'raw native reply')
                    self.rcon.cmd.assert_called_once_with(command)
                    self.assertEqual(self.rcon.cmd.call_args.args[0].encode('utf8'), command.encode('utf8'))
        self.assertEqual(list(self.state.iterdir()), [])

    def test_recipe_query_uses_checked_name_without_an_extra_settings_read(self):
        self.rcon.cmd.return_value = json.dumps({'success': True, 'message': 'recipe(s) for stick'})
        with patch.object(self.gateway, '_settings', side_effect=[BINDING]) as settings, \
                patch.object(self.gateway, '_check_binding', return_value=('CheckedBody', BODY)):
            self.assertTrue(lookup_recipe(self.gateway, 'minecraft:stick')['ok'])
        settings.assert_called_once_with()
        self.rcon.cmd.assert_called_once_with('numen_act invoke "CheckedBody" lookup_recipe {"item_id": "minecraft:stick"}')

    def test_lost_mutation_ack_queries_only_original_id_with_original_poll_bounds(self):
        args = {'item_id': 'minecraft:bread'}
        before = {'bodyUuid': BODY}
        cases = [
            (lambda: FoodActions(self.gateway).dispatch(ACTION, before, args), 'eat', 'eating', 1),
            (lambda: DropActions(self.gateway, sleep=lambda _: None, max_polls=2).dispatch(ACTION, before, args), 'drop', 'dropping', 1),
            (lambda: WorldActions(self.gateway, sleep=lambda _: None, max_polls=3)._interaction(
                {'actionId': ACTION, 'bodyUuid': BODY}, args), 'interact', 'interaction', 2),
        ]
        for dispatch, verb, query, polls in cases:
            with self.subTest(verb=verb):
                self.rcon.reset_mock()
                self.rcon.cmd.side_effect = TimeoutError('lost ACK')
                with self.assertRaises((GatewayError, OSError)):
                    dispatch()
                self.assertEqual(self.rcon.cmd.call_args_list, [
                    call(f'qdworld {verb} {BODY} {ACTION} ' + payload('{"item_id":"minecraft:bread"}')),
                    *[call(f'qdworld {query} {BODY} {ACTION}') for _ in range(polls)]])

    def test_real_leased_eat_and_drop_reserve_before_send_and_never_replay_unknown(self):
        for tool, verb, query, args in (
                ('eat', 'eat', 'eating', {'item_id': 'minecraft:bread'}),
                ('drop_items', 'drop', 'dropping', {'item_id': 'minecraft:bread', 'count': 1})):
            with self.subTest(tool=tool), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                transport = Mock()
                gateway = NumenGateway(root, transport, clock=lambda: 1000)
                write_json(root / 'settings.json', {**BINDING, 'workArea': {
                    'minX': 0, 'maxX': 100, 'minZ': 0, 'maxZ': 100}, 'anchor': {'x': 0, 'z': 0}, 'protectedRadius': 0})
                write_json(root / 'control.json', {'schema': 1, 'enabled': True})
                gateway.open_lease(TURN, 1060000)
                body = {'ok': True, 'bodyUuid': BODY, 'gameMode': 'survival', 'dimension': 'minecraft:overworld',
                        'position': POINT, 'task': {'busy': False},
                        'inventory': [{'id': 'minecraft:bread', 'count': 1, 'slot': 0}]}
                def lose(command):
                    marker = read_json(root / 'unknown.json')
                    self.assertEqual(read_json(root / 'lease.json')['status'], 'reserved')
                    self.assertEqual(marker['tool'], tool)
                    self.assertIn(marker['actionId'], command)
                    raise TimeoutError('lost ACK')
                transport.cmd.side_effect = lose
                with patch.object(gateway, 'snapshot', return_value=body), patch('drop_actions.time.sleep'):
                    result = gateway.action(TURN, tool, args)
                self.assertEqual(result['code'], 'outcome_unknown')
                commands = [c.args[0] for c in transport.cmd.call_args_list]
                self.assertEqual(len(commands), 2)
                self.assertTrue(commands[0].startswith(f'qdworld {verb} {BODY} {result["actionId"]} '))
                self.assertEqual(commands[1], f'qdworld {query} {BODY} {result["actionId"]}')
                marker = (root / 'unknown.json').read_bytes()
                restarted = NumenGateway(root, transport, clock=lambda: 1001)
                self.assertEqual(restarted.action(TURN, tool, args)['code'], 'lease_invalid')
                self.assertEqual((root / 'unknown.json').read_bytes(), marker)
                self.assertEqual(transport.cmd.call_count, 2)

    def test_restore_reservation_precedes_one_send_and_restart_only_reads_roster(self):
        write_json(self.state / 'control.json', {'enabled': True})
        def command(text):
            if text == 'numen_act list':
                return 'count=0'
            self.assertEqual(read_json(self.state / 'body-reconnect.json')['status'], 'reserved')
            raise TimeoutError('lost restore ACK')
        self.rcon.cmd.side_effect = command
        self.assertEqual(BodyReconnect(self.gateway, clock=lambda: 1000).tick(BINDING)['status'], 'unknown')
        restarted = NumenGateway(self.state, self.rcon, clock=lambda: 1061)
        self.assertEqual(BodyReconnect(restarted, clock=lambda: 1061).tick(BINDING)['status'], 'unknown')
        self.assertEqual(self.rcon.cmd.call_args_list, [call('numen_act list'),
            call(f'numen_restore_existing {BODY} {OWNER} CheckedBody'), call('numen_act list')])


if __name__ == '__main__':
    unittest.main()

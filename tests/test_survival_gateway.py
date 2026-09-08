"""Isolated gateway tests. No live RCON, Minecraft login or model calls."""
import asyncio
import importlib.util
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/survival'))
import numen_gateway as gateway
import mcp_server

TURN = 'turn_0123456789abcdef'
NOW = 1800000000
BODY_UUID = 'd4ac9523-4962-43ed-98c5-19b49e104048'


class MockRcon:
    def __init__(self):
        self.calls = []
        self.busy = False
        self.position = {'x': 100, 'y': 64, 'z': 100}
        self.game_mode = 'survival'
        self.equipment = {}
        self.navigation_modes = ['walk_only_v1']
        self.roster = 'count=1\nKirito|uuid=' + BODY_UUID + '|owner=fixture|dim=minecraft:overworld|pos=100,64,100'
        self.reply = {'success': True, 'data': {'task_id': 't1', 'task': 'mine', 'async': True}}
        self.inventory = ('Kirito has the following entity data: '
                          '[{Slot:0b,id:"minecraft:oak_log",count:4},'
                          '{Slot:1b,id:"biomesoplenty:oak_log",count:2},'
                          '{Slot:2b,id:"minecraft:written_book",count:1,'
                          'components:{"minecraft:written_book_content":{title:"PRIVATE",'
                          'pages:["hidden {nested} \\"quoted\\" text"]}}}]')

    def cmd(self, command):
        self.calls.append(command)
        if command == 'numen_act list':
            return self.roster
        if command.startswith('data get entity Kirito Inventory'):
            return self.inventory
        if ' get_self_status ' in command:
            return json.dumps({'name': 'Kirito', 'hp': 20, 'max_hp': 20, 'hunger': 18,
                               'position': self.position, 'dimension': 'minecraft:overworld',
                               'game_mode': self.game_mode, 'equipment': self.equipment,
                               'navigation_modes': self.navigation_modes})
        if ' task_status ' in command:
            return json.dumps({'success': True, **({'data': {'task_id': 't2', 'state': 'running'}} if self.busy else {})})
        if ' look_around ' in command:
            return '...\n.@T\n...'
        if ' scan_nearby_entities ' in command:
            return '{"entities": []}'
        if isinstance(self.reply, Exception):
            raise self.reply
        return json.dumps(self.reply)

    def mutations(self):
        return [row for row in self.calls if any(' ' + name + ' ' in row for name in gateway.TOOLS)]


class GatewayTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.state = Path(temp.name)
        self.rcon = MockRcon()
        self.client = gateway.NumenGateway(self.state, self.rcon, clock=lambda: NOW)
        self.settings = {'schema': 1, 'bodyName': 'Kirito', 'bodyUuid': BODY_UUID,
                         'workArea': {'minX': 64, 'maxX': 160, 'minZ': 64, 'maxZ': 160},
                         'anchor': {'x': 0, 'z': 0}, 'protectedRadius': 32}
        self.write('settings.json', self.settings)
        self.write('control.json', {'schema': 1, 'enabled': True})

    def write(self, name, value):
        gateway.write_json(self.state / name, value)

    def lease(self):
        return self.client.open_lease(TURN, NOW * 1000 + 120000)

    def mine(self, turn_id=TURN, **changes):
        return self.client.action(turn_id, 'mine', {'block_ids': ['minecraft:oak_log'], 'count': 4, **changes})

    def test_namespaced_inventory_and_idle_are_not_completion(self):
        snapshot = self.client.snapshot()
        self.assertTrue(snapshot['ok'])
        self.assertEqual(snapshot['counts']['minecraft:oak_log'], 4)
        self.assertEqual(snapshot['counts']['biomesoplenty:oak_log'], 2)
        self.assertNotIn('PRIVATE', json.dumps(snapshot))
        self.assertFalse(snapshot['task']['busy'])
        self.assertFalse(snapshot['task']['completionConfirmed'])
        self.assertFalse(self.rcon.mutations())

    def test_duplicate_name_or_different_uuid_cannot_control_old_other_body(self):
        self.lease()
        self.rcon.roster += '\nKirito|uuid=4d67319b-938e-420a-9d92-78db0a32601a|owner=other'
        self.assertFalse(self.client.snapshot()['ok'])
        self.assertFalse(self.mine()['ok'])
        self.rcon.roster = 'count=1\nKirito|uuid=4d67319b-938e-420a-9d92-78db0a32601a|owner=other'
        self.assertFalse(self.client.snapshot()['ok'])
        self.assertFalse(self.mine()['ok'])
        self.assertFalse(self.rcon.mutations())

    def test_missing_disabled_expired_wrong_turn_cannot_mutate(self):
        self.assertFalse(self.mine()['ok'])
        self.lease()
        self.assertEqual(self.mine('wrong_0123456789abcd')['code'], 'lease_invalid')
        self.write('control.json', {'schema': 1, 'enabled': False})
        self.assertEqual(self.mine()['code'], 'autonomy_disabled')
        self.write('control.json', {'schema': 1, 'enabled': True})
        lease = gateway.read_json(self.state / 'lease.json')
        lease['expiresAt'] = NOW * 1000
        self.write('lease.json', lease)
        self.assertEqual(self.mine()['code'], 'lease_invalid')
        self.assertFalse(self.rcon.mutations())

    def test_one_action_per_lease_and_no_duplicate_turn_reset(self):
        self.lease()
        self.assertEqual(self.mine()['code'], 'accepted')
        self.assertFalse(self.mine()['ok'])
        self.client.close_lease()
        with self.assertRaises(gateway.GatewayError):
            self.lease()
        self.assertEqual(len(self.rcon.mutations()), 1)

    def test_busy_and_wrong_game_mode_are_fail_closed(self):
        self.lease()
        self.rcon.busy = True
        self.assertEqual(self.mine()['code'], 'body_busy')
        self.rcon.busy = False
        self.rcon.game_mode = 'creative'
        self.assertEqual(self.mine()['code'], 'survival_body_unavailable')
        self.assertFalse(self.rcon.mutations())

    def test_mine_margin_move_bounds_and_protected_anchor(self):
        self.lease()
        self.rcon.position['x'] = 70
        self.assertEqual(self.mine()['code'], 'outside_work_area')
        self.rcon.position['x'] = 100
        self.assertEqual(self.client.action(TURN, 'goto', {'x': 1000, 'z': 100})['code'], 'outside_work_area')
        self.settings.update(anchor={'x': 100, 'z': 100}, protectedRadius=8)
        self.write('settings.json', self.settings)
        self.assertEqual(self.mine()['code'], 'protected_area')
        self.assertFalse(self.rcon.mutations())

    def test_walk_only_capability_is_required_before_crossing_town(self):
        self.lease()
        self.settings.update(anchor={'x': 100, 'z': 100}, protectedRadius=32)
        self.write('settings.json', self.settings)
        self.rcon.navigation_modes = []
        self.assertEqual(self.client.action(TURN, 'goto', {'x': 110, 'z': 100})['code'], 'safe_navigation_unavailable')
        self.assertFalse(self.rcon.mutations())
        self.rcon.navigation_modes = ['walk_only_v1']
        result = self.client.action(TURN, 'goto', {'x': 110, 'z': 100})
        self.assertTrue(result['ok'])
        self.assertIn('"walk_only": true', self.rcon.mutations()[0])

    def test_walk_target_is_bounded_to_local_neighborhood(self):
        self.lease()
        self.assertEqual(self.client.action(TURN, 'goto', {'x': 125, 'z': 100})['code'], 'walk_target_too_far')
        self.assertFalse(self.rcon.mutations())

    def test_bounded_arguments_no_injection_or_raw_tool(self):
        self.lease()
        for args in ({'count': 9}, {'count': True}, {'block_ids': ['minecraft:oak_log\nkill @a']},
                     {'block_ids': ['#minecraft:logs']}, {'count': 0}, {'other': 1}):
            with self.subTest(args=args):
                self.assertFalse(self.mine(**args)['ok'])
        self.assertEqual(self.client.action(TURN, 'attack', {})['code'], 'tool_not_allowed')
        self.assertFalse(self.client.action(TURN, 'goto', {'x': float('nan'), 'z': 100})['ok'])
        self.assertFalse(self.client.action(TURN, 'craft', {'item_id': 'minecraft:stick', 'count': 17})['ok'])
        self.assertFalse(self.rcon.mutations())

    def test_unknown_blocks_new_leases_without_replaying(self):
        self.lease()
        self.rcon.reply = TimeoutError('private credential text MUST NOT LEAK')
        result = self.mine()
        self.assertEqual(result['code'], 'outcome_unknown')
        self.assertNotIn('credential', json.dumps(result))
        self.client.close_lease()
        with self.assertRaisesRegex(gateway.GatewayError, 'outcome_unknown'):
            self.client.open_lease('new_0123456789abcdef', NOW * 1000 + 120000)
        self.assertFalse(self.mine()['ok'])
        self.assertEqual(len(self.rcon.mutations()), 1)
        self.assertNotIn('credential', (self.state / 'actions.jsonl').read_text())

    def test_crash_marker_precedes_send_and_survives_reserved_lease(self):
        self.lease()
        original = self.rcon.cmd
        def intercept(command):
            if ' mine ' in command:
                self.assertTrue((self.state / 'unknown.json').is_file())
                self.assertEqual(gateway.read_json(self.state / 'lease.json')['actionsUsed'], 1)
                raise KeyboardInterrupt()
            return original(command)
        self.rcon.cmd = intercept
        with self.assertRaises(KeyboardInterrupt):
            self.mine()
        self.assertTrue((self.state / 'unknown.json').is_file())
        with self.assertRaisesRegex(gateway.GatewayError, 'outcome_unknown'):
            self.client.open_lease('new_0123456789abcdef', NOW * 1000 + 120000)

    def test_equipment_is_verified_without_resend(self):
        self.lease()
        self.rcon.reply = {'accepted': True, 'note': 'no immediate reply (async tool)'}
        self.rcon.equipment = {'mainhand': {'item': 'minecraft:wooden_pickaxe'}}
        with patch.object(gateway.time, 'sleep'):
            result = self.client.action(TURN, 'equip_item', {'action': 'equip', 'item_id': 'minecraft:wooden_pickaxe', 'slot': 'mainhand'})
        self.assertEqual(result['code'], 'executed')
        self.assertTrue(result['completionConfirmed'])
        self.assertEqual(len(self.rcon.mutations()), 1)
        self.assertFalse((self.state / 'unknown.json').exists())

    def test_unconfirmed_equipment_does_not_claim_success(self):
        self.lease()
        self.rcon.reply = {'accepted': True}
        with patch.object(gateway.time, 'sleep'):
            result = self.client.action(TURN, 'equip_item', {'action': 'equip', 'item_id': 'minecraft:wooden_pickaxe', 'slot': 'mainhand'})
        self.assertEqual(result['code'], 'outcome_unknown')
        self.assertEqual(len(self.rcon.mutations()), 1)

    def test_malformed_inventory_cannot_hide_preflight_failure(self):
        self.lease()
        self.rcon.inventory = 'Kirito has the following entity data: [broken'
        self.assertFalse(self.client.snapshot()['ok'])
        self.assertEqual(self.mine()['code'], 'survival_body_unavailable')
        self.assertFalse(self.rcon.mutations())

    def test_interprocess_lock_rejects_parallel_action(self):
        self.lease()
        with gateway.action_lock(self.state):
            self.assertEqual(self.mine()['code'], 'action_busy')
        self.assertFalse(self.rcon.mutations())

    def test_tool_surface_is_exact_and_constructing_server_does_not_connect(self):
        async def check():
            server = mcp_server.make_server(self.client)
            listed = await server.list_tools()
            self.assertEqual({tool.name for tool in listed}, set(mcp_server.TOOL_NAMES))
            for tool in listed:
                if tool.name not in ('status', 'look', 'world_perception', 'skill_catalog', 'skill_read',
                                     'game_skills', 'game_skill_receipt', 'knowledge_catalog', 'knowledge_read',
                                     'request_goal'):
                    self.assertIn('turn_id', tool.inputSchema['required'])
        asyncio.run(check())
        self.assertFalse(self.rcon.calls)

    def test_game_learning_uses_same_single_action_lease_and_never_raw_rcon(self):
        self.lease()
        result = {'success': True, 'data': {'receipt': {'ok': True, 'code': 'learned'}, 'async': False}}
        with patch('game_skills.GameSkills.dispatch', return_value=result) as dispatch:
            first = self.client.action(TURN, 'game_learn', {'skill_id': 'home'})
            second = self.client.action(TURN, 'game_cast', {'skill_id': 'irons_spellbooks:shield', 'params': {}})
        self.assertEqual(first['code'], 'executed')
        self.assertFalse(second['ok'])
        dispatch.assert_called_once_with('game_learn', {'skill_id': 'home'})
        self.assertFalse(self.rcon.mutations())
        self.assertFalse((self.state / 'unknown.json').exists())

    def test_game_cast_unknown_preserves_lease_and_marker_and_cannot_replay(self):
        self.lease()
        def uncertain(*_):
            self.assertTrue((self.state / 'unknown.json').exists())
            self.assertEqual(gateway.read_json(self.state / 'lease.json')['actionsUsed'], 1)
            raise GatewayError('outcome_unknown')
        from numen_gateway import GatewayError
        with patch('game_skills.GameSkills.dispatch', side_effect=uncertain) as dispatch:
            result = self.client.action(TURN, 'game_cast', {'skill_id': 'irons_spellbooks:shield', 'params': {}})
            repeat = self.client.action(TURN, 'game_cast', {'skill_id': 'irons_spellbooks:shield', 'params': {}})
        self.assertEqual(result['code'], 'outcome_unknown'); self.assertFalse(repeat['ok'])
        self.assertEqual(dispatch.call_count, 1)
        with self.assertRaisesRegex(gateway.GatewayError, 'outcome_unknown'):
            self.client.open_lease('new_0123456789abcdef', NOW * 1000 + 120000)

    def test_game_cast_start_is_not_native_effect_completion(self):
        self.lease()
        with patch('game_skills.GameSkills.dispatch', return_value={'success': True, 'data': {
                'async': True, 'receipt': {'ok': True, 'code': 'casting_started'}}}):
            result = self.client.action(TURN, 'game_cast', {'skill_id': 'irons_spellbooks:shield', 'params': {}})
        self.assertEqual(result['code'], 'accepted')
        self.assertFalse(result['completionConfirmed'])

    def test_game_cast_protects_town_and_checks_actual_legacy_destination(self):
        self.lease()
        with patch('game_skills.GameSkills.dispatch') as dispatch:
            self.rcon.position['x'] = 140
            self.assertEqual(self.client.action(TURN, 'game_cast', {
                'skill_id': 'tp', 'params': {'distance': 30, 'direction': '东'}})['code'], 'outside_work_area')
            self.settings.update(anchor={'x': 100, 'z': 100}, protectedRadius=8)
            self.write('settings.json', self.settings)
            self.rcon.position['x'] = 120
            self.assertEqual(self.client.action(TURN, 'game_cast', {
                'skill_id': 'tp', 'params': {'distance': 15, 'direction': '西'}})['code'], 'protected_area')
            self.assertEqual(self.client.action(TURN, 'game_cast', {
                'skill_id': 'spring', 'params': {'distance': 10, 'direction': '西'}})['code'], 'protected_area')
            self.rcon.position['x'] = 100
            self.assertEqual(self.client.action(TURN, 'game_cast', {
                'skill_id': 'irons_spellbooks:firebolt', 'params': {}})['code'], 'protected_area')
            dispatch.assert_not_called()

    def test_unresolved_travel_and_command_target_injection_never_reach_game_dispatch(self):
        self.lease()
        with patch('game_skills.GameSkills.dispatch') as dispatch:
            for skill in ('home', 'sky_walk', 'irons_spellbooks:teleport', 'irons_spellbooks:recall',
                          'irons_spellbooks:pocket_dimension', 'newmod:unknown'):
                self.assertEqual(self.client.action(TURN, 'game_cast', {
                    'skill_id': skill, 'params': {}})['code'], 'game_skill_destination_unavailable')
            for params in ({'distance': '30'}, {'distance': 31}, {'direction': 'north'},
                           {'x': 9999}, {'target': '@a'}, {'distance': -30}):
                self.assertFalse(self.client.action(TURN, 'game_cast', {'skill_id': 'tp', 'params': params})['ok'])
            dispatch.assert_not_called()
        self.assertFalse((self.state / 'unknown.json').exists())


class FakeSocket:
    def __init__(self, packets):
        self.data = b''.join(packets)
        self.sent = []
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def settimeout(self, timeout): pass
    def sendall(self, value): self.sent.append(value)
    def recv(self, count):
        part, self.data = self.data[:min(count, 3)], self.data[min(count, 3):]
        return part


class RconTests(unittest.TestCase):
    def test_auth_extra_packets_wrong_ids_and_fragmented_reads(self):
        with tempfile.TemporaryDirectory() as folder:
            secret = Path(folder) / 'secret'
            secret.write_text('fixture-only')
            packet = gateway.RconClient._packet
            sock = FakeSocket([packet(1, 0, ''), packet(1, 2, ''), packet(998, 0, 'stale'), packet(2, 0, '{"success":true}')])
            with patch.object(gateway.socket, 'create_connection', return_value=sock) as connect:
                result = gateway.RconClient(secret=secret).cmd('numen_act list')
            self.assertEqual(result, '{"success":true}')
            self.assertEqual(len(sock.sent), 2)
            connect.assert_called_once()

    def test_auth_failure_never_sends_command(self):
        with tempfile.TemporaryDirectory() as folder:
            secret = Path(folder) / 'secret'
            secret.write_text('fixture-only')
            sock = FakeSocket([gateway.RconClient._packet(-1, 2, '')])
            with patch.object(gateway.socket, 'create_connection', return_value=sock):
                with self.assertRaises(ConnectionError):
                    gateway.RconClient(secret=secret).cmd('numen_act list')
            self.assertEqual(len(sock.sent), 1)


if __name__ == '__main__':
    unittest.main()

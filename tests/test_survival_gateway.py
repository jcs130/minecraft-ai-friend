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
        self.navigation_modes = ['walk_only_v1', 'walk_only_strict_arrival_v2']
        self.navigation_epoch = 'fixture-server-epoch'
        self.navigation_result = None
        self.task_id = 't1'
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
                               'navigation_modes': self.navigation_modes,
                               'navigation_epoch': self.navigation_epoch,
                               'last_navigation_result': self.navigation_result})
        if ' task_status ' in command:
            return json.dumps({'success': True, **({'data': {'task_id': self.task_id, 'state': 'running'}} if self.busy else {})})
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

    def test_observation_failure_is_unknown_not_confirmed_offline(self):
        original = self.rcon.cmd
        def timeout(command):
            if ' get_self_status ' in command:
                raise TimeoutError('fixture PRIVATE raw error')
            return original(command)
        self.rcon.cmd = timeout
        result = self.client.snapshot()
        self.assertIsNone(result['online'])
        self.assertEqual(result['code'], 'observation_unavailable')
        self.assertEqual(result['errorType'], 'TimeoutError')
        self.assertEqual(result['observationStage'], 'self_status')
        self.assertNotIn('PRIVATE', json.dumps(result))
        self.rcon.cmd = original
        self.assertTrue(self.client.snapshot()['ok'])

    def test_only_complete_roster_can_confirm_missing_body(self):
        for raw in ('', 'count=1', 'count=0\nKirito|uuid=' + BODY_UUID,
                    'Goddess has the following entity data: []'):
            self.rcon.roster = raw
            self.assertIsNone(self.client.snapshot()['online'])
        self.rcon.roster = 'count=0\n'
        result = self.client.snapshot()
        self.assertIs(result['online'], False)
        self.assertEqual(result['code'], 'body_offline')

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

    def test_wrong_id_action_guidance_cannot_expose_or_repair_a_lease(self):
        self.lease()
        files = lambda: {p.name: p.read_bytes() for p in self.state.iterdir() if p.is_file()}
        before = files()
        for wrong in ('mem-' + 'a' * 32, 'task-' + 'b' * 24, 't18', TURN[:-1], None):
            with self.subTest(wrong=wrong):
                result = self.mine(wrong)
                self.assertEqual(result['code'], 'lease_invalid')
                self.assertFalse(result['dispatched'])
                self.assertFalse(result['writePerformed'])
                self.assertFalse(result['retryAutomatically'])
                self.assertNotIn(TURN, json.dumps(result))
                self.assertFalse({'turnId', 'turn_id', 'lease', 'currentLease'} & result.keys())
                self.assertIn('原样复制最新生活输入', result['instruction'])
                self.assertIn('不要继续猜测或自动重试', result['instruction'])
                self.assertEqual(files(), before)
                self.assertFalse(self.rcon.calls)

    def test_invalid_closed_expired_and_unknown_action_leases_remain_denied(self):
        self.lease()
        original = gateway.read_json(self.state / 'lease.json')
        for change in ({'status': 'closed'}, {'status': 'reserved'}, {'status': 'unknown'},
                       {'expiresAt': NOW * 1000}):
            with self.subTest(change=change):
                self.write('lease.json', original | change)
                before = (self.state / 'lease.json').read_bytes()
                result = self.mine()
                self.assertEqual(result['code'], 'lease_invalid')
                self.assertFalse(result['dispatched'])
                self.assertNotIn(TURN, json.dumps(result))
                self.assertEqual((self.state / 'lease.json').read_bytes(), before)
                self.assertFalse(self.rcon.calls)
        self.write('lease.json', original)
        self.write('unknown.json', {'actionId': 'unresolved'})
        marker = (self.state / 'unknown.json').read_bytes()
        self.assertEqual(self.mine(), {'ok': False, 'code': 'outcome_unknown'})
        self.assertEqual((self.state / 'unknown.json').read_bytes(), marker)
        self.assertFalse(self.rcon.calls)

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

    def test_goto_no_longer_requires_our_patched_navigation_mode(self):
        """2026-09-18: navigation belongs to upstream, which never advertises the strict
        arrival mode we used to patch in. Requiring it refused every goto on an upstream
        body, so the gate is gone; what the receipt records is the outcome itself."""
        self.lease()
        self.settings.update(anchor={'x': 100, 'z': 100}, protectedRadius=32)
        self.write('settings.json', self.settings)
        # Advertising nothing at all is the strongest form of the claim: if a goto is
        # accepted with an empty mode list, it is accepted on any upstream body. One
        # action per turn, because an accepted action consumes the lease's budget.
        self.rcon.navigation_modes = []
        result = self.client.action(TURN, 'goto', {'x': 110, 'z': 100})
        self.assertTrue(result['ok'])
        self.assertNotIn('"walk_only"', self.rcon.mutations()[0])

    def test_observed_move_height_is_forwarded(self):
        """The observed height still reaches the body; our own walk_only flag no longer
        rides along, because upstream owns the navigation mode now."""
        self.lease()
        result = self.client.action(TURN, 'goto', {'x': 110, 'y': 77.5, 'z': 100})
        self.assertTrue(result['ok'])
        payload = json.loads(self.rcon.mutations()[0].split(' goto ', 1)[1])
        self.assertEqual(payload, {'x': 110, 'y': 77.5, 'z': 100})

    def test_optional_height_rejects_nonfinite_bounds_and_unrecognized_attributes(self):
        self.lease()
        invalid = [{'x': 110, 'z': 100, 'y': y} for y in (-65, 320, float('nan'), float('inf'), float('-inf'), True, None, '77')]
        invalid += [{'x': 110, 'z': 100, 'y': 77, 'walk_only': False}, {'x': 110, 'z': 100, 'y': 77, 'radius': 2}, {'x': 110, 'y': 77}]
        for args in invalid:
            with self.subTest(args=args):
                self.assertEqual(self.client.action(TURN, 'goto', args)['code'], 'invalid_move')
        self.assertFalse(self.rcon.mutations())
        self.assertFalse((self.state / 'unknown.json').exists())
        self.assertEqual(gateway.read_json(self.state / 'lease.json')['actionsUsed'], 0)
        for y in (-64, 319):
            self.client._validate('goto', {'x': 110, 'y': y, 'z': 100})
        self.assertEqual(self.client.action(TURN, 'goto', {'x': 125, 'y': 77, 'z': 100})['code'], 'walk_target_too_far')
        self.assertEqual(self.client.action(TURN, 'goto', {'x': 161, 'y': 77, 'z': 100})['code'], 'outside_work_area')

    def test_walk_target_is_bounded_to_local_neighborhood(self):
        self.lease()
        self.assertEqual(self.client.action(TURN, 'goto', {'x': 125, 'z': 100})['code'], 'walk_target_too_far')
        self.assertFalse(self.rcon.mutations())

    def test_walk_rejection_preserves_exact_preflight_origin_without_action_or_lease_use(self):
        self.lease()
        self.rcon.position = {'x': 95.5, 'y': 65, 'z': 94}
        result = self.client.action(TURN, 'goto', {'x': 120, 'y': 77, 'z': 108})
        self.assertEqual(result['code'], 'walk_target_too_far')
        self.assertFalse(result['dispatched'])
        evidence = result['navigationPreflight']
        self.assertEqual(evidence['origin'], {'x': 95.5, 'y': 65, 'z': 94})
        self.assertEqual(evidence['requested'], {'x': 120, 'y': 77, 'z': 108})
        self.assertAlmostEqual(evidence['horizontalDistance'], (24.5 ** 2 + 14 ** 2) ** .5)
        self.assertEqual(evidence['maxHorizontalDistance'], 24)
        self.assertEqual(evidence['bodyUuid'], BODY_UUID)
        self.assertEqual(evidence['observedAt'], NOW * 1000)
        self.rcon.position['x'] = 120
        self.assertEqual(evidence['origin']['x'], 95.5)
        recorded = json.loads((self.state / 'actions.jsonl').read_text().strip())
        self.assertEqual(recorded['result'], result)
        self.assertEqual(recorded['phase'], 'preflight_rejected')
        self.assertNotIn('actionId', recorded)
        self.assertEqual(gateway.read_json(self.state / 'lease.json')['actionsUsed'], 0)
        self.assertFalse((self.state / 'unknown.json').exists())
        self.assertFalse((self.state / 'last-action.json').exists())
        self.assertFalse(self.rcon.mutations())

    def test_walk_rejection_does_not_depend_on_audit_log_availability(self):
        self.lease()
        with patch.object(self.client, '_record', side_effect=OSError('unavailable')):
            result = self.client.action(TURN, 'goto', {'x': 125, 'z': 100})
        self.assertEqual(result['code'], 'walk_target_too_far')
        self.assertFalse(result['auditLogAvailable'])
        self.assertEqual(result['navigationPreflight']['origin'], self.rcon.position)
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
        diagnostic = gateway.read_json(self.state / 'native-action-diagnostics' / (result['actionId'] + '.json'))
        self.assertFalse(diagnostic['nativeReplyAvailable'])
        self.assertNotIn('credential', json.dumps(diagnostic))

    def test_invalid_native_reply_is_preserved_privately_without_replay_or_success(self):
        self.lease()
        original = self.rcon.cmd
        raw = 'invoke error: fixture after task started'
        def native(command):
            if ' mine ' in command:
                self.rcon.calls.append(command)
                return raw
            return original(command)
        self.rcon.cmd = native
        result = self.mine()
        self.assertEqual(result['code'], 'outcome_unknown')
        self.assertTrue(result['nativeDiagnosticRecorded'])
        diagnostic = gateway.read_json(self.state / 'native-action-diagnostics' / (result['actionId'] + '.json'))
        self.assertEqual(diagnostic['nativeReply'], raw)
        self.assertEqual(diagnostic['errorCode'], 'numen_reply_invalid')
        self.assertFalse(diagnostic['nativeReplyTruncated'])
        self.assertNotIn(raw, json.dumps(result))
        self.assertTrue((self.state / 'unknown.json').exists())
        self.assertEqual(gateway.read_json(self.state / 'action-receipts' / (result['actionId'] + '.json'))['status'], 'unknown')
        self.assertFalse(self.mine()['ok'])
        self.assertEqual(len(self.rcon.mutations()), 1)

    def test_nonterminal_native_ack_is_evidence_only_not_success(self):
        self.lease()
        self.rcon.reply = {'accepted': True, 'note': 'no immediate reply'}
        result = self.mine()
        self.assertEqual(result['code'], 'outcome_unknown')
        diagnostic = gateway.read_json(self.state / 'native-action-diagnostics' / (result['actionId'] + '.json'))
        self.assertEqual(json.loads(diagnostic['nativeReply']), self.rcon.reply)
        self.assertFalse(result['ok'])
        self.assertTrue((self.state / 'unknown.json').exists())
        self.assertEqual(len(self.rcon.mutations()), 1)

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
            scene = next(tool for tool in listed if tool.name == 'view_scene')
            self.assertEqual(set(scene.inputSchema['properties']), {'radius'})
            self.assertEqual(scene.inputSchema.get('required', []), [])
            for tool in listed:
                if tool.name not in ('status', 'look', 'view_scene', 'world_perception', 'skill_catalog', 'skill_read',
                                     'game_skills', 'game_skill_receipt', 'knowledge_catalog', 'knowledge_read',
                                     'request_goal', 'request_review', 'inspect_block', 'scan_blocks', 'villager_offers', 'lookup_recipe',
                                     'guild_board', 'guild_receipt', 'adventure_guide', 'inspect_container', 'speech_status'):
                    self.assertIn('turn_id', tool.inputSchema['required'])
        asyncio.run(check())
        self.assertFalse(self.rcon.calls)

    def test_mcp_move_optional_height_omits_none_and_forwards_observed_height(self):
        async def check():
            server = mcp_server.make_server(self.client)
            listed = await server.list_tools()
            tool = next(t for t in listed if t.name == 'move')
            self.assertEqual(set(tool.inputSchema['required']), {'turn_id', 'x', 'z'})
            self.assertIn('y', tool.inputSchema['properties'])
            with patch.object(self.client, 'action', return_value={'ok': True}) as action:
                await server.call_tool('move', {'turn_id': TURN, 'x': 110, 'z': 100})
                action.assert_called_with(TURN, 'goto', {'x': 110, 'z': 100})
                await server.call_tool('move', {'turn_id': TURN, 'x': 110, 'z': 100, 'y': None})
                action.assert_called_with(TURN, 'goto', {'x': 110, 'z': 100})
                await server.call_tool('move', {'turn_id': TURN, 'x': 110, 'z': 100, 'y': 77.5})
                action.assert_called_with(TURN, 'goto', {'x': 110, 'z': 100, 'y': 77.5})
        asyncio.run(check())
        self.assertFalse(self.rcon.calls)

    def test_world_preflight_cannot_consume_lease_or_mutate(self):
        self.lease()
        args = {'item_id': 'minecraft:crafting_table', 'x': 101, 'y': 64, 'z': 100}
        with patch('world_actions.WorldActions.prepare', side_effect=gateway.GatewayError('outside_construction_area')), \
             patch('world_actions.WorldActions.dispatch') as dispatch:
            result = self.client.action(TURN, 'place_block', args)
        self.assertEqual(result['code'], 'outside_construction_area')
        self.assertEqual(gateway.read_json(self.state / 'lease.json')['actionsUsed'], 0)
        self.assertFalse((self.state / 'unknown.json').exists())
        dispatch.assert_not_called()

    def test_farm_preflight_returns_original_observations_without_action_or_raw_metadata(self):
        self.lease()
        args = {'operation': 'plant', 'item_id': 'minecraft:wheat_seeds',
                'x': 101, 'y': 65, 'z': 100}
        error = gateway.GatewayError('plant_requires_farmland')
        error.details = {'schema': 1, 'kind': 'farm_preflight', 'operation': 'plant',
            'requested': {'x': 101, 'y': 65, 'z': 100},
            'target': {'x': 101, 'y': 65, 'z': 100, 'block': 'minecraft:air'},
            'support': {'x': 101, 'y': 64, 'z': 100, 'block': 'minecraft:air'},
            'expectedSupport': 'minecraft:farmland', 'dispatched': False,
            'writePerformed': False, 'retryAutomatically': False,
            'instruction': 'Inspect the requested crop cell and its support.',
            'nativeReply': 'PRIVATE RAW EXCEPTION'}
        lease_before = (self.state / 'lease.json').read_bytes()
        with patch('world_actions.WorldActions.prepare', side_effect=error), \
             patch('world_actions.WorldActions.dispatch') as dispatch:
            result = self.client.action(TURN, 'farm', args)
        self.assertEqual(result['code'], 'plant_requires_farmland')
        self.assertEqual(result['farmPreflight']['requested'], error.details['requested'])
        self.assertEqual(result['farmPreflight']['support'], error.details['support'])
        self.assertNotIn('PRIVATE', json.dumps(result))
        self.assertEqual((self.state / 'lease.json').read_bytes(), lease_before)
        self.assertFalse((self.state / 'unknown.json').exists())
        dispatch.assert_not_called()
        error.args = ('outside_construction_area',)
        with patch('world_actions.WorldActions.prepare', side_effect=error):
            self.assertNotIn('farmPreflight', self.client.action(TURN, 'farm', args))

    def test_not_air_plant_rejection_reaches_the_model_with_the_offending_cell(self):
        """2026-09-17: the not-air rejection used to reach the model as a bare code.

        A live agent then read it as a positioning problem and re-navigated to the
        same coordinate for twenty minutes. The observation is now surfaced so the
        caller can correct its own coordinate instead of guessing.
        """
        self.lease()
        args = {'operation': 'plant', 'item_id': 'minecraft:wheat_seeds',
                'x': 101, 'y': 64, 'z': 100}
        error = gateway.GatewayError('invalid_planting_target_or_seed')
        error.details = {'schema': 1, 'kind': 'farm_preflight', 'operation': 'plant',
            'requested': {'x': 101, 'y': 64, 'z': 100},
            'target': {'x': 101, 'y': 64, 'z': 100, 'block': 'minecraft:farmland'},
            'expectedTarget': 'minecraft:air', 'dispatched': False,
            'writePerformed': False, 'retryAutomatically': False,
            'instruction': 'plant 的 x/y/z 是空气格；若耕地位于 (x,y,z) 请改传 (x,y+1,z)。',
            'nativeReply': 'PRIVATE RAW EXCEPTION'}
        lease_before = (self.state / 'lease.json').read_bytes()
        with patch('world_actions.WorldActions.prepare', side_effect=error), \
             patch('world_actions.WorldActions.dispatch') as dispatch:
            result = self.client.action(TURN, 'farm', args)
        self.assertEqual(result['code'], 'invalid_planting_target_or_seed')
        self.assertEqual(result['farmPreflight']['requested'], error.details['requested'])
        self.assertEqual(result['farmPreflight']['target'], error.details['target'])
        self.assertEqual(result['farmPreflight']['expectedTarget'], 'minecraft:air')
        self.assertIn('x,y+1,z', result['farmPreflight']['instruction'])
        self.assertNotIn('PRIVATE', json.dumps(result))
        self.assertEqual((self.state / 'lease.json').read_bytes(), lease_before)
        self.assertFalse((self.state / 'unknown.json').exists())
        dispatch.assert_not_called()

    def test_world_dispatch_is_journaled_once_and_unknown_never_replays(self):
        self.lease()
        args = {'item_id': 'minecraft:crafting_table', 'x': 101, 'y': 64, 'z': 100}
        def uncertain(plan):
            self.assertTrue((self.state / 'unknown.json').exists())
            self.assertEqual(gateway.read_json(self.state / 'lease.json')['actionsUsed'], 1)
            self.assertEqual(plan['actionId'], gateway.read_json(self.state / 'unknown.json')['actionId'])
            raise gateway.GatewayError('outcome_unknown')
        with patch('world_actions.WorldActions.prepare', return_value={'fixture': True}), \
             patch('world_actions.WorldActions.dispatch', side_effect=uncertain) as dispatch:
            result = self.client.action(TURN, 'place_block', args)
            repeat = self.client.action(TURN, 'place_block', args)
        self.assertEqual(result['code'], 'outcome_unknown')
        self.assertFalse(repeat['ok'])
        self.assertEqual(dispatch.call_count, 1)
        self.assertTrue((self.state / 'unknown.json').exists())

    def test_known_native_world_rejection_preserves_receipt_and_releases_marker(self):
        self.lease()
        args = {'item_id': 'minecraft:oak_planks', 'x': 101, 'y': 64, 'z': 100}
        def rejected(plan):
            request = gateway.read_json(self.state / 'unknown.json')['actionId']
            self.assertEqual(request, plan['actionId'])
            return {'success': False, 'message': 'aim blocked by short_grass',
                    'data': {'nativeInteractionReceipt': {'requestId': request, 'status': 'terminal',
                            'result': {'success': False, 'message': 'aim blocked by short_grass'}}}}
        with patch('world_actions.WorldActions.prepare', return_value={}), \
             patch('world_actions.WorldActions.dispatch', side_effect=rejected):
            result = self.client.action(TURN, 'place_block', args)
        self.assertEqual('action_rejected', result['code'])
        self.assertFalse((self.state / 'unknown.json').exists())
        receipt = gateway.read_json(self.state / 'action-receipts' / (result['actionId'] + '.json'))
        self.assertEqual('rejected', receipt['status'])
        self.assertFalse(receipt['completionConfirmed'])
        self.assertEqual(result['actionId'], receipt['result']['result']['data']['nativeInteractionReceipt']['requestId'])

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
    def __init__(self, packets, read_chunk=3):
        self.data = b''.join(packets)
        self.sent = []
        self.read_chunk = read_chunk
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def settimeout(self, timeout): pass
    def sendall(self, value): self.sent.append(value)
    def recv(self, count):
        part, self.data = self.data[:min(count, self.read_chunk)], self.data[min(count, self.read_chunk):]
        return part


class RconTests(unittest.TestCase):
    def test_auth_extra_packets_wrong_ids_and_fragmented_reads(self):
        with tempfile.TemporaryDirectory() as folder:
            secret = Path(folder) / 'secret'
            secret.write_text('fixture-only')
            packet = gateway.RconClient._packet
            sock = FakeSocket([packet(1, 0, ''), packet(1, 2, ''), packet(998, 0, 'stale'),
                               packet(2, 0, '{"success":true}'), packet(3, 0, 'Unknown request 0')])
            with patch.object(gateway.socket, 'create_connection', return_value=sock) as connect:
                result = gateway.RconClient(secret=secret).cmd('numen_act list')
            self.assertEqual(result, '{"success":true}')
            self.assertEqual(len(sock.sent), 3)
            self.assertEqual(sock.sent[-1], packet(3, 0, ''))
            connect.assert_called_once()

    def test_split_reply_requires_exact_end_and_sends_command_only_once(self):
        packet = gateway.RconClient._packet
        with tempfile.TemporaryDirectory() as folder:
            secret = Path(folder) / 'secret'; secret.write_text('fixture-only')
            for response in ('', 'x' * 4096, 'x' * 8192, '中' * 5000):
                with self.subTest(length=len(response)):
                    chunks = [response[i:i + 4096] for i in range(0, len(response), 4096)] or ['']
                    sock = FakeSocket([packet(1, 2, ''),
                        *[packet(2, 0, chunk) for chunk in chunks],
                        packet(997, 0, 'other request'), packet(3, 0, 'Unknown request 0')])
                    with patch.object(gateway.socket, 'create_connection', return_value=sock):
                        self.assertEqual(gateway.RconClient(secret=secret).cmd('fixture_command'), response)
                    self.assertEqual(sock.sent, [packet(1, 3, 'fixture-only'),
                                                packet(2, 2, 'fixture_command'), packet(3, 0, '')])

    def test_incomplete_malformed_and_oversized_response_never_returns_partial(self):
        packet = gateway.RconClient._packet
        variants = [[], [packet(3, 2, 'Unknown request 0')], [packet(3, 0, 'wrong terminator')],
                    [packet(998, 0, 'Unknown request 0')],
                    [packet(2, 0, 'x' * 600000), packet(2, 0, 'y' * 600000)],
                    [packet(998, 0, '')] * 256]
        with tempfile.TemporaryDirectory() as folder:
            secret = Path(folder) / 'secret'; secret.write_text('fixture-only')
            for index, suffix in enumerate(variants):
                with self.subTest(index=index):
                    sock = FakeSocket([packet(1, 2, ''), packet(2, 0, 'partial'), *suffix], read_chunk=8192)
                    with patch.object(gateway.socket, 'create_connection', return_value=sock):
                        with self.assertRaises(ConnectionError):
                            gateway.RconClient(secret=secret).cmd('fixture_command')
                    self.assertEqual(len([p for p in sock.sent if p == packet(2, 2, 'fixture_command')]), 1)

    def test_end_marker_before_first_command_frame_is_not_completion(self):
        packet = gateway.RconClient._packet
        with tempfile.TemporaryDirectory() as folder:
            secret = Path(folder) / 'secret'; secret.write_text('fixture-only')
            sock = FakeSocket([packet(1, 2, ''), packet(3, 0, 'Unknown request 0')])
            with patch.object(gateway.socket, 'create_connection', return_value=sock):
                with self.assertRaisesRegex(ConnectionError, 'rcon_invalid_response_end'):
                    gateway.RconClient(secret=secret).cmd('fixture_command')
            self.assertEqual(len(sock.sent), 2)

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

"""Real Numen contract fixtures, no live game, runtime writes, or model calls."""
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/survival'))
from numen_gateway import GatewayError, read_json, write_json
from world_actions import WorldActions, validate_world_action, parse_gui

BODY = 'd4ac9523-4962-43ed-98c5-19b49e104048'
MERCHANT = 'e5005711-be9f-44b7-aaad-6993c0ba5df4'
POINT = {'x': 100, 'y': 64, 'z': 100}


def gui(menu='InventoryMenu', container='  0: -\n', mine='  3: coal x5\n'):
    return {'success': True, 'message': 'GUI: ' + menu + '\ncontainer slots:\n' + container
            + 'your inventory (non-empty):\n' + mine + 'cursor: -\n'}


class FakeGateway:
    def __init__(self, state):
        self.state, self.calls, self.blocks = state, [], {}
        self.body = {'ok': True, 'gameMode': 'survival', 'bodyUuid': BODY, 'bodyName': 'Kirito',
                     'dimension': 'minecraft:overworld', 'position': {'x': 100.5, 'y': 64, 'z': 102},
                     'counts': {'minecraft:oak_planks': 8, 'minecraft:white_bed': 1, 'minecraft:oak_door': 1,
                                'minecraft:wheat_seeds': 3, 'minecraft:iron_hoe': 1, 'minecraft:coal': 5,
                                'minecraft:emerald': 3}, 'onGround': True, 'task': {'busy': False},
                     'equipment': {'mainhand': {'item': 'minecraft:iron_sword'}, 'offhand': {'item': 'minecraft:air'}}}
        self.settings = {'constructionAreas': [{'dimension': 'minecraft:overworld', 'minX': 90, 'maxX': 110,
                         'minY': 60, 'maxY': 70, 'minZ': 90, 'maxZ': 110}], 'storageSites': []}
        self.gui = gui()
        self.gui_position = dict(POINT)
        self.gui_epoch, self.container_id = 'fixture-server-epoch', 1
        self.qualified_slots = {}
        self.on_menu_page = lambda reply: None
        self.native_reply = {'accepted': True}
        self.on_interact = lambda args: None
        self.on_transfer = lambda args: None
        self.scan_reply = None
        self.rcon = self
        self.offer = {'index': 0, 'quote': 'a' * 64, 'costA': {'id': 'minecraft:emerald', 'count': 2},
                      'costB': {'id': 'minecraft:air', 'count': 0},
                      'result': {'id': 'minecraft:bread', 'count': 3}, 'uses': 0, 'maxUses': 12, 'outOfStock': False}
        self.offer_pages = {}
        self.trade_reply = {'schema': 1, 'capability': 'vanilla_merchant_v1', 'ok': True,
             'code': 'traded', 'actorUuid': BODY, 'entityId': 7, 'merchantUuid': MERCHANT,
             'receipt': {'offerIndex': 0, 'usesBefore': 0, 'usesAfter': 1,
                 'inventoryVerified': True,
                 'costA': self.offer['costA'], 'costB': self.offer['costB'], 'result': self.offer['result'],
                 'inventoryBefore': {'minecraft:emerald': 3},
                 'inventoryAfter': {'minecraft:emerald': 1, 'minecraft:bread': 3}}}

    def snapshot(self):
        return copy.deepcopy(self.body)

    def _settings(self):
        return copy.deepcopy(self.settings)

    def _now(self):
        return 1800000000000

    def _check_binding(self):
        return 'Kirito', BODY

    def _area(self, point, margin=0, protect=True):
        if not 0 <= point['x'] <= 200 or not 0 <= point['z'] <= 200:
            raise GatewayError('outside_work_area')

    def set_block(self, point, name, properties=None, solid=None):
        key = tuple(point[k] for k in ('x', 'y', 'z'))
        self.blocks[key] = {**point, 'block': name, 'properties': properties if properties is not None else {'type': 'single'} if name == 'minecraft:chest' else {},
                           'is_solid': solid if solid is not None else name != 'minecraft:air', 'in_reach': True}

    def _invoke(self, tool, args=None):
        self.calls.append((tool, copy.deepcopy(args)))
        if tool == 'inspect_block':
            return copy.deepcopy(self.blocks.get(tuple(args[k] for k in ('x', 'y', 'z')),
                {**args, 'block': 'minecraft:air' if args['y'] >= 64 else 'minecraft:grass_block',
                 'properties': {}, 'is_solid': args['y'] < 64, 'in_reach': True}))
        if tool == 'scan_blocks':
            return copy.deepcopy(self.scan_reply) if self.scan_reply is not None else {
                'matches': [], 'truncated': True, 'note': 'unloaded chunks not searched',
                'radius_searched': args['radius'], 'center': POINT}
        if tool == 'inspect_gui':
            return copy.deepcopy(self.gui)
        if tool == 'interact_at':
            self.on_interact(args)
            return copy.deepcopy(self.native_reply)
        if tool == 'transfer':
            self.on_transfer(args)
            return {'success': True, 'message': 'Native transfer output, which alone is not proof.'}
        if tool == 'close_gui':
            self.gui = gui()
            return {'success': True, 'message': 'closed'}
        if tool == 'sleep':
            return {'success': True, 'data': {'sleeping': True, 'bed': args}}
        raise AssertionError('Unsupported or forbidden native call: ' + tool)

    def cmd(self, command):
        self.calls.append(('rcon', command))
        if command.startswith(f'qdworld scan {BODY} '):
            radius = int(command.split(' ')[3])
            reply = self.scan_reply if self.scan_reply is not None else self.scan_response(radius_searched=radius)
            return 'QD_WORLD_SCAN_JSON ' + json.dumps(reply)
        if command.startswith(f'qdworld gui {BODY} '):
            offset = int(command.rsplit(' ', 1)[1])
            parsed = parse_gui(self.gui)
            size = max(parsed['slots'], default=-1) + 1
            rows = []
            for index in range(offset, min(offset + 12, size)):
                slot = parsed['slots'].get(index, {'side': 'container', 'itemPath': None, 'count': 0, 'output': False})
                rows.append({'index': index, 'playerSide': slot['side'] == 'inventory',
                             'id': self.qualified_slots.get(index, 'minecraft:' + (slot['itemPath'] or 'air')),
                             'count': slot['count'], 'output': slot['output']})
            reply = {'schema': 1, 'capability': 'physical_menu_v1', 'ok': True, 'actorUuid': BODY,
                     'dimension': 'minecraft:overworld', 'menu': parsed['menu'], 'containerId': self.container_id,
                     'epoch': self.gui_epoch, 'cursorEmpty': parsed['cursorEmpty'], 'stillValid': True,
                     'physicalBlockKnown': parsed['menu'] != 'InventoryMenu', 'position': self.gui_position,
                     'slotCount': size, 'offset': offset, 'nextOffset': offset + 12 if offset + 12 < size else -1, 'slots': rows}
            self.on_menu_page(reply)
            return 'QD_WORLD_JSON ' + json.dumps(reply)
        if command.startswith(f'qdtrade offers {BODY} 7 '):
            offset = int(command.rsplit(' ', 1)[1])
            reply = {'schema': 1, 'capability': 'vanilla_merchant_v1', 'ok': True,
                     'actorUuid': BODY, 'entityId': 7, 'merchantUuid': MERCHANT,
                     'offers': self.offer_pages.get(offset, [self.offer]), 'offset': offset, 'nextOffset': -1}
        elif command == f'qdtrade trade {BODY} 7 0 ' + 'a' * 64:
            reply = self.trade_reply
        else:
            raise AssertionError('Unexpected command: ' + command)
        return 'QD_TRADE_JSON ' + json.dumps(reply)

    def scan_response(self, **changes):
        return {'schema': 1, 'capability': 'bounded_block_scan_v1', 'ok': True, 'code': 'ok',
                'actorUuid': BODY, 'dimension': 'minecraft:overworld', 'center': POINT,
                'radius_searched': 12, 'matches': [], 'truncated': True, 'scanMillis': 0.5,
                'examinedBlocks': 1000, 'columnsTotal': 4, 'unloadedColumns': 1,
                'coverage': 'partial_unloaded', **changes}

    def mutations(self):
        return [row for row in self.calls if row[0] in ('interact_at', 'transfer', 'close_gui', 'sleep')
                or row[0] == 'rcon' and row[1].startswith('qdtrade trade ')]


class WorldActionTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.state = Path(temp.name)
        self.gateway = FakeGateway(self.state)
        self.world = WorldActions(self.gateway, sleep=lambda _: None, max_polls=2)

    def prepare(self, tool='place_block', args=None):
        return self.world.prepare(tool, args if args is not None else {**POINT, 'item_id': 'minecraft:oak_planks'}, self.gateway.snapshot())

    def own(self, point, block):
        write_json(self.state / 'world-owned.json', {'schema': 1, 'blocks': {
            self.world._key(point, 'minecraft:overworld'): {'block': block}}})

    def test_strict_arguments_refuse_raw_build_admin_and_malformed_targets(self):
        for tool, args in [('take_items', {'item_id': 'minecraft:diamond'}),
            ('place_block', {**POINT, 'item_id': 'minecraft:oak_planks', 'replace_existing': True}),
            ('place_block', {**POINT, 'x': True, 'item_id': 'minecraft:oak_planks'}),
            ('place_block', {**POINT, 'item_id': 'minecraft:stone\nkill @a'}),
            ('farm', {**POINT, 'operation': 'harvest', 'item_id': 'minecraft:diamond'}),
            ('trade', {'entity_id': 7, 'offer_index': 20, 'quote': 'a' * 64})]:
            with self.assertRaises(GatewayError):
                validate_world_action(tool, args)
        self.assertFalse(self.gateway.calls)

    def test_construction_requires_explicit_area_even_inside_general_work_area(self):
        self.gateway.settings['constructionAreas'] = []
        with self.assertRaisesRegex(GatewayError, 'outside_construction_area'):
            self.prepare()
        self.assertFalse(self.gateway.mutations())

    def test_existing_building_no_materials_and_out_of_reach_refuse_before_dispatch(self):
        self.gateway.set_block(POINT, 'minecraft:stone_bricks')
        with self.assertRaisesRegex(GatewayError, 'existing_block'):
            self.prepare()
        self.gateway.blocks.clear(); self.gateway.body['counts'].clear()
        with self.assertRaisesRegex(GatewayError, 'required_item_not_carried'):
            self.prepare()
        self.gateway.body['position']['x'] = 150
        with self.assertRaisesRegex(GatewayError, 'out_of_reach'):
            self.prepare()
        self.assertFalse(self.gateway.mutations())

    def test_single_click_placement_needs_block_and_real_material_consumption(self):
        plan = self.prepare()
        def place(args):
            self.gateway.set_block(POINT, 'minecraft:oak_planks')
            self.gateway.body['counts']['minecraft:oak_planks'] -= 1
        self.gateway.on_interact = place
        result = self.world.dispatch(plan)
        self.assertTrue(result['success']); self.assertTrue(result['data']['verified'])
        self.assertEqual(len(self.gateway.mutations()), 1)
        self.assertEqual(self.gateway.mutations()[0][1], {'button': 'right', 'x': 100, 'y': 63, 'z': 100,
                         'hold_ticks': 0, 'item_id': 'minecraft:oak_planks'})
        self.assertEqual(result['data']['evidence']['inventoryDelta']['minecraft:oak_planks'], -1)
        self.assertIn('world-owned.json', [p.name for p in self.state.iterdir()])

    def test_accepted_click_without_world_change_never_claims_completed_or_replays(self):
        with self.assertRaisesRegex(GatewayError, 'outcome_unknown'):
            self.world.dispatch(self.prepare())
        self.assertEqual(len(self.gateway.mutations()), 1)

    def test_placed_block_without_material_consumption_is_not_verified(self):
        self.gateway.on_interact = lambda _: self.gateway.set_block(POINT, 'minecraft:oak_planks')
        with self.assertRaisesRegex(GatewayError, 'outcome_unknown'):
            self.world.dispatch(self.prepare())

    def test_bed_second_cell_and_door_upper_cell_are_protected(self):
        self.gateway.set_block(POINT | {'z': 99}, 'minecraft:chest')
        with self.assertRaisesRegex(GatewayError, 'multiblock_space_occupied'):
            self.prepare(args={**POINT, 'item_id': 'minecraft:white_bed'})
        self.gateway.blocks.clear()
        self.gateway.settings['constructionAreas'][0]['maxY'] = 64
        with self.assertRaisesRegex(GatewayError, 'outside_construction_area'):
            self.prepare(args={**POINT, 'item_id': 'minecraft:oak_door'})
        self.assertFalse(self.gateway.mutations())

    def test_bed_confirms_both_parts_using_one_actual_bed(self):
        plan = self.prepare(args={**POINT, 'item_id': 'minecraft:white_bed'})
        self.assertEqual(len(plan['expected']), 2)
        def place(_):
            for cell in plan['expected']:
                self.gateway.set_block({k: cell[k] for k in ('x', 'y', 'z')}, cell['block'], cell['properties'])
            self.gateway.body['counts']['minecraft:white_bed'] -= 1
        self.gateway.on_interact = place
        self.assertTrue(self.world.dispatch(plan)['success'])
        self.assertEqual(len(self.gateway.mutations()), 1)

    def test_side_face_placement_is_rejected_instead_of_building_wrong_cell(self):
        self.gateway.body['position']['z'] = 103.5
        with self.assertRaisesRegex(GatewayError, 'placement_top_face_unreachable'):
            self.prepare()

    def test_till_plant_and_harvest_use_real_hoe_seed_and_mature_owned_crop(self):
        soil = POINT | {'y': 63}
        till = self.prepare('farm', {**soil, 'operation': 'till', 'item_id': 'minecraft:iron_hoe'})
        self.gateway.on_interact = lambda _: self.gateway.set_block(soil, 'minecraft:farmland', {'moisture': '0'})
        self.assertTrue(self.world.dispatch(till)['success'])
        plant = self.prepare('farm', {**POINT, 'operation': 'plant', 'item_id': 'minecraft:wheat_seeds'})
        def plant_seed(_):
            self.gateway.set_block(POINT, 'minecraft:wheat', {'age': '0'}, solid=False)
            self.gateway.body['counts']['minecraft:wheat_seeds'] -= 1
        self.gateway.on_interact = plant_seed
        self.assertTrue(self.world.dispatch(plant)['success'])
        with self.assertRaisesRegex(GatewayError, 'crop_not_mature'):
            self.prepare('farm', {**POINT, 'operation': 'harvest', 'item_id': None})
        self.gateway.set_block(POINT, 'minecraft:wheat', {'age': '7'}, solid=False)
        harvest = self.prepare('farm', {**POINT, 'operation': 'harvest', 'item_id': None})
        self.gateway.on_interact = lambda _: self.gateway.set_block(POINT, 'minecraft:air', solid=False)
        result = self.world.dispatch(harvest)
        self.assertTrue(result['success']); self.assertEqual(result['data']['evidence']['itemsCollected'], {})
        self.assertEqual(self.gateway.mutations()[-1][1]['button'], 'left')

    def test_existing_unowned_mature_crop_is_not_free_loot(self):
        self.gateway.set_block(POINT, 'minecraft:wheat', {'age': '7'}, solid=False)
        with self.assertRaisesRegex(GatewayError, 'crop_not_owned'):
            self.prepare('farm', {**POINT, 'operation': 'harvest', 'item_id': None})
        self.assertFalse(self.gateway.mutations())

    def open_storage(self):
        self.gateway.set_block(POINT, 'minecraft:chest')
        self.own(POINT, 'minecraft:chest')
        self.gateway.on_interact = lambda _: setattr(self.gateway, 'gui', gui('ChestMenu'))
        return self.world.dispatch(self.prepare('open_container', POINT))

    def test_only_owned_or_explicit_storage_can_be_opened_and_read_in_context(self):
        self.gateway.set_block(POINT, 'minecraft:chest')
        with self.assertRaisesRegex(GatewayError, 'container_not_owned'):
            self.prepare('open_container', POINT)
        self.assertTrue(self.open_storage()['success'])
        self.assertEqual(read_json(self.state / 'world-gui.json')['point'], POINT)

    def test_transfer_needs_current_physical_gui_and_valid_observed_slots(self):
        self.open_storage()
        args = {**POINT, 'moves': [{'from': 3, 'to': 0, 'count': 2, 'item_id': 'minecraft:coal'}]}
        plan = self.prepare('transfer_items', args)
        def transfer(native):
            self.assertEqual(native, {'moves': [{'from': 3, 'to': 0, 'count': 2}]})
            self.gateway.body['counts']['minecraft:coal'] -= 2
            self.gateway.gui = gui('ChestMenu', '  0: coal x2\n', '  3: coal x3\n')
        self.gateway.on_transfer = transfer
        result = self.world.dispatch(plan)
        self.assertEqual(result['data']['evidence']['inventoryDelta'], {'minecraft:coal': -2})
        self.gateway.gui = gui()
        with self.assertRaisesRegex(GatewayError, 'physical_container_not_open'):
            self.prepare('transfer_items', args)

    def test_transfer_native_success_without_inventory_change_is_unconfirmed(self):
        self.open_storage()
        args = {**POINT, 'moves': [{'from': 3, 'to': 0, 'count': 2, 'item_id': 'minecraft:coal'}]}
        with self.assertRaisesRegex(GatewayError, 'outcome_unknown'):
            self.world.dispatch(self.prepare('transfer_items', args))
        self.assertEqual(sum(tool == 'transfer' for tool, _ in self.gateway.calls), 1)

    def test_open_requires_inventory_menu_and_harmless_both_hands(self):
        self.gateway.set_block(POINT, 'minecraft:chest')
        self.own(POINT, 'minecraft:chest')
        self.gateway.gui = gui('ChestMenu')
        with self.assertRaisesRegex(GatewayError, 'close_current_container_first'):
            self.prepare('open_container', POINT)
        self.gateway.gui = gui()
        for hand in ('mainhand', 'offhand'):
            with self.subTest(hand=hand):
                original = self.gateway.body['equipment'][hand]
                self.gateway.body['equipment'][hand] = {'item': 'minecraft:ender_pearl'}
                with self.assertRaisesRegex(GatewayError, 'passive_hands'):
                    self.prepare('open_container', POINT)
                self.gateway.body['equipment'][hand] = original
        self.assertFalse(self.gateway.mutations())

    def test_opening_same_menu_class_at_different_block_does_not_authorize(self):
        self.gateway.gui_position = POINT | {'x': 101}
        with self.assertRaisesRegex(GatewayError, 'outcome_unknown'):
            self.open_storage()
        self.assertFalse((self.state / 'world-gui.json').exists())
        self.assertEqual(len(self.gateway.mutations()), 1)

    def test_transfer_rejects_different_physical_block_epoch_or_container_id(self):
        self.open_storage()
        args = {**POINT, 'moves': [{'from': 3, 'to': 0, 'count': 2, 'item_id': 'minecraft:coal'}]}
        for key, changed in (('gui_position', POINT | {'x': 101}), ('gui_epoch', 'another-server'), ('container_id', 2)):
            with self.subTest(key=key):
                original = getattr(self.gateway, key)
                setattr(self.gateway, key, changed)
                with self.assertRaisesRegex(GatewayError, 'physical_container_not_open'):
                    self.prepare('transfer_items', args)
                setattr(self.gateway, key, original)
        self.assertEqual(len(self.gateway.mutations()), 1)

    def test_double_chest_and_adjacent_chest_placement_refuse_before_mutation(self):
        self.gateway.set_block(POINT, 'minecraft:chest', {'type': 'left'})
        self.own(POINT, 'minecraft:chest')
        with self.assertRaisesRegex(GatewayError, 'double_container'):
            self.prepare('open_container', POINT)
        self.gateway.set_block(POINT, 'minecraft:air')
        self.gateway.set_block(POINT | {'x': 101}, 'minecraft:chest')
        self.gateway.body['counts']['minecraft:chest'] = 1
        with self.assertRaisesRegex(GatewayError, 'chest_would_merge'):
            self.prepare('place_block', POINT | {'item_id': 'minecraft:chest'})
        self.assertFalse(self.gateway.mutations())

    def test_transfer_requires_namespaced_source_not_colliding_item_path(self):
        self.open_storage()
        self.gateway.qualified_slots[3] = 'example:coal'
        args = {**POINT, 'moves': [{'from': 3, 'to': 0, 'count': 2, 'item_id': 'minecraft:coal'}]}
        with self.assertRaisesRegex(GatewayError, 'transfer_source_changed'):
            self.prepare('transfer_items', args)
        args['moves'][0]['item_id'] = 'example:coal'
        self.assertEqual(self.prepare('transfer_items', args)['guiBefore']['slots'][3]['itemId'], 'example:coal')
        self.assertEqual(len(self.gateway.mutations()), 1)

    def test_container_view_reads_all_bounded_pages_without_mutation(self):
        self.open_storage()
        self.gateway.gui = gui('ChestMenu', '  0: coal x2\n', '  38: coal x5\n')
        self.gateway.qualified_slots[38] = 'example:coal'
        self.gateway.calls.clear()
        result = self.world.container_view(**POINT)
        self.assertEqual(result['gui']['slots'][38]['itemId'], 'example:coal')
        self.assertEqual(result['gui']['slots'][38]['side'], 'inventory')
        self.assertEqual(len(result['gui']['slots']), 39)
        self.assertEqual([int(command.rsplit(' ', 1)[1]) for tool, command in self.gateway.calls if tool == 'rcon'], [0, 12, 24, 36])
        self.assertFalse(self.gateway.mutations())

    def test_partial_gui_metadata_and_broken_pagination_are_not_usable(self):
        self.open_storage()
        self.gateway.gui = gui('ChestMenu', '  0: coal x2\n', '  38: coal x5\n')
        for corrupt in (
            lambda page: page.update(epoch='another-server') if page['offset'] == 12 else None,
            lambda page: page.update(nextOffset=0),
            lambda page: page.update(cursorEmpty='true'),
            lambda page: page.update(slots=page['slots'][1:]),
            lambda page: page.update(slotCount=129),
        ):
            self.gateway.on_menu_page = corrupt
            with self.assertRaises(GatewayError):
                self.world.container_view(**POINT)
        self.assertEqual(len(self.gateway.mutations()), 1)

    def test_reciprocal_same_item_transfer_and_slot_overlaps_cannot_fake_zero_net_success(self):
        self.open_storage()
        self.gateway.gui = gui('ChestMenu', '  0: coal x2\n  1: -\n', '  3: coal x5\n  4: -\n')
        opposing = [{ 'from': 0, 'to': 4, 'count': 1, 'item_id': 'minecraft:coal'},
                    { 'from': 3, 'to': 1, 'count': 1, 'item_id': 'minecraft:coal'}]
        with self.assertRaisesRegex(GatewayError, 'transfer_direction_conflict'):
            self.prepare('transfer_items', POINT | {'moves': opposing})
        opposing[0]['to'] = 3
        with self.assertRaisesRegex(GatewayError, 'overlapping_transfer_slots'):
            validate_world_action('transfer_items', POINT | {'moves': opposing})
        opposing[0]['from'] = 128
        with self.assertRaisesRegex(GatewayError, 'invalid_world_argument'):
            validate_world_action('transfer_items', POINT | {'moves': opposing})

    def test_changed_preflight_fails_definitely_without_dispatch_or_unknown(self):
        plan = self.prepare()
        self.gateway.set_block(POINT, 'minecraft:stone_bricks')
        result = self.world.dispatch(plan)
        self.assertFalse(result['success'])
        self.assertFalse(result['data']['dispatched'])
        self.assertIn('existing_block', result['message'])
        self.assertFalse(self.gateway.mutations())

    def test_precise_read_is_limited_to_nearby_world(self):
        with self.assertRaisesRegex(GatewayError, 'block_observation_out_of_range'):
            self.world.inspect(150, 64, 100)
        self.assertFalse(self.gateway.calls)

    def test_close_and_sleep_require_real_gui_or_sleep_receipts(self):
        self.open_storage()
        result = self.world.dispatch(self.prepare('close_container', {}))
        self.assertTrue(result['data']['evidence']['closed'])
        self.gateway.set_block(POINT, 'minecraft:white_bed', {'part': 'foot', 'facing': 'north'})
        self.assertTrue(self.world.dispatch(self.prepare('sleep', POINT))['data']['verified'])

    def test_readonly_block_and_scan_preserve_exact_states_and_unknown_coverage(self):
        self.gateway.set_block(POINT, 'minecraft:wheat', {'age': '5'}, solid=False)
        self.assertEqual(self.world.inspect(**POINT)['properties'], {'age': '5'})
        self.assertTrue(self.world.scan(['#minecraft:beds'])['truncated'])
        self.assertFalse(self.gateway.mutations())

    def test_async_scan_acceptance_is_not_observation_and_never_uses_numen_async_scan(self):
        self.gateway.scan_reply = {'accepted': True, 'note': 'no immediate reply (async tool)'}
        result = self.world.scan(['minecraft:crafting_table', 'minecraft:chest'], 12)
        self.assertFalse(result['ok'])
        self.assertEqual(result['code'], 'scan_reply_invalid')
        self.assertFalse(result['completionConfirmed'])
        self.assertFalse(result['retryAutomatically'])
        self.assertEqual(result['coverage'], 'unknown')
        self.assertNotIn('matches', result)
        self.assertEqual(self.gateway.calls, [('rcon', f'qdworld scan {BODY} 12 minecraft:crafting_table,minecraft:chest')])
        self.assertFalse(self.gateway.mutations())

    def test_scan_returns_real_coordinates_only_from_complete_native_reply(self):
        hit = POINT | {'block': 'minecraft:crafting_table', 'distance': 0.0}
        self.gateway.scan_reply = self.gateway.scan_response(matches=[hit], truncated=False,
            total_in_radius=1, unloadedColumns=0, coverage='loaded_sphere')
        result = self.world.scan(['minecraft:crafting_table'], 12)
        self.assertTrue(result['ok'])
        self.assertTrue(result['completionConfirmed'])
        self.assertEqual(result['matches'], [hit])
        self.assertEqual(result['total_in_radius'], 1)

    def test_invalid_scan_replies_never_claim_empty_or_complete_coverage(self):
        for reply in ({'success': True}, {'matches': [], 'truncated': False},
                      {'matches': [POINT | {'block': 'minecraft:stone', 'distance': float('nan')}],
                       'truncated': False, 'center': POINT, 'radius_searched': 12}):
            self.gateway.scan_reply = reply
            result = self.world.scan(['minecraft:stone'], 12)
            self.assertFalse(result['ok'])
            self.assertEqual(result['code'], 'scan_reply_invalid')
            self.assertNotIn('matches', result)

    def test_scan_cooldown_is_returned_without_waiting_retrying_or_consuming_action(self):
        self.gateway.scan_reply = self.gateway.scan_response(ok=False, code='scan_cooldown', retryAfterMs=4200)
        result = self.world.scan(['#minecraft:beds'])
        self.assertEqual(result, {'ok': False, 'code': 'scan_cooldown', 'retryAfterMs': 4200,
            'completionConfirmed': False, 'retryAutomatically': False, 'coverage': 'unknown'})
        self.assertEqual(len(self.gateway.calls), 1)
        self.assertFalse(self.gateway.mutations())

    def test_scan_validates_actor_dimension_center_and_server_bounds(self):
        for changes in ({'actorUuid': MERCHANT}, {'dimension': 'minecraft:the_nether'},
                        {'center': POINT | {'x': 130}}, {'examinedBlocks': 35938},
                        {'columnsTotal': 10}, {'unloadedColumns': 5}, {'scanMillis': -1}, {'scanMillis': 10 ** 1000},
                        {'truncated': False}, {'coverage': 'loaded_sphere'}, {'total_in_radius': 0}):
            with self.subTest(changes=changes):
                self.gateway.scan_reply = self.gateway.scan_response(**changes)
                result = self.world.scan(['minecraft:chest'])
                self.assertFalse(result['ok'])
                self.assertEqual(result['code'], 'scan_reply_invalid')

    def test_scan_requires_nearest_order_unique_in_radius_correct_filters_and_small_reply(self):
        near = POINT | {'block': 'minecraft:chest', 'distance': 0.0}
        farther = POINT | {'x': 101, 'block': 'minecraft:chest', 'distance': 1.0}
        for changes in ({'matches': [farther, near]}, {'matches': [near, near]},
                        {'matches': [near | {'distance': 1.0}]},
                        {'matches': [near | {'block': 'minecraft:diamond_block'}]},
                        {'matches': [near | {'x': 113, 'distance': 13.0}]},
                        {'matches': [near] * 17}, {'note': 'x' * 3000}):
            with self.subTest(changes=list(changes)):
                self.gateway.scan_reply = self.gateway.scan_response(**changes)
                self.assertEqual(self.world.scan(['minecraft:chest'])['code'], 'scan_reply_invalid')
        self.gateway.scan_reply = self.gateway.scan_response(matches=[near, farther])
        self.assertTrue(self.world.scan(['minecraft:chest'])['ok'])

    def test_scan_limits_radius_filters_and_command_injection_before_io(self):
        for filters, radius in [(['minecraft:chest'], 17), (['minecraft:chest'] * 9, 12),
                                (['minecraft:chest,kill'], 12), (['#minecraft:beds\nkill'], 12)]:
            with self.assertRaises(GatewayError):
                self.world.scan(filters, radius)
        self.assertFalse(self.gateway.calls)

    def test_trade_uses_exact_actor_quote_one_purchase_and_balanced_inventory(self):
        quotes = self.world.villager_offers(7)
        self.assertEqual(quotes['offers'][0]['quote'], 'a' * 64)
        args = {'entity_id': 7, 'offer_index': 0, 'quote': 'a' * 64}
        result = self.world.dispatch(self.prepare('trade', args))
        self.assertTrue(result['success'])
        self.assertEqual(result['data']['evidence']['inventoryDelta'], {'minecraft:emerald': -2, 'minecraft:bread': 3})
        self.assertEqual(len(self.gateway.mutations()), 1)

    def test_changed_quote_or_missing_payment_is_rejected_before_purchase(self):
        args = {'entity_id': 7, 'offer_index': 0, 'quote': 'b' * 64}
        with self.assertRaisesRegex(GatewayError, 'quote_changed'):
            self.prepare('trade', args)
        args['quote'] = 'a' * 64
        self.gateway.body['counts']['minecraft:emerald'] = 1
        with self.assertRaisesRegex(GatewayError, 'trade_payment_not_carried'):
            self.prepare('trade', args)
        self.assertFalse(self.gateway.mutations())

    def test_later_offer_page_is_queried_for_trade_without_scanning_entire_merchant(self):
        offer = self.gateway.offer | {'index': 5, 'quote': 'b' * 64}
        self.gateway.offer_pages[4] = [offer]
        self.assertEqual(self.world.villager_offers(7, 4)['offers'][0]['index'], 5)
        plan = self.prepare('trade', {'entity_id': 7, 'offer_index': 5, 'quote': 'b' * 64})
        self.assertEqual(plan['offer']['index'], 5)
        self.assertEqual([command for tool, command in self.gateway.calls if tool == 'rcon'],
                         [f'qdtrade offers {BODY} 7 4', f'qdtrade offers {BODY} 7 4'])
        self.assertFalse(self.gateway.mutations())

    def test_offer_page_with_out_of_range_or_duplicate_indices_is_rejected(self):
        self.gateway.offer_pages[4] = [self.gateway.offer]
        with self.assertRaisesRegex(GatewayError, 'merchant_offers_invalid'):
            self.world.villager_offers(7, 4)
        self.gateway.offer_pages[0] = [self.gateway.offer, self.gateway.offer]
        with self.assertRaisesRegex(GatewayError, 'merchant_offers_invalid'):
            self.world.villager_offers(7)

    def test_inconsistent_native_trade_receipt_stays_unknown_and_is_never_retried(self):
        self.gateway.trade_reply['receipt']['usesAfter'] = 2
        args = {'entity_id': 7, 'offer_index': 0, 'quote': 'a' * 64}
        with self.assertRaisesRegex(GatewayError, 'outcome_unknown'):
            self.world.dispatch(self.prepare('trade', args))
        self.assertEqual(len(self.gateway.mutations()), 1)

    def test_trade_without_native_component_inventory_verification_is_unknown(self):
        self.gateway.trade_reply['receipt']['inventoryVerified'] = False
        args = {'entity_id': 7, 'offer_index': 0, 'quote': 'a' * 64}
        with self.assertRaisesRegex(GatewayError, 'outcome_unknown'):
            self.world.dispatch(self.prepare('trade', args))
        self.assertEqual(len(self.gateway.mutations()), 1)


if __name__ == '__main__':
    unittest.main()

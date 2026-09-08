"""Ordinary Numen world interactions behind the survivor's single-action lease.

The gateway calls prepare() before reserving its lease and dispatch() only after
persisting the uncertainty marker. There is no raw command, free-material build,
teleport, inventory NBT write, or replacement of existing buildings here.
"""
import json
import math
from pathlib import Path
import re
import time
import uuid

from numen_gateway import GatewayError, IDENTIFIER, read_json, write_json

WORLD_ACTIONS = ('place_block', 'farm', 'open_container', 'transfer_items', 'close_container', 'sleep', 'trade')
AIR = frozenset(('minecraft:air', 'minecraft:cave_air', 'minecraft:void_air'))
REPLACEABLE = AIR | {'minecraft:short_grass', 'minecraft:fern', 'minecraft:dead_bush'}
SOIL = frozenset(('minecraft:dirt', 'minecraft:grass_block'))
COLORS = ('white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray',
          'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black')
WOODS = ('oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry',
         'bamboo', 'crimson', 'warped')
SAFE_BLOCKS = frozenset('minecraft:' + name for name in (
    'crafting_table', 'furnace', 'blast_furnace', 'smoker', 'chest', 'barrel', 'glass',
    'glass_pane', 'cobblestone', 'stone', 'stone_bricks', 'bricks', 'dirt', 'torch',
    'lantern', 'cobbled_deepslate', 'deepslate_bricks', 'sandstone', 'smooth_stone',
    *(color + '_bed' for color in COLORS),
    *(wood + suffix for wood in WOODS for suffix in ('_planks', '_stairs', '_slab', '_fence', '_door', '_trapdoor')),
    *(wood + '_log' for wood in WOODS[:8]),
    *(name + suffix for name in ('cobblestone', 'stone_brick', 'brick', 'cobbled_deepslate',
                                 'deepslate_brick', 'sandstone') for suffix in ('_stairs', '_slab'))))
STORAGE = frozenset('minecraft:' + name for name in ('chest', 'barrel', 'furnace', 'blast_furnace', 'smoker'))
HOES = frozenset('minecraft:' + name + '_hoe' for name in ('wooden', 'stone', 'iron', 'golden', 'diamond', 'netherite'))
PASSIVE_HAND_ITEMS = frozenset(('minecraft:air', 'minecraft:stick', 'minecraft:coal',
    'minecraft:charcoal', 'minecraft:iron_ingot', 'minecraft:copper_ingot', 'minecraft:gold_ingot',
    'minecraft:emerald', 'minecraft:diamond', *(f'minecraft:{material}_sword' for material in
    ('wooden', 'stone', 'iron', 'golden', 'diamond', 'netherite'))))
CROPS = {'minecraft:wheat_seeds': ('minecraft:wheat', 7),
         'minecraft:carrot': ('minecraft:carrots', 7), 'minecraft:potato': ('minecraft:potatoes', 7),
         'minecraft:beetroot_seeds': ('minecraft:beetroots', 3)}
CROP_AGES = dict(CROPS.values())
DIRECTIONS = {'south': (0, 1), 'west': (-1, 0), 'north': (0, -1), 'east': (1, 0)}


def _integer(value, low, high):
    if type(value) is not int or not low <= value <= high:
        raise GatewayError('invalid_world_argument')


def _item(value):
    if not isinstance(value, str) or len(value) > 100 or not IDENTIFIER.fullmatch(value):
        raise GatewayError('invalid_world_item')


def _point(args):
    for key, low, high in (('x', -29999984, 29999984), ('y', -64, 319), ('z', -29999984, 29999984)):
        _integer(args.get(key), low, high)
    return {key: args[key] for key in ('x', 'y', 'z')}


def validate_world_action(tool, args):
    """Syntactic validation only; no IO, environment inspection or permissions."""
    if tool not in WORLD_ACTIONS or not isinstance(args, dict):
        raise GatewayError('world_tool_not_allowed')
    fields = {'place_block': {'item_id', 'x', 'y', 'z'},
              'farm': {'operation', 'item_id', 'x', 'y', 'z'},
              'open_container': {'x', 'y', 'z'}, 'transfer_items': {'x', 'y', 'z', 'moves'},
              'close_container': set(), 'sleep': {'x', 'y', 'z'},
              'trade': {'entity_id', 'offer_index', 'quote'}}[tool]
    if set(args) != fields:
        raise GatewayError('invalid_world_arguments')
    if tool not in ('close_container', 'trade'):
        _point(args)
    if tool == 'trade':
        _integer(args['entity_id'], 1, 2147483647)
        _integer(args['offer_index'], 0, 19)
        if not isinstance(args['quote'], str) or not re.fullmatch(r'[0-9a-f]{64}', args['quote']):
            raise GatewayError('invalid_trade_quote')
    if tool == 'place_block':
        _item(args['item_id'])
    if tool == 'farm':
        if args['operation'] not in ('till', 'plant', 'harvest'):
            raise GatewayError('invalid_farm_operation')
        if args['operation'] == 'harvest':
            if args['item_id'] is not None:
                raise GatewayError('harvest_has_no_item_override')
        else:
            _item(args['item_id'])
    if tool == 'transfer_items':
        if not isinstance(args['moves'], list) or not 1 <= len(args['moves']) <= 4:
            raise GatewayError('invalid_transfer_moves')
        sources = set()
        targets = set()
        for move in args['moves']:
            if not isinstance(move, dict) or set(move) != {'from', 'to', 'count', 'item_id'}:
                raise GatewayError('invalid_transfer_move')
            _integer(move['from'], 0, 127)
            if move['from'] in sources:
                raise GatewayError('duplicate_transfer_source')
            sources.add(move['from'])
            _item(move['item_id'])
            if move['to'] is None:
                if move['count'] is not None:
                    raise GatewayError('routed_transfer_uses_whole_stack')
            else:
                _integer(move['to'], 0, 127)
                _integer(move['count'], 1, 64)
                if move['to'] == move['from']:
                    raise GatewayError('transfer_to_same_slot')
                if move['to'] in targets:
                    raise GatewayError('overlapping_transfer_slots')
                targets.add(move['to'])
        if sources & targets:
            raise GatewayError('overlapping_transfer_slots')


def parse_gui(reply):
    """Parse only Numen's fixed slot output, retaining its namespace limitation."""
    if not isinstance(reply, dict) or reply.get('success') is not True:
        raise GatewayError('gui_unavailable')
    message = reply.get('message')
    if not isinstance(message, str) or len(message) > 24000:
        raise GatewayError('gui_unavailable')
    match = re.search(r'^GUI: ([A-Za-z0-9_$]+)', message)
    if not match:
        raise GatewayError('gui_unavailable')
    slots, side = {}, None
    for line in message.splitlines():
        if line == 'container slots:':
            side = 'container'
        elif line == 'your inventory (non-empty):':
            side = 'inventory'
        else:
            found = re.fullmatch(r'  (\d+): (?:(-)|([a-z0-9_./-]+) x(\d+))( \[output\])?', line)
            if found and side:
                index = int(found[1])
                if index > 255 or index in slots:
                    raise GatewayError('gui_slots_invalid')
                slots[index] = {'slot': index, 'side': side, 'itemPath': found[3],
                                'count': int(found[4] or 0), 'output': bool(found[5])}
    cursor = re.search(r'^cursor: (.+)$', message, re.MULTILINE)
    return {'menu': match[1], 'slots': slots, 'cursorEmpty': bool(cursor and cursor[1] == '-'),
            'raw': message, 'namespaceNotice': 'Native GUI labels are item paths; receipt verification uses namespaced body inventory.'}


class WorldActions:
    validate = staticmethod(validate_world_action)

    def __init__(self, gateway, sleep=time.sleep, max_polls=16):
        self.gateway, self.state, self.sleep = gateway, Path(gateway.state), sleep
        self.max_polls = max(1, min(32, max_polls))

    def _key(self, point, dimension):
        return dimension + ':' + ','.join(str(point[k]) for k in ('x', 'y', 'z'))

    def _owned(self):
        path = self.state / 'world-owned.json'
        return read_json(path).get('blocks', {}) if path.exists() else {}

    def _remember_blocks(self, plan, blocks):
        owned = self._owned()
        for block in blocks:
            owned[self._key(block, plan['dimension'])] = {
                'block': block['block'], 'at': self.gateway._now(), 'source': 'verified_player_action'}
        if len(owned) > 1200:
            raise GatewayError('ownership_ledger_full')
        write_json(self.state / 'world-owned.json', {'schema': 1, 'blocks': owned})

    def _area(self, point, before, construction=False):
        self.gateway._area(point, protect=False)
        if not construction:
            return
        dimension = before['dimension']
        for area in self.gateway._settings().get('constructionAreas', [])[:32]:
            if not isinstance(area, dict) or area.get('dimension') != dimension:
                continue
            if all(type(area.get(bound)) is int for bound in ('minX', 'maxX', 'minY', 'maxY', 'minZ', 'maxZ')):
                if all(area['min' + axis.upper()] <= point[axis] <= area['max' + axis.upper()] for axis in ('x', 'y', 'z')):
                    return
        raise GatewayError('outside_construction_area')

    def _reach(self, point, before):
        if before.get('onGround') is not True or sum((before['position'][k] - (point[k] + .5)) ** 2 for k in ('x', 'y', 'z')) > 4.5 ** 2:
            raise GatewayError('world_target_out_of_reach')

    def _block(self, point):
        raw = self.gateway._invoke('inspect_block', _point(point))
        if (not isinstance(raw, dict) or any(raw.get(k) != point[k] for k in ('x', 'y', 'z'))
                or not isinstance(raw.get('block'), str) or not IDENTIFIER.fullmatch(raw['block'])):
            raise GatewayError('block_observation_unavailable')
        return {**_point(point), 'block': raw['block'],
                'properties': raw.get('properties', {}) if isinstance(raw.get('properties'), dict) else {},
                'isSolid': raw.get('is_solid') is True, 'inReach': raw.get('in_reach') is True,
                'observedAt': self.gateway._now()}

    def inspect(self, x, y, z):
        point = _point({'x': x, 'y': y, 'z': z})
        body = self.gateway.snapshot()
        if body.get('ok') is not True or sum((body['position'][k] - point[k]) ** 2 for k in ('x', 'y', 'z')) > 32 ** 2:
            raise GatewayError('block_observation_out_of_range')
        self.gateway._area(point, protect=False)
        return {'ok': True, **self._block(point)}

    def _menu(self, full=False, needed=None):
        """Authoritative physical origin + namespaced slots, bounded RCON pages."""
        _, actor_uuid = self.gateway._check_binding()
        actor_uuid = str(uuid.UUID(actor_uuid))
        offsets = [0] if needed is None else sorted({0, *(index // 12 * 12 for index in needed)})
        combined, identity = None, None
        seen = set()
        while offsets:
            offset = offsets.pop(0)
            if offset in seen or len(seen) >= 11:
                raise GatewayError('physical_menu_page_invalid')
            seen.add(offset)
            raw = self.gateway.rcon.cmd(f'qdworld gui {actor_uuid} {offset}')
            lines = [line for line in raw.splitlines() if line.startswith('QD_WORLD_JSON ')]
            if len(lines) != 1:
                raise GatewayError('physical_menu_bridge_unavailable')
            try:
                page = json.loads(lines[0][len('QD_WORLD_JSON '):])
                if (page.get('schema') != 1 or page.get('capability') != 'physical_menu_v1'
                        or page.get('ok') is not True or page.get('actorUuid') != actor_uuid
                        or page.get('offset') != offset or not isinstance(page.get('epoch'), str)
                        or not 1 <= len(page['epoch']) <= 128
                        or not isinstance(page.get('menu'), str) or not isinstance(page.get('dimension'), str)
                        or any(type(page.get(key)) is not bool for key in ('cursorEmpty', 'stillValid', 'physicalBlockKnown'))):
                    raise ValueError('invalid_physical_menu')
                _integer(page['containerId'], 0, 2147483647)
                _integer(page['slotCount'], 0, 128)
                _integer(page['nextOffset'], -1, 127)
                end = min(offset + 12, page['slotCount'])
                if page['nextOffset'] != (end if end < page['slotCount'] else -1):
                    raise ValueError('invalid_menu_next_page')
                current = {key: page.get(key) for key in ('epoch', 'containerId', 'menu', 'dimension',
                    'physicalBlockKnown', 'position', 'slotCount', 'cursorEmpty', 'stillValid')}
                if identity is not None and current != identity:
                    raise GatewayError('physical_menu_changed_during_read')
                if combined is None:
                    identity = current
                    combined = current | {'slots': {}, 'actorUuid': actor_uuid}
                rows = page['slots']
                if (not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows)
                        or len(rows) != max(0, end - offset)
                        or [row.get('index') for row in rows] != list(range(offset, end))):
                    raise ValueError('invalid_menu_slots')
                for row in rows:
                    index = row['index']
                    _integer(index, offset, min(offset + 11, page['slotCount'] - 1))
                    _item(row['id']); _integer(row['count'], 0, 2147483647)
                    if type(row.get('playerSide')) is not bool or type(row.get('output')) is not bool:
                        raise ValueError('invalid_menu_slot_side')
                    combined['slots'][index] = {'slot': index, 'side': 'inventory' if row['playerSide'] else 'container',
                        'itemId': row['id'], 'itemPath': row['id'].split(':', 1)[1] if row['count'] else None,
                        'count': row['count'], 'output': row['output']}
                if full and page['nextOffset'] != -1:
                    if page['nextOffset'] <= offset:
                        raise ValueError('invalid_menu_next_page')
                    offsets.append(page['nextOffset'])
            except (TypeError, KeyError, ValueError) as exc:
                if isinstance(exc, GatewayError):
                    raise
                raise GatewayError('physical_menu_unavailable')
        return combined

    def _bound_menu(self, point, before, full=False, needed=None):
        gui = self._menu(full, needed)
        if (gui.get('physicalBlockKnown') is not True or gui.get('position') != point
                or gui.get('dimension') != before['dimension'] or gui.get('stillValid') is not True
                or gui['menu'] in ('InventoryMenu', 'MerchantMenu')):
            raise GatewayError('physical_container_not_open')
        return gui

    def container_view(self, x, y, z):
        point = _point({'x': x, 'y': y, 'z': z})
        before = self.gateway.snapshot()
        if before.get('ok') is not True:
            raise GatewayError('body_snapshot_unavailable')
        self._area(point, before); self._reach(point, before); self._storage(point, before)
        gui = self._bound_menu(point, before, full=True)
        return {'ok': True, 'observedAt': self.gateway._now(), 'point': point, 'gui': gui}

    def scan(self, block_ids, radius=12):
        _integer(radius, 1, 16)
        if not isinstance(block_ids, list) or not 1 <= len(block_ids) <= 8:
            raise GatewayError('invalid_block_scan')
        for item in block_ids:
            _item(item[1:] if isinstance(item, str) and item.startswith('#') else item)
        before = self.gateway.snapshot()
        if before.get('ok') is not True:
            raise GatewayError('body_snapshot_unavailable')
        self._area(before['position'], before)
        actor_uuid = str(uuid.UUID(before['bodyUuid']))
        raw = self.gateway.rcon.cmd(f'qdworld scan {actor_uuid} {radius} ' + ','.join(block_ids))
        try:
            lines = [line[len('QD_WORLD_SCAN_JSON '):] for line in raw.splitlines() if line.startswith('QD_WORLD_SCAN_JSON ')]
            if len(lines) != 1 or len(lines[0].encode('utf-8')) > 3000:
                raise ValueError('invalid_scan_envelope')
            reply = json.loads(lines[0])
            if (not isinstance(reply, dict) or reply.get('schema') != 1
                    or reply.get('capability') != 'bounded_block_scan_v1' or type(reply.get('ok')) is not bool
                    or reply.get('actorUuid') != actor_uuid):
                raise ValueError('invalid_scan_identity')
            if reply['ok'] is False:
                code = reply.get('code')
                if not isinstance(code, str) or not re.fullmatch('[a-z_]{1,50}', code):
                    raise ValueError('invalid_scan_failure')
                result = {'ok': False, 'code': code, 'completionConfirmed': False,
                          'retryAutomatically': False, 'coverage': 'unknown'}
                if code == 'scan_cooldown':
                    _integer(reply.get('retryAfterMs'), 1, 5000)
                    result['retryAfterMs'] = reply['retryAfterMs']
                return result
            if (not isinstance(reply.get('matches'), list) or len(reply['matches']) > 16
                    or type(reply.get('truncated')) is not bool or reply.get('dimension') != before['dimension']
                    or reply.get('radius_searched') != radius or not isinstance(reply.get('center'), dict)
                    or reply.get('coverage') not in ('loaded_sphere', 'partial_unloaded')):
                raise ValueError('invalid_scan_result')
            center = _point(reply['center'])
            self._area(center, before)
            if sum((center[key] - math.floor(before['position'][key])) ** 2 for key in ('x', 'y', 'z')) > 4:
                raise ValueError('scan_body_moved')
            _integer(reply.get('examinedBlocks'), 0, 35937)
            _integer(reply.get('columnsTotal'), 1, 9)
            _integer(reply.get('unloadedColumns'), 0, reply['columnsTotal'])
            if (reply['coverage'] == 'partial_unloaded') != bool(reply['unloadedColumns']):
                raise ValueError('invalid_scan_coverage')
            if reply['unloadedColumns'] and (not reply['truncated'] or 'total_in_radius' in reply):
                raise ValueError('invalid_scan_coverage')
            if not self._finite(reply.get('scanMillis')) or reply['scanMillis'] < 0:
                raise ValueError('invalid_scan_duration')
            if 'total_in_radius' in reply:
                _integer(reply['total_in_radius'], len(reply['matches']), reply['examinedBlocks'])
            seen, previous_distance = set(), -1
            for hit in reply['matches']:
                if not isinstance(hit, dict):
                    raise ValueError('invalid_scan_hit')
                _point(hit); _item(hit['block'])
                coordinate = tuple(hit[key] for key in ('x', 'y', 'z'))
                squared = sum((hit[key] - center[key]) ** 2 for key in ('x', 'y', 'z'))
                if (coordinate in seen or squared > radius ** 2 or squared < previous_distance
                        or not self._finite(hit.get('distance'))
                        or abs(hit['distance'] - math.sqrt(squared)) > .001
                        or ('source' in hit and type(hit['source']) is not bool)
                        or not any(item.startswith('#') for item in block_ids) and hit['block'] not in block_ids):
                    raise ValueError('invalid_scan_distance')
                seen.add(coordinate)
                previous_distance = squared
            return reply | {'ok': True, 'completionConfirmed': True, 'observedAt': self.gateway._now()}
        except (ValueError, KeyError, TypeError):
            return {'ok': False, 'code': 'scan_reply_invalid', 'completionConfirmed': False,
                    'retryAutomatically': False, 'coverage': 'unknown'}

    @staticmethod
    def _finite(value):
        try:
            return type(value) in (int, float) and math.isfinite(value)
        except OverflowError:
            return False

    def _merchant(self, action, entity_id, offer_index=None, quote=None, offset=0):
        _integer(entity_id, 1, 2147483647)
        _, actor_uuid = self.gateway._check_binding()
        actor_uuid = str(uuid.UUID(actor_uuid))
        command = f'qdtrade {action} {actor_uuid} {entity_id}'
        if action == 'trade':
            validate_world_action('trade', {'entity_id': entity_id, 'offer_index': offer_index, 'quote': quote})
            command += f' {offer_index} {quote}'
        elif action == 'offers':
            _integer(offset, 0, 19)
            command += f' {offset}'
        else:
            raise GatewayError('invalid_trade_action')
        raw = self.gateway.rcon.cmd(command)
        lines = [line for line in raw.splitlines() if line.startswith('QD_TRADE_JSON ')]
        if len(lines) != 1:
            raise GatewayError('outcome_unknown' if action == 'trade' else 'merchant_bridge_unavailable')
        try:
            reply = json.loads(lines[0][len('QD_TRADE_JSON '):])
            if (reply.get('schema') != 1 or reply.get('capability') != 'vanilla_merchant_v1'
                    or type(reply.get('ok')) is not bool or reply.get('actorUuid') != actor_uuid
                    or reply.get('entityId') != entity_id):
                raise ValueError('trade_receipt_mismatch')
            if reply.get('ok') is True:
                uuid.UUID(reply['merchantUuid'])
        except (TypeError, ValueError, KeyError):
            raise GatewayError('outcome_unknown' if action == 'trade' else 'merchant_bridge_unavailable')
        return reply

    def villager_offers(self, entity_id, offset=0):
        """Read nearby physical merchant quotes, never opens a GUI or buys items."""
        reply = self._merchant('offers', entity_id, offset=offset)
        if reply.get('ok') is True:
            if (reply.get('offset') != offset or not isinstance(reply.get('offers'), list)
                    or len(reply['offers']) > 4 or type(reply.get('nextOffset')) is not int
                    or not (reply['nextOffset'] == -1 or offset < reply['nextOffset'] <= 19)):
                raise GatewayError('merchant_offers_invalid')
            for row in reply['offers']:
                if not isinstance(row, dict):
                    raise GatewayError('merchant_offers_invalid')
                validate_world_action('trade', {'entity_id': entity_id, 'offer_index': row.get('index'), 'quote': row.get('quote')})
                if not offset <= row['index'] < min(offset + 4, 20):
                    raise GatewayError('merchant_offers_invalid')
                for key in ('costA', 'costB', 'result'):
                    self._price(row.get(key))
            if len({row['index'] for row in reply['offers']}) != len(reply['offers']):
                raise GatewayError('merchant_offers_invalid')
        return reply | {'observedAt': self.gateway._now(), 'retryAutomatically': False}

    @staticmethod
    def _price(value):
        if not isinstance(value, dict) or set(value) != {'id', 'count'}:
            raise GatewayError('merchant_price_invalid')
        _item(value['id'])
        _integer(value['count'], 0, 64)
        return value

    def _storage(self, point, before):
        block = self._block(point)
        allowed = STORAGE | set(self.gateway._settings().get('storageBlockIds', [])[:32])
        if block['block'] not in allowed:
            raise GatewayError('not_an_enabled_storage_block')
        if block['block'] == 'minecraft:chest' and block['properties'].get('type') != 'single':
            raise GatewayError('double_container_requires_full_authorization')
        record = self._owned().get(self._key(point, before['dimension']), {})
        if record.get('block') == block['block']:
            return block
        for site in self.gateway._settings().get('storageSites', [])[:64]:
            if isinstance(site, dict) and site.get('dimension') == before['dimension'] and all(site.get(k) == point[k] for k in ('x', 'y', 'z')):
                return block
        raise GatewayError('container_not_owned_or_authorized')

    def _top_face(self, support, before):
        # Both standing and crouched eye heights must hit the top face of the
        # support cube, so the click cannot silently place against a side face.
        position = before['position']
        for eye_height in (1.27, 1.62):
            eye_y = position['y'] + eye_height
            if eye_y <= support['y'] + 1:
                raise GatewayError('placement_top_face_unreachable')
            fraction = (eye_y - support['y'] - 1) / (eye_y - support['y'] - .5)
            for axis in ('x', 'z'):
                hit = position[axis] + fraction * (support[axis] + .5 - position[axis])
                if not support[axis] + .02 < hit < support[axis] + .98:
                    raise GatewayError('placement_top_face_unreachable')

    def prepare(self, tool, args, before):
        validate_world_action(tool, args)
        if before.get('ok') is not True or before.get('gameMode') != 'survival':
            raise GatewayError('survival_body_unavailable')
        plan = {'schema': 1, 'tool': tool, 'args': args, 'dimension': before['dimension'],
                'bodyUuid': before['bodyUuid'], 'preparedAt': self.gateway._now(),
                'countsBefore': before.get('counts', {}), 'expected': [], 'observations': []}
        if tool == 'trade':
            reply = self.villager_offers(args['entity_id'], args['offer_index'] // 4 * 4)
            if reply.get('ok') is not True:
                raise GatewayError(str(reply.get('code', 'merchant_unavailable')))
            matches = [offer for offer in reply['offers'] if offer['index'] == args['offer_index']]
            if len(matches) != 1 or matches[0]['quote'] != args['quote']:
                raise GatewayError('quote_changed')
            offer = matches[0]
            if offer.get('outOfStock') is not False:
                raise GatewayError('out_of_stock')
            costs = {}
            for key in ('costA', 'costB'):
                price = offer[key]
                costs[price['id']] = costs.get(price['id'], 0) + price['count']
            if any(before.get('counts', {}).get(item, 0) < count for item, count in costs.items()):
                raise GatewayError('trade_payment_not_carried')
            plan.update(offer=offer, merchantUuid=reply['merchantUuid'])
            return plan
        if tool == 'close_container':
            plan['guiBefore'] = self._menu()
            return plan
        point = _point(args)
        self._area(point, before)
        self._reach(point, before)
        block = self._block(point)
        plan['observations'].append(block)
        if tool in ('open_container', 'transfer_items'):
            self._storage(point, before)
            if tool == 'open_container':
                menu = self._menu()
                if menu['menu'] != 'InventoryMenu':
                    raise GatewayError('close_current_container_first')
                if menu.get('cursorEmpty') is not True:
                    raise GatewayError('container_cursor_not_empty')
                # Numen tries both hands. Shift+right-click with a block or pearl
                # can mutate the world instead of opening the authorized chest.
                for hand in ('mainhand', 'offhand'):
                    item = before.get('equipment', {}).get(hand, {}).get('item')
                    if item not in PASSIVE_HAND_ITEMS:
                        raise GatewayError('container_requires_empty_or_passive_hands')
            if tool == 'transfer_items':
                context = read_json(self.state / 'world-gui.json')
                if (context.get('bodyUuid') != before['bodyUuid'] or context.get('dimension') != before['dimension']
                        or context.get('point') != point or context.get('closed') is not False):
                    raise GatewayError('owned_container_not_open')
                needed = {row['from'] for row in args['moves']} | {row['to'] for row in args['moves'] if row['to'] is not None}
                gui = self._bound_menu(point, before, needed=needed)
                if any(gui.get(key) != context.get(key) for key in ('menu', 'containerId', 'epoch')):
                    raise GatewayError('physical_container_not_open')
                self._validate_moves(args['moves'], gui)
                plan['guiBefore'] = gui
            return plan
        if tool == 'sleep':
            if block['block'] not in {'minecraft:' + color + '_bed' for color in COLORS}:
                raise GatewayError('not_a_supported_bed')
            return plan
        self._area(point, before, construction=True)
        if tool == 'farm':
            operation, item = args['operation'], args['item_id']
            if operation == 'till':
                if item not in HOES or block['block'] not in SOIL:
                    raise GatewayError('invalid_tilling_target_or_tool')
                above = point | {'y': point['y'] + 1}
                self._area(above, before, construction=True)
                if self._block(above)['block'] not in AIR:
                    raise GatewayError('tilling_space_occupied')
                plan['expected'] = [point | {'block': 'minecraft:farmland'}]
                plan['aim'] = point
            elif operation == 'plant':
                if item not in CROPS or block['block'] not in AIR:
                    raise GatewayError('invalid_planting_target_or_seed')
                support = point | {'y': point['y'] - 1}
                self._area(support, before, construction=True)
                if self._block(support)['block'] != 'minecraft:farmland':
                    raise GatewayError('plant_requires_farmland')
                self._top_face(support, before)
                plan['aim'] = support
                plan['expected'] = [point | {'block': CROPS[item][0]}]
                plan['consumedItem'] = item
            else:
                max_age = CROP_AGES.get(block['block'])
                record = self._owned().get(self._key(point, before['dimension']), {})
                if max_age is None or str(block['properties'].get('age')) != str(max_age):
                    raise GatewayError('crop_not_mature')
                if record.get('block') != block['block']:
                    raise GatewayError('crop_not_owned')
                plan['aim'] = point
                plan['expected'] = [point | {'block': 'minecraft:air'}]
            if item is not None and before.get('counts', {}).get(item, 0) < 1:
                raise GatewayError('required_item_not_carried')
            if len(self._owned()) + len(plan['expected']) > 1200:
                raise GatewayError('ownership_ledger_full')
            return plan
        item = args['item_id']
        allowed = SAFE_BLOCKS | set(self.gateway._settings().get('constructionBlockIds', [])[:64])
        if item not in allowed:
            raise GatewayError('construction_item_not_enabled')
        if before.get('counts', {}).get(item, 0) < 1:
            raise GatewayError('required_item_not_carried')
        if block['block'] not in REPLACEABLE:
            raise GatewayError('existing_block_cannot_be_replaced')
        if item == 'minecraft:chest':
            for dx, dz in DIRECTIONS.values():
                neighbor = point | {'x': point['x'] + dx, 'z': point['z'] + dz}
                self._area(neighbor, before, construction=True)
                if self._block(neighbor)['block'] == 'minecraft:chest':
                    raise GatewayError('chest_would_merge_with_existing_container')
        support = point | {'y': point['y'] - 1}
        self._area(support, before, construction=True)
        support_block = self._block(support)
        if not support_block['isSolid']:
            raise GatewayError('placement_needs_solid_support')
        self._reach(support, before)
        self._top_face(support, before)
        plan['aim'], plan['consumedItem'] = support, item
        plan['expected'] = [point | {'block': item}]
        facing_index = math.floor((math.degrees(math.atan2(point['z'] + .5 - before['position']['z'],
            point['x'] + .5 - before['position']['x'])) - 90) / 90 + .5) % 4
        facing = ('south', 'west', 'north', 'east')[facing_index]
        if item.endswith('_bed'):
            dx, dz = DIRECTIONS[facing]
            second = point | {'x': point['x'] + dx, 'z': point['z'] + dz}
            plan['expected'][0]['properties'] = {'part': 'foot', 'facing': facing}
            plan['expected'].append(second | {'block': item, 'properties': {'part': 'head', 'facing': facing}})
            under_head = second | {'y': second['y'] - 1}
            self._area(under_head, before, construction=True)
            if not self._block(under_head)['isSolid']:
                raise GatewayError('bed_needs_two_supported_cells')
        elif item.endswith('_door') and not item.endswith('_trapdoor'):
            plan['expected'][0]['properties'] = {'half': 'lower'}
            plan['expected'].append(point | {'y': point['y'] + 1, 'block': item, 'properties': {'half': 'upper'}})
        for target in plan['expected']:
            self._area(target, before, construction=True)
            if self._block(target)['block'] not in REPLACEABLE:
                raise GatewayError('multiblock_space_occupied')
        if len(self._owned()) + len(plan['expected']) > 1200:
            raise GatewayError('ownership_ledger_full')
        return plan

    def _validate_moves(self, moves, gui):
        if not gui['cursorEmpty']:
            raise GatewayError('container_cursor_not_empty')
        directions = {}
        for move in moves:
            source = gui['slots'].get(move['from'])
            if source is None or source.get('itemId') != move['item_id'] or not 1 <= source['count'] <= 64:
                raise GatewayError('transfer_source_changed')
            if move['item_id'] in directions and directions[move['item_id']] != source['side']:
                raise GatewayError('transfer_direction_conflict')
            directions[move['item_id']] = source['side']
            if move['to'] is not None:
                target = gui['slots'].get(move['to'])
                if target is None or target['output'] or (target['count'] and target.get('itemId') != source['itemId']):
                    raise GatewayError('transfer_destination_unavailable')
                if move['count'] > source['count']:
                    raise GatewayError('transfer_insufficient_items')
                if source['side'] == target['side']:
                    raise GatewayError('transfer_must_cross_container_boundary')

    def _native(self, tool, args):
        reply = self.gateway._invoke(tool, args)
        if reply.get('success') is False:
            return reply
        if reply.get('success') is not True and reply.get('accepted') is not True:
            raise GatewayError('outcome_unknown')
        return reply

    def dispatch(self, plan):
        """Called once under the gateway lock; never repeats a mutation."""
        if not isinstance(plan, dict) or plan.get('schema') != 1:
            raise GatewayError('invalid_world_plan')
        tool, args = plan['tool'], plan['args']
        validate_world_action(tool, args)
        try:
            current = self.gateway.snapshot()
            if (current.get('ok') is not True or current.get('bodyUuid') != plan['bodyUuid']
                    or current.get('dimension') != plan['dimension'] or current.get('gameMode') != 'survival'):
                raise GatewayError('world_body_changed')
            # These operations are all read-only. A definite preflight failure
            # here must not leave a permanent uncertain-action lock.
            fresh = self.prepare(tool, args, current)
            if fresh.get('expected') != plan.get('expected'):
                raise GatewayError('world_target_changed')
        except (OSError, ValueError, TypeError, KeyError) as exc:
            return {'success': False, 'message': str(exc) if isinstance(exc, GatewayError) else 'world_preflight_unavailable',
                    'data': {'dispatched': False, 'retryAutomatically': False}}
        plan = fresh
        if tool == 'trade':
            reply = self._merchant('trade', args['entity_id'], args['offer_index'], args['quote'])
            if reply.get('code') == 'outcome_unknown':
                raise GatewayError('outcome_unknown')
            if reply.get('ok') is False:
                return {'success': False, 'message': reply.get('code', 'trade_rejected'), 'data': {'receipt': reply}}
            return self._verify_trade(plan, reply)
        if tool == 'close_container':
            reply = self._native('close_gui', {})
        elif tool == 'sleep':
            reply = self._native('sleep', _point(args))
            if reply.get('success') is True and reply.get('data', {}).get('sleeping') is True:
                return reply | {'data': reply.get('data', {}) | {'verified': True, 'async': False}}
            return reply if reply.get('success') is False else self._unconfirmed()
        elif tool == 'transfer_items':
            native_moves = [{k: row[k] for k in ('from', 'to', 'count') if row[k] is not None} for row in args['moves']]
            reply = self._native('transfer', {'moves': native_moves})
        else:
            aim = plan.get('aim', _point(args))
            right = not (tool == 'farm' and args['operation'] == 'harvest')
            native_args = {'button': 'right' if right else 'left', **aim, 'hold_ticks': 0}
            if args.get('item_id') is not None:
                native_args['item_id'] = args['item_id']
            reply = self._native('interact_at', native_args)
        if reply.get('success') is False:
            return reply
        for poll in range(self.max_polls):
            if poll:
                self.sleep(.25)
            evidence = self._evidence(plan)
            if evidence is not None:
                return {'success': True, 'message': 'Verified ordinary player interaction against current world state.',
                        'data': {'async': False, 'verified': True, 'evidence': evidence, 'nativeReceipt': reply}}
        return self._unconfirmed()

    def _verify_trade(self, plan, reply):
        try:
            receipt = reply['receipt']
            if (reply.get('code') != 'traded' or reply['merchantUuid'] != plan['merchantUuid']
                    or receipt['offerIndex'] != plan['args']['offer_index']
                    or receipt.get('inventoryVerified') is not True
                    or type(receipt['usesBefore']) is not int or receipt['usesAfter'] != receipt['usesBefore'] + 1):
                raise ValueError('trade_receipt_mismatch')
            if self._price(receipt['result']) != plan['offer']['result']:
                raise ValueError('trade_result_changed')
            delta = {}
            for key, sign in (('costA', -1), ('costB', -1), ('result', 1)):
                item = self._price(receipt[key])
                if key != 'result':
                    quoted = plan['offer'][key]
                    if item['id'] != quoted['id'] or item['count'] > quoted['count']:
                        raise ValueError('trade_price_increased')
                if item['count']:
                    delta[item['id']] = delta.get(item['id'], 0) + sign * item['count']
            before, after = receipt['inventoryBefore'], receipt['inventoryAfter']
            if not isinstance(before, dict) or not isinstance(after, dict) or len(before) > 64 or len(after) > 64:
                raise ValueError('trade_inventory_invalid')
            actual = {}
            for item in set(before) | set(after) | set(delta):
                _item(item)
                _integer(before.get(item, 0), 0, 2304)
                _integer(after.get(item, 0), 0, 2304)
                actual[item] = after.get(item, 0) - before.get(item, 0)
                if actual[item] != delta.get(item, 0):
                    raise ValueError('trade_inventory_mismatch')
        except (KeyError, TypeError, ValueError):
            raise GatewayError('outcome_unknown')
        return {'success': True, 'message': 'One native merchant transaction verified by uses and actual inventory.',
                'data': {'async': False, 'verified': True, 'receipt': reply,
                         'evidence': {'inventoryDelta': {item: count for item, count in actual.items() if count},
                                      'merchantUuid': plan['merchantUuid'], 'offerIndex': receipt['offerIndex']}}}

    @staticmethod
    def _unconfirmed():
        raise GatewayError('outcome_unknown')

    def _evidence(self, plan):
        tool, args = plan['tool'], plan['args']
        if tool in ('open_container', 'close_container', 'transfer_items'):
            gui = self._menu()
            if tool == 'close_container':
                if gui['menu'] != 'InventoryMenu' or gui.get('cursorEmpty') is not True:
                    return None
                write_json(self.state / 'world-gui.json', {'schema': 1, 'closed': True})
                return {'menu': 'InventoryMenu', 'closed': True}
            if (gui['menu'] in ('InventoryMenu', 'MerchantMenu') or gui.get('physicalBlockKnown') is not True
                    or gui.get('position') != _point(args) or gui.get('dimension') != plan['dimension']
                    or gui.get('stillValid') is not True):
                return None
            if tool == 'open_container':
                write_json(self.state / 'world-gui.json', {'schema': 1, 'bodyUuid': plan['bodyUuid'],
                    'dimension': plan['dimension'], 'point': _point(args), 'menu': gui['menu'],
                    'epoch': gui['epoch'], 'containerId': gui['containerId'], 'closed': False})
                return {'point': _point(args), 'gui': gui}
            if any(gui.get(key) != plan['guiBefore'].get(key) for key in ('menu', 'containerId', 'epoch')):
                return None
            body = self.gateway.snapshot()
            if body.get('ok') is not True:
                return None
            expected_delta = {}
            for move in args['moves']:
                source = plan['guiBefore']['slots'][move['from']]
                amount = source['count'] if move['to'] is None else move['count']
                sign = -1 if source['side'] == 'inventory' else 1
                expected_delta[move['item_id']] = expected_delta.get(move['item_id'], 0) + sign * amount
            actual = {item: body['counts'].get(item, 0) - plan['countsBefore'].get(item, 0) for item in expected_delta}
            if actual != expected_delta or not gui['cursorEmpty']:
                return None
            return {'inventoryDelta': actual, 'gui': gui, 'transfersConfirmed': True}
        blocks = [self._block(target) for target in plan['expected']]
        for expected, actual in zip(plan['expected'], blocks):
            if actual['block'] != expected['block'] or any(str(actual['properties'].get(k)) != str(v) for k, v in expected.get('properties', {}).items()):
                return None
        body = self.gateway.snapshot()
        if body.get('ok') is not True:
            return None
        delta = {item: body.get('counts', {}).get(item, 0) - plan['countsBefore'].get(item, 0)
                 for item in set(plan['countsBefore']) | set(body.get('counts', {}))
                 if body.get('counts', {}).get(item, 0) != plan['countsBefore'].get(item, 0)}
        item = plan.get('consumedItem')
        if item and delta.get(item) != -1:
            return None
        self._remember_blocks(plan, blocks)
        return {'blocks': blocks, 'inventoryDelta': delta,
                'itemsCollected': {item: value for item, value in delta.items() if value > 0},
                'notice': 'Crop removal proves harvesting; dropped items are owned only when inventory confirms collection.'}

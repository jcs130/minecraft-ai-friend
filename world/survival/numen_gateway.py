"""Bound, leased access to the existing server-side Numen actuator.

No navigation or crafting implementation lives here. Actions use exactly the
numen_act invoke contract used by sidecar/guard/mcp_numen.py. RCON framing follows
src/rcon.ts: match request IDs, authenticate explicitly, never replay a command.
"""
from contextlib import contextmanager
import json
import math
import os
from pathlib import Path
import re
import socket
import struct
import time
import uuid


TOOLS = ('goto', 'mine', 'craft', 'eat', 'equip_item', 'game_cast', 'game_learn',
         'place_block', 'farm', 'open_container', 'transfer_items', 'close_container', 'sleep', 'trade',
         'guild_claim', 'guild_release', 'guild_deliver')
WORLD_ACTIONS = ('place_block', 'farm', 'open_container', 'transfer_items', 'close_container', 'sleep', 'trade')
GUILD_ACTIONS = ('guild_claim', 'guild_release', 'guild_deliver')
IDENTIFIER = re.compile(r'[a-z0-9_.-]+:[a-z0-9_./-]+\Z')
TURN_ID = re.compile(r'[A-Za-z0-9_-]{16,128}\Z')
SLOTS = ('mainhand', 'offhand', 'head', 'chest', 'legs', 'feet')


class GatewayError(ValueError):
    pass


def read_json(path):
    path = Path(path)
    if path.is_symlink() or path.stat().st_size > 262144:
        raise GatewayError('invalid_state_file')
    value = json.loads(path.read_text(encoding='utf-8-sig'))
    if not isinstance(value, dict):
        raise GatewayError('invalid_state_file')
    return value


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        with temp.open('x', encoding='utf-8') as stream:
            json.dump(value, stream, ensure_ascii=False, allow_nan=False)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


@contextmanager
def action_lock(state, blocking=False):
    """One interprocess lock shared by driver and every MCP worker."""
    state = Path(state)
    state.mkdir(parents=True, exist_ok=True)
    with (state / 'action.lock').open('a+b') as stream:
        if os.name == 'nt':  # Isolated Windows unit tests; deployment uses flock.
            import msvcrt
            if stream.tell() == 0:
                stream.write(b'0')
                stream.flush()
            stream.seek(0)
            try:
                msvcrt.locking(stream.fileno(), msvcrt.LK_LOCK if blocking else msvcrt.LK_NBLCK, 1)
            except OSError as exc:
                raise GatewayError('action_busy') from exc
        else:
            import fcntl
            try:
                fcntl.flock(stream, fcntl.LOCK_EX | (0 if blocking else fcntl.LOCK_NB))
            except BlockingIOError as exc:
                raise GatewayError('action_busy') from exc
        try:
            yield
        finally:
            if os.name == 'nt':
                stream.seek(0)
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(stream, fcntl.LOCK_UN)


class RconClient:
    """Single-command adaptation of the project's request-ID matched RCON.

    Each call has a fresh connection. A dropped response is uncertain, never an
    excuse to retry a mutation. Secrets and raw exceptions are never returned.
    """
    def __init__(self, host=None, port=None, secret=None, timeout=8):
        self.host = host or os.environ.get('MC_RCON_HOST', 'mc')
        self.port = int(port or os.environ.get('MC_RCON_PORT', '25575'))
        self.secret = Path(secret or os.environ.get('MC_RCON_SECRET', '/run/secrets/rcon'))
        self.timeout = timeout

    @staticmethod
    def _packet(request_id, kind, payload):
        value = payload.encode('utf-8')
        return struct.pack('<iii', len(value) + 10, request_id, kind) + value + b'\0\0'

    @staticmethod
    def _exact(stream, size):
        data = b''
        while len(data) < size:
            part = stream.recv(size - len(data))
            if not part:
                raise ConnectionError('rcon_closed')
            data += part
        return data

    @classmethod
    def _receive(cls, stream):
        size, = struct.unpack('<i', cls._exact(stream, 4))
        if not 10 <= size <= 1048576:
            raise ConnectionError('rcon_invalid_frame')
        data = cls._exact(stream, size)
        if data[-2:] != b'\0\0':
            raise ConnectionError('rcon_invalid_frame')
        request_id, kind = struct.unpack('<ii', data[:8])
        return request_id, kind, data[8:-2].decode('utf-8', 'strict')

    def cmd(self, command):
        if len(command.encode('utf-8')) > 1446 or any(c in command for c in '\r\n\0'):
            raise GatewayError('rcon_invalid_command')
        password = self.secret.read_text(encoding='utf-8-sig').strip()
        with socket.create_connection((self.host, self.port), timeout=self.timeout) as stream:
            stream.settimeout(self.timeout)
            stream.sendall(self._packet(1, 3, password))
            for _ in range(8):
                rid, kind, _ = self._receive(stream)
                if rid == -1:
                    raise ConnectionError('rcon_auth_failed')
                if (rid, kind) == (1, 2):
                    break
            else:
                raise ConnectionError('rcon_auth_response_missing')
            stream.sendall(self._packet(2, 2, command))
            for _ in range(16):
                rid, kind, response = self._receive(stream)
                if (rid, kind) == (2, 0):
                    return response
            raise ConnectionError('rcon_response_missing')


def inventory_from_snbt(response):
    """Retain item IDs/counts and a short skill-book tag, never book contents."""
    import nbtlib
    start = response.find('[')
    if start < 0:
        raise GatewayError('inventory_unavailable')
    value = nbtlib.parse_nbt(response[start:])
    if not isinstance(value, nbtlib.List) or len(value) > 64:
        raise GatewayError('inventory_invalid')
    items, counts = [], {}
    for row in value:
        item_id = str(row.get('id', ''))
        count = int(row.get('count', row.get('Count', 0)))
        slot = int(row.get('Slot', -1))
        if not IDENTIFIER.fullmatch(item_id) or not 1 <= count <= 2147483647:
            raise GatewayError('inventory_invalid')
        item = {'id': item_id, 'count': count, 'slot': slot}
        if item_id == 'minecraft:written_book':
            components = row.get('components', {})
            custom = components.get('minecraft:custom_data', {}) if isinstance(components, dict) else {}
            label = custom.get('skillbook') if isinstance(custom, dict) else None
            if isinstance(label, str) and 1 <= len(label) <= 64 and not any(ord(c) < 32 for c in label):
                item['bookName'] = str(label)
        items.append(item)
        counts[item_id] = counts.get(item_id, 0) + count
    return items, counts


class NumenGateway:
    def __init__(self, state_dir=Path('/state/survival'), rcon=None, clock=time.time):
        self.state = Path(state_dir)
        self.rcon = rcon or RconClient()
        self.clock = clock

    def _now(self):
        return int(self.clock() * 1000)

    def _settings(self):
        settings = read_json(self.state / 'settings.json')
        if not isinstance(settings.get('bodyName'), str) or not re.fullmatch(r'[A-Za-z0-9_]{1,16}', settings['bodyName']):
            raise GatewayError('body_binding_invalid')
        return settings

    def _check_binding(self):
        settings = self._settings()
        body = settings['bodyName']
        expected_uuid = settings.get('bodyUuid')
        if expected_uuid is not None and str(uuid.UUID(expected_uuid)) != expected_uuid:
            raise GatewayError('body_binding_invalid')
        roster = self.rcon.cmd('numen_act list')
        lines = [line.strip() for line in roster.splitlines() if line.strip()]
        if (not lines or not re.fullmatch(r'count=\d{1,3}', lines[0])
                or int(lines[0][6:]) > 64 or len(lines) != int(lines[0][6:]) + 1
                or any(not re.match(r'[A-Za-z0-9_]{1,16}\|uuid=[0-9a-f-]{36}(?:\||$)', line)
                       for line in lines[1:])):
            raise GatewayError('body_roster_unavailable')
        matches = [line for line in lines[1:] if line.startswith(body + '|uuid=')]
        if not matches:
            if expected_uuid and any('|uuid=' + expected_uuid + '|' in line + '|' for line in lines[1:]):
                raise GatewayError('body_uuid_mismatch')
            raise GatewayError('body_offline')
        if len(matches) != 1:
            raise GatewayError('body_roster_ambiguous')
        actual = matches[0].split('|uuid=', 1)[1].split('|', 1)[0]
        if expected_uuid is not None and actual != expected_uuid:
            raise GatewayError('body_uuid_mismatch')
        return body, actual

    def _invoke(self, tool, args=None):
        if tool in GUILD_ACTIONS:
            from guild import Guild
            return Guild(self).dispatch(tool, args)
        if tool in ('game_cast', 'game_learn'):
            from game_skills import GameSkills
            return GameSkills(self).dispatch(tool, args)
        if tool == 'goto':
            args = dict(args or {}, walk_only=True)
        # Same body/tool/JSON interface as the existing guard MCP, never raw model commands.
        body = self._settings()['bodyName']
        raw = self.rcon.cmd(f'numen_act invoke "{body}" {tool} ' + json.dumps(args or {}, ensure_ascii=True))
        if raw.startswith('no companion:'):
            raise GatewayError('body_offline')
        try:
            result = json.loads(raw)
        except (ValueError, TypeError):
            raise GatewayError('numen_reply_invalid')
        if not isinstance(result, dict):
            raise GatewayError('numen_reply_invalid')
        return result

    def snapshot(self):
        now = self._now()
        body = None
        stage = 'binding'
        try:
            body, body_uuid = self._check_binding()
            stage = 'task_status'
            task = self._invoke('task_status')
            # Read busy first. If navigation finishes between these reads we
            # wait one more tick, rather than consume an idle body with an old
            # terminal receipt and lose the real outcome permanently.
            stage = 'self_status'
            status = self._invoke('get_self_status')
            if (status.get('name') != body or task.get('success') is not True
                    or not all(self._number(status.get(k)) for k in ('hp', 'max_hp', 'hunger'))):
                raise GatewayError('body_status_invalid')
            pos = status.get('position', {})
            if not all(self._number(pos.get(k)) for k in ('x', 'y', 'z')):
                raise GatewayError('body_status_invalid')
            stage = 'inventory'
            inventory, counts = inventory_from_snbt(self.rcon.cmd(f'data get entity {body} Inventory'))
            from game_skills import cached_game_skills, owned_skill_books
            tagged_books = [item for item in inventory if 'bookName' in item]
            skill_books = tagged_books[:12]
            owned_books = owned_skill_books(skill_books, cached_game_skills(self.state, now))
            data = task.get('data', {})
            task_info = {k: data[k] for k in ('task_id', 'task', 'state', 'elapsed_s', 'budget_left_s') if k in data}
            task_info.update(busy=bool(data.get('task_id')), completionConfirmed=False)
            return {'schema': 1, 'ok': True, 'online': True, 'bodyName': body, 'bodyUuid': body_uuid, 'observedAt': now,
                    'hp': status.get('hp'), 'maxHp': status.get('max_hp'), 'hunger': status.get('hunger'),
                    'position': pos, 'dimension': status.get('dimension'), 'gameMode': status.get('game_mode'),
                    'equipment': status.get('equipment', {}), 'inventory': inventory, 'counts': counts,
                    'skillBooks': skill_books, 'ownedSkillBooks': owned_books,
                    'skillBooksTruncated': len(tagged_books) > 12,
                    'task': task_info, 'air': status.get('air'), 'inWater': status.get('in_water'),
                    'inLava': status.get('in_lava'), 'boundaryEnforcement': 'preflight',
                    'saturation': status.get('saturation') if self._number(status.get('saturation')) else None,
                    'onGround': status.get('on_ground') if type(status.get('on_ground')) is bool else None,
                    'biome': status.get('biome', '')[:100] if isinstance(status.get('biome'), str) else None,
                    'structures': [name[:100] for name in status.get('structures', [])[:16]
                                   if isinstance(name, str)] if isinstance(status.get('structures'), list) else [],
                    'navigationModes': [mode[:40] for mode in status.get('navigation_modes', [])[:4]
                                        if isinstance(mode, str)],
                    'navigationEpoch': status.get('navigation_epoch') if isinstance(status.get('navigation_epoch'), str) else None,
                    'navigationResult': self._navigation_result(status.get('last_navigation_result')),
                    'notice': 'Idle is not a completion receipt. Numen navigation is not geofenced.'}
        except (OSError, ValueError, TypeError, KeyError, ImportError) as error:
            missing = isinstance(error, GatewayError) and str(error) == 'body_offline'
            return {'schema': 1, 'ok': False, 'online': False if missing else None, 'bodyName': body,
                    'observedAt': now, 'code': 'body_offline' if missing else 'observation_unavailable',
                    'errorType': type(error).__name__, 'observationStage': stage}

    def observe(self, radius=8):
        try:
            self._integer(radius, 4, 12)
            body, _ = self._check_binding()
            terrain = self.rcon.cmd(f'numen_act invoke "{body}" look_around ' + json.dumps({'radius': radius}))
            if terrain.startswith('no companion:'):
                raise GatewayError('body_offline')
            entities = self._invoke('scan_nearby_entities', {'radius': radius, 'type_filter': 'all'})
            # Native all-scan truncates at 20 nearest entities. Keep a separate
            # hostile scan so a crowd of villagers cannot hide nearby enemies.
            hostiles = self._invoke('scan_nearby_entities', {'radius': radius, 'type_filter': 'hostile'})
            world = self._invoke('get_world_info')
            conditions = {k: world[k][:100] for k in ('dimension', 'weather') if isinstance(world.get(k), str)}
            conditions.update({k: world[k] for k in ('game_time',) if self._number(world.get(k))})
            conditions.update({k: world[k] for k in ('is_bright_outside', 'is_dark_outside')
                               if type(world.get(k)) is bool})
            return {'ok': True, 'observedAt': self._now(), 'terrain': terrain[:6000],
                    'entities': self._observed_entities(entities.get('entities'), 20),
                    'hostiles': self._observed_entities(hostiles.get('entities'), 8),
                    'entitiesTruncated': entities.get('truncated') is True,
                    'hostilesTruncated': hostiles.get('truncated') is True or len(hostiles.get('entities', [])) > 8,
                    'world': conditions, 'radius': radius,
                    'limits': {'unloadedChunks': False, 'allKnowing': False,
                               'notice': 'Native local scans may include occluded entities. Structure membership is not an explored entrance; block map is a spatial summary, not every block or mod mechanic.'}}
        except (OSError, ValueError, TypeError):
            return {'ok': False, 'code': 'observation_unavailable'}

    @classmethod
    def _observed_entities(cls, values, maximum):
        result = []
        for row in values[:maximum] if isinstance(values, list) else []:
            if not isinstance(row, dict):
                continue
            item = {k: row[k][:100] for k in ('type', 'category') if isinstance(row.get(k), str)}
            item.update({k: row[k] for k in ('id', 'distance', 'hp', 'max_hp') if cls._number(row.get(k))})
            position = row.get('position', {})
            if isinstance(position, dict) and all(cls._number(position.get(k)) for k in ('x', 'y', 'z')):
                item['position'] = {k: position[k] for k in ('x', 'y', 'z')}
            result.append(item)
        return result

    @classmethod
    def _navigation_result(cls, raw):
        if not isinstance(raw, dict):
            return None
        if (raw.get('state') not in ('success', 'failed', 'timeout', 'cancelled')
                or type(raw.get('success')) is not bool):
            return None
        result = {k: raw[k][:400] for k in ('task_id', 'navigation_epoch', 'state', 'navigation_mode', 'reason')
                  if isinstance(raw.get(k), str)}
        result.update({k: raw[k] for k in ('final_x', 'final_y', 'final_z', 'ground_y', 'finished_at')
                       if cls._number(raw.get(k))})
        result.update(success=raw['success'], world_interaction_blocked=raw.get('world_interaction_blocked') is True)
        return result

    def _enabled(self):
        control = read_json(self.state / 'control.json')
        if control.get('schema') != 1 or control.get('enabled') is not True:
            raise GatewayError('autonomy_disabled')

    def open_lease(self, turn_id, expires_at, action_limit=1):
        with action_lock(self.state):
            self._enabled()
            if not isinstance(turn_id, str) or not TURN_ID.fullmatch(turn_id):
                raise GatewayError('invalid_turn_id')
            if not self._number(expires_at) or not self._now() < expires_at <= self._now() + 600000:
                raise GatewayError('invalid_lease_expiry')
            if (self.state / 'unknown.json').exists():
                raise GatewayError('outcome_unknown')
            if (self.state / 'inflight-action.json').exists():
                raise GatewayError('body_action_in_flight')
            if type(action_limit) is not int or action_limit not in (1, 6):
                raise GatewayError('invalid_action_limit')
            old = read_json(self.state / 'lease.json') if (self.state / 'lease.json').exists() else {}
            if ((self.state / 'turn-actions' / (turn_id + '.json')).exists()
                    or old.get('turnId') == turn_id
                    or (old.get('status') in ('open', 'reserved') and old.get('expiresAt', 0) > self._now())):
                raise GatewayError('lease_already_exists')
            lease = {'schema': 1, 'turnId': turn_id, 'expiresAt': int(expires_at), 'actionLimit': action_limit,
                     'actionsUsed': 0, 'status': 'open'}
            write_json(self.state / 'lease.json', lease)
            return lease

    def close_lease(self, blocking=False):
        with action_lock(self.state, blocking=blocking):
            path = self.state / 'lease.json'
            if not path.exists():
                return {'ok': True, 'code': 'lease_absent'}
            lease = read_json(path)
            if lease.get('status') != 'unknown':
                lease['status'] = 'closed'
            write_json(path, lease)
            return {'ok': True, 'code': 'lease_closed', 'status': lease['status']}

    @staticmethod
    def _number(value):
        return type(value) in (int, float) and math.isfinite(value)

    @classmethod
    def _integer(cls, value, low, high):
        if type(value) is not int or not low <= value <= high:
            raise GatewayError('invalid_argument')

    @staticmethod
    def _item(value):
        if not isinstance(value, str) or len(value) > 100 or not IDENTIFIER.fullmatch(value):
            raise GatewayError('invalid_item_id')

    def _validate(self, tool, args):
        if tool not in TOOLS or not isinstance(args, dict):
            raise GatewayError('tool_not_allowed')
        if tool in WORLD_ACTIONS:
            from world_actions import validate_world_action
            validate_world_action(tool, args)
            return
        if tool in GUILD_ACTIONS:
            from guild import validate_guild_action
            validate_guild_action(tool, args)
            return
        if tool in ('game_cast', 'game_learn'):
            from game_skills import validate_game_action
            validate_game_action(tool, args)
            return
        if tool == 'goto':
            if (not {'x', 'z'} <= set(args) <= {'x', 'y', 'z'}
                    or not all(self._number(args[k]) for k in ('x', 'z'))
                    or ('y' in args and (not self._number(args['y']) or not -64 <= args['y'] <= 319))):
                raise GatewayError('invalid_move')
        elif tool == 'mine':
            if set(args) != {'block_ids', 'count'} or not isinstance(args['block_ids'], list) or not 1 <= len(args['block_ids']) <= 8:
                raise GatewayError('invalid_mine')
            for item in args['block_ids']:
                self._item(item)
            self._integer(args['count'], 1, 8)
        elif tool == 'craft':
            if set(args) != {'item_id', 'count'}:
                raise GatewayError('invalid_craft')
            self._item(args['item_id'])
            self._integer(args['count'], 1, 16)
        elif tool == 'eat':
            if set(args) != {'item_id'}:
                raise GatewayError('invalid_eat')
            self._item(args['item_id'])
        elif tool == 'equip_item':
            if set(args) != {'item_id', 'action', 'slot'} or args['action'] != 'equip' or args['slot'] not in SLOTS:
                raise GatewayError('invalid_equip')
            self._item(args['item_id'])

    def _area(self, point, margin=0, protect=True):
        settings = self._settings()
        area = settings.get('workArea', {})
        if not all(self._number(area.get(k)) for k in ('minX', 'maxX', 'minZ', 'maxZ')):
            raise GatewayError('work_area_missing')
        if not (area['minX'] + margin <= point['x'] <= area['maxX'] - margin
                and area['minZ'] + margin <= point['z'] <= area['maxZ'] - margin):
            raise GatewayError('outside_work_area')
        anchor = settings.get('anchor', {})
        protected = settings.get('protectedRadius')
        if not self._number(protected) or protected < 0 or not all(self._number(anchor.get(k)) for k in ('x', 'z')):
            raise GatewayError('anchor_missing')
        if protect and math.hypot(point['x'] - anchor['x'], point['z'] - anchor['z']) <= protected + margin:
            raise GatewayError('protected_area')

    def _record(self, row):
        with (self.state / 'actions.jsonl').open('a', encoding='utf-8') as stream:
            stream.write(json.dumps(row, ensure_ascii=False, allow_nan=False) + '\n')
            stream.flush()
            os.fsync(stream.fileno())

    @staticmethod
    def _action_snapshot(body):
        return {k: body[k] for k in ('ok', 'bodyUuid', 'position', 'dimension', 'counts', 'hp',
                'hunger', 'task', 'navigationEpoch', 'navigationResult', 'observedAt') if k in body}

    def _save_receipt(self, receipt):
        write_json(self.state / 'action-receipts' / (receipt['actionId'] + '.json'), receipt)
        write_json(self.state / 'last-action.json', {'schema': 1, 'actionId': receipt['actionId']})

    def turn_receipts(self, turn_id):
        if not isinstance(turn_id, str) or not TURN_ID.fullmatch(turn_id):
            raise GatewayError('invalid_turn_id')
        index = self.state / 'turn-actions' / (turn_id + '.json')
        if not index.exists():
            return []
        result = []
        for action_id in read_json(index).get('actionIds', [])[:6]:
            if not isinstance(action_id, str) or not re.fullmatch(r'[0-9a-f]{32}', action_id):
                raise GatewayError('invalid_action_id')
            path = self.state / 'action-receipts' / (action_id + '.json')
            if path.exists():
                result.append(read_json(path))
        return result

    def _settle_inflight(self, body):
        """Called under the shared mutex. Idle releases execution, never proves success."""
        path = self.state / 'inflight-action.json'
        if not path.exists():
            return None
        receipt = read_json(path)
        if receipt.get('status') != 'in_flight':
            return receipt
        before = receipt['before']
        if (body.get('ok') is not True or body.get('bodyUuid') != before.get('bodyUuid')
                or body.get('dimension') != before.get('dimension')):
            raise GatewayError('inflight_body_unavailable')
        if (before.get('navigationEpoch') and body.get('navigationEpoch') != before['navigationEpoch']):
            raise GatewayError('inflight_epoch_changed')
        task = body.get('task', {})
        if task.get('busy'):
            if task.get('task_id') != receipt.get('nativeTaskId'):
                raise GatewayError('inflight_task_mismatch')
            return receipt
        outcome = None
        if receipt['tool'] == 'goto':
            candidate = body.get('navigationResult') or {}
            if (not receipt.get('nativeTaskId') or not before.get('navigationEpoch')
                    or candidate.get('task_id') != receipt['nativeTaskId']
                    or candidate.get('navigation_epoch') != before['navigationEpoch']):
                raise GatewayError('navigation_terminal_unconfirmed')
            outcome = candidate
        receipt.update(status=('completed' if outcome.get('success') else 'failed') if outcome else 'observed_ended',
                       after=self._action_snapshot(body), observedAt=self._now(),
                       completionConfirmed=outcome is not None, navigationOutcome=outcome,
                       notice='Idle proves no action is in flight; it does not prove the requested result.')
        self._save_receipt(receipt)
        self._record({**receipt, 'phase': 'observation'})
        path.unlink()
        return receipt

    def action_status(self, body=None):
        """Read-only world observation; reconcile our local receipt without replaying an action."""
        try:
            with action_lock(self.state):
                receipt = self._settle_inflight(body or self.snapshot())
                if receipt is None and (self.state / 'last-action.json').exists():
                    action_id = read_json(self.state / 'last-action.json').get('actionId')
                    if not isinstance(action_id, str) or not re.fullmatch(r'[0-9a-f]{32}', action_id):
                        raise GatewayError('invalid_action_id')
                    receipt = read_json(self.state / 'action-receipts' / (action_id + '.json'))
                if (self.state / 'unknown.json').exists():
                    return {'ok': False, 'inFlight': True, 'receipt': receipt, 'code': 'outcome_unknown'}
                return {'ok': True, 'inFlight': bool(receipt and receipt.get('status') == 'in_flight'),
                        'receipt': receipt}
        except GatewayError as exc:
            return {'ok': False, 'inFlight': True, 'code': str(exc)}

    def _confirm_equipment(self, args):
        # equip_item occupies Numen's syncSlot, which task_status cannot see.
        # Read the actual equipment after ticks advance; never resend the action.
        for _ in range(10):
            time.sleep(0.5)
            status = self._invoke('get_self_status')
            if status.get('equipment', {}).get(args['slot'], {}).get('item') == args['item_id']:
                return {'success': True, 'message': 'Equipment verified on the actual body.',
                        'data': {'verifiedEquipment': args['item_id'], 'slot': args['slot']}}
        raise GatewayError('outcome_unknown')

    def action(self, turn_id, tool, args):
        try:
            self._validate(tool, args)
            with action_lock(self.state):
                self._enabled()
                lease = read_json(self.state / 'lease.json')
                if (not isinstance(turn_id, str) or not TURN_ID.fullmatch(turn_id) or lease.get('turnId') != turn_id
                        or lease.get('schema') != 1 or lease.get('status') != 'open'
                        or lease.get('expiresAt', 0) <= self._now()):
                    raise GatewayError('lease_invalid')
                if (self.state / 'unknown.json').exists():
                    raise GatewayError('outcome_unknown')
                if (type(lease.get('actionLimit')) is not int or lease['actionLimit'] not in (1, 6)
                        or type(lease.get('actionsUsed')) is not int
                        or not 0 <= lease['actionsUsed'] < lease['actionLimit']):
                    raise GatewayError('action_limit_reached')
                before = self.snapshot()
                pending = self._settle_inflight(before)
                if pending and pending.get('status') == 'in_flight':
                    raise GatewayError('body_action_in_flight')
                if before.get('ok') is not True or before.get('gameMode') != 'survival':
                    raise GatewayError('survival_body_unavailable')
                if before['task']['busy']:
                    raise GatewayError('body_busy')
                if before.get('dimension') != self._settings().get('dimension', 'minecraft:overworld'):
                    raise GatewayError('wrong_dimension')
                if tool == 'goto' and 'walk_only_strict_arrival_v2' not in before.get('navigationModes', []):
                    raise GatewayError('safe_navigation_unavailable')
                # Verified walk-only navigation may cross town; mining may not.
                protected = tool == 'mine'
                if tool in ('game_cast', 'game_learn'):
                    from game_skills import is_protected_action
                    protected = is_protected_action(tool, args)
                self._area(before['position'], 16 if tool == 'mine' else 0, protect=protected)
                if tool == 'goto':
                    self._area(args, protect=False)
                    if math.hypot(args['x'] - before['position']['x'], args['z'] - before['position']['z']) > 24:
                        raise GatewayError('walk_target_too_far')
                if tool in ('game_cast', 'game_learn'):
                    from game_skills import preflight_game_action
                    preflight_game_action(self, before, tool, args)
                plan = None
                if tool in WORLD_ACTIONS:
                    from world_actions import WorldActions
                    plan = WorldActions(self).prepare(tool, args, before)
                if tool in GUILD_ACTIONS:
                    from guild import prepare_guild_action
                    prepare_guild_action(self, before, tool, args)
                self._enabled()  # stop while read-only preflight was running
                if lease['expiresAt'] <= self._now():
                    raise GatewayError('lease_expired')
                action_id = uuid.uuid4().hex
                lease.update(actionsUsed=lease['actionsUsed'] + 1, actionId=action_id, status='reserved')
                write_json(self.state / 'lease.json', lease)
                # A process can die after sending but before recording the reply. Persist
                # uncertainty first; only a definite response clears it.
                marker = {'schema': 1, 'actionId': action_id, 'turnId': turn_id, 'tool': tool,
                          'args': args, 'acceptedAt': self._now(), 'result': 'unknown',
                          'before': self._action_snapshot(before)}
                write_json(self.state / 'unknown.json', marker)
                index = self.state / 'turn-actions' / (turn_id + '.json')
                ids = read_json(index).get('actionIds', []) if index.exists() else []
                write_json(index, {'schema': 1, 'turnId': turn_id, 'actionIds': ids + [action_id]})
                self._save_receipt({**marker, 'schema': 2, 'status': 'unknown', 'completionConfirmed': False})
                self._record({**marker, 'phase': 'dispatching'})
                try:
                    reply = WorldActions(self).dispatch(plan) if tool in WORLD_ACTIONS else self._invoke(tool, args)
                    if tool == 'equip_item' and reply.get('accepted') is True:
                        reply = self._confirm_equipment(args)
                    if reply.get('success') is True:
                        result = {'ok': True, 'code': 'accepted' if reply.get('data', {}).get('async') else 'executed',
                                  'actionId': action_id, 'tool': tool, 'result': reply,
                                  'completionConfirmed': not reply.get('data', {}).get('async', False)}
                    elif reply.get('success') is False:
                        result = {'ok': False, 'code': 'action_rejected', 'actionId': action_id, 'result': reply}
                    else:
                        raise GatewayError('outcome_unknown')
                    receipt = {**marker, 'schema': 2, 'result': result,
                               'status': 'completed' if result.get('completionConfirmed') else 'rejected',
                               'completionConfirmed': result.get('completionConfirmed') is True}
                    if result.get('ok') and not result.get('completionConfirmed'):
                        task_id = reply.get('data', {}).get('task_id')
                        if tool == 'game_cast' and not task_id:
                            # The spell bridge acknowledges casting, but exposes
                            # no Numen task terminal. Preserve that honest receipt
                            # and stop continuous actions for this work interval.
                            receipt.update(status='effect_unconfirmed',
                                notice='Casting began; no effect-completion API is available. End this work interval.')
                            lease['actionsUsed'] = lease['actionLimit']
                        elif not isinstance(task_id, str) or not task_id:
                            raise GatewayError('async_task_id_missing')
                        else:
                            receipt.update(status='in_flight', nativeTaskId=task_id)
                            write_json(self.state / 'inflight-action.json', receipt)
                    else:
                        # The response is known. Snapshot failure cannot turn it into
                        # a success assertion or justify sending the action again.
                        receipt.update(after=self._action_snapshot(self.snapshot()), observedAt=self._now())
                    self._save_receipt(receipt)
                    self._record({**marker, 'phase': 'response', 'result': result, 'finishedAt': self._now()})
                    (self.state / 'unknown.json').unlink()
                    lease['status'] = 'open' if lease['actionsUsed'] < lease['actionLimit'] else 'used'
                    write_json(self.state / 'lease.json', lease)
                    result['receipt'] = {k: receipt[k] for k in ('status', 'before', 'after', 'nativeTaskId') if k in receipt}
                    return result
                except (OSError, ValueError, TypeError, KeyError):
                    lease['status'] = 'unknown'
                    write_json(self.state / 'lease.json', lease)
                    result = {'ok': False, 'code': 'outcome_unknown', 'actionId': action_id,
                              'notice': 'Do not resend. Inspect body and ask the operator to reconcile.'}
                    self._record({**marker, 'phase': 'response', 'result': result, 'finishedAt': self._now()})
                    return result
        except GatewayError as exc:
            return {'ok': False, 'code': str(exc)}
        except (OSError, ValueError, TypeError, KeyError):
            return {'ok': False, 'code': 'gateway_unavailable'}

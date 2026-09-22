"""Bound, leased access to the existing server-side Numen actuator.

No navigation or crafting implementation lives here. Actions use exactly the
numen_act invoke contract used by sidecar/guard/mcp_numen.py. RCON framing follows
src/rcon.ts: match request IDs, authenticate explicitly, never replay a command.
"""
import base64
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
         'guild_claim', 'guild_release', 'guild_deliver', 'interact_at')
DIRECT_ACTIONS = ('drop_items',)  # Excluded from the existing executable-skill kernel.
WORLD_ACTIONS = ('place_block', 'farm', 'open_container', 'transfer_items', 'close_container', 'sleep', 'trade', 'interact_at')
GUILD_ACTIONS = ('guild_claim', 'guild_release', 'guild_deliver')
IDENTIFIER = re.compile(r'[a-z0-9_.-]+:[a-z0-9_./-]+\Z')
TURN_ID = re.compile(r'[A-Za-z0-9_-]{16,128}\Z')
SLOTS = ('mainhand', 'offhand', 'head', 'chest', 'legs', 'feet')
# Cap the on-disk receipt archive so the directory (and the survivor's
# per-tick pattern scan over it) does not grow without bound.
MAX_ACTION_RECEIPTS = 200


class GatewayError(ValueError):
    pass


def invalid_lease_response():
    """Pre-operation rejection only; never read or disclose a capability ID."""
    return {'ok': False, 'code': 'lease_invalid', 'dispatched': False,
            'writePerformed': False, 'retryAutomatically': False,
            'instruction': '本次操作因租约无效未执行、未写入。需要 turn_id 的工具只能原样复制最新生活输入中的 turn_id；'
                '不要使用 mem-编号、task/t任务编号，也不要生成、截短或补全编号。'
                '找不到正确的原编号时，直接给出最终答复说明无法继续，并等待下一次生活输入；'
                '不要继续猜测或自动重试。若编号已经原样复制仍被拒绝，也应结束本轮等待；'
                '关闭、过期或受保护的租约不能复用，本回执不会延长或恢复授权。'}


def receipt_evidence(row):
    """Carry the last attempt's actual target/reason, without its full inventory.

    Single source of truth for the agent-facing reduction of a stored receipt.
    The full ``before``/``after`` body snapshots and raw native ``result`` are
    dropped: the current status snapshot is already this turn's authoritative
    observation, so re-sending them every turn only inflates the prompt.
    """
    def asdict(value):
        return value if isinstance(value, dict) else {}
    def fields(value, names):
        return {key: item for key, item in asdict(value).items()
                if key in names and type(item) in (str, int, float, bool, type(None))}
    def point(value):
        return fields(value, ('x', 'y', 'z'))
    row = asdict(row)
    summary = {key: row.get(key) for key in ('actionId', 'tool', 'status',
        'completionConfirmed', 'nativeTaskId', 'navigationOutcome', 'observedAt')}
    args = asdict(row.get('args'))
    summary['requested'] = fields(args, ('x', 'y', 'z', 'item_id', 'operation', 'skill_id', 'quest_id'))
    result = asdict(row.get('result'))
    native = asdict(result.get('result'))
    reason = native.get('message') or result.get('code')
    if isinstance(reason, str):
        summary['outcomeDetail'] = reason[:360]
    contract = asdict(asdict(native.get('data')).get('receipt'))
    if (row.get('tool') in GUILD_ACTIONS and isinstance(args.get('quest_id'), str)
            and contract.get('questId') == args['quest_id']):
        summary['guild'] = fields(contract, ('code', 'questId', 'ok'))
        context = asdict(contract.get('claimContext'))
        if context:
            reception, proximity = asdict(context.get('receptionist')), asdict(context.get('proximity'))
            target = fields(reception, ('key', 'dimension', 'positionFresh'))
            position = reception.get('position')
            if (isinstance(position, (list, tuple)) and len(position) == 3
                    and all(type(n) in (int, float) and math.isfinite(n) for n in position)):
                target['position'] = list(position)
            else:
                target['position'] = None
            observed = fields(context, ('observedAt',))
            observed['receptionist'] = target
            observed['proximity'] = fields(proximity, ('actorDimension', 'sameDimension', 'distance', 'maxDistance', 'near'))
            summary['guild']['claimContext'] = observed
    after = asdict(row.get('after'))
    if point(after.get('position')):
        summary['positionAfter'] = point(after['position'])
    sense = asdict(row.get('navigationSense')) or asdict(asdict(native.get('data')).get('navigationSense'))
    if sense:
        projected = fields(sense, ('ok', 'code', 'observedAt'))
        if point(sense.get('position')):
            projected['position'] = point(sense['position'])
        if isinstance(sense.get('bodyControl'), dict):
            projected['bodyControl'] = fields(sense['bodyControl'],
                ('available', 'kind', 'name', 'nativeAvoidanceActive', 'sample', 'code', 'notice'))
        if isinstance(sense.get('destination'), dict):
            dest = sense['destination']
            target = fields(dest, ('available', 'requestedStanceClear', 'requestedStanceSupported',
                'pathVerified', 'destinationChanged', 'examinedCells', 'unloadedCells', 'truncated',
                'code', 'targetBlock', 'notice'))
            if point(dest.get('requested')):
                target['requested'] = point(dest['requested'])
            if isinstance(dest.get('candidates'), list):
                target['candidates'] = [fields(candidate, ('x', 'y', 'z', 'pathVerified', 'supportBlock'))
                    for candidate in dest['candidates'][:5] if isinstance(candidate, dict)]
                if len(dest['candidates']) > 5:
                    summary['navigationSenseTruncatedForContext'] = True
            projected['destination'] = target
        summary['navigationSense'] = projected
    # The verdict is the model-facing half: it states whether the destination was
    # usable, so a strict-arrival failure stops reading as "find another cell".
    found = row.get('navigationVerdict')
    if not isinstance(found, dict) and isinstance(result.get('result'), dict):
        found = result['result'].get('navigationVerdict')
    if isinstance(found, dict):
        summary['navigationVerdict'] = found
    return summary


def _read_json(path, limit):
    path = Path(path)
    # A Docker Desktop bind mount can briefly report ENOENT while another
    # worker replaces a durable state file. Retry only this read, never an
    # action or a callback; a persistently missing receipt must still fail.
    delays = (0.05, 0.1, 0.2)
    for attempt in range(len(delays) + 1):
        try:
            if path.is_symlink() or path.stat().st_size > limit:
                raise GatewayError('invalid_state_file')
            value = json.loads(path.read_text(encoding='utf-8-sig'))
            break
        except FileNotFoundError:
            if attempt == len(delays):
                raise
            time.sleep(delays[attempt])
    if not isinstance(value, dict):
        raise GatewayError('invalid_state_file')
    return value


def read_json(path):
    return _read_json(path, 262144)


def read_controller_json(path):
    """The rolling 24-hour decision journal can exceed the small-state limit."""
    if Path(path).name != 'controller.json':
        raise GatewayError('invalid_controller_state_path')
    return _read_json(path, 2 * 1024 * 1024)


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
        # Docker Desktop bind mounts inherit Windows reader sharing locks.
        # Retry only renaming the same fsynced bytes: never rerun a callback,
        # overwrite the destination in place, or repeat a game/model request.
        delays = (0.05, 0.1, 0.2, 0.4, 0.8)
        for attempt in range(len(delays) + 1):
            try:
                os.replace(temp, path)
                break
            except PermissionError:
                if attempt == len(delays):
                    raise
                time.sleep(delays[attempt])
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
            parts, response_bytes = [], 0
            end_requested = False
            for _ in range(256):
                rid, kind, response = self._receive(stream)
                if (rid, kind) == (2, 0):
                    response_bytes += len(response.encode('utf-8'))
                    if response_bytes > 1048576:
                        raise ConnectionError('rcon_response_too_large')
                    parts.append(response)
                    if not end_requested:
                        # Minecraft splits one reply into same-ID 4096-character
                        # frames, without a final-frame flag. After its first
                        # frame, send a distinct-ID type-0 protocol probe. The
                        # native server responds only after all command frames;
                        # this is not another command or a mutation retry.
                        stream.sendall(self._packet(3, 0, ''))
                        end_requested = True
                elif rid == 3:
                    if not end_requested or kind != 0 or response != 'Unknown request 0':
                        raise ConnectionError('rcon_invalid_response_end')
                    return ''.join(parts)
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


NAVIGATION_MAX_WAIT_MS = 5 * 60 * 1000
FOOD_MAX_WAIT_MS = 60 * 1000


class NumenGateway:
    def __init__(self, state_dir=Path('/state/survival'), rcon=None, clock=time.time):
        self.state = Path(state_dir)
        self.rcon = rcon or RconClient()
        self.clock = clock

    def _native_summon(self, owner_uuid, body_name):
        """Restore a companion through our own actuator, by name.

        Upstream restores bodies when their owner logs in, and this world's owner is a
        fixed non-playing uuid, so nothing happens on its own. numen_act is our module
        and its summon is idempotent by name, which is what keeps the restored body the
        same body: same uuid, same save.
        """
        return self.rcon.cmd('numen_act summon ' + owner_uuid + ' ' + body_name)

    def _native_roster(self):
        return self.rcon.cmd('numen_act list')

    def _native_restore_existing(self, body_uuid, owner_uuid, body_name):
        # The command moved from our core patch into our actuator, where it belongs, and
        # keeps its name and reply envelope so the reconnect contract is untouched.
        return self.rcon.cmd('numen_restore_existing ' + body_uuid + ' ' + owner_uuid + ' ' + body_name)

    def _native_recipe(self, body_name, item_id):
        return self.rcon.cmd('numen_act invoke ' + json.dumps(body_name) + ' lookup_recipe '
                             + json.dumps({'item_id': item_id}, ensure_ascii=True))

    def _native_scene(self, body_name, radius):
        return self.rcon.cmd(f'numen_act invoke "{body_name}" look_around ' + json.dumps({'radius': radius}))

    def _native_navigation_sense(self, body_uuid, requested):
        command = 'qdworld navigation_sense ' + body_uuid
        if requested is not None:
            command += ' ' + ' '.join(str(requested[k]) for k in ('x', 'y', 'z'))
        return self.rcon.cmd(command)

    def _native_eat(self, actor, action_id, args):
        payload = base64.urlsafe_b64encode(json.dumps(args, separators=(',', ':')).encode()).decode().rstrip('=')
        return self.rcon.cmd(f'qdworld eat {actor} {action_id} {payload}')

    def _native_eating(self, actor, action_id):
        return self.rcon.cmd(f'qdworld eating {actor} {action_id}')

    def _native_drop(self, actor, action_id, args):
        payload = base64.urlsafe_b64encode(json.dumps(args, separators=(',', ':')).encode()).decode().rstrip('=')
        return self.rcon.cmd(f'qdworld drop {actor} {action_id} {payload}')

    def _native_dropping(self, actor, action_id):
        return self.rcon.cmd(f'qdworld dropping {actor} {action_id}')

    def _native_gui(self, actor_uuid, offset):
        return self.rcon.cmd(f'qdworld gui {actor_uuid} {offset}')

    def _native_scan(self, actor_uuid, radius, block_ids):
        return self.rcon.cmd(f'qdworld scan {actor_uuid} {radius} ' + ','.join(block_ids))

    def _native_offers(self, actor_uuid, entity_id, offset):
        return self.rcon.cmd(f'qdtrade offers {actor_uuid} {entity_id} {offset}')

    def _native_trade(self, actor_uuid, entity_id, offer_index, quote):
        return self.rcon.cmd(f'qdtrade trade {actor_uuid} {entity_id} {offer_index} {quote}')

    def _native_interact(self, actor, request_id, args):
        encoded = base64.urlsafe_b64encode(json.dumps(args, sort_keys=True, separators=(',', ':'),
                                                     ensure_ascii=True).encode('ascii')).decode('ascii').rstrip('=')
        return self.rcon.cmd(f'qdworld interact {actor} {request_id} {encoded}')

    def _native_interaction(self, actor, request_id):
        return self.rcon.cmd(f'qdworld interaction {actor} {request_id}')

    def inspect_block(self, x, y, z):
        from world_actions import WorldActions
        return WorldActions(self).inspect(x, y, z)

    def inspect_container(self, x, y, z):
        from world_actions import WorldActions
        return WorldActions(self).container_view(x, y, z)

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
        roster = self._native_roster()
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

    def sense(self, sensor='catalog', arguments=None):
        from sensors import sense
        return sense(self, sensor, arguments)

    def _invoke(self, tool, args=None):
        if tool in GUILD_ACTIONS:
            from guild import Guild
            return Guild(self).dispatch(tool, args)
        if tool in ('game_cast', 'game_learn'):
            from game_skills import GameSkills
            return GameSkills(self).dispatch(tool, args)
        # walk_only was this project's own navigation flag, not upstream's; passing an
        # unknown argument is not the way to ask for a route. Upstream owns navigation.
        # Same body/tool/JSON interface as the existing guard MCP, never raw model commands.
        body = self._settings()['bodyName']
        raw = self.rcon.cmd(f'numen_act invoke "{body}" {tool} ' + json.dumps(args or {}, ensure_ascii=True))
        if raw.startswith('no companion:'):
            raise GatewayError('body_offline')
        try:
            result = json.loads(raw)
        except (ValueError, TypeError):
            error = GatewayError('numen_reply_invalid')
            error.native_reply = raw
            raise error
        if not isinstance(result, dict):
            error = GatewayError('numen_reply_invalid')
            error.native_reply = raw
            raise error
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
            from navigation_sense import NavigationSense
            control_sample = NavigationSense(self).read(body_uuid, status.get('dimension'))
            body_control = {**control_sample['bodyControl'], **{k: control_sample[k]
                for k in ('actorUuid', 'dimension', 'observedAt', 'gameTime', 'bodyTickCount') if k in control_sample}}
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
                    'bodyControl': body_control,
                    'notice': 'Idle is not a completion receipt. Numen navigation is not geofenced.'}
        except (OSError, ValueError, TypeError, KeyError, ImportError) as error:
            text = str(error)
            missing = (isinstance(error, GatewayError) and text == 'body_offline')
            if not missing:
                # A dead companion is not a failed read. The native surface answers
                # "no companion: <name>" for one that is gone, and an unreadable body is
                # not necessarily an absent one - so when the error does not already say
                # it, ask the roster, which is authoritative for presence. Reporting
                # "unknown" here parked the controller in observation_wait for two hours
                # while the body was dead and the reconnect never got its turn.
                missing = 'no companion' in text.lower() or self._body_absent_from_roster(body)
            return {'schema': 1, 'ok': False, 'online': False if missing else None, 'bodyName': body,
                    'observedAt': now, 'code': 'body_offline' if missing else 'observation_unavailable',
                    'errorType': type(error).__name__, 'observationStage': stage}

    def _body_absent_from_roster(self, body):
        """True only when the roster positively does not list the body.

        The roster's online section is the presence authority; its catalogue section
        (dead or awaiting respawn) is not presence. A read that fails tells us nothing
        and must keep answering "unknown", never "gone".
        """
        try:
            raw = self._native_roster()
        except (OSError, ValueError):
            return False
        if not isinstance(raw, str):
            return False
        lines = [line.strip() for line in raw.strip().splitlines() if line.strip()]
        if not lines or not lines[0].startswith('count='):
            return False
        try:
            count = int(lines[0][6:])
        except ValueError:
            return False
        # Only a well-formed roster can confirm an absence. A count that disagrees with
        # the lines under it is a contradiction, and reading a contradiction as "gone"
        # would restore a body that is merely unreadable - the opposite mistake, and the
        # more expensive one.
        tail = lines[1 + count:]
        if len(lines[1:1 + count]) != count:
            return False
        if tail:
            if not tail[0].startswith('dead='):
                return False
            try:
                dead = int(tail[0][5:])
            except ValueError:
                return False
            if len(tail[1:]) != dead:
                return False
        for line in lines[1:1 + count]:
            fields = line.split('|')
            values = dict(part.split('=', 1) for part in fields[1:] if '=' in part)
            if fields[0] == body or values.get('uuid') == body:
                return False
        return True

    def observe(self, radius=8):
        try:
            self._integer(radius, 4, 12)
            body, actor_uuid = self._check_binding()
            terrain = self._native_scene(body, radius)
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
            return {'ok': True, 'observedAt': self._now(), 'bodyUuid': actor_uuid, 'terrain': terrain[:6000],
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
        if tool not in (*TOOLS, *DIRECT_ACTIONS) or not isinstance(args, dict):
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
        elif tool == 'drop_items':
            if set(args) != {'item_id', 'count'}:
                raise GatewayError('invalid_drop')
            self._item(args['item_id'])
            self._integer(args['count'], 1, 64)
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
            error = GatewayError('outside_work_area')
            error.details = {'schema': 1, 'kind': 'area_preflight',
                'checkedPosition': {k: point[k] for k in ('x', 'y', 'z') if k in point},
                'workArea': {k: area[k] for k in ('minX', 'maxX', 'minZ', 'maxZ')},
                'margin': margin, 'dispatched': False, 'writePerformed': False,
                'retryAutomatically': False,
                'instruction': '检查点超出本身体授权工作区（含动作余量）。请在该范围内重新规划；移动受理不表示目标获准。'}
            raise error
        anchor = settings.get('anchor', {})
        protected = settings.get('protectedRadius')
        if not self._number(protected) or protected < 0 or not all(self._number(anchor.get(k)) for k in ('x', 'z')):
            raise GatewayError('anchor_missing')
        if protect and math.hypot(point['x'] - anchor['x'], point['z'] - anchor['z']) <= protected + margin:
            error = GatewayError('protected_area')
            error.details = {'schema': 1, 'kind': 'area_preflight',
                'checkedPosition': {k: point[k] for k in ('x', 'y', 'z') if k in point},
                'protectedArea': {'anchor': {k: anchor[k] for k in ('x', 'z')},
                    'radius': protected, 'margin': margin,
                    'horizontalDistance': round(math.hypot(point['x'] - anchor['x'], point['z'] - anchor['z']), 3)},
                'dispatched': False, 'writePerformed': False, 'retryAutomatically': False,
                'instruction': '动作检查点处于保护区，尚未执行。这是授权边界，不是距离够不着；'
                    '换站位不会使保护区内目标获准。请选择授权区域内的操作或其他任务。'}
            raise error

    def _record(self, row):
        with (self.state / 'actions.jsonl').open('a', encoding='utf-8') as stream:
            stream.write(json.dumps(row, ensure_ascii=False, allow_nan=False) + '\n')
            stream.flush()
            os.fsync(stream.fileno())

    @staticmethod
    def _action_snapshot(body):
        return {k: body[k] for k in ('ok', 'bodyUuid', 'position', 'dimension', 'counts', 'hp',
                'hunger', 'task', 'navigationEpoch', 'navigationResult', 'bodyControl', 'observedAt') if k in body}

    def _save_receipt(self, receipt):
        receipts_dir = self.state / 'action-receipts'
        write_json(receipts_dir / (receipt['actionId'] + '.json'), receipt)
        write_json(self.state / 'last-action.json', {'schema': 1, 'actionId': receipt['actionId']})
        self._prune_receipts(receipts_dir)

    def _prune_receipts(self, receipts_dir):
        """Cap the receipt archive so it (and the survivor's per-tick pattern
        scan over it) does not grow without bound. Keeps the newest receipts;
        the in-flight action is never pruned. Best-effort: pruning failures
        must not break the action path."""
        try:
            files = list(receipts_dir.glob('*.json'))
            if len(files) <= MAX_ACTION_RECEIPTS:
                return
            protected = set()
            inflight = self.state / 'inflight-action.json'
            if inflight.exists():
                try:
                    protected.add(read_json(inflight).get('actionId'))
                except (OSError, ValueError):
                    pass
            files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
            for path in files[MAX_ACTION_RECEIPTS:]:
                if path.stem in protected:
                    continue
                path.unlink(missing_ok=True)
        except OSError:
            pass

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

    def _observed_arrival(self, receipt, body):
        """Judge a finished goto from the body itself.

        The evidence a server-side observer actually has: the task is gone and the
        body has stopped where it stopped. This states what was observed and does
        not claim the requested work succeeded - the same discipline the rest of the
        receipt path follows.
        """
        args = receipt.get('args') or {}
        position = body.get('position') or {}
        if not all(self._number(position.get(k)) for k in ('x', 'y', 'z')):
            return None
        if not (self._number(args.get('x')) and self._number(args.get('z'))):
            return None
        distance = math.hypot(position['x'] - args['x'], position['z'] - args['z'])
        if self._number(args.get('y')):
            arrived = math.floor(position['y']) == math.floor(args['y']) and distance <= 1.5
        else:
            arrived = distance <= 1.5
        return {'task_id': receipt.get('nativeTaskId'), 'state': 'ended', 'success': arrived,
                'navigation_mode': 'observed_from_body',
                'final_x': position['x'], 'final_y': position['y'], 'final_z': position['z'],
                'requested': {k: args.get(k) for k in ('x', 'y', 'z') if k in args},
                'horizontalDistance': round(distance, 2),
                'reason': 'the task ended and the core keeps no readable navigation terminal; '
                          'arrival is judged from the body against the request'}

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
            # The process that owned this task is gone (a restart, or a mod swap):
            # its terminal can never arrive, so the outcome is permanently
            # unknowable. Close it as observed-ended - never as success, and never
            # by replaying it - and release the marker, otherwise the loop waits on
            # an answer that no one will ever send. 2026-09-17: an epoch change cost
            # half an hour of a body that had already been restored.
            receipt.update(status='observed_ended', completionConfirmed=False,
                           navigationOutcome=None, observedAt=self._now(),
                           notice='The navigation epoch that owned this action is gone; the '
                                  'outcome is unknowable. This action is not replayed.')
            self._save_receipt(receipt)
            path.unlink(missing_ok=True)
            try:
                lease_path = self.state / 'lease.json'
                lease = read_json(lease_path) if lease_path.exists() else {}
                if lease.get('actionId') == receipt.get('actionId'):
                    lease['status'] = 'closed'
                    write_json(lease_path, lease)
            except (OSError, ValueError):
                pass
            return receipt
        task = body.get('task', {})
        if task.get('busy'):
            if task.get('task_id') != receipt.get('nativeTaskId'):
                raise GatewayError('inflight_task_mismatch')
            return receipt
        outcome = None
        food_outcome = None
        interaction_outcome = None
        if receipt['tool'] == 'goto':
            candidate = body.get('navigationResult') or {}
            if (receipt.get('nativeTaskId') and before.get('navigationEpoch')
                    and candidate.get('task_id') == receipt['nativeTaskId']
                    and candidate.get('navigation_epoch') == before['navigationEpoch']):
                outcome = candidate
            else:
                # Upstream reports completion as an event to the owner's client and no
                # longer keeps a navigation terminal a server-side observer can read
                # (its status carries no navigation_epoch and no last_navigation_result).
                # Asking for that terminal would wait forever: 2026-09-17, the first
                # goto after the swap ended natively while the loop waited on it.
                outcome = self._observed_arrival(receipt, body)
                if outcome is None:
                    return receipt  # nothing to judge against: keep the identity, do not guess
        elif receipt['tool'] == 'interact_at':
            from world_actions import WorldActions
            interaction_outcome = WorldActions(self, max_polls=1)._interaction(
                {'actionId': receipt['actionId'], 'bodyUuid': before['bodyUuid'],
                 'nativeTaskId': receipt['nativeTaskId'],
                 'epoch': receipt['result']['result']['data']['nativeInteractionReceipt']['epoch']},
                receipt['args'], query_only=True, allow_pending=True)
            if interaction_outcome.get('data', {}).get('async'):
                return receipt
            outcome = interaction_outcome
        elif receipt['tool'] == 'eat' and receipt.get('result', {}).get('result', {}).get('nativeFoodReceipt'):
            from food_actions import FoodActions
            food_outcome = FoodActions(self).terminal(receipt)
            if food_outcome is None:
                # Idle can precede delivery of the exact native record; retain the
                # in-flight identity rather than discard its eventual terminal.
                return receipt
            outcome = food_outcome['result']
        receipt.update(status=('completed' if outcome.get('success') else 'failed') if outcome else 'observed_ended',
                       after=self._action_snapshot(body), observedAt=self._now(),
                       completionConfirmed=outcome is not None, navigationOutcome=outcome,
                       notice='Idle proves no action is in flight; it does not prove the requested result.')
        if food_outcome is not None:
            receipt.update(nativeFoodOutcome=food_outcome, navigationOutcome=None,
                           notice='Completion is the exact original native eating task result.')
        if interaction_outcome is not None:
            receipt.update(nativeInteractionOutcome=interaction_outcome, navigationOutcome=None,
                           notice='The original native interaction ended; inspect its effects to judge the skill objective.')
        if receipt['tool'] == 'goto' and outcome is not None and outcome.get('success') is not True:
            from navigation_sense import NavigationSense, verdict
            survey = NavigationSense(self).for_destination(body, receipt['args'])
            receipt['navigationSense'] = survey
            # A failed strict arrival alone does not say whether the destination or
            # the landing was at fault, and its generic wording sends an agent
            # hunting for another cell even when the requested one was fine. Say
            # which case this is, once, from the survey already taken.
            found = verdict(survey, outcome, receipt.get('args'))
            if found is not None:
                receipt['navigationVerdict'] = found
        self._save_receipt(receipt)
        self._record({**receipt, 'phase': 'observation'})
        path.unlink()
        return receipt

    @staticmethod
    def _navigation_terminal_matches(body, receipt):
        before = receipt.get('before', {})
        terminal = body.get('navigationResult') or {}
        return (body.get('ok') is True and body.get('bodyUuid') == before.get('bodyUuid')
                and body.get('dimension') == before.get('dimension')
                and body.get('navigationEpoch') == before.get('navigationEpoch')
                and body.get('task', {}).get('busy') is False
                and terminal.get('task_id') == receipt.get('nativeTaskId')
                and terminal.get('navigation_epoch') == before.get('navigationEpoch')
                and terminal.get('state') in ('success', 'failed', 'timeout', 'cancelled')
                and type(terminal.get('success')) is bool
                and terminal['success'] == (terminal['state'] == 'success'))

    @staticmethod
    def _deadline_kind(receipt):
        if receipt.get('tool') == 'goto':
            return 'navigation', NAVIGATION_MAX_WAIT_MS, 'navigationStop'
        native = receipt.get('result', {}).get('result', {}).get('nativeFoodReceipt')
        if (receipt.get('tool') == 'eat' and isinstance(native, dict)
                and native.get('tool') == 'eat' and native.get('requestId') == receipt.get('actionId')
                and native.get('actorUuid') == receipt.get('before', {}).get('bodyUuid')
                and native.get('args') == receipt.get('args')
                and native.get('nativeTaskId') == receipt.get('nativeTaskId')
                and isinstance(native.get('epoch'), str) and native['epoch']):
            return 'food', FOOD_MAX_WAIT_MS, 'foodStop'
        return None  # Old eating receipts do not gain a fabricated completion API.

    def _stop_journal_path(self, tool, action_id):
        # Keep existing goto journals and readers compatible. Both types use the
        # same exact-stop implementation below; food has a separate filename scope.
        return self.state / ('navigation-stops' if tool == 'goto' else 'action-stops') / (action_id + '.json')

    def _deadline_terminal(self, body, receipt):
        if receipt['tool'] == 'goto':
            return body['navigationResult'] if self._navigation_terminal_matches(body, receipt) else None
        before = receipt.get('before', {})
        if (body.get('ok') is not True or body.get('bodyUuid') != before.get('bodyUuid')
                or body.get('dimension') != before.get('dimension')
                or body.get('navigationEpoch') != before.get('navigationEpoch')
                or body.get('task', {}).get('busy') is not False):
            return None
        from food_actions import FoodActions
        try:
            return FoodActions(self).terminal(receipt)
        except (OSError, ValueError, TypeError, KeyError):
            return None  # Missing exact proof is never converted to success or a repeated stop.

    def navigation_stop_pending(self, body):
        """Prevent generic pause cleanup from repeating an uncertain exact stop."""
        inflight = self.state / 'inflight-action.json'
        if not inflight.exists():
            return False
        receipt = read_json(inflight)
        action_id = receipt.get('actionId')
        if (receipt.get('tool') not in ('goto', 'eat') or not isinstance(action_id, str)
                or not re.fullmatch('[0-9a-f]{32}', action_id)):
            return False
        path = self._stop_journal_path(receipt['tool'], action_id)
        if not path.exists():
            return False
        # Any durable claim forbids a generic resend for this same live task;
        # a damaged/conflicting journal is not permission to stop it again.
        before = receipt.get('before', {})
        return (body.get('bodyUuid') == before.get('bodyUuid')
                and body.get('navigationEpoch') == before.get('navigationEpoch')
                and body.get('task', {}).get('task_id') == receipt.get('nativeTaskId'))

    def enforce_navigation_deadline(self, body, *, preempt_action_id=None):
        """Controller-only execution boundary; read-only MCP status never calls this.

        Compatibility entry point for the shared goto/eat total waiting boundary.
        Native reflex preemption freezes their execution budgets indefinitely:
        goto retains 300 seconds, journalled timed food use gets 60 seconds.
        A durable exact stop claim prevents retransmission after a crash.
        """
        inflight = self.state / 'inflight-action.json'
        if not inflight.exists() or (self.state / 'unknown.json').exists():
            return body
        receipt = read_json(inflight)
        accepted = receipt.get('acceptedAt')
        kind = self._deadline_kind(receipt)
        if (kind is None or receipt.get('status') != 'in_flight'
                or type(accepted) is not int
                or (preempt_action_id is not None and receipt.get('actionId') != preempt_action_id)
                or (preempt_action_id is None and not 0 < accepted <= self._now() - kind[1])):
            return body
        label, max_wait_ms, receipt_key = kind
        with action_lock(self.state, blocking=True):
            if (not inflight.exists() or read_json(inflight) != receipt
                    or (self.state / 'unknown.json').exists()
                    or read_json(self.state / 'control.json').get('enabled') is not True):
                return body
            action_id, task_id = receipt.get('actionId'), receipt.get('nativeTaskId')
            before = receipt.get('before', {})
            if (not isinstance(action_id, str) or not re.fullmatch('[0-9a-f]{32}', action_id)
                    or not isinstance(task_id, str) or not re.fullmatch('t[0-9]+', task_id)
                    or not isinstance(before.get('navigationEpoch'), str) or not before['navigationEpoch']):
                return body
            fresh = self.snapshot()
            if self._deadline_terminal(fresh, receipt) is not None:
                return fresh
            if (fresh.get('ok') is not True or fresh.get('bodyUuid') != before.get('bodyUuid')
                    or fresh.get('dimension') != before.get('dimension')
                    or fresh.get('navigationEpoch') != before['navigationEpoch']
                    or fresh.get('task', {}).get('busy') is not True
                    or fresh['task'].get('task_id') != task_id):
                return fresh  # Existing action_status reports the mismatch; never stop another task.
            path = self._stop_journal_path(receipt['tool'], action_id)
            journal = read_json(path) if path.exists() else None
            identity = {'actionId': action_id, 'nativeTaskId': task_id, 'bodyUuid': before['bodyUuid'],
                        'navigationEpoch': before['navigationEpoch']}
            if receipt['tool'] == 'eat':
                identity.update(tool='eat', foodEpoch=receipt['result']['result']['nativeFoodReceipt']['epoch'])
            if journal is not None and any(journal.get(key) != value for key, value in identity.items()):
                raise GatewayError(label + '_stop_identity_mismatch')
            if journal is None:
                journal = {'schema': 1, **identity, 'phase': 'dispatching', 'requestedAt': self._now(),
                           'reason': 'motor_preempt' if preempt_action_id else label + '_total_wait_limit', 'maxWaitMs': max_wait_ms,
                           'acceptedAt': accepted, 'beforeStop': self._action_snapshot(fresh),
                           'actionReplayed': False, 'retryAutomatically': False}
                write_json(path, journal)  # Claim before sending; an existing claim is read-only forever.
                try:
                    journal['stopReply'] = self._invoke('task_stop', {'task_id': task_id})
                except (OSError, ValueError, TypeError, KeyError) as exc:
                    journal['stopErrorType'] = type(exc).__name__
                journal['phase'] = 'awaiting_terminal'
                write_json(path, journal)
            # A lost ACK or process restart may still have a genuine terminal.
            # Queries cannot repeat a stop, navigate, or change the world.
            for _ in range(8):
                time.sleep(.25)
                fresh = self.snapshot()
                terminal = self._deadline_terminal(fresh, receipt)
                if terminal is not None:
                    journal.update(phase='terminal_confirmed', observedAt=self._now(),
                                   terminal=terminal)
                    write_json(path, journal)
                    receipt[receipt_key] = journal
                    self._save_receipt(receipt)
                    write_json(inflight, receipt)
                    self._record({**receipt, 'phase': label + '_stop', 'reason': journal['reason']})
                    return fresh  # Normal _settle_inflight consumes only this real terminal.
            journal.update(phase='outcome_unknown', observedAt=self._now(),
                           lastObservation=self._action_snapshot(fresh))
            write_json(path, journal)
            receipt[receipt_key] = journal
            self._save_receipt(receipt)
            write_json(inflight, receipt)
            write_json(self.state / 'unknown.json', {**receipt, 'schema': 1, 'result': 'unknown',
                       'reason': label + '_stop_outcome_unknown'})
            lease_path = self.state / 'lease.json'
            lease = read_json(lease_path) if lease_path.exists() else {}
            if lease.get('actionId') == action_id:
                write_json(lease_path, lease | {'status': 'unknown'})
            self._record({**receipt, 'phase': label + '_stop', 'code': 'outcome_unknown'})
            return fresh

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
                from motor_mailbox import cognition, enqueue_locked
                try:
                    if cognition(self.state, turn_id, self.clock) is not None:
                        return enqueue_locked(self.state, turn_id, 'action', {'tool':tool,'args':args}, self.clock)
                except ValueError as exc:
                    raise GatewayError(str(exc)) from exc
                lease = read_json(self.state / 'lease.json')
                if (not isinstance(turn_id, str) or not TURN_ID.fullmatch(turn_id) or lease.get('turnId') != turn_id
                        or lease.get('schema') != 1 or lease.get('status') != 'open'
                        or lease.get('expiresAt', 0) <= self._now()):
                    return invalid_lease_response()
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
                # Navigation belongs to upstream, which does not advertise our patched
                # strict-arrival mode; requiring it would refuse every goto. What we
                # still rely on is the navigation outcome in the receipt, which is a
                # description of what happened rather than a promise about a mode.
                # Verified navigation may cross town; mining may not.
                protected = tool == 'mine'
                if tool in ('game_cast', 'game_learn'):
                    from game_skills import is_protected_action
                    protected = is_protected_action(tool, args)
                self._area(before['position'], 16 if tool == 'mine' else 0, protect=protected)
                if tool == 'equip_item' and before['counts'].get(args['item_id'], 0) <= 0:
                    # runSync has no terminal receipt on the RCON bridge. Reject a
                    # known missing item BEFORE reserving/sending, rather than
                    # waiting for equipment that cannot appear and pausing life.
                    return {'ok': False, 'code': 'equipment_item_missing',
                            'dispatched': False, 'writePerformed': False,
                            'itemId': args['item_id'], 'availableCount': 0,
                            'notice': 'Item absent from the current body inventory. Inspect inventory and choose an available item or acquire it first.'}
                if tool == 'goto':
                    self._area(args, protect=False)
                    distance = math.hypot(args['x'] - before['position']['x'], args['z'] - before['position']['z'])
                    if distance > 24:
                        result = {'ok': False, 'code': 'walk_target_too_far', 'dispatched': False,
                                  'navigationPreflight': {'bodyUuid': before['bodyUuid'],
                                      'dimension': before['dimension'], 'observedAt': before['observedAt'],
                                      'origin': dict(before['position']), 'requested': dict(args),
                                      'horizontalDistance': distance, 'maxHorizontalDistance': 24,
                                      'distanceMetric': 'horizontal_euclidean', 'destinationChanged': False}}
                        # A rejection has no native action ID and consumes no lease.
                        # Keep its exact origin for subsequent diagnosis, not a later
                        # position sampled after a reflex or another action moved us.
                        try:
                            self._record({'turnId': turn_id, 'tool': tool, 'args': dict(args),
                                          'phase': 'preflight_rejected', 'observedAt': self._now(), 'result': result})
                        except OSError:
                            result['auditLogAvailable'] = False
                        return result
                if tool in ('game_cast', 'game_learn'):
                    from game_skills import preflight_game_action
                    preflight_game_action(self, before, tool, args)
                if tool == 'drop_items':
                    from drop_actions import preflight
                    preflight(before, args)
                plan = None
                navigation_sense = None
                if tool == 'goto':
                    from navigation_sense import NavigationSense
                    navigation_sense = NavigationSense(self).for_destination(before, args)
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
                if plan is not None:
                    # The native interaction journal shares this exact durable
                    # action identity; retries may query it but never re-dispatch.
                    plan['actionId'] = action_id
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
                reply = None
                try:
                    if tool == 'eat':
                        from food_actions import FoodActions
                        reply = FoodActions(self).dispatch(action_id, before, args)
                    elif tool == 'drop_items':
                        from drop_actions import DropActions
                        reply = DropActions(self).dispatch(action_id, before, args)
                    else:
                        reply = WorldActions(self).dispatch(plan) if tool in WORLD_ACTIONS else self._invoke(tool, args)
                    if tool == 'equip_item' and reply.get('accepted') is True:
                        reply = self._confirm_equipment(args)
                    if reply.get('success') is True:
                        result = {'ok': True, 'code': 'accepted' if reply.get('data', {}).get('async') else 'executed',
                                  'actionId': action_id, 'tool': tool, 'result': reply,
                                  'completionConfirmed': not reply.get('data', {}).get('async', False)}
                    elif reply.get('success') is False:
                        result = {'ok': False, 'code': 'action_rejected', 'actionId': action_id, 'result': reply}
                        if tool == 'eat' and reply.get('nativeFoodReceipt', {}).get('status') == 'terminal':
                            result['completionConfirmed'] = True
                        if tool == 'drop_items' and reply.get('nativeDropReceipt', {}).get('status') == 'terminal':
                            result['completionConfirmed'] = True
                        if tool == 'interact_at' and reply.get('data', {}).get('nativeInteractionReceipt', {}).get('status') == 'terminal':
                            result['completionConfirmed'] = True
                    else:
                        raise GatewayError('outcome_unknown')
                    if navigation_sense is not None:
                        result['navigationSense'] = navigation_sense
                    receipt = {**marker, 'schema': 2, 'result': result,
                               'status': 'completed' if result.get('completionConfirmed') else 'rejected',
                               'completionConfirmed': result.get('completionConfirmed') is True}
                    if navigation_sense is not None:
                        receipt['navigationSense'] = navigation_sense
                    if result.get('completionConfirmed') and result.get('ok') is False:
                        receipt['status'] = 'failed'
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
                except (OSError, ValueError, TypeError, KeyError) as exc:
                    lease['status'] = 'unknown'
                    write_json(self.state / 'lease.json', lease)
                    result = {'ok': False, 'code': 'outcome_unknown', 'actionId': action_id,
                              'notice': 'Do not resend. Inspect body and ask the operator to reconcile.',
                              'errorType': type(exc).__name__}
                    # A native task can start before its reply fails. Preserve
                    # the actual private response for diagnosis; never turn it
                    # into success, infer an ACK, or replay the command.
                    import hashlib
                    raw = getattr(exc, 'native_reply', None)
                    if not isinstance(raw, str) and isinstance(reply, dict):
                        raw = json.dumps(reply, ensure_ascii=False)
                    code = str(exc) if isinstance(exc, GatewayError) else ''
                    code = code if re.fullmatch(r'[a-z][a-z0-9_]{0,79}', code) else None
                    diagnostic = {'schema': 1, 'actionId': action_id, 'turnId': turn_id,
                        'tool': tool, 'recordedAt': self._now(), 'errorType': type(exc).__name__,
                        'errorCode': code, 'nativeReplyAvailable': isinstance(raw, str)}
                    if isinstance(raw, str):
                        data = raw.encode('utf-8')
                        diagnostic.update(nativeReply=raw[:16000], nativeReplySha256=hashlib.sha256(data).hexdigest(),
                                          nativeReplyTruncated=len(raw) > 16000)
                    try:
                        write_json(self.state / 'native-action-diagnostics' / (action_id + '.json'), diagnostic)
                        result['nativeDiagnosticRecorded'] = True
                    except (OSError, ValueError, TypeError):
                        result['nativeDiagnosticRecorded'] = False
                    diagnostic_path = self.state / 'world-interaction-receipts' / (action_id + '.json')
                    if tool in ('place_block', 'farm', 'open_container') and diagnostic_path.exists():
                        try:
                            diagnostic = read_json(diagnostic_path)
                            result['nativeInteractionDiagnostic'] = {key: diagnostic[key] for key in
                                ('stage', 'code', 'attempt', 'observedAt') if key in diagnostic}
                        except (OSError, ValueError, TypeError, KeyError):
                            pass
                    self._record({**marker, 'phase': 'response', 'result': result, 'finishedAt': self._now()})
                    return result
        except GatewayError as exc:
            result = {'ok': False, 'code': str(exc)}
            details = getattr(exc, 'details', None)
            if (str(exc) in ('protected_area', 'outside_work_area')
                    and isinstance(details, dict) and details.get('schema') == 1
                    and details.get('kind') == 'area_preflight'
                    and details.get('dispatched') is False and details.get('writePerformed') is False):
                result.update(dispatched=False, writePerformed=False, retryAutomatically=False,
                    areaPreflight={key: details[key] for key in ('schema', 'kind', 'checkedPosition',
                        'workArea', 'protectedArea', 'margin', 'instruction') if key in details})
            # Only this pre-dispatch observation contract is model-facing.
            # Raw native responses and arbitrary exception metadata stay private.
            # 2026-09-17: the not-air branch joined this contract. Both rejections
            # surface one pre-read cell with no dispatch and no write, so both are
            # the same observation class; the bare form was read by a live agent as
            # a positioning problem and produced a twenty-minute re-navigation loop.
            if (str(exc) in ('plant_requires_farmland', 'invalid_planting_target_or_seed')
                    and tool == 'farm'
                    and isinstance(details, dict) and details.get('schema') == 1
                    and details.get('kind') == 'farm_preflight'
                    and details.get('operation') == 'plant'
                    and details.get('dispatched') is False
                    and details.get('writePerformed') is False):
                result['farmPreflight'] = {key: details[key] for key in (
                    'schema', 'kind', 'operation', 'requested', 'target', 'support',
                    'expectedSupport', 'expectedTarget', 'dispatched', 'writePerformed',
                    'retryAutomatically', 'instruction') if key in details}
            return result
        except (OSError, ValueError, TypeError, KeyError):
            return {'ok': False, 'code': 'gateway_unavailable'}

"""Explicit bindings for migrated NPCs; never discover, spawn or move entities."""
import json
import math
import re
import time
import uuid

UUID = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\Z')
TAG = re.compile(r'[A-Za-z0-9_.+-]{1,64}\Z')
NUMBER = r'([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?)'
GUILD_PROFESSIONS = {'guild_lan': 'cartographer', 'jingshui': 'cleric', 'shilei': 'armorer',
                     'zhujiu': 'toolsmith', 'xiaoman': 'shepherd', 'hesu': 'farmer'}


def valid_position(value):
    return isinstance(value, (list, tuple)) and len(value) == 3 and all(type(n) in (int, float) and math.isfinite(n) for n in value)


def binding(profile):
    value = profile.get('entityBinding')
    if value is None:
        return None
    if (not isinstance(value, dict) or value.get('entityType') != 'minecraft:villager'
            or not isinstance(value.get('uuid'), str) or not UUID.fullmatch(value['uuid'])
            or value.get('dimension') != 'minecraft:overworld' or value.get('preservePosition') is not True
            or not valid_position(value.get('lastKnownPosition'))):
        raise ValueError('invalid_npc_binding')
    return value


def uuid_array(identity):
    data = uuid.UUID(identity).bytes
    return ','.join(str(int.from_bytes(data[i:i+4], 'big', signed=True)) for i in range(0, 16, 4))


def typed_uuid_selector(identity, tag=None):
    if not isinstance(identity, str) or not UUID.fullmatch(identity):
        raise ValueError('invalid_npc_uuid')
    if tag is not None and (not isinstance(tag, str) or not TAG.fullmatch(tag)):
        raise ValueError('invalid_npc_tag')
    return '@e[type=minecraft:villager,' + ('tag=' + tag + ',' if tag else '') + 'nbt={UUID:[I;' + uuid_array(identity) + ']},limit=1]'


def parse_position(text):
    match = re.search(r':\s*\[\s*' + NUMBER + r'[dD],\s*' + NUMBER + r'[dD],\s*' + NUMBER + r'[dD]\s*\]\s*$', text or '')
    if not match:
        return None
    values = tuple(float(n) for n in match.groups())
    return values if valid_position(values) else None


def parse_uuid(text):
    match = re.search(r'\[I;\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*\]\s*$', text or '')
    if not match:
        return None
    return str(uuid.UUID(bytes=b''.join((int(n) & 0xffffffff).to_bytes(4, 'big') for n in match.groups())))


def parse_name(text):
    value = (text or '').partition('has the following entity data: ')[2].strip()
    if value.startswith("'") and value.endswith("'"):
        value = value[1:-1]
    value = json.loads(value)
    return value if isinstance(value, str) else value.get('text') if isinstance(value, dict) else None


def historical_location(profile):
    value = binding(profile or {})
    return {'lastKnownPosition': list(value['lastKnownPosition']), 'lastKnownObservedAt': value.get('observedAt')} if value else {
        'lastKnownPosition': None, 'lastKnownObservedAt': None}


def contract_issuer(profile, kind):
    """Only the reviewed roles may issue new tasks; loaded chunks are irrelevant."""
    try:
        if not profile or not binding(profile) or profile.get('profession') != GUILD_PROFESSIONS.get(profile.get('key')):
            return False
        key = profile['key']
        if kind == 'reception':
            return key == 'guild_lan'
        if kind == 'gather':
            return key in ('jingshui', 'shilei', 'zhujiu', 'xiaoman', 'hesu')
        if kind == 'hunt':
            return key in ('zhujiu', 'xiaoman', 'hesu')
        return kind == 'visit' and key == 'jingshui'
    except (KeyError, TypeError, ValueError):
        return False


def required_npc_health(npc, guild):
    """Unloaded historical locations are visible but never count as nearby."""
    doc = guild.board_today()
    keys = sorted({'guild_lan'} | {b['from'] for b in doc['board'] if b.get('from') and b.get('status') != 'done'
                                  and b.get('type') in ('gather', 'hunt', 'visit') and not b.get('party')})
    rows, registered = [], {}
    for key in keys:
        row = {'key': key, 'state': 'unbound', 'carrierRegistered': False, 'positionFresh': False}
        try:
            profile = next(p for p in npc.PROFILES if p.get('key') == key)
            value = binding(profile)
            if value:
                carrier = value['entityType']
                if carrier not in registered:
                    answer = npc.R.cmd('execute if entity @e[type=' + carrier + ',limit=1]')
                    registered[carrier] = answer.strip().startswith(('Test passed', 'Test failed'))
                row.update(uuid=value['uuid'], carrier=carrier, carrierRegistered=registered[carrier], **historical_location(profile))
                position = npc.alive_pos(profile)
                if not registered[carrier]:
                    row['state'] = 'carrier_unregistered'
                elif valid_position(position):
                    row.update(state='online', position=list(position), positionFresh=True)
                else:
                    point = ' '.join(str(math.floor(n)) for n in value['lastKnownPosition'])
                    answer = npc.R.cmd('execute in minecraft:overworld if loaded ' + point).strip()
                    row['state'] = 'chunk_unloaded' if answer.startswith('Test failed') else 'missing_in_loaded_chunk' if answer.startswith('Test passed') else 'chunk_state_unknown'
        except Exception:
            row['state'] = 'identity_unavailable'
        rows.append(row)
    return {'checked_at': time.time(), 'ok': bool(rows) and all(r['state'] in ('online', 'chunk_unloaded') for r in rows),
            'online': sum(r['state'] == 'online' for r in rows), 'required': rows, 'forceloadUsed': False}

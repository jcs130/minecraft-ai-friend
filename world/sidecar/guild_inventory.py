"""Read actual vanilla player inventory for guild settlement; never mutate it."""
import json
import re
import uuid

ACTOR = re.compile(r'[A-Za-z0-9_]{1,16}\Z')
ITEM = re.compile(r'[a-z0-9_.-]+:[a-z0-9_./-]+\Z')


def count_item(npc, actor, item_id):
    if not isinstance(actor, str) or not ACTOR.fullmatch(actor) or not isinstance(item_id, str) or not ITEM.fullmatch(item_id):
        raise ValueError('invalid_inventory_query')
    # Count=0 is the game's read-only count mode; no item is removed.
    reply = npc.R.cmd(f'clear {actor} {item_id} 0')
    if not isinstance(reply, str):
        raise ValueError('inventory_count_unavailable')
    if re.fullmatch(r'No items were found on player ' + re.escape(actor) + r'\.?', reply.strip()):
        return 0
    found = re.fullmatch(r'Found (\d+) matching item(?:\(s\)|s)? on player ' + re.escape(actor) + r'\.?', reply.strip())
    if not found:
        raise ValueError('inventory_count_unavailable')
    return int(found[1])


def snapshot(npc, actor):
    """Require the normal closed menu and stable paged server identity.

    Slot numbers 9..44 belong to the 36 main inventory slots of 1.21.1's
    InventoryMenu. Armor/offhand/crafting slots are not spare bag capacity.
    Never count a promised future item removal as already available capacity.
    """
    if not isinstance(actor, str) or not ACTOR.fullmatch(actor):
        raise ValueError('invalid_inventory_actor')
    raw = npc.R.cmd(f'data get entity {actor} UUID')
    match = re.search(r'\[I;\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*\]', raw or '')
    if not match:
        raise ValueError('inventory_actor_unavailable')
    expected = str(uuid.UUID(bytes=b''.join((int(x) & 0xffffffff).to_bytes(4, 'big') for x in match.groups())))
    offset, first, rows = 0, None, []
    for page in range(4):
        raw = npc.R.cmd(f'qdworld gui {expected} {offset}')
        lines = [line for line in (raw or '').splitlines() if line.startswith('QD_WORLD_JSON ')]
        if len(lines) != 1:
            raise ValueError('inventory_menu_unavailable')
        result = json.loads(lines[0][len('QD_WORLD_JSON '):])
        if (result.get('schema') != 1 or result.get('capability') != 'physical_menu_v1'
                or result.get('ok') is not True or result.get('actorUuid') != expected
                or result.get('menu') != 'InventoryMenu' or result.get('cursorEmpty') is not True
                or result.get('stillValid') is not True or result.get('slotCount') != 46
                or result.get('offset') != offset or not isinstance(result.get('slots'), list)
                or len(result['slots']) != min(12, 46-offset)):
            raise ValueError('inventory_menu_unavailable')
        identity = tuple(result.get(k) for k in ('actorUuid','menu','containerId','epoch','dimension'))
        uuid.UUID(result['epoch'])
        if type(result.get('containerId')) is not int or first is not None and identity != first:
            raise ValueError('inventory_changed_during_read')
        first = identity
        for i, row in enumerate(result['slots']):
            if not isinstance(row, dict) or row.get('index') != offset+i:
                raise ValueError('inventory_slot_order_invalid')
            if 9 <= row['index'] <= 44:
                if (row.get('playerSide') is not True or row.get('output') is not False
                        or not isinstance(row.get('id'), str) or not ITEM.fullmatch(row['id'])
                        or type(row.get('count')) is not int or not 0 <= row['count'] <= 2147483647
                        or (row['id']=='minecraft:air') != (row['count']==0)):
                    raise ValueError('inventory_slot_invalid')
                rows.append(row)
        offset += len(result['slots'])
        if result.get('nextOffset') != (offset if offset < 46 else -1):
            raise ValueError('inventory_page_invalid')
    if len(rows) != 36:
        raise ValueError('inventory_incomplete')
    counts, free, room = {}, 0, 0
    for row in rows:
        if row['count'] == 0:
            free += 1
            room += 64
        else:
            counts[row['id']] = counts.get(row['id'],0) + row['count']
            # The compact menu omits item components. Named/custom emeralds
            # may not stack with a normal reward; only empty slots prove room.
    return {'actorUuid':expected, 'counts':counts, 'freeSlots':free,
            'emeraldCapacity':room, 'source':'physical_menu_v1'}

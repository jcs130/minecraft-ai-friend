"""Pure, bounded adventure facts assembled from existing observations.

No I/O, recipes, mission selection, scoring, action dispatch or model calls.
Vanilla categories are descriptive hints; unknown mod items keep their IDs.
This module cannot establish land ownership, trading eligibility or mineability.
"""
from itertools import islice
import json
import math
import re


ITEM = re.compile(r'[a-z0-9_.-]+:[a-z0-9_./-]{1,110}\Z')
NAME = re.compile(r'[a-z][a-z0-9_-]{0,47}\Z')
VERSION = re.compile(r'[0-9a-f]{64}\Z')
MAX_BYTES = 6000
SLOTS = ('mainhand', 'offhand', 'head', 'chest', 'legs', 'feet')
WOODS = ('oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry')
FOOD = frozenset(('bread', 'apple', 'baked_potato', 'cooked_beef', 'cooked_porkchop',
                  'cooked_chicken', 'cooked_mutton', 'cooked_rabbit', 'cooked_cod',
                  'cooked_salmon', 'carrot', 'golden_carrot', 'golden_apple'))
FARM = frozenset(('wheat_seeds', 'beetroot_seeds', 'melon_seeds', 'pumpkin_seeds',
                  'wheat', 'carrot', 'potato', 'beetroot', 'sugar_cane', 'bone_meal'))
MATERIAL = frozenset(('cobblestone', 'cobbled_deepslate', 'stone', 'dirt', 'sand',
                     'gravel', 'glass', 'stick', 'coal', 'charcoal', 'raw_iron',
                     'raw_copper', 'raw_gold', 'iron_ingot', 'copper_ingot',
                     'gold_ingot', 'diamond', 'emerald', 'redstone', 'lapis_lazuli',
                     'string', 'leather', 'torch', 'crafting_table', 'furnace'))
TOOLS = frozenset(f'{tier}_{tool}' for tier in
                  ('wooden', 'stone', 'iron', 'golden', 'diamond', 'netherite')
                  for tool in ('pickaxe', 'axe', 'shovel', 'hoe', 'sword')) | {
                      'bow', 'crossbow', 'shield', 'bucket', 'water_bucket',
                      'shears', 'fishing_rod'}


def _obj(value):
    return value if isinstance(value, dict) else {}


def _rows(value):
    return value if isinstance(value, list) else []


def _number(value):
    return value if type(value) in (int, float) and abs(value) <= 1e15 and math.isfinite(value) else None


def _text(value, limit=100):
    return value[:limit] if isinstance(value, str) else ''


def _item(value):
    return value if isinstance(value, str) and len(value) <= 128 and ITEM.fullmatch(value) else None


def _fresh(observed, now, age=120000):
    if _number(observed) is None or _number(now) is None:
        return None
    return -30000 <= now - observed <= age


def _category(item):
    namespace, path = item.split(':', 1)
    if namespace != 'minecraft':
        return 'other'
    if path in TOOLS:
        return 'tools'
    # A carrot is both food and a crop. Keep one inventory entry; the model can
    # inspect its actual ID without double-counting it as two owned resources.
    if path in FARM:
        return 'agriculture'
    if path in FOOD:
        return 'food'
    if path in MATERIAL or any(path == wood + suffix for wood in WOODS for suffix in ('_log', '_planks')):
        return 'materials'
    return 'other'


def summarize_progression(snapshot, perception=None, environment=None, skill_catalog=None, now_ms=None):
    """Return JSON-safe facts (<=6 KiB); never decide which goal to undertake.

    Inputs are the gateway snapshot, WorldPerception view, cached observe result,
    and SkillLibrary.catalog(). Callers provide time to make freshness explicit;
    omitted time means unknown freshness, not a secretly refreshed observation.
    """
    body, heard, env, catalog = map(_obj, (snapshot, perception, environment, skill_catalog))
    body_ok = body.get('ok') is True
    counts = _obj(body.get('counts')) if body_ok else {}
    inventory_known = body_ok and isinstance(body.get('counts'), dict)
    categories = {key: [] for key in ('food', 'tools', 'materials', 'agriculture', 'other')}
    truncated = (len(counts) > 512 or len(_rows(body.get('ownedSkillBooks'))) > 12
                 or len(_rows(catalog.get('actionTools'))) > 32 or len(_rows(catalog.get('skills'))) > 64)
    ignored = 0
    valid = []
    for item, count in islice(counts.items(), 512):
        if not _item(item) or type(count) is not int or not 0 < count <= 1000000:
            ignored += 1
            continue
        valid.append((item, count))
    for item, count in sorted(valid):
        rows = categories[_category(item)]
        if len(rows) < 8:
            rows.append({'id': item, 'count': count})
        else:
            truncated = True

    equipment = []
    for slot in SLOTS:
        row = _obj(_obj(body.get('equipment')).get(slot)) if body_ok else {}
        if _item(row.get('item')):
            equipment.append({'slot': slot, 'id': row['item']})
    books = []
    for row in _rows(body.get('ownedSkillBooks'))[:12] if body_ok else []:
        if isinstance(row, dict) and row.get('recognized') is True and isinstance(row.get('skill_id'), str):
            book = {'id': _text(row['skill_id'], 100), 'recognized': True}
            for key in ('requiredLevel', 'count'):
                if _number(row.get(key)) is not None:
                    book[key] = row[key]
            if type(row.get('knownLearned')) is bool:
                book['knownLearned'] = row['knownLearned']
            books.append(book)

    actions = sorted({name for name in _rows(catalog.get('actionTools'))[:64]
                      if isinstance(name, str) and NAME.fullmatch(name)})[:32]
    programs = []
    for row in _rows(catalog.get('skills'))[:64]:
        if (isinstance(row, dict) and isinstance(row.get('name'), str) and NAME.fullmatch(row['name'])
                and isinstance(row.get('activeVersion'), str) and VERSION.fullmatch(row['activeVersion'])):
            programs.append({'name': row['name'], 'version': row['activeVersion']})
    if len(programs) > 8:
        truncated = True
    programs = programs[:8]

    world, growth = _obj(heard.get('world')), _obj(heard.get('progression'))
    board = []
    for row in _rows(world.get('board'))[:8] if world.get('available') is True else []:
        if not isinstance(row, dict):
            continue
        card = {key: _text(row.get(key), 80) for key in ('title', 'type', 'rank', 'status')}
        card.update({key: _number(row.get(key)) for key in ('no', 'reward', 'fame')})
        board.append(card)
    villagers = []
    if env.get('ok') is True:
        for row in _rows(env.get('entities'))[:20]:
            if not isinstance(row, dict) or row.get('type') not in ('minecraft:villager', 'minecraft:wandering_trader'):
                continue
            villagers.append({'type': row['type'], 'id': _number(row.get('id')),
                              'distance': _number(row.get('distance'))})
    progression = {'known': growth.get('available') is True, 'fresh': growth.get('fresh')
                   if type(growth.get('fresh')) is bool else None, 'source': _text(growth.get('source'), 60)}
    if progression['known']:
        for key in ('level', 'exp', 'mana', 'maxMana', 'learnedCount', 'passiveCount'):
            progression[key] = _number(growth.get(key))

    result = {
        'schema': 1, 'selectionAuthority': 'model', 'trustedInstructions': False,
        'body': {'known': body_ok, 'observedAt': _number(body.get('observedAt')),
                 'fresh': _fresh(body.get('observedAt'), now_ms),
                 'hp': _number(body.get('hp')) if body_ok else None,
                 'hunger': _number(body.get('hunger')) if body_ok else None},
        'resources': {'known': inventory_known, 'items': categories, 'ignoredEntries': ignored,
                      'classification': 'Vanilla hints only; other includes unknown mod items. Not recipes or harvest permissions.'},
        'equipment': {'known': body_ok and isinstance(body.get('equipment'), dict), 'slots': equipment},
        'capabilities': {'actionsKnown': isinstance(catalog.get('actionTools'), list), 'actionTools': actions,
                         'promotedPrograms': programs, 'ownedRecognizedBooks': books,
                         'notice': 'Tool exposure and program promotion do not prove live success, spell eligibility or sufficient materials.'},
        'progression': progression,
        'opportunities': {
            'guild': {'known': world.get('available') is True and isinstance(world.get('board'), list),
                      'fresh': world.get('boardFresh') is True, 'board': board,
                      'eligibilityKnown': False, 'contractProgressKnown': False},
            'villagers': {'known': env.get('ok') is True and isinstance(env.get('entities'), list),
                          'fresh': _fresh(env.get('observedAt'), now_ms), 'nearby': villagers[:4],
                          'scanTruncated': env.get('entitiesTruncated') is True or len(villagers) > 4,
                          'offersKnown': False},
            'landOwnershipKnown': False,
        },
        'truncated': truncated,
        'notice': 'Facts for choosing goals, not a mission or completed milestone. Missing/stale facts remain unknown. Nearby villagers do not establish offers; public notices do not authorize land or inventory access.'}
    # Bounded prompt cost even with long mod IDs, book IDs and multilingual board
    # titles. Preserve known/fresh flags while explicitly marking any shortening.
    lists = [*categories.values(), equipment, books, actions, programs, board,
             result['opportunities']['villagers']['nearby']]
    while len(json.dumps(result, ensure_ascii=False, allow_nan=False).encode('utf-8')) > MAX_BYTES:
        longest = max(lists, key=lambda rows: len(json.dumps(rows, ensure_ascii=False).encode('utf-8')) if rows else 0)
        if not longest:
            raise ValueError('progression_fixed_summary_exceeds_budget')
        longest.pop()
        result['truncated'] = True
    return result

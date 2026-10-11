"""Build our original, vanilla-block guild outpost and Simple Quests data pack.

Only writes repository-owned generated content; never edits a live world.
Third-party packs are separately hash-pinned and downloaded by society_content.py.
"""
from __future__ import annotations
import gzip
import json
from pathlib import Path
import struct

REPO = Path(__file__).resolve().parents[1]
PACK = REPO / 'world/society-datapacks/maw_life'


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf8')


def build_quests(content):
    write_json(PACK / 'pack.mcmeta', {'pack': {'pack_format': 48, 'description': 'My Agent World · 公会与旅途'}})
    for i, guild in enumerate(content['guilds']):
        write_json(PACK / f"data/maw/simplequests_api/category/{guild['id']}.json", {
            'name': guild['name'], 'description': [guild['description']], 'icon': guild['icon'],
            'sorting_id': i, 'max_concurrent_quests': 5, 'only_same_category': False,
            'is_visible': True, 'is_silent': False})
    for i, quest in enumerate(content['quests']):
        kind = quest['kind']
        task = {'id': 'simplequests_api:' + ('item' if kind == 'inspect' else 'predicates' if kind == 'structure' else kind),
                'description': quest['description']}
        if kind == 'structure':
            task.update(predicates=[{'value': {'location': {'structures': quest['structure']}}, 'description': quest['description']}], submit=False)
        else:
            field = 'item_predicates' if kind in ('crafting', 'fishing') else 'predicates'
            predicate = {'type': quest['entity']} if kind == 'kill' else {'items': quest['item']}
            task.update({field: [{'value': predicate}], 'amount': float(quest['amount'])})
            if kind in ('item', 'inspect'):
                task['consume_items'] = kind == 'item'
        write_json(PACK / f"data/maw/simplequests_api/quest/{quest['id']}.json", {
            'type': 'simplequests_api:quest', 'name': quest['name'], 'category': 'maw:' + quest['guild'],
            'icon': quest['item'], 'description': [quest['description'], f"奖励：{quest['money']} 灯币 / {quest['reputation']} 声望",
                '首次任务，只可完成一次。' if quest['repeatTicks'] < 0 else '完成后经过 24000 服务器 tick 可再接取；跳夜不缩短冷却。'],
            'sorting_id': i, 'repeat_delay': quest['repeatTicks'], 'parent_id': ['maw:' + p for p in quest.get('parents', [])],
            'loot_table': 'minecraft:empty',
            'command': 'function maw:rewards/' + quest['id'], 'tasks': {'objective': task}})
        reward = PACK / f"data/maw/function/rewards/{quest['id']}.mcfunction"
        reward.parent.mkdir(parents=True, exist_ok=True)
        # @s is the completing player's original command source, never @p.
        reward.write_text(f"eco addmoney @s[type=minecraft:player] {quest['money']}\n", encoding='utf8')
    # D&T 4.4.4's hidden trader triggers reference this missing root. Supply a
    # hidden compatibility root; keep the pinned upstream archive untouched.
    write_json(PACK / 'data/minecraft/advancement/root.json', {
        'criteria': {'compatibility_root': {'trigger': 'minecraft:impossible'}}})
    write_json(REPO / 'world/society-bridge-src/src/main/resources/maw-life-catalog.json', content)


# A tiny NBT writer avoids an extra build dependency and produces deterministic NBT.
def nbt_string(value):
    raw = value.encode('utf8')
    return struct.pack('>H', len(raw)) + raw


def nbt_payload(type_id, value):
    if type_id == 1: return struct.pack('>b', value)
    if type_id == 3: return struct.pack('>i', value)
    if type_id == 6: return struct.pack('>d', value)
    if type_id == 8: return nbt_string(value)
    if type_id == 9:
        entry_type, entries = value
        return bytes([entry_type]) + struct.pack('>i', len(entries)) + b''.join(nbt_payload(entry_type, e) for e in entries)
    if type_id == 10:
        return b''.join(bytes([t]) + nbt_string(k) + nbt_payload(t, v) for k, (t, v) in value.items()) + b'\0'
    raise ValueError(type_id)


def build_hall():
    blocks = {}
    def put(x, y, z, name, props=None, tag=None):
        blocks[x, y, z] = (name, props or {}, tag)
    def fill(x1, y1, z1, x2, y2, z2, name, props=None):
        for x in range(x1, x2 + 1):
            for y in range(y1, y2 + 1):
                for z in range(z1, z2 + 1): put(x, y, z, name, props)
    fill(0, 0, 0, 22, 0, 28, 'minecraft:cobblestone')
    fill(1, 0, 1, 21, 0, 27, 'minecraft:coarse_dirt')
    fill(2, 0, 5, 20, 0, 17, 'minecraft:spruce_planks')
    fill(3, 1, 6, 19, 5, 16, 'minecraft:air')
    for x in range(2, 21):
        for y in range(1, 6):
            for z in (5, 17): put(x, y, z, 'minecraft:white_terracotta')
    for z in range(5, 18):
        for y in range(1, 6):
            for x in (2, 20): put(x, y, z, 'minecraft:white_terracotta')
    for x in (2, 6, 11, 16, 20):
        for y in range(1, 6):
            for z in (5, 17): put(x, y, z, 'minecraft:stripped_spruce_log', {'axis': 'y'})
    for z in (9, 13):
        for y in range(1, 6):
            for x in (2, 20): put(x, y, z, 'minecraft:stripped_spruce_log', {'axis': 'y'})
    for x in (4, 8, 14, 18):
        for y in (2, 3): put(x, y, 5, 'minecraft:glass_pane')
    for z in (7, 11, 15):
        for y in (2, 3):
            for x in (2, 20): put(x, y, z, 'minecraft:glass_pane')
    fill(10, 1, 5, 12, 3, 5, 'minecraft:air')
    for layer in range(5):
        for x in range(1, 22):
            put(x, 6 + layer, 4 + layer, 'minecraft:deepslate_tile_stairs', {'facing': 'south', 'half': 'bottom', 'shape': 'straight', 'waterlogged': 'false'})
            put(x, 6 + layer, 18 - layer, 'minecraft:deepslate_tile_stairs', {'facing': 'north', 'half': 'bottom', 'shape': 'straight', 'waterlogged': 'false'})
    fill(1, 11, 9, 21, 11, 13, 'minecraft:deepslate_tiles')
    for x in (4, 9, 14, 18):
        put(x, 1, 15, 'minecraft:barrel', {'facing': 'up', 'open': 'false'})
        put(x, 1, 14, 'minecraft:spruce_slab', {'type': 'top', 'waterlogged': 'false'})
        put(x, 4, 14, 'minecraft:lantern', {'hanging': 'true', 'waterlogged': 'false'})
    for x, name in ((4, 'minecraft:crafting_table'), (6, 'minecraft:furnace'), (8, 'minecraft:cartography_table'), (10, 'minecraft:smithing_table')):
        put(x, 1, 7, name)
    for x in (14, 17):
        put(x, 1, 7, 'minecraft:chest', {'facing': 'south', 'type': 'single', 'waterlogged': 'false'},
            {'id': (8, 'minecraft:chest'), 'CustomName': (8, json.dumps({'text': '公会共享箱 · 可存可取'}, ensure_ascii=False)), 'Items': (9, (10, []))})
    for x in (3, 19):
        for z in (2, 20, 26): put(x, 1, z, 'minecraft:lantern', {'hanging': 'false', 'waterlogged': 'false'})
    for center, color in ((5, 'green'), (17, 'blue')):
        fill(center - 2, 1, 23, center + 2, 1, 23, 'minecraft:barrel', {'facing': 'up', 'open': 'false'})
        for x in (center - 2, center + 2):
            for z in (21, 24): fill(x, 1, z, x, 3, z, 'minecraft:spruce_fence')
        fill(center - 3, 4, 20, center + 3, 4, 25, 'minecraft:' + color + '_wool')
    palette, palette_index, rows = [], {}, []
    for pos, (name, props, tag) in sorted(blocks.items()):
        key = name, tuple(sorted(props.items()))
        if key not in palette_index:
            palette_index[key] = len(palette)
            row = {'Name': (8, name)}
            if props: row['Properties'] = (10, {k: (8, v) for k, v in sorted(props.items())})
            palette.append(row)
        row = {'pos': (9, (3, list(pos))), 'state': (3, palette_index[key])}
        if tag: row['nbt'] = (10, tag)
        rows.append(row)
    entities = []
    for x, z, role, name, profession in (
        (4, 15, 'adventure', '星灯 · 冒险委托', 'librarian'), (9, 15, 'engineer', '铜铃 · 工匠委托', 'toolsmith'),
        (14, 15, 'arcane', '月砂 · 秘法委托', 'cleric'), (18, 15, 'builder', '青石 · 营造委托', 'mason'),
        (5, 22, 'farmer', '麦穗 · 田园委托', 'farmer'), (11, 22, 'chef', '暖汤 · 料理委托', 'butcher'),
        (17, 22, 'market', '行商 · 市场与订单', 'weaponsmith')):
        entities.append({'pos': (9, (6, [x + .5, 1., z + .5])), 'blockPos': (9, (3, [x, 1, z])),
            'nbt': (10, {'id': (8, 'minecraft:villager'), 'CustomName': (8, json.dumps({'text': name}, ensure_ascii=False)),
                'CustomNameVisible': (1, 1), 'Invulnerable': (1, 1), 'PersistenceRequired': (1, 1), 'NoAI': (1, 1),
                'Tags': (9, (8, ['maw_guild_npc', 'maw_role_' + role])),
                'VillagerData': (10, {'profession': (8, 'minecraft:' + profession), 'level': (3, 2), 'type': (8, 'minecraft:plains')})})})
    root = {'DataVersion': (3, 3955), 'size': (9, (3, [23, 12, 29])), 'palette': (9, (10, palette)),
        'blocks': (9, (10, rows)), 'entities': (9, (10, entities))}
    target = PACK / 'data/maw/structure/guild_hall.nbt'; target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(gzip.compress(b'\x0a\0\0' + nbt_payload(10, root), mtime=0))
    write_json(PACK / 'data/maw/worldgen/template_pool/guild_hall.json', {'name': 'maw:guild_hall', 'fallback': 'minecraft:empty', 'elements': [
        {'weight': 1, 'element': {'element_type': 'minecraft:single_pool_element', 'location': 'maw:guild_hall', 'processors': 'minecraft:empty', 'projection': 'rigid'}}]})
    write_json(PACK / 'data/maw/worldgen/structure/guild_hall.json', {'type': 'minecraft:jigsaw', 'biomes': '#maw:has_guild_hall',
        'step': 'surface_structures', 'spawn_overrides': {}, 'terrain_adaptation': 'beard_thin', 'start_pool': 'maw:guild_hall',
        'size': 1, 'start_height': {'absolute': 0}, 'project_start_to_heightmap': 'WORLD_SURFACE_WG',
        'max_distance_from_center': 80, 'use_expansion_hack': False})
    write_json(PACK / 'data/maw/worldgen/structure_set/guild_halls.json', {'structures': [{'structure': 'maw:guild_hall', 'weight': 1}],
        'placement': {'type': 'minecraft:random_spread', 'spacing': 36, 'separation': 20, 'salt': 141092611, 'spread_type': 'linear'}})
    write_json(PACK / 'data/maw/tags/worldgen/biome/has_guild_hall.json', {'replace': False, 'values': [
        'minecraft:plains', 'minecraft:meadow', 'minecraft:sunflower_plains', 'minecraft:forest', 'minecraft:cherry_grove', 'minecraft:birch_forest']})
    write_json(PACK / 'data/maw/tags/worldgen/structure/guild_halls.json', {'values': ['maw:guild_hall']})
    # Dungeoneer 1.0.3's old templates reference dungeoneer:hallways, but its
    # shipped registry renamed that pool. Redirect the jigsaw alias only;
    # preserve the upstream structure dimensions, placement, biome and loot.
    write_json(PACK / 'data/dungeoneer/worldgen/structure/cobblestone_dungeon.json', {
        'type': 'minecraft:jigsaw', 'start_pool': 'dungeoneer:cobblestone_dungeon',
        'size': 20, 'max_distance_from_center': 116, 'spawn_overrides': {},
        'step': 'strongholds', 'terrain_adaptation': 'bury',
        'start_height': {'type': 'minecraft:uniform', 'min_inclusive': {'absolute': 32}, 'max_inclusive': {'absolute': 52}},
        'biomes': '#dungeoneer:modded_biomes_b', 'use_expansion_hack': False, 'liquid_settings': 'ignore_waterlogging',
        'pool_aliases': [{'type': 'minecraft:direct', 'alias': 'dungeoneer:hallways', 'target': 'dungeoneer:cobblestone_dungeon_hallways'}]})

    # The 1.21.1 T&T lighthouse template names this pool but omits its JSON.
    # Point it at the shipped keeper template, preserving the original entity.
    write_json(PACK / 'data/kaisyn/worldgen/template_pool/village/beach_lighthouse/villager_lighthouse_master.json', {
        'name': 'kaisyn:village/beach_lighthouse/villager_lighthouse_master', 'fallback': 'minecraft:empty',
        'elements': [{'weight': 1, 'element': {'element_type': 'minecraft:single_pool_element',
            'location': 'kaisyn:village/beach_lighthouse/villagers/lighthouse_master',
            'processors': 'minecraft:empty', 'projection': 'rigid'}}]})



def main():
    content = json.loads((REPO / 'config/maw-life-content.json').read_text('utf8'))
    assert len(content['quests']) <= 24 and len({q['id'] for q in content['quests']}) == len(content['quests'])
    build_quests(content); build_hall()
    print(json.dumps({'ok': True, 'quests': len(content['quests']), 'guilds': len(content['guilds']) - 1, 'pack': str(PACK)}))


if __name__ == '__main__': main()

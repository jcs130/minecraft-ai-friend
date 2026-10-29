"""Prepare bounded city protection using the existing WorldGuard/BlockAccess policy.

Pure transformations only: callers back up, validate and explicitly reload the
running service. The original map and private player data are not redistributed.
"""
from copy import deepcopy
import math

WORLD = 'aincrad'
REGION = 'qd_aincrad_map'
CENTER = (-584, 934)
RADIUS = 366  # Includes the original walls and moat, not the surrounding fields.
POINTS = [dict(x=round(CENTER[0] + RADIUS / math.cos(math.pi / 64) * math.cos(i * math.tau / 64)),
               z=round(CENTER[1] + RADIUS / math.cos(math.pi / 64) * math.sin(i * math.tau / 64))) for i in range(64)]
BOUNDS = {'min-x': min(p['x'] for p in POINTS), 'min-z': min(p['z'] for p in POINTS),
          'max-x': max(p['x'] for p in POINTS), 'max-z': max(p['z'] for p in POINTS)}


def block_policy(current):
    result = deepcopy(current)
    if current.get('schema-version') != 1 or current.get('enabled') is not True:
        raise ValueError('An enabled, validated block policy is required')
    if sum(row.get('world') == WORLD for row in current.get('villages', [])) != 1:
        raise ValueError('Review the existing Aincrad retained areas before changing them')
    result['villages'] = [dict(world=WORLD, **BOUNDS) if row.get('world') == WORLD else row
                          for row in result['villages']]
    return result


def city_regions(current):
    result = deepcopy(current)
    if REGION not in result.get('regions', {}):
        raise ValueError('The original authored-map region is missing')
    region = result['regions'][REGION]
    for key in ('min', 'max'):
        region.pop(key, None)
    region.update(type='poly2d', **{'min-y': -64, 'max-y': 319, 'points': deepcopy(POINTS)})
    flags = region.setdefault('flags', {})
    # BUILD must agree with the existing AgentFriend preflight. Explicit
    # BLOCK_BREAK still denies demolition in both WorldGuard and that preflight.
    flags.update({'build': 'allow', 'block-break': 'deny', 'block-place': 'allow', 'lighter': 'deny',
                  'deny-message': '§e[起始之城] 城区可放置，不能拆毁；城外可挖掘建造，副本建筑另受保护。',
                  'greeting': '§6[起始之城] 城内可放置、不可拆；城外自由挖掘建造。/aincrad'})
    # BlockAccess reserves a rectangular envelope; the city follows its round
    # walls. Explicitly open the four remaining corners. Without these regions,
    # WorldGuard's whole-world editor domain can still deny ordinary players.
    quadrants = [('se', 0, 16, BOUNDS['max-x'], BOUNDS['max-z']),
                 ('sw', 16, 32, BOUNDS['min-x'], BOUNDS['max-z']),
                 ('nw', 32, 48, BOUNDS['min-x'], BOUNDS['min-z']),
                 ('ne', 48, 64, BOUNDS['max-x'], BOUNDS['min-z'])]
    for suffix, start, end, x, z in quadrants:
        points = [POINTS[start], {'x': x, 'z': z}, POINTS[end % 64], *reversed(POINTS[start + 1:end])]
        result['regions']['qd_aincrad_outside_' + suffix] = {
            'type': 'poly2d', 'min-y': -64, 'max-y': 319, 'points': deepcopy(points),
            'priority': region['priority'], 'members': {}, 'owners': {},
            'flags': {'passthrough': 'allow', 'build': 'allow', 'block-break': 'allow', 'block-place': 'allow'}}
    return result


def guide_script(current):
    old = '地图建筑禁止拆建、倒水倒岩浆和爆破；可以开门、开箱、探索与战斗。个人箱：/mycli arena stash（已学travel，成功开页耗2魔力）。'
    if current.count(old) != 1:
        raise ValueError('Review the current travel guide rather than overwriting unknown text')
    result = current.replace(old, '起始之城内可放置物品和方块，不能拆毁建筑地面；城外可正常挖掘建造。副本建筑继续保护。个人箱：/mycli arena stash。')
    lines = result.splitlines()
    for i, line in enumerate(lines):
        if line.startswith('  - narrate ') and '未学则 /mycli skills learn travel（1技能点）' in line:
            lines[i] = '  - narrate "<gray>传送资格与魔力按 /mycli status 和 /mycli guide magic 查询；成功传送耗6魔力，失败按当次回执修正，不反复重发。"'
    return '\n'.join(lines) + '\n'

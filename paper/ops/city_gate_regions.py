"""Plan only: keep WorldGuard gate footprints aligned with the live gate config.

Apply the reviewed region delta using the existing WorldGuard maintenance path.
Never replace unrelated regions or weaken a city's general protection.
"""
from copy import deepcopy


def plan(config, worlds):
    gates = config.get('city-gates', {})
    if gates.get('enabled') is not True:
        raise ValueError('City gates must be explicitly enabled')
    result = deepcopy(worlds)
    for gate_id in ('village', 'aincrad'):
        gate = gates[gate_id]
        world = gate['world']
        if world not in result or not all(type(gate[k]) is int for k in ('x', 'y', 'z')):
            raise ValueError('Existing world and integer coordinates required')
        x, y, z = (gate[k] for k in ('x', 'y', 'z'))
        if abs(x) > 29_999_980 or abs(z) > 29_999_980 or not -63 <= y <= 316:
            raise ValueError('Gate footprint outside world')
        regions = result[world]['regions']
        key = 'qd_vortex_' + gate_id + '_gate'
        region = deepcopy(regions.get(key, {}))
        if region.get('type', 'cuboid') != 'cuboid' or region.get('parent'):
            raise ValueError('Review non-cuboid or inherited gate region first')
        region.update(type='cuboid', min={'x': x-1, 'y': y-1, 'z': z},
                      max={'x': x+3, 'y': y+3, 'z': z+2}, priority=1_000_001)
        region.setdefault('owners', {})
        region.setdefault('members', {})
        flags = region.setdefault('flags', {})
        flags.update({name: 'deny' for name in ('block-break', 'block-place', 'pistons',
            'other-explosion', 'creeper-explosion', 'tnt', 'ghast-fireball', 'wither-damage',
            'enderman-grief', 'ravager-grief', 'fire-spread', 'lava-fire', 'water-flow', 'lava-flow')})
        flags.update({'block-break-group': 'ALL', 'block-place-group': 'ALL',
            'passthrough': 'allow', 'use': 'allow', 'interact': 'allow',
            'deny-message': '双城门、地基和说明牌受保护；请以生存/冒险模式右键左柱按钮，成功消耗6魔力。'})
        regions[key] = region
    return result

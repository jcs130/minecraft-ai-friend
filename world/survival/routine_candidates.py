"""Routine behaviour candidates for the fast loop (shadow first).

Locally verified candidates for simple behaviours: the generator only
reads the observed body snapshot, never the world. Jev picks among
them; the controller alone owns execution. This is not a second agent
loop and adds no IO of its own.

Design references: docs/JEV-FAST-LOOP-DESIGN.md (phase 2 "meaningful
short strategies"), docs/JEV-ASTRA-MINECRAFT-CODE-REVIEW.md (stage
candidates from real inventory and position). Preconditions are
checked here so the model never has to invent facts; every action
carries concrete args the gateway can verify again at execution time.
"""
FOOD_IDS = ('minecraft:cooked_porkchop', 'minecraft:cooked_beef', 'minecraft:bread',
            'minecraft:baked_potato', 'minecraft:cooked_chicken', 'minecraft:cooked_mutton',
            'minecraft:apple', 'minecraft:carrot', 'minecraft:sweet_berries')
TOOL_IDS = ('minecraft:diamond_sword', 'minecraft:iron_sword', 'minecraft:stone_sword',
            'minecraft:wooden_sword', 'minecraft:diamond_axe', 'minecraft:iron_axe',
            'minecraft:stone_axe', 'minecraft:wooden_axe')
MAX_STEP = 24  # his own travel note: one move leg is at most 24 blocks
GOTO_MIN_DISTANCE = 64


def _number(value):
    return value if type(value) in (int, float) and value == value else None


def _first_present(counts, wanted):
    for item in wanted:
        if counts.get(item, 0) > 0:
            return item
    return None


def build_candidates(body, goal='', navigation_target=None, limit=6):
    """Return a validate_choice-shaped proposal, or None when nothing applies.

    Only locally checkable facts become candidates; "none" is always an
    exit so the classifier can decline without inventing an action.
    navigation_target replaces the old static anchor: the fast loop only
    offers to CONTINUE an active navigation chosen by the slow brain,
    never to pick a new destination on its own (JevPilot/Voyager design:
    fast loop = continue/interrupt/repair, not where-to-go).
    """
    if not isinstance(body, dict) or body.get('ok') is not True:
        return None
    counts = body.get('counts') if isinstance(body.get('counts'), dict) else {}
    candidates = []
    hunger = _number(body.get('hunger'))
    hp = _number(body.get('hp'))
    max_hp = _number(body.get('maxHp'))
    food = _first_present(counts, FOOD_IDS)
    if food:
        food_name = food.split(':', 1)[-1]
        if hunger is not None and hunger <= 13:
            candidates.append({'id': 'eat_food',
                'description': f'Hunger {hunger:.0f}/20 and {food_name} in bag; eat one now.',
                'action': {'tool': 'eat', 'args': {'item_id': food}}})
        if hp is not None and max_hp and hp <= max_hp * 0.6:
            candidates.append({'id': 'eat_heal',
                'description': f'HP {hp:.0f}/{max_hp:.0f}; eat {food_name} to regenerate.',
                'action': {'tool': 'eat', 'args': {'item_id': food}}})
    equipment = body.get('equipment') if isinstance(body.get('equipment'), dict) else {}
    mainhand = equipment.get('mainhand') if isinstance(equipment.get('mainhand'), dict) else {}
    if not mainhand.get('item'):
        tool = _first_present(counts, TOOL_IDS)
        if tool:
            candidates.append({'id': 'equip_tool',
                'description': f'Mainhand empty and {tool.split(":", 1)[-1]} in bag; hold it.',
                'action': {'tool': 'equip_item', 'args': {'item_id': tool, 'slot': 'mainhand'}}})
    # goto_leg: only when the slow brain already set a navigation destination.
    # The fast loop CONTINUES that path; it never picks where to go.
    position = body.get('position') if isinstance(body.get('position'), dict) else {}
    target = (navigation_target if isinstance(navigation_target, dict)
              and {'x', 'z'} <= set(navigation_target) else None)
    px, pz = _number(position.get('x')), _number(position.get('z'))
    if target and px is not None and pz is not None:
        dx = _number(target.get('x')) - px if _number(target.get('x')) is not None else None
        dz = _number(target.get('z')) - pz if _number(target.get('z')) is not None else None
        if dx is not None and dz is not None:
            dist = (dx * dx + dz * dz) ** .5
            if dist > GOTO_MIN_DISTANCE:
                scale = min(1.0, MAX_STEP / dist)
                candidates.append({'id': 'goto_leg',
                    'description': (f'Active navigation destination {dist:.0f} blocks away; '
                                    f'walk one bounded {MAX_STEP}-block leg toward it.'),
                    'action': {'tool': 'goto',
                               'args': {'x': round(px + dx * scale, 1), 'z': round(pz + dz * scale, 1)}}})
    # 5) Place torch in dark area (creator request: see in the dark)
    #    Triggered when underground (y < 60) or world time is night
    py = _number(position.get('y', 64)) if isinstance(position, dict) else None
    is_underground = py is not None and py < 60
    # Check if it's night (worldTime 13000-23000 is night in MC)
    world_time = body.get('worldTime', 0)
    is_night = isinstance(world_time, (int, float)) and 12542 <= world_time <= 23459
    if is_underground or is_night:
        torch_count = counts.get('minecraft:torch', 0)
        if torch_count > 0:
            # Place at current position + 1 up (standard torch placement)
            px_t = _number(position.get('x', 0)) if isinstance(position, dict) else 0
            pz_t = _number(position.get('z', 0)) if isinstance(position, dict) else 0
            candidates.append({'id': 'place_torch',
                'description': f'Dark area detected ({"underground y=" + str(int(py)) if is_underground else "nighttime"}). Place a torch at current position to light the area.',
                'action': {'tool': 'place_block',
                           'args': {'block': 'minecraft:torch',
                                    'x': round(px_t), 'y': round(py + 1) if py else 64,
                                    'z': round(pz_t)}}})

    if not candidates:
        return None
    candidates.append({'id': 'none',
        'description': 'No routine behaviour is worth doing now; leave it to the planner.',
        'action': None})
    return {'question': ('Which routine behaviour fits the body right now? Pick one only if its '
                         'precondition holds and it serves survival or the current goal; otherwise '
                         'none. Goal: ' + str(goal)[:200]),
            'candidates': candidates[:limit + 1]}

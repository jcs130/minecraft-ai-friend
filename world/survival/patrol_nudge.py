"""Patrol nudge: detect agents that haven't used skills, are dying repeatedly,
or are in danger — and proactively help them.

The patrol decision uses Jev (SystemOne) for fast classification (<300ms).
Candidates use action=None (classification only, not body action proposals) —
the controller maps the chosen candidate ID back to a patrol action.

This module is read-only for world state.
"""
import json
import os
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

SKILL_NUDGES = {
    'voice_speak': {
        'check': 'voice_speak',
        'message': '你知道吗？打 /mycli voice_speak <想说的话> 就能开口说话，附近的人都能听到你的声音！还能选嗓音：voice=kirito tone=happy',
        'cooldown_hours': 24,
    },
    'cast': {
        'check': 'cast',
        'message': '提示：打 /mycli spells 看你能放什么法术；/mycli cast <法术名> 直接施放。',
        'cooldown_hours': 12,
    },
    'goto': {
        'check': 'goto',
        'message': '迷路了？打 /mycli goto shared:1 回广场；/mycli waypoint add 家 记住当前位置。',
        'cooldown_hours': 6,
    },
    'cultivate': {
        'check': 'cultivate',
        'message': '变强秘诀：/mycli cultivate combat 灌顶加经验（60秒一次）。',
        'cooldown_hours': 24,
    },
}

DANGER_THRESHOLDS = {
    'deaths_same_spot': 3,
    'hp_low_threshold': 8,
    'hunger_low_threshold': 6,
}


def build_patrol_candidates(players, deaths, episodes, skill_usage):
    """Generate patrol candidates for Jev classification.

    All candidates use action=None (classification only). The controller
    maps the chosen ID back to a patrol action after Jev decides.

    Returns a validate_choice-compatible proposal or None.
    """
    if not isinstance(players, list) or not players:
        return None
    candidates = []
    now = time.time()

    for player in players:
        name = player.get('name', '')
        if not name or not player.get('online'):
            continue

        # 1) Unused skill nudges
        used = skill_usage.get(name, {}) if isinstance(skill_usage, dict) else {}
        for skill_id, nudge in SKILL_NUDGES.items():
            last_used = used.get(skill_id, 0)
            if now - last_used > nudge['cooldown_hours'] * 3600:
                candidates.append({
                    'id': f'nudge_{name}_{skill_id}',
                    'description': f'{name} has never used {skill_id}. Send a helpful tip via whisper.',
                    'action': None,
                })

        # 2) Danger: low HP
        hp = player.get('hp', 20)
        if isinstance(hp, (int, float)) and hp <= DANGER_THRESHOLDS['hp_low_threshold']:
            candidates.append({
                'id': f'danger_hp_{name}',
                'description': f'{name} has HP {hp}/20 — dangerously low. Send urgent help.',
                'action': None,
            })

        # 3) Danger: low hunger
        hunger = player.get('hunger', 20)
        if isinstance(hunger, (int, float)) and hunger <= DANGER_THRESHOLDS['hunger_low_threshold']:
            candidates.append({
                'id': f'danger_hunger_{name}',
                'description': f'{name} has hunger {hunger}/20 — starving. Remind to eat.',
                'action': None,
            })

    # 4) Repeated deaths at same location
    death_locations = {}
    for death in deaths if isinstance(deaths, list) else []:
        pos = death.get('position') or {}
        key = (round(pos.get('x', 0) / 10), round(pos.get('z', 0) / 10))
        death_locations.setdefault(key, []).append(death)

    for key, deaths_at in death_locations.items():
        if len(deaths_at) >= DANGER_THRESHOLDS['deaths_same_spot']:
            victims = set(d.get('bodyName', '') for d in deaths_at)
            candidates.append({
                'id': f'fix_hole_{key[0]}_{key[1]}',
                'description': (f'{len(deaths_at)} deaths near ({key[0]*10}, {key[1]*10}). '
                                f'Likely a hazard. Fill and place torch.'),
                'action': None,
            })

    if not candidates:
        return None
    candidates.append({
        'id': 'none',
        'description': 'No patrol action needed right now.',
        'action': None,
    })
    return {
        'question': ('Which patrol situation is most urgent right now? '
                     f'Players online: {len(players)}. Candidates: {len(candidates)-1}. '
                     'Pick one, or none if all is calm.'),
        'candidates': candidates[:8],
    }


def get_patrol_action(candidate_id):
    """Map a chosen candidate ID to a patrol action dict.

    Returns {'type': 'whisper', 'target': ..., 'text': ...} for nudges,
    or {'type': 'escalate', 'reason': ...} for hazards, or None.
    """
    if not isinstance(candidate_id, str) or candidate_id in ('none', ''):
        return None

    if candidate_id.startswith('nudge_'):
        # Skill ID is the suffix — target is everything between nudge_ and the skill suffix
        for skill_id in SKILL_NUDGES:
            suffix = f'_{skill_id}'
            if candidate_id.endswith(suffix):
                target = candidate_id[len('nudge_'):-len(suffix)]
                nudge = SKILL_NUDGES[skill_id]
                if target and nudge.get('message'):
                    return {'type': 'whisper', 'target': target, 'text': nudge['message']}

    if candidate_id.startswith('danger_hp_'):
        target = candidate_id[len('danger_hp_'):]
        return {'type': 'whisper', 'target': target,
                'text': '你快没血了！快吃点东西或找个安全的地方躲一躲。'}

    if candidate_id.startswith('danger_hunger_'):
        target = candidate_id[len('danger_hunger_'):]
        return {'type': 'whisper', 'target': target,
                'text': '肚子快空了！有食物的话快吃。'}

    if candidate_id.startswith('fix_hole_'):
        coords = candidate_id[len('fix_hole_'):]
        return {'type': 'escalate',
                'reason': f'Fill hazard at ({coords.replace("_", ", ")}) — repeated deaths'}

    return None


def get_skill_usage_from_chronicle(chronicle_rows, player_names):
    """Parse chronicle rows to build skill_usage map."""
    usage = {name: {} for name in player_names}
    for row in chronicle_rows:
        actor = row.get('actor') or row.get('username') or ''
        skill = row.get('skill') or row.get('verb') or row.get('type') or ''
        ts = row.get('ts') or row.get('at') or 0
        if actor in usage and skill:
            usage[actor][skill] = max(usage[actor].get(skill, 0), ts)
    return usage


if __name__ == '__main__':
    players = [
        {'name': 'Kirito', 'online': True, 'hp': 20, 'hunger': 20, 'position': {'x': -153, 'z': 871}},
        {'name': 'ag_corti', 'online': True, 'hp': 6, 'hunger': 4, 'position': {'x': -540, 'z': 860}},
    ]
    deaths = [
        {'bodyName': 'Kirito', 'position': {'x': -100, 'z': 900}, 'at': time.time() - 3600},
        {'bodyName': 'Kirito', 'position': {'x': -102, 'z': 898}, 'at': time.time() - 1800},
        {'bodyName': 'ag_corti', 'position': {'x': -101, 'z': 899}, 'at': time.time() - 900},
    ]
    skill_usage = {'Kirito': {'cast': time.time()}, 'ag_corti': {}}

    proposal = build_patrol_candidates(players, deaths, [], skill_usage)
    if proposal:
        from system_one import validate_choice
        try:
            validate_choice(proposal)
            print(f'✓ validate_choice 通过 — {len(proposal["candidates"])} 候选')
        except ValueError as e:
            print(f'✗ validate_choice 失败: {e}')
            c = proposal['candidates'][0]
            print(f'  字段: {sorted(c.keys())}')
        for c in proposal['candidates']:
            action = get_patrol_action(c['id'])
            print(f'  {c["id"]:40s} → {action["type"] if action else "none"}')
    else:
        print('(无候选)')

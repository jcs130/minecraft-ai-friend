"""Patrol nudge: detect agents that haven't used skills, are dying repeatedly,
or are in danger — and proactively help them.

The patrol decision uses Jev (SystemOne) for fast classification (<300ms)
instead of a full LLM round-trip. Complex cases escalate to mc-herald.

This module is deliberately read-only for world state: it observes,
classifies, and emits nudges through the goddess whisper channel.
It never modifies the world directly (fill/give are escalated to
tools that have the authority).
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
        'message': '提示：打 /mycli spells 看你能放什么法术；/mycli cast <法术名> 直接施放。新手先试 /mycli cast irons_spellbooks:firebolt',
        'cooldown_hours': 12,
    },
    'goto': {
        'check': 'goto',
        'message': '迷路了？打 /mycli goto shared:1 回广场；/mycli waypoint add 家 记住当前位置，以后 /mycli goto 家 一秒回家',
        'cooldown_hours': 6,
    },
    'cultivate': {
        'check': 'cultivate',
        'message': '变强秘诀：/mycli cultivate combat 灌顶加经验（60秒一次），/mycli growth combat 看进度',
        'cooldown_hours': 24,
    },
}

DANGER_THRESHOLDS = {
    'deaths_same_spot': 3,      # 同坐标死 3 次 = 可能有坑
    'hp_low_threshold': 8,      # HP < 8 = 危险
    'hunger_low_threshold': 6,  # 饥饿 < 6 = 该吃东西了
}


def build_patrol_candidates(players, deaths, episodes, skill_usage):
    """Generate patrol candidates from local facts. No IO, no world access.

    players: [{name, hp, hunger, position, online}]
    deaths: [{bodyName, position, at, cause}]
    episodes: recent action log entries
    skill_usage: {player_name: {skill_id: last_used_timestamp}}
    """
    candidates = []
    now = time.time()

    for player in players:
        name = player.get('name', '')
        if not name or not player.get('online'):
            continue

        # 1) Unused skill nudges
        used = skill_usage.get(name, {})
        for skill_id, nudge in SKILL_NUDGES.items():
            last_used = used.get(skill_id, 0)
            if now - last_used > nudge['cooldown_hours'] * 3600:
                candidates.append({
                    'id': f'nudge_{name}_{skill_id}',
                    'description': f'{name} has never used {skill_id} (or >{nudge["cooldown_hours"]}h ago). Send a helpful tip.',
                    'action': {'type': 'whisper', 'target': name, 'text': nudge['message']},
                    'priority': 'low',
                })

        # 2) Danger: low HP
        hp = player.get('hp', 20)
        if isinstance(hp, (int, float)) and hp <= DANGER_THRESHOLDS['hp_low_threshold']:
            candidates.append({
                'id': f'danger_hp_{name}',
                'description': f'{name} has HP {hp}/20 — dangerously low. Send urgent help tip.',
                'action': {'type': 'whisper', 'target': name,
                           'text': f'你只剩 {hp} 点血了！快吃点东西（打 /mycli cast heal 或找安全地方躲一躲）'},
                'priority': 'urgent',
            })

        # 3) Danger: low hunger
        hunger = player.get('hunger', 20)
        if isinstance(hunger, (int, float)) and hunger <= DANGER_THRESHOLDS['hunger_low_threshold']:
            candidates.append({
                'id': f'danger_hunger_{name}',
                'description': f'{name} has hunger {hunger}/20 — starving. Remind them to eat.',
                'action': {'type': 'whisper', 'target': name,
                           'text': f'肚子只剩 {hunger}/20 了！有食物的话快吃（打 /mycli cast feed 或找村民买面包）'},
                'priority': 'high',
            })

    # 4) Repeated deaths at same location
    death_locations = {}
    for death in deaths:
        pos = death.get('position') or {}
        key = (round(pos.get('x', 0) / 10), round(pos.get('z', 0) / 10))  # 10-block clusters
        death_locations.setdefault(key, []).append(death)

    for key, deaths_at in death_locations.items():
        if len(deaths_at) >= DANGER_THRESHOLDS['deaths_same_spot']:
            victims = set(d.get('bodyName', '') for d in deaths_at)
            candidates.append({
                'id': f'fix_hole_{key[0]}_{key[1]}',
                'description': (f'{len(deaths_at)} deaths near ({key[0]*10}, {key[1]*10}). '
                                f'Likely a hazard. Victims: {", ".join(list(victims)[:3])}.'),
                'action': {'type': 'escalate',
                           'reason': f'Fill hazard at ({key[0]*10}, {key[1]*10}) — {len(deaths_at)} deaths',
                           'tool': 'fill_and_torch'},
                'priority': 'high',
            })

    if not candidates:
        return None

    # Add "none" exit
    candidates.append({
        'id': 'none',
        'description': 'No patrol action needed right now.',
        'action': None,
    })

    return {
        'question': ('Which patrol action is most urgent right now? Pick one. '
                     'Low priority nudges can wait if urgent issues exist. '
                     f'Players online: {len(players)}. Candidates: {len(candidates)-1}.'),
        'candidates': candidates[:8],  # Max 8 per Jev call
    }


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
    # Smoke test with synthetic data
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
        print(f'Candidates ({len(proposal["candidates"])}):')
        for c in proposal['candidates']:
            print(f'  [{c.get("priority", "?"):6s}] {c["id"]}: {c["description"][:80]}')
    else:
        print('No candidates (all quiet)')

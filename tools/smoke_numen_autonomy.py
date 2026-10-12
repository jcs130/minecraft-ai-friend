"""Opt-in real-model goals for the isolated Numen integration harness.

The upstream AgentLoop plans and executes; this module supplies labelled test
fixtures, observes durable outcomes, and enforces a finite observation budget.
It never directs the model's tool sequence or repairs a failed goal with cheats.
"""
from __future__ import annotations

from datetime import datetime, timezone
import json
import math
from pathlib import Path
import subprocess
import time
import uuid


def private_key(path):
    value = json.loads(path.read_text('utf-8'))
    if value.get('base_url', '').rstrip('/') != 'https://coding.dashscope.aliyuncs.com/v1':
        raise ValueError('Expected the existing private CodingPlan credential')
    key = value.get('api_key', '')
    if not isinstance(key, str) or not key:
        raise ValueError('CodingPlan key missing')
    if not key.startswith('sk-'):
        # Reuse the installed secret-store reader, without running a QwenPaw
        # agent or printing the decrypted result to the tool/terminal output.
        python = Path.home()/'.qwenpaw/venv/Scripts/python.exe'
        result = subprocess.run([str(python), '-c',
            'import json,sys;from qwenpaw.security.secret_store import decrypt;'
            'sys.stdout.write(decrypt(json.load(open(sys.argv[1],encoding="utf-8"))["api_key"]))',
            str(path)], capture_output=True, text=True, timeout=20)
        if result.returncode or not result.stdout.startswith('sk-'):
            raise ValueError('Private CodingPlan credential could not be decrypted')
        key = result.stdout.strip()
    return key


GOALS = ('navigation', 'survival_tools', 'chest_deposit', 'chest_withdraw',
    'farmers_delight_cooking', 'create_milling', 'ars_native_healing')


def run(tool, ui, console, server, output, owner, credential_file, report, selected_goals=None, goal_model_budget=24):
    selected_goals = set(selected_goals or GOALS)
    if not selected_goals or selected_goals - set(GOALS): raise ValueError('Unknown autonomy goal')
    key = private_key(credential_file)
    evidence = {'schemaVersion': 1, 'startedAt': datetime.now(timezone.utc).isoformat(),
        'provider': 'codingplan', 'model': 'qwen3.7-plus', 'framework': 'upstream Numen AgentLoop/SerialCalls',
        'bodyProvider': 'native NumenPlayer', 'qwenpawConnected': False,
        'naturalSurvivalVerified': False, 'fixtures': [], 'goals': [], 'modelRequests': 0,
        'productionWorldActions': 0, 'selectedGoals': [g for g in GOALS if g in selected_goals],
        'allDefaultGoalsRequested': selected_goals == set(GOALS), 'goalModelBudget': goal_model_budget, 'ok': False}
    path = output/'live-autonomy.json'

    def save():
        path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding='utf-8')

    def fixture(command):
        evidence['fixtures'].append(command)
        console(command)
        save()
        time.sleep(.12)

    def state(): return tool('get_state', {'companion': body})
    def count(s, item): return sum(v.get('count', 0) for v in s.get('inventory', []) if v.get('id') == item)
    def chest_count(s, item):
        menu = s.get('menu', {})
        if menu.get('containerId', 0) <= 0 or menu.get('slotCount') != 63:
            return -1
        return sum(v.get('count', 0) for v in menu.get('slots', [])[:27] if v.get('id') == item)
    def brief(s):
        return {k: s[k] for k in ('bodyId', 'status', 'online', 'position', 'dimension', 'health',
            'food', 'hunger', 'inventory', 'menu', 'equipment', 'currentAction', 'brain', 'blocked') if k in s}

    created = tool('create_companion', {'name': 'MawAutoBody', 'action_id': 'live-create-'+uuid.uuid4().hex})
    if not created.get('online'): raise RuntimeError('Isolated autonomy body creation failed')
    body = created['bodyId']; evidence['bodyId'] = body
    selected = ui('profile.save', {'profileId': 'live_qa', 'name': '线上自主验收', 'provider': 'openai',
        'model': 'qwen3.7-plus', 'baseUrl': 'https://coding.dashscope.aliyuncs.com/v1', 'apiKey': key})
    if not selected['profile']['keyConfigured'] or 'apiKey' in selected['profile']:
        raise RuntimeError('Private model profile validation failed')
    del key
    ui('settings', {'companion': body, 'driver': 'hosted', 'profileId': 'live_qa', 'permissionMode': 'bypass'})
    initial = state(); evidence['initial'] = brief(initial)
    x, y, z = (math.floor(initial['position'][axis]) for axis in ('x', 'y', 'z'))
    fixture('gamerule doDaylightCycle false'); fixture('time set day')
    fixture('gamerule doMobSpawning false'); fixture('gamerule naturalRegeneration false')
    fixture('difficulty easy')
    fixture(f'fill {x+3} {y} {z-1} {x+3} {y+2} {z+2} minecraft:cobblestone')
    for dx in (11, 14):
        fixture(f'fill {x+dx} {y} {z+6} {x+dx} {y+3} {z+6} minecraft:oak_log[axis=y]')
        fixture(f'fill {x+dx-1} {y+4} {z+5} {x+dx+1} {y+4} {z+7} minecraft:oak_leaves[persistent=true]')
    fixture(f'fill {x+12} {y} {z+10} {x+15} {y} {z+10} minecraft:stone')
    fixture(f'setblock {x+10} {y} {z+3} minecraft:chest')
    if 'survival_tools' not in selected_goals and selected_goals.intersection(('chest_deposit', 'chest_withdraw')):
        fixture('give MawAutoBody minecraft:oak_planks 8')
    save()
    brain_file = server/'world-server-numen/maw-numen-server/brains'/f'{body}.json'

    def goal(gid, text, verify, setup=None):
        if gid not in selected_goals:
            evidence['goals'].append({'id': gid, 'attempted': False, 'reason': 'not_selected'})
            save(); return
        if evidence['modelRequests'] >= 80:
            evidence['goals'].append({'id': gid, 'attempted': False, 'reason': 'finite_test_model_budget'})
            save(); return
        if setup: setup()
        before = state()
        entry = {'id': gid, 'attempted': True, 'instruction': text, 'before': brief(before),
            'startedAt': datetime.now(timezone.utc).isoformat(), 'samples': []}
        evidence['goals'].append(entry); save()
        accepted = ui('task', {'companion': body, 'text': text +
            ' 这是独立测试场，设备和原料由测试提供。自己查询真实 API 和配方后操作，'
            '不要猜测参数；Lua 输出用 print。无 OP。遇已知失败先读取原因再换方案，'
            '遇 unknown 停止且不重投。完成后读取真实状态核对并 finish；没有完成也如实说明。'})
        entry['accepted'] = brief(accepted); save()
        began = time.monotonic(); last_stamp = None
        while time.monotonic() - began < 420:
            current = state(); brain = current.get('brain', {})
            stamp = (brain.get('phase'), brain.get('loopPhase'), brain.get('callsThisGoal'), current.get('currentAction'))
            if stamp != last_stamp:
                entry['samples'].append({'elapsedSeconds': round(time.monotonic()-began, 2), **brief(current)})
                last_stamp = stamp; save()
            if brain_file.exists():
                record = json.loads(brain_file.read_text('utf-8'))
                evidence['modelRequests'] = record.get('callsToday', 0)
                entry['pendingModelRequest'] = bool(record.get('pendingRequest'))
            if brain.get('phase') in ('completed', 'unknown', 'paused', 'stopped'):
                break
            time.sleep(1)
        else:
            entry['observationTimedOut'] = True
            ui('stop', {'companion': body})
            current = state()
        entry['after'] = brief(current)
        entry['elapsedSeconds'] = round(time.monotonic()-began, 2)
        entry['postcondition'] = bool(verify(before, current))
        entry['completed'] = current.get('brain', {}).get('phase') == 'completed'
        entry['ok'] = entry['completed'] and entry['postcondition']
        record = json.loads(brain_file.read_text('utf-8'))
        entry['stopCode'] = record.get('code')
        entry['lastRequestBytes'] = record.get('lastRequestBytes')
        save()
        print(json.dumps({'autonomyGoal': gid, 'ok': entry['ok'], 'phase': current.get('brain', {}).get('phase'),
            'modelRequests': evidence['modelRequests'], 'seconds': entry['elapsedSeconds']}, ensure_ascii=False), flush=True)
        known_budget_stop = current.get('brain', {}).get('phase') == 'paused' and record.get('code') == 'goal_model_budget_reached' and not record.get('pendingRequest') and current.get('currentAction') is None
        if current.get('brain', {}).get('phase') == 'unknown' or current.get('brain', {}).get('phase') == 'paused' and not known_budget_stop or entry.get('observationTimedOut'):
            raise RuntimeError('Live autonomy stopped with unresolved model/action or finite budget; evidence preserved')

    try:
        goal('navigation', f'从当前位置绕过障碍走到绝对坐标 ({x+8},{y},{z+5}) 附近一格内，不破坏任何方块。',
            lambda before, after: math.dist([after['position'][a] for a in ('x','y','z')], [x+8,y,z+5]) < 2)
        goal('survival_tools', f'测试树在 ({x+11},{y},{z+6}) 和 ({x+14},{y},{z+6})。'
            '自己采集木头，制作并放置工作台，制作一把木镐并保留。核对木镐在背包后立即 finish。',
            lambda before, after: count(after, 'minecraft:wooden_pickaxe') > 0)
        goal('chest_deposit', f'把背包中的至少一块木板存进测试箱 ({x+10},{y},{z+3})，本任务不需要采集或制作。'
            '工具和绑定道具不要存放。完成后保持箱子窗口打开，核对箱中槽位再 finish。',
            lambda before, after: chest_count(after, 'minecraft:oak_planks') > 0)
        goal('chest_withdraw', f'关闭箱子后重新打开测试箱 ({x+10},{y},{z+3})，取回之前存放的全部木板。'
            '完成后保持箱子窗口打开，核对背包和箱中槽位再 finish。',
            lambda before, after: chest_count(before, 'minecraft:oak_planks') > 0
                and chest_count(after, 'minecraft:oak_planks') == 0
                and count(after, 'minecraft:oak_planks') == count(before, 'minecraft:oak_planks')
                    + chest_count(before, 'minecraft:oak_planks'))

        def kitchen():
            fixture(f'setblock {x+19} {y} {z+4} farmersdelight:stove[lit=true]')
            fixture(f'setblock {x+19} {y+1} {z+4} farmersdelight:cooking_pot')
            fixture('give MawAutoBody farmersdelight:rice 2'); fixture('give MawAutoBody minecraft:bowl 2')
        goal('farmers_delight_cooking', f'使用测试锅 ({x+19},{y+1},{z+4}) 和背包提供的生米、碗制作并取出两份熟米饭。'
            '锅下面已有热源，查询模组菜单和真实槽位后操作。',
            lambda before, after: count(after, 'farmersdelight:cooked_rice') >= 2, kitchen)

        def milling():
            fixture(f'setblock {x+24} {y-1} {z+4} create:creative_motor[facing=up]')
            fixture(f'setblock {x+24} {y} {z+4} create:millstone')
            fixture(f'setblock {x+24} {y+1} {z+4} minecraft:hopper[facing=down]')
            fixture('give MawAutoBody minecraft:wheat 2')
        goal('create_milling', f'测试磨石位于 ({x+24},{y},{z+4})，上面的漏斗 ({x+24},{y+1},{z+4}) 朝下，已有测试动力。'
            '把背包两份小麦投入漏斗，等待磨粉并从磨石取出至少一份面粉。自己查询 Create 和菜单能力。',
            lambda before, after: count(after, 'create:wheat_flour') >= 1, milling)

        def magic():
            fixture('give MawAutoBody ars_nouveau:apprentice_spell_book 1')
            fixture('give MawAutoBody ars_nouveau:glyph_self 1')
            fixture('give MawAutoBody ars_nouveau:glyph_heal 1')
            # Freshly spawned ServerPlayers briefly reject damage. A full-
            # health cast can verify casting but cannot verify healing.
            time.sleep(3.5)
            healthy = state()
            fixture('damage MawAutoBody 6 minecraft:generic')
            deadline = time.monotonic()+3
            injured = state()
            while injured['health'] >= healthy['health'] and time.monotonic() < deadline:
                time.sleep(.2); injured = state()
            evidence['healingFixture'] = {'beforeHealth': healthy['health'],
                'afterDamageHealth': injured['health'], 'maxHealth': injured['maxHealth']}
            save()
            if injured['health'] > healthy['health']-5:
                raise AssertionError('Healing fixture did not apply damage; no model goal dispatched')
        goal('ars_native_healing', '用提供的学徒法术书和 Self、Heal 符文，查询自己的真实已学符文。'
            '学习缺少的符文，编写一个自我治疗法术，等待真实魔力充足后施放并验证生命恢复。使用 Ars 原生能力。',
            lambda before, after: before['health'] < before['maxHealth'] and after['health'] > before['health'], magic)
        attempted = [g for g in evidence['goals'] if g.get('attempted')]
        evidence['ok'] = len(attempted) == len(selected_goals) and all(g.get('ok') for g in attempted)
    except Exception as failure:
        evidence['failure'] = {'type': type(failure).__name__, 'message': str(failure)[:300]}
        evidence['ok'] = False
        raise
    finally:
        # A crashed server cannot answer UI/state queries. Preserve the primary
        # failure and durable request count even when cleanup is unavailable.
        for label, action in (('stop', lambda: ui('stop', {'companion': body})),
                ('state', lambda: brief(state()))):
            try:
                result = action()
                if label == 'state': evidence['final'] = result
            except Exception as failure:
                evidence.setdefault('cleanupErrors', []).append({'action': label,
                    'type': type(failure).__name__, 'message': str(failure)[:300]})
                evidence['ok'] = False
        if (output/'operator-intervention.json').exists():
            evidence['operatorIntervention'] = json.loads((output/'operator-intervention.json').read_text('utf-8'))
            evidence['ok'] = False
        if brain_file.exists(): evidence['modelRequests'] = json.loads(brain_file.read_text('utf-8')).get('callsToday', 0)
        report['paidModelRequests'] = evidence['modelRequests']
        report['liveAutonomy'] = {'ok': evidence['ok'], 'goals': sum(g.get('attempted', False) for g in evidence['goals']),
            'passed': sum(g.get('ok', False) for g in evidence['goals']), 'modelRequests': evidence['modelRequests']}
        report['checks']['live_autonomy_actual_outcomes'] = evidence['ok']
        save()

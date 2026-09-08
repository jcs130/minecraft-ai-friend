"""Read the isolated NPC sidecar heartbeat. Never sends a game command."""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import time


def self_test():
    """Exercise the copied light-spell consumer with fake files/RCON only."""
    import ast
    import re
    import types
    import unittest
    from unittest.mock import patch
    source = Path(__file__).resolve().parents[1] / 'world/sidecar/mc_npc.py'
    tree = ast.parse(source.read_text(encoding='utf-8-sig'))
    selected = [node for node in tree.body if isinstance(node, ast.FunctionDef)
                and node.name in {'_exec_fixed_skill', 'spell_loop'}]

    class Tests(unittest.TestCase):
        def test_original_light_consumer_effect_and_receipt(self):
            commands, feeds, tells = [], [], []
            class EndOfFixture(Exception):
                pass
            class Queue:
                consumed = False
                def seek(self, *args):
                    pass
                def readline(self):
                    if self.consumed:
                        raise EndOfFixture()
                    self.consumed = True
                    return json.dumps({'speaker': 'QDSmokeProbe', 'skill': 'light', 'text': ''}) + '\n'
            queue = Queue()
            namespace = {'R': types.SimpleNamespace(cmd=lambda command: commands.append(command)),
                         'time': types.SimpleNamespace(time=lambda: 100, sleep=lambda _: None),
                         'os': types.SimpleNamespace(path=types.SimpleNamespace(exists=lambda _: True)),
                         'json': json, 're': re, 'SPELL_REQ': '/fixture/spell-requests.jsonl',
                         'SPELL_COOLDOWNS': {'light': 15}, 'open': lambda *a, **k: queue,
                         '_spell_tell': lambda speaker, text: tells.append((speaker, text)),
                         'feed_append': feeds.append, '_SPELL_CONSUMED': 0, '_SPELL_LAST_POLL': 0,
                         'print': lambda *a, **k: None}
            exec(compile(ast.Module(body=selected, type_ignores=[]), str(source), 'exec'), namespace)
            with self.assertRaises(EndOfFixture):
                namespace['spell_loop']()
            self.assertEqual(commands, ['give QDSmokeProbe minecraft:torch 4'])
            self.assertEqual(tells[0][0], 'QDSmokeProbe')
            self.assertEqual(feeds[0]['kind'], 'spell')
            self.assertEqual(feeds[0]['skill'], 'light')
            self.assertEqual(namespace['_SPELL_CONSUMED'], 1)

        def test_health_requires_live_polling_and_rcon(self):
            healthy = {'updated_at': 100, 'rcon_last_ok': 100, 'spell_last_poll': 100,
                       'threads': {'spell': True, 'inbox': True, 'health': True}}
            with patch.object(Path, 'read_text', return_value=json.dumps(healthy)):
                self.assertTrue(inspect_health('/unused', now=105)['ok'])
                self.assertFalse(inspect_health('/unused', now=160)['ok'])
            healthy['threads']['spell'] = False
            with patch.object(Path, 'read_text', return_value=json.dumps(healthy)):
                self.assertFalse(inspect_health('/unused', now=105)['ok'])

        def test_imported_nested_shop_preserves_items_without_writing_profiles(self):
            funcs = [node for node in tree.body if isinstance(node, ast.FunctionDef)
                     and node.name == 'normalize_profiles']
            namespace = {}
            exec(compile(ast.Module(body=funcs, type_ignores=[]), str(source), 'exec'), namespace)
            profiles = [{'key':'mobai','shop':[[{'skillbook':'home'}, {'skillbook':'light'}]]}]
            fixed = namespace['normalize_profiles'](profiles)
            self.assertEqual([item['skillbook'] for item in fixed[0]['shop']], ['home','light'])
            self.assertIsInstance(profiles[0]['shop'][0], list)

    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(Tests))
    return result.wasSuccessful()


def inspect_health(path, now=None):
    now = time.time() if now is None else now
    try:
        data = json.loads(Path(path).read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {'ok': False, 'reason': 'missing_or_unreadable_heartbeat'}
    problems = []
    if now - data.get('updated_at', 0) > 30:
        problems.append('stale_heartbeat')
    if now - data.get('rcon_last_ok', 0) > 40:
        problems.append('stale_rcon_success')
    if now - data.get('spell_last_poll', 0) > 15:
        problems.append('spell_consumer_not_polling')
    for name in ['spell', 'inbox', 'health']:
        if not data.get('threads', {}).get(name):
            problems.append('thread_not_running:' + name)
    if data.get('maid_agent_enabled') is True and data.get('threads', {}).get('maid-agent') is not True:
        problems.append('thread_not_running:maid-agent')
    if data.get('guild_agent_enabled') is True and data.get('threads', {}).get('guild-planner') is not True:
        problems.append('thread_not_running:guild-planner')
    if data.get('guild_requests_enabled') is True:
        stamp = data.get('guild_requests_last_poll')
        if type(stamp) not in (int, float) or not math.isfinite(stamp) or not -5 <= now - stamp <= 15:
            problems.append('guild_request_consumer_not_polling')
        if data.get('threads', {}).get('guild-requests') is not True:
            problems.append('thread_not_running:guild-requests')
        evidence = data.get('guild_npcs', {})
        stamp = evidence.get('checked_at')
        if (evidence.get('ok') is not True or type(stamp) not in (int, float) or not math.isfinite(stamp)
                or not -5 <= now - stamp <= 100):
            problems.append('guild_npc_identity_not_ready')
    return {'ok': not problems, 'problems': problems, 'spell_consumed': data.get('spell_consumed', 0),
            'rcon_target': data.get('rcon_target'), 'spawn_missing': data.get('spawn_missing')}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state', type=Path, default=Path(__file__).resolve().parents[1] / 'server/mcdata/npc-health.json')
    parser.add_argument('--self-test', action='store_true', help='Run offline consumer/health checks without contacting Minecraft')
    args = parser.parse_args()
    if args.self_test:
        raise SystemExit(0 if self_test() else 1)
    result = inspect_health(args.state)
    print(json.dumps(result, ensure_ascii=False))
    raise SystemExit(0 if result['ok'] else 1)


if __name__ == '__main__':
    main()

"""Real player-skill contract and internal MCP auth with no game or model IO."""
import asyncio
import json
from pathlib import Path
import sys
import tempfile
import unittest
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/survival'))
from game_skills import (GameSkills, action_command, cached_game_skills, is_protected_action,
                         summarize_game_skills, validate_game_action)
from numen_gateway import GatewayError, read_json, write_json
from mcp_server import BearerMcpApp, TOOL_NAMES

BODY_UUID = 'd4ac9523-4962-43ed-98c5-19b49e104048'


class FakeGateway:
    def __init__(self, state):
        self.state, self.calls = state, []

    def _check_binding(self):
        self.calls.append('binding')
        return 'Kirito', BODY_UUID

    def _settings(self):
        return {'bodyName': 'Kirito', 'bodyUuid': BODY_UUID}

    def _now(self):
        return 1800000000000


class GameSkillTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.state, self.queue = self.root / 'state', self.root / 'queue'
        self.queue.mkdir()
        self.gateway = FakeGateway(self.state)
        self.reply = {'ok': True, 'code': 'ok', 'summary': 'fixture'}
        self.commands = []
        self.bridge = GameSkills(self.gateway, self.queue, timeout=1, sleep=self.respond)

    def respond(self, _):
        for path in (self.queue / 'requests').glob('*/request.json'):
            request = read_json(path)
            result = self.queue / 'results' / (request['id'] + '.json')
            if result.exists():
                continue
            self.commands.append(request['command'])
            write_json(result, {'requestId': request['id'], 'actor': 'Kirito', **self.reply})

    def marker(self, tool='game_cast'):
        write_json(self.state / 'unknown.json', {'schema': 1, 'tool': tool, 'result': 'unknown',
                                               'actionId': 'fixture', 'turnId': 'fixture_turn_12345'})

    def test_all_queries_use_normal_cli_exact_actor_and_keep_progression_categories(self):
        self.reply.update(learned=[{'id': 'home'}], levelGate=[{'id': 'tp', 'level': 5}],
                          locked=[{'id': 'sky_walk', 'level': 20}], progression={'categories': []})
        result = self.bridge.query()
        self.assertTrue(result['ok'])
        self.assertEqual(self.commands, ['status', 'skills', 'spells legacy', 'spells irons'])
        self.assertEqual(result['replies']['skills']['locked'][0]['level'], 20)
        self.assertEqual(len(self.gateway.calls), 4)
        self.assertFalse((self.state / 'unknown.json').exists())
        self.assertIn('真实装备', result['learning']['irons'])

    def test_mutation_requires_existing_gateway_unknown_marker(self):
        with self.assertRaises(OSError):
            self.bridge.dispatch('game_cast', {'skill_id': 'irons_spellbooks:shield', 'params': {}})
        self.assertFalse((self.queue / 'requests').exists())

    def test_native_cast_start_is_not_completed_and_correlation_precedes_send(self):
        self.marker()
        self.reply.update(code='casting_started', phase='casting')
        result = self.bridge.dispatch('game_cast', {'skill_id': 'irons_spellbooks:shield', 'params': {}})
        self.assertTrue(result['success']); self.assertTrue(result['data']['async'])
        request_id = read_json(self.state / 'unknown.json')['requestId']
        self.assertEqual(result['data']['receipt']['requestId'], request_id)
        self.assertEqual(self.bridge.receipt(request_id)['code'], 'casting_started')
        self.assertEqual(self.commands, ['cast irons_spellbooks:shield'])

    def test_pending_and_unknown_receipts_do_not_resend_or_clear_unknown_marker(self):
        self.marker('game_learn')
        self.bridge.timeout = 0
        with self.assertRaisesRegex(GatewayError, 'outcome_unknown'):
            self.bridge.dispatch('game_learn', {'skill_id': 'feather_boots'})
        request_id = read_json(self.state / 'unknown.json')['requestId']
        for _ in range(3):
            self.assertEqual(self.bridge.receipt(request_id)['code'], 'pending')
        self.assertEqual(len(list((self.queue / 'requests').iterdir())), 1)
        self.assertTrue((self.state / 'unknown.json').exists())
        self.reply.update(ok=False, code='outcome_unknown')
        self.respond(0)
        self.assertEqual(self.bridge.receipt(request_id)['code'], 'outcome_unknown')

    def test_learning_has_real_world_receipt_and_never_creates_a_book(self):
        self.marker('game_learn')
        self.reply.update(code='learned', learned=True, skillId='feather_boots')
        result = self.bridge.dispatch('game_learn', {'skill_id': 'feather_boots'})
        self.assertTrue(result['data']['learningConfirmed'])
        self.assertFalse(result['data']['async'])
        self.assertEqual(self.commands, ['learn feather_boots'])

    def test_world_rejection_is_not_learning_or_success(self):
        self.marker('game_learn')
        self.reply.update(ok=False, code='skill_book_required')
        result = self.bridge.dispatch('game_learn', {'skill_id': 'home'})
        self.assertFalse(result['success']); self.assertFalse(result['data']['learningConfirmed'])

    def test_native_bridge_exception_cannot_be_treated_as_a_known_rejection(self):
        self.marker()
        self.reply.update(ok=False, code='bridge_error')
        with self.assertRaisesRegex(GatewayError, 'outcome_unknown'):
            self.bridge.dispatch('game_cast', {'skill_id': 'irons_spellbooks:shield', 'params': {}})
        self.assertTrue((self.state / 'unknown.json').exists())

    def test_successful_queries_cache_by_scope_without_any_polling_on_cached_reads(self):
        self.bridge.query('status')
        self.bridge.query('irons')
        count = len(self.commands)
        cached = cached_game_skills(self.state, self.gateway._now() + 60000)
        self.assertTrue(cached['historicalQuery'])
        self.assertEqual(cached['ageMs'], 60000)
        self.assertEqual(set(cached['scopes']), {'status', 'irons'})
        self.assertEqual(len(self.commands), count)
        self.reply.update(ok=False, code='bridge_unavailable')
        self.bridge.query('legacy')
        self.assertNotIn('legacy', cached_game_skills(self.state)['scopes'])

    def test_unavailable_or_oversize_cache_is_reported_without_world_io(self):
        self.assertFalse(cached_game_skills(self.state)['available'])
        write_json(self.state / 'game-skills.json', {'schema': 1, 'scopes': {}, 'observedAt': 'bad'})
        self.assertFalse(cached_game_skills(self.state)['available'])
        self.assertEqual(self.gateway.calls, [])

    def test_receipts_cannot_cross_actor_request_or_escape_the_queue(self):
        result = self.bridge.query('irons')
        request_id = result['replies']['spells irons']['requestId']
        self.assertEqual(self.bridge.receipt(str(uuid.uuid4()))['code'], 'game_skill_receipt_unavailable')
        self.assertEqual(self.bridge.receipt('../secret')['code'], 'game_skill_receipt_unavailable')
        for patch in ({'actor': 'Goddess'}, {'requestId': str(uuid.uuid4())}, {'ok': 'yes'}):
            write_json(self.queue / 'results' / (request_id + '.json'),
                       {'actor': 'Kirito', 'requestId': request_id, 'ok': True, 'code': 'ok', **patch})
            self.assertEqual(self.bridge.receipt(request_id)['code'], 'game_skill_receipt_unavailable')

    def test_only_precise_skill_tokens_and_params_can_be_converted_to_commands(self):
        self.assertEqual(action_command('game_cast', {'skill_id': 'tp', 'params': {'distance': 5, 'direction': '东'}}),
                         'cast tp direction=东 distance=5')
        bad = [
            ('game_learn', {'skill_id': 'irons_spellbooks:heal'}),
            ('game_cast', {'skill_id': 'tp\ngive Kirito diamond', 'params': {}}),
            ('game_cast', {'skill_id': 'home', 'params': {'x': 'a --help'}}),
            ('game_cast', {'skill_id': 'home', 'params': {'constructor': 'x'}}),
            ('game_cast', {'skill_id': 'home', 'params': {'distance': True}}),
            ('game_cast', {'skill_id': 'home', 'params': {'distance': float('inf')}}),
            ('game_cast', {'skill_id': 'irons_spellbooks:heal', 'params': {'power': 100}}),
            ('game_cast', {'skill_id': 'home', 'params': {}, 'actor': 'Goddess'}),
            ('admin', {'skill_id': 'home'}),
        ]
        for tool, args in bad:
            with self.subTest(tool=tool, args=args), self.assertRaises(GatewayError):
                validate_game_action(tool, args)

    def test_unknown_offensive_terrain_and_travel_spells_keep_town_protection(self):
        self.assertFalse(is_protected_action('game_learn', {'skill_id': 'home'}))
        self.assertFalse(is_protected_action('game_cast', {'skill_id': 'irons_spellbooks:shield', 'params': {}}))
        for skill_id in ('home', 'tp', 'spring', 'irons_spellbooks:firebolt', 'othermod:unknown_spell'):
            self.assertTrue(is_protected_action('game_cast', {'skill_id': skill_id, 'params': {}}))

    def test_model_surface_has_game_abilities_without_arbitrary_player_or_shell_command(self):
        for name in ('game_skills', 'game_cast', 'game_learn', 'game_skill_receipt'):
            self.assertIn(name, TOOL_NAMES)
        for name in ('shell', 'rcon', 'command', 'bookget', 'grant_skill'):
            self.assertNotIn(name, TOOL_NAMES)


class GameSkillSummaryTests(unittest.TestCase):
    def cache(self):
        return {'schema': 1, 'observedAt': 1000, 'scopes': {'all': {'observedAt': 1000, 'replies': {
            'skills': {'ok': True, 'playerLevel': 8,
                       'learned': [{'id': 'home', 'name': '归乡', 'level': 2, 'mana': 20}],
                       'levelGate': [{'id': 'fireworks', 'name': '烟花术', 'level': 1, 'mana': 5}], 'locked': []},
            'status': {'ok': True, 'mana': 90, 'maxMana': 100,
                       'native': {'ok': True, 'level': 8, 'mana': 100, 'maxMana': 100,
                                  'attributes': {'health': 20, 'maxHealth': 20, 'spellPower': 1}},
                       'progression': {'ok': True, 'categories': [
                           {'id': 'puffish_skills:combat', 'available': True, 'level': 5,
                            'experience': 72, 'points_total': 5, 'points_spent': 0, 'points_left': 5},
                           {'id': 'puffish_skills:mining', 'available': True, 'level': 0,
                            'experience': 0, 'points_total': 0, 'points_spent': 0, 'points_left': 0}]}},
            'spells irons': {'ok': True, 'spells': []},
        }}}}

    def test_actual_receipt_shapes_preserve_levels_known_empty_native_and_unspent_points(self):
        cache = self.cache(); original = json.dumps(cache)
        view = summarize_game_skills(cache)
        self.assertEqual(view['playerLevel'], 8); self.assertEqual(view['nativeLevel'], 8)
        self.assertEqual(view['learned'][0]['id'], 'home')
        self.assertEqual(view['currentlyAvailable'][0]['id'], 'fireworks')
        self.assertEqual(view['nativeSpells'], []); self.assertTrue(view['nativeSpellsKnown'])
        self.assertEqual(view['pufferfish']['categories'][0]['points_left'], 5)
        self.assertEqual(view['pufferfish']['categories'][1]['level'], 0)
        self.assertTrue(view['historicalQuery'])
        self.assertEqual(json.dumps(cache), original)

    def test_fresh_scope_overrides_only_its_own_receipt_and_retains_per_source_time(self):
        cache = self.cache()
        cache['scopes']['status'] = {'observedAt': 2000, 'replies': {'status': {
            'ok': True, 'native': {'ok': True, 'level': 9, 'mana': 50}}}}
        view = summarize_game_skills(cache)
        self.assertEqual(view['nativeLevel'], 9); self.assertEqual(view['playerLevel'], 8)
        self.assertEqual(view['sourceObservedAt'], {'skills': 1000, 'status': 2000, 'spells irons': 1000})

    def test_large_localized_catalog_is_bounded_to_six_kib_without_losing_known_flags(self):
        cache = self.cache(); replies = cache['scopes']['all']['replies']
        rows = [{'id': 'irons_spellbooks:' + 'x' * 100, 'name': '法' * 100, 'level': 5, 'mana': 100} for _ in range(100)]
        replies['skills'].update(learned=rows, levelGate=rows, locked=rows)
        replies['spells irons']['spells'] = rows
        view = summarize_game_skills(cache)
        self.assertLessEqual(len(json.dumps(view, ensure_ascii=False).encode('utf-8')), 6144)
        for key in ('learned', 'currentlyAvailable', 'locked', 'nativeSpells'):
            self.assertLessEqual(len(view[key]), 24)
        self.assertTrue(view['truncated']); self.assertTrue(view['nativeSpellsKnown'])

    def test_missing_or_malformed_sources_are_not_false_empty_observations(self):
        view = summarize_game_skills(None)
        self.assertFalse(view['available']); self.assertFalse(view['nativeSpellsKnown'])
        self.assertIsNone(view['playerLevel'])
        cache = self.cache()
        cache['scopes']['all']['replies']['skills']['playerLevel'] = 10 ** 1000
        cache['scopes']['all']['replies']['spells irons'] = {'ok': False, 'code': 'pending'}
        view = summarize_game_skills(cache)
        self.assertIsNone(view['playerLevel']); self.assertFalse(view['nativeSpellsKnown'])


class McpTransportTests(unittest.IsolatedAsyncioTestCase):
    async def request(self, headers, path='/mcp', method='POST'):
        messages, delegated = [], []
        async def app(scope, receive, send):
            delegated.append(scope['path'])
            await send({'type': 'http.response.start', 'status': 204, 'headers': []})
        async def receive():
            return {'type': 'http.request', 'body': b'', 'more_body': False}
        async def send(value):
            messages.append(value)
        await BearerMcpApp(app, 'a' * 48)({'type': 'http', 'path': path, 'method': method,
                                          'headers': headers}, receive, send)
        return messages, delegated

    async def test_missing_wrong_or_duplicate_bearer_never_reaches_mcp(self):
        for headers in ([], [(b'authorization', b'Bearer wrong')],
                        [(b'authorization', b'Bearer ' + b'a' * 48)] * 2):
            messages, delegated = await self.request(headers)
            self.assertEqual(messages[0]['status'], 401); self.assertEqual(delegated, [])
            self.assertNotIn('a' * 48, json.dumps(messages, default=str))

    async def test_only_valid_internal_bearer_can_use_tools(self):
        messages, delegated = await self.request([(b'authorization', b'Bearer ' + b'a' * 48)])
        self.assertEqual(messages[0]['status'], 204); self.assertEqual(delegated, ['/mcp'])

    async def test_liveness_does_not_expose_world_status_or_accept_writes(self):
        messages, delegated = await self.request([], '/livez', 'GET')
        self.assertEqual(messages[0]['status'], 200); self.assertEqual(delegated, [])
        self.assertEqual(messages[1]['body'], b'{"ok":true}')
        messages, _ = await self.request([], '/livez', 'POST')
        self.assertEqual(messages[0]['status'], 401)


if __name__ == '__main__':
    unittest.main()

"""Durable hearing and local Numen perception; no live actions or LLM calls."""
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/survival'))
from perception import WorldPerception, READ_BYTES, CHANNELS
from numen_gateway import NumenGateway, write_json

NOW = 1800000000
UUID = 'd4ac9523-4962-43ed-98c5-19b49e104048'


class PerceptionTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.state, self.world, self.public = (self.root / name for name in ('state', 'world', 'public'))
        for directory in (self.state, self.world, self.public):
            directory.mkdir()
        self.now = NOW
        self.body = {'ok': True, 'bodyUuid': UUID, 'hp': 20, 'dimension': 'minecraft:overworld'}
        self.reader = self.make_reader()

    def make_reader(self):
        return WorldPerception(self.state, self.world, self.public, clock=lambda: self.now)

    def append(self, filename='player-chat.jsonl', **record):
        with (self.world / filename).open('a', encoding='utf8') as stream:
            stream.write(json.dumps({'ts': self.now * 1000, **record}, ensure_ascii=False) + '\n')

    def poll(self, environment=None):
        return self.reader.poll(self.body, environment)

    def test_public_chat_and_only_own_addressed_channels(self):
        self.append(user='MengMeng', text='桐人，天快黑了')
        self.append(user='Kirito', text='self chat must not loop')
        self.append(user='桐人', text='display alias also self')
        for filename, (_, recipient) in CHANNELS.items():
            if recipient:
                self.append(filename, **{recipient: '桐人'}, text=filename)
                self.append(filename, **{recipient: 'Naruto'}, text='another character private text')
        result = self.poll()
        self.assertEqual(len(result['events']), 4)
        self.assertTrue(all(row['addressed'] and row['trusted'] is False for row in result['events']))
        self.assertNotIn('private text', json.dumps(result))
        self.assertFalse(result['limits']['allKnowing'])

    def test_cooldown_restart_retains_pending_and_ack_is_specific(self):
        self.append(user='MengMeng', text='first task')
        first = self.poll()
        self.assertEqual(self.poll()['pendingEventIds'], first['pendingEventIds'])
        self.reader = self.make_reader()
        self.append(user='Taro', text='new task during decision')
        self.poll()
        self.reader.ack(first['pendingEventIds'])
        after = self.poll()
        self.assertEqual([row['text'] for row in after['events']], ['new task during decision'])
        self.assertNotEqual(after['revision'], first['revision'])

    def test_ack_does_not_allow_identical_event_replay_after_rotation(self):
        self.append(user='MengMeng', text='unique')
        first = self.poll()
        self.reader.ack(first['pendingEventIds'])
        old = self.world / 'player-chat.jsonl'
        replacement = self.world / 'replacement'
        replacement.write_bytes(old.read_bytes())
        replacement.replace(old)
        self.assertEqual(self.poll()['events'], [])

    def test_stale_unknown_age_future_and_malformed_records_do_not_wake(self):
        self.append(user='MengMeng', text='old', ts=(NOW - 901) * 1000)
        self.append(user='MengMeng', text='future', ts=(NOW + 31) * 1000)
        self.append(user='MengMeng', text='unknown', ts='garbage')
        with (self.world / 'player-chat.jsonl').open('a', encoding='utf8') as stream:
            stream.write('{broken json}\n[]\n')
        self.assertEqual(self.poll()['events'], [])

    def test_legacy_china_timestamp_and_iso_timestamp(self):
        local = datetime.fromtimestamp(NOW + 28800, timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
        self.append('guard-inbox.jsonl', to='Kirito', text='NPC greeting', ts=local)
        iso = datetime.fromtimestamp(NOW, timezone.utc).isoformat()
        self.append(user='Taro', text='hello', ts=iso)
        events = self.poll()['events']
        self.assertEqual(len(events), 2)
        self.assertTrue(all(event['at'] == NOW * 1000 for event in events))

    def test_partial_json_is_not_lost_or_replayed(self):
        path = self.world / 'player-chat.jsonl'
        raw = json.dumps({'ts': NOW * 1000, 'user': 'Taro', 'text': 'split'}).encode()
        path.write_bytes(raw[:15])
        self.assertEqual(self.poll()['events'], [])
        with path.open('ab') as stream:
            stream.write(raw[15:] + b'\n')
        self.assertEqual([row['text'] for row in self.poll()['events']], ['split'])
        self.assertEqual(len(self.poll()['events']), 1)

    def test_truncation_regrown_beyond_cursor_detects_changed_anchor(self):
        self.append(user='Taro', text='before')
        first = self.poll()
        self.reader.ack(first['pendingEventIds'])
        (self.world / 'player-chat.jsonl').write_text('', encoding='utf8')
        self.append(user='MengMeng', text='after truncate, longer than before')
        result = self.poll()
        self.assertTrue(result['sources']['player-chat.jsonl']['reset'])
        self.assertEqual([row['text'] for row in result['events']], ['after truncate, longer than before'])

    def test_oversized_line_is_skipped_and_reader_recovers(self):
        self.poll()
        path = self.world / 'player-chat.jsonl'
        path.write_bytes(b'x' * (READ_BYTES * 2 + 100))
        self.poll()
        with path.open('ab') as stream:
            stream.write(b'\n')
        self.append(user='Taro', text='after huge line')
        for _ in range(4):
            result = self.poll()
        self.assertEqual([row['text'] for row in result['events']], ['after huge line'])

    def test_bounded_queue_preserves_addressed_over_chat_flood(self):
        self.append('guard-inbox.jsonl', to='Kirito', text='direct task')
        self.poll()
        for i in range(70):
            self.append(user='Taro', text=str(i))
        result = self.poll()
        self.assertLessEqual(result['pendingCount'], 32)
        self.assertLessEqual(len(result['events']), 12)
        self.assertGreater(result['droppedEvents'], 0)
        self.assertIn('direct task', json.dumps(self.reader.data))
        self.assertLess((self.state / 'perception.json').stat().st_size, 262144)

    def test_missing_sources_are_unknown_and_do_not_read_arbitrary_files(self):
        (self.world / 'rcon-secret.txt').write_text('DO NOT EXPORT', encoding='utf8')
        result = self.poll()
        self.assertTrue(all(not row['available'] for row in result['sources'].values()))
        self.assertFalse(result['progression']['available'])
        self.assertNotIn('DO NOT EXPORT', json.dumps(result))

    def test_directory_in_place_of_channel_is_rejected(self):
        (self.world / 'player-chat.jsonl').mkdir()
        self.assertFalse(self.poll()['sources']['player-chat.jsonl']['available'])

    def test_damage_is_measured_but_attacker_is_not_invented(self):
        self.poll()
        self.body['hp'] = 16.5
        result = self.poll()
        event = result['events'][0]
        self.assertEqual(event['kind'], 'damage_observed')
        self.assertEqual((event['beforeHp'], event['afterHp']), (20, 16.5))
        self.assertNotIn('attacker', {key for key in event})
        self.assertEqual(len(self.poll()['events']), 1)

    def test_different_body_does_not_fabricate_damage(self):
        self.poll()
        self.body.update(hp=5, bodyUuid='different')
        self.assertEqual(self.poll()['events'], [])

    def test_game_tick_and_entity_nudges_do_not_wake_weather_or_threat_does(self):
        environment = {'ok': True, 'world': {'game_time': 100, 'weather': 'clear',
                       'is_bright_outside': True}, 'hostiles': []}
        self.poll(environment)
        environment['world']['game_time'] = 200
        self.assertEqual(self.poll(environment)['events'], [])
        environment['world']['weather'] = 'rain'
        result = self.poll(environment)
        self.assertEqual(result['events'][0]['kind'], 'environment_changed')
        self.reader.ack(result['pendingEventIds'])
        environment['hostiles'] = [{'type': 'entity.minecraft.zombie', 'id': 1, 'position': {'x': 3}}]
        threat = self.poll(environment)
        self.assertEqual(len(threat['events']), 1)
        self.reader.ack(threat['pendingEventIds'])
        environment['hostiles'][0].update(id=2, position={'x': 4})
        self.assertEqual(self.poll(environment)['events'], [])

    def test_progression_projects_only_bound_character(self):
        write_json(self.world / 'magic-state.json', {'players': {
            'Kirito': {'level': 5, 'mana': 100, 'learned': ['home'], 'passives': ['speed'],
                       'private': 'DO NOT EXPORT'}, 'Naruto': {'learned': ['another character']}}})
        progression = self.poll()['progression']
        self.assertEqual(progression['learned'], ['home'])
        self.assertNotIn('private', progression)
        self.assertNotIn('another character', json.dumps(progression))

    def test_public_board_and_progression_fallback_remain_explicit_about_limits(self):
        write_json(self.public / 'world.json', {'available': True,
            'generatedAt': datetime.fromtimestamp(NOW, timezone.utc).isoformat(),
            'guild': {'stale': False, 'board': [{'no': 1, 'title': 'collect bread', 'reward': 3,
                       'secret': 'DO NOT EXPORT'}]}, 'waypoints': [{'id': 1, 'name': 'Square', 'x': 2}],
            'players': [{'name': 'Kirito', 'level': 5, 'learnedCount': 23}, {'name': 'Naruto', 'level': 2}]})
        result = self.poll()
        self.assertTrue(result['world']['boardFresh'])
        self.assertEqual(result['progression']['learnedCount'], 23)
        self.assertFalse(result['progression']['detailAvailable'])
        self.assertNotIn('DO NOT EXPORT', json.dumps(result))
        self.now += 301
        self.assertFalse(self.poll()['world']['boardFresh'])

    def test_cached_is_read_only_and_ack_removes_stale_cache(self):
        self.append(user='Taro', text='cached')
        result = self.poll()
        before = (self.state / 'perception.json').read_bytes()
        self.assertEqual(self.reader.cached()['events'], result['events'])
        self.assertEqual((self.state / 'perception.json').read_bytes(), before)
        self.reader.ack(result['pendingEventIds'])
        self.assertEqual(self.reader.cached()['events'], [])


class ExpandedNumenObservationTests(unittest.TestCase):
    def test_observation_projects_all_entities_and_independent_threat_scan(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            write_json(root / 'settings.json', {'bodyName': 'Kirito', 'bodyUuid': UUID})
            calls = []
            class Rcon:
                def cmd(self, command):
                    calls.append(command)
                    if command == 'numen_act list':
                        return 'Kirito|uuid=' + UUID
                    if ' look_around ' in command:
                        return 'T.@#' * 2000
                    if ' get_world_info ' in command:
                        return json.dumps({'weather': 'rain', 'game_time': 1, 'is_dark_outside': True,
                                           'private': 'DO NOT EXPORT'})
                    if ' scan_nearby_entities ' in command:
                        hostile = '"hostile"' in command
                        return json.dumps({'entities': [{'type': 'zombie' if hostile else 'villager',
                            'category': 'hostile' if hostile else 'passive', 'id': i,
                            'position': {'x': 0, 'y': 70, 'z': i}, 'private': 'DO NOT EXPORT'}
                            for i in range(30)], 'truncated': True})
                    raise AssertionError('unexpected command')
            result = NumenGateway(root, Rcon()).observe(12)
            self.assertTrue(result['ok'])
            self.assertEqual(result['world']['weather'], 'rain')
            self.assertEqual((len(result['entities']), len(result['hostiles'])), (20, 8))
            self.assertEqual(len(result['terrain']), 6000)
            self.assertTrue(result['entitiesTruncated'])
            self.assertTrue(result['hostilesTruncated'])
            self.assertNotIn('DO NOT EXPORT', json.dumps(result))
            self.assertEqual(len(calls), 5)

    def test_snapshot_retains_biome_structure_and_survival_status(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            write_json(root / 'settings.json', {'bodyName': 'Kirito', 'bodyUuid': UUID})
            class Rcon:
                def cmd(self, command):
                    if command == 'numen_act list':
                        return 'Kirito|uuid=' + UUID
                    if 'get_self_status' in command:
                        return json.dumps({'name': 'Kirito', 'hp': 20, 'max_hp': 20, 'hunger': 5,
                            'position': {'x': 1, 'y': 70, 'z': 3}, 'biome': 'biomesoplenty:grove',
                            'structures': ['minecraft:village_plains'], 'saturation': 0, 'on_ground': True})
                    if 'task_status' in command:
                        return '{"success":true}'
                    return '[]'
            with patch('numen_gateway.inventory_from_snbt', return_value=([], {})):
                result = NumenGateway(root, Rcon()).snapshot()
            self.assertEqual(result['biome'], 'biomesoplenty:grove')
            self.assertEqual(result['structures'], ['minecraft:village_plains'])
            self.assertEqual(result['saturation'], 0)
            self.assertTrue(result['onGround'])


if __name__ == '__main__':
    unittest.main()

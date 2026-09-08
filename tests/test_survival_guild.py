"""Existing guild rules with fictional inventory/RCON and isolated durable files."""
from contextlib import contextmanager
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
import uuid
from concurrent.futures import ThreadPoolExecutor

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/sidecar'))
sys.path.insert(0, str(ROOT / 'world/survival'))
import guild_requests as requests
import guild as adapter


class GuildTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.day = time.strftime('%Y-%m-%d')
        self.actor = 'Fixture123'
        self.actor_uuid = '11111111-1111-1111-1111-111111111111'
        self.inventory = {'wheat': 4, 'emerald': 0}
        self.commands = []
        self.failure = None
        self.capacity = 64
        snapshot_patch = patch.object(requests.inventory, 'snapshot', side_effect=lambda npc, actor: {
            'actorUuid': self.actor_uuid, 'counts': {'minecraft:' + k: v for k,v in self.inventory.items()},
            'emeraldCapacity': self.capacity, 'freeSlots': int(self.capacity > 0)})
        snapshot_patch.start(); self.addCleanup(snapshot_patch.stop)
        self.quest = {'id': 'fixture-' + self.day, 'villager': 'hesu', 'display': '农人',
                      'item': 'wheat', 'zh': '小麦', 'count': 2, 'emerald': 3, 'done': False}
        self.profile = {'key': 'hesu', 'tag': 'fixture_hesu', 'display': '农人'}
        self.npc = SimpleNamespace(VDIR=str(self.root), DATA=str(self.root), CFG={}, GUILD_AUTOGENERATE=False,
            PROFILES=[self.profile, {'key': 'guild_lan', 'display': '接待员'}],
            R=SimpleNamespace(cmd=self.command, s=None), QUESTS={},
            player_pos=Mock(return_value=(0, 64, 0)), alive_pos=Mock(return_value=(1, 64, 0)),
            _scan_settle=Mock(), sync_offers=Mock(), load_atoms=Mock(return_value=[]), ledger_append=Mock(),
            tellraw=Mock(), goddess=Mock(), chronicle_append=Mock(), feed_append=Mock())
        self.npc.quests_path = lambda day: self.root / ('quests-' + day + '.json')
        requests.atomic_json(self.npc.quests_path(self.day), {'date': self.day, 'quests': [self.quest]})
        self.npc.quests_today = lambda: requests.read(self.npc.quests_path(self.day))
        self.board = {'date': self.day, 'board': [{'no': 1, 'type': 'gather', 'status': 'open',
            'qid': self.quest['id'], 'from': 'hesu', 'item': 'wheat', 'count': 2, 'reward': 3,
            'fame': 1, 'rank': 0, 'title': '收购小麦', 'display': '农人', 'zh': '小麦', 'taker': []}]}
        spec = importlib.util.spec_from_file_location('guild_economy_fixture', ROOT / 'world/sidecar/mc_guild.py')
        self.guild = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {'mc_npc': self.npc}):
            spec.loader.exec_module(self.guild)
        self.guild.BOARD = {'date': self.day, 'doc': self.board}
        self.service = requests.GuildService(self.npc, self.guild)

    def command(self, value):
        self.commands.append(value)
        if value.endswith(' UUID'):
            return 'Fixture123 has the following entity data: [I; 286331153, 286331153, 286331153, 286331153]'
        if value.endswith(' Dimension'):
            return 'Fixture123 has the following entity data: "minecraft:overworld"'
        if value == 'clear Fixture123 minecraft:wheat 0':
            # Exact bundled 1.21.1 assets/minecraft/lang/en_us.json templates.
            return 'Found %d matching item(s) on player Fixture123' % self.inventory['wheat']
        if value == 'clear Fixture123 minecraft:emerald 0':
            return 'Found %d matching item(s) on player Fixture123' % self.inventory['emerald']
        if value == 'clear Fixture123 minecraft:wheat 2':
            count = min(2, self.inventory['wheat'])
            if self.failure != 'false_clear_ack':
                self.inventory['wheat'] -= count
            if self.failure == 'clear':
                raise OSError('interrupted after server debit')
            return 'Removed %d item(s) from player Fixture123' % count
        if value == 'give Fixture123 minecraft:emerald 3':
            if self.failure != 'drop_reward':
                self.inventory['emerald'] += 3
            if self.failure == 'give':
                raise OSError('interrupted after server credit')
            return 'Gave 3 [Emerald] to Fixture123'
        return ''

    def request(self, action, quest_id=None):
        now = int(time.time() * 1000)
        return {'id': str(uuid.uuid4()), 'actor': self.actor, 'actorUuid': self.actor_uuid,
                'action': action, 'questId': None if action == 'query' else quest_id or self.day + ':1',
                'submittedAt': now, 'expiresAt': now + 30000}

    def claim(self):
        result = self.service.execute(self.request('claim'))
        self.assertEqual(result['code'], 'claimed')

    def test_real_claim_deliver_inventory_and_existing_fame_chain(self):
        self.claim()
        self.assertEqual(self.inventory, {'wheat': 4, 'emerald': 0})
        result = self.service.execute(self.request('deliver'))
        self.assertTrue(result['ok'])
        self.assertEqual(result['receipt']['goodsRemoved'], 2)
        self.assertEqual(result['receipt']['emeraldGiven'], 3)
        self.assertEqual(self.inventory, {'wheat': 2, 'emerald': 3})
        self.assertEqual(self.guild.load_fame()[self.actor]['fame'], 1)
        self.assertEqual(self.guild.load_fame()[self.actor]['done'], 1)
        self.assertEqual(self.board['board'][0]['status'], 'done')
        self.assertTrue(self.npc.quests_today()['quests'][0]['done'])
        self.assertEqual(self.service.execute(self.request('deliver'))['code'], 'quest_not_owned')
        self.assertEqual(self.commands.count('give Fixture123 minecraft:emerald 3'), 1)

    def test_missing_goods_or_unknown_same_dimension_never_mutates(self):
        self.claim()
        self.inventory['wheat'] = 1
        self.assertEqual(self.service.execute(self.request('deliver'))['code'], 'missing_goods')
        self.inventory['wheat'] = 4
        self.npc.alive_pos.return_value = None
        self.assertEqual(self.service.execute(self.request('deliver'))['code'], 'npc_not_near')
        self.npc.alive_pos.return_value = (1, 64, 0)
        with patch.object(self.npc.R, 'cmd', return_value='Fixture123 data: "minecraft:the_nether"'):
            self.assertFalse(requests.near_npc(self.npc, self.actor, self.profile, 5))
        self.assertFalse(any(c.endswith('wheat 2') or c.startswith('give ') for c in self.commands))
        self.assertFalse((self.root / 'guild-transactions').exists())

    def test_unknown_clear_is_not_refunded_or_replayed_by_new_request(self):
        self.claim()
        self.failure = 'clear'
        first = self.service.execute(self.request('deliver'))
        self.assertEqual(first['code'], 'outcome_unknown')
        self.failure = None
        second = self.service.execute(self.request('deliver'))
        self.assertEqual(second['code'], 'outcome_unknown')
        self.assertEqual(self.inventory, {'wheat': 2, 'emerald': 0})
        self.assertEqual(self.commands.count('clear Fixture123 minecraft:wheat 2'), 1)
        self.assertFalse(any(c.startswith('give ') for c in self.commands))

    def test_unknown_reward_is_never_paid_twice_or_claimed_as_completed(self):
        self.claim()
        self.failure = 'give'
        self.assertEqual(self.service.execute(self.request('deliver'))['code'], 'outcome_unknown')
        self.failure = None
        self.assertEqual(self.service.execute(self.request('deliver'))['code'], 'outcome_unknown')
        self.assertEqual(self.inventory, {'wheat': 2, 'emerald': 3})
        self.assertEqual(self.guild.load_fame(), {})
        self.assertEqual(self.commands.count('give Fixture123 minecraft:emerald 3'), 1)

    def test_claim_identity_date_ownership_and_legacy_content_checks(self):
        bad = self.request('claim') | {'actorUuid': str(uuid.uuid4())}
        self.assertEqual(self.service.execute(bad)['code'], 'actor_mismatch')
        self.assertEqual(self.service.execute(self.request('claim', '2000-01-01:1'))['code'], 'quest_expired')
        self.npc.alive_pos.return_value = None
        self.assertEqual(self.service.execute(self.request('claim'))['code'], 'claim_refused')
        self.npc.alive_pos.return_value = (1, 64, 0)
        self.board['board'][0]['type'] = 'treasure'
        self.assertEqual(self.service.execute(self.request('claim'))['code'], 'unsupported_contract')
        self.board['board'][0].update(type='gather', status='claimed', taker=['Other'])
        self.assertEqual(self.service.execute(self.request('deliver'))['code'], 'quest_not_owned')
        self.assertFalse(any(c.startswith('give ') or c.endswith('wheat 2') for c in self.commands))

    def test_query_and_release_reuse_daily_board_and_never_award_items(self):
        result = self.service.execute(self.request('query'))
        self.assertEqual(result['quests'][0]['questId'], self.day + ':1')
        self.assertEqual(result['quests'][0]['itemId'], 'minecraft:wheat')
        self.assertEqual(result['receptionist']['position'], [1, 64, 0])
        self.claim()
        self.assertEqual(self.service.execute(self.request('release'))['code'], 'released')
        self.assertEqual(self.board['board'][0]['status'], 'open')
        self.assertEqual(self.inventory, {'wheat': 4, 'emerald': 0})

    def test_queue_replay_duplicate_and_crash_never_execute_twice(self):
        queue = requests.GuildQueue(self.root / 'queue', self.service)
        request = self.request('claim')
        slot = queue.root / 'requests' / request['id']
        requests.atomic_json(slot / 'request.json', request)
        queue.poll()
        result = requests.read(queue.root / 'results' / (request['id'] + '.json'))
        self.assertEqual(result['code'], 'claimed')
        original = (queue.root / 'results' / (request['id'] + '.json')).read_bytes()
        requests.atomic_json(slot / 'request.json', request | {'action': 'release'})
        queue.poll()
        self.assertEqual(self.board['board'][0]['status'], 'claimed')
        self.assertEqual((queue.root / 'results' / (request['id'] + '.json')).read_bytes(), original)
        pending = self.request('deliver')
        requests.atomic_json(queue.root / 'processing' / pending['id'] / 'request.json', pending)
        requests.GuildQueue(queue.root, self.service).poll()
        self.assertEqual(requests.read(queue.root / 'results' / (pending['id'] + '.json'))['code'], 'outcome_unknown')
        self.assertEqual(self.inventory, {'wheat': 4, 'emerald': 0})

    def test_bad_or_expired_requests_do_not_reach_world(self):
        queue = requests.GuildQueue(self.root / 'queue', self.service)
        for changes in ({'actor': '@a'}, {'questId': self.day + ':1\ngive'}, {'questId': '2026-02-31:1'},
                        {'expiresAt': 0}, {'submittedAt': True}, {'actorUuid': None}):
            request = self.request('deliver') | changes
            requests.atomic_json(queue.root / 'requests' / request['id'] / 'request.json', request)
        queue.poll()
        self.assertEqual(self.commands, [])

    def test_two_concurrent_delivery_paths_share_one_settlement(self):
        self.claim()
        with ThreadPoolExecutor(max_workers=2) as workers:
            results = list(workers.map(lambda _: requests.deliver_quest(self.npc, self.guild, self.actor, self.profile, self.quest), range(2)))
        self.assertEqual(sorted(r['code'] for r in results), ['already_completed', 'completed'])
        self.assertEqual(self.inventory, {'wheat': 2, 'emerald': 3})
        self.assertEqual(self.guild.load_fame()[self.actor]['done'], 1)

    def test_finished_or_pending_goods_cannot_be_newly_claimed(self):
        doc = self.npc.quests_today(); doc['quests'][0]['done'] = True
        requests.atomic_json(self.npc.quests_path(self.day), doc)
        self.assertEqual(self.service.execute(self.request('claim'))['code'], 'claim_refused')
        self.assertFalse(self.service.execute(self.request('query'))['quests'][0]['claimable'])
        self.assertEqual(self.inventory, {'wheat': 4, 'emerald': 0})

    def test_automatic_reward_requires_native_confirmation_and_never_repeats(self):
        b = self.board['board'][0]
        b.update(type='hunt', status='done', taker=[self.actor])
        self.failure = 'give'
        self.assertFalse(self.guild.complete_task(b))
        self.assertEqual(b['rewardOutcome']['phase'], 'outcome_unknown')
        self.assertEqual(self.guild.load_fame(), {})
        self.assertFalse(self.guild.complete_task(b))
        self.assertEqual(self.commands.count('give Fixture123 minecraft:emerald 3'), 1)
        self.npc.tellraw.assert_not_called()

    def test_verified_automatic_reward_and_unknown_native_trader_are_distinct(self):
        b = self.board['board'][0]
        b.update(type='hunt', status='done', taker=[self.actor])
        self.assertTrue(self.guild.complete_task(b))
        self.assertEqual(b['rewardOutcome']['emeraldGiven'], {self.actor: 3})
        self.assertEqual(b['rewardOutcome']['fameRecorded'], {self.actor: 1})
        b.update(type='gather', status='claimed', taker=['Other'])
        b.pop('rewardOutcome')
        self.assertTrue(self.guild.settle_gather(b['qid'], '@p[distance=..5]', cmd_who='@p[distance=..5]'))
        self.assertEqual(b['rewardOutcome']['phase'], 'native_trade_identity_unknown')
        self.assertNotIn('Other', self.guild.load_fame())

    def test_delivery_full_bag_is_known_refusal_before_goods_are_removed(self):
        self.claim(); self.capacity = 0
        result = self.service.execute(self.request('deliver'))
        self.assertEqual(result['code'], 'inventory_full')
        self.assertEqual(self.inventory, {'wheat': 4, 'emerald': 0})
        self.assertFalse(any(c == 'clear Fixture123 minecraft:wheat 2' or c.startswith('give ') for c in self.commands))
        self.assertFalse((self.root / 'guild-transactions').exists())

    def test_acknowledgement_without_real_goods_delta_never_pays(self):
        self.claim(); self.failure = 'false_clear_ack'
        self.assertEqual(self.service.execute(self.request('deliver'))['code'], 'outcome_unknown')
        self.assertEqual(self.inventory, {'wheat': 4, 'emerald': 0})
        self.assertFalse(any(c.startswith('give ') for c in self.commands))

    def test_give_dropping_reward_does_not_record_inventory_receipt_or_fame(self):
        self.claim(); self.failure = 'drop_reward'
        result = self.service.execute(self.request('deliver'))
        self.assertEqual(result['code'], 'outcome_unknown')
        self.assertEqual(result['receipt']['emeraldAfter'], 0)
        self.assertEqual(self.guild.load_fame(), {})
        self.assertEqual(self.service.execute(self.request('deliver'))['code'], 'outcome_unknown')
        self.assertEqual(self.commands.count('give Fixture123 minecraft:emerald 3'), 1)

    def test_automatic_full_bag_defers_without_consuming_reward_then_pays_once(self):
        b = self.board['board'][0]; b.update(type='hunt', status='done', taker=[self.actor])
        self.capacity = 0
        self.assertFalse(self.guild.complete_task(b))
        self.assertEqual(b['rewardOutcome']['phase'], 'waiting_for_inventory')
        self.assertEqual(b['status'], 'claimed')
        self.assertFalse(any(c.startswith('give ') for c in self.commands))
        self.capacity = 64; b['status'] = 'done'
        self.assertTrue(self.guild.complete_task(b))
        self.assertFalse(self.guild.complete_task(b))
        self.assertEqual(self.commands.count('give Fixture123 minecraft:emerald 3'), 1)

    def test_automatic_dropped_emerald_is_unknown_without_fame(self):
        b = self.board['board'][0]; b.update(type='hunt', status='done', taker=[self.actor])
        self.failure = 'drop_reward'
        self.assertFalse(self.guild.complete_task(b))
        self.assertEqual(b['rewardOutcome']['phase'], 'outcome_unknown')
        self.assertEqual(self.guild.load_fame(), {})

    def test_query_includes_concrete_hunt_visit_objectives_and_actual_claim_limit(self):
        self.claim()
        self.board['board'].extend([
            {'no': 2, 'type': 'hunt', 'status': 'open', 'from': 'hesu', 'mob': 'skeleton', 'count': 2},
            {'no': 3, 'type': 'visit', 'status': 'open', 'from': 'hesu', 'spot': 'far_horizon', 'pos': None}])
        rows = self.service.execute(self.request('query'))['quests']
        self.assertEqual(rows[1]['objective']['mobId'], 'minecraft:skeleton')
        self.assertFalse(rows[1]['claimable'])
        self.assertIn('未完成', rows[1]['blockedReason'])
        self.assertEqual(rows[2]['objective']['minDistanceFromPlaza'], 300)
        self.assertEqual(rows[2]['objective']['plaza'], list(self.guild.PLAZA))


class GuildAdapterTests(unittest.TestCase):
    def test_mutation_validation_and_unknown_dispatch_are_fail_closed(self):
        for args in ({'quest_id': '2026-09-08:1', 'reward': 99}, {'quest_id': '2026-02-31:1'}, {'quest_id': '1'}):
            with self.assertRaises(ValueError):
                adapter.validate_guild_action('guild_deliver', args)
        adapter.validate_guild_action('guild_deliver', {'quest_id': '2026-09-08:1'})
        guild = adapter.Guild(SimpleNamespace(state=Path('fixture')), timeout=0)
        with patch.object(guild, '_request', return_value={'ok': False, 'code': 'pending'}):
            with self.assertRaisesRegex(ValueError, 'outcome_unknown'):
                guild.dispatch('guild_deliver', {'quest_id': '2026-09-08:1'})

    def test_request_requires_action_marker_and_keeps_exact_correlated_receipt(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); (root / 'queue').mkdir()
            gateway = SimpleNamespace(state=root / 'state', _settings=lambda: {'bodyName': 'Fixture123'},
                _check_binding=lambda: ('Fixture123', '11111111-1111-1111-1111-111111111111'), _now=lambda: 1000)
            guild = adapter.Guild(gateway, root / 'queue', timeout=0)
            with self.assertRaises(OSError):
                guild.dispatch('guild_claim', {'quest_id': '2026-09-08:1'})
            self.assertFalse((root / 'queue/requests').exists())
            requests.atomic_json(root / 'state/unknown.json', {'tool': 'guild_claim', 'result': 'unknown'})
            with self.assertRaisesRegex(ValueError, 'outcome_unknown'):
                guild.dispatch('guild_claim', {'quest_id': '2026-09-08:1'})
            marker = requests.read(root / 'state/unknown.json')
            identity = marker['requestId']
            requests.atomic_json(root / 'queue/results' / (identity + '.json'), {'ok': True, 'code': 'claimed',
                'requestId': identity, 'actor': 'Other'})
            self.assertEqual(guild.receipt(identity)['code'], 'guild_receipt_unavailable')

    def test_receipt_requires_original_current_and_result_uuid_not_just_login(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            identity, actor_uuid = str(uuid.uuid4()), str(uuid.uuid4())
            binding = Mock(return_value=('Fixture123', actor_uuid))
            gateway = SimpleNamespace(state=root / 'state', _settings=lambda: {'bodyName': 'Fixture123'}, _check_binding=binding)
            guild = adapter.Guild(gateway, root / 'queue')
            original = {'id': identity, 'actor': 'Fixture123', 'actorUuid': actor_uuid}
            requests.atomic_json(guild._request_path(identity), {'requestId': identity, 'actor': 'Fixture123', 'actorUuid': actor_uuid, 'request': original})
            result_path = root / 'queue/results' / (identity + '.json')
            valid = {'ok': True, 'code': 'claimed', 'requestId': identity, 'actor': 'Fixture123', 'actorUuid': actor_uuid}
            requests.atomic_json(result_path, valid)
            self.assertEqual(guild.receipt(identity)['code'], 'claimed')
            requests.atomic_json(result_path, valid | {'actorUuid': str(uuid.uuid4())})
            self.assertEqual(guild.receipt(identity)['code'], 'guild_receipt_unavailable')
            requests.atomic_json(result_path, valid)
            binding.return_value = ('Fixture123', str(uuid.uuid4()))
            self.assertEqual(guild.receipt(identity)['code'], 'guild_receipt_unavailable')
            binding.return_value = ('Fixture123', actor_uuid)
            requests.atomic_json(guild._request_path(identity), {'requestId': identity, 'actor': 'Fixture123', 'actorUuid': actor_uuid, 'request': original | {'id': str(uuid.uuid4())}})
            self.assertEqual(guild.receipt(identity)['code'], 'guild_receipt_unavailable')

    def test_every_ambiguous_code_or_wrong_success_polarity_preserves_unknown(self):
        guild = adapter.Guild(SimpleNamespace(state=Path('fixture')))
        for tool in adapter.GUILD_ACTIONS:
            for result in ({'ok': False, 'code': 'outcome_unknown'}, {'ok': False, 'code': 'unfamiliar'},
                           {'ok': False, 'code': 'completed'}, {'ok': True, 'code': 'missing_goods'}):
                with self.subTest(tool=tool, result=result), patch.object(guild, '_request', return_value=result):
                    with self.assertRaisesRegex(ValueError, 'outcome_unknown'):
                        guild.dispatch(tool, {'quest_id': '2026-09-08:1'})
        for code in adapter.DEFINITE_CODES - set(adapter.SUCCESS_CODES.values()):
            with self.subTest(code=code), patch.object(guild, '_request', return_value={'ok': False, 'code': code}):
                self.assertFalse(guild.dispatch('guild_deliver', {'quest_id': '2026-09-08:1'})['success'])


class GuildConsumerHealthTests(unittest.TestCase):
    def test_optional_consumer_becomes_required_when_enabled(self):
        spec = importlib.util.spec_from_file_location('guild_npc_health_fixture', ROOT / 'tools/npc_health.py')
        health = importlib.util.module_from_spec(spec); spec.loader.exec_module(health)
        healthy = {'updated_at': 100, 'rcon_last_ok': 100, 'spell_last_poll': 100,
                   'guild_requests_enabled': True, 'guild_requests_last_poll': 100,
                   'guild_npcs': {'ok': True, 'checked_at': 100},
                   'threads': {'spell': True, 'inbox': True, 'health': True, 'guild-requests': True}}
        for stamp, expected in ((100, True), (80, False), (None, False), (float('nan'), False), (True, False)):
            with self.subTest(stamp=stamp), patch.object(Path, 'read_text', return_value=json.dumps(healthy | {'guild_requests_last_poll': stamp})):
                self.assertEqual(health.inspect_health('/fixture', now=105)['ok'], expected)
        healthy['threads']['guild-requests'] = False
        with patch.object(Path, 'read_text', return_value=json.dumps(healthy)):
            self.assertFalse(health.inspect_health('/fixture', now=105)['ok'])


if __name__ == '__main__':
    unittest.main()

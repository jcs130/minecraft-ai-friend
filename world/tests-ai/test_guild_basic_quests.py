"""Real guild module with fictional NPC/RCON and temporary state only."""
import importlib.util
import json
import inspect
from pathlib import Path
import runpy
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

SOURCE = Path(__file__).resolve().parents[1] / 'sidecar/mc_guild.py'


class StopTick(BaseException):
    pass


class GuildBasicTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.quest = {'id': 'fictional-qid', 'villager': 'hesu', 'display': 'Fixture NPC',
                      'item': 'wheat', 'zh': 'wheat', 'count': 2, 'emerald': 3}
        self.npc = SimpleNamespace(DATA=str(self.folder), VDIR=str(self.folder), CFG={},
            GUILD_AUTOGENERATE=False, PROFILES=[{'key': key, 'display': key} for key in ('hesu', 'zhujiu', 'xiaoman')],
            R=SimpleNamespace(cmd=Mock(return_value='Fixture123 has 0 [killed_skeleton]')),
            quests_today=Mock(return_value={'quests': [self.quest]}),
            start_npc_thread=Mock(),
            player_pos=Mock(return_value=None), ledger_append=Mock(), goddess=Mock(),
            chronicle_append=Mock(), tellraw=Mock(), feed_append=Mock())
        spec = importlib.util.spec_from_file_location('guild_fixture', SOURCE)
        self.guild = importlib.util.module_from_spec(spec)
        with patch.dict('sys.modules', {'mc_npc': self.npc}), \
             patch.object(sys, 'path', [str(SOURCE.parent), *sys.path]), \
             patch.dict('os.environ', {'NPC_GUILD_BASIC_QUESTS': '1'}):
            spec.loader.exec_module(self.guild)

    def tick(self, doc):
        self.guild.BOARD = {'date': time.strftime('%Y-%m-%d'), 'doc': doc}
        self.guild.complete_task = Mock()
        with patch.object(self.guild.time, 'sleep', side_effect=StopTick):
            with self.assertRaises(StopTick):
                self.guild.guild_tick()

    def test_basic_board_has_real_hunts_and_distance_visit_without_build_commands(self):
        doc = self.guild.gen_board('2026-09-08')
        self.assertEqual({b['type'] for b in doc['board']}, {'gather', 'hunt', 'visit'})
        self.assertEqual([b['spot'] for b in doc['board'] if b['type'] == 'visit'], ['far_horizon'])
        self.assertEqual(json.loads((self.folder / 'guild-2026-09-08.json').read_text(encoding='utf-8')), doc)
        self.npc.R.cmd.assert_not_called()

    def test_existing_board_is_preserved_even_when_generation_called_again(self):
        doc = {'date': '2026-09-08', 'board': [{'no': 5, 'type': 'hunt', 'status': 'claimed',
                 'taker': ['Fixture123'], 'baseline': {'Fixture123': 7}, 'mob': 'skeleton', 'count': 2}]}
        path = self.folder / 'guild-2026-09-08.json'
        original = json.dumps(doc).encode()
        path.write_bytes(original)
        self.assertEqual(self.guild.gen_board('2026-09-08'), doc)
        self.assertEqual(path.read_bytes(), original)
        self.npc.R.cmd.assert_not_called()

    def test_disabled_generation_cannot_spawn_through_imported_boss_or_direct_build(self):
        for function, args in [(self.guild.build_treasure, (1, 2, 3)),
                               (self.guild.build_lair, (1, 2, 3)), (self.guild.summon_boss, (1,))]:
            with self.assertRaises(RuntimeError): function(*args)
        self.assertIsNotNone(self.guild._new_claim_block({'type': 'boss'}))
        self.assertIsNotNone(self.guild._new_claim_block({'type': 'visit', 'spot': 'outpost'}))
        self.npc.R.cmd.assert_not_called()

    def test_daily_gather_must_match_goods_not_just_reused_id(self):
        doc = self.guild.gen_board(time.strftime('%Y-%m-%d'))
        task = next(b for b in doc['board'] if b['type'] == 'gather')
        self.guild.BOARD = {'date': doc['date'], 'doc': doc}
        self.guild.complete_task = Mock()
        self.quest['item'] = 'paper'
        self.assertFalse(self.guild.settle_gather(task['qid'], 'Fixture123'))
        self.assertEqual(task['status'], 'open')
        self.guild.complete_task.assert_not_called()
        self.quest['item'] = 'wheat'
        self.assertTrue(self.guild.settle_gather(task['qid'], 'Fixture123'))
        self.guild.complete_task.assert_called_once()

    def test_hunt_requires_actual_new_kills_and_does_not_parse_digits_in_player_name(self):
        self.npc.R.cmd.return_value = 'Fixture123 has 7 [killed_skeleton]'
        self.assertEqual(self.guild.hunt_score('Fixture123', 'skeleton'), 7)
        self.npc.R.cmd.return_value = 'Unable to connect'
        self.assertIsNone(self.guild.hunt_score('Fixture123', 'skeleton'))
        self.npc.R.cmd.return_value = "Can't get value of killed_skeleton for Fixture123; none is set"
        self.assertEqual(self.guild.hunt_score('Fixture123', 'skeleton'), 0)
        task = {'type': 'hunt', 'status': 'claimed', 'taker': ['Fixture123'], 'mob': 'skeleton',
                'count': 2, 'baseline': {'Fixture123': 7}}
        doc = {'date': time.strftime('%Y-%m-%d'), 'board': [task]}
        with patch.object(self.guild, 'hunt_score', return_value=7): self.tick(doc)
        self.guild.complete_task.assert_not_called()
        with patch.object(self.guild, 'hunt_score', return_value=None): self.tick(doc)
        self.guild.complete_task.assert_not_called()
        with patch.object(self.guild, 'hunt_score', return_value=9): self.tick(doc)
        self.guild.complete_task.assert_called_once()
        self.assertEqual(task['status'], 'done')

    def test_visit_requires_online_position_and_real_distance_before_reward(self):
        task = {'type': 'visit', 'status': 'claimed', 'taker': ['Fixture123'],
                'spot': 'far_horizon', 'pos': [0, 64, 0], 'r': 0}
        doc = {'date': time.strftime('%Y-%m-%d'), 'board': [task]}
        self.tick(doc)
        self.guild.complete_task.assert_not_called()
        self.npc.player_pos.return_value = list(self.guild.PLAZA)
        self.tick(doc)
        self.guild.complete_task.assert_not_called()
        x, y, z = self.guild.PLAZA
        self.npc.player_pos.return_value = [x + 301, y, z]
        self.tick(doc)
        self.guild.complete_task.assert_called_once()
        health = json.loads((self.folder / 'guild-health.json').read_text(encoding='utf-8'))
        self.assertFalse(health['autogenerate'])
        self.assertTrue(health['basic_quests'])
        self.assertGreater(health['last_success_at'], 0)
        self.assertNotIn('Fixture123', json.dumps(health))

    def test_legacy_distance_quest_without_spot_is_not_confused_with_old_outpost(self):
        legacy = {'type': 'visit', 'r': 0, 'zh': '远方的地平线', 'title': '朝圣·远方的地平线'}
        self.assertIsNone(self.guild._new_claim_block(legacy))
        self.assertTrue(self.guild._is_far_horizon(legacy))
        legacy['zh'] = '矿场前哨'
        self.assertFalse(self.guild._is_far_horizon(legacy))
        self.assertIsNotNone(self.guild._new_claim_block(legacy))

    def test_failed_hunt_baseline_never_claims_or_counts_old_kills(self):
        doc = self.guild.gen_board(time.strftime('%Y-%m-%d'))
        self.guild.BOARD = {'date': doc['date'], 'doc': doc}
        task = next(b for b in doc['board'] if b['type'] == 'hunt')
        with patch.object(self.guild, 'hunt_score', return_value=None):
            self.guild.claim('Fixture123', task['no'])
        self.assertEqual(task['status'], 'open')
        self.npc.ledger_append.assert_not_called()
        with patch.object(self.guild, 'hunt_score', return_value=12):
            self.guild.claim('Fixture123', task['no'])
        self.assertEqual(task['baseline'], {'Fixture123': 12})
        self.assertEqual(task['status'], 'claimed')

    def test_start_registers_supervised_thread_and_publishes_initial_health(self):
        self.guild.start()
        self.guild.start()
        self.npc.start_npc_thread.assert_called_once_with('guild', self.guild.guild_tick)
        health = json.loads((self.folder / 'guild-health.json').read_text(encoding='utf-8'))
        self.assertGreater(health['last_success_at'], 0)

    def test_board_wrapper_keeps_text_and_reads_only_open_gather_quests(self):
        common = {'rank': 0, 'title': '收购·小麦', 'display': 'Fixture NPC', 'reward': 3,
                  'type': 'gather', 'qid': self.quest['id'], 'from': 'hesu', 'item': 'wheat', 'count': 2}
        board = [{**common, 'no': 1, 'status': 'open'},
                 {**common, 'no': 2, 'status': 'claimed', 'taker': 'Fixture123'},
                 {**common, 'no': 3, 'status': 'done', 'done_by': 'Fixture456'},
                 {'no': 4, 'type': 'boss', 'status': 'open', 'rank': 2, 'party': 2,
                  'title': '讨伐·暴怒的劫掠兽', 'display': '公会接待员·岚', 'reward': 8, 'fame': 6}]
        with patch.object(self.guild, 'board_today', return_value={'date': '2026-09-08', 'board': board}):
            self.assertEqual(self.guild.board_lines(), [
                '【今日看板 · 2026-09-08】',
                'No.1 收购·小麦（Fixture NPC · 酬3绿/功勋1）[可接]',
                'No.2 收购·小麦（Fixture NPC · 酬3绿/功勋1）[→Fixture123]',
                'No.3 收购·小麦（Fixture NPC · 酬3绿/功勋1）[✔Fixture456]',
                'No.4 [白银]讨伐·暴怒的劫掠兽·组队2人（公会接待员·岚 · 酬8绿/功勋6）[暂停接取]',
                '——接单：接 编号｜组队：组队接 编号 邀请 队友（被邀者回「入队」）｜交付：对岚说 交付 编号｜放弃：放弃 编号',
            ])
        self.npc.quests_today.assert_called_once_with()
        self.npc.R.cmd.assert_not_called()

    def test_rule_wrappers_keep_fresh_quest_reads_and_fail_closed(self):
        task = {'type': 'gather', 'qid': self.quest['id'], 'from': 'hesu', 'item': 'wheat', 'count': 2, 'reward': 3}
        self.assertIsNone(self.guild._new_claim_block(task))
        self.quest['count'] = 3
        self.assertIsNotNone(self.guild._new_claim_block(task))
        self.npc.quests_today.side_effect = OSError('fixture unreadable')
        self.assertFalse(self.guild._gather_matches(task))
        self.assertIsNotNone(self.guild._new_claim_block(task))
        self.assertEqual(self.npc.quests_today.call_count, 4)
        self.npc.R.cmd.assert_not_called()

    def test_rank_and_display_wrappers_keep_existing_file_read_boundaries(self):
        rec = {'fame': 10, 'done': 2, 'joined': '09-07'}
        with patch.object(self.guild, 'load_fame', return_value={'Fixture123': rec}) as load:
            self.assertIsNone(self.guild._rank_gate('Fixture123', {'no': 1, 'rank': 0}))
            load.assert_not_called()
            self.assertIsNone(self.guild._rank_gate('Fixture123', {'no': 1, 'rank': 1}))
            load.assert_called_once_with()
            self.assertEqual(self.guild.fame_lines('Fixture123'),
                ['Fixture123：功勋 10，等级「黑铁」，已完成 2 单（09-07入会）。再攒 20 功勋升白银。'])
            self.assertEqual(load.call_count, 2)
        with patch.object(self.guild, 'board_today', return_value={'board': []}) as load:
            self.assertEqual(self.guild.my_lines('Fixture123'),
                ['你眼下没有在办的委托。看板就在墙上——说「看板」瞅瞅去。'])
            load.assert_called_once_with()

    def test_compatibility_signatures_and_script_directory_import(self):
        signatures = {'rank_of': '(fame)', 'rank_idx_of': '(fame)', '_zh_num': '(s)',
                      '_takers': '(b)', '_rank_gate': '(who, b)', '_gather_matches': '(b)',
                      '_is_far_horizon': '(b)', '_new_claim_block': '(b)', 'board_lines': '()',
                      'my_lines': '(who)', 'fame_lines': '(who)'}
        for name, expected in signatures.items():
            self.assertEqual(str(inspect.signature(getattr(self.guild, name))), expected)
        with patch.dict('sys.modules', {'mc_npc': self.npc}), \
             patch.object(sys, 'path', [str(SOURCE.parent), *sys.path]), \
             patch.dict('os.environ', {'NPC_GUILD_BASIC_QUESTS': '1'}):
            namespace = runpy.run_path(str(SOURCE), run_name='__main__')
        self.assertEqual(namespace['rank_of'](30), '白银')
        self.npc.R.cmd.assert_not_called()
        self.npc.start_npc_thread.assert_not_called()


if __name__ == '__main__':
    unittest.main()

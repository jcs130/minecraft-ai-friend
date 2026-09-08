"""Offline contract and text fixtures for the extracted existing guild rules."""
from copy import deepcopy
import importlib.util
from pathlib import Path
import socket
import threading
import unittest
from unittest.mock import patch


SOURCE = Path(__file__).resolve().parents[1] / 'sidecar/guild_rules.py'


def load_rules():
    spec = importlib.util.spec_from_file_location('guild_rules_fixture', SOURCE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class GuildRulesTests(unittest.TestCase):
    def setUp(self):
        self.rules = load_rules()

    def test_import_and_use_need_no_runtime_paths_network_or_threads(self):
        with patch.dict('os.environ', {}, clear=True), \
             patch.dict('sys.modules', {'mc_npc': None}), \
             patch('builtins.open', side_effect=AssertionError('runtime file access')), \
             patch.object(socket, 'socket', side_effect=AssertionError('network access')), \
             patch.object(threading.Thread, 'start', side_effect=AssertionError('thread start')):
            rules = load_rules()
            self.assertEqual(rules.rank_of(10), '黑铁')
            self.assertIsNone(rules.new_claim_block({'type': 'hunt'}, True, False))
            self.assertEqual(rules.board_header('2026-09-08'), '【今日看板 · 2026-09-08】')

    def test_original_rank_thresholds_and_negative_fame(self):
        cases = [(-1, 0, '青铜'), (0, 0, '青铜'), (9, 0, '青铜'),
                 (10, 1, '黑铁'), (29, 1, '黑铁'), (30, 2, '白银'),
                 (69, 2, '白银'), (70, 3, '黄金'), (149, 3, '黄金'),
                 (150, 4, '白金'), (349, 4, '白金'), (350, 5, '钻石'), (999, 5, '钻石')]
        for fame, index, name in cases:
            with self.subTest(fame=fame):
                self.assertEqual(self.rules.rank_of(fame), name)
                self.assertEqual(self.rules.rank_idx_of(fame), index)

    def test_rank_refusal_preserves_chinese_and_can_use_supplied_rank_table(self):
        task = {'no': 7, 'rank': 2}
        expected = ('（把名册翻得哗啦响）No.7 是白银级委托（要功勋30），你眼下是黑铁、功勋10——差着档呢，再喊几遍也接不上。'
                    '先挑看板上没标档位的单子做（说「接 编号」），攒够功勋升白银再来。说「我的」看你手头在办的单子。')
        self.assertEqual(self.rules.rank_gate(task, 10), expected)
        self.assertIsNone(self.rules.rank_gate(task, 30))
        self.assertIsNone(self.rules.rank_gate({'no': 1}, -1))
        ranks = [('见习', 0), ('正式', 5)]
        self.assertEqual(self.rules.rank_of(5, ranks), '正式')
        self.assertEqual(self.rules.rank_idx_of(5, ranks), 1)

    def test_fullwidth_numbers_and_legacy_taker_shape(self):
        self.assertEqual(self.rules.zh_num('１２'), 12)
        self.assertEqual(self.rules.zh_num('3４'), 34)
        for value in (None, '', []):
            self.assertEqual(self.rules.takers({'taker': value}), [])
        self.assertEqual(self.rules.takers({'taker': 'Fixture123'}), ['Fixture123'])
        team = ['Fixture123', 'Fixture456']
        self.assertIs(self.rules.takers({'taker': team}), team)

    def test_gather_checks_every_original_field_and_keeps_first_id_match(self):
        task = {'qid': 'q1', 'from': 'hesu', 'item': 'wheat', 'count': 2, 'reward': 3}
        quest = {'id': 'q1', 'villager': 'hesu', 'item': 'wheat', 'count': 2, 'emerald': 3}
        self.assertTrue(self.rules.gather_matches(task, [quest]))
        for field, other in [('id', 'q2'), ('villager', 'other'), ('item', 'paper'),
                             ('count', 3), ('emerald', 4)]:
            with self.subTest(field=field):
                changed = {**quest, field: other}
                self.assertFalse(self.rules.gather_matches(task, [changed]))
        self.assertFalse(self.rules.gather_matches(task, []))
        self.assertFalse(self.rules.gather_matches(task, [{**quest, 'item': 'paper'}, quest]))
        # This matcher never owned the settlement status check.
        self.assertTrue(self.rules.gather_matches(task, [{**quest, 'done': True}]))
        self.assertFalse(self.rules.gather_matches(task, [{**quest, 'count': '2'}]))

    def test_only_exact_legacy_far_horizon_can_omit_spot(self):
        legacy = {'type': 'visit', 'r': 0, 'zh': '远方的地平线', 'title': '朝圣·远方的地平线'}
        self.assertTrue(self.rules.is_far_horizon(legacy))
        self.assertTrue(self.rules.is_far_horizon({'spot': 'far_horizon'}))
        for changes in ({'r': 8}, {'zh': '矿场前哨'}, {'title': '其他朝圣'}, {'spot': 'outpost'}):
            with self.subTest(changes=changes):
                self.assertFalse(self.rules.is_far_horizon({**legacy, **changes}))

    def test_pause_rules_keep_existing_switch_semantics_and_wording(self):
        self.assertEqual(self.rules.new_claim_block({'type': 'gather'}, False, True),
            '这笔旧收购单与今日柜台货单不一致，暂不能接；请按当前村民柜台交货，或选普通讨伐和远行委托。')
        self.assertEqual(self.rules.new_claim_block({'type': 'boss'}, True, False),
            '这单需要召唤新的首领，本服暂未开放；已有记录保留，请先选普通讨伐或远行委托。')
        self.assertEqual(self.rules.new_claim_block({'type': 'visit', 'spot': 'outpost'}, True, False),
            '这处旧地点尚未在本世界核验，暂不能接；请选远方地平线或普通讨伐委托。')
        for kind in ('hunt', 'lair', 'treasure', 'gather'):
            self.assertIsNone(self.rules.new_claim_block({'type': kind}, True, False))
        for task in ({'type': 'boss'}, {'type': 'visit', 'spot': 'outpost'}):
            self.assertIsNone(self.rules.new_claim_block(task, True, True))

    def test_board_markers_and_row_keep_status_rank_and_party_text(self):
        self.assertEqual(self.rules.board_mark({'status': 'done', 'done_by': '甲'}), '✔甲')
        self.assertEqual(self.rules.board_mark({'status': 'done'}), '✔')
        self.assertEqual(self.rules.board_mark({'status': 'claimed', 'taker': '甲'}), '→甲')
        self.assertEqual(self.rules.board_mark({'status': 'claimed', 'taker': ['甲', '乙']}), '→甲+乙')
        self.assertEqual(self.rules.board_mark({'status': 'open'}), '可接')
        self.assertEqual(self.rules.board_mark({'status': 'open', 'rank': 2}), '可接·需白银档')
        task = {'no': 4, 'rank': 2, 'party': 2, 'title': '讨伐·暴怒的劫掠兽',
                'display': '公会接待员·岚', 'reward': 8, 'fame': 6}
        self.assertEqual(self.rules.board_row(task, self.rules.BOARD_PAUSED_MARK),
            'No.4 [白银]讨伐·暴怒的劫掠兽·组队2人（公会接待员·岚 · 酬8绿/功勋6）[暂停接取]')

    def test_my_lines_keep_all_six_existing_task_descriptions(self):
        common = {'status': 'claimed', 'taker': ['Fixture123', 'Fixture456'],
                  'display': '农夫·禾穗', 'dir': '北', 'dist': '约90格', 'count': 2, 'zh': '小麦'}
        kinds = ['gather', 'lair', 'treasure', 'boss', 'hunt', 'visit']
        board = [{**common, 'no': index + 1, 'type': kind, 'title': kind}
                 for index, kind in enumerate(kinds)]
        self.assertEqual(self.rules.my_lines('Fixture123', board), [
            '你手头的委托：',
            'No.1 gather——把 2 个小麦交到 农夫·禾穗 手上（对他说：交易：禾穗 给2小麦）',
            'No.2 lair——去广场北约90格外的哥布林营地（与Fixture456组队），从赃物箱夺 2 枚小麦，回来对我说「交付 2」',
            'No.3 treasure——宝箱埋在广场北约90格外的土下，挖出钻石信物，回来对我说「交付 3」',
            'No.4 boss——组队讨伐暴怒的劫掠兽（与Fixture456组队）——它盘踞在广场一带的荒野，队内任一人击杀即算达成',
            'No.5 hunt——去讨伐 2 只小麦（杀够自动结算）（与Fixture456组队）',
            'No.6 visit——去一趟「小麦」（走到即结算）',
        ])

    def test_my_lines_exclude_other_players_and_finished_tasks(self):
        board = [{'status': 'open'}, {'status': 'done'},
                 {'status': 'claimed', 'taker': 'OtherPlayer'}]
        self.assertEqual(self.rules.my_lines('Fixture123', board),
            ['你眼下没有在办的委托。看板就在墙上——说「看板」瞅瞅去。'])

    def test_fame_lines_keep_missing_record_next_rank_and_max_rank(self):
        self.assertEqual(self.rules.fame_lines('Fixture123', None),
            ['（翻了翻名册）还没有你的名字。说「注册」入会，或者直接接一单活儿——办成一单你就是青铜冒险者。'])
        self.assertEqual(self.rules.fame_lines('Fixture123', {'fame': 10, 'done': 2, 'joined': '09-07'}),
            ['Fixture123：功勋 10，等级「黑铁」，已完成 2 单（09-07入会）。再攒 20 功勋升白银。'])
        self.assertEqual(self.rules.fame_lines('Fixture123', {'fame': 350, 'done': 50}),
            ['Fixture123：功勋 350，等级「钻石」，已完成 50 单（?入会）。已是巅峰。'])

    def test_rule_and_display_calls_leave_supplied_state_unchanged(self):
        task = {'no': 1, 'type': 'gather', 'status': 'claimed', 'taker': ['Fixture123'],
                'qid': 'q1', 'from': 'hesu', 'item': 'wheat', 'count': 2, 'reward': 3,
                'title': '收购·小麦', 'zh': '小麦', 'display': '农夫·禾穗'}
        quest = {'id': 'q1', 'villager': 'hesu', 'item': 'wheat', 'count': 2, 'emerald': 3}
        fame = {'fame': 10, 'done': 2}
        original = deepcopy((task, quest, fame))
        self.rules.gather_matches(task, [quest])
        self.rules.new_claim_block(task, True, False)
        self.rules.board_row(task, self.rules.board_mark(task))
        self.rules.my_lines('Fixture123', [task])
        self.rules.fame_lines('Fixture123', fame)
        self.assertEqual((task, quest, fame), original)


if __name__ == '__main__':
    unittest.main()

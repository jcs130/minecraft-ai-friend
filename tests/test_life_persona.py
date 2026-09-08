import importlib.util
import json
from pathlib import Path
import sys
import unittest


SPEC = importlib.util.spec_from_file_location(
    'life_persona', Path(__file__).parents[1] / 'world/ops/life_persona.py',
)
persona = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(persona)


class LifePersonaTests(unittest.TestCase):
    def test_kirito_replaces_only_known_technical_line(self):
        custom = '用户补充：我喜欢雨天。\n'
        existing = {
            'PROFILE.md': '# 桐人\n\n' + persona.LEGACY_KIRITO_PROFILE + '\n' + custom,
            'SOUL.md': '用户定义的灵魂，不可改。',
            'AGENTS.md': '世界动作必须有真实授权。\n',
        }
        result = persona.prepare_files('qd-survivor', '桐人', existing)
        self.assertNotIn(persona.LEGACY_KIRITO_PROFILE, result['PROFILE.md'])
        self.assertIn(custom, result['PROFILE.md'])
        self.assertIn('结衣', result['PROFILE.md'])
        self.assertTrue(result['AGENTS.md'].startswith(existing['AGENTS.md']))
        self.assertNotIn('SOUL.md', result)
        self.assertIn('待核实当前进度', result['memory/goals.md'])

    def test_yui_exact_generated_identity_moves_out_of_profile(self):
        row = {'maidUuid': 'e6ef6001-47c6-4f13-823c-1b724520d164',
               'ownerUuid': 'd4ac9523-4962-43ed-98c5-19b49e104048',
               'name': '结衣', 'personaRevision': 2}
        old = '# 固定身份\n\n' + json.dumps(row, ensure_ascii=False) + '\n私人补充原样保留\n'
        result = persona.prepare_files('5swvhK', '结衣', {'PROFILE.md': old})
        self.assertNotIn('maidUuid', result['PROFILE.md'])
        self.assertNotIn('# 固定身份', result['PROFILE.md'])
        self.assertIn('私人补充原样保留\n', result['PROFILE.md'])
        self.assertIn('爸爸', result['PROFILE.md'])
        self.assertNotIn('女仆', result['PROFILE.md'])

    def test_unknown_identity_json_and_user_text_are_preserved(self):
        old = '# 固定身份\n{"name":"结衣","custom":"用户信息"}\n'
        result = persona.prepare_files('5swvhK', '结衣', {'PROFILE.md': old})
        self.assertTrue(result['PROFILE.md'].startswith(old))

    def test_existing_memory_and_goals_never_overwritten_even_empty(self):
        existing = {'MEMORY.md': '', 'memory/goals.md': '已完成的真实记录\n'}
        result = persona.prepare_files('qd-survivor', '桐人', existing)
        self.assertNotIn('MEMORY.md', result)
        self.assertNotIn('memory/goals.md', result)

    def test_idempotent_and_preserves_custom_text_around_managed_blocks(self):
        existing = {'PROFILE.md': '用户前言\r\n', 'AGENTS.md': '既有规则\r\n'}
        first = persona.prepare_files('qd-survivor', '桐人', existing)
        merged = {**existing, **first}
        self.assertEqual({}, persona.prepare_files('qd-survivor', '桐人', merged))
        merged['PROFILE.md'] += '后加的个人偏好\r\n'
        merged['AGENTS.md'] += '后加的行为约定\r\n'
        self.assertEqual({}, persona.prepare_files('qd-survivor', '桐人', merged))
        self.assertNotIn('\n', first['AGENTS.md'].replace('\r\n', ''))

    def test_malformed_owned_blocks_fail_without_destructive_repair(self):
        for text in (persona.MEMORY_START, persona.MEMORY_END + persona.MEMORY_START,
                     persona.MEMORY_START + persona.MEMORY_END + persona.MEMORY_START + persona.MEMORY_END):
            with self.subTest(text=text), self.assertRaises(ValueError):
                persona.prepare_files('qd-survivor', '桐人', {'AGENTS.md': text})

    def test_only_expected_people_and_text_input(self):
        for role, name in (('qd-survivor', '结衣'), ('5swvhK', '小灯'), ('../oops', '结衣')):
            with self.subTest(role=role), self.assertRaises(ValueError):
                persona.prepare_files(role, name, {})
        with self.assertRaises(ValueError):
            persona.prepare_files('qd-survivor', '桐人', {'MEMORY.md': None})

    def test_real_legacy_policy_migrates_without_overwriting_custom_notes(self):
        old_review = (
            '用 remember(turn_id,goal,lesson,next_focus,goal_state,review_after_seconds) 记录目标、实测经验与下一关注点，每项最多1000字。'
            'goal_state 取 ongoing/completed/blocked/resting；review_after_seconds 为180–3600秒，默认1800；'
            '仍受控制器当前的决策冷却和滚动24小时额度限制，以管理页实际预算为准。completed 会在冷却后选择下一个目标。'
            '程序技能的逐步执行不逐步调用模型；缺乏变化时安排较长观察间隔。'
        )
        old_final = (
            '禁止把尝试写成成功；目标完成须用实际库存、位置或相应游戏回执核验。'
            '新规划任务仍受现有每日额度与180秒冷却限制，同一 task 的连续工具调用不另收规划名额。'
            '控制器负责唤醒、执行互斥、暂停和预算，你负责主动感知和决定行动；不创建第二套生存定时任务或额外大脑。'
        )
        custom = '\n用户补充：保留我的生活笔记与任务记录。\n'
        existing = {'AGENTS.md': old_review + custom + old_final}
        result = persona.prepare_files('qd-survivor', '桐人', existing)
        migrated = result['AGENTS.md']
        self.assertIn(custom, migrated)
        self.assertIn('程序技能的逐步执行不逐步调用模型', migrated)
        self.assertIn('不创建第二套生存定时任务或额外大脑', migrated)
        canonical = (Path(__file__).parents[1] / 'world/survival/AGENT.md').read_text(encoding='utf8')
        for old, new in persona.SURVIVOR_POLICY_TEXT_UPDATES:
            self.assertNotIn(old, migrated)
            self.assertIn(new, migrated)
            self.assertIn(new, canonical)
        self.assertEqual({}, persona.prepare_files('qd-survivor', '桐人', {**existing, **result}))
        # The offline synchronizer must use the same replacements. A newer
        # paragraph elsewhere must not cause an obsolete duplicate to survive.
        sys.path.insert(0, str(Path(__file__).parents[1] / 'world/ops'))
        try:
            from sync_role_learning import update_survivor_text
            source = existing['AGENTS.md'] + '\n' + persona.SURVIVOR_POLICY_TEXT_UPDATES[0][1]
            synced = update_survivor_text(source)
            self.assertIn(custom, synced)
            for old, new in persona.SURVIVOR_POLICY_TEXT_UPDATES:
                self.assertNotIn(old, synced)
                self.assertIn(new, synced)
            self.assertEqual(synced, update_survivor_text(synced))
        finally:
            sys.path.pop(0)


if __name__ == '__main__':
    unittest.main()

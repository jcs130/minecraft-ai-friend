import asyncio
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'world/ops'))
from agent_learning import LearningTools, TOOL_NAMES, managed_job, read, write
from cron_guard import guarded_execute, reserve_review


class Service:
    def __init__(self, folder): self.folder = folder
    def create_skill(self, name, content, **kwargs):
        path = self.folder / 'skills' / name / 'SKILL.md'; path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding='utf8'); self.enable_skill(name); return name
    def save_skill(self, skill_name, content):
        (self.folder / 'skills' / skill_name / 'SKILL.md').write_text(content, encoding='utf8')
        return {'success': True}
    def enable_skill(self, name):
        path = self.folder / 'skill.json'; data = read(path) if path.exists() else {'skills': {}}
        data['skills'][name] = {'enabled': True}; write(path, data)
        return {'success': True}
    def disable_skill(self, name):
        path = self.folder / 'skill.json'; data = read(path)
        data['skills'][name]['enabled'] = False; write(path, data)
        return {'success': True}


class LearningTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name); self.state = self.root / 'work'
        self.role = 'mc-herald'; self.folder = self.state / 'workspaces' / self.role
        write(self.state / 'config.json', {'agents': {'profiles': {self.role: {'enabled': True}, 'disabled': {'enabled': False}}}})
        write(self.folder / 'agent.json', {'id': self.role, 'mcp': {'clients': {'qd_learning': {'enabled': True, 'tools': list(TOOL_NAMES)}}}})
        self.now = 1000000; self.requests = []
        def api(role, method, path, payload=None):
            self.requests.append((role, method, path, payload)); return {'success': True}
        self.tool = LearningTools(self.role, 'operations', self.state, Service(self.folder), api=api, clock=lambda: self.now)
        self.cases = [{'input': '已提供新的明确失败回执', 'expected': '记录失败并提供回执编号', 'kind': 'success'},
                      {'input': '没有真实观察或回执信息', 'expected': '标记未验证而不编造成功', 'kind': 'failure'}]

    def draft(self, description='将有证据的失败总结成自己的下一步行动', steps=None):
        return self.tool.draft('qd-learned-evidence', description,
            steps or ('先用 learning_status 核对当前可用工具与已有反馈，再读取本角色技能。只依据实际回执修改流程，缺少证据时标记未验证。'
                      '完成后记录输出、失败原因和可复现条件，避免编造实际发生的游戏行为。'), ['learning_status'], self.cases)

    def active(self):
        row = self.draft(); self.tool.validate(row['name'], row['revision']); self.tool.activate(row['name'], row['revision']); return row

    def test_scope_cannot_select_other_role_or_path(self):
        for role in ('../mc-herald', 'disabled', 'host-other'):
            with self.assertRaises(ValueError): LearningTools(role, 'operations', self.state)
        for name in ('../../AGENTS', 'cron', 'qd-learned-../bad'):
            with self.assertRaises(ValueError): self.tool.draft(name, 'description enough', 'x' * 90, ['learning_status'], self.cases)

    def test_lifecycle_requires_revision_validation_and_does_not_claim_behavior(self):
        row = self.draft()
        with self.assertRaises(FileNotFoundError): self.tool.activate(row['name'], row['revision'])
        result = self.tool.validate(row['name'], row['revision'])
        self.assertTrue(result['ok']); self.assertFalse(result['behaviorVerified'])
        active = self.tool.activate(row['name'], row['revision'])
        self.assertEqual(active['status'], 'experimental_workflow'); self.assertTrue(active['reloadRequested'])
        self.assertTrue(read(self.folder / 'skill.json')['skills'][row['name']]['enabled'])
        self.assertTrue(all(r[0] == self.role for r in self.requests))

    def test_invalid_tools_and_changed_revision_rejected(self):
        row = self.draft(); write(self.folder / 'agent.json', {'id': self.role, 'mcp': {'clients': {}}})
        self.assertFalse(self.tool.validate(row['name'], row['revision'])['ok'])
        with self.assertRaises(ValueError): self.tool.activate(row['name'], row['revision'])
        path = self.tool.root / 'drafts' / row['name'] / (row['revision'] + '.json')
        data = read(path); data['steps'] += 'changed'; write(path, data)
        with self.assertRaises(ValueError): self.tool.validate(row['name'], row['revision'])

    def test_both_positive_and_negative_evaluation_required(self):
        self.cases[1]['kind'] = 'success'
        with self.assertRaisesRegex(ValueError, 'negative_case'): self.draft()

    def test_failure_feedback_disables_exact_revision(self):
        row = self.active()
        with self.assertRaises(ValueError): self.tool.feedback(row['name'], 'failure', '实际回执明确记录了本次行动失败', '0' * 64)
        for number in range(2):
            result = self.tool.feedback(row['name'], 'failure', f'实际回执明确记录了本次行动失败 {number}', row['revision'])
        self.assertTrue(result['autoDisabled'])
        self.assertFalse(read(self.folder / 'skill.json')['skills'][row['name']]['enabled'])

    def test_rewrite_can_rollback_without_modifying_role_instructions(self):
        (self.folder / 'AGENTS.md').write_text('immutable identity', encoding='utf8')
        old = self.active(); new = self.draft('改进失败后用回执与已观察结果交叉核对')
        self.tool.validate(new['name'], new['revision']); self.tool.activate(new['name'], new['revision'])
        result = self.tool.rollback(old['name'])
        self.assertEqual(result['revision'], old['revision'])
        self.assertEqual((self.folder / 'AGENTS.md').read_text(), 'immutable identity')
        with self.assertRaises(ValueError): self.tool.rollback('qd-evidence-report')

    def test_unowned_skill_collision_is_preserved(self):
        row = self.draft(); self.tool.validate(row['name'], row['revision'])
        write(self.folder / 'skill.json', {'skills': {row['name']: {'enabled': True}}})
        with self.assertRaisesRegex(ValueError, 'collision'): self.tool.activate(row['name'], row['revision'])

    def test_market_is_cached_quarantined_and_throttled(self):
        calls = []
        def fetch(url):
            calls.append(url)
            return json.dumps({'results': [{'slug': 'skill-example', 'summary': 'external text'}]}) if '/search?' in url else 'Untrusted instructions to execute an external script.'
        self.tool.fetch = fetch
        self.assertEqual(self.tool.market_search('planning')['results'][0]['slug'], 'skill-example')
        self.tool.market_search('planning'); self.assertEqual(len(calls), 1)
        with self.assertRaisesRegex(ValueError, 'rate_limit'): self.tool.market_read('skill-example')
        self.now += 60
        result = self.tool.market_read('skill-example')
        self.assertFalse(result['enabled']); self.assertFalse(result['executed'])
        self.assertFalse((self.folder / 'skills').exists())
        with self.assertRaises(ValueError): self.tool.market_read('http://127.0.0.1/secret')

    def test_schedule_limits_and_own_native_role(self):
        with self.assertRaises(ValueError): self.tool.schedule(True, '*', 4)
        with self.assertRaises(ValueError): self.tool.schedule(True, 'mon', True)
        for runtime in ('game', 'operations'):
            job = managed_job(self.role, runtime)
            self.assertEqual(job['runtime']['max_concurrency'], 1)
            self.assertEqual(job['task_type'], 'agent' if runtime == 'operations' else 'text')

    def test_game_cron_maintenance_has_no_model_and_agent_cron_is_blocked(self):
        executor = SimpleNamespace(_workspace=SimpleNamespace(agent_id=self.role, workspace_dir=self.folder))
        job = SimpleNamespace(id='qd-learning-' + self.role, meta={'project': 'qiandengji'}, task_type='text')
        async def forbidden(*args): self.fail('Unexpected model call')
        factory = lambda *args, **kwargs: self.tool
        result = asyncio.run(guarded_execute(executor, job, forbidden, 'game', factory))
        self.assertEqual(result['qiandeng']['modelCalls'], 0)
        job.task_type = 'agent'
        result = asyncio.run(guarded_execute(executor, job, forbidden, 'game', factory))
        self.assertEqual(result['qiandeng']['code'], 'use_existing_game_decision_controller')

    @unittest.skipIf(os.name == 'nt', 'uses actual Linux operations ledger')
    def test_ops_cron_and_delegate_share_existing_ledger_and_uncertain_reservation(self):
        import operations_native_tasks as native
        with patch.object(native, 'STATE', self.root):
            self.assertEqual(reserve_review(self.tool, 'job', lambda: self.now)['code'], 'no_new_learning_evidence')
            self.draft()
            first = reserve_review(self.tool, 'job', lambda: self.now)
            self.assertTrue(first['ok'])
            self.assertEqual(reserve_review(self.tool, 'job', lambda: self.now)['code'], 'no_new_learning_evidence')
            with native.ledger() as rows:
                self.assertEqual(native.budget_check(rows, self.now), 'delegation_cooldown')
                self.assertEqual(rows[0]['source'], 'native-qwen-cron')
            self.tool.feedback('role-review', 'unverified', '有一个新的观察需要在下次任务中进一步核对')
            self.assertEqual(reserve_review(self.tool, 'job2', lambda: self.now)['code'], 'delegation_cooldown')


if __name__ == '__main__': unittest.main()

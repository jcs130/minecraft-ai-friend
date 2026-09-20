import asyncio
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'world/ops'))
from evolution_policy import validate_proposal
from agent_learning import LearningTools, TOOL_NAMES, managed_job, owed_shift_roles, read, write
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

    def test_status_carries_the_revision_that_unlocks_an_unfinished_draft(self):
        """2026-09-19：草稿必须带着 revision 出现在 status 里。

        validate/activate 都要 revision，而它只产生于 draft() 的那次返回；上一班写完就走、
        下一班拿不到 revision，"经验变能力"这一步在结构上就做不成——生产里两个角色
        drafts=1 / activated=0 就是这么来的。
        """
        row = self.draft()
        listed = [item for item in self.tool.status()['drafts'] if item['name'] == row['name']]
        self.assertEqual(len(listed), 1)
        self.assertEqual(listed[0]['revision'], row['revision'])
        self.assertFalse(listed[0]['validated'])
        self.assertFalse(listed[0]['activated'])
        self.tool.validate(row['name'], row['revision'])
        self.assertTrue([item for item in self.tool.status()['drafts']
                         if item['name'] == row['name']][0]['validated'])
        self.tool.activate(row['name'], row['revision'])
        after = [item for item in self.tool.status()['drafts'] if item['name'] == row['name']][0]
        self.assertTrue(after['activated'])
        self.assertIn(row['name'], self.tool.status()['skills'])

    def test_policy_proposal_needs_a_counterfactual_or_it_is_not_actionable(self):
        """借 ModularRSI 的纪律：不给反事实的改动是在给自己埋回归。

        写不出来 → no_verdict（不是错误，但不推进）；自判「不会改变结果」→ not_actionable
        （这是正确答案）；三样齐备且自判会改变结果 → 才送天神裁决。
        """
        ok, receipt = validate_proposal('qd-survivor', [{'knob': 'shift.cron', 'value': '20 * * * *'}],
                                        '我觉得节奏太慢了，想换一换试试看。')
        self.assertFalse(ok)
        self.assertEqual(receipt['status'], 'no_verdict')
        self.assertTrue(any('no_counterfactual_metric' in item for item in receipt['noVerdict']))
        ok, receipt = validate_proposal(
            'qd-survivor', [{'knob': 'shift.cron', 'value': '20 * * * *'}],
            '上一个整点有三个角色被闸跳过，想让欠班的角色更快轮到。',
            metric='activated 数', would_change_outcome=False,
            evidence=['board: qd-guild-planner 欠班 2 小时'])
        self.assertFalse(ok)
        self.assertEqual(receipt['status'], 'not_actionable')
        ok, receipt = validate_proposal(
            'qd-survivor', [{'knob': 'shift.cron', 'value': '20 */2 * * *'}],
            '每小时一轮太多空转，想改成每两小时一轮看产出会不会更集中。',
            metric='activated 数 / 班次产出率', would_change_outcome=True,
            evidence=['metrics: activated=2，每小时班次中约一半 no_new_learning_evidence'])
        self.assertTrue(ok)
        self.assertEqual(receipt['status'], 'pending_operator_review')
        self.assertEqual(receipt['schema'], 2)

    def policy_store(self):
        from world_team import TeamStore
        return TeamStore('operations:' + self.role, self.root / 'team')

    def file_policy(self, **overrides):
        from world_team import TeamStore
        arguments = dict(note='每小时出现重复读取回执，希望根据真实变化调整班次节奏。',
                         changes=[{'knob': 'shift.cron', 'value': '20 */2 * * *'}],
                         metric='每次目标完成所需模型请求数', would_change_outcome=True,
                         evidence=['practice: task-one / receipt-one'])
        arguments.update(overrides)
        with patch('world_team.TeamStore', side_effect=lambda actor: TeamStore(actor, self.root / 'team')):
            return self.tool.policy_draft(**arguments)

    @staticmethod
    def policy_audit(event):
        return json.loads(event['observed'].split('\n', 1)[1])

    def test_policy_evidence_survives_reopening_the_real_team_store(self):
        result = self.file_policy()
        case = self.policy_store().case(result['case']['caseId'])
        audit = self.policy_audit(case['events'][0])
        self.assertEqual(audit['changes'], [{'knob': 'shift.cron', 'value': '20 */2 * * *'}])
        self.assertEqual(audit['metric'], '每次目标完成所需模型请求数')
        self.assertIs(audit['wouldChangeOutcome'], True)
        self.assertEqual(audit['status'], 'pending_operator_review')
        self.assertEqual(audit['noVerdict'], [])
        self.assertEqual(audit['evidence'], ['practice: task-one / receipt-one'])
        self.assertIn(audit['evidence'][0], case['events'][0]['evidence'])
        self.assertIs(audit['causalityVerified'], False)
        self.assertEqual(case['case']['owner'], 'game:mc-god')
        self.assertEqual(case['case']['status'], 'open')
        self.assertEqual(self.requests, [])

    def test_policy_retries_are_idempotent_but_new_evidence_or_reason_is_an_event(self):
        first = self.file_policy()
        self.assertEqual(self.file_policy(), first)
        case_id = first['case']['caseId']
        self.assertEqual(len(self.policy_store().case(case_id)['events']), 1)
        second = self.file_policy(evidence=['practice: task-two / receipt-two'])
        third = self.file_policy(note='另一个真实目标也出现重复读取，建议先做隔离对照再决定是否调整。')
        fourth = self.file_policy(would_change_outcome=False)
        self.assertTrue(all(item['case']['caseId'] == case_id for item in (second, third, fourth)))
        case = self.policy_store().case(case_id, event_limit=20)
        self.assertEqual(case['case']['version'], 4)
        self.assertEqual(len(case['events']), 4)
        self.assertEqual(self.policy_audit(case['events'][0])['evidence'], ['practice: task-one / receipt-one'])
        self.assertEqual(self.policy_audit(case['events'][1])['evidence'], ['practice: task-two / receipt-two'])
        self.assertEqual(self.policy_audit(case['events'][2])['note'],
                         '另一个真实目标也出现重复读取，建议先做隔离对照再决定是否调整。')
        self.assertEqual(self.policy_audit(case['events'][3])['status'], 'not_actionable')

    def test_policy_new_audit_keeps_the_legacy_case_and_original_event(self):
        changes = [{'knob': 'shift.cron', 'value': '20 */2 * * *'}]
        digest = hashlib.sha256(json.dumps(changes, sort_keys=True, ensure_ascii=False).encode('utf8')).hexdigest()
        store = self.policy_store()
        legacy = store.report(request_id='policy-draft-' + digest[:32],
                              dedupe_key='policy-%s-%s' % (self.role, digest[:16]),
                              title='旧机制提议', category='improvement', observed='原先只保存了理由和形式校验结果',
                              expected='原先的建议', evidence=['world-notes/evolution-policy.md'])
        original = store.case(legacy['caseId'])['events'][0]
        document = self.root / 'team' / legacy['document']
        original_document = document.read_bytes()
        result = self.file_policy(changes=changes)
        self.assertEqual(result['case']['caseId'], legacy['caseId'])
        events = self.policy_store().case(legacy['caseId'])['events']
        self.assertEqual(events[0], original)
        self.assertEqual(len(events), 2)
        self.assertEqual(self.policy_audit(events[1])['status'], 'pending_operator_review')
        self.assertEqual(document.read_bytes(), original_document)

    def test_policy_no_verdict_reasons_remain_distinct_from_rejection(self):
        result = self.file_policy(metric=None, would_change_outcome=None, evidence=None)
        self.assertFalse(result['ok'])
        event = self.policy_store().case(result['case']['caseId'])['events'][0]
        audit = self.policy_audit(event)
        self.assertEqual(audit['status'], 'no_verdict')
        self.assertEqual(audit['problems'], [])
        self.assertEqual(len(audit['noVerdict']), 3)
        self.assertTrue(any(item.startswith('no_counterfactual_evidence:') for item in audit['noVerdict']))
        self.assertNotIn('被拒', event['observed'])
        self.assertIs(audit['causalityVerified'], False)

    def test_policy_audit_uses_validator_bounds_and_rejects_oversize_changes_atomically(self):
        arguments = dict(note='n' * 600 + 'first', metric='m' * 160 + 'first',
                         evidence=['e' * 200 + str(number) for number in range(7)])
        first = self.file_policy(**arguments)
        # Distinct discarded suffixes are the same bounded report, not a new event.
        retry = self.file_policy(**(arguments | {'note': 'n' * 600 + 'second',
                                               'metric': 'm' * 160 + 'second',
                                               'evidence': ['e' * 200 + 'changed' for _ in range(8)]}))
        self.assertEqual(first, retry)
        events = self.policy_store().case(first['case']['caseId'])['events']
        self.assertEqual(len(events), 1)
        audit = self.policy_audit(events[0])
        self.assertEqual(len(audit['note']), 600)
        self.assertEqual(len(audit['metric']), 160)
        self.assertEqual(audit['evidence'], ['e' * 200] * 6)
        self.assertEqual(len(events[0]['evidence']), 8)
        self.assertLessEqual(len(events[0]['observed']), 6000)
        self.assertTrue(all(len(item) <= 1200 for item in events[0]['evidence']))
        with self.assertRaisesRegex(ValueError, 'policy_proposal_audit_too_large'):
            self.file_policy(changes=[{'knob': 'shift.cron', 'value': '20 */2 * * *', 'extra': 'x' * 6000}])
        self.assertEqual(len(self.policy_store().cases(owner='all')['cases']), 1)
        self.assertEqual(self.policy_store().case(first['case']['caseId'])['events'], events)

    def test_shift_prompt_tells_the_role_how_to_finish_what_it_started(self):
        """班次提示必须写明续做路径，否则模型只写草稿就散场。"""
        text = managed_job(self.role, 'game')['text']
        self.assertIn('drafts', text)
        self.assertIn('learning_validate(name, revision)', text)
        self.assertIn('learning_activate(name, revision)', text)
        self.assertIn('learning_draft', text)

    def test_role_holding_an_unfinished_draft_is_owed_the_next_shift(self):
        """2026-09-19：共享预算每整点只放一轮、谁先抢谁得，压着未完成草稿的角色可能永远轮不到。

       （桐人的草稿就等了 10 小时才等到一班。）所以把"欠班次"的角色排前面；但判据必须
        **可自清** —— 它跑过一班之后就不再欠，否则这条优先级自己会变成新的饿死。
        """
        self.assertEqual(owed_shift_roles(self.state), [])
        row = self.draft()
        owed = owed_shift_roles(self.state)
        self.assertEqual([item['role'] for item in owed], [self.role])
        self.assertEqual(owed[0]['unfinished'], 1)
        draft_path = self.tool.root / 'drafts' / row['name'] / (row['revision'] + '.json')
        write(self.tool.root / 'last-review.json',
              {'schema': 1, 'reservedAt': os.path.getmtime(str(draft_path)) + 5})
        # 已轮到过一班：不再欠（自清）
        self.assertEqual(owed_shift_roles(self.state), [])
        write(self.tool.root / 'last-review.json', {'schema': 1, 'reservedAt': 0})
        self.tool.validate(row['name'], row['revision'])
        # 校验过但没启用，仍然算"活没干完"
        self.assertEqual([item['role'] for item in owed_shift_roles(self.state)], [self.role])
        self.tool.activate(row['name'], row['revision'])
        # 启用之后才算干完
        self.assertEqual(owed_shift_roles(self.state), [])

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
            # Hourly shift for every runtime (creator, 2026-09-18). Game roles used to
            # be dispatched as text, which never started a model.
            self.assertEqual(job['task_type'], 'agent')

    def test_schedule_discloses_quota_off_without_changing_the_job(self):
        calls = []
        def api(role, method, path, *args):
            calls.append((role, method, path)); return {'spec': managed_job(role, 'operations')}
        self.tool.api = api
        result = self.tool.schedule()
        self.assertIn('no artificial model-call quota', result['budget'])
        self.assertNotIn('4/24h', result['budget'])
        self.assertEqual(calls, [(self.role, 'GET', '/cron/jobs/qd-learning-' + self.role)])

    def test_game_shift_local_maintenance_still_runs_without_a_model(self):
        executor = SimpleNamespace(_workspace=SimpleNamespace(agent_id=self.role, workspace_dir=self.folder))
        job = SimpleNamespace(id='qd-learning-' + self.role, meta={'project': 'qiandengji'}, task_type='text',
                              dispatch=SimpleNamespace(channel='console'),
                              runtime=SimpleNamespace(timeout_seconds=180, max_concurrency=1))

        async def forbidden(*args): self.fail('Unexpected model call')
        result = asyncio.run(guarded_execute(executor, job, forbidden, 'game',
                                             lambda *a, **k: self.tool))
        self.assertEqual(result['qiandeng']['modelCalls'], 0)

    @unittest.skipIf(os.name == 'nt', 'evidence gate uses the Linux shared task ledger')
    def test_game_shift_agent_task_goes_through_the_evidence_gate(self):
        executor = SimpleNamespace(_workspace=SimpleNamespace(agent_id=self.role, workspace_dir=self.folder))
        job = SimpleNamespace(id='qd-learning-' + self.role, meta={'project': 'qiandengji'}, task_type='text',
                              dispatch=SimpleNamespace(channel='console'),
                              runtime=SimpleNamespace(timeout_seconds=180, max_concurrency=1))
        async def forbidden(*args): self.fail('Unexpected model call')
        factory = lambda *args, **kwargs: self.tool
        result = asyncio.run(guarded_execute(executor, job, forbidden, 'game', factory))
        self.assertEqual(result['qiandeng']['modelCalls'], 0)
        # An agent-type shift is no longer refused outright for a game role; it is
        # admitted only when the role has new evidence, so an hourly attempt with
        # nothing new costs no model call at all.
        job.task_type = 'agent'
        result = asyncio.run(guarded_execute(executor, job, forbidden, 'game', factory))
        self.assertEqual(result['qiandeng']['code'], 'no_new_learning_evidence')

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
                self.assertEqual(native.budget_check(rows, self.now), 'operations_task_unresolved')
                self.assertEqual(rows[0]['source'], 'native-qwen-cron')
            self.tool.feedback('role-review', 'unverified', '有一个新的观察需要在下次任务中进一步核对')
            self.assertEqual(reserve_review(self.tool, 'job2', lambda: self.now)['code'], 'operations_task_unresolved')


if __name__ == '__main__': unittest.main()

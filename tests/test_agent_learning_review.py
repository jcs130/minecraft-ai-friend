"""Regression cases found by independent review; fixtures never call an LLM."""
import asyncio
import json
from pathlib import Path
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'world/ops'))
from agent_learning import LearningTools, TOOL_NAMES, read, write
from cron_guard import fingerprint, guarded_execute
import cron_guard


class NativeContractService:
    """The real Qwen 2.2 methods return success dictionaries (not exceptions)."""
    def __init__(self, workspace): self.workspace = workspace
    def create_skill(self, name, content, **kwargs):
        path = self.workspace / 'skills' / name / 'SKILL.md'
        if path.parent.exists(): return None
        path.parent.mkdir(parents=True); path.write_bytes(content.encode('utf8'))
        manifest = read(self.workspace / 'skill.json') if (self.workspace / 'skill.json').exists() else {'skills': {}}
        manifest['skills'][name] = {'enabled': kwargs.get('enable', False), 'installed_from': kwargs.get('installed_from', '')}
        write(self.workspace / 'skill.json', manifest)
        return name
    def save_skill(self, skill_name, content):
        manifest = read(self.workspace / 'skill.json')
        if skill_name not in manifest['skills']: return {'success': False, 'reason': 'not_found'}
        (self.workspace / 'skills' / skill_name / 'SKILL.md').write_bytes(content.encode('utf8'))
        return {'success': True, 'mode': 'edit', 'name': skill_name}
    def enable_skill(self, name):
        manifest = read(self.workspace / 'skill.json')
        if name not in manifest['skills']: return {'success': False, 'reason': 'not_found'}
        manifest['skills'][name]['enabled'] = True; write(self.workspace / 'skill.json', manifest)
        return {'success': True, 'updated_workspaces': [self.workspace.name]}
    def disable_skill(self, name):
        manifest = read(self.workspace / 'skill.json')
        if name not in manifest['skills']: return {'success': False, 'reason': 'not_found'}
        manifest['skills'][name]['enabled'] = False; write(self.workspace / 'skill.json', manifest)
        return {'success': True, 'updated_workspaces': [self.workspace.name]}


class LearningReviewRegression(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name); self.state = self.root / 'work'
        self.workspace = self.state / 'workspaces/mc-herald'
        write(self.state / 'config.json', {'agents': {'profiles': {'mc-herald': {'enabled': True}}}})
        write(self.workspace / 'agent.json', {'id': 'mc-herald', 'mcp': {'clients': {'qd_learning': {'enabled': True, 'tools': list(TOOL_NAMES)}}}})
        self.service = NativeContractService(self.workspace)
        self.tools = LearningTools('mc-herald', 'operations', self.state, self.service,
            api=lambda *args: {'success': True}, clock=lambda: 1000000)
        self.cases = [{'input': 'a new explicit error receipt exists', 'expected': 'record that error without inventing a success', 'kind': 'success'},
            {'input': 'no observed game evidence is available', 'expected': 'keep this proposed workflow unverified', 'kind': 'failure'}]

    def draft(self, suffix='first'):
        row = self.tools.draft('qd-learned-evidence', 'A role-bound observed evidence review ' + suffix,
            'Use learning_status to inspect available tools and previous evidence. Read this workflow. Record the actual output and leave unsupported effects explicitly unverified.',
            ['learning_status'], self.cases)
        self.tools.validate(row['name'], row['revision'])
        return row

    def test_new_draft_revision_changes_pending_review_fingerprint(self):
        self.draft('first'); previous = fingerprint(self.tools)
        self.draft('second')
        self.assertNotEqual(previous, fingerprint(self.tools), 'new pending draft must not be hidden by no_new_learning_evidence')

    def test_native_create_recovers_after_index_checkpoint_failure(self):
        row = self.draft()
        with patch.object(self.tools, '_save', side_effect=OSError('fixture checkpoint interruption')):
            with self.assertRaises(OSError): self.tools.activate(row['name'], row['revision'])
        # An exact owned pending activation can recover. Unrelated collisions must still reject.
        result = self.tools.activate(row['name'], row['revision'])
        self.assertTrue(result['ok'])
        self.assertEqual(self.tools._index()['skills'][row['name']]['revision'], row['revision'])

    def test_completed_activation_intent_cleanup_failure_does_not_block_next_revision(self):
        row = self.draft('first')
        original = Path.unlink
        def interrupted_cleanup(path, *args, **kwargs):
            if path.parent.name == 'activations': raise OSError('fixture interruption after index checkpoint')
            return original(path, *args, **kwargs)
        with patch.object(Path, 'unlink', interrupted_cleanup):
            with self.assertRaises(OSError): self.tools.activate(row['name'], row['revision'])
        self.assertEqual(self.tools._index()['skills'][row['name']]['revision'], row['revision'])
        self.tools.activate(row['name'], row['revision'])
        new = self.draft('second')
        result = self.tools.activate(new['name'], new['revision'])
        self.assertTrue(result['ok'])
        self.assertEqual(self.tools._index()['skills'][new['name']]['revision'], new['revision'])

    def test_native_false_result_does_not_claim_or_advance_activation(self):
        old = self.draft('first'); self.tools.activate(old['name'], old['revision'])
        new = self.draft('second')
        # Native UI deletion or another admin update can remove this manifest entry.
        write(self.workspace / 'skill.json', {'skills': {}})
        try:
            result = self.tools.activate(new['name'], new['revision'])
        except ValueError:
            pass
        else:
            self.assertFalse(result.get('ok'), 'Qwen save/enable false is not a successful activation')
        self.assertEqual(self.tools._index()['skills'][old['name']]['revision'], old['revision'])

    def test_budget_lock_wait_does_not_block_qwen_event_loop(self):
        executor = SimpleNamespace(_workspace=SimpleNamespace(agent_id='mc-herald', workspace_dir=self.workspace))
        job = SimpleNamespace(id='qd-learning-mc-herald', meta={'project': 'qiandengji'}, task_type='agent',
            dispatch=SimpleNamespace(channel='console'), runtime=SimpleNamespace(timeout_seconds=180, max_concurrency=1))
        async def forbidden(*args): raise AssertionError('No model call in review fixture')
        def contended_reservation(*args, **kwargs):
            time.sleep(0.12)  # Represents the synchronous cross-process flock wait.
            return {'ok': False, 'code': 'no_new_learning_evidence'}
        async def scenario():
            progressed = asyncio.Event()
            async def unrelated_request():
                await asyncio.sleep(0.02); progressed.set()
            request = asyncio.create_task(unrelated_request())
            try:
                await guarded_execute(executor, job, forbidden, 'operations', factory=lambda *args, **kwargs: self.tools)
                self.assertTrue(progressed.is_set(), 'A contended learning file lock must not stall the Qwen web/event loop')
            finally:
                request.cancel()
                await asyncio.gather(request, return_exceptions=True)
        with patch.object(cron_guard, 'reserve_review', contended_reservation):
            asyncio.run(scenario())


if __name__ == '__main__': unittest.main()

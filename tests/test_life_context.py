"""Native Scroll configuration and isolated migration; no live model calls."""
import asyncio
from copy import deepcopy
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'world/ops'), str(ROOT / 'tools')]
with patch.dict(os.environ):
    import configure_life_context as config
import life_context_policy as policy


def fixture(role):
    return {'id': role, 'name': role, 'workspace_dir': '/state/work/workspaces/' + role,
        'security': {'sandbox_enabled': False, 'tool_guard': {'denied_tools': ['RecallHistoryPython']}},
        'running': {'llm_max_qpm': 0, 'llm_acquire_timeout': 120 if role == 'qd-survivor' else 300,
            'reme_light_memory_config': {'auto_memory_interval': 5, 'dream_cron_enabled': True},
            'light_context_config': {'strategy': 'native',
                'scroll_config': {'db_filename': 'history.db', 'history_retention_days': 30,
                                  'allow_unsandboxed': False, 'offload_dialog': False},
                'tool_result_pruning_config': {'enabled': True, 'offload_retention_days': 30}}},
        'active_model': {'model': 'original'}, 'mcp': {'preserve': 'original'}, 'other': ['unchanged']}


class ContextConfiguration(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.members = [{'agentId': 'qd-survivor', 'kind': 'survivor'}, {'agentId': '5swvhK', 'kind': 'maid'}]
        self.profiles = {row['agentId']: fixture(row['agentId']) for row in self.members}
        self.before = deepcopy(self.profiles)
        self.jobs = {role: [{'id': 'qd-life-review-' + role, 'enabled': False, 'opaque': 'retain'}]
                     for role in self.profiles}
        self.calls = []
        self.count = 0
        for name, value in [('party_members', lambda: deepcopy(self.members))]:
            handle = patch.object(config, name, value); handle.start(); self.addCleanup(handle.stop)
        handle = patch.object(policy, 'in_scope', lambda role, runtime='game': runtime == 'game' and role in self.profiles)
        handle.start(); self.addCleanup(handle.stop)
        self.save('server/survival-agent-state/survival/control.json', {'enabled': False})
        self.save('server/survival-agent-state/survival/controller.json', {'active': None})
        self.save('server/mcdata/village/qwen-tasks/admission.json',
                  {'schema': 1, 'operator': 'project-maintenance', 'paused': True})
        self.save('server/mcdata/village/party/life/controller.json', {'active': None})
        for role in self.profiles:
            self.save('server/agents/work/workspaces/' + role + '/sessions/original.json', {'fixture': 'unchanged'})
            self.save('server/agents/work/workspaces/' + role + '/chats.json', {'chats': []})

    def save(self, path, value):
        path = self.root / path; path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value), encoding='utf8')

    def call(self, method, route, role, body=None):
        self.calls.append((method, route, role, deepcopy(body)))
        self.assertIn(role, self.profiles)
        if route == '/agents/' + role:
            if method == 'PUT':
                self.assertEqual(set(body), {'id', 'name', 'running'})
                self.profiles[role].update(deepcopy(body))
            else: self.assertEqual(method, 'GET')
            return deepcopy(self.profiles[role])
        self.assertEqual(method, 'GET')
        if route.endswith('/agent-status'): return {'running_task_count': self.count}
        self.assertEqual(route, '/cron/jobs')
        return deepcopy(self.jobs[role])

    def test_exact_two_fields_preserve_artifact_retention_memory_models_and_permissions(self):
        for role, before in self.profiles.items():
            expected = deepcopy(before)
            light = expected['running']['light_context_config']
            light['strategy'] = 'scroll'; light['scroll_config']['history_retention_days'] = 0
            after = policy.apply_profile(before, role)
            self.assertEqual(after, expected); self.assertEqual(before, self.before[role])
            self.assertTrue(policy.validate_profile(after, role))
            self.assertEqual(policy.apply_profile(after, role), after)
        self.assertEqual(policy.apply_profile(fixture('other'), 'other'), fixture('other'))
        self.assertFalse(policy.validate_profile(fixture('other'), 'other'))

    def test_unsafe_or_invalid_existing_config_is_not_silently_reset(self):
        for field, value in [('db_filename', '../history.db'), ('allow_unsandboxed', True),
                             ('history_retention_days', True)]:
            changed = fixture('qd-survivor')
            changed['running']['light_context_config']['scroll_config'][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError): policy.apply_profile(changed, 'qd-survivor')
        with self.assertRaises(ValueError): policy.validate_profile(fixture('qd-survivor'), 'qd-survivor')
        changed = fixture('qd-survivor'); changed['security']['sandbox_enabled'] = True
        with self.assertRaises(ValueError): policy.apply_profile(changed, 'qd-survivor')
        changed = fixture('qd-survivor')
        changed['running']['light_context_config']['tool_result_pruning_config']['offload_retention_days'] = 0
        with self.assertRaises(ValueError): policy.apply_profile(changed, 'qd-survivor')

    def test_preview_read_only_and_apply_does_not_run_migration_or_touch_sessions(self):
        inventory = {role: config.inventory(self.root / 'server/agents/work/workspaces' / role) for role in self.profiles}
        preview = config.configure(root=self.root, call=self.call)
        self.assertFalse(preview['migrationExecuted']); self.assertFalse((self.root / 'runtime').exists())
        self.assertTrue(all(method == 'GET' for method, _, _, _ in self.calls))
        result = config.configure(apply=True, root=self.root, call=self.call)
        self.assertFalse(result['migrationExecuted'])
        self.assertEqual({role: config.inventory(self.root / 'server/agents/work/workspaces' / role)
                          for role in self.profiles}, inventory)
        self.assertEqual(sum(method == 'PUT' for method, _, _, _ in self.calls), 2)
        backup = Path(result['backup'])
        saved = json.loads((backup / 'before.json').read_text(encoding='utf8'))
        self.assertEqual(saved['profiles'], self.before)
        for role in self.profiles:
            self.assertEqual(self.profiles[role], policy.apply_profile(self.before[role], role))
            self.assertEqual((backup / role / 'sessions/original.json').read_bytes(),
                (self.root / 'server/agents/work/workspaces' / role / 'sessions/original.json').read_bytes())
        self.calls.clear()
        config.configure(apply=True, root=self.root, call=self.call)
        self.assertTrue(all(method == 'GET' for method, _, _, _ in self.calls))

    def test_active_tasks_admission_and_cron_block_without_mutations(self):
        self.count = 1
        with self.assertRaises(ValueError): config.configure(apply=True, root=self.root, call=self.call)
        self.count = 0
        self.save('server/mcdata/village/party/life/controller.json', {'active': {'taskId': 'original'}})
        with self.assertRaises(ValueError): config.configure(apply=True, root=self.root, call=self.call)
        self.save('server/mcdata/village/party/life/controller.json', {'active': None})
        self.jobs['5swvhK'][0]['enabled'] = True
        with self.assertRaises(ValueError): config.configure(apply=True, root=self.root, call=self.call)
        self.assertFalse((self.root / 'runtime').exists())
        self.assertTrue(all(method == 'GET' for method, _, _, _ in self.calls))

    def test_uncertain_write_does_not_retry_or_resume(self):
        def uncertain(method, route, role, body=None):
            value = self.call(method, route, role, body)
            if method == 'PUT': raise TimeoutError('fixture')
            return value
        with self.assertRaises(TimeoutError): config.configure(apply=True, root=self.root, call=uncertain)
        self.assertEqual(sum(method == 'PUT' for method, _, _, _ in self.calls), 1)
        self.assertFalse(list((self.root / 'runtime').rglob('receipt.json')))
        self.assertEqual(self.profiles['5swvhK'], self.before['5swvhK'])

    def test_history_missing_read_does_not_create_anything(self):
        path = self.root / 'missing'
        with self.assertRaises(ValueError): policy.validate_history(path)
        self.assertFalse(path.exists())


@unittest.skipUnless(os.environ.get('QD_CONTEXT_NATIVE_QA') == '1', 'isolated native Qwen image required')
class NativeScroll(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        from qwenpaw.constant import WORKING_DIR
        from qwenpaw.config.config import Config
        cls.root = Path(WORKING_DIR)
        assert cls.root == Path('/state/work') and not (cls.root / 'config.json').exists()
        cls.root.mkdir(parents=True, exist_ok=True)
        config = Config(security={'sandbox_enabled': False,
            'tool_guard': {'denied_tools': ['RecallHistory', 'RecallHistoryPython']}})
        (cls.root / 'config.json').write_text(config.model_dump_json())

    def setUp(self):
        temporary = tempfile.TemporaryDirectory(dir=self.root); self.addCleanup(temporary.cleanup)
        self.workspace = Path(temporary.name)

    async def test_actual_update_endpoint_model_accepts_plan_and_rejects_zero_artifact_retention(self):
        from typing import get_type_hints
        from pydantic import ValidationError
        from qwenpaw.config.config import AgentProfileConfig
        from qwenpaw.app.routers.agents import update_agent
        endpoint_model = get_type_hints(update_agent)['agent_config']
        self.assertIs(endpoint_model, AgentProfileConfig)
        for role in ('qd-survivor', '5swvhK'):
            before = AgentProfileConfig(id=role, name='fixture', workspace_dir='/state/work/workspaces/' + role,
                security={'sandbox_enabled': False}).model_dump(mode='json')
            before['running']['light_context_config']['strategy'] = 'native'
            with patch.object(policy, 'in_scope', return_value=True):
                proposed = policy.apply_profile(before, role)
            body = {key: proposed[key] for key in ('id', 'name', 'running')}
            accepted = endpoint_model.model_validate(body)
            context = accepted.running.light_context_config
            self.assertEqual((context.strategy, context.scroll_config.history_retention_days,
                              context.tool_result_pruning_config.offload_retention_days), ('scroll', 0, 30))
            rejected = deepcopy(body)
            rejected['running']['light_context_config']['tool_result_pruning_config']['offload_retention_days'] = 0
            with self.assertRaises(ValidationError) as caught:
                endpoint_model.model_validate(rejected)
            self.assertEqual(caught.exception.errors(include_input=False)[0]['loc'],
                ('running', 'light_context_config', 'tool_result_pruning_config', 'offload_retention_days'))

    async def test_real_governor_structured_recall_and_zero_retention(self):
        from qwenpaw.config.config import AgentProfileConfig
        from qwenpaw.config.context import set_current_workspace_dir
        from qwenpaw.governance.resource_governor import ResourceGovernor
        from qwenpaw.runtime.builder import AgentBuilder
        from qwenpaw.agents.context import build_scroll_components
        from qwenpaw.agents.context.types import LogEntry
        from agentscope.permission import PermissionBehavior
        import native_tool_runtime
        profile = AgentProfileConfig(id='qd-survivor', name='fixture', workspace_dir=str(self.workspace),
            security={'sandbox_enabled': False, 'tool_guard': {'denied_tools': ['RecallHistory', 'RecallHistoryPython']}})
        profile.running.light_context_config.strategy = 'scroll'
        profile.running.light_context_config.scroll_config.history_retention_days = 0
        (self.workspace / 'agent.json').write_text(profile.model_dump_json())
        set_current_workspace_dir(self.workspace)
        native_tool_runtime.install('game')
        governor = ResourceGovernor(str(self.workspace)); governor.start()
        pieces = build_scroll_components(agent_config=profile, workspace_dir=str(self.workspace),
            model=None, session_id='qa-current', agent_id='qd-survivor')
        self.assertIsNotNone(pieces)
        store = pieces.context_manager._history; self.addCleanup(store.close)
        seq = store.append(session_id='qa-current', agent_id='qd-survivor', dedup_key='qa-one',
            entry=LogEntry(kind='context_msg', role='user', content='fixture retained original', created_at='2001-01-01T00:00:00+00:00'))
        wrapped = []
        AgentBuilder()._append_scroll_recall_tools(wrapped, pieces, profile, 'qd-survivor',
            {'agent_id': 'qd-survivor', 'session_id': 'qa-current', 'approval_level': 'AUTO'}, governor)
        self.assertEqual(len(wrapped), 1)
        decision = await wrapped[0].check_permissions({'op': 'expand', 'lo': seq, 'hi': seq})
        self.assertEqual(decision.behavior, PermissionBehavior.ALLOW)
        chunk = await pieces.recall_tool(op='expand', lo=seq, hi=seq)
        self.assertIn('fixture retained original', json.dumps(chunk.model_dump(mode='json')))
        pieces.context_manager.purge_old(0)
        self.assertEqual(store._conn.execute('SELECT COUNT(*) FROM conversation_history').fetchone()[0], 1)

    async def test_official_session_migration_is_idempotent_and_preserves_original_bytes(self):
        from agentscope.message import UserMsg
        from qwenpaw.app.chats.models import ChatSpec, ChatsFile
        from qwenpaw.app.chats.session import session_relative_paths
        from qwenpaw.agents.context.scroll.history import HistoryStore
        from qwenpaw.agents.context.scroll.sync import sync_sessions_to_history
        from qwenpaw.agents.context.scroll.recall_tool import make_recall_history
        sessions = self.workspace / 'sessions'; sessions.mkdir()
        chat = ChatSpec(session_id='qa-existing-life', user_id='qa-user', channel='console')
        (self.workspace / 'chats.json').write_text(ChatsFile(chats=[chat]).model_dump_json())
        path = sessions / sorted(session_relative_paths(chat.session_id, chat.user_id, chat.channel))[0]
        path.parent.mkdir(parents=True, exist_ok=True)
        message = UserMsg('user', 'fixture original session preserved', created_at='2001-01-01T00:00:00+00:00')
        path.write_text(json.dumps({'agent': {'state': {'session_id': 'old-native-internal-id',
                                                       'context': [message.model_dump(mode='json')]}}}))
        original = path.read_bytes()
        store = HistoryStore(self.workspace / 'history.db'); self.addCleanup(store.close)
        kwargs = dict(history=store, sessions_dir=sessions, chats_path=self.workspace / 'chats.json',
                      agent_id='qd-survivor', retention_days=0)
        first = sync_sessions_to_history(**kwargs)
        self.assertEqual((first.rows_inserted, first.unparseable, first.aged_out), (1, 0, 0))
        second = sync_sessions_to_history(**kwargs)
        self.assertEqual((second.rows_inserted, second.skipped_files), (0, 1))
        self.assertEqual(path.read_bytes(), original)
        health = policy.validate_history(self.workspace)
        self.assertEqual((health['rows'], health['sessions'], health['syncedFiles']), (1, 1, 1))
        recall = make_recall_history(history_db_path=str(store.path), session_id='qa-existing-life', agent_id='qd-survivor')
        chunk = await recall(op='expand', lo=health['firstSeq'], hi=health['lastSeq'])
        self.assertIn('fixture original session preserved', json.dumps(chunk.model_dump(mode='json')))

    async def test_finisher_v4_writes_native_scroll_history_without_extra_model(self):
        from qwenpaw.agents.react_agent import QwenPawAgent
        from qwenpaw.agents.context.scroll.history import HistoryStore
        from qwenpaw.agents.context.scroll.manager import ScrollContextManager
        from test_survival_turn_completion import NativeReplyTests, EXTERNAL_SESSION
        store = HistoryStore(self.workspace / 'history.db'); self.addCleanup(store.close)
        manager = ScrollContextManager(history=store, session_id=EXTERNAL_SESSION, agent_id='qd-survivor')
        original = QwenPawAgent.__init__
        def construct(agent, *args, **kwargs):
            kwargs['context_manager'] = manager
            return original(agent, *args, **kwargs)
        with patch.object(QwenPawAgent, '__init__', construct):
            result = await NativeReplyTests().scenario(order=('start',), unlimited=True)
        self.assertEqual(result.calls, 1)
        self.assertIn('scroll', result.state)
        count = store._conn.execute('SELECT COUNT(*) FROM conversation_history WHERE content LIKE ?',
                                   ('%' + result.summary + '%',)).fetchone()[0]
        self.assertGreater(count, 0)


if __name__ == '__main__': unittest.main()

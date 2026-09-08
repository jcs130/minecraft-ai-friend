"""Isolated API-contract tests: no production files, HTTP, jobs or model calls."""
from copy import deepcopy
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
with patch.dict(os.environ):
    import configure_life_memory as config
HAS_QWEN = importlib.util.find_spec('qwenpaw') is not None


class ConfigureLifeMemoryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.members = [{'agentId': 'qd-survivor', 'displayName': '桐人', 'kind': 'survivor'},
                        {'agentId': 'test-yui', 'displayName': '结衣', 'kind': 'maid'}]
        self.profiles = {m['agentId']: {
            'id': m['agentId'], 'name': m['displayName'],
            'workspace_dir': '/state/work/workspaces/' + m['agentId'],
            'running': {'reme_light_memory_config': {'memory_search_enabled': False}},
            'security': {'tool_guard': {'denied_tools': ['MemorySearch']}},
            'mcp': {'clients': {'existing': {'enabled': True}}},
            'active_model': {'provider_id': 'keep-provider', 'model': 'keep-model'},
            'other_user_config': {'must': 'survive'},
        } for m in self.members}
        self.before = deepcopy(self.profiles)
        self.files = {(role, path): {'content': content, 'etag': 'initial'}
                      for role in self.profiles for path, content in {
                          'AGENTS.md': '用户规则\n', 'SOUL.md': '私人灵魂原文\n',
                          'PROFILE.md': '个人补充\n', 'MEMORY.md': '既有事实\n',
                          'memory/goals.md': '已经核实的目标\n'}.items()}
        self.jobs = [{'id': 'existing-weekly', 'enabled': False, 'opaque': 'keep exactly'}]
        self.calls = []
        self.writes = []
        for name, value in [('ROOT', self.root), ('party_members', lambda: deepcopy(self.members)),
                            ('api', self.api), ('file_api', self.file_api),
                            ('create_file', self.create_file), ('apply_profile', self.propose),
                            ('configure_native', lambda value, role: value),
                            ('validate_profile', lambda value, role: True),
                            ('require_idle', lambda role: None), ('require_terminal_tasks', lambda role: None)]:
            p = patch.object(config, name, value); p.start(); self.addCleanup(p.stop)
        p = patch('subprocess.check_output', return_value='false\n'); p.start(); self.addCleanup(p.stop)

    @staticmethod
    def propose(value, role):
        value = deepcopy(value)
        value['running']['reme_light_memory_config']['memory_search_enabled'] = True
        value['security']['tool_guard']['denied_tools'] = []
        return value

    def api(self, method, route, role, body=None):
        self.calls.append((method, route, role, deepcopy(body)))
        if route == '/agents/' + role:
            if method == 'GET': return deepcopy(self.profiles[role])
            self.assertEqual(method, 'PUT')
            self.assertEqual(set(body), {'id', 'name', 'running', 'security'})
            self.assertEqual(body['id'], role)
            self.assertEqual(body['name'], self.before[role]['name'])
            if HAS_QWEN:
                from qwenpaw.config.config import AgentProfileConfig
                parsed = AgentProfileConfig.model_validate(body)
                self.assertEqual(parsed.model_fields_set, set(body))
            self.profiles[role].update(deepcopy(body))
            return deepcopy(self.profiles[role])
        if route == '/cron/jobs' and method == 'GET': return deepcopy(self.jobs)
        self.assertEqual((method, route, role), ('PUT', '/cron/jobs/' + config.JOB_ID, 'qd-survivor'))
        self.assertEqual(body['id'], config.JOB_ID)
        self.assertFalse(body['enabled'])
        config.validate_job(body, role)
        if HAS_QWEN:
            from qwenpaw.app.crons.models import CronJobSpec
            CronJobSpec.model_validate(body)
        self.jobs = [j for j in self.jobs if j['id'] != config.JOB_ID] + [deepcopy(body)]
        return deepcopy(body)

    def file_api(self, role, path, content=None, etag=None):
        key = (role, path)
        if content is not None:
            if self.files[key]['etag'] != etag: raise ValueError('etag_conflict')
            self.files[key] = {'content': content, 'etag': 'updated'}
            self.writes.append(key)
        return deepcopy(self.files.get(key))

    def create_file(self, role, path, content):
        key = (role, path)
        if key in self.files: raise ValueError('upload_conflict')
        self.files[key] = {'content': content, 'etag': 'created'}
        self.writes.append(key)

    def test_preview_has_no_writes_or_mutation_calls(self):
        result = config.configure()
        self.assertEqual(result['mode'], 'preview')
        self.assertFalse(self.writes)
        self.assertTrue(all(call[0] == 'GET' for call in self.calls))
        self.assertFalse((self.root / 'runtime').exists())

    def test_apply_native_required_fields_fixed_paused_job_and_preservation(self):
        preserved = {key: deepcopy(value) for key, value in self.files.items()
                     if key[1] in ('SOUL.md', 'MEMORY.md', 'memory/goals.md')}
        result = config.configure(True)
        self.assertFalse(result['cronEnabled'])
        self.assertEqual(self.jobs[0], {'id': 'existing-weekly', 'enabled': False, 'opaque': 'keep exactly'})
        for key, value in preserved.items(): self.assertEqual(value, self.files[key])
        for role, before in self.before.items():
            for key in ('active_model', 'mcp', 'workspace_dir', 'id', 'name', 'other_user_config'):
                self.assertEqual(self.profiles[role][key], before[key])
        self.assertEqual(result['modelCalls'], 0)
        self.assertEqual(result['worldActions'], 0)
        journal = json.loads((Path(result['backup']) / 'journal.json').read_text())
        self.assertEqual(journal['modelCallsSubmittedByConfigurator'], 0)

    def test_repeat_preserves_enabled_job_and_does_not_rewrite_files(self):
        config.configure(True)
        self.jobs[-1]['enabled'] = True
        self.jobs[-1]['schedule']['cron'] = '*/5 * * * *'
        self.calls.clear(); self.writes.clear()
        result = config.configure(True)
        self.assertTrue(result['cronEnabled'])
        self.assertFalse(self.writes)
        self.assertTrue(all(call[0] == 'GET' for call in self.calls))
        self.assertEqual(len(self.jobs), 2)

    def test_already_written_persona_after_failed_profile_can_resume_without_overwrite(self):
        # Match a partial migration: successful native file writes, then a
        # rejected profile payload. The retry recomputes only remaining work.
        real_api = self.api
        def fail_profile(method, route, role, body=None):
            if method == 'PUT' and route.startswith('/agents/'):
                raise ValueError('native_profile_validation_failed')
            return real_api(method, route, role, body)
        with patch.object(config, 'api', fail_profile):
            with self.assertRaises(ValueError): config.configure(True)
        self.assertTrue(self.writes)
        self.assertEqual(self.profiles, self.before)
        self.writes.clear()
        config.configure(True)
        self.assertFalse(self.writes)
        self.assertEqual(len(self.jobs), 2)


class ActivateLifeMemoryTests(unittest.TestCase):
    def setUp(self):
        from mcp_server import TOOL_NAMES
        self.names = list(TOOL_NAMES)
        self.assertEqual(len(self.names), 44)
        self.old_names = [name for name in self.names if name != 'request_review']
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.state = self.root / 'server/survival-agent-state/survival'
        self.state.mkdir(parents=True)
        self.save(self.state / 'control.json', {'enabled': False})
        self.save(self.state / 'controller.json', {'active': None})
        self.profile_path = self.root / 'server/agents/work/workspaces/qd-survivor/agent.json'
        self.client = {'name': 'existing driver', 'enabled': True, 'transport': 'streamable_http',
                       'url': 'http://survivor:8089/mcp', 'tools': list(self.old_names),
                       'headers': {'Authorization': '********'}}
        self.profile = {'id': 'qd-survivor', 'name': '桐人',
                        'active_model': {'provider_id': 'original-provider', 'model': 'original-model'},
                        'mcp': {'clients': {
                            'numen_survival': {**deepcopy(self.client),
                                'headers': {'Authorization': 'Bearer fixture-original-private-value'}},
                            'qd_party': {'name': 'existing party driver', 'enabled': True, 'transport': 'streamable_http',
                                'url': 'http://fixture-party/mcp', 'headers': {'Authorization': 'Bearer fixture-other-private-value'}}}},
                        'running': {'keep': 'existing runtime'}, 'history_marker': 'retain'}
        self.save(self.profile_path, self.profile)
        self.original_profile = deepcopy(self.profile)
        self.original_client = deepcopy(self.client)
        self.policy = {'default_effect': 'deny', 'unmanaged_rules_count': 0,
                       'client_overrides': [], 'tool_overrides': [],
                       'tool_defaults': [{'tool_name': name, 'effect': 'allow'} for name in self.old_names]}
        self.original_policy = deepcopy(self.policy)
        review = config.managed_job(); review['enabled'] = False
        self.jobs = [{'id': 'unrelated-weekly', 'enabled': True, 'opaque': 'retain'}, review]
        self.discovered = list(self.names)
        self.calls = []
        self.never_ready = False
        for name, value in [('ROOT', self.root), ('api', self.api)]:
            p = patch.object(config, name, value); p.start(); self.addCleanup(p.stop)

    @staticmethod
    def save(path, value):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')

    def api(self, method, route, role, body=None):
        self.assertEqual(role, 'qd-survivor')
        self.calls.append((method, route, deepcopy(body)))
        if route == '/mcp/tools/numen_survival':
            if method == 'GET':
                return [{'name': name, 'enabled': name in self.client['tools'] and
                         not (self.never_ready and name == 'request_review')} for name in self.discovered]
            self.assertEqual(method, 'PUT')
            self.assertEqual(body, {'tools': self.names})
            # Qwen 2.2 writes only DriverCard here; deliberately leave the
            # legacy profile at 43 to reproduce the production health failure.
            self.client['tools'] = list(body['tools'])
            return {'success': True}
        if route == '/mcp/numen_survival':
            self.assertEqual(method, 'GET')
            return deepcopy(self.client)
        if route == '/mcp/policy/numen_survival':
            if method == 'GET': return deepcopy(self.policy)
            self.assertEqual(method, 'PUT')
            self.assertEqual(set(body), {'default_effect', 'client_overrides', 'tool_defaults', 'tool_overrides'})
            self.policy.update(deepcopy(body))
            return deepcopy(self.policy)
        if route == '/agents/qd-survivor':
            self.assertEqual(method, 'PUT')
            self.assertEqual(set(body), {'id', 'name', 'mcp'})
            self.assertEqual((body['id'], body['name']), ('qd-survivor', '桐人'))
            if HAS_QWEN:
                from qwenpaw.config.config import AgentProfileConfig
                parsed = AgentProfileConfig.model_validate(body)
                self.assertEqual(parsed.model_fields_set, set(body))
            self.profile.update(deepcopy(body))
            self.save(self.profile_path, self.profile)
            return deepcopy(self.profile)
        if route == '/cron/jobs':
            self.assertEqual(method, 'GET')
            return deepcopy(self.jobs)
        self.assertEqual((method, route), ('POST', '/cron/jobs/' + config.JOB_ID + '/resume'))
        self.jobs[-1]['enabled'] = True
        return {'resumed': True}

    def assert_not_resumed(self):
        self.assertFalse(self.jobs[-1]['enabled'])
        self.assertFalse(any(route.endswith('/resume') for _, route, _ in self.calls))

    def assert_no_mutations(self):
        self.assertTrue(all(method == 'GET' for method, _, _ in self.calls))
        self.assert_not_resumed()

    def test_43_to_44_updates_card_policy_and_legacy_without_masking_credentials(self):
        result = config.activate_runtime()
        self.assertEqual(self.client['tools'], self.names)
        self.assertEqual(self.profile['mcp']['clients']['numen_survival']['tools'], self.names)
        expected = deepcopy(self.original_profile)
        expected['mcp']['clients']['numen_survival']['tools'] = self.names
        self.assertEqual(self.profile, expected)
        expected_policy = deepcopy(self.original_policy)
        expected_policy['tool_defaults'].append({'tool_name': 'request_review', 'effect': 'allow'})
        self.assertEqual(self.policy, expected_policy)
        client_without_tools = deepcopy(self.client); client_without_tools['tools'] = self.old_names
        self.assertEqual(client_without_tools, self.original_client)
        self.assertEqual(self.jobs[0], {'id': 'unrelated-weekly', 'enabled': True, 'opaque': 'retain'})
        self.assertTrue(self.jobs[-1]['enabled'])
        mutations = [(method, route) for method, route, _ in self.calls if method != 'GET']
        self.assertEqual(mutations, [
            ('PUT', '/mcp/policy/numen_survival'), ('PUT', '/mcp/tools/numen_survival'),
            ('PUT', '/agents/qd-survivor'), ('POST', '/cron/jobs/' + config.JOB_ID + '/resume')])
        self.assertEqual((result['nativeTools'], result['modelCalls'], result['worldActions']), (44, 0, 0))
        backup = Path(result['backup'])
        self.assertEqual(json.loads((backup / 'legacy-profile-before.json').read_text()), self.original_profile)

    def test_partial_card_only_update_recovers_legacy_and_then_repeat_is_safe(self):
        self.client['tools'] = list(self.names)
        self.policy['tool_defaults'].append({'tool_name': 'request_review', 'effect': 'allow'})
        config.activate_runtime()
        after = deepcopy(self.profile)
        self.calls.clear()
        config.activate_runtime()
        self.assertEqual(self.profile, after)
        self.assertEqual(len(self.policy['tool_defaults']), 44)
        self.assertFalse(any(route.startswith('/agents/') for _, route, _ in self.calls))
        self.assertEqual(len(self.jobs), 2)

    def test_missing_new_endpoint_is_rejected_before_changes(self):
        self.discovered = list(self.old_names)
        with self.assertRaisesRegex(AssertionError, 'new MCP endpoint'): config.activate_runtime()
        self.assert_no_mutations()

    def test_disabled_or_foreign_client_is_not_enabled_or_replaced(self):
        for change in ({'enabled': False}, {'url': 'http://other-server/mcp'},
                       {'tools': self.old_names + ['unapproved_tool']}):
            with self.subTest(change=change):
                self.client = {**deepcopy(self.original_client), **change}
                self.calls.clear()
                with self.assertRaises(AssertionError): config.activate_runtime()
                self.assert_no_mutations()

    def test_unmanaged_or_non_allow_policy_is_not_overwritten(self):
        for change in ({'default_effect': 'allow'}, {'unmanaged_rules_count': 1},
                       {'tool_overrides': [{'tool_name': 'status', 'effect': 'deny'}]},
                       {'tool_defaults': [{'tool_name': n, 'effect': 'deny'} for n in self.old_names]}):
            with self.subTest(change=change):
                self.policy = {**deepcopy(self.original_policy), **change}
                self.calls.clear()
                with self.assertRaises(AssertionError): config.activate_runtime()
                self.assert_no_mutations()

    def test_running_controller_cannot_be_activated(self):
        for control, active in ((True, None), (False, {'taskId': 'still-running'})):
            with self.subTest(control=control, active=active):
                self.save(self.state / 'control.json', {'enabled': control})
                self.save(self.state / 'controller.json', {'active': active})
                with self.assertRaisesRegex(AssertionError, 'drained'): config.activate_runtime()
                self.assertFalse(self.calls)
                self.assert_not_resumed()

    def test_readiness_timeout_keeps_cron_disabled_without_repeating_writes(self):
        self.never_ready = True
        with patch('time.monotonic', side_effect=[0, 31]), patch('time.sleep') as sleep:
            with self.assertRaisesRegex(ValueError, 'native_review_tool_not_ready'): config.activate_runtime()
        sleep.assert_not_called()
        self.assert_not_resumed()
        self.assertEqual(self.profile, self.original_profile)
        self.assertEqual(sum(method == 'PUT' and route == '/mcp/tools/numen_survival'
                             for method, route, _ in self.calls), 1)

    def test_uncertain_whitelist_transport_does_not_retry_or_resume(self):
        actual_api = self.api
        def uncertain(method, route, role, body=None):
            result = actual_api(method, route, role, body)
            if method == 'PUT' and route == '/mcp/tools/numen_survival':
                raise TimeoutError('response lost after card write')
            return result
        with patch.object(config, 'api', uncertain):
            with self.assertRaises(TimeoutError): config.activate_runtime()
        self.assert_not_resumed()
        self.assertEqual(self.profile, self.original_profile)
        self.assertEqual(sum(method == 'PUT' and route == '/mcp/tools/numen_survival'
                             for method, route, _ in self.calls), 1)
        # Explicit operator recovery reads the authoritative 44-card state,
        # repairs only the 43-tool mirror and resumes the one existing job.
        config.activate_runtime()
        self.assertTrue(self.jobs[-1]['enabled'])
        self.assertEqual(self.profile['mcp']['clients']['numen_survival']['tools'], self.names)

    def test_unknown_legacy_tool_is_preserved_and_prevents_resume(self):
        self.profile['mcp']['clients']['numen_survival']['tools'].append('unapproved_tool')
        self.save(self.profile_path, self.profile)
        before = self.profile_path.read_bytes()
        with self.assertRaises(AssertionError): config.activate_runtime()
        self.assertEqual(self.profile_path.read_bytes(), before)
        self.assert_not_resumed()
        self.assertFalse(any(route.startswith('/agents/') for _, route, _ in self.calls))


if __name__ == '__main__': unittest.main()

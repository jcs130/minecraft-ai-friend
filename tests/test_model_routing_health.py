"""Offline regression: current routing is separate from recorded model behavior."""
from contextlib import ExitStack
import importlib.util
import json
from pathlib import Path
import tempfile
import time
import subprocess
import sys
import unittest
from unittest.mock import patch

from test_register_world_agents import profile

ROOT = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


routing = load('routing_health_test', ROOT / 'tools/model_routing_health.py')
health = load('routing_panel_test', ROOT / 'world/ops/health/health_mon.py')
from world_agent_profiles import closed_profile


class ModelRoutingHealth(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.now = time.time()
        self.manifest = json.loads((ROOT / 'config/model-task-routes.json').read_text(encoding='utf-8'))
        self.put('config/model-task-routes.json', self.manifest)
        for runtime, (folder, _) in routing.RUNTIMES.items():
            roles = {row['agentId'] for row in self.manifest['routes'].values() if row['runtime'] == runtime}
            self.put(folder + '/config.json', {'agents': {'profiles': {role: {'enabled': True} for role in roles}}})
            for role in roles:
                path = folder + '/workspaces/' + role
                agent = closed_profile(profile(), role) if role in routing.WORLD_ROLES else {'id': role}
                self.put(path + '/agent.json', agent)
                self.put(path + '/jobs.json', {'jobs': []})
                self.put(path + '/skill.json', {'skills': {}})
        self.secret = 'test-adapter-token-never-live-' * 2
        token = self.root / 'server/mcdata/village/maid-agent-token'
        token.parent.mkdir(parents=True, exist_ok=True)
        token.write_text(self.secret, encoding='ascii')
        self.sites_path = 'server/mc/config/touhou_little_maid/sites/llm.json'
        self.sites = {site_id: {'id': site_id, 'enabled': enabled, 'api_type': 'openai',
            'url': routing.MAID_URL, 'models': ['qd-maid-dialogue'], 'headers': {}, 'secret_key': self.secret}
            for site_id, enabled in [('codingplan', True), ('other-saved-maid', False)]}
        self.put(self.sites_path, self.sites)
        self.heartbeat = {'updated_at': self.now, 'maid_agent_enabled': True, 'threads': {'maid-agent': True}}
        self.put('server/mcdata/npc-health.json', self.heartbeat)
        self.report = {'ok': True, 'checks': [{'name': name, 'ok': True} for name in routing.SMOKE_CHECKS]}
        self.put('reports/model-routing-smoke.json', self.report)

    def put(self, path, value):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(value), encoding='utf-8')

    def probe(self):
        return routing.probe(self.root, self.now)

    def files(self):
        return {p.relative_to(self.root).as_posix(): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}

    def test_valid_profiles_and_saved_disabled_sites_are_read_only_and_secret_free(self):
        before = self.files()
        with patch.object(health.subprocess, 'run', side_effect=AssertionError('no commands')), \
                patch.object(health.urllib.request, 'urlopen', side_effect=AssertionError('no HTTP')):
            result = self.probe()
        self.assertTrue(result['ok'], result)
        self.assertEqual(result['routeCount'], 15)
        self.assertEqual(result['maidSiteCount'], 2)
        self.assertEqual(result['modelCalls'], 0)
        self.assertNotIn(self.secret, json.dumps(result))
        self.assertEqual(self.files(), before)

    def test_disabled_role_missing_route_and_external_endpoint_fail(self):
        for mutation in ('disabled', 'missing', 'endpoint', 'invalid-role-path'):
            with self.subTest(mutation=mutation):
                manifest = json.loads(json.dumps(self.manifest))
                if mutation == 'disabled':
                    folder = routing.RUNTIMES['game'][0]
                    config_path = folder + '/config.json'
                    config = routing.read_json(self.root / config_path)
                    config['agents']['profiles']['qd-guild-planner']['enabled'] = False
                    self.put(config_path, config)
                elif mutation == 'missing':
                    del manifest['routes']['guild_quest']
                elif mutation == 'endpoint':
                    manifest['routes']['guild_quest']['apiUrl'] = 'https://direct-provider.invalid/api'
                else:
                    manifest['routes']['guild_quest']['agentId'] = '../outside'
                self.put('config/model-task-routes.json', manifest)
                self.assertFalse(self.probe()['checks']['all_route_targets_enabled'])
                if mutation == 'disabled':
                    config['agents']['profiles']['qd-guild-planner']['enabled'] = True
                    self.put(config_path, config)

    def test_task_profile_cannot_gain_tools_heartbeat_or_jobs(self):
        folder = 'server/agents/work/workspaces/qd-maid-dialogue/'
        original = routing.read_json(self.root / folder / 'agent.json')
        for kind in ('tools', 'heartbeat', 'jobs'):
            agent = json.loads(json.dumps(original))
            if kind == 'tools':
                agent['tools']['builtin_tools']['execute_shell_command']['enabled'] = True
            elif kind == 'heartbeat':
                agent['heartbeat']['enabled'] = True
            else:
                self.put(folder + 'jobs.json', {'jobs': [{'id': 'unexpected'}]})
            self.put(folder + 'agent.json', agent)
            with self.subTest(kind=kind):
                self.assertFalse(self.probe()['checks']['quiet_world_task_profiles'])
            self.put(folder + 'jobs.json', {'jobs': []})

    def test_any_saved_site_direct_url_wrong_type_or_token_is_rejected(self):
        for field, value, check in (
            ('url', 'https://direct-provider.invalid/chat/completions', 'maid_sites_through_agent'),
            ('api_type', 'ollama', 'maid_sites_through_agent'),
            ('secret_key', 'wrong-not-live-token', 'maid_adapter_token_match'),
        ):
            sites = json.loads(json.dumps(self.sites))
            sites['other-saved-maid'][field] = value
            self.put(self.sites_path, sites)
            with self.subTest(field=field):
                answer = self.probe()
                self.assertFalse(answer['checks'][check])
                self.assertNotIn(self.secret, json.dumps(answer))

    def test_stale_future_stopped_and_disabled_adapter_heartbeats_fail(self):
        for update in ({'updated_at': self.now - 91}, {'updated_at': self.now + 6},
                       {'updated_at': float('nan')}, {'maid_agent_enabled': False},
                       {'threads': {'maid-agent': False}}):
            self.put('server/mcdata/npc-health.json', {**self.heartbeat, **update})
            with self.subTest(update=update):
                self.assertFalse(self.probe()['checks']['npc_maid_thread_fresh'])

    def test_mod_added_model_labels_keep_bridge_role_and_remain_bounded(self):
        for models in (['qd-maid-dialogue', 'legacy-chat', 'legacy-reasoner'],
                       [{'id': 'qd-maid-dialogue', 'name': 'World maid'}, 'legacy-chat']):
            self.sites['other-saved-maid']['models'] = models
            self.put(self.sites_path, self.sites)
            with self.subTest(models=models):
                self.assertTrue(self.probe()['checks']['maid_sites_through_agent'])
        for models in (['legacy-only'], ['qd-maid-dialogue'] * 65,
                       ['qd-maid-dialogue', 'x' * 257],
                       ['qd-maid-dialogue', {'id': 'x', 'options': {'endpoint': 'elsewhere'}}],
                       ['qd-maid-dialogue', 'bad\nlabel']):
            self.sites['other-saved-maid']['models'] = models
            self.put(self.sites_path, self.sites)
            with self.subTest(models=models):
                self.assertFalse(self.probe()['checks']['maid_sites_through_agent'])

    def test_addon_restored_unrouted_special_site_does_not_pass(self):
        self.sites['tma_mimo_chat'] = {'id': 'tma_mimo_chat', 'api_type': 'tma_mimo_chat'}
        self.put(self.sites_path, self.sites)
        result = self.probe()
        self.assertFalse(result['ok'])
        self.assertFalse(result['checks']['maid_sites_through_agent'])
        self.assertFalse(result['checks']['maid_adapter_token_match'])

    def test_current_probe_and_all_recorded_checks_are_both_required(self):
        with patch.object(health, 'PROJECT', self.root):
            self.assertTrue(health.probe_model_routing()['ok'])
            self.report['checks'].pop()
            self.put('reports/model-routing-smoke.json', self.report)
            answer = health.probe_model_routing()
            self.assertFalse(answer['ok'])
            self.assertTrue(answer['runtime']['ok'])
            self.assertFalse(answer['behavior']['ok'])

    def test_panel_cannot_hide_model_routing_failure(self):
        others = ('probe_panel_http', 'probe_management', 'probe_recorded_behavior', 'probe_source_record',
            'probe_player_commands', 'probe_voice_commands', 'probe_chanting_staff', 'probe_voice_recording',
            'probe_voice_boundary_deployment', 'probe_skillbar_editor', 'probe_chanting_client',
            'probe_operations_team', 'probe_game_qwenpaw', 'probe_survivor')
        with ExitStack() as stack:
            for name in others:
                stack.enter_context(patch.object(health, name, return_value={'ok': True}))
            model = stack.enter_context(patch.object(health, 'probe_model_routing', return_value={'ok': True}))
            self.assertTrue(health.probe_panel_smoke()['ok'])
            model.return_value = {'ok': False}
            result = health.probe_panel_smoke()
            self.assertFalse(result['ok'])
            self.assertFalse(result['model_routing']['ok'])

    def test_isolated_process_resolves_lazy_helpers_and_restores_paths_on_success_or_failure(self):
        script = self.root / 'isolated_probe.py'
        script.write_text('''import importlib.util
import json
from pathlib import Path
import sys

spec = importlib.util.spec_from_file_location('isolated_health', sys.argv[1])
health = importlib.util.module_from_spec(spec)
spec.loader.exec_module(health)
health.PROJECT = Path(sys.argv[2])
before = list(sys.path)
assert 'world_agent_profiles' not in sys.modules
assert 'upgrade_qwenpaw_runtime' not in sys.modules
if sys.argv[3] == 'fail':
    def missing_report(*args, **kwargs):
        raise ImportError('isolated fixture report failure')
    health.probe_recorded_behavior = missing_report
answer = health.probe_model_routing()
print(json.dumps({'ok': answer['ok'], 'pathsRestored': sys.path == before,
                  'lazyHelperLoaded': 'upgrade_qwenpaw_runtime' in sys.modules,
                  'errorHandled': 'error' in answer}))
''', encoding='utf-8')
        for mode in ('success', 'fail'):
            result = subprocess.run([sys.executable, '-I', str(script),
                str(ROOT / 'world/ops/health/health_mon.py'), str(self.root), mode],
                capture_output=True, text=True, encoding='utf-8', timeout=15, cwd=self.root)
            with self.subTest(mode=mode):
                self.assertEqual(result.returncode, 0, result.stderr)
                receipt = json.loads(result.stdout)
                self.assertTrue(receipt['pathsRestored'])
                self.assertTrue(receipt['lazyHelperLoaded'])
                self.assertIs(receipt['ok'], mode == 'success')
                self.assertIs(receipt['errorHandled'], mode == 'fail')


if __name__ == '__main__':
    unittest.main()

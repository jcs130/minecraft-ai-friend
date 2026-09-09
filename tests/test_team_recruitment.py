from copy import deepcopy
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
import urllib.error
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/ops'))
import team_recruitment as recruitment


ROLE = 'qd-specialist-quest-designer'
MODEL = {'provider_id': 'current-plan', 'model': 'current-user-model'}


class NativeAPI:
    def __init__(self):
        self.agents = {'qd-guild-planner': {'active_model': MODEL}}
        self.calls, self.files, self.skills = [], {}, {}
        self.pool = {}
        self.create_loss = False
        self.fail_file = False
        self.busy = 0

    def __call__(self, runtime, role, method, path, body=None):
        self.calls.append((runtime, role, method, path, deepcopy(body)))
        if path == '/agents' and method == 'GET':
            return {'agents': [{'id': key, **deepcopy(value)} for key, value in self.agents.items()]}
        if path == '/agents' and method == 'POST':
            if body['id'] in self.agents:
                raise AssertionError('duplicate create')
            self.agents[body['id']] = {**deepcopy(body),
                'workspace_dir': '/state/work/workspaces/' + body['id'], 'running': {},
                'heartbeat': {'enabled': True}, 'mcp': {'clients': {}}}
            if self.create_loss:
                self.create_loss = False
                raise TimeoutError('receipt lost after native persistence')
            return {'id': body['id'], 'enabled': True}
        if path.endswith('/agent-status'):
            return {'running_task_count': self.busy}
        if path.startswith('/agents/'):
            identity = path.rsplit('/', 1)[1]
            if method == 'PUT':
                self.agents[identity].update(deepcopy(body))
            return deepcopy(self.agents[identity])
        if path == '/skills/pool/import-builtin':
            self.pool[body['imports'][0]['skill_name']] = {'source': 'builtin', 'content': '# Native cron'}
            return {'imported': [body['imports'][0]['skill_name']]}
        if path == '/skills/pool/download':
            self.skills[body['skill_name']] = {'name': body['skill_name'], 'enabled': False,
                                               **self.pool[body['skill_name']]}
            return {'downloaded': [{'name': body['skill_name']}]}
        if path.startswith('/skills/pool/'):
            name = path.rsplit('/', 1)[1]
            if name not in self.pool:
                raise urllib.error.HTTPError('local', 404, 'missing', {}, None)
            return deepcopy(self.pool[name])
        if path == '/skills':
            if method == 'POST':
                self.skills[body['name']] = {'name': body['name'], 'enabled': body['enable']}
            return list(self.skills.values())
        if path.startswith('/skills/') and path.endswith('/enable'):
            self.skills[path.split('/')[2]]['enabled'] = True
            return {'enabled': True}
        if path.startswith('/skills/') and method == 'GET':
            return deepcopy(self.skills[path.rsplit('/', 1)[1]])
        if path.startswith('/workspace/file-content?'):
            name = parse_qs(urlsplit(path).query)['path'][0]
            if method == 'PUT':
                if self.fail_file:
                    self.fail_file = False
                    raise TimeoutError('interrupted configuration')
                self.files[name] = body['content']
            return {'content': self.files.get(name), 'truncated': False}
        if path == '/mcp':
            return []
        if path.startswith('/cron/jobs/') and method == 'PUT':
            return body
        raise AssertionError((runtime, role, method, path, body))

    @property
    def creates(self):
        return [call for call in self.calls if call[2:4] == ('POST', '/agents')]


class RecruitmentTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory(); self.addCleanup(tmp.cleanup)
        self.path = Path(tmp.name) / 'specialists.json'
        self.api = NativeAPI()
        def configure(profile, role, runtime):
            return {**profile, 'tools': {'builtin_tools': {}}, 'security': {'tool_guard': {'enabled': True}},
                    'approval_level': 'AUTO'}
        def client(role, runtime):
            return {'name': 'qd_world_team', 'tools': ['team_cases']}
        stubs = {
            'native_role_capabilities': types.SimpleNamespace(configure_native=configure,
                NATIVE_SKILLS=('cron',), native_content=lambda name: '# Native cron'),
            'role_learning_profiles': types.SimpleNamespace(learning_client=lambda role, runtime:
                {'name': 'qd_learning', 'tools': ['learning_status']}, skill_references=lambda skill: {}),
            'world_team_profiles': types.SimpleNamespace(client=client, policy_payload=lambda tools: {}),
            'mcp_configuration': types.SimpleNamespace(configure_client=lambda *args, **kwargs: None),
            'llm_runtime_policy': types.SimpleNamespace(unrestricted_running=lambda running: running),
        }
        mocked = patch.dict(sys.modules, stubs); mocked.start(); self.addCleanup(mocked.stop)

    def recruit(self, **kwargs):
        values = dict(actor='game:mc-god', key='quest-designer', name='任务设计师',
                      profession='基于真实资源设计任务与活动', request=self.api, path=self.path)
        values.update(kwargs)
        return recruitment.recruit(**values)

    def test_creates_one_native_specialist_then_reuses_identity(self):
        first = self.recruit(); second = self.recruit()
        self.assertTrue(first['created']); self.assertFalse(second['created'])
        self.assertEqual(len(self.api.creates), 1)
        self.assertEqual(recruitment.specialists(self.path)[ROLE]['status'], 'active')
        request = self.api.creates[0][4]
        self.assertEqual(request['active_model'], MODEL)
        self.assertEqual(request['skill_names'], [])
        self.assertEqual(request['backend_settings']['qiandeng_recruitment'], first['creationToken'])
        self.assertFalse(any('api_key' in str(row) for row in self.api.calls))
        self.assertEqual(first['modelCalls'], 0); self.assertEqual(first['newDaemonProcesses'], 0)
        self.assertTrue(all(runtime == 'game' for runtime, *_ in self.api.calls))
        self.assertFalse(self.api.agents[ROLE]['heartbeat']['enabled'])

    def test_all_role_skills_installed_and_files_read_back(self):
        self.recruit()
        self.assertTrue({'cron', *recruitment.SPECIALIST_SKILLS} <= self.api.skills.keys())
        self.assertTrue(all(row['enabled'] for row in self.api.skills.values()))
        self.assertEqual(set(self.api.files), {'SOUL.md', 'PROFILE.md', 'AGENTS.md'})
        self.assertIn('game:' + ROLE, self.api.files['PROFILE.md'])

    def test_builtin_uses_native_pool_with_exact_provenance_and_single_target(self):
        self.recruit()
        self.assertEqual(self.api.skills['cron']['source'], 'builtin')
        imports = [row for row in self.api.calls if row[3] == '/skills/pool/import-builtin']
        self.assertEqual(imports[0][4], {'imports': [{'skill_name': 'cron', 'language': 'zh'}],
                                       'overwrite_conflicts': False})
        downloads = [row for row in self.api.calls if row[3] == '/skills/pool/download']
        self.assertEqual(downloads[0][4], {'skill_name': 'cron', 'targets': [{'workspace_id': ROLE}],
                                         'overwrite': False})
        for row in self.api.calls:
            if row[2:4] == ('POST', '/skills'):
                self.assertNotIn('source', row[4])
                self.assertNotEqual(row[4]['name'], 'cron')

    def test_changed_builtin_pool_is_not_overwritten_or_mislabeled(self):
        for source, content in (('customized', '# Native cron'), ('builtin', '# Changed cron')):
            self.api.pool['cron'] = {'source': source, 'content': content}
            with self.assertRaisesRegex(ValueError, 'builtin_pool_mismatch'): self.recruit()
        self.assertFalse(any(row[3] in ('/skills/pool/import-builtin', '/skills/pool/download')
                             for row in self.api.calls))

    def test_lost_create_response_recovers_same_claim_without_recreating(self):
        self.api.create_loss = True
        with self.assertRaises(TimeoutError): self.recruit()
        pending = recruitment.specialists(self.path, include_pending=True)[ROLE]
        self.assertEqual(pending['status'], 'provisioning')
        self.assertEqual(recruitment.specialists(self.path), {})
        completed = self.recruit()
        self.assertEqual(completed['creationToken'], pending['creationToken'])
        self.assertEqual(len(self.api.creates), 1)

    def test_interrupted_configuration_resumes_and_enables_existing_skill(self):
        self.api.fail_file = True
        with self.assertRaises(TimeoutError): self.recruit()
        self.api.skills['cron']['enabled'] = False
        self.assertTrue(self.recruit()['ok'])
        self.assertEqual(len(self.api.creates), 1)
        self.assertTrue(self.api.skills['cron']['enabled'])

    def test_unmanaged_id_collision_is_never_adopted(self):
        self.api.agents[ROLE] = {'id': ROLE, 'name': '任务设计师'}
        with self.assertRaisesRegex(ValueError, 'unmanaged_native_id_collision'): self.recruit()
        self.assertFalse(self.path.exists())
        self.assertFalse(any(row[2] != 'GET' for row in self.api.calls))

    def test_pending_same_name_collision_requires_native_creation_token(self):
        self.api.create_loss = True
        with self.assertRaises(TimeoutError): self.recruit()
        self.api.agents[ROLE]['backend_settings'] = {}
        calls = len(self.api.calls)
        with self.assertRaisesRegex(ValueError, 'creation_identity_mismatch'): self.recruit()
        self.assertTrue(all(row[2] == 'GET' for row in self.api.calls[calls:]))

    def test_active_identity_drift_cannot_be_rewritten(self):
        self.recruit()
        for field, bad in (('name', 'Other'), ('description', 'Other duty'),
                           ('workspace_dir', '/state/work/workspaces/qd-survivor')):
            original = self.api.agents[ROLE][field]
            self.api.agents[ROLE][field] = bad
            with self.assertRaisesRegex(ValueError, 'native_identity_changed'): self.recruit()
            self.api.agents[ROLE][field] = original

    def test_conflicting_profession_rejected_before_native_update(self):
        self.recruit(); calls = len(self.api.calls)
        with self.assertRaisesRegex(ValueError, 'different_identity'):
            self.recruit(profession='An unrelated identity')
        self.assertEqual(len(self.api.calls), calls)

    def test_busy_specialist_stays_pending_without_configuration_change(self):
        self.api.busy = 1
        result = self.recruit()
        self.assertFalse(result['ok']); self.assertEqual(result['status'], 'provisioning')
        self.assertEqual(self.api.files, {})
        self.api.busy = 0
        self.assertTrue(self.recruit()['ok'])
        self.assertEqual(len(self.api.creates), 1)

    def test_recruitment_authority_and_occupation_keys_are_checked(self):
        for actor in ('game:qd-survivor', 'game:5swvhK', 'game:' + ROLE, 'mc-god'):
            with self.assertRaisesRegex(ValueError, 'team_manager'): self.recruit(actor=actor)
        for key in ('../mc-god', 'mc-god/../../', '', 'A-B', 'x'):
            with self.assertRaisesRegex(ValueError, 'profession_key'): self.recruit(key=key)
        self.assertEqual(self.api.calls, [])


if __name__ == '__main__': unittest.main()

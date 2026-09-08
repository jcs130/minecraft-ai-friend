"""Isolated two-character registration/identity/budget tests. No live API calls."""
from copy import deepcopy
import hashlib
import hmac
import importlib.util
import json
from pathlib import Path
import re
import sys
import tempfile
import unittest
from unittest import mock
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/sidecar'))
from maid_identity import IdentityVerifier, identity
from maid_registry import MaidRegistry, TEMPLATE, TOOLS, MCP_URL
from maid_native_tools import MaidNativeTools, validate
from maid_agent_api import MaidAdapter
from qwen_tasks import QwenTasks, BASE, ROLES, read_json, write_json

OWNER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
MAID_A = '11111111-1111-1111-1111-111111111111'
MAID_B = '22222222-2222-2222-2222-222222222222'


def actor(maid=MAID_A, **extra):
    return {'schema': 1, 'maidUuid': maid, 'ownerUuid': OWNER, 'entityId': 15,
            'displayName': '测试人物', 'hasCustomName': True, 'modelId': 'fixture:maid',
            'dimension': 'minecraft:overworld', 'position': [1.5, 64, 2.5], 'loaded': True,
            'observedAt': 100000000, **extra}


def template():
    return {'id': TEMPLATE, 'backend': 'qwenpaw', 'tools': {'builtin_tools': {'shell': {'enabled': False}}},
        'acp': {'agents': {}}, 'heartbeat': {'enabled': False}, 'plan': {'enabled': False},
        'coding_mode': {'enabled': False}, 'fallback_policy': {'enabled': False}, 'fallback_models': [],
        'mcp': {'clients': {}}, 'active_model': {'provider_id': 'fixture', 'model': 'fixture-model'},
        'running': {'llm_retry_enabled': False, 'llm_max_concurrent': 1, 'llm_max_qpm': 4,
                    'auto_title_config': {'enabled': False}, 'loop': {'iteration': {}}}}


class FakeQwen:
    def __init__(self):
        self.agents = {TEMPLATE: template()}
        self.mcp = {}
        self.policies = {}
        self.jobs = {}
        self.calls = []
        self.lost_copy = False
        self.lost_task = False
        from role_learning_profiles import HERE, skill_references
        from native_role_capabilities import NATIVE_SKILLS
        names = read_json(HERE / 'game-role-skills.json')['roles'][TEMPLATE]
        self.skills = {TEMPLATE: {name: {'name': name, 'enabled': True,
            'content': (HERE / 'skills' / name / 'SKILL.md').read_text(encoding='utf-8'),
            'references': skill_references(name)} for name in names}}
        self.skills[TEMPLATE].update({name: {'name': name, 'enabled': True,
            'content': 'fixture native skill ' + name, 'references': {}} for name in NATIVE_SKILLS})

    def __call__(self, method, path, role, body=None):
        self.calls.append((method, path, role, deepcopy(body)))
        if path == '/console/chat/task':
            if self.lost_task:
                raise OSError('fixture lost POST')
            return {'task_id': 'task-012345abcdef'}
        if path.startswith('/console/chat/task/'):
            return {'status': 'completed', 'result': {'status': 'completed', 'output': [
                {'role': 'assistant', 'type': 'message', 'status': 'completed',
                 'content': [{'type': 'text', 'text': '测试回复。'}]}]}}
        if path == '/agents' and method == 'POST':
            if self.lost_copy:
                raise OSError('fixture lost copy response')
            new = 'maid' + str(len(self.agents))
            self.agents[new] = {**template(), 'id': new, 'name': body['name'],
                                'workspace_dir': '/state/work/workspaces/' + new}
            self.skills[new] = {}
            self.jobs[new] = []
            return {'id': new, 'workspace_dir': '/state/work/workspaces/' + new}
        if path.startswith('/agents/'):
            selected = path.split('/')[2]
            if method == 'PUT':
                self.agents[selected].update(deepcopy(body))
            return deepcopy(self.agents[selected])
        if path.startswith('/workspace/files/'):
            return {'written': True}
        if path == '/cron/jobs':
            return deepcopy(self.jobs[role])
        if path.startswith('/cron/jobs/') and method == 'PUT':
            self.jobs[role] = [j for j in self.jobs[role] if j['id'] != body['id']] + [deepcopy(body)]
            return deepcopy(body)
        if path == '/skills':
            if method == 'POST':
                self.skills[role][body['name']] = deepcopy(body) | {'enabled': body['enable']}
                return {'created': True, 'name': body['name']}
            return [{'name': name, 'enabled': row['enabled']} for name, row in self.skills[role].items()]
        if path.startswith('/skills/'):
            name = path.split('/')[2]
            if '/files/references/' in path:
                return {'content': self.skills[role][name]['references'][path.rsplit('/', 1)[1]]}
            return deepcopy(self.skills[role][name])
        if path == '/mcp' and method == 'GET':
            return list(self.mcp.get(role, {}).values())
        if path == '/mcp' and method == 'POST':
            key = body['client_key']
            self.mcp.setdefault(role, {})[key] = {'key': key, **body['client']}
            self.policies[(role, key)] = {'default_effect': 'ask', 'client_overrides': [],
                'tool_defaults': [], 'tool_overrides': [], 'unmanaged_rules_count': 0}
            return deepcopy(self.mcp[role][key])
        if path.startswith('/mcp/tools/'):
            return [{'name': name, 'enabled': True} for name in self.mcp[role][path.rsplit('/', 1)[1]]['tools']]
        if path.startswith('/mcp/policy/'):
            key = (role, path.rsplit('/', 1)[1])
            if method == 'PUT': self.policies[key] = deepcopy(body) | {'unmanaged_rules_count': 0}
            return deepcopy(self.policies[key])
        if path.startswith('/mcp/'):
            key = path.rsplit('/', 1)[1]
            if method == 'PUT':
                self.mcp[role][key].update(body)
            return deepcopy(self.mcp[role][key])
        raise AssertionError((method, path))


class RegistryFixtures(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.api = FakeQwen()
        self.now = 1700000000
        self.registry = MaidRegistry(self.root / 'registry', transport=self.api, clock=lambda: self.now)
        import world_team_profiles, role_learning_profiles, native_role_capabilities
        from world_team import MEMBERS
        def members():
            return {**MEMBERS, **{'game:' + role: ('fixture', 'fixture') for role in
                self.registry.health_summary()['activeRoleIds']}}
        self.addCleanup(mock.patch.stopall)
        mock.patch.object(world_team_profiles, 'members', side_effect=members).start()
        mock.patch.object(role_learning_profiles, 'maid_roles', side_effect=lambda:
            tuple(self.registry.health_summary()['activeRoleIds'])).start()
        native = native_role_capabilities.native_lock()
        for name in native['skills']:
            native['skills'][name]['sha256'] = hashlib.sha256(
                self.api.skills[TEMPLATE][name]['content'].encode()).hexdigest()
        mock.patch.object(native_role_capabilities, 'native_lock', return_value=native).start()
        self.routes = self.root / 'routes.json'
        write_json(self.routes, {'schema': 1, 'routes': {key: {'runtime': 'game', 'apiUrl': BASE, 'agentId': role}
            for key, role in ROLES.items()}})
        self.tasks = QwenTasks(self.root / 'qwen', routes=self.routes, transport=self.api,
                               clock=lambda: self.now, maid_registry=self.registry)
        self.key = self.root / 'identity.key'
        self.key.write_text('k' * 48, encoding='ascii')
        self.verifier = IdentityVerifier(self.key, clock=lambda: self.now)

    def signed(self, maid=MAID_A, messages=None, request_id=None):
        body = {'qd_identity': actor(maid, observedAt=int(self.now * 1000)), 'model': TEMPLATE, 'stream': False,
                'messages': messages or [{'role': 'user', 'content': '你好'}]}
        raw = json.dumps(body, ensure_ascii=False, separators=(',', ':')).encode()
        rid = request_id or str(uuid.uuid4())
        issued = str(int(self.now * 1000))
        base = (rid + '\n' + issued + '\n' + hashlib.sha256(raw).hexdigest()).encode()
        return raw, {'X-QD-Request-Id': rid, 'X-QD-Issued-At': issued,
                     'X-QD-Signature': hmac.new(b'k' * 48, base, hashlib.sha256).hexdigest()}


class IdentityTests(RegistryFixtures):
    def test_registered_learning_card_passes_real_native_builder_and_workspace_contract(self):
        from qwenpaw.app.mcp.config_service import driver_policy_from_mcp_access_update
        from qwenpaw.app.mcp.schemas import MCPAccessPolicy, MCPClientCreateRequest
        from qwenpaw.drivers.adapters.mcp_card_builder import build_mcp_driver_card
        from qwenpaw.drivers.storage import dump_card
        import role_learning_profiles
        row = self.registry.ensure(actor())
        role = row['agentId']
        client = self.api.mcp[role]['qd_learning']
        policy = self.api.policies[(role, 'qd_learning')]
        # Use Qwen's actual console-card constructor and permission converter;
        # manually constructing an expected card would hide registration drift.
        card = build_mcp_driver_card('qd_learning', MCPClientCreateRequest.model_validate(client), 'fixture-unused')
        card.policy = driver_policy_from_mcp_access_update(card.policy, MCPAccessPolicy.model_validate(policy))
        folder = self.root / 'native-workspace' / role
        write_json(folder / 'agent.json', self.api.agents[role])
        write_json(folder / 'jobs.json', {'jobs': self.api.jobs[role]})
        dump_card(card, folder / 'drivers/mcp/qd_learning.yaml')
        with mock.patch.object(role_learning_profiles, 'validate_learning_profile'), \
                mock.patch.object(role_learning_profiles, 'validate_jobs'), \
                mock.patch.object(role_learning_profiles, 'validate_role_skills', return_value={'required': 7}):
            self.assertEqual(role_learning_profiles.validate_learning_workspace(folder, role, 'game'), {'required': 7})
        self.assertEqual(self.api.agents[role]['mcp']['clients']['qd_learning']['name'], 'qd_learning')
        self.assertEqual(self.api.policies[(role, 'qd_world_team')]['tool_defaults'], [])
        self.assertTrue(all(r['source_value'] == 'console' for r in self.api.policies[(role, 'qd_world_team')]['tool_overrides']))

    def test_new_role_never_inherits_template_driver_identity_or_jobs(self):
        from world_team_profiles import client
        self.api.agents[TEMPLATE]['mcp']['clients']['qd_world_team'] = client(TEMPLATE, 'game')
        self.api.jobs[TEMPLATE] = [{'id': 'template-private-job', 'task_type': 'agent'}]
        row = self.registry.ensure(actor())
        role = row['agentId']
        create = next(body for method, path, _, body in self.api.calls if method == 'POST' and path == '/agents')
        self.assertEqual(set(create), {'name', 'backend', 'skill_names', 'active_model'})
        self.assertEqual(create['skill_names'], [])
        self.assertFalse(any(path.endswith('/copy') for _, path, _, _ in self.api.calls))
        writes = [body for method, path, aid, body in self.api.calls if method == 'PUT' and path == '/agents/' + role]
        self.assertEqual(writes[0]['mcp'], {'clients': {}})
        team = self.api.mcp[role]['qd_world_team']
        self.assertEqual(team['args'], ['/ops/world_team_mcp.py', '--actor', 'game:' + role])
        self.assertFalse(any(name.startswith('world_admin_') for name in team['tools']))
        self.assertEqual([j['id'] for j in self.api.jobs[role]], ['qd-learning-' + role])
        self.assertEqual(self.api.jobs[role][0]['task_type'], 'text')
        self.assertNotIn('template-private-job', str(self.api.jobs[role]))

    def test_template_team_spoof_rejected_before_creation(self):
        from world_team_profiles import client
        valid = client(TEMPLATE, 'game')
        for changed in ({'args': ['/ops/world_team_mcp.py', '--actor', 'game:mc-god']},
                        {'tools': valid['tools'] + ['world_admin_rule']},
                        {'headers': {'Authorization': 'fixture'}}, {'url': 'http://other'}):
            self.api.agents[TEMPLATE]['mcp']['clients']['qd_world_team'] = valid | changed
            with self.assertRaisesRegex(ValueError, 'maid_template_not_quiet'):
                self.registry.ensure(actor())
        self.assertFalse(any(m == 'POST' and p == '/agents' for m, p, _, _ in self.api.calls))

    def test_managed_extension_starts_only_after_real_ready_publication(self):
        original = self.registry.transport
        def transport(method, path, role, body=None):
            if method == 'POST' and path == '/mcp' and body['client_key'] != 'maid_native':
                saved = self.registry.resolve(MAID_A, OWNER)
                self.assertEqual(saved['agentId'], role)
                self.assertIn(role, read_json(self.registry.root / 'public/roles.json')['activeRoleIds'])
            return original(method, path, role, body)
        self.registry.transport = transport
        self.registry.ensure(actor())

    def test_ready_driver_repair_does_not_recreate_or_rewrite_persona_model_and_jobs(self):
        row = self.registry.ensure(actor())
        role = row['agentId']
        self.api.agents[role]['active_model'] = {'provider_id': 'chosen', 'model': 'chosen'}
        self.api.jobs[role][0]['enabled'] = False
        before = deepcopy(self.api.agents[role])
        jobs = deepcopy(self.api.jobs[role])
        del self.api.mcp[role]['qd_world_team']
        offset = len(self.api.calls)
        self.registry.ensure(actor())
        writes = [(m, p) for m, p, _, _ in self.api.calls[offset:] if m != 'GET']
        self.assertTrue(all(p == '/mcp' or p.startswith('/mcp/') for _, p in writes))
        self.assertEqual(self.api.agents[role], before)
        self.assertEqual(self.api.jobs[role], jobs)
        self.assertEqual(self.registry.resolve(MAID_A, OWNER)['sessionId'], row['sessionId'])

    def test_lost_team_create_recovers_known_driver_without_replaying_role_create(self):
        original = self.registry.transport
        lost = []
        def transport(method, path, role, body=None):
            result = original(method, path, role, body)
            if method == 'POST' and path == '/mcp' and body['client_key'] == 'qd_world_team' and not lost:
                lost.append(True)
                raise OSError('lost team create response')
            return result
        self.registry.transport = transport
        with self.assertRaises(OSError):
            self.registry.ensure(actor())
        saved = self.registry.resolve(MAID_A, OWNER)
        self.assertEqual(self.registry.ensure(actor())['agentId'], saved['agentId'])
        self.assertEqual(sum(m == 'POST' and p == '/agents' for m, p, _, _ in self.api.calls), 1)
        self.assertEqual(sum(m == 'POST' and p == '/mcp' and b['client_key'] == 'qd_world_team'
                             for m, p, _, b in self.api.calls), 1)

    def test_ready_foreign_team_identity_is_never_overwritten_or_invoked(self):
        row = self.registry.ensure(actor())
        self.api.mcp[row['agentId']]['qd_world_team']['args'][-1] = 'game:mc-god'
        offset = len(self.api.calls)
        with self.assertRaisesRegex(ValueError, 'identity_mismatch'):
            self.registry.ensure(actor())
        self.assertTrue(all(m == 'GET' for m, _, _, _ in self.api.calls[offset:]))

    def test_skill_scan_rejection_never_publishes_and_retry_keeps_existing_packages(self):
        original = self.registry.transport
        failed = []
        def transport(method, path, role, body=None):
            if method == 'POST' and path == '/skills' and body['name'] == 'qd-world-team' and not failed:
                failed.append(True)
                return {'created': False, 'code': 'scan_blocked'}
            return original(method, path, role, body)
        self.registry.transport = transport
        with self.assertRaisesRegex(ValueError, 'skill_not_installed'):
            self.registry.ensure(actor())
        self.assertEqual(self.registry.health_summary()['registeredCount'], 0)
        row = self.registry.ensure(actor())
        self.assertEqual(sum(m == 'POST' and p == '/agents' for m, p, _, _ in self.api.calls), 1)
        self.assertEqual(sum(m == 'POST' and p == '/skills' and b['name'] == 'qd-skill-evolution'
                             for m, p, _, b in self.api.calls), 1)
        self.assertEqual(set(self.api.skills[row['agentId']]), set(self.api.skills[TEMPLATE]))

    def test_signed_identity_valid_but_tamper_clock_owner_missing_rejected(self):
        raw, headers = self.signed()
        self.assertEqual(self.verifier.verify(raw, headers)['identity']['maidUuid'], MAID_A)
        for corrupted in (raw.replace(b'11111111', b'22222222'), raw + b' '):
            with self.assertRaises(ValueError):
                self.verifier.verify(corrupted, headers)
        self.now += 301
        with self.assertRaises(ValueError):
            self.verifier.verify(raw, headers)
        for extra in ({'ownerUuid': None}, {'ownerUuid': 'not-uuid'}, {'loaded': False}, {'position': [10**1000, 1, 2]}):
            with self.assertRaises(ValueError):
                identity(actor(**extra))

    def test_registration_two_characters_private_tokens_sessions_and_public_metadata(self):
        a = self.registry.ensure(actor())
        b = self.registry.ensure(actor(MAID_B))
        self.assertNotEqual(a['agentId'], b['agentId'])
        self.assertNotEqual(a['sessionId'], b['sessionId'])
        self.assertNotEqual(a['mcpToken'], b['mcpToken'])
        summary = read_json(self.registry.root / 'public/roles.json')
        self.assertEqual(summary['registeredCount'], 2)
        self.assertNotIn('persona', json.dumps(summary))
        self.assertNotIn(a['mcpToken'], json.dumps(summary))
        self.assertIsNone(summary['sharedPurposeLimit']['24hCap'])
        self.assertEqual(summary['sharedPurposeLimit']['cooldownSeconds'], 0)
        self.assertEqual(self.registry.authenticate('Bearer ' + a['mcpToken'])['maidUuid'], MAID_A)
        self.assertEqual(self.api.mcp[a['agentId']]['maid_native']['tools'], TOOLS)
        self.assertEqual(self.api.agents[a['agentId']]['active_model'], template()['active_model'])
        self.assertFalse(self.api.agents[a['agentId']]['tools']['builtin_tools']['shell']['enabled'])
        self.assertEqual(self.registry.ensure(actor())['agentId'], a['agentId'])
        self.assertEqual(sum(method == 'POST' and path == '/agents' for method, path, _, _ in self.api.calls), 2)

    def test_owner_change_does_not_transfer_history_or_auto_adopt(self):
        self.registry.ensure(actor())
        count = len(self.api.calls)
        with self.assertRaisesRegex(ValueError, 'owner_migration'):
            self.registry.ensure(actor(ownerUuid='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'))
        with self.assertRaises(ValueError):
            self.registry.ensure(actor(ownerUuid=None))
        self.assertEqual(len(self.api.calls), count)

    def test_registration_rebinds_native_file_and_cron_guards_for_each_character(self):
        from native_role_capabilities import NATIVE_TOOLS, configure_native, validate_native
        self.api.agents[TEMPLATE] = configure_native(template(), TEMPLATE)
        custom_sensitive = '/fixture/private-reference'
        self.api.agents[TEMPLATE]['security']['file_guard']['sensitive_files'].append(custom_sensitive)
        self.api.agents[TEMPLATE] = configure_native(self.api.agents[TEMPLATE], TEMPLATE)
        source = deepcopy(self.api.agents[TEMPLATE])
        a, b = self.registry.ensure(actor()), self.registry.ensure(actor(MAID_B))
        for own, other in ((a, b), (b, a)):
            role = own['agentId']
            configured = self.api.agents[role]
            validate_native(configured, role)
            self.assertEqual({name for name, tool in configured['tools']['builtin_tools'].items()
                              if tool['enabled']}, set(NATIVE_TOOLS))
            self.assertEqual(set(configured['mcp']['clients']), {'qd_world_team', 'qd_learning'})
            guard = configured['security']['tool_guard']
            def blocked(tool, parameter, value):
                return any(rule['id'] in guard['auto_denied_rules'] and tool in rule['tools']
                    and parameter in rule['params'] and any(re.search(pattern, value) for pattern in rule['patterns'])
                    for rule in guard['custom_rules'])
            for path in ('notes/个人经验.md', '/state/work/workspaces/' + role + '/drafts/skill.py'):
                for tool in ('read_file', 'write_file', 'append_file', 'edit_file'):
                    self.assertFalse(blocked(tool, 'file_path', path), (role, tool, path))
            for target in (TEMPLATE, other['agentId']):
                path = '/state/work/workspaces/' + target + '/notes/private.md'
                self.assertTrue(blocked('read_file', 'file_path', path), path)
                self.assertTrue(blocked('write_file', 'file_path', path), path)
                self.assertTrue(blocked('execute_shell_command', 'command', 'qwenpaw cron list --agent-id ' + target))
            for path in ('AGENTS.md', 'SOUL.md', 'PROFILE.md', 'agent.json', 'drivers/mcp/maid_native.yaml'):
                self.assertTrue(blocked('write_file', 'file_path', path), path)
            self.assertFalse(blocked('execute_shell_command', 'command', 'qwenpaw cron list --agent-id ' + role))
            self.assertTrue(blocked('execute_shell_command', 'command', 'python anything.py'))
            sensitive = configured['security']['file_guard']['sensitive_files']
            self.assertIn(custom_sensitive, sensitive)
            self.assertIn('/run/secrets/', sensitive)
            self.assertIn('/state/work/workspaces/' + role + '/agent.json', sensitive)
            self.assertFalse(any(path.startswith('/state/work/workspaces/' + TEMPLATE + '/') for path in sensitive))
            self.assertEqual(configured['active_model'], source['active_model'])
        self.assertEqual(self.api.agents[TEMPLATE], source)

    def test_new_character_has_shared_file_note_without_claiming_skills_installed(self):
        from native_role_capabilities import FILE_NOTE, NATIVE_TOOLS, validate_native
        from sync_role_learning import FILE_NOTE as SYNC_FILE_NOTE
        persona = '只属于这一位人物的人设。'
        row = self.registry.ensure(actor(), name='独立人物', persona=persona)
        role = row['agentId']
        configured = self.api.agents[role]
        # This fixture begins with the legacy closed template, not pre-enabled tools.
        validate_native(configured, role)
        self.assertEqual({name for name, tool in configured['tools']['builtin_tools'].items()
                          if tool['enabled']}, set(NATIVE_TOOLS))
        files = {path.removeprefix('/workspace/files/'): body['content']
                 for method, path, aid, body in self.api.calls
                 if method == 'PUT' and path.startswith('/workspace/files/') and aid == role}
        self.assertEqual(FILE_NOTE, SYNC_FILE_NOTE)
        self.assertIn(FILE_NOTE, files['AGENTS.md'])
        self.assertEqual(files['AGENTS.md'].count('<!-- qiandeng-personal-files-v1 -->'), 1)
        self.assertIn('若本角色已启用 qd-skill-evolution', files['AGENTS.md'])
        self.assertIn('尚未安装的技能与参考页不能当作已可用', files['AGENTS.md'])
        self.assertNotIn('技能学习使用本角色 qd_learning', files['AGENTS.md'])
        self.assertNotIn('已启用本角色职责技能', files['AGENTS.md'])
        fixed = json.loads(files['PROFILE.md'].split('\n\n', 1)[1])
        self.assertEqual(fixed, {key: row[key] for key in ('maidUuid', 'ownerUuid', 'name', 'personaRevision')})
        self.assertIn(persona, files['SOUL.md'])
        self.assertNotIn(row['mcpToken'], ''.join(files.values()))
        self.assertEqual(set(self.api.skills[role]), set(self.api.skills[TEMPLATE]))
        policies = [body for method, path, aid, body in self.api.calls
                    if method == 'PUT' and path == '/mcp/policy/maid_native' and aid == role]
        self.assertEqual(len(policies), 1)
        self.assertEqual(policies[0]['default_effect'], 'deny')
        self.assertEqual(policies[0]['tool_overrides'], [
            {'source_type': 'channel', 'source_value': 'console', 'subject_type': 'all',
             'subject_value': '', 'effect': 'allow', 'tool_name': tool} for tool in TOOLS])

    def test_uncertain_copy_is_not_retried_or_published(self):
        self.api.lost_copy = True
        for _ in range(2):
            with self.assertRaisesRegex(ValueError, 'uncertain'):
                self.registry.ensure(actor())
        self.assertEqual(sum(method == 'POST' and path == '/agents' for method, path, _, _ in self.api.calls), 1)
        self.assertEqual(self.registry.health_summary()['activeRoleIds'], [])

    def test_unsafe_template_and_unknown_registration_fail_before_copy(self):
        self.api.agents[TEMPLATE]['tools']['builtin_tools']['shell']['enabled'] = True
        with self.assertRaises(ValueError):
            self.registry.ensure(actor())
        self.assertFalse(any(method == 'POST' and path == '/agents' for method, path, _, _ in self.api.calls))

    def test_native_template_guard_cannot_point_at_another_role(self):
        from native_role_capabilities import configure_native
        self.api.agents[TEMPLATE] = configure_native(template(), 'some-other-role')
        with self.assertRaisesRegex(ValueError, 'maid_template_has_unsafe_tools'):
            self.registry.ensure(actor())
        self.assertFalse(any(method == 'POST' and path == '/agents' for method, path, _, _ in self.api.calls))

    def test_unloaded_owned_preregistration_is_explicit_no_native_action(self):
        with self.assertRaises(ValueError):
            self.registry.ensure(actor(loaded=False))
        row = self.registry.ensure(actor(loaded=False), allow_unloaded=True)
        self.assertFalse(row['lastIdentity']['loaded'])
        self.assertEqual(self.registry.health_summary()['registeredCount'], 1)

    def test_signed_conversations_are_separate_and_history_not_repeated(self):
        adapter = MaidAdapter(self.tasks.root, self.tasks, registry=self.registry, verifier=self.verifier, sleep=lambda _: None)
        for maid in (MAID_A, MAID_B):
            raw, headers = self.signed(maid)
            self.assertEqual(adapter.complete_signed(raw, headers)[0], 200)
            self.now += 60
        raw, headers = self.signed(MAID_A, messages=[{'role': 'user', 'content': '你好'},
            {'role': 'assistant', 'content': '测试回复。'}, {'role': 'user', 'content': '继续工作'}])
        self.assertEqual(adapter.complete_signed(raw, headers)[0], 200)
        calls = [c for c in self.api.calls if c[1] == '/console/chat/task']
        self.assertEqual(len(calls), 3)
        self.assertEqual(calls[0][3]['session_id'], calls[2][3]['session_id'])
        self.assertNotEqual(calls[0][3]['session_id'], calls[1][3]['session_id'])
        self.assertNotEqual(calls[0][2], calls[1][2])
        last_prompt = calls[2][3]['input'][0]['content'][0]['text']
        self.assertNotIn('initialRecentHistory', last_prompt)
        self.assertNotIn('测试回复。', last_prompt)
        self.assertEqual(adapter.complete_signed(raw, headers)[0], 200)
        self.assertEqual(len([c for c in self.api.calls if c[1] == '/console/chat/task']), 3)

    def test_character_tasks_have_no_artificial_cap_and_no_unregistered_agent_override(self):
        a = self.registry.ensure(actor())
        self.registry.ensure(actor(MAID_B))
        for i in range(26):
            maid = MAID_A if i % 2 else MAID_B
            key = 'fixture-' + str(i)
            self.assertEqual(self.tasks.submit('maid_dialogue', key, 'q', maid_uuid=maid, owner_uuid=OWNER)['status'], 'submitted')
            self.tasks.poll('maid_dialogue', key, maid_uuid=maid, owner_uuid=OWNER)
        self.assertEqual(self.tasks.submit('maid_dialogue', 'extra', 'q', maid_uuid=MAID_A, owner_uuid=OWNER)['status'], 'submitted')
        with self.assertRaises((OSError, ValueError)):
            self.tasks.submit('maid_dialogue', 'bad', 'q', maid_uuid=str(uuid.uuid4()), owner_uuid=OWNER)
        with self.assertRaises(ValueError):
            self.tasks.poll('maid_dialogue', 'fixture-0', maid_uuid=MAID_A, owner_uuid=OWNER)

    def test_uncertain_model_blocks_new_personal_turn_without_shared_fallback(self):
        adapter = MaidAdapter(self.tasks.root, self.tasks, registry=self.registry, verifier=self.verifier, sleep=lambda _: None)
        self.api.lost_task = True
        raw, headers = self.signed()
        self.assertEqual(adapter.complete_signed(raw, headers)[0], 502)
        self.now += 400
        raw, headers = self.signed(messages=[{'role': 'user', 'content': 'different'}])
        self.assertEqual(adapter.complete_signed(raw, headers)[0], 409)
        calls = [c for c in self.api.calls if c[1] == '/console/chat/task']
        self.assertEqual(len(calls), 1)
        self.assertNotEqual(calls[0][2], TEMPLATE)

    def test_validly_signed_request_id_cannot_be_reused_for_different_body(self):
        adapter = MaidAdapter(self.tasks.root, self.tasks, registry=self.registry, verifier=self.verifier, sleep=lambda _: None)
        raw, headers = self.signed()
        self.assertEqual(adapter.complete_signed(raw, headers)[0], 200)
        changed, new_headers = self.signed(request_id=headers['X-QD-Request-Id'],
            messages=[{'role': 'user', 'content': 'same ID different body'}])
        with self.assertRaisesRegex(ValueError, 'signed_request_conflict'):
            adapter.complete_signed(changed, new_headers)
        self.assertEqual(sum(c[1] == '/console/chat/task' for c in self.api.calls), 1)


class NativeTests(RegistryFixtures):
    def native(self, malformed=False, unknown=False):
        self.native_calls = []
        def run(command):
            import base64
            self.native_calls.append(command)
            encoded = command.split()[-1]
            req = json.loads(base64.urlsafe_b64decode(encoded + '=' * (-len(encoded) % 4)))
            if unknown:
                raise OSError('lost response')
            write = req['operation'] not in ('identity', 'context', 'task_catalog')
            row = {'schema': 1, 'engine': 'qiandeng_maid_bridge', 'ok': True,
                   'phase': 'applied' if write else 'observed', **{k: req[k] for k in ('requestId', 'maidUuid', 'ownerUuid', 'operation')},
                   'identity': actor(req['maidUuid']), 'observedAt': int(self.now * 1000)}
            if write:
                row.update(workCompleted=False, after={'sitting': req['args'].get('sit')})
            if malformed:
                row['maidUuid'] = MAID_B
            return 'QD_MAID_JSON ' + json.dumps(row)
        return MaidNativeTools(self.registry, run)

    def test_fixed_self_no_uuid_argument_and_invalid_input_never_executes(self):
        bound = self.registry.ensure(actor())
        native = self.native()
        for operation, args in [('identity', {'maidUuid': MAID_B}), ('sit', {'sit': 'true'}),
                                ('schedule', {'schedule': 'INVALID'}), ('work', {'taskId': 'kill @e'}),
                                ('task_catalog', {'offset': True})]:
            with self.assertRaises(ValueError):
                native.invoke(bound, operation, args)
        self.assertEqual(self.native_calls, [])
        self.assertTrue(native.invoke(bound, 'identity', {})['ok'])

    def test_write_receipt_matches_state_and_retries_are_not_replayed(self):
        bound = self.registry.ensure(actor())
        native = self.native()
        rid = 'fixture-' + 'a' * 32
        result = native.invoke(bound, 'sit', {'sit': True}, rid)
        self.assertTrue(result['ok'])
        self.assertFalse(result['workCompleted'])
        replayed = native.invoke(bound, 'sit', {'sit': True}, rid)
        self.assertTrue(replayed.pop('replayedReceipt'))
        self.assertTrue(replayed.pop('historicalReceipt'))
        self.assertEqual(replayed, result)
        self.assertEqual(len(self.native_calls), 1)
        with self.assertRaises(ValueError):
            native.invoke(bound, 'sit', {'sit': False}, rid)

    def test_wrong_actor_reply_or_lost_write_is_unknown_not_success(self):
        bound = self.registry.ensure(actor())
        for native in (self.native(malformed=True), self.native(unknown=True)):
            result = native.invoke(bound, 'sit', {'sit': True})
            self.assertFalse(result['ok'])
            self.assertEqual(result['phase'], 'outcome_unknown')


class RegistrationCliTests(RegistryFixtures):
    def tool(self):
        spec = importlib.util.spec_from_file_location('register_maid_agents', ROOT / 'tools/register_maid_agents.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_check_only_does_not_register_or_write_state(self):
        result = self.tool().register(self.registry, [actor()])
        self.assertEqual(result['maids'][0]['status'], 'owned_identity_ready_to_register')
        self.assertFalse(self.registry.root.exists())
        self.assertEqual(self.api.calls, [])

    def test_apply_skips_unowned_and_publishes_only_real_completed_registration(self):
        result = self.tool().register(self.registry, [actor(), actor(MAID_B, ownerUuid=None)], apply=True)
        self.assertTrue(result['ok'])
        self.assertEqual(result['registry']['registeredCount'], 1)
        self.assertEqual(result['maids'][1]['status'], 'unowned_waiting_for_adoption')
        self.assertFalse(self.registry.path(MAID_B).exists())
        self.assertNotIn('mcpToken', json.dumps(result))

    def test_empty_apply_prepares_empty_public_manifest_without_qwen(self):
        result = self.tool().register(self.registry, [], apply=True)
        self.assertEqual(read_json(self.registry.root / 'public/roles.json')['activeRoleIds'], [])
        self.assertEqual(self.api.calls, [])

    def test_safe_learning_extension_is_not_inherited_for_wrong_role(self):
        self.api.agents[TEMPLATE]['mcp']['clients']['qd_learning'] = {
            'transport': 'stdio', 'command': 'python', 'args': [
                '/ops/agent_learning_mcp.py', '--role', TEMPLATE, '--runtime', 'game']}
        binding = self.registry.ensure(actor())
        self.assertEqual(self.api.agents[binding['agentId']]['mcp']['clients']['qd_learning']['args'], [
            '/ops/agent_learning_mcp.py', '--role', binding['agentId'], '--runtime', 'game'])
        self.assertEqual(self.registry.resolve(MAID_A, OWNER)['skillTemplate']['extensionPolicy'],
                         'project-governed-role-skills')


if __name__ == '__main__':
    unittest.main()

"""Isolated two-character registration/identity/budget tests. No live API calls."""
from copy import deepcopy
import hashlib
import hmac
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
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
        self.calls = []
        self.lost_copy = False
        self.lost_task = False

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
        if path == '/agents/' + TEMPLATE + '/copy':
            if self.lost_copy:
                raise OSError('fixture lost copy response')
            new = 'maid' + str(len(self.agents))
            self.agents[new] = {**deepcopy(self.agents[TEMPLATE]), 'id': new,
                                'workspace_dir': '/state/work/workspaces/' + new}
            return {'id': new, 'workspace_dir': '/state/work/workspaces/' + new}
        if path.startswith('/agents/'):
            selected = path.split('/')[2]
            if method == 'PUT':
                self.agents[selected] = deepcopy(body)
            return deepcopy(self.agents[selected])
        if path.startswith('/workspace/files/'):
            return {'written': True}
        if path == '/mcp' and method == 'GET':
            return [self.mcp[role]] if role in self.mcp else []
        if path == '/mcp' and method == 'POST':
            self.mcp[role] = {'key': body['client_key'], **body['client']}
            return deepcopy(self.mcp[role])
        if path.startswith('/mcp/policy/'):
            return deepcopy(body)
        if path.startswith('/mcp/'):
            if method == 'PUT':
                self.mcp[role].update(body)
            return deepcopy(self.mcp[role])
        raise AssertionError((method, path))


class RegistryFixtures(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.api = FakeQwen()
        self.now = 1700000000
        self.registry = MaidRegistry(self.root / 'registry', transport=self.api, clock=lambda: self.now)
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
        self.assertEqual(summary['sharedPurposeLimit']['24hCap'], 12)
        self.assertEqual(self.registry.authenticate('Bearer ' + a['mcpToken'])['maidUuid'], MAID_A)
        self.assertEqual(self.api.mcp[a['agentId']]['key'], 'maid_native')
        self.assertEqual(self.api.mcp[a['agentId']]['tools'], TOOLS)
        self.assertEqual(self.api.agents[a['agentId']]['active_model'], template()['active_model'])
        self.assertFalse(self.api.agents[a['agentId']]['tools']['builtin_tools']['shell']['enabled'])
        self.assertEqual(self.registry.ensure(actor())['agentId'], a['agentId'])
        self.assertEqual(sum(path.endswith('/copy') for _, path, _, _ in self.api.calls), 2)

    def test_owner_change_does_not_transfer_history_or_auto_adopt(self):
        self.registry.ensure(actor())
        count = len(self.api.calls)
        with self.assertRaisesRegex(ValueError, 'owner_migration'):
            self.registry.ensure(actor(ownerUuid='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'))
        with self.assertRaises(ValueError):
            self.registry.ensure(actor(ownerUuid=None))
        self.assertEqual(len(self.api.calls), count)

    def test_native_template_is_closed_until_new_role_policy_is_synced(self):
        sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'world/ops'))
        from native_role_capabilities import configure_native
        self.api.agents[TEMPLATE] = configure_native(template(), TEMPLATE)
        row = self.registry.ensure(actor())
        configured = self.api.agents[row['agentId']]
        self.assertFalse(any(tool['enabled'] for tool in configured['tools']['builtin_tools'].values()))
        self.assertTrue(set(configured['tools']['builtin_tools']) <= set(configured['security']['tool_guard']['denied_tools']))

    def test_uncertain_copy_is_not_retried_or_published(self):
        self.api.lost_copy = True
        for _ in range(2):
            with self.assertRaisesRegex(ValueError, 'uncertain'):
                self.registry.ensure(actor())
        self.assertEqual(sum(path.endswith('/copy') for _, path, _, _ in self.api.calls), 1)
        self.assertEqual(self.registry.health_summary()['activeRoleIds'], [])

    def test_unsafe_template_and_unknown_registration_fail_before_copy(self):
        self.api.agents[TEMPLATE]['tools']['builtin_tools']['shell']['enabled'] = True
        with self.assertRaises(ValueError):
            self.registry.ensure(actor())
        self.assertFalse(any(path.endswith('/copy') for _, path, _, _ in self.api.calls))

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

    def test_all_character_tasks_share_cap_and_no_unregistered_agent_override(self):
        a = self.registry.ensure(actor())
        self.registry.ensure(actor(MAID_B))
        for i in range(12):
            maid = MAID_A if i % 2 else MAID_B
            key = 'fixture-' + str(i)
            self.assertEqual(self.tasks.submit('maid_dialogue', key, 'q', maid_uuid=maid, owner_uuid=OWNER)['status'], 'submitted')
            self.tasks.poll('maid_dialogue', key, maid_uuid=maid, owner_uuid=OWNER)
            self.now += 60
        self.assertEqual(self.tasks.submit('maid_dialogue', 'extra', 'q', maid_uuid=MAID_A, owner_uuid=OWNER)['status'], 'budget_blocked')
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
        self.assertEqual(self.api.agents[binding['agentId']]['mcp'], {'clients': {}})
        self.assertEqual(self.registry.resolve(MAID_A, OWNER)['skillTemplate']['extensionPolicy'],
                         'project-governed-role-skills')


if __name__ == '__main__':
    unittest.main()

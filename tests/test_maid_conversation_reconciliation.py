"""Signed chat + real request ledger/reconciliation; no live API or model calls."""
from copy import deepcopy
import hashlib
import hmac
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import urllib.error
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/ops'))
sys.path.insert(0, str(ROOT / 'world/sidecar'))
from maid_agent_api import MaidAdapter
from maid_identity import IdentityVerifier
from qwen_tasks import BASE, ROLES, QwenTasks, read_json, write_json
from party_role_capabilities import YUI_AGENT_ID, YUI_BODY_UUID, SURVIVOR_BODY_UUID


class ConversationReconciliationTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.now = 1789377120
        self.calls = []
        self.binding = {'agentId': YUI_AGENT_ID, 'sessionId': 'maid-fixture-original-session'}
        self.actor = {'schema': 1, 'maidUuid': YUI_BODY_UUID, 'ownerUuid': SURVIVOR_BODY_UUID,
            'entityId': 15, 'displayName': 'Yui fixture', 'hasCustomName': True,
            'modelId': 'fixture:yui', 'dimension': 'minecraft:overworld',
            'position': [1.5, 64, 2.5], 'loaded': True, 'observedAt': self.now * 1000}
        self.registry = SimpleNamespace(root=self.root / 'registry',
            ensure=lambda actor: dict(self.binding), resolve=lambda maid, owner: dict(self.binding))
        routes = self.root / 'routes.json'
        write_json(routes, {'schema': 1, 'routes': {key: {'runtime': 'game', 'apiUrl': BASE, 'agentId': role}
                                                  for key, role in ROLES.items()}})
        self.response = {'status': 'completed', 'result': {'status': 'completed', 'output': [
            {'type': 'message', 'role': 'assistant', 'status': 'completed',
             'content': [{'type': 'text', 'text': 'Offline fresh reply.'}]}]}}
        self.get_error = None
        self.tasks = QwenTasks(self.root / 'qwen', routes, transport=self.transport,
                               clock=lambda: self.now, maid_registry=self.registry)
        keyfile = self.root / 'fixture-identity.key'
        keyfile.write_text('k' * 48, encoding='ascii')
        self.adapter = MaidAdapter(self.tasks.root, self.tasks, registry=self.registry,
            verifier=IdentityVerifier(keyfile, clock=lambda: self.now), sleep=lambda _: None)
        self.party_path = self.root / 'party.json'
        self.roles_path = self.root / 'roles.json'
        write_json(self.party_path, {'schema': 1, 'enabled': True, 'partyId': 'fixture-party', 'revision': 1,
            'members': [{'kind': 'survivor', 'agentId': 'qd-survivor', 'bodyUuid': SURVIVOR_BODY_UUID,
                         'displayName': 'Kirito fixture'},
                        {'kind': 'maid', 'agentId': YUI_AGENT_ID, 'bodyUuid': YUI_BODY_UUID,
                         'displayName': 'Yui fixture'}]})
        write_json(self.roles_path, {'schema': 1, 'bindingsValid': True, 'independentSessions': True,
            'activeRoleIds': [YUI_AGENT_ID], 'registeredCount': 1})
        env = patch.dict(os.environ, {'PARTY_ROLES_MANIFEST_FILE': str(self.party_path),
                                      'MAID_ROLES_MANIFEST_FILE': str(self.roles_path)})
        env.start()
        self.addCleanup(env.stop)
        self.old_messages = [{'role': 'user', 'content': 'An old unresolved input.'}]
        self.old_key = self.key(self.old_messages)
        self.old_path = self.tasks._path('maid_dialogue', self.old_key)
        self.old_prompt = 'Original prompt fixture; never replay this request.'
        # Same durable shape as the September 9 poll_unavailable conversation:
        # old conversation pointer + original request + separately audited release.
        self.old_row = {'schema': 1, 'purpose': 'maid_dialogue', 'agentId': YUI_AGENT_ID,
            'key': self.old_key, 'requestId': 'npc-' + 'a' * 32, 'taskId': 'task-d0d283af1f8b',
            'startedAt': 1788884308.716853, 'status': 'poll_unavailable',
            'lastPollAt': self.now, 'errorType': 'HTTPError',
            'promptSha256': hashlib.sha256(self.old_prompt.encode()).hexdigest(),
            'maidUuid': YUI_BODY_UUID, 'ownerUuid': SURVIVOR_BODY_UUID,
            'sessionId': self.binding['sessionId'], 'userId': 'maid-' + YUI_BODY_UUID, 'channel': 'console'}
        write_json(self.old_path, self.old_row)
        self.old_bytes = self.old_path.read_bytes()
        self.conversation = self.registry.root / 'conversations' / (YUI_BODY_UUID + '.json')
        write_json(self.conversation, {'started': True, 'hintHash': 'f' * 64, 'pendingKey': self.old_key})
        write_json(self.registry.root / 'turns' / (YUI_BODY_UUID + '-' + self.old_key.rsplit(':', 1)[1] + '.json'),
                   {'prompt': self.old_prompt, 'hintHash': 'f' * 64})
        self.active_path = self.tasks.root / 'active-roles' / (hashlib.sha256(YUI_AGENT_ID.encode()).hexdigest() + '.json')
        write_json(self.active_path, {'agentId': YUI_AGENT_ID, 'stateKey': self.old_path.stem})
        write_json(self.tasks.root / 'budget.json', [{'purpose': 'maid_dialogue',
            'requestId': self.old_row['requestId'], 'startedAt': self.old_row['startedAt'], 'stateKey': self.old_path.stem}])
        self.marker_path = self.tasks.root / 'operator-reconciliations' / (self.old_path.stem + '.json')
        self.marker = {'schema': 1, 'operator': 'project-maintenance', 'status': 'released_without_result',
            'stateKey': self.old_path.stem, 'requestIdentity': self.tasks.request_identity(self.old_row),
            'resultVerified': False, 'retryOriginalRequest': False, 'nativeTaskHttpStatus': 404,
            'nativeRunningTaskCount': 0, 'npcStopped': True, 'observedAt': self.now * 1000,
            'sourceRequestSha256': hashlib.sha256(self.old_bytes).hexdigest()}

    def key(self, messages):
        return 'maid:' + self.actor['maidUuid'] + ':' + hashlib.sha256(json.dumps(
            messages, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()

    def signed(self, messages=None):
        raw = json.dumps({'qd_identity': self.actor, 'model': 'native-label', 'stream': False,
            'messages': messages or [{'role': 'user', 'content': 'A new independent input.'}]},
            ensure_ascii=False, separators=(',', ':')).encode()
        rid, issued = str(uuid.uuid4()), str(self.now * 1000)
        base = (rid + '\n' + issued + '\n' + hashlib.sha256(raw).hexdigest()).encode()
        return raw, {'X-QD-Request-Id': rid, 'X-QD-Issued-At': issued,
                     'X-QD-Signature': hmac.new(b'k' * 48, base, hashlib.sha256).hexdigest()}

    def transport(self, method, path, role, body=None):
        self.calls.append((method, path, role, deepcopy(body)))
        if method == 'POST':
            return {'task_id': 'task-012345abcdef'}
        if self.get_error:
            raise self.get_error
        return deepcopy(self.response)

    def posts(self):
        return [call for call in self.calls if call[0] == 'POST']

    def test_valid_audited_release_admits_exactly_one_fresh_input_in_original_session(self):
        write_json(self.marker_path, self.marker)
        observed = self.tasks.poll('maid_dialogue', self.old_key,
            maid_uuid=YUI_BODY_UUID, owner_uuid=SURVIVOR_BODY_UUID)
        self.assertEqual(observed['operatorReconciliation'], 'released_without_result')
        self.assertEqual(observed['status'], 'poll_unavailable')
        self.assertFalse(observed['resultVerified'])
        self.assertEqual(self.calls, [])
        raw, headers = self.signed()
        status, reply = self.adapter.complete_signed(raw, headers)
        self.assertEqual(status, 200)
        self.assertEqual(reply['qwenpaw_task_id'], 'task-012345abcdef')
        self.assertEqual(len(self.posts()), 1)
        self.assertEqual(self.posts()[0][1:3], ('/console/chat/task', YUI_AGENT_ID))
        payload = self.posts()[0][3]
        self.assertEqual(payload['session_id'], self.binding['sessionId'])
        self.assertEqual(payload['user_id'], 'maid-' + YUI_BODY_UUID)
        self.assertNotIn('model', payload)
        self.assertNotIn(self.old_prompt, json.dumps(payload))
        self.assertEqual(self.old_path.read_bytes(), self.old_bytes)
        self.assertEqual(read_json(self.marker_path), self.marker)
        self.assertNotEqual(read_json(self.conversation)['pendingKey'], self.old_key)
        self.assertEqual(self.adapter.complete_signed(raw, headers)[0], 200)
        self.assertEqual(len(self.posts()), 1)
        self.assertFalse(any(call[1].endswith(self.old_row['taskId']) for call in self.calls))

    def test_same_old_key_never_reposts_or_invents_a_result_even_with_release(self):
        write_json(self.marker_path, self.marker)
        for _ in range(2):
            status, reply = self.adapter.complete_signed(*self.signed(self.old_messages), wait_seconds=0)
            self.assertEqual((status, reply['error']['code']), (504, 'qwen_task_pending'))
        self.assertEqual(self.calls, [])
        self.assertEqual(self.old_path.read_bytes(), self.old_bytes)
        self.assertEqual(read_json(self.conversation)['pendingKey'], self.old_key)

    def test_unknown_without_proof_stays_blocked_including_native_404(self):
        for native_404 in (False, True):
            with self.subTest(native_404=native_404):
                row = dict(self.old_row)
                if native_404:
                    row['lastPollAt'] = 0
                    self.get_error = urllib.error.HTTPError('fixture', 404, 'Task not found', None, None)
                write_json(self.old_path, row)
                status, reply = self.adapter.complete_signed(*self.signed())
                self.assertEqual((status, reply['error']['code']), (409, 'previous_maid_task_unresolved'))
                self.assertFalse(reply['retry_automatically'])
                self.assertEqual(self.posts(), [])
                self.assertEqual(read_json(self.conversation)['pendingKey'], self.old_key)
                self.assertEqual(read_json(self.old_path)['status'], 'poll_unavailable')

    def test_invalid_proof_cannot_release_request_or_cross_an_identity(self):
        changes = [{'resultVerified': True}, {'retryOriginalRequest': True}, {'nativeRunningTaskCount': 1},
            {'nativeTaskHttpStatus': 200}, {'npcStopped': False},
            *[{'requestIdentity': self.marker['requestIdentity'] | {name: value}} for name, value in (
                ('taskId', 'task-ffffffffffff'), ('agentId', 'other-agent'), ('sessionId', 'other-session'),
                ('maidUuid', '11111111-1111-4111-8111-111111111111'),
                ('ownerUuid', '22222222-2222-4222-8222-222222222222'))]]
        for change in changes:
            with self.subTest(change=change):
                write_json(self.marker_path, self.marker | change)
                with self.assertRaisesRegex(ValueError, 'qwen_operator_reconciliation_invalid'):
                    self.adapter.complete_signed(*self.signed())
                self.assertEqual(self.calls, [])
                self.assertEqual(self.old_path.read_bytes(), self.old_bytes)
                self.assertEqual(read_json(self.conversation)['pendingKey'], self.old_key)

    def test_changed_current_agent_session_owner_or_body_does_not_inherit_release(self):
        write_json(self.marker_path, self.marker)
        for target, name, value in ((self.binding, 'agentId', 'other-agent'),
                (self.binding, 'sessionId', 'other-session'),
                (self.actor, 'ownerUuid', '22222222-2222-4222-8222-222222222222'),
                (self.actor, 'maidUuid', '11111111-1111-4111-8111-111111111111')):
            with self.subTest(field=name):
                original = target[name]
                target[name] = value
                # Deliberately transplant the pointer: ownership must still fail.
                conversation = self.registry.root / 'conversations' / (self.actor['maidUuid'] + '.json')
                write_json(conversation, {'pendingKey': self.old_key})
                try:
                    with self.assertRaisesRegex(ValueError, 'qwen_task_not_owned'):
                        self.adapter.complete_signed(*self.signed())
                    self.assertEqual(self.calls, [])
                    self.assertEqual(self.old_path.read_bytes(), self.old_bytes)
                finally:
                    target[name] = original

    def test_bound_pair_revocation_rejects_previously_valid_proof(self):
        write_json(self.marker_path, self.marker)
        pair = read_json(self.party_path)
        pair['enabled'] = False
        write_json(self.party_path, pair)
        with self.assertRaisesRegex(ValueError, 'qwen_operator_reconciliation_invalid'):
            self.adapter.complete_signed(*self.signed())
        self.assertEqual(self.calls, [])

    def test_release_of_old_conversation_cannot_bypass_current_same_role_task(self):
        write_json(self.marker_path, self.marker)
        current = self.old_row | {'key': 'party-current-input', 'taskId': 'task-aaaaaaaaaaaa',
            'requestId': 'npc-' + 'b' * 32, 'startedAt': self.now, 'status': 'running'}
        current_path = self.tasks._path('maid_dialogue', current['key'])
        write_json(current_path, current)
        write_json(self.active_path, {'agentId': YUI_AGENT_ID, 'stateKey': current_path.stem})
        original = current_path.read_bytes()
        status, reply = self.adapter.complete_signed(*self.signed())
        self.assertEqual((status, reply['error']['code']), (429, 'busy'))
        self.assertEqual(self.calls, [])
        self.assertEqual(current_path.read_bytes(), original)
        self.assertEqual(read_json(self.active_path)['stateKey'], current_path.stem)
        self.assertEqual(self.old_path.read_bytes(), self.old_bytes)

    def test_terminal_old_request_allows_normal_next_turn_without_a_release(self):
        for terminal in ('completed', 'failed'):
            with self.subTest(status=terminal):
                write_json(self.old_path, self.old_row | {'status': terminal})
                write_json(self.conversation, {'started': True, 'pendingKey': self.old_key})
                status, _ = self.adapter.complete_signed(*self.signed([
                    {'role': 'user', 'content': 'Fresh after ' + terminal}]))
                self.assertEqual(status, 200)
        self.assertEqual(len(self.posts()), 2)

    def test_bad_signature_does_not_consult_or_release_pending_request(self):
        write_json(self.marker_path, self.marker)
        raw, headers = self.signed()
        headers['X-QD-Signature'] = '0' * 64
        with self.assertRaises(ValueError):
            self.adapter.complete_signed(raw, headers)
        self.assertEqual(self.calls, [])
        self.assertEqual(self.old_path.read_bytes(), self.old_bytes)


if __name__ == '__main__':
    unittest.main()

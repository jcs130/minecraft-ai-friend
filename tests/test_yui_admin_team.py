"""The one explicitly authorized Yui pair cannot grant every maid privileges."""
from copy import deepcopy
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'world/ops'))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'world/sidecar'))
import party_role_capabilities as party


class YuiAdminTeamTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.party_path = self.root / 'party.json'
        self.maid_path = self.root / 'maids.json'
        self.registered = {'schema': 1, 'bindingsValid': True, 'independentSessions': True,
                           'activeRoleIds': [party.YUI_AGENT_ID, 'another-maid'], 'registeredCount': 2}
        self.pair = {'schema': 1, 'enabled': True, 'partyId': 'kirito-travel-party', 'revision': 1,
            'members': [{'agentId': 'qd-survivor', 'bodyUuid': party.SURVIVOR_BODY_UUID,
                         'displayName': '桐人', 'kind': 'survivor'},
                        {'agentId': party.YUI_AGENT_ID, 'bodyUuid': party.YUI_BODY_UUID,
                         'displayName': '结衣', 'kind': 'maid'}]}
        self.save()
        env = patch.dict(os.environ, {'PARTY_ROLES_MANIFEST_FILE': str(self.party_path),
                                      'MAID_ROLES_MANIFEST_FILE': str(self.maid_path)})
        env.start(); self.addCleanup(env.stop)

    def save(self):
        self.party_path.write_text(json.dumps(self.pair), encoding='utf-8')
        self.maid_path.write_text(json.dumps(self.registered), encoding='utf-8')

    def test_only_the_current_exact_pair_has_the_grant_not_its_display_name(self):
        self.assertTrue(party.is_bound_yui(party.YUI_ACTOR))
        for actor in ('operations:5swvhK', 'game:qd-maid-dialogue', 'game:another-maid', 'game:qd-survivor'):
            self.assertFalse(party.is_bound_yui(actor))
        self.pair['members'][1]['displayName'] = '旧名字或后来改名'
        self.save()
        self.assertTrue(party.is_bound_yui(party.YUI_ACTOR))
        self.pair['members'][1]['agentId'] = 'another-maid'
        self.pair['members'][1]['displayName'] = '结衣'
        self.save()
        self.assertFalse(party.is_bound_yui('game:another-maid'))
        self.assertFalse(party.is_bound_yui(party.YUI_ACTOR))

    def test_body_partner_or_registration_changes_revoke_without_a_restart(self):
        original = deepcopy(self.pair)
        for index in (0, 1):
            self.pair = deepcopy(original)
            self.pair['members'][index]['bodyUuid'] = '11111111-1111-4111-8111-111111111111'
            self.save()
            self.assertFalse(party.is_bound_yui(party.YUI_ACTOR))
        self.pair = original
        self.registered['activeRoleIds'] = ['another-maid']; self.registered['registeredCount'] = 1
        self.save()
        self.assertFalse(party.is_bound_yui(party.YUI_ACTOR))

    def test_missing_disabled_or_malformed_evidence_denies(self):
        self.party_path.unlink()
        self.assertFalse(party.is_bound_yui(party.YUI_ACTOR))
        self.save(); self.pair['enabled'] = False; self.save()
        self.assertFalse(party.is_bound_yui(party.YUI_ACTOR))
        self.party_path.write_text('{broken', encoding='utf-8')
        self.assertFalse(party.is_bound_yui(party.YUI_ACTOR))
        self.pair['enabled'] = True; self.save()
        with patch.object(Path, 'is_symlink', lambda p: p == self.party_path):
            self.assertFalse(party.is_bound_yui(party.YUI_ACTOR))

    def test_rescue_skill_belongs_only_to_verified_yui_not_maid_template_or_survivor(self):
        from role_learning_profiles import role_skills
        self.assertIn('qd-yui-rescue', role_skills(party.YUI_AGENT_ID, 'game'))
        for role in ('qd-maid-dialogue', 'qd-survivor', 'another-maid'):
            self.assertNotIn('qd-yui-rescue', role_skills(role, 'game'))
        self.pair['members'][1]['bodyUuid'] = '11111111-1111-4111-8111-111111111111'
        self.save()
        self.assertNotIn('qd-yui-rescue', role_skills(party.YUI_AGENT_ID, 'game'))

    def test_team_persona_preserves_family_and_existing_personal_notes(self):
        from world_team import members
        from world_team_profiles import persona_files
        inventory = members()
        self.assertIn('家庭关系', inventory[party.YUI_ACTOR][1])
        self.assertNotIn('主人', inventory[party.YUI_ACTOR][1])
        self.assertIn('主人', inventory['game:another-maid'][1])
        existing = {'PROFILE.md': 'existing personal profile',
                    'AGENTS.md': 'existing local note', 'SOUL.md': 'preserved family history'}
        actual = persona_files(party.YUI_ACTOR, existing)
        self.assertTrue(actual['PROFILE.md'].startswith(existing['PROFILE.md']))
        self.assertTrue(actual['AGENTS.md'].startswith(existing['AGENTS.md']))
        self.assertIn('qd-yui-rescue', actual['AGENTS.md'])
        self.assertNotIn('SOUL.md', actual)

    def test_only_yui_and_goddess_can_direct_a_new_engineering_case(self):
        from world_team import TeamStore, ENGINEER
        args = ('request-feedback', 'feature-feedback', 'A missing real skill', 'improvement',
                'Observed missing capability', 'A tested implementation', ['fixture:receipt'])
        for actor in (party.YUI_ACTOR, 'game:mc-god'):
            store = TeamStore(actor, self.root / actor.replace(':', '-'))
            result = store.report(*args, assign_to=ENGINEER)
            self.assertEqual(result['owner'], ENGINEER)
            self.assertEqual(store.case(result['caseId'])['case']['author'], actor)
            self.assertEqual(result, store.report(*args, assign_to=ENGINEER))
            with self.assertRaises(ValueError): store.report(*args, assign_to='game:qd-survivor')
        for actor in ('game:qd-survivor', 'game:another-maid', 'operations:default'):
            with self.assertRaisesRegex(ValueError, 'report_assignment_not_allowed'):
                TeamStore(actor, self.root / 'denied').report(*args, assign_to=ENGINEER)
        default = TeamStore('game:qd-survivor', self.root / 'default').report(*args)
        self.assertEqual(default['owner'], 'game:mc-god')

    def test_yui_cannot_reassign_or_close_existing_foreign_work(self):
        from world_team import TeamStore, ENGINEER
        state = self.root / 'work'
        yui = TeamStore(party.YUI_ACTOR, state)
        args = ('first-request', 'same-problem', 'Observed problem', 'bug', 'Actual receipt', 'Repair', ['fixture:receipt'])
        result = yui.report(*args, assign_to=ENGINEER)
        with self.assertRaises(ValueError):
            yui.update('attempt-close', result['caseId'], 1, 'resolved', 'claimed', ['fixture:unverified'])
        god = TeamStore('game:mc-god', state)
        god.update('assign-specialist', result['caseId'], 1, 'working', 'Needs specialist', ['fixture:review'], 'operations:mc-herald')
        next_result = yui.report('second-request', *args[1:], assign_to=ENGINEER)
        self.assertEqual(next_result['owner'], 'operations:mc-herald')

    def test_yui_native_tools_add_admin_only_not_engineering_shell_or_content(self):
        import world_team_profiles as profiles
        from world_admin_tools import TOOL_NAMES
        expected = set(TOOL_NAMES)
        self.assertEqual(len(expected), 7)
        self.assertLessEqual({'world_admin_rescue_inspect', 'world_admin_rescue', 'world_admin_receipt'}, expected)
        self.assertLessEqual(expected, set(profiles.tools_for(party.YUI_ACTOR)))
        self.assertFalse(expected & set(profiles.tools_for('game:another-maid')))
        self.assertEqual(set(profiles.bindings(party.YUI_AGENT_ID, 'game')), {'qd_world_team'})
        self.assertFalse(any(name.startswith(('engineering_', 'world_content_'))
                             for name in profiles.tools_for(party.YUI_ACTOR)))
        self.pair['members'][1]['bodyUuid'] = '11111111-1111-4111-8111-111111111111'; self.save()
        self.assertFalse(expected & set(profiles.tools_for(party.YUI_ACTOR)))

    def test_admin_feedback_is_one_case_and_distinct_outcome_updates_never_a_world_replay(self):
        from world_admin_tools import AdminStore, canonical, fingerprint
        from world_team import record_admin_feedback, TeamStore, ENGINEER
        state = self.root / 'feedback'
        admin = AdminStore(state, clock=lambda: 100)
        args = {'target': 'kirito', 'observationRequestId': 'inspect-request', 'reason': 'A real navigation obstruction'}
        request_id = 'rescue-request'
        with admin.connect() as db:
            db.execute('INSERT INTO requests (id,actor,kind,args,fingerprint,status,created,expires) VALUES (?,?,?,?,?,?,?,?)',
                (request_id, party.YUI_ACTOR, 'rescue', canonical(args), fingerprint(party.YUI_ACTOR, 'rescue', args),
                 'queued', 100000, 220000))
        row = admin.claim()
        before = {'bodyUuid': party.SURVIVOR_BODY_UUID, 'dimension': 'minecraft:overworld',
                  'position': [1, 49, 2], 'inventory': ['PRIVATE_ITEMS'], 'chat': 'PRIVATE_TEXT'}
        admin.finish(row, 'unknown', {'ok': False, 'code': 'outcome_unknown', 'executionConfirmed': False, 'before': before})
        unknown = admin.receipt(party.YUI_ACTOR, request_id)
        first = record_admin_feedback(state, party.YUI_ACTOR, request_id, unknown)
        self.assertEqual(first, record_admin_feedback(state, party.YUI_ACTOR, request_id, unknown))
        self.assertEqual(first['owner'], ENGINEER)
        with self.assertRaisesRegex(ValueError, 'receipt_changed'):
            record_admin_feedback(state, party.YUI_ACTOR, request_id, unknown | {'code': 'forged'})
        # Simulate the consumer's later persisted proof of this SAME native
        # request. This test never invokes a rescue, transport, model or RCON.
        updated = {'ok': True, 'code': 'rescue_completed', 'executionConfirmed': True, 'before': before,
                   'after': {'bodyUuid': party.SURVIVOR_BODY_UUID, 'dimension': 'minecraft:overworld', 'position': [3, 65, 4]}}
        with admin.connect() as db:
            db.execute('UPDATE requests SET status=?,receipt=? WHERE id=?', ('completed', canonical(updated), request_id))
        completed = admin.receipt(party.YUI_ACTOR, request_id)
        second = record_admin_feedback(state, party.YUI_ACTOR, request_id, completed)
        self.assertEqual(first['caseId'], second['caseId'])
        self.assertEqual(second, record_admin_feedback(state, party.YUI_ACTOR, request_id, completed))
        case = TeamStore(ENGINEER, state).case(second['caseId'])
        self.assertEqual(case['case']['version'], 2)
        self.assertEqual(case['case']['status'], 'open')
        self.assertEqual(len(case['events']), 2)
        self.assertNotIn('PRIVATE_', json.dumps(case))
        self.assertIn('rescue_completed', json.dumps(case))
        self.assertEqual(admin.receipt(party.YUI_ACTOR, request_id)['status'], 'completed')
        self.assertEqual(second['worldActionsExecuted'], 0)

    def test_real_party_input_receives_admin_tools_only_for_the_verified_body(self):
        from types import SimpleNamespace
        from test_party_bridge import PartyBridgeTests
        from qwen_tasks import write_json
        for actor, body in ((party.YUI_AGENT_ID, party.YUI_BODY_UUID), ('maid-test', party.YUI_BODY_UUID),
                            (party.YUI_AGENT_ID, '11111111-1111-4111-8111-111111111111')):
            with self.subTest(actor=actor, body=body):
                fixture = PartyBridgeTests(methodName='test_dispatch_uses_existing_maid_session_budget_and_reply_no_new_model')
                fixture.setUp(); self.addCleanup(fixture.doCleanups)
                survivor, maid = fixture.config['members']
                survivor['bodyUuid'] = party.SURVIVOR_BODY_UUID
                maid.update(agentId=actor, bodyUuid=body, ownerUuid=party.SURVIVOR_BODY_UUID, userId='maid-' + body)
                fixture.registry.resolve = lambda *a, actor=actor: {'agentId': actor, 'sessionId': 'maid-abc'}
                write_json(fixture.root / 'binding.json', fixture.config)
                fixture.bridge.call('qd-survivor', 'party_send', {'text': '请查看实际受阻情况'}, 'input-fixture')
                fixture.bridge.tick()
                self.assertEqual(len(fixture.posts), 1)
                _, payload = fixture.posts[0]
                names = payload['request_context']['subagent_allowed_tools']
                expected = actor == party.YUI_AGENT_ID and body == party.YUI_BODY_UUID
                self.assertEqual('qd_world_team__world_admin_diagnostics' in names, expected)
                self.assertEqual('qd_world_team__team_report' in names, expected)
                self.assertEqual(payload['timeout'], 600 if expected else 180)
                self.assertNotIn('qd_party__party_send', names)
                self.assertNotIn('execute_shell_command', names)
                self.assertFalse(any(name.startswith('qd_engineering__') for name in names))

    def test_extended_task_time_requires_verified_scope_and_does_not_repost_a_request(self):
        from qwen_tasks import native_task_timeout
        from test_sidecar_qwen_tasks import NativeTaskTests
        from types import SimpleNamespace
        fixture = NativeTaskTests(methodName='test_exact_native_route_no_provider_and_poll_extracts_only_completed_text')
        fixture.setUp(); self.addCleanup(fixture.doCleanups)
        role, body, owner = party.YUI_AGENT_ID, party.YUI_BODY_UUID, party.SURVIVOR_BODY_UUID
        tools = ['qd_world_team__world_admin_rescue_inspect', 'qd_world_team__world_admin_rescue', 'qd_world_team__world_admin_receipt']
        binding = {'agentId': role, 'bodyUuid': body, 'ownerUuid': owner, 'sessionId': 'original-maid-session',
                   'userId': 'maid-' + body, 'channel': 'console'}
        fixture.client.maid_registry = SimpleNamespace(resolve=lambda *args: {'agentId': role, 'sessionId': binding['sessionId']})
        row = fixture.client.submit('maid_dialogue', 'fixed-rescue-input', 'Input', maid_uuid=body, owner_uuid=owner,
                                    expected_binding=binding, allowed_tools=tools)
        payload = fixture.calls[-1][3]
        self.assertEqual(payload['timeout'], 600)
        self.assertEqual(payload['session_id'], binding['sessionId'])
        self.assertEqual(row['timeoutSeconds'], 600)
        self.pair['enabled'] = False; self.save()
        repeated = fixture.client.submit('maid_dialogue', 'fixed-rescue-input', 'Input', maid_uuid=body, owner_uuid=owner,
                                         expected_binding=binding, allowed_tools=tools)
        self.assertEqual(repeated['taskId'], row['taskId'])
        self.assertEqual(len(fixture.calls), 1)
        self.assertEqual(native_task_timeout(role, body, owner, tools, binding), 180)
        self.pair['enabled'] = True; self.save()
        for scopes, expected in ((None, binding), (tools[:-1], binding), (tools, None)):
            self.assertEqual(native_task_timeout(role, body, owner, scopes, expected), 180)

    def release_fixture(self):
        from qwen_tasks import write_json
        from test_sidecar_qwen_tasks import NativeTaskTests
        from types import SimpleNamespace
        import hashlib
        fixture = NativeTaskTests(methodName='test_exact_native_route_no_provider_and_poll_extracts_only_completed_text')
        fixture.setUp(); self.addCleanup(fixture.doCleanups)
        fixture.client.maid_registry = SimpleNamespace(resolve=lambda *args: {'agentId': party.YUI_AGENT_ID, 'sessionId': 'original-session'})
        kwargs = {'maid_uuid': party.YUI_BODY_UUID, 'owner_uuid': party.SURVIVOR_BODY_UUID}
        fixture.error = None
        row = fixture.client.submit('maid_dialogue', 'old-input', 'Original input', **kwargs)
        path = fixture.client._path('maid_dialogue', 'old-input')
        row.pop('retryAutomatically'); row.update(status='poll_unavailable', errorType='HTTPError')
        write_json(path, row)
        original = path.read_bytes()
        marker = {'schema': 1, 'operator': 'project-maintenance', 'status': 'released_without_result',
                  'stateKey': path.stem, 'requestIdentity': fixture.client.request_identity(row),
                  'resultVerified': False, 'retryOriginalRequest': False, 'nativeTaskHttpStatus': 404,
                  'nativeRunningTaskCount': 0, 'npcStopped': True, 'observedAt': int(fixture.now * 1000),
                  'sourceRequestSha256': hashlib.sha256(original).hexdigest()}
        mark_path = fixture.client.root / 'operator-reconciliations' / (path.stem + '.json')
        return fixture, kwargs, path, original, mark_path, marker

    def test_operator_release_keeps_old_unknown_and_allows_only_a_new_input_same_session(self):
        from qwen_tasks import write_json
        fixture, kwargs, path, original, mark_path, marker = self.release_fixture()
        write_json(mark_path, marker)
        old = fixture.client.submit('maid_dialogue', 'old-input', 'Original input', **kwargs)
        self.assertEqual(old['status'], 'poll_unavailable')
        self.assertEqual(len(fixture.calls), 1)
        observed = fixture.client.poll('maid_dialogue', 'old-input', **kwargs)
        self.assertFalse(observed['resultVerified'])
        self.assertEqual(len(fixture.calls), 1)
        new = fixture.client.submit('maid_dialogue', 'new-independent-input', 'New input', **kwargs)
        self.assertEqual(new['status'], 'submitted')
        self.assertEqual(fixture.calls[-1][3]['session_id'], 'original-session')
        self.assertEqual(path.read_bytes(), original)
        self.assertEqual(len(fixture.calls), 2)

    def test_operator_release_rejects_wrong_identity_or_live_task_evidence(self):
        from qwen_tasks import write_json
        fixture, kwargs, path, original, mark_path, marker = self.release_fixture()
        for change in ({'nativeRunningTaskCount': 1}, {'npcStopped': False}, {'nativeTaskHttpStatus': 200},
                       {'resultVerified': True}, {'requestIdentity': marker['requestIdentity'] | {'taskId': 'task-ffffffffffff'}}):
            write_json(mark_path, marker | change)
            with self.assertRaisesRegex(ValueError, 'reconciliation_invalid'):
                fixture.client.submit('maid_dialogue', 'new-input', 'New input', **kwargs)
        self.assertEqual(len(fixture.calls), 1)
        self.assertEqual(path.read_bytes(), original)

    def test_operator_release_survives_lost_active_pointer_but_never_auto_releases_404(self):
        from qwen_tasks import write_json
        fixture, kwargs, path, original, mark_path, marker = self.release_fixture()
        import urllib.error
        fixture.error = urllib.error.HTTPError('fixture', 404, 'Task not found', None, None)
        self.assertEqual(fixture.client.submit('maid_dialogue', 'new-input', 'New input', **kwargs)['status'], 'busy')
        current = __import__('json').loads(path.read_text())
        marker['requestIdentity'] = fixture.client.request_identity(current)
        write_json(mark_path, marker)
        for pointer in (fixture.client.root / 'active-roles').glob('*.json'): pointer.unlink()
        fixture.error = None
        self.assertEqual(fixture.client.submit('maid_dialogue', 'independent-input', 'New input', **kwargs)['status'], 'submitted')
        self.assertEqual(sum(call[0] == 'POST' for call in fixture.calls), 2)


if __name__ == '__main__': unittest.main()

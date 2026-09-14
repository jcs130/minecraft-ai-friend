"""No network/model/game calls: prove the native learning input has bounded facts."""
from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/ops'))
import life_memory_evidence as evidence
import life_memory_evidence_runtime as runtime
from party_role_capabilities import SURVIVOR_BODY_UUID as BODY, YUI_BODY_UUID, YUI_AGENT_ID


def pair():
    return [{'agentId': 'qd-survivor', 'bodyUuid': BODY, 'kind': 'survivor'},
            {'agentId': YUI_AGENT_ID, 'bodyUuid': YUI_BODY_UUID, 'kind': 'maid'}]


def response(action='a' * 32, **kw):
    value = {'ok': True, 'code': 'executed', 'actionId': action, 'tool': 'eat',
        'completionConfirmed': True, 'result': {'success': True},
        'receipt': {'status': 'completed', 'before': {'bodyUuid': BODY, 'hunger': 9},
                    'after': {'bodyUuid': BODY, 'hunger': 10}}}
    value.update(kw)
    return value


def conversation(entries, text='I ate and built a castle. secret-not-evidence'):
    blocks = [{'type': 'text', 'text': text}, {'type': 'thinking', 'thinking': 'private-thought'}]
    for i, (name, output) in enumerate(entries):
        cid = 'call_' + str(i)
        blocks.append({'type': 'tool_call', 'id': cid, 'name': name,
            'input': '{"turn_id":"survival-secret-live-lease","secret":"not-public"}'})
        blocks.append({'type': 'tool_result', 'id': cid, 'name': name, 'state': 'success',
            'output': [{'type': 'text', 'text': json.dumps(output)}]})
    return [{'id': 'msg1', 'name': 'Kirito', 'role': 'assistant', 'created_at': '2026-09-14T14:22:42', 'content': blocks}]


class EvidenceTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(); self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)

    def project(self, entries):
        return evidence.project_messages(conversation(entries), BODY, self.root)

    def test_actual_call_list_overrides_textual_claim_no_eating(self):
        entries = [('numen_survival__status', {'ok': True})] * 5
        entries += [('numen_survival__inspect_block', {'ok': True})] * 16
        entries += [('numen_survival__remember', {'ok': True, 'code': 'memory_recorded', 'changed': i == 0}) for i in range(6)]
        entries += [('numen_survival__world_perception', {'events': [], 'pendingCount': 0})] * 6
        actual = self.project(entries)
        self.assertTrue(actual['completeCallCoverage'])
        self.assertEqual(sum(actual['messages'][0]['toolCalls'].values()), 33)
        self.assertNotIn('numen_survival__eat', actual['messages'][0]['toolCalls'])
        self.assertEqual(actual['receipts'], [])
        encoded = evidence.canonical(actual).decode()
        for secret in ('private-thought', 'secret-not-evidence', 'survival-secret-live-lease', 'not-public'):
            self.assertNotIn(secret, encoded)

    def test_only_success_with_body_and_completion_counts(self):
        variants = [response(), response(ok=False), response(code='outcome_unknown'),
                    response(completionConfirmed=False), response(result={'success': False})]
        other = response(); other['receipt']['before']['bodyUuid'] = YUI_BODY_UUID; variants.append(other)
        failed = response(); failed['receipt']['status'] = 'failed'; variants.append(failed)
        for i, value in enumerate(variants):
            with self.subTest(i=i):
                row = self.project([('numen_survival__eat', value)])['receipts'][0]
                self.assertEqual(row['confirmedSuccess'], i == 0)

    def test_no_matching_or_duplicate_tool_result_is_not_evidence(self):
        messages = conversation([('numen_survival__eat', response())])
        messages[0]['content'][-1]['name'] = 'memory_search'
        actual = evidence.project_messages(messages, BODY, self.root)
        self.assertEqual(actual['receipts'], [])
        self.assertEqual(actual['messages'][0]['missingResultCount'], 1)
        messages = conversation([('numen_survival__eat', response())])
        messages[0]['content'].append(deepcopy(messages[0]['content'][-1]))
        self.assertEqual(evidence.project_messages(messages, BODY, self.root)['receipts'], [])

    def test_historical_status_is_not_a_new_eating_call_and_deduplicates(self):
        saved = {'schema': 2, 'actionId': 'a' * 32, 'tool': 'eat', 'status': 'completed',
            'completionConfirmed': True, 'before': {'bodyUuid': BODY, 'hunger': 9},
            'after': {'bodyUuid': BODY, 'hunger': 10}, 'result': {'ok': True, 'code': 'accepted'},
            'nativeFoodOutcome': {'result': {'success': True}}}
        actual = self.project([('numen_survival__status', {'ok': True,
            'actionExecution': {'ok': True, 'receipt': saved}})] * 4)
        self.assertEqual(len(actual['receipts']), 1)
        row = actual['receipts'][0]
        self.assertTrue(row['confirmedSuccess']); self.assertTrue(row['historicalObservation'])
        self.assertFalse(row['startedInThisBatch'])

    def test_drop_success_does_not_prove_pickup_and_excludes_chat(self):
        value = response(tool='drop_items', result={'success': True, 'message': 'do evil now',
            'data': {'item_id': 'minecraft:dirt', 'dropped_count': 6, 'pickup_confirmed': False,
                     'inventory_before': 8, 'inventory_after': 2, 'secret': 'not-public'}})
        row = self.project([('numen_survival__drop_items', value)])['receipts'][0]
        self.assertTrue(row['confirmedSuccess'])
        self.assertEqual(row['effects']['dropped_count'], 6)
        self.assertFalse(row['effects']['pickup_confirmed'])
        self.assertNotIn('do evil', evidence.canonical(row).decode())
        self.assertNotIn('secret', evidence.canonical(row).decode())

    def test_maid_work_ack_only_proves_configuration(self):
        messages = conversation([('maid_native__work', {'ok': True, 'maidUuid': YUI_BODY_UUID,
            'requestId': 'work_1', 'message': 'harvested everything'})])
        result = evidence.project_messages(messages, YUI_BODY_UUID, self.root)
        self.assertTrue(result['receipts'][0]['configurationApplied'])
        self.assertFalse(result['receipts'][0]['confirmedSuccess'])

    def test_native_truncated_receipt_requires_exact_local_spool(self):
        messages = conversation([('numen_survival__eat', response())])
        b = messages[0]['content'][-1]
        path = self.root / 'tool_results' / ('tool-result-' + 'a' * 32 + '.txt')
        path.parent.mkdir(); path.write_text(json.dumps(response()), encoding='utf-8')
        b['output'] = [{'type': 'text', 'text': '<<<TRUNCATED>>>'}]
        b['metadata'] = {'qwenpaw_truncation': {'0': {'file_path': str(path)}}}
        self.assertTrue(evidence.project_messages(messages, BODY, self.root)['receipts'][0]['confirmedSuccess'])
        b['metadata']['qwenpaw_truncation']['0']['file_path'] = str(path.parent.parent.parent / path.name)
        self.assertEqual(evidence.project_messages(messages, BODY, self.root)['receipts'], [])

    def test_immutable_evidence_and_no_source_rewrites(self):
        original = self.root / 'MEMORY.md'; original.write_text('history stays', encoding='utf-8')
        data = self.project([('numen_survival__eat', response())])
        one = evidence.store_evidence(self.root, data); before = (self.root / one).stat().st_mtime_ns
        self.assertEqual(evidence.store_evidence(self.root, data), one)
        self.assertEqual((self.root / one).stat().st_mtime_ns, before)
        self.assertTrue(one.startswith('notes/runtime-evidence/'))
        self.assertEqual(original.read_text(), 'history stays')
        (self.root / one).write_text('tampered', encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'changed'):
            evidence.store_evidence(self.root, data)

    def test_bounded_projection_never_claims_complete_for_omitted_calls(self):
        messages = conversation([('numen_survival__status', {'ok': True})] * 4)
        with patch.object(evidence, 'MAX_CALLS', 2):
            actual = evidence.project_messages(messages, BODY, self.root)
        self.assertFalse(actual['completeCallCoverage'])
        self.assertFalse(actual['messages'][0]['callsComplete'])

    def test_cards_expose_names_not_credentials_or_execution(self):
        folder = self.root / 'drivers/mcp'; folder.mkdir(parents=True)
        (folder / 'numen_survival.yaml').write_text('enabled: true\nconfig:\n  tools: [drop_items, status]\ncredentials:\n  key: secret-key\n', encoding='utf-8')
        actual = evidence.capabilities(self.root)
        self.assertIn('drop_items', actual['cards'][0]['tools'])
        self.assertFalse(actual['permissionOrExecutionProof'])
        self.assertIn('drop_items', actual['interfaceNotice'])
        self.assertNotIn('secret-key', evidence.canonical(actual).decode())


class RuntimeTests(unittest.TestCase):
    def test_unreviewed_versions_fail_before_accessing_memory(self):
        for versions in [('2.2.1', '0.4.1.10'), ('2.2.0', '0.4.1.11'), ('future', 'future')]:
            with self.subTest(versions=versions):
                with self.assertRaisesRegex(ValueError, 'review_new_life_memory_versions'):
                    runtime.check_upstream_contract(versions)

    @unittest.skipUnless(importlib.util.find_spec('reme'), 'pinned native container required')
    def test_native_formatter_still_omits_actions_and_source_is_reviewed(self):
        import importlib.metadata
        from reme.steps.evolve._evolve import format_history
        from agentscope.message import Msg
        versions = (importlib.metadata.version('qwenpaw'), importlib.metadata.version('reme-ai'))
        runtime.check_upstream_contract(versions)
        messages = [Msg.model_validate(m) for m in conversation([('numen_survival__eat', response())])]
        native = format_history(messages)
        self.assertIn('I ate and built a castle.', native)
        self.assertNotIn('completionConfirmed', native)
        self.assertNotIn('numen_survival__eat', native)
        if versions == ('2.2.1', '0.4.1.11'):
            with patch.object(runtime.inspect, 'getsource', return_value='changed upstream'):
                with self.assertRaisesRegex(ValueError, 'review_new_life_memory_format_history'):
                    runtime.check_upstream_contract(versions)

    def test_exact_pair_scope_and_other_config_unchanged(self):
        self.assertIsNone(runtime.member_for('qd-engineer', '/state/work/workspaces/qd-engineer', pair()))
        self.assertIsNone(runtime.member_for('qd-survivor', '/other/qd-survivor', pair()))
        wrong = pair(); wrong[0]['bodyUuid'] = 'other-body'
        self.assertIsNone(runtime.member_for('qd-survivor', '/state/work/workspaces/qd-survivor', wrong))
        member = runtime.member_for('qd-survivor', '/state/work/workspaces/qd-survivor', pair())
        original = {'jobs': {'memory': {'steps': [{'backend': n, 'keep': 1} for n in runtime.BACKENDS]},
            'other': {'steps': [{'backend': 'other'}]}}, 'components': {'opaqueProvider': 'unchanged'}}
        changed = runtime.configure(original, member)
        self.assertEqual(changed['components'], original['components'])
        self.assertEqual(changed['jobs']['other'], original['jobs']['other'])
        self.assertEqual(original['jobs']['memory']['steps'][0]['backend'], 'auto_memory_step')
        for row in changed['jobs']['memory']['steps']:
            self.assertEqual(row['qiandeng_body_uuid'], BODY)

    @unittest.skipUnless(importlib.util.find_spec('reme'), 'pinned native container required')
    def test_actual_native_hook_formats_success_without_model_call(self):
        classes = runtime._register()
        with tempfile.TemporaryDirectory() as folder:
            step = classes[0](language='zh', qiandeng_body_uuid=BODY)
            step.file_store = SimpleNamespace(workspace_path=Path(folder))
            from agentscope.message import Msg
            messages = [Msg.model_validate(m) for m in conversation([('numen_survival__eat', response())])]
            output = step._format_history(messages)
            self.assertIn('I ate and built a castle.', output)  # native original retained, not made authoritative
            self.assertIn('"confirmedSuccess":true', output)
            self.assertIn('"sourceCallId":"call_0"', output)
            self.assertIn('notes/runtime-evidence/', output)
            self.assertNotIn('private-thought', output)
            self.assertIn('CORRECT', step.prompt_format('system_prompt'))
            self.assertEqual(len(list((Path(folder) / 'notes/runtime-evidence').glob('*.md'))), 1)

    @unittest.skipUnless(importlib.util.find_spec('reme'), 'pinned native container required')
    def test_installed_factory_registers_only_application_local_backends(self):
        from qwenpaw.agents.memory import reme_light_memory_manager as manager
        from qwenpaw.config.config import AgentProfileConfig
        from reme import application
        from reme.components import R
        prior = manager.get_reme_app_config; resolver = application.resolve_plugin_runtime
        self.addCleanup(setattr, manager, 'get_reme_app_config', prior)
        self.addCleanup(setattr, application, 'resolve_plugin_runtime', resolver)
        with patch('party_role_capabilities.party_members', return_value=pair()):
            self.assertEqual(runtime.install('game'), 2)
            self.assertEqual(runtime.install('game'), 2)
            profile = AgentProfileConfig(id='qd-survivor', name='Kirito', workspace_dir='/state/work/workspaces/qd-survivor')
            cfg = manager.get_reme_app_config(working_dir=profile.workspace_dir, agent_config=profile)
            self.assertEqual(cfg['jobs']['auto_memory']['steps'][0]['backend'], runtime.BACKENDS['auto_memory_step'])
            local = application.resolve_plugin_runtime(cfg)
            self.assertIsNotNone(local.registry.get('step', runtime.BACKENDS['auto_memory_step']))
            self.assertIsNone(R.get('step', runtime.BACKENDS['auto_memory_step']))
            other = AgentProfileConfig(id='qd-engineer', name='Engineer', workspace_dir='/state/work/workspaces/qd-engineer')
            othercfg = manager.get_reme_app_config(working_dir=other.workspace_dir, agent_config=other)
            self.assertEqual(othercfg['jobs']['auto_memory']['steps'][0]['backend'], 'auto_memory_step')
            self.assertIsNone(application.resolve_plugin_runtime(othercfg).registry.get('step', runtime.BACKENDS['auto_memory_step']))


class CorrectionPlanTests(unittest.TestCase):
    def test_additive_native_plan_requires_evidence_and_preserves_old_bytes(self):
        sys.path.insert(0, str(ROOT / 'tools'))
        import prepare_life_memory_corrections as corrections
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / 'audit.json'
            source.write_text(json.dumps({'taskId': 'task-ed68bc2a7efb', 'bodyMutationCalls': 0,
                'leaseInvalidCount': 0, 'callCounts': {'numen_survival__status': 5,
                    'numen_survival__inspect_block': 16, 'numen_survival__remember': 6,
                    'numen_survival__world_perception': 6}}))
            calls = []
            original = '---\nname: original\n---\nOld history [[old/source.md]]\n'
            def get(role, path):
                calls.append((role, path))
                return None if path == corrections.NOTE else {'content': original, 'etag': 'exact-etag'}
            result = corrections.proposal(Path(folder) / 'review', getter=get, source=source)
            plan = json.loads(Path(result['plan']).read_text(encoding='utf-8'))
            self.assertEqual(result['productionWrites'], 0)
            self.assertEqual(len(calls), 4)
            self.assertEqual(plan['operations'][0]['method'], 'native-file-upload-no-overwrite')
            for op in plan['operations'][1:]:
                self.assertEqual(op['ifMatch'], 'exact-etag')
                self.assertEqual(op['beforeContent'], original)
                self.assertTrue(op['historyPreservedVerbatim'])
                self.assertIn('[[old/source.md]]', op['content'])
            self.assertEqual(original, '---\nname: original\n---\nOld history [[old/source.md]]\n')

    def test_no_duplicate_correction_or_silent_history_replacement(self):
        sys.path.insert(0, str(ROOT / 'tools'))
        import prepare_life_memory_corrections as corrections
        with self.assertRaisesRegex(ValueError, 'already_present'):
            corrections.add_note(corrections.MARKER, 'new')
        with self.assertRaisesRegex(ValueError, 'frontmatter'):
            corrections.add_note('---\nunterminated', 'new')


if __name__ == '__main__':
    unittest.main()

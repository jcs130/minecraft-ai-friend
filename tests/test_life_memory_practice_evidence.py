"""Real local ledger projections and native memory hooks; no model or world IO."""
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
sys.path.insert(0, str(ROOT / 'world/survival'))
import life_memory_evidence as evidence
import life_memory_evidence_runtime as runtime
from party_role_capabilities import SURVIVOR_BODY_UUID as BODY, YUI_BODY_UUID
from practice import PracticeStore, run_id
from test_life_memory_evidence import conversation

VERSION = 'a' * 64
NAME = 'farm_harvest_replant'
TOOL = 'numen_survival__skill_read'
PRIVATE = 'private-program-fixture-objective-or-chat'
SNAPSHOT = {'ok': True, 'bodyUuid': BODY, 'dimension': 'minecraft:overworld',
    'counts': {'minecraft:wheat': 0}, 'observedAt': 1000}
OBJECTIVE = {'description': PRIVATE, 'checks': [
    {'kind': 'action_completed', 'tool': 'farm', 'count': 1}]}


def messages(raw, args=None):
    result = conversation([(TOOL, raw)], text='I inspected five plots and completed the farming milestone.')
    result[0]['content'][-2]['input'] = json.dumps(args if args is not None else {'name': NAME, 'version': VERSION})
    return result


class PracticeEvidenceTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(); self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.store = PracticeStore(self.root / 'state', clock=lambda: 1000)
        self.store.initialize()
        self.serial = 0

    def record(self, outcome=None, objective=OBJECTIVE, final=True):
        self.serial += 1
        self.store.clock = lambda: 1000 + self.serial
        turn = 'private_live_turn_' + str(self.serial)
        job = {'name': NAME, 'version': VERSION, 'turnId': turn,
            'objective': deepcopy(objective), 'practiceRunId': run_id(NAME, VERSION, turn), 'status': 'running'}
        self.store.begin(job, deepcopy(SNAPSHOT))
        if outcome:
            step_turn = 'private_step_turn_' + str(self.serial)
            args = {'operation': 'harvest', 'x': 1, 'y': 64, 'z': 1}
            self.store.step(job['practiceRunId'], step_turn, step_turn, 'farm', args)
            successful = outcome == 'success'
            receipt = {'schema': 2, 'actionId': f'{self.serial:032x}', 'turnId': step_turn,
                'tool': 'farm', 'args': args, 'status': 'completed' if successful else 'unknown',
                'completionConfirmed': successful, 'before': deepcopy(SNAPSHOT), 'after': deepcopy(SNAPSHOT),
                'result': {'ok': successful, 'code': 'executed' if successful else 'outcome_unknown',
                    'result': {'success': successful, 'message': PRIVATE}}}
            self.store.capture(job['practiceRunId'], step_turn, [receipt])
        if final:
            self.store.finish(job['practiceRunId'], dict(job, status='done'), deepcopy(SNAPSHOT))
        data = self.store.read(NAME, VERSION)
        data['runs'] = [r for r in data['runs'] if r['runId'] == job['practiceRunId']]
        return {'schema': 1, 'name': NAME, 'version': VERSION,
            'source': PRIVATE, 'fixtures': [{'private': PRIVATE}], 'description': PRIVATE,
            'practice': data, 'memory': {'plotsDone': 5, 'note': PRIVATE}}

    def project(self, raw, args=None, body=BODY):
        return evidence.project_messages(messages(raw, args), body, self.root)

    def test_program_done_with_zero_actions_retains_failed_goal_without_invented_observation_count(self):
        actual = self.project(self.record())
        row = actual['practiceRuns'][0]
        self.assertTrue(row['programReportedDone'])
        self.assertIs(row['objectiveObserved'], False)
        self.assertEqual((row['stepCount'], row['ownConfirmedActions']), (0, 0))
        self.assertFalse(row['masteryVerified']); self.assertFalse(row['evidenceComplete'])
        self.assertEqual(row['checks'][0]['observed'], 0)
        self.assertNotIn('observationCount', row)
        self.assertEqual(actual['receipts'], [])
        self.assertIn('not observations', actual['notice'])
        encoded = evidence.canonical(actual).decode()
        for private in (PRIVATE, 'five plots', 'plotsDone', 'private_live_turn_', 'private_step_turn_', 'fixtures'):
            self.assertNotIn(private, encoded)

    def test_success_unknown_and_no_objective_remain_distinct(self):
        successful = self.project(self.record('success'))['practiceRuns'][0]
        self.assertEqual(successful['ownConfirmedActions'], 1)
        self.assertIs(successful['objectiveObserved'], True)
        self.assertFalse(successful['masteryVerified'])
        self.assertFalse(successful['checks'][0]['causalAttributionVerified'])
        uncertain = self.project(self.record('unknown'))['practiceRuns'][0]
        self.assertEqual(uncertain['ownConfirmedActions'], 0)
        self.assertFalse(uncertain['evidenceComplete']); self.assertIs(uncertain['objectiveObserved'], False)
        unscored = self.project(self.record('success', objective=None))['practiceRuns'][0]
        self.assertIsNone(unscored['objectiveObserved'])
        self.assertEqual(unscored['checks'], [])
        running = self.project(self.record(final=False))['practiceRuns'][0]
        self.assertFalse(running['programReportedDone'])
        self.assertIs(running['objectiveObserved'], False)

    def test_cross_actor_in_binding_initial_final_or_step_is_rejected_without_echo(self):
        original = self.record('success')
        for location in ('binding', 'initialObservation', 'finalObservation', 'step_before', 'step_after'):
            raw = deepcopy(original); run = raw['practice']['runs'][0]
            target = run['steps'][0][location[5:]] if location.startswith('step_') else run[location]
            target['bodyUuid'] = YUI_BODY_UUID
            with self.subTest(location=location):
                actual = self.project(raw)
                self.assertEqual(actual['practiceRuns'], [])
                self.assertEqual(actual['practiceReadCoverage']['rejectedReadCount'], 1)
                self.assertNotIn(YUI_BODY_UUID, evidence.canonical(actual).decode())
        self.assertEqual(self.project(original, body=YUI_BODY_UUID)['practiceRuns'], [])

    def test_exact_version_name_run_and_objective_binding_required(self):
        original = self.record()
        changes = [({'name': 'other_skill'}, None), ({'version': 'b' * 64}, None),
            ({'schema': True}, None), ({}, {'name': NAME, 'version': 'b' * 64}),
            ({}, {'name': NAME, 'bodyUuid': BODY})]
        for patch_value, args in changes:
            with self.subTest(change=patch_value, args=args):
                self.assertEqual(self.project(dict(original, **patch_value), args)['practiceRuns'], [])
        for field, value in (('name', 'other_skill'), ('version', 'b' * 64), ('runId', 'b' * 64)):
            raw = deepcopy(original); raw['practice']['runs'][0][field] = value
            self.assertEqual(self.project(raw)['practiceRuns'], [])
        for field, value in (('name', 'other_skill'), ('version', 'b' * 64), ('kernelVersion', 'b' * 64),
                ('requestTurnId', 'private_wrong_turn_0000'), ('objectiveSha256', 'b' * 64)):
            raw = deepcopy(original); raw['practice']['runs'][0]['binding'][field] = value
            self.assertEqual(self.project(raw)['practiceRuns'], [])
        self.assertEqual(len(self.project(original, {'name': NAME})['practiceRuns']), 1)

    def test_native_skill_read_empty_or_null_version_resolves_default_without_other_falsy_values(self):
        from mcp_server import SkillTools
        from skill_library import SkillLibrary
        library = SkillLibrary(self.root / 'state/skills')
        draft = library.draft(NAME, 'function next(s,m){return {action:null,memory:m,done:true};}',
            [{'state': {'sample': 1}, 'done': True}, {'state': {'sample': 2}, 'done': True}])
        version = draft['version']
        turn = 'native_default_read_turn_0001'
        identity = run_id(NAME, version, turn)
        job = {'name': NAME, 'version': version, 'turnId': turn, 'practiceRunId': identity, 'status': 'running'}
        self.store.begin(job, deepcopy(SNAPSHOT))
        self.store.finish(identity, dict(job, status='done'), deepcopy(SNAPSHOT))
        tool = SkillTools(self.root / 'state', library)
        for requested in (None, '', version):
            raw = tool.read(NAME, requested)
            self.assertEqual(raw['version'], version)
            actual = self.project(raw, {'name': NAME, 'version': requested})
            with self.subTest(requested=requested):
                self.assertEqual([r['runId'] for r in actual['practiceRuns']], [identity])
                self.assertEqual(actual['practiceReadCoverage']['rejectedReadCount'], 0)
        raw = tool.read(NAME, '')
        for invalid in (False, True, 0, 0.0, [], {}, ' ', 'b' * 64):
            with self.subTest(invalid=invalid):
                actual = self.project(raw, {'name': NAME, 'version': invalid})
                self.assertEqual(actual['practiceRuns'], [])
                self.assertEqual(actual['practiceReadCoverage']['rejectedReadCount'], 1)

    def test_inconsistent_counts_claimed_mastery_and_outcome_flags_rejected(self):
        original = self.record()
        changes = {'stepCount': [True, -1, 129, 1], 'ownConfirmedActions': [True, -1, 1],
            'evidenceComplete': [True, 0], 'objectiveObserved': [True, 'false', 0, None],
            'programReportedDone': [False, 1], 'masteryVerified': [True, 0], 'stepsTruncated': [True, 0]}
        for field, values in changes.items():
            for value in values:
                raw = deepcopy(original); raw['practice']['runs'][0][field] = value
                with self.subTest(field=field, value=value):
                    self.assertEqual(self.project(raw)['practiceRuns'], [])
        for field, value in (('observed', 5), ('required', 2), ('met', True), ('causalAttributionVerified', True)):
            raw = deepcopy(original); raw['practice']['runs'][0]['checks'][0][field] = value
            self.assertEqual(self.project(raw)['practiceRuns'], [])

    def test_inventory_goal_is_observed_delta_not_causal_or_mastery(self):
        objective = {'description': PRIVATE, 'checks': [{'kind': 'inventory_gain', 'item': 'minecraft:wheat', 'count': 1}]}
        raw = self.record('success', objective=objective)
        row = self.project(raw)['practiceRuns'][0]
        self.assertEqual(row['ownConfirmedActions'], 1)
        self.assertFalse(row['objectiveObserved'])
        self.assertEqual(row['checks'][0]['item'], 'minecraft:wheat')
        raw['practice']['runs'][0]['checks'][0]['observed'] = 3
        self.assertEqual(self.project(raw)['practiceRuns'], [])

    def test_catalog_start_missing_duplicate_and_unsuccessful_results_not_evidence(self):
        raw = self.record('success')
        for tool in ('numen_survival__skill_catalog', 'numen_survival__skill_start', 'memory_search'):
            actual = evidence.project_messages(conversation([(tool, raw)]), BODY, self.root)
            self.assertEqual(actual['practiceRuns'], [])
        for alteration in ('missing', 'duplicate', 'wrong_name', 'state'):
            data = messages(raw)
            if alteration == 'missing': data[0]['content'].pop()
            if alteration == 'duplicate': data[0]['content'].append(deepcopy(data[0]['content'][-1]))
            if alteration == 'wrong_name': data[0]['content'][-1]['name'] = 'memory_search'
            if alteration == 'state': data[0]['content'][-1]['state'] = 'error'
            with self.subTest(alteration=alteration):
                actual = evidence.project_messages(data, BODY, self.root)
                self.assertEqual(actual['practiceRuns'], [])
                self.assertFalse(actual['practiceReadCoverage']['complete'])
        raw['practice']['available'] = False
        self.assertEqual(self.project(raw)['practiceRuns'], [])

    def test_repeated_historical_run_is_deduplicated_and_not_a_new_action(self):
        raw = self.record('success')
        data = messages(raw); another = messages(raw); another[0]['id'] = 'later_msg'
        result = evidence.project_messages(data + another, BODY, self.root)
        self.assertEqual(len(result['practiceRuns']), 1)
        row = result['practiceRuns'][0]
        self.assertEqual(row['ownConfirmedActions'], 1)
        self.assertEqual(row['messageId'], 'later_msg'); self.assertTrue(row['historicalObservation'])
        self.assertEqual(result['receipts'], [])
        raw['practice']['runs'].append(deepcopy(raw['practice']['runs'][0]))
        self.assertEqual(self.project(raw)['practiceRuns'], [])

    def test_size_counts_nonfinite_and_projection_limits_fail_closed(self):
        original = self.record()
        raw = deepcopy(original); raw['practice']['runs'] *= 4
        self.assertEqual(self.project(raw)['practiceRuns'], [])
        for blob in ('x' * (evidence.MAX_RESULT_BYTES + 1), float('nan')):
            raw = dict(original, source=blob)
            self.assertEqual(self.project(raw)['practiceRuns'], [])
            data = messages(original); data[0]['content'][-1]['output'][0]['text'] = raw
            self.assertEqual(evidence.project_messages(data, BODY, self.root)['practiceRuns'], [])
        data = []
        for i in range(5):
            item = messages(self.record()); item[0]['id'] = 'msg_' + str(i); data.extend(item)
        with patch.object(evidence, 'MAX_PRACTICE_RUNS', 2):
            actual = evidence.project_messages(data, BODY, self.root)
        self.assertEqual(len(actual['practiceRuns']), 2)
        self.assertEqual(actual['practiceReadCoverage']['omittedRunCount'], 3)
        self.assertFalse(actual['practiceReadCoverage']['complete'])
        text = evidence.evidence_prompt(data, BODY, self.root)
        inline = json.loads(text.split('：\n', 1)[1])
        self.assertEqual(len(inline['practiceRuns']), 3)
        self.assertTrue(inline['inlineTruncated'])
        self.assertNotIn(evidence.POLICY, text)
        self.assertNotIn('capabilities', inline)
        self.assertEqual(len(list((self.root / 'notes/runtime-evidence').glob('*.md'))), 1)

    def test_capability_guides_are_scoped_paths_not_loaded_skill_prose_or_permission(self):
        card_dir = self.root / 'drivers/mcp'; card_dir.mkdir(parents=True)
        paths = ('skills/qd-survivor-practice/references/program-practice.md',
            'skills/qd-minecraft-guide/references/maid-work.md', 'notes/qiandeng-memory-corrections.md')
        for rel in paths:
            p = self.root / rel; p.parent.mkdir(parents=True, exist_ok=True); p.write_text(PRIVATE, encoding='utf-8')
        (card_dir / 'maid_native.yaml').write_text('enabled: true\nconfig:\n  tools: [task_catalog, work]\n')
        result = evidence.capabilities(self.root)
        self.assertEqual({r['path'] for r in result['references']}, set(paths[1:]))
        self.assertIn('task_catalog/work', result['workNotice'])
        self.assertFalse(result['permissionOrExecutionProof'])
        self.assertNotIn(PRIVATE, evidence.canonical(result).decode())
        (card_dir / 'maid_native.yaml').write_text('enabled: false\nconfig:\n  tools: [task_catalog, work]\n')
        (card_dir / 'numen_survival.yaml').write_text('enabled: true\nconfig:\n  tools: [skill_read]\n')
        result = evidence.capabilities(self.root)
        self.assertEqual({r['path'] for r in result['references']}, {paths[0], paths[2]})
        self.assertNotIn('workNotice', result)
        self.assertIn('objectiveObserved=false/null', result['practiceNotice'])
        self.assertTrue(all(r['sha256'] == evidence.digest(PRIVATE.encode()) for r in result['references']))

    @unittest.skipUnless(importlib.util.find_spec('reme'), 'pinned native container required')
    def test_real_native_formatter_keeps_failed_objective_and_dream_native_tools(self):
        from agentscope.message import Msg
        from reme.steps.evolve.auto_memory import AutoMemoryStep
        from reme.steps.evolve.dream import extract, integrate
        from reme.steps.evolve.dream.extract import DreamExtractStep
        from reme.steps.evolve.dream.integrate import DreamIntegrateStep
        classes = runtime._register()
        step = classes[0](language='zh', qiandeng_body_uuid=BODY)
        step.file_store = SimpleNamespace(workspace_path=self.root)
        data = [Msg.model_validate(m) for m in messages(self.record())]
        formatted = step._format_history(data)
        self.assertIn('I inspected five plots', formatted)  # original text preserved, not certified
        self.assertIn('"programReportedDone":true', formatted)
        self.assertIn('"objectiveObserved":false', formatted)
        self.assertIn('"ownConfirmedActions":0', formatted)
        self.assertIn('notes/runtime-evidence/', formatted)
        self.assertNotIn('private_live_turn_', formatted)
        self.assertNotIn(PRIVATE, formatted)
        self.assertNotIn(evidence.POLICY, formatted)
        system = step.prompt_format('system_prompt')
        self.assertEqual(system.count(evidence.POLICY), 1)
        self.assertIs(classes[0].execute, AutoMemoryStep.execute)
        self.assertEqual(extract._TOOLS, ('read',))
        self.assertEqual(integrate._TOOLS, ('node_search', 'read', 'frontmatter_read', 'write', 'edit', 'frontmatter_update'))
        for cls, base, prompt in ((classes[1], DreamExtractStep, 'extract_system_prompt'),
                (classes[2], DreamIntegrateStep, 'integrate_system_prompt_personal')):
            self.assertIs(cls.execute, base.execute)
            dream = cls(language='zh', qiandeng_body_uuid=BODY)
            dream.file_store = SimpleNamespace(workspace_path=self.root)
            formatted_system = dream.prompt_format(prompt, workspace_dir=str(self.root),
                buckets='personal', max_units=1, digest_dir='digest')
            self.assertEqual(formatted_system.count(evidence.POLICY), 1)


if __name__ == '__main__':
    unittest.main()

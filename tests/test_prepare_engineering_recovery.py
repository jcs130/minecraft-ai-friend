import ast
import copy
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('engineering_recovery', Path(__file__).resolve().parents[1]/'tools/prepare_engineering_recovery.py')
recovery = importlib.util.module_from_spec(spec); spec.loader.exec_module(recovery)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'tools'))
import run_embodied_engineering_checks as check_runner

BASE = b'''import unittest
from unittest.mock import patch
class OriginalTests(unittest.TestCase):
    def setUp(self):
        self.value = 2
    def test_original(self):
        self.assertEqual(self.value, 2)
if __name__ == '__main__': unittest.main()
'''


class EngineeringUpgradeTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        change = patch.object(recovery,'ROOT',self.root); change.start(); self.addCleanup(change.stop)
        self.source = self.root/'source'; self.original = self.root/recovery.REPO
        self.source.mkdir(); recovery.run(['git','init',str(self.source)])
        self.code = 'world/ops/world_team.py'
        self.lines = ''.join('line %02d\n' % index for index in range(30))
        self.put(self.source,self.code,self.lines)
        self.put(self.source,'docs/removed.md','preserve deletion')
        self.put(self.source,'tests/test_world_team.py',BASE)
        recovery.git(self.source,'add','.'); recovery.git(self.source,'commit','-m','shared baseline')
        self.base = recovery.git(self.source,'rev-parse','HEAD').decode().strip()
        self.original.parent.mkdir(parents=True)
        recovery.run(['git','-c','core.autocrlf=false','clone','--no-local','--no-hardlinks',str(self.source),str(self.original)])
        recovery.git(self.original,'config','core.autocrlf','false')
        recovery.git(self.original,'switch','-c','codex/ops-upgrade')
        recovery.git(self.original,'branch','retained-old-branch')
        recovery.git(self.original,'tag','-a','retained-tag','-m','history')
        self.put(self.original,self.code,self.lines.replace('line 00','local committed'))
        recovery.git(self.original,'add','.'); recovery.git(self.original,'commit','-m','engineer work')
        self.old_head = recovery.git(self.original,'rev-parse','HEAD').decode().strip()
        self.put(self.original,self.code,self.lines.replace('line 00','local committed').replace('line 15','dirty local'))
        self.put(self.original,'tests/test_world_team_local.py',BASE)
        (self.original/'docs/removed.md').unlink()
        self.put(self.source,self.code,self.lines.replace('line 29','new baseline'))
        self.put(self.source,recovery.CHECK_RUNNER,(Path(check_runner.__file__)).read_bytes())
        for name in (*check_runner.EMBODIED_MODULES,*check_runner.FIXTURES):
            self.put(self.source,'tests/'+name+'.py',BASE)
        self.put(self.source,'world/survival/embodiment.py','new_brain = True\n')
        recovery.git(self.source,'add','.'); recovery.git(self.source,'commit','-m','embodied baseline')
        self.target = recovery.git(self.source,'rev-parse','HEAD').decode().strip()
        self.cfg = {'schema':1,'enabled':True,'role':'mc-god','branch':'codex/ops-upgrade',
            'repo':'/state/work/workspaces/qd-engineer/engineering/repo','baseCommit':self.base,
            'snapshotHostRoot':'/trusted/snapshots','plans':[{'id':'old-team','image':recovery.IMAGE,
                'argv':recovery.ARGV,'coverage':recovery.COVERAGE,
                'checks':{'tests/test_world_team.py':recovery.sha(BASE)},'timeoutSeconds':180}]}
        recovery.save(self.root/recovery.CONFIG,self.cfg)
        self.engineering = self.root/'server/engineering'
        for name in ('requests','receipts','state'): (self.engineering/name).mkdir(exist_ok=True)
        self.runner()
        self.journal = self.engineering/'state/commit-old-unknown.json'
        recovery.save(self.journal,{'status':'unknown','previousHead':self.old_head,'intent':{'testJobId':'old-test'}})
        self.review = self.root/'review.json'
        recovery.save(self.review,{'schema':1,'entries':[{'path':'state/'+self.journal.name,
            'sha256':recovery.sha(self.journal.read_bytes()),'resolution':'archived_unresolved_no_replay'}]})

    @staticmethod
    def put(root,name,value):
        path = root/name; path.parent.mkdir(parents=True,exist_ok=True)
        path.write_bytes(value if isinstance(value,bytes) else value.encode())

    def runner(self,**changes):
        recovery.save(self.engineering/'receipts/_runner.json',
                      {'enabled':True,'busy':False,'error':None,'updatedAt':time.time()*1000}|changes)

    def prepare(self):
        result = recovery.prepare_upgrade(self.source,self.target,self.review)
        self.assertTrue(result['ok'],result)
        return Path(result['folder'])

    def simulated_pass(self,folder):
        # Exercise persisted plan/source/output binding; no Docker or production API.
        with patch.object(recovery,'run_test_plan',return_value=(b'isolated runner fixture\n',0)):
            return recovery.test(folder)

    def test_upgrade_preserves_history_dirty_additions_deletions_and_new_baseline(self):
        before = recovery.capture(self.original)[0]
        journal = self.journal.read_bytes()
        folder = self.prepare(); stage = folder/'repo'
        self.assertEqual(recovery.capture(self.original)[0],before)
        self.assertEqual(self.journal.read_bytes(),journal)
        _, report = recovery.load(folder)
        self.assertEqual(report['proposedConfig']['baseCommit'],self.target)
        for ref,oid in before['refs'].items():
            if ref != 'refs/heads/codex/ops-upgrade': self.assertEqual(recovery.references(stage)[ref],oid)
        recovery.git(stage,'merge-base','--is-ancestor',self.old_head,'HEAD')
        recovery.git(stage,'merge-base','--is-ancestor',self.target,'HEAD')
        current = (stage/self.code).read_text()
        for text in ('local committed','dirty local','new baseline'): self.assertIn(text,current)
        committed = recovery.git(stage,'show','HEAD:'+self.code).decode()
        self.assertNotIn('dirty local',committed)
        self.assertIn('new baseline',committed)
        self.assertTrue((stage/'tests/test_world_team_local.py').exists())
        self.assertFalse((stage/'docs/removed.md').exists())
        status = recovery.git(stage,'status','--porcelain').decode()
        self.assertIn('?? tests/test_world_team_local.py',status)
        self.assertIn(' D docs/removed.md',status)
        self.assertTrue((stage/'world/survival/embodiment.py').exists())
        self.assertEqual(len(report['proposedConfig']['plans']),2)

    def test_both_committed_and_dirty_conflicts_report_paths_without_apply_candidate(self):
        for index,phase in ((0,'committed'),(15,'working_tree')):
            with self.subTest(phase=phase):
                self.put(self.source,self.code,self.lines.replace('line %02d' % index,'upstream conflict'))
                recovery.git(self.source,'add','.'); recovery.git(self.source,'commit','-m','conflict '+phase)
                target = recovery.git(self.source,'rev-parse','HEAD').decode().strip()
                before = recovery.capture(self.original)[0]
                result = recovery.prepare_upgrade(self.source,target,self.review)
                self.assertFalse(result['ok']); self.assertEqual(result['conflicts'],[self.code])
                self.assertEqual(result['conflictPhase'],phase)
                self.assertFalse((Path(result['folder'])/'proposal.json').exists())
                self.assertEqual(recovery.capture(self.original)[0],before)

    def test_already_integrated_history_keeps_target_corrections_and_original_dirty_work(self):
        recovery.git(self.source,'-c','protocol.file.allow=always','fetch',str(self.original),self.old_head)
        recovery.git(self.source,'merge','--no-edit',self.old_head)
        updated = self.lines.replace('line 00','reviewed upstream correction').replace('line 29','new baseline')
        self.put(self.source,self.code,updated)
        recovery.git(self.source,'add','.'); recovery.git(self.source,'commit','-m','correct already merged engineer code')
        self.target = recovery.git(self.source,'rev-parse','HEAD').decode().strip()
        self.assertEqual(recovery.git(self.source,'merge-base',self.old_head,self.target).decode().strip(),self.old_head)
        before = recovery.capture(self.original)[0]
        folder = self.prepare(); stage = folder/'repo'
        self.assertEqual(recovery.git(stage,'show','HEAD:'+self.code).decode(),updated)
        self.assertEqual((stage/self.code).read_text(),updated.replace('line 15','dirty local'))
        self.assertIn('?? tests/test_world_team_local.py',recovery.git(stage,'status','--porcelain').decode())
        self.assertFalse((stage/'docs/removed.md').exists())
        self.assertEqual(recovery.capture(self.original)[0],before)
        _, report = recovery.load(folder)
        self.assertEqual(report['originalConfig']['baseCommit'],self.base)
        self.assertEqual(report['proposedConfig']['baseCommit'],self.target)

    def test_diverged_heads_merge_from_latest_common_commit_not_approved_test_baseline(self):
        recovery.git(self.source,'-c','protocol.file.allow=always','fetch',str(self.original),self.old_head)
        recovery.git(self.source,'merge','--no-edit',self.old_head)
        self.put(self.source,self.code,self.lines.replace('line 00','reviewed upstream correction').replace('line 29','new baseline'))
        recovery.git(self.source,'add','.'); recovery.git(self.source,'commit','-m','correct shared history')
        self.target = recovery.git(self.source,'rev-parse','HEAD').decode().strip()
        # Commit only the already staged engineer edit. Untracked tests and the
        # working-tree deletion stay uncommitted, as in the real workspace.
        recovery.git(self.original,'add',self.code)
        recovery.git(self.original,'commit','-m','next engineer edit after shared history')
        next_head = recovery.git(self.original,'rev-parse','HEAD').decode().strip()
        self.assertEqual(recovery.git(self.source,'merge-base',self.old_head,self.target).decode().strip(),self.old_head)
        before = recovery.capture(self.original)[0]
        folder = self.prepare(); stage = folder/'repo'
        committed = recovery.git(stage,'show','HEAD:'+self.code).decode()
        self.assertIn('reviewed upstream correction',committed)
        self.assertIn('dirty local',committed)
        self.assertIn('new baseline',committed)
        recovery.git(stage,'merge-base','--is-ancestor',next_head,'HEAD')
        self.assertEqual(recovery.capture(self.original)[0],before)

    def test_candidate_cannot_change_fixed_test_or_invent_a_different_old_baseline_hash(self):
        self.put(self.original,'tests/test_world_team.py',BASE.replace(b'assertEqual(self.value, 2)',b'assertTrue(True)'))
        with self.assertRaisesRegex(ValueError,'approved_check_bytes_changed'): self.prepare()
        self.put(self.original,'tests/test_world_team.py',BASE)
        altered = json.loads((self.root/recovery.CONFIG).read_bytes())
        altered['plans'][0]['checks']['tests/test_world_team.py'] = '0'*64
        recovery.save(self.root/recovery.CONFIG,altered)
        with self.assertRaisesRegex(ValueError,'approved_check_not_committed_base'): self.prepare()

    def working_review(self):
        upstream = self.lines.replace('line 15','upstream changed').replace('line 29','new baseline')
        self.put(self.source,self.code,upstream)
        recovery.git(self.source,'add','.'); recovery.git(self.source,'commit','-m','upstream dirty conflict')
        self.target = recovery.git(self.source,'rev-parse','HEAD').decode().strip()
        base = recovery.git(self.original,'show','HEAD:'+self.code)
        local = (self.original/self.code).read_bytes()
        incoming = upstream.replace('line 00','local committed').encode()
        resolved = incoming.replace(b'upstream changed',b'reviewed local and upstream')
        review = self.root/'reviewed/review.json'
        row = {'path':self.code,'originalHead':self.old_head,'targetCommit':self.target,
            'baseSha256':recovery.sha(base),'localSha256':recovery.sha(local),
            'incomingSha256':recovery.sha(incoming),'resolvedSha256':recovery.sha(resolved),
            'resolvedFile':'resolved.py'}
        recovery.save(review,{'schema':1,'entries':[row]})
        self.put(review.parent,'resolved.py',resolved)
        return review,row,resolved,(base,local,incoming)

    def test_working_resolution_stays_dirty_is_test_gated_and_is_backed_up_with_old_bytes(self):
        review,row,resolved,_ = self.working_review()
        before = recovery.capture(self.original)[0]; journal = self.journal.read_bytes()
        result = recovery.prepare_upgrade(self.source,self.target,self.review,review)
        self.assertTrue(result['ok'],result); folder = Path(result['folder'])
        self.assertEqual(recovery.capture(self.original)[0],before)
        self.assertEqual((folder/'repo'/self.code).read_bytes(),resolved)
        self.assertIn(' M '+self.code,recovery.git(folder/'repo','status','--porcelain').decode())
        self.assertNotIn(b'reviewed local',recovery.git(folder/'repo','show','HEAD:'+self.code))
        with patch.object(recovery,'run_test_plan',return_value=(b'failed fixture',1)): recovery.test(folder)
        with self.assertRaisesRegex(ValueError,'upgrade_fixed_checks_not_passed'): recovery.apply(folder)
        self.simulated_pass(folder); self.runner()
        with patch.object(recovery,'native_quiescent',return_value={'status':'quiesced'}):
            applied = recovery.apply(folder)
        backup = Path(applied['backup'])
        self.assertEqual(recovery.capture(backup/'original-repo')[0],before)
        self.assertEqual((backup/'working-resolutions.json').read_bytes(),review.read_bytes())
        self.assertEqual((backup/'working-resolutions'/self.code).read_bytes(),resolved)
        self.assertEqual((backup/'original-repo'/self.code).read_bytes(),
                         self.lines.replace('line 00','local committed').replace('line 15','dirty local').encode())
        self.assertEqual(self.journal.read_bytes(),journal)
        self.assertEqual((self.original/self.code).read_bytes(),resolved)

    def test_working_resolution_requires_exact_conflicts_commits_inputs_paths_and_fixed_checks(self):
        review,row,resolved,inputs = self.working_review()
        folder = self.root/'review-stage'; folder.mkdir()
        maps = [{self.code:('100644',data)} for data in inputs]
        good = {'schema':1,'entries':[row]}
        def attempt(value, fixed=()):
            recovery.save(review,value)
            return recovery.resolve_working_conflicts(review,folder,self.old_head,self.target,
                *maps,[self.code],fixed)
        invalid = [({'schema':1,'entries':[]},'paths_changed'),
            ({'schema':1,'entries':[row,row]},'paths_changed'),
            ({'schema':1,'entries':[row,row|{'path':'docs/extra.md'}]},'paths_changed')]
        for key,code in (('originalHead','commit_changed'),('targetCommit','commit_changed'),
                         ('baseSha256','input_changed'),('localSha256','input_changed'),
                         ('incomingSha256','input_changed'),('resolvedSha256','bytes_changed')):
            invalid.append(({'schema':1,'entries':[row|{key:'0'*(40 if key.endswith(('Head','Commit')) else 64)}]},code))
        for key in ('path','resolvedFile'):
            invalid.append(({'schema':1,'entries':[row|{key:'../outside.py'}]},'resolution_path'))
        for value,reason in invalid:
            with self.subTest(reason=reason,value=value):
                with self.assertRaisesRegex(ValueError,reason): attempt(value)
        with self.assertRaisesRegex(ValueError,'fixed_check'): attempt(good,[self.code])
        self.put(review.parent,'resolved.py',resolved+b'changed')
        with self.assertRaisesRegex(ValueError,'bytes_changed'): attempt(good)
        self.assertFalse((folder/'working-resolutions.json').exists())

    def test_working_resolution_load_rejects_review_copy_extra_and_input_tampering(self):
        review,row,resolved,_ = self.working_review()
        result = recovery.prepare_upgrade(self.source,self.target,self.review,review)
        self.assertTrue(result['ok']); folder = Path(result['folder'])
        proposal = folder/'proposal.json'; report_raw = proposal.read_bytes()
        copy = folder/'working-resolutions'/self.code
        for path in (copy,folder/'working-resolutions.json'):
            raw = path.read_bytes(); path.write_bytes(raw+b'changed')
            with self.assertRaises(ValueError): recovery.load(folder)
            path.write_bytes(raw)
        self.put(folder,'working-resolutions/extra.py','extra')
        with self.assertRaisesRegex(ValueError,'paths_changed'): recovery.load(folder)
        (folder/'working-resolutions/extra.py').unlink()
        stored = folder/'working-resolutions.json'; review_raw = stored.read_bytes()
        altered = json.loads(review_raw); altered['entries'][0]['localSha256'] = '0'*64
        recovery.save(stored,altered)
        report = json.loads(report_raw); report['workingResolutionsSha256'] = recovery.sha(stored.read_bytes())
        recovery.save(proposal,report)
        with self.assertRaisesRegex(ValueError,'input_changed'): recovery.load(folder)
        stored.write_bytes(review_raw); proposal.write_bytes(report_raw)
        copy.unlink()
        with self.assertRaisesRegex(ValueError,'not_regular'): recovery.load(folder)
        self.put(folder,'working-resolutions/'+self.code,resolved)
        recovery.load(folder)

    def test_working_resolution_cannot_override_committed_conflicts_or_nonconflicting_work(self):
        review,row,_,_ = self.working_review()
        self.put(self.source,self.code,self.lines.replace('line 00','conflicting committed history'))
        recovery.git(self.source,'add','.'); recovery.git(self.source,'commit','-m','real history conflict')
        target = recovery.git(self.source,'rev-parse','HEAD').decode().strip()
        before = recovery.capture(self.original)[0]
        with self.assertRaisesRegex(ValueError,'requires_dirty_conflicts'):
            recovery.prepare_upgrade(self.source,target,self.review,review)
        self.put(self.source,self.code,self.lines.replace('line 29','no dirty conflict'))
        recovery.git(self.source,'add','.'); recovery.git(self.source,'commit','-m','no dirty conflict')
        target = recovery.git(self.source,'rev-parse','HEAD').decode().strip()
        with self.assertRaisesRegex(ValueError,'requires_dirty_conflicts'):
            recovery.prepare_upgrade(self.source,target,self.review,review)
        self.assertEqual(recovery.capture(self.original)[0],before)

    def test_prepared_code_snapshot_plan_and_review_tampering_are_rejected(self):
        folder = self.prepare()
        for path in (folder/'repo'/self.code,folder/'snapshot/source'/self.code,folder/'unknown-review.json'):
            with self.subTest(path=path):
                raw = path.read_bytes(); path.write_bytes(raw+b'changed')
                with self.assertRaises(ValueError): recovery.load(folder)
                path.write_bytes(raw)
        proposal_file = folder/'proposal.json'; raw = proposal_file.read_bytes(); proposal = json.loads(raw)
        proposal['proposedConfig']['plans'][1]['argv'] = ['arbitrary-shell']
        recovery.save(proposal_file,proposal)
        with self.assertRaisesRegex(ValueError,'migration_contract_changed'): recovery.load(folder)
        proposal_file.write_bytes(raw)
        recovery.load(folder)

    def test_unknown_review_is_explicit_complete_and_keeps_raw_journals(self):
        with self.assertRaisesRegex(ValueError,'unknown_commit_review'):
            recovery.prepare_upgrade(self.source,self.target)
        folder = self.prepare(); original = self.journal.read_bytes()
        self.simulated_pass(folder)
        recovery.save(self.engineering/'state/commit-new-unknown.json',{'status':'unknown'})
        with patch.object(recovery,'native_quiescent',return_value={'status':'quiesced'}):
            with self.assertRaisesRegex(ValueError,'engineering_records_changed'): recovery.apply(folder)
        self.assertEqual(self.journal.read_bytes(),original)

    def test_apply_preserves_whole_old_checkout_and_records_and_rejects_test_failure(self):
        folder = self.prepare()
        with patch.object(recovery,'run_test_plan',return_value=(b'failed fixture',1)):
            recovery.test(folder)
        with self.assertRaisesRegex(ValueError,'upgrade_fixed_checks_not_passed'): recovery.apply(folder)
        self.simulated_pass(folder)
        before = recovery.capture(self.original)[0]; journal = self.journal.read_bytes()
        with patch.object(recovery,'native_quiescent',return_value={'status':'quiesced'}):
            result = recovery.apply(folder)
        backup = Path(result['backup'])
        self.assertEqual(recovery.capture(backup/'original-repo')[0],before)
        self.assertEqual((backup/'records/state'/self.journal.name).read_bytes(),journal)
        self.assertEqual(self.journal.read_bytes(),journal)
        self.assertEqual(json.loads((self.root/recovery.CONFIG).read_bytes())['baseCommit'],self.target)
        self.assertFalse(result['businessCodeDeployed']); self.assertTrue(result['cronsRemainPaused'])

    def test_apply_rejects_new_original_index_state_even_when_working_bytes_match(self):
        folder = self.prepare(); self.simulated_pass(folder)
        recovery.git(self.original,'add',self.code)
        with self.assertRaisesRegex(ValueError,'production_candidate_changed'): recovery.apply(folder)

    def test_runner_health_and_unresolved_tests_block_maintenance(self):
        for changes in ({'busy':True},{'error':'unknown'},{'updatedAt':0}):
            self.runner(**changes)
            with self.assertRaisesRegex(ValueError,'engineering_runner_not_idle'): recovery.engineering_idle()
        self.runner()
        request = {'jobId':'new-job','sourceSha256':'a'*64,'planSha256':'b'*64}
        recovery.save(self.engineering/'requests/new-job.json',request)
        with self.assertRaisesRegex(ValueError,'engineering_test_queued'): recovery.engineering_idle()
        recovery.save(self.engineering/'receipts/new-job.json',request|{'status':'unknown'})
        with self.assertRaisesRegex(ValueError,'engineering_test_unresolved'): recovery.engineering_idle()
        recovery.save(self.engineering/'receipts/new-job.json',request|{'status':'passed','exitCode':0})
        recovery.engineering_idle()

    def test_quiesce_requires_native_idle_and_paused_crons_and_never_retries_unknown_toggle(self):
        folder = self.prepare(); jobs = [{'id':'engineering-job','enabled':False}]
        self.put(self.root,'server/agents/work/workspaces/qd-engineer/jobs.json',json.dumps({'jobs':jobs}))
        state = {'disabled':False,'calls':[]}
        def native(route,method='GET',payload=None):
            state['calls'].append((route,method))
            if route == '/cron/jobs': return jobs
            if route.endswith('/state'): return {'last_status':'success'}
            if route.endswith('/agent-status'):
                return {'status':'disabled' if state['disabled'] else 'idle','running_task_count':0}
            if method == 'PATCH':
                state['disabled'] = True
                return {'success':True,'agent_id':'qd-engineer','enabled':False}
            self.fail(route)
        with patch.object(recovery,'native_request',side_effect=native):
            proof = recovery.quiesce(folder); self.assertEqual(proof['status'],'quiesced')
            recovery.quiesce(folder)
            self.assertEqual(sum(method == 'PATCH' for route,method in state['calls']),1)
            state['disabled'] = False
            with self.assertRaisesRegex(ValueError,'admission_must_be_disabled'): recovery.native_quiescent(folder)
            proof['status']='unknown'; recovery.save(folder/'quiesce.json',proof)
            with self.assertRaisesRegex(ValueError,'quiesce_proof_required'): recovery.quiesce(folder)
            self.assertEqual(sum(method == 'PATCH' for route,method in state['calls']),1)


class EngineeringRecoveryTests(unittest.TestCase):
    def test_added_method_preserves_decorator_and_uses_original_fixture(self):
        candidate = BASE.replace(b"if __name__", b'''    @patch('builtins.len', return_value=5)
    def test_added(self, mocked):
        self.assertEqual(self.value, 2)
        self.assertEqual(len([]), 5)
if __name__''')
        generated, details = recovery.split_additive_tests(BASE, candidate, 'test_baseline')
        tree = ast.parse(generated)
        cls = next(n for n in tree.body if isinstance(n, ast.ClassDef))
        self.assertEqual(cls.name, 'CandidateOriginalTests')
        self.assertEqual(len(cls.body[0].decorator_list), 1)
        self.assertEqual(details, {'newClasses':0,'addedMethods':1})
        self.assertNotIn(b'def test_original', generated)

    def test_new_class_and_import_are_retained(self):
        candidate = BASE.replace(b'import unittest', b'import unittest\nimport math')
        candidate = candidate.replace(b"if __name__", b'''class AddedTests(unittest.TestCase):
    def test_math(self):
        self.assertEqual(math.sqrt(4), 2)
if __name__''')
        generated, details = recovery.split_additive_tests(BASE, candidate, 'test_baseline')
        self.assertIn(b'import math', generated)
        self.assertIn(b'class AddedTests', generated)
        self.assertEqual(details['newClasses'], 1)

    def test_existing_assertion_or_setup_change_requires_review(self):
        for candidate in (BASE.replace(b'assertEqual(self.value, 2)', b'assertTrue(True)'),
                          BASE.replace(b'self.value = 2', b'self.value = 3'),
                          BASE.replace(b'    def test_original', b'    def renamed_original')):
            with self.subTest(candidate=candidate), self.assertRaises(ValueError):
                recovery.split_additive_tests(BASE, candidate, 'test_baseline')

    def test_only_separate_fixed_command_plan_is_proposed(self):
        cfg = {'schema':1,'branch':'codex/ops-old','baseCommit':'a'*40,'plans':[
            {'id':'team-python','checks':{'tests/test_world_team.py':'1'*64}},
            {'id':'guild-python','checks':{'tests/test_world_content.py':'2'*64}}]}
        original = copy.deepcopy(cfg)
        result = recovery.proposed_config(cfg)
        self.assertEqual(cfg, original)
        self.assertEqual(result['baseCommit'], cfg['baseCommit'])
        self.assertEqual(result['plans'][0]['argv'], recovery.ARGV)
        self.assertEqual(result['plans'][0]['image'], recovery.IMAGE)
        self.assertEqual(result['plans'][0]['checks'], {'tests/test_world_team.py':'1'*64,'tests/test_world_content.py':'2'*64})
        self.assertNotIn('world/', result['plans'][0]['coverage'])

    def test_conflicting_approved_checks_are_not_replaced(self):
        cfg = {'plans':[{'checks':{'same':'a'}},{'checks':{'same':'b'}}]}
        with self.assertRaisesRegex(ValueError,'conflicting_approved_checks'):
            recovery.proposed_config(cfg)

    def test_known_failed_test_restores_candidate_without_passing_acceptance(self):
        output = b'FAILED (failures=1, errors=1)'
        report = {'snapshotSha256':'a'*64}
        receipt = {'exitCode':1,'status':'failed','image':recovery.IMAGE,'argv':recovery.ARGV,
                   'snapshotSha256':'a'*64,'outputSha256':recovery.sha(output)}
        self.assertEqual(recovery.completed_test_receipt(report,receipt,output),'failed')
        for changed in ({'exitCode':None}, {'exitCode':125}, {'exitCode':True},
                        {'status':'passed'}, {'image':'mutable-tag'}, {'snapshotSha256':'b'*64},
                        {'argv':['true']}, {'outputSha256':'b'*64}):
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                recovery.completed_test_receipt(report,receipt|changed,output)

    def test_snapshot_must_equal_prepared_candidate_and_preserve_approved_hashes(self):
        report = {'preparedSource':{'files':[{'path':'tests/fixed.py','sha256':'a'*64,'size':2},
                                            {'path':'gone.py','missing':True}]},
                  'snapshotManifest':[{'path':'tests/fixed.py','sha256':'a'*64}],
                  'proposedConfig':{'plans':[{'checks':{'tests/fixed.py':'a'*64}}]}}
        recovery.verify_snapshot_contract(report)
        changed = copy.deepcopy(report)
        changed['snapshotManifest'][0]['sha256']='b'*64
        with self.assertRaisesRegex(ValueError,'snapshot_not_prepared_candidate'):
            recovery.verify_snapshot_contract(changed)
        changed['preparedSource']['files'][0]['sha256']='b'*64
        with self.assertRaisesRegex(ValueError,'approved_check_bytes_changed'):
            recovery.verify_snapshot_contract(changed)

    def test_mode_normalization_preserves_content_change_and_executable_file(self):
        with tempfile.TemporaryDirectory() as temp:
            repo = Path(temp)
            recovery.run(['git','init',str(repo)])
            (repo/'normal').write_bytes(b'original')
            (repo/'script').write_bytes(b'executable')
            recovery.git(repo,'add','normal','script')
            recovery.git(repo,'update-index','--chmod=+x','script')
            recovery.git(repo,'commit','-m','base')
            base = recovery.tree(repo,'HEAD')
            recovery.git(repo,'branch','other-original-head')
            recovery.git(repo,'tag','original-tag')
            refs = recovery.references(repo)
            self.assertIn('refs/heads/other-original-head',refs)
            self.assertIn('refs/tags/original-tag',refs)
            recovery.git(repo,'update-index','--chmod=+x','normal')
            recovery.git(repo,'commit','-m','accidental modes')
            head = recovery.tree(repo,'HEAD')
            fixes=[name for name,(mode,oid) in head.items() if base[name][1]==oid and base[name][0]!=mode]
            self.assertEqual(fixes,['normal'])
            recovery.git(repo,'update-index','-z','--index-info',input=b''.join(
                (base[n][0]+' '+head[n][1]+'\t'+n).encode()+b'\0' for n in fixes))
            normalized = recovery.git(repo,'write-tree').decode().strip()
            self.assertEqual(recovery.tree(repo, normalized), base)

    def test_clone_retains_secondary_head_and_annotated_tag_without_remote(self):
        with tempfile.TemporaryDirectory() as temp:
            original, stage = Path(temp)/'original', Path(temp)/'stage'
            recovery.run(['git','init',str(original)])
            (original/'one').write_bytes(b'first')
            recovery.git(original,'add','one'); recovery.git(original,'commit','-m','first')
            recovery.git(original,'branch','other-original-head')
            recovery.git(original,'tag','-a','original-tag','-m','retained annotated tag')
            (original/'one').write_bytes(b'second')
            recovery.git(original,'add','one'); recovery.git(original,'commit','-m','second')
            refs = recovery.references(original)
            recovery.clone_preserving_refs(original,stage,refs)
            self.assertEqual(recovery.references(stage),refs)
            self.assertEqual(recovery.git(stage,'remote').strip(),b'')
            self.assertEqual(recovery.git(stage,'config','--get','core.fileMode').strip(),b'false')
            self.assertEqual(recovery.git(stage,'cat-file','-t','refs/tags/original-tag').strip(),b'tag')


if __name__ == '__main__': unittest.main()

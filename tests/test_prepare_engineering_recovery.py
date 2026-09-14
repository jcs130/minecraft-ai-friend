import ast
import copy
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('engineering_recovery', Path(__file__).resolve().parents[1]/'tools/prepare_engineering_recovery.py')
recovery = importlib.util.module_from_spec(spec); spec.loader.exec_module(recovery)

BASE = b'''import unittest
from unittest.mock import patch
class OriginalTests(unittest.TestCase):
    def setUp(self):
        self.value = 2
    def test_original(self):
        self.assertEqual(self.value, 2)
if __name__ == '__main__': unittest.main()
'''


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

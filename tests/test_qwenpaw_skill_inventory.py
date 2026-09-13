"""A populated Console is verified against each role, not a fixed total."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'world/ops'))
spec=importlib.util.spec_from_file_location('qwenpaw_skill_health',ROOT/'world/ops/qwenpaw_health.py')
health=importlib.util.module_from_spec(spec);spec.loader.exec_module(health)


class SkillInventory(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.folder=Path(self.tmp.name)
        (self.folder/'skill.json').write_text(json.dumps({'schema_version':'workspace-skill-manifest.v1',
            'skills':{'cron':{'enabled':True},'own-learning':{'enabled':True},'paused':{'enabled':False}}}),encoding='utf-8')
        self.items=[{'name':'cron','enabled':True},{'name':'own-learning','enabled':True},
                    {'name':'paused','enabled':False}]

    def test_matching_native_skills_include_custom_additions(self):
        self.assertEqual(health.check_skill_inventory(self.folder,self.items),{'cron','own-learning'})

    def test_native_legacy_manifest_keeps_exact_skills_without_rewriting(self):
        path=self.folder/'skill.json';manifest=json.loads(path.read_text())
        manifest.pop('schema_version');manifest['version']=123
        path.write_text(json.dumps(manifest),encoding='utf-8');before=path.read_bytes()
        self.assertEqual(health.check_skill_inventory(self.folder,self.items),{'cron','own-learning'})
        self.assertEqual(path.read_bytes(),before)
        manifest['schema_version']='future-v9';path.write_text(json.dumps(manifest),encoding='utf-8')
        with self.assertRaises(AssertionError):health.check_skill_inventory(self.folder,self.items)

    def test_missing_or_disabled_custom_skill_cannot_pass(self):
        for rows in (self.items[:1], [self.items[0],{'name':'own-learning','enabled':False}]):
            with self.subTest(rows=rows),self.assertRaises(AssertionError):
                health.check_skill_inventory(self.folder,rows)

    def test_other_role_extra_or_duplicate_skill_cannot_pass(self):
        for extra in ({'name':'another-role-only','enabled':True},self.items[0],{'name':'invalid','enabled':'true'}):
            with self.subTest(extra=extra),self.assertRaises(AssertionError):
                health.check_skill_inventory(self.folder,self.items+[extra])


if __name__=='__main__':unittest.main()

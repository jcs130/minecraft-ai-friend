"""Shared content must be explicitly locked, not disguised as client-only mods."""
import copy
import hashlib
import json
import unittest
from test_pack_builder import PackBuilderTests
import pack_builder as pb

class SharedExtensionTests(PackBuilderTests):
    # Use the existing isolated pack fixture without inheriting unrelated tests.
    def fixture_shared(self):
        path = self.output/'vendor/staff.jar'; path.parent.mkdir()
        self.write_jar(path, 'qiandeng_chanting')
        lock = {'minecraft':'1.21.1', 'neoforge':'21.1.248', 'client_only':False, 'server_required':True,
                'files':[{'mod_id':'qiandeng_chanting','cache_path':'vendor/staff.jar','client_only':False,
                          'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}]}
        manifest=self.output/'manifests/staff.lock.json'; manifest.parent.mkdir()
        manifest.write_text(json.dumps(lock))
        self.config['shared_extension_locks']=['manifests/staff.lock.json']
        return manifest,lock,path

    def test_shared_item_mod_is_selected_and_locked_in_client(self):
        self.fixture_shared(); result=pb.build(self.config,self.output)
        self.assertFalse(result['errors']); self.assertEqual(result['jar_count'],2)
        self.assertTrue((self.output/'client/mods/staff.jar').is_file())

    def test_scope_mismatch_cannot_silently_relabel_a_shared_mod(self):
        manifest,lock,_=self.fixture_shared()
        for patch in [{'client_only':True},{'server_required':False},{'neoforge':'wrong'}]:
            manifest.write_text(json.dumps({**lock,**patch}))
            with self.assertRaises(ValueError): pb.build(self.config,self.output)

    def test_modified_shared_artifact_is_rejected_before_copying(self):
        _,_,path=self.fixture_shared(); path.write_bytes(path.read_bytes()+b'changed')
        with self.assertRaises(ValueError): pb.build(self.config,self.output)

# Do not repeat the inherited suite; only these targeted behaviors are new.
def load_tests(loader, tests, pattern):
    return unittest.TestSuite(SharedExtensionTests(name) for name in (
        'test_shared_item_mod_is_selected_and_locked_in_client',
        'test_scope_mismatch_cannot_silently_relabel_a_shared_mod',
        'test_modified_shared_artifact_is_rejected_before_copying'))

if __name__=='__main__': unittest.main()

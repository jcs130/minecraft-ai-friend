import importlib.util,json,tempfile,unittest,hashlib,shutil
from pathlib import Path

HERE=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('access_build',HERE/'build_agent_access.py')
build=importlib.util.module_from_spec(spec);spec.loader.exec_module(build)

class BuildPolicyTest(unittest.TestCase):
    def fixture(self,root):
        lock=json.loads((HERE/'agent-access/shared-sources.lock.json').read_bytes())
        # Use the committed blob bytes for real fixtures, not compiler or runtime.
        import subprocess
        repo=HERE.parents[2]
        for rel,expected in lock['files'].items():
            git=shutil.which('git') or 'C:/Users/lzl19/AppData/Local/hermes/git/cmd/git.exe'
            text=subprocess.check_output([git,'show',lock['sourceCommit']+':'+rel],cwd=repo)
            self.assertEqual(hashlib.sha256(text.replace(b'\r\n',b'\n')).hexdigest(),expected)
            p=root/rel;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(text)
        return lock

    def test_exact_shared_sources_and_equivalent_archive_newlines(self):
        with tempfile.TemporaryDirectory() as name:
            root=Path(name);lock=self.fixture(root);self.assertEqual(build.verify_shared(root),lock)
            for p in root.rglob('*'):
                if p.is_file():p.write_bytes(p.read_bytes().replace(b'\r\n',b'\n').replace(b'\n',b'\r\n'))
            self.assertEqual(build.verify_shared(root),lock)

    def test_extra_mixin_source_is_not_silently_compiled(self):
        with tempfile.TemporaryDirectory() as name:
            root=Path(name);self.fixture(root);(root/'world/numen-compat-src/src/main/java/Unexpected.java').write_text('class Unexpected {}')
            with self.assertRaisesRegex(ValueError,'source set'):build.verify_shared(root)

    def test_changed_auth_or_handshake_code_requires_review(self):
        with tempfile.TemporaryDirectory() as name:
            root=Path(name);lock=self.fixture(root);path=root/next(k for k in lock['files'] if k.endswith('NumenNetworkChannelMixin.java'))
            path.write_bytes(path.read_bytes().replace(b'ci.cancel();',b'ci.cancel(); /* changed */'))
            with self.assertRaisesRegex(ValueError,'differs'):build.verify_shared(root)

    def test_wrong_official_binary_fails_before_output_creation(self):
        with tempfile.TemporaryDirectory() as name:
            root=Path(name);fake=root/'wrong.jar';fake.write_bytes(b'not the pinned API');out=root/'build'
            with self.assertRaisesRegex(ValueError,'Official Numen'):build.build(root,root,fake,root/'java.exe',out)
            self.assertFalse(out.exists())

if __name__=='__main__':unittest.main()

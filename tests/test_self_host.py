import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('selfhost',ROOT/'paper/self-host/selfhost.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)


class SelfHostTest(unittest.TestCase):
    def test_private_runtime_paths_are_rejected_but_templates_remain_publishable(self):
        guard_spec=importlib.util.spec_from_file_location('public_source',ROOT/'tools/check_public_source.py')
        guard=importlib.util.module_from_spec(guard_spec);guard_spec.loader.exec_module(guard)
        for path in ['.env','.env.production','paper/private/key.json','dump.dmp','x/portal.sqlite-wal','credentials.json','x/floodgate.key','server/ops.json']:
            self.assertTrue(guard.private_path(path),path)
        for path in ['.env.example','config.example.json','package-lock.json','paper/self-host/dependencies.lock.json','config/numen-mcp.example.json']:
            self.assertFalse(guard.private_path(path),path)
    def test_public_lock_is_complete_and_does_not_contain_account_material(self):
        lock=module.load_lock()
        self.assertEqual(len(lock['artifacts']),9)
        self.assertEqual(len({r['path'] for r in lock['artifacts']}),9)
        self.assertNotRegex(json.dumps(lock).lower(),r'password|api_key|authorization|privatekey')

    def test_eula_is_required_before_directory_creation_or_download(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(module,'fetch_artifact') as fetch:
            target=Path(temp)/'new'
            with self.assertRaisesRegex(ValueError,'EULA'):module.prepare(target,{},False)
            self.assertFalse(target.exists());fetch.assert_not_called()

    def test_existing_foreign_server_is_never_reused(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(module,'fetch_artifact') as fetch:
            target=Path(temp)/'server';target.mkdir();state=target/'important.txt';state.write_text('existing world')
            with self.assertRaisesRegex(ValueError,'new directory'):module.prepare(target,{},True,True)
            self.assertEqual(state.read_text(),'existing world');fetch.assert_not_called()

    def test_existing_dependency_with_wrong_hash_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(module.urllib.request,'urlopen') as fetch:
            target=Path(temp)/'dependency.jar';target.write_bytes(b'keep-original')
            with self.assertRaisesRegex(ValueError,'checksum'):
                module.fetch_artifact({'path':'dependency.jar','algorithm':'sha256','digest':'0'*64},target)
            self.assertEqual(target.read_bytes(),b'keep-original');fetch.assert_not_called()

    def test_download_hash_mismatch_removes_only_its_partial_file(self):
        class Reply(io.BytesIO):url='https://github.com/public/artifact'
        with tempfile.TemporaryDirectory() as temp, patch.object(module.urllib.request,'urlopen',return_value=Reply(b'wrong')):
            target=Path(temp)/'dependency.jar'
            with self.assertRaisesRegex(ValueError,'checksum'):
                module.fetch_artifact({'path':'dependency.jar','url':'https://github.com/public/artifact','algorithm':'sha256','digest':'0'*64},target)
            self.assertFalse(target.exists());self.assertFalse(target.with_suffix('.jar.part').exists())

    def test_lock_rejects_escape_paths_and_credential_urls(self):
        lock=module.load_lock()
        for changes in [{'path':'../../secret'},{'path':'Z:secret'},{'url':'http://github.com/a'}, {'url':'https://user:password@github.com/a'}, {'url':'https://127.0.0.1/a'}]:
            candidate=json.loads(json.dumps(lock));candidate['artifacts'][0].update(changes)
            with patch.object(module.Path,'read_text',return_value=json.dumps(candidate)):
                with self.assertRaises(ValueError):module.load_lock()

    def test_existing_output_is_not_used_for_a_new_portal_export(self):
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaisesRegex(ValueError,'new portal output'):module.export_portal(Path(temp)/'server',temp)

    def test_legacy_launcher_requires_an_external_token_and_does_not_kill_by_port(self):
        text=(ROOT/'world/live/start-live.bat').read_text().lower()
        self.assertIn('if not defined live_write_token',text)
        self.assertNotRegex(text,r'(?m)^\s*set\s+live_write_token=')
        self.assertNotIn('stop-process',text)
        self.assertIn('cd /d "%~dp0"',text)


if __name__=='__main__':unittest.main()

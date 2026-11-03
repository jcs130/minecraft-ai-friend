from pathlib import Path
import hashlib,json,os,tempfile,unittest
from unittest.mock import patch
import agentfriend_state as reader

class StateReaderTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)/'AgentFriend';self.root.mkdir()
        self.file=self.root/'config.yml';self.published=b'__agentfriend_storage:\n  revision: 1\nreward: one\n';self.file.write_bytes(self.published)
        self.pending=self.root/'.state-pending';self.pending.mkdir()
    def tearDown(self):self.temp.cleanup()
    def marker(self,content=None,**changes):
        content=content or b'__agentfriend_storage:\n  revision: 2\nreward: one\n'
        name='config.yml.site-dungeon-12345.tmp';(self.pending/name).write_bytes(content)
        row={'format':1,'revision':2,'image':name,'bytes':len(content),'sha256':hashlib.sha256(content).hexdigest(),'baseRevision':1,'baseSha256':hashlib.sha256(self.published).hexdigest()}
        row.update(changes)
        canonical=f"1\n{row['revision']}\n{row['image']}\n{row['bytes']}\n{row['sha256']}\n{row['baseRevision']}\n{row['baseSha256']}\n".encode('ascii')
        row['recordSha256']=hashlib.sha256(canonical).hexdigest()
        path=self.pending/'commit-00000000-0000-4000-8000-000000000001.json';path.write_text(json.dumps(row)+'\n')
        return row,path
    def test_plain_published_state(self):self.assertEqual(reader.read_yaml_snapshot(self.file)[0]['reward'],'one')
    def test_pending_commit_is_the_authority(self):
        self.marker();value,_=reader.read_yaml_snapshot(self.file)
        self.assertEqual(value['__agentfriend_storage']['revision'],2);self.assertEqual(self.file.read_bytes(),self.published)
    def test_read_never_edits_a_commit_record(self):
        _,path=self.marker();before=path.read_bytes();reader.read_yaml_snapshot(self.file);self.assertEqual(path.read_bytes(),before)
    def test_complete_newer_publication_does_not_require_retired_image(self):
        row,_=self.marker();image=self.pending/row['image'];os.replace(image,self.file)
        self.assertEqual(reader.read_yaml_snapshot(self.file)[0]['__agentfriend_storage']['revision'],2)
    def test_incomplete_record_is_not_an_accepted_action(self):
        _,path=self.marker();path.write_text('{"format":1')
        self.assertEqual(reader.read_yaml_snapshot(self.file)[0]['__agentfriend_storage']['revision'],1)
    def test_corrupt_complete_record_is_an_error_not_old_success(self):
        _,path=self.marker();row=json.loads(path.read_text());row['revision']=99;path.write_text(json.dumps(row)+'\n')
        with self.assertRaisesRegex(ValueError,'record_hash'):reader.read_yaml_snapshot(self.file)
    def test_corrupt_image_is_an_error(self):
        row,_=self.marker();(self.pending/row['image']).write_bytes(b'corrupt')
        with self.assertRaisesRegex(ValueError,'image_hash'):reader.read_yaml_snapshot(self.file)
    def test_changed_base_is_preserved_for_reconciliation(self):
        self.marker();changed=self.published.replace(b'one',b'two');self.file.write_bytes(changed)
        with self.assertRaisesRegex(ValueError,'projection_conflict'):reader.read_yaml_snapshot(self.file)
        self.assertEqual(self.file.read_bytes(),changed)
    def test_image_revision_must_match_record(self):
        self.marker(b'__agentfriend_storage:\n  revision: 5\nreward: one\n')
        with self.assertRaisesRegex(ValueError,'revision_mismatch'):reader.read_yaml_snapshot(self.file)
    def test_image_path_cannot_escape_its_directory(self):
        self.marker(image='../outside.tmp')
        with self.assertRaisesRegex(ValueError,'image_name'):reader.read_yaml_snapshot(self.file)
    def test_record_scan_is_bounded(self):
        for number in range(129):(self.pending/f'commit-{number}.json').write_text('incomplete')
        with self.assertRaisesRegex(ValueError,'scan_budget'):reader.read_yaml_snapshot(self.file)
    def test_real_source_rename_during_open_read_keeps_a_complete_snapshot(self):
        replacement=self.root/'next.yml';replacement.write_bytes(self.published.replace(b'one',b'two'))
        fstat=os.fstat;replaced=False
        def replace_while_open(fd):
            nonlocal replaced
            stat=fstat(fd)
            if not replaced:
                os.rename(self.file,self.root/'previous.yml')
                os.replace(replacement,self.file);replaced=True
            return stat
        with patch.object(reader.os,'fstat',side_effect=replace_while_open):value,_=reader.read_yaml_snapshot(self.file)
        self.assertTrue(replaced);self.assertEqual(value['reward'],'one');self.assertIn(b'two',self.file.read_bytes())
    @unittest.skipUnless(os.name=='nt','Windows share flags')
    def test_default_python_reader_reproduces_the_old_rename_denial(self):
        replacement=self.root/'next.yml';replacement.write_bytes(self.published)
        with self.file.open('rb'):
            with self.assertRaises(PermissionError):os.replace(replacement,self.file)

if __name__=='__main__':unittest.main()

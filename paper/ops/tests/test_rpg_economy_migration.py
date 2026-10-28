import importlib.util, json, tempfile, unittest, uuid
from pathlib import Path

spec=importlib.util.spec_from_file_location('migration',Path(__file__).parents[1]/'rpg-economy-migration.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class MigrationTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.server=self.root/'server';self.backup=self.root/'backup';self.mirror=self.root/'mirror';self.evidence=self.root/'evidence'
        self.ids=[str(uuid.uuid4()),str(uuid.uuid4())]
        self.config=(f"# untouched\r\nrpg-backend: vortex\r\ndungeon-emerald-wallet:\r\n  {self.ids[0]}: 17\r\n  {self.ids[1]}: 0\r\nother: keep-me\r\n").encode()
        self.bank=b"# private settings untouched\r\nmoney: '1.25'\r\nlastlocation:\r\n  x: -500.5\r\n"
        self.bankpath=f'plugins/Essentials/userdata/{self.ids[0]}.yml'
        for base in [self.server,self.backup/'server',self.mirror/'server']:
            for path,data in [(m.LEGACY,self.config),(self.bankpath,self.bank)]:
                f=base/path;f.parent.mkdir(parents=True,exist_ok=True);f.write_bytes(data)
        for snapshot in (self.backup,self.mirror):(snapshot/'.complete').touch()
    def apply(self,**kwargs):return m.apply(self.server,self.backup,self.mirror,self.evidence,**kwargs)
    def test_exact_decimal_and_unrelated_bytes(self):
        result=self.apply();self.assertEqual(result['total'],17)
        self.assertEqual((self.server/self.bankpath).read_bytes(),self.bank.replace(b"'1.25'",b"'18.25'"))
        self.assertEqual((self.server/m.LEGACY).read_bytes(),self.config.replace(b': 17\r',b': 0\r'))
    def test_repeated_run_never_credits_again(self):
        self.apply();before=(self.server/self.bankpath).read_bytes();self.assertTrue(self.apply()['alreadyComplete']);self.assertEqual(before,(self.server/self.bankpath).read_bytes())
    def test_legacy_writer_after_marker_is_rejected(self):
        self.apply();(self.server/m.LEGACY).write_bytes(self.config)
        with self.assertRaisesRegex(ValueError,'reappeared'):self.apply()
    def test_both_complete_backups_required(self):
        (self.mirror/'.complete').unlink()
        with self.assertRaisesRegex(ValueError,'both disks'):self.apply()
        self.assertFalse(self.evidence.exists())
    def test_latest_cold_money_must_match(self):
        (self.server/self.bankpath).write_bytes(self.bank.replace(b'1.25',b'2.25'))
        with self.assertRaisesRegex(ValueError,'differs'):self.apply()
    def test_missing_account_fails_before_any_write(self):
        (self.server/self.bankpath).unlink()
        with self.assertRaises(FileNotFoundError):self.apply()
        self.assertEqual((self.server/m.LEGACY).read_bytes(),self.config)
    def test_duplicate_uuid_rejected(self):
        with self.assertRaisesRegex(ValueError,'duplicate'):m.legacy_rows(self.config.replace(f'  {self.ids[1]}: 0'.encode(),f'  {self.ids[0]}: 3'.encode()))
    def test_invalid_legacy_mapping_rejected(self):
        with self.assertRaisesRegex(ValueError,'Unrecognized'):m.legacy_rows(self.config.replace(b': 17\r',b': NaN\r'))
    def test_duplicate_native_bank_field_rejected(self):
        (self.server/self.bankpath).write_bytes(self.bank+b"money: '3'\r\n")
        with self.assertRaisesRegex(ValueError,'one native'):self.apply()
    def test_money_limit(self):
        (self.server/self.bankpath).write_bytes(self.bank.replace(b'1.25',b'10000000000000'))
        with self.assertRaisesRegex(ValueError,'limit'):self.apply()
    def test_write_failure_restores_whole_set(self):
        def failure(path,data):
            if str(path).endswith('config.yml'):raise OSError('injected write failure')
            m.durable(path,data)
        with self.assertRaises(OSError):self.apply(replace=failure)
        self.assertEqual((self.server/self.bankpath).read_bytes(),self.bank)
        self.assertEqual((self.server/m.LEGACY).read_bytes(),self.config)
        self.assertFalse((self.server/m.MARKER).exists())
    def test_only_preopen_rollback(self):
        self.apply();m.rollback(self.server,self.evidence)
        self.assertEqual((self.server/self.bankpath).read_bytes(),self.bank)
        self.assertEqual((self.server/m.LEGACY).read_bytes(),self.config)
    def test_no_stale_rollback_after_bank_changes(self):
        self.apply();(self.server/self.bankpath).write_bytes(self.bank)
        with self.assertRaisesRegex(ValueError,'changed'):m.rollback(self.server,self.evidence)
    def test_evidence_contains_preimages(self):
        self.apply();receipt=json.loads((self.evidence/'plan.json').read_text())
        self.assertEqual(receipt['bank'],'Vortex/Vault/Essentials')
        self.assertEqual((self.evidence/'0.before').read_bytes(),self.bank)

if __name__=='__main__':unittest.main()

import importlib.util,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('player_locales',Path(__file__).resolve().parents[1]/'apply-player-locales.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class LocalePatchTests(unittest.TestCase):
    def test_only_selected_scalar_changes_while_secret_and_comments_stay_exact(self):
        source=b'# keep this\r\nbackend:\r\n  api-key: private-fixture-value\r\nmessages:\r\n  # locale only\r\n  locale: en\r\n  perIssuerLocale: true\r\n'
        patched=module.patch_scalars(source,[{'path':['messages','locale'],'value':'zh_CN'},{'path':['messages','perIssuerLocale'],'value':False}])
        self.assertIn(b'api-key: private-fixture-value\r\n',patched);self.assertIn(b'# locale only\r\n',patched)
        self.assertEqual(patched,source.replace(b'locale: en',b'locale: "zh_CN"').replace(b'perIssuerLocale: true',b'perIssuerLocale: false'))
    def test_placeholder_loss_is_rejected(self):
        with self.assertRaises(AssertionError):module.patch_scalars(b'str-test: "Selected %s"\n',[{'path':['str-test'],'value':'Selected'}])
    def test_missing_field_is_rejected_instead_of_guessing_a_location(self):
        with self.assertRaises((AssertionError,KeyError)):module.patch_scalars(b'locale: en\n',[{'path':['messages','locale'],'value':'zh_CN'}])
    def test_bom_and_an_unrelated_homonymous_key_are_preserved(self):
        source=b'\xef\xbb\xbflocale: en\nmessages:\n  locale: en\n'
        self.assertEqual(module.patch_scalars(source,[{'path':['messages','locale'],'value':'zh_CN'}]),b'\xef\xbb\xbflocale: en\nmessages:\n  locale: "zh_CN"\n')

if __name__=='__main__':unittest.main()

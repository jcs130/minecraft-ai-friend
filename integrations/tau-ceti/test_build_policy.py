import unittest
import json
from build_addons import lower_own_requirement, registration_policy_source
from language_json import parse_language, NORMALIZATIONS
from build_gateway import CODEC_MOD_HASHES, validate_codec_manifest


class BuildPolicyTests(unittest.TestCase):
    def test_beta_registration_is_an_explicit_jvm_policy(self):
        original='if(auth!=null&&auth.getClass().getMethod("stage").invoke(auth).toString().equals("REGISTER")&&!reserved(p)){release(p);}'
        changed=registration_policy_source(original)
        self.assertIn('System.getProperty("maw.guest-login","true")',changed)
        self.assertIn('{release(p);}',changed)
        with self.assertRaisesRegex(ValueError,'Review changed'):registration_policy_source('unknown source')

    def test_native_codecs_require_the_reviewed_mod_bytes(self):
        validate_codec_manifest({'files': dict(CODEC_MOD_HASHES)})
        altered = dict(CODEC_MOD_HASHES)
        altered[next(iter(altered))] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'reviewed mod bytes'):
            validate_codec_manifest({'files': altered})
        with self.assertRaisesRegex(ValueError, 'reviewed mod bytes'):
            validate_codec_manifest({'files': {}})

    def test_official_mod_metadata_cannot_be_rewritten(self):
        source = b'[[mods]]\nmodId="numen"\nversion="0.1.4.1"\nx="[21.1.248,)"'
        with self.assertRaisesRegex(ValueError, 'Only our own'): lower_own_requirement(source)

    def test_only_our_neoforge_floor_changes(self):
        source = b'[[mods]]\nmodId="maw_numen_compat"\nversion="0.1.0"\nx="[21.1.248,)"\nnumen="[0.1.4.1,0.1.4.2)"'
        result = lower_own_requirement(source)
        self.assertEqual(result, source.replace(b'21.1.248', b'21.1.234'))

    def test_unreviewed_dependency_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Unexpected upstream'):
            lower_own_requirement(b'[[mods]]\nmodId="maw_new"\nx="[21.1.259,)"')

    def test_lenient_language_preserves_strings_and_reports_normalization(self):
        before = len(NORMALIZATIONS)
        self.assertEqual(parse_language('{"name":"地下城", // source comment\n}', 'fixture'), {'name': '地下城'})
        self.assertEqual(len(NORMALIZATIONS), before + 1)
        self.assertFalse(NORMALIZATIONS[-1]['contentRewritten'])
        self.assertEqual(parse_language('{"name":"first\nsecond"}'), {'name': 'first\nsecond'})

    def test_expressions_and_non_string_language_values_are_rejected(self):
        with self.assertRaises(ValueError): parse_language('{"name": function(){ return "bad"; }}')
        with self.assertRaises(ValueError): parse_language('{"name": 42}')


if __name__ == '__main__': unittest.main()

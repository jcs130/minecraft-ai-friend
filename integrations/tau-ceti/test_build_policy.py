import unittest
import json
from build_addons import lower_own_requirement
from language_json import parse_language, NORMALIZATIONS


class BuildPolicyTests(unittest.TestCase):
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

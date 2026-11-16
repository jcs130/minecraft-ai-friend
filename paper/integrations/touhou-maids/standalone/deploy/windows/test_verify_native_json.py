import unittest
from verify_native_json import canonical


class NativeJsonTest(unittest.TestCase):
    def test_native_pretty_print_and_unicode_preserve_contents(self):
        self.assertEqual(canonical('{"name":"桐人","enabled":true,"models":["qwen3.8-flash"]}'),
                         canonical('\ufeff{\n "models": ["qwen3.8-flash"], "enabled": true, "name":"\\u6850\\u4eba"\n}'))

    def test_all_fields_including_secrets_are_compared(self):
        self.assertNotEqual(canonical('{"api_key":"test-one"}'), canonical('{"api_key":"test-two"}'))
        self.assertNotEqual(canonical('{"url":"http://127.0.0.1:19105"}'), canonical('{"url":"http://127.0.0.1:19106"}'))

    def test_boolean_number_array_order_and_missing_fields_differ(self):
        for left, right in [('{"enabled":true}', '{"enabled":1}'), ('{"n":1}', '{"n":1.0}'),
                            ('[1,2]', '[2,1]'), ('{"disabled":false}', '{}')]:
            self.assertNotEqual(canonical(left), canonical(right))

    def test_ambiguous_or_non_json_input_is_rejected(self):
        for text in ['{"key":"first","key":"second"}', 'NaN', '{bad']:
            with self.assertRaises(ValueError):
                canonical(text)


if __name__ == '__main__':
    unittest.main()

from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
sys.path.insert(0, str(ROOT / 'world/sidecar'))
from control_qwen_admission import change


class AdmissionTests(unittest.TestCase):
    def test_same_operation_is_idempotent_and_other_maintenance_cannot_release_it(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            first = change(root, 'pause', 'upgrade-fixture-01')
            self.assertEqual(change(root, 'pause', 'upgrade-fixture-01'), first)
            with self.assertRaisesRegex(ValueError, 'another_maintenance'):
                change(root, 'pause', 'upgrade-fixture-02')
            with self.assertRaisesRegex(ValueError, 'not_owned'):
                change(root, 'resume', 'upgrade-fixture-02')
            resumed = change(root, 'resume', 'upgrade-fixture-01')
            self.assertFalse(resumed['paused'])
            self.assertEqual(resumed['pausedAt'], first['updatedAt'])
            self.assertEqual(change(root, 'resume', 'upgrade-fixture-01'), resumed)
            with self.assertRaisesRegex(ValueError, 'requires_new_operation'):
                change(root, 'pause', 'upgrade-fixture-01')
            self.assertEqual(len(list((root / 'admission-history').glob('*.json'))), 2)

    def test_malformed_control_is_rejected_without_rewriting_it(self):
        with tempfile.TemporaryDirectory() as temp:
            target = Path(temp) / 'admission.json'
            target.write_text('[]', encoding='utf8')
            with self.assertRaisesRegex(ValueError, 'invalid_existing_admission'):
                change(temp, 'pause', 'upgrade-fixture-01')
            self.assertEqual(target.read_text('utf8'), '[]')

    def test_unknown_operation_cannot_be_resumed_or_choose_a_path(self):
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaisesRegex(ValueError, 'not_owned'):
                change(temp, 'resume', 'upgrade-fixture-01')
            with self.assertRaisesRegex(ValueError, 'invalid_maintenance'):
                change(temp, 'pause', '../other-operation')


if __name__ == '__main__':
    unittest.main()

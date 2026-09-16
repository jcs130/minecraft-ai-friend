"""Tests for the pattern detector (skill crystallization)."""
import json, os, sys, tempfile, time, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'world/survival'))
from pattern_detector import PatternDetector, MIN_PATTERN_LEN, CRYSTALLIZE_THRESHOLD


def make_receipts(dir_path, tools, start_time=1000000):
    """Create fake receipt files with the given tool sequence."""
    for i, tool in enumerate(tools):
        data = {'tool': tool, 'status': 'completed', 'args': {}}
        p = dir_path / ('receipt-%04d.json' % i)
        p.write_text(json.dumps(data), encoding='utf-8')
        # Set mtime to simulate ordering
        ts = start_time + i * 10
        os.utime(p, (ts, ts))


class PatternDetectorTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)

    def test_no_pattern_short_sequence(self):
        detector = PatternDetector(self.dir)
        result = detector.detect_patterns(['goto', 'eat'])
        self.assertEqual(len(result), 0)

    def test_detects_simple_repeat(self):
        detector = PatternDetector(self.dir)
        tools = ['goto', 'mine'] * 4  # 4 repeats of [goto, mine]
        patterns = detector.detect_patterns(tools)
        self.assertTrue(len(patterns) >= 1)
        top = patterns[0]
        self.assertEqual(top['sequence'], ['goto', 'mine'])
        self.assertGreaterEqual(top['repeats'], 3)

    def test_detects_farming_pattern(self):
        detector = PatternDetector(self.dir)
        tools = ['goto', 'farm', 'goto', 'farm', 'goto', 'farm', 'eat']
        patterns = detector.detect_patterns(tools)
        self.assertTrue(len(patterns) >= 1)
        # Should detect [goto, farm] repeated 3 times
        found = any(p['sequence'] == ['goto', 'farm'] for p in patterns)
        self.assertTrue(found, 'patterns=%s' % patterns)

    def test_no_pattern_random_sequence(self):
        detector = PatternDetector(self.dir)
        tools = ['goto', 'eat', 'craft', 'sleep', 'mine', 'equip', 'goto', 'farm']
        patterns = detector.detect_patterns(tools)
        # Random-ish sequence shouldn't have strong repeats
        strong = [p for p in patterns if p['repeats'] >= CRYSTALLIZE_THRESHOLD]
        self.assertEqual(len(strong), 0)

    def test_single_tool_repeat(self):
        detector = PatternDetector(self.dir)
        tools = ['farm'] * 5
        patterns = detector.detect_patterns(tools)
        # Single tool repeating 5 times should not trigger (MIN_PATTERN_LEN=2)
        self.assertEqual(len(patterns), 0)

    def test_check_produces_hint(self):
        receipts_dir = self.dir / 'receipts'
        receipts_dir.mkdir()
        make_receipts(receipts_dir, ['goto', 'mine'] * 4)
        detector = PatternDetector(self.dir)
        hints = detector.check(receipts_dir)
        self.assertTrue(len(hints) >= 1)
        self.assertEqual(hints[0]['type'], 'crystallization_hint')
        self.assertIn('goto → mine', hints[0]['message'])

    def test_cooldown_prevents_duplicate_hints(self):
        receipts_dir = self.dir / 'receipts'
        receipts_dir.mkdir()
        make_receipts(receipts_dir, ['goto', 'farm'] * 5)
        detector = PatternDetector(self.dir)
        hints1 = detector.check(receipts_dir)
        self.assertTrue(len(hints1) >= 1)
        # Immediate second check should be in cooldown
        hints2 = detector.check(receipts_dir)
        self.assertEqual(len(hints2), 0)

    def test_get_pending_hint(self):
        receipts_dir = self.dir / 'receipts'
        receipts_dir.mkdir()
        make_receipts(receipts_dir, ['goto', 'mine'] * 4)
        detector = PatternDetector(self.dir)
        detector.check(receipts_dir)
        hint = detector.get_pending_hint()
        self.assertIsNotNone(hint)
        self.assertEqual(hint['type'], 'crystallization_hint')
        # Clear it
        detector.clear_hint()
        self.assertIsNone(detector.get_pending_hint())

    def test_stale_hint_cleared_when_pattern_stops(self):
        receipts_dir = self.dir / 'receipts'
        receipts_dir.mkdir(exist_ok=True)
        # Create repeating pattern
        make_receipts(receipts_dir, ['goto', 'mine'] * 4)
        detector = PatternDetector(self.dir)
        hints = detector.check(receipts_dir)
        self.assertTrue(len(hints) >= 1)
        self.assertTrue(self.dir.joinpath('crystallization-hint.json').exists())

        # Now replace with non-repeating actions
        for f in receipts_dir.glob('*.json'):
            f.unlink()
        make_receipts(receipts_dir, ['eat', 'sleep', 'craft', 'equip'], start_time=2000000)
        # Reset cooldown for this test
        detector._last_hints.clear()
        hints2 = detector.check(receipts_dir)
        self.assertEqual(len(hints2), 0)
        # Hint file should be cleared (stale)
        self.assertFalse(self.dir.joinpath('crystallization-hint.json').exists())

    def test_mixed_patterns_prioritizes_longer(self):
        detector = PatternDetector(self.dir)
        # [goto, mine, craft] * 3 also contains [goto, mine] * 3
        tools = ['goto', 'mine', 'craft'] * 3
        patterns = detector.detect_patterns(tools)
        self.assertTrue(len(patterns) >= 1)
        # The top pattern should be the longer one (higher score)
        top = patterns[0]
        self.assertEqual(len(top['sequence']), 3)


if __name__ == '__main__':
    unittest.main()

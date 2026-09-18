"""Tests for the world-notes linter (P3: fields, duplicate lanes, staleness)."""
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from world_notes_lint import lint, parse_focus, normalise, REQUIRED_FIELDS

COMPLETE = '''# farm navigation

> by qd-survivor · 2026-09-18

- **Posture**: explore
- **Lane**: 让假身体能走到营地农场种地
- **Budget**: 5 回合；超了先回营地
- **Abandon-if**: 连续 3 次 goto 都因 target_chunk_unloaded 失败
- **Why-EV**: 农场是本世界唯一的稳定食物来源
'''

NO_ABANDON = '''# fishing

> by 5swvhK · 2026-09-18

- **Posture**: support
- **Lane**: 河边钓鱼补口粮
- **Budget**: 3 回合
- **Why-EV**: 口粮不够时最便宜的蛋白来源
'''


class ParseTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / 'focus').mkdir()

    def write(self, name, text):
        (self.root / 'focus' / name).write_text(text, encoding='utf-8')

    def test_all_five_fields_are_read(self):
        self.write('a.md', COMPLETE)
        parsed = parse_focus(self.root / 'focus' / 'a.md')
        for field in REQUIRED_FIELDS:
            self.assertIn(field, parsed['fields'])
        self.assertEqual(parsed['author'], 'qd-survivor')
        self.assertIn('营地农场', parsed['lane'])

    def test_a_note_missing_the_exit_condition_is_flagged(self):
        self.write('a.md', COMPLETE)
        self.write('b.md', NO_ABANDON)
        findings = lint(self.root)
        self.assertEqual(findings['notes'], 2)
        self.assertEqual([row['note'] for row in findings['missingFields']], ['b.md'])
        self.assertIn('Abandon-if', findings['missingFields'][0]['missing'])

    def test_two_notes_claiming_one_lane_are_a_duplicate(self):
        self.write('a.md', COMPLETE)
        self.write('b.md', COMPLETE.replace('# farm navigation', '# farm nav two')
                   .replace('让假身体能走到营地农场种地', '让假身体能走到营地农场种地 '))
        findings = lint(self.root)
        self.assertEqual(len(findings['duplicateLanes']), 1)
        self.assertEqual(sorted(findings['duplicateLanes'][0]['notes']), ['a.md', 'b.md'])

    def test_lane_matching_ignores_punctuation_and_case(self):
        self.assertEqual(normalise('Farm-Navigation'), normalise('farm navigation'))

    def test_a_note_untouched_for_long_is_stale(self):
        self.write('a.md', COMPLETE)
        # Thirty days later, the note has not moved.
        findings = lint(self.root, now=time.time() + 30 * 86400, stale_days=14)
        self.assertEqual([row['note'] for row in findings['staleNotes']], ['a.md'])
        self.assertEqual(findings['staleNotes'][0]['posture'], 'explore')

    def test_a_fresh_note_is_not_stale(self):
        self.write('a.md', COMPLETE)
        self.assertEqual(lint(self.root)['staleNotes'], [])

    def test_the_template_is_not_a_note(self):
        self.write('_TEMPLATE.md', COMPLETE)
        findings = lint(self.root)
        self.assertEqual(findings['notes'], 0)

    def test_a_missing_tree_is_not_an_error(self):
        findings = lint(self.root / 'nope')
        self.assertEqual(findings['notes'], 0)
        self.assertEqual(findings['missingFields'], [])


if __name__ == '__main__':
    unittest.main()

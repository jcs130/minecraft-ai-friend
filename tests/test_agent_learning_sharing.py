"""P2 actual effect: a skill one role activates becomes readable to another.

The full service needs a live host profile (production-only), so this covers the
sharing mechanics directly: publish on activation, an inherit list that marks origins,
a read that falls back to the shared tree, and the draft boundary that must not move.
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'world/ops'))
import agent_learning
from agent_learning import LearningTools

ROLES = ('qd-survivor', 'mc-herald')
VALUE = {'name': 'qd-learned-pad-check', 'revision': 'a' * 64,
         'description': 'Use when a body cannot reach a place it just left.',
         'steps': 'Check the pad status before blaming navigation. ' * 4,
         'tools': ['read_file']}


class SharingHarness(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.state = Path(self.tmp.name)
        (self.state / 'config.json').write_text(json.dumps(
            {'agents': {'profiles': {role: {'enabled': True} for role in ROLES}}}), encoding='utf-8')
        self.services = {}
        for role in ROLES:
            folder = self.state / 'workspaces' / role
            folder.mkdir(parents=True)
            (folder / 'agent.json').write_text(json.dumps({'id': role}), encoding='utf-8')
        self.shared = self.state / 'world-skills'

    def learning(self, role):
        return LearningTools(role, 'game', state=self.state, service=object())


class PublishTests(SharingHarness):
    def test_activation_publishes_and_another_role_can_read_it(self):
        author = self.learning('qd-survivor')
        author._publish(VALUE['name'], VALUE, VALUE['revision'])

        self.assertTrue((self.shared / 'index.json').exists())
        entry = json.loads((self.shared / 'index.json').read_text(encoding='utf-8'))['skills'][VALUE['name']]
        self.assertEqual(entry['origin'], 'qd-survivor')

        reader = self.learning('mc-herald')
        self.assertIn(VALUE['name'], reader.shared_skills())
        self.assertEqual(reader.shared_skills()[VALUE['name']]['origin'], 'qd-survivor')

        read = reader.read_skill(VALUE['name'])
        self.assertTrue(read['inherited'])
        self.assertEqual(read['origin'], 'qd-survivor')
        self.assertIn('pad status', read['content'])
        self.assertEqual(read['role'], 'mc-herald')

    def test_a_role_does_not_list_its_own_shared_skill(self):
        author = self.learning('qd-survivor')
        author._publish(VALUE['name'], VALUE, VALUE['revision'])
        self.assertEqual(author.shared_skills(), {})

    def test_an_unactivated_draft_is_never_shared(self):
        """The sandbox boundary: only finished work leaves its author."""
        reader = self.learning('mc-herald')
        self.assertEqual(reader.shared_skills(), {})
        with self.assertRaises(Exception):
            reader.read_skill('qd-learned-never-published')

    def test_publishing_is_best_effort(self):
        """A role's own activation must not fail because the shared tree is unavailable."""
        author = self.learning('qd-survivor')
        author.shared = self.state / 'config.json'      # a file, not a directory
        author._publish(VALUE['name'], VALUE, VALUE['revision'])   # must not raise

    def test_a_corrupted_shared_index_is_ignored_not_fatal(self):
        reader = self.learning('mc-herald')
        self.shared.mkdir(parents=True, exist_ok=True)
        (self.shared / 'index.json').write_text('{not json', encoding='utf-8')
        self.assertEqual(reader.shared_skills(), {})


if __name__ == '__main__':
    unittest.main()

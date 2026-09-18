"""P2: a promoted skill becomes usable by another agent, and only explicitly.

The two libraries below stand for two agents: separate local stores, one shared world
store. Everything the design promised is checked here - usable across agents, no agent
able to write into another's store, and a local fix never shadowed by a shared copy.
"""
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/survival'))
from skill_library import SkillError, SkillLibrary

POINT = {'x': -530, 'y': 69, 'z': 890}
OBSERVE = {'tool': 'inspect_container', 'args': POINT}
SOURCE = '''function next(state,memory) {
  if (!state.ready) return {memory:memory,waitSeconds:60,reason:"Wait for the next local check"};
  return {memory:{checks:(memory.checks || 0)+1},observe:{
    tool:"inspect_container",args:{x:-530,y:69,z:890}}};
}'''
FIXTURES = [
    {'state': {'ready': False}, 'expectedWaitSeconds': 60, 'expectedObserve': None, 'expectedMemory': {}},
    {'state': {'ready': True}, 'expectedWaitSeconds': None, 'expectedObserve': OBSERVE,
     'expectedMemory': {'checks': 1}},
]


def build(library, name='shared_probe'):
    """Draft, test and promote a trivial skill; return its version."""
    library.draft(name, SOURCE, FIXTURES, description='probe')
    report = library.test(name)
    assert report['passed'], report
    library.promote(name, report['version'])
    return report['version']


class SharingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.world = self.base / 'skills-world'
        self.alice = SkillLibrary(self.base / 'alice' / 'skills', world_root=self.world)
        self.bob = SkillLibrary(self.base / 'bob' / 'skills', world_root=self.world)

    def test_publish_makes_a_skill_usable_by_another_agent(self):
        version = build(self.alice)
        self.assertFalse(self.alice.read('shared_probe')['shared'])
        published = self.alice.publish('shared_probe')
        self.assertTrue(published['published'])

        record = self.bob.read('shared_probe')
        self.assertTrue(record['shared'])
        self.assertEqual(record['version'], version)
        result = self.bob.run('shared_probe', {'ready': True}, {})
        self.assertEqual(result['observe'], OBSERVE)
        self.assertTrue(result['skill']['shared'])

    def test_a_shared_skill_appears_in_the_other_agents_catalog_marked_shared(self):
        build(self.alice)
        self.alice.publish('shared_probe')
        names = {row['name']: row for row in self.bob.catalog()['skills']}
        self.assertIn('shared_probe', names)
        self.assertTrue(names['shared_probe'].get('shared'))

    def test_an_agent_cannot_write_into_the_shared_store_by_drafting(self):
        build(self.bob, 'bobs_own')
        self.assertFalse((self.world / 'bobs_own').exists())
        self.assertNotIn('bobs_own', {row['name'] for row in self.alice.catalog()['skills']})

    def test_a_local_copy_always_wins_over_the_shared_one(self):
        build(self.alice)
        self.alice.publish('shared_probe')
        # Bob fixes it locally: his own store must shadow the shared copy.
        own = build(self.bob, 'shared_probe')
        record = self.bob.read('shared_probe')
        self.assertFalse(record['shared'])
        self.assertEqual(record['version'], own)

    def test_publish_requires_a_promoted_skill(self):
        self.alice.draft('shared_probe', SOURCE, FIXTURES, description='probe')
        self.alice.test('shared_probe')
        with self.assertRaises(SkillError):
            self.alice.publish('shared_probe')

    def test_publish_is_idempotent(self):
        build(self.alice)
        first = self.alice.publish('shared_probe')
        second = self.alice.publish('shared_probe')
        self.assertTrue(first['published'])
        self.assertFalse(second['published'])

    def test_without_a_world_root_nothing_is_shared(self):
        solo = SkillLibrary(self.base / 'solo' / 'skills')
        build(solo)
        with self.assertRaisesRegex(SkillError, 'shared_skill_store_unavailable'):
            solo.publish('shared_probe')
        # The store itself may exist (the other agents' libraries create it); what must
        # not appear there is anything the solo library wrote.
        self.assertEqual([d.name for d in self.world.iterdir() if d.is_dir()], [])

    def test_the_shared_store_does_not_leak_into_a_library_without_one(self):
        build(self.alice)
        self.alice.publish('shared_probe')
        solo = SkillLibrary(self.base / 'solo' / 'skills')
        self.assertNotIn('shared_probe', {row['name'] for row in solo.catalog()['skills']})


if __name__ == '__main__':
    unittest.main()

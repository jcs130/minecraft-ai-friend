"""The evolution candidate must quote the ledgers, never invent evidence.

Asking the model to discover its own repeating problem produced eleven asks and zero
drafts. These tests hold the replacement to a stricter standard than the ask it replaces:
every line it hands the model has to be greppable back to a real file.

They also hold it to the real ledgers rather than a convenient fixture. Round one named
patterns only from pattern-cooldown.json and passed every test here, then returned an empty
string in production: the detector prunes that file to a five minute window, so by the time
a shift is long enough to owe a draft the pattern is usually gone from it. Enumerating the
action sequence is what keeps the two in step.
"""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/survival'))
from controller import (COOLDOWN_NOTE, Controller, MAX_CANDIDATE_CHARS, MAX_QUOTED_EPISODES,
                        MIN_PATTERN_REPEATS, SEQUENCE_NOTE, evolution_candidate,
                        evolution_candidate_due)
from numen_gateway import write_json
from test_survival_controller import FakeClock, FakeBackend, FakeGateway, FakeSkills, BODY_UUID

MARKER = '【进化候选·台账取证】'
SETTINGS = {'schema': 1, 'bodyName': 'Kirito', 'bodyUuid': BODY_UUID,
            'mission': 'Build a sustainable camp', 'decisionsPerDay': 50,
            'decisionCooldownSeconds': 0, 'taskTimeoutSeconds': 60,
            'maxSkillSteps': 8, 'maxSkillSeconds': 600, 'observationSeconds': 10,
            'workArea': {'minX': 64, 'maxX': 160, 'minZ': 64, 'maxZ': 160}}
DUE = (3, 9, 12, 15, 18, 21, 24, 27)
NOT_DUE = (0, 1, 2, 4, 5, 6, 7, 8, 10, 11, 13, 14, 16, 17, 19, 20, 22, 23, 25, 26, 28)


def episode(at, action, status):
    return json.dumps({'at': at, 'kind': 'action_observed', 'actionId': at[-8:],
                       'action': action, 'receiptStatus': status}, ensure_ascii=False)


def stamp(index):
    return '2026-09-18T%02d:%02d:00.000000+00:00' % (index // 2, (index % 2) * 30)


def farm_cycle(pairs):
    """A real ledger tail: farm then equip_item, repeated `pairs` times."""
    rows = []
    for index in range(pairs * 2):
        action = 'farm' if index % 2 == 0 else 'equip_item'
        rows.append(episode(stamp(index), action, 'completed' if index % 2 == 0 else 'failed'))
    return rows


def distinct_actions(count):
    """A trajectory with nothing to crystallize: every row carries its own action."""
    return [episode(stamp(index), 'probe_%02d' % index, 'completed') for index in range(count)]


class EvolutionCandidateTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.state = Path(temporary.name) / 'survival'
        self.state.mkdir()

    def ledgers(self, names, rows, stalled=('农场作物管理：等待成熟收割', '补种(-639,64,1055)farmland')):
        write_json(self.state / 'pattern-cooldown.json', {name: 1789719517.0 for name in names})
        (self.state / 'episodes.jsonl').write_text('\n'.join(rows) + '\n', encoding='utf-8')
        write_json(self.state / 'stagnation-state.json',
                   {'schema': 1, 'tracked': {goal: {'at': 1789702099.0} for goal in stalled},
                    'lastHintAt': {}})

    def quoted(self, block):
        """Check every receipt line against one real record, and hand the lines back."""
        raw = (self.state / 'episodes.jsonl').read_text(encoding='utf-8')
        records = [{key: row.get(key) for key in ('at', 'action', 'receiptStatus')}
                   for row in (json.loads(line) for line in raw.splitlines() if line.strip())]
        lines = [line[2:] for line in block.split('\n') if line.startswith('- ')]
        self.assertEqual(len(lines), MAX_QUOTED_EPISODES)
        for line in lines:
            at, action, status = line.split(' ')
            # Not merely three values that each exist somewhere: one real record
            # has to carry all three, or the line was stitched together.
            self.assertIn({'at': at, 'action': action, 'receiptStatus': status}, records)
        return lines

    def test_every_quoted_receipt_is_verbatim_in_the_fixture_ledger(self):
        self.ledgers(['farm|equip_item'], farm_cycle(4))
        block = evolution_candidate(self.state)
        self.assertTrue(block)
        self.assertLessEqual(len(block), MAX_CANDIDATE_CHARS)
        self.assertIn('farm|equip_item', block)
        self.assertIn('重复出现了 4 次', block)
        self.assertIn('2 个曾经卡住不动的不同目标', block)
        self.assertEqual(len(self.quoted(block)), 3)

    def test_pattern_below_the_repeat_floor_is_not_promoted(self):
        self.ledgers(['farm|equip_item'], farm_cycle(MIN_PATTERN_REPEATS - 1))
        self.assertEqual(evolution_candidate(self.state), '')
        # A cooldown name the recent trajectory no longer shows is not evidence either,
        # and neither is a trajectory in which nothing repeats at all.
        self.ledgers(['goto|place_block|goto'], distinct_actions(12))
        self.assertEqual(evolution_candidate(self.state), '')
        self.ledgers([], distinct_actions(12))
        for absent in ('pattern-cooldown.json', 'episodes.jsonl'):
            with self.subTest(missing=absent):
                (self.state / absent).unlink()
                self.assertEqual(evolution_candidate(self.state), '')

    def test_overlapping_hits_never_reach_the_floor(self):
        # Four identical actions read as three overlapping pairs but only two
        # non-overlapping ones, and two is all the block could quote honestly.
        rows = [episode(stamp(index), 'goto', 'completed') for index in range(MIN_PATTERN_REPEATS + 1)]
        self.ledgers([], rows)
        self.assertEqual(evolution_candidate(self.state), '')

    def test_an_empty_or_missing_cooldown_table_still_yields_a_candidate(self):
        for missing in (False, True):
            with self.subTest(cooldownFileMissing=missing):
                self.ledgers([], farm_cycle(4))
                if missing:
                    (self.state / 'pattern-cooldown.json').unlink()
                block = evolution_candidate(self.state)
                self.assertIn('farm|equip_item', block)
                self.assertIn('重复出现了 4 次', block)
                self.assertIn(SEQUENCE_NOTE, block)
                self.assertNotIn(COOLDOWN_NOTE, block)
                self.quoted(block)

    def test_a_low_frequency_cooldown_name_falls_back_to_the_sequence(self):
        # Exactly the real table that broke round one: one entry, two occurrences in the
        # tail, under the floor of three - while the trajectory plainly keeps repeating.
        rows = farm_cycle(4) + [episode(stamp(80 + index), action, 'completed') for index, action
                                in enumerate(('goto', 'place_block', 'goto',
                                              'goto', 'place_block', 'goto'))]
        self.ledgers(['goto|place_block|goto'], rows)
        block = evolution_candidate(self.state)
        self.assertIn('farm|equip_item', block)
        self.assertIn('重复出现了 4 次', block)
        self.assertIn(SEQUENCE_NOTE, block)
        self.assertNotIn(COOLDOWN_NOTE, block)
        self.assertNotIn('goto', block)
        self.quoted(block)

    def test_a_qualifying_cooldown_name_is_preferred_over_a_frequenter_sequence_pattern(self):
        rows = farm_cycle(6) + [episode(stamp(80 + index), action, 'completed') for index, action
                                in enumerate(('eat', 'drink') * MIN_PATTERN_REPEATS)]
        self.ledgers(['eat|drink'], rows)
        block = evolution_candidate(self.state)
        self.assertIn('eat|drink', block)
        self.assertIn('重复出现了 %d 次' % MIN_PATTERN_REPEATS, block)
        self.assertIn(COOLDOWN_NOTE, block)
        self.assertNotIn(SEQUENCE_NOTE, block)
        # farm|equip_item repeats six times here and still loses: the detector already
        # named eat|drink, so that name is the one worth putting in front of the model.
        self.assertNotIn('farm|equip_item', block)
        self.quoted(block)

    def test_the_most_frequent_qualifying_pattern_wins(self):
        self.ledgers(['goto|goto', 'farm|equip_item'],
                     farm_cycle(5) + [episode(stamp(90 + i), 'goto', 'completed') for i in range(4)])
        block = evolution_candidate(self.state)
        self.assertIn('farm|equip_item', block)
        self.assertNotIn('goto|goto ', block)


class EvolutionCandidatePromptTests(unittest.TestCase):
    """The call site: gated on cyclesSince, and silent means byte-identical."""

    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.state = Path(temporary.name) / 'survival'
        self.public = Path(temporary.name) / 'public/survivor.json'
        self.state.mkdir()
        self.clock, self.backend = FakeClock(), FakeBackend()
        self.gateway = FakeGateway(self.state, self.clock)
        write_json(self.state / 'settings.json', SETTINGS)
        write_json(self.state / 'control.json', {'schema': 1, 'enabled': True, 'autonomous': True})
        self.controller = Controller(self.state, self.public, self.gateway, self.backend,
                                     self.clock, FakeSkills())
        self.ledgers = ['farm|equip_item']
        write_json(self.state / 'pattern-cooldown.json', {name: 1789719517.0 for name in self.ledgers})
        (self.state / 'episodes.jsonl').write_text('\n'.join(farm_cycle(4)) + '\n', encoding='utf-8')

    def turn(self, cycles_since):
        """One real submit_model call with the dry spell pinned to cycles_since."""
        self.controller.data['active'] = None
        self.controller.data['lastDecisionSignature'] = None
        with patch.object(Controller, '_evolution_quota',
                          return_value={'produced': 0, 'cyclesSince': cycles_since}):
            self.controller.submit_model(self.gateway.snapshot(),
                                         {'schema': 1, 'enabled': True, 'autonomous': True})
        prompt = self.backend.submitted[-1]['prompt']
        self.payload = prompt.split('\n', 1)[1]
        return json.loads(self.payload)['instruction']

    def test_due_cycle_appends_the_candidate_and_the_prompt_still_parses(self):
        instruction = self.turn(3)
        self.assertIn(MARKER, instruction)
        self.assertIn('farm|equip_item', instruction)
        self.assertIn('\n', instruction)
        # The block is a JSON string value, so its newlines are escaped and the
        # payload stays on one line - the split above is what every round test uses.
        self.assertNotIn('\n', self.payload)

    def test_no_qualifying_candidate_leaves_the_prompt_byte_identical(self):
        due = self.turn(3)
        self.assertIn(MARKER, due)
        # Silence has to come from the trajectory, not from a missing table: an empty
        # cooldown file alone is no longer enough to suppress the candidate.
        (self.state / 'pattern-cooldown.json').unlink()
        self.assertIn(MARKER, self.turn(3))
        (self.state / 'episodes.jsonl').write_text('\n'.join(distinct_actions(12)) + '\n',
                                                   encoding='utf-8')
        without = self.turn(3)
        self.assertNotIn(MARKER, without)
        self.assertNotEqual(due, without)
        # Empty candidate is not "different text": it is the same text as a role that
        # has no ledgers at all.
        (self.state / 'episodes.jsonl').unlink()
        self.assertEqual(without, self.turn(3))

    def test_the_gate_is_a_due_cycle_and_not_a_ladder(self):
        self.assertTrue(all(evolution_candidate_due(cycles) for cycles in DUE))
        self.assertFalse(any(evolution_candidate_due(cycles) for cycles in NOT_DUE))
        # A failed quota read hands back {}, so cyclesSince can be None or absent, and
        # None >= 9 raises in Python 3 rather than answering the question.
        for absent in (None, '9', 9.0):
            with self.subTest(cyclesSince=absent):
                self.assertFalse(evolution_candidate_due(absent))

    def test_cycles_that_are_not_due_never_open_the_ledgers(self):
        for cycles_since in NOT_DUE:
            with self.subTest(cyclesSince=cycles_since):
                with patch('controller.evolution_candidate',
                           side_effect=AssertionError('hot path must not read ledgers')) as spy:
                    instruction = self.turn(cycles_since)
                spy.assert_not_called()
                self.assertNotIn(MARKER, instruction)
        for cycles_since in DUE:
            with self.subTest(cyclesSince=cycles_since):
                with patch('controller.evolution_candidate', wraps=evolution_candidate) as spy:
                    self.assertIn(MARKER, self.turn(cycles_since))
                spy.assert_called_once_with(self.controller.root)


if __name__ == '__main__':
    unittest.main()

"""Tests for one-life-per-session: death recorded, then a new conversation.

The death counter fixtures are the real replies observed on 2026-09-17, when the
objective read `Kirito has 19 [mcdeaths]`.
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'world/survival'))
import life_cycle
from life_cycle import (check, collect, consume, latest_death, note, parse_roster_deaths,
                        pending_note, record, rotate_session, take_rotation)

SETTINGS = {'bodyName': 'Kirito', 'bodyUuid': 'd4ac9523-4962-43ed-98c5-19b49e104048',
            'ownerUuid': 'e5005711-be9f-44b7-aaad-6993c0ba5df4'}


def receipt(tool, code, hp_before, hp_after, position, message=''):
    return {'tool': tool, 'args': {'x': position['x'], 'z': position['z']},
            'result': {'ok': code == 'executed', 'code': code,
                       'result': {'message': message}},
            'before': {'hp': hp_before, 'position': position},
            'after': {'hp': hp_after, 'position': position}, 'acceptedAt': 1789644000000}


class Harness(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / 'settings.json').write_text(json.dumps(SETTINGS), encoding='utf-8')
        (self.root / 'life-session.json').write_text(json.dumps(
            {'schema': 1, 'agentId': 'qd-survivor', 'bodyUuid': SETTINGS['bodyUuid'],
             'userId': 'survival-controller', 'channel': 'console',
             'primarySessionId': 'life-' + 'a' * 32, 'chatId': 'chat-old'}), encoding='utf-8')
        (self.root / 'controller.json').write_text(json.dumps(
            {'decisions': [{'turnId': 'survival-1', 'startedAt': 1}],
             'lastDecision': {'turnId': 'survival-last'}}), encoding='utf-8')
        receipts = self.root / 'action-receipts'
        receipts.mkdir()
        # The real tail of the life: two refusals, then the fatal goto.
        (receipts / '001.json').write_text(json.dumps(receipt(
            'goto', 'accepted', 20.0, 14.2, {'x': -750.0, 'y': 63, 'z': 1086.0})), encoding='utf-8')
        (receipts / '002.json').write_text(json.dumps(receipt(
            'farm', 'action_rejected', 14.2, 9.0, {'x': -751.0, 'y': 63, 'z': 1085.0},
            'aim -751,63,1085 is blocked from here - the crosshair lands on grass_block')), encoding='utf-8')
        (receipts / '003.json').write_text(json.dumps(receipt(
            'farm', 'action_rejected', 9.0, 9.0, {'x': -751.0, 'y': 63, 'z': 1085.0},
            'aim -751,63,1085 is blocked from here - the crosshair lands on grass_block')), encoding='utf-8')
        (receipts / '004.json').write_text(json.dumps(receipt(
            'farm', 'action_rejected', 9.0, 0.0, {'x': -751.0, 'y': 63, 'z': 1085.0},
            'aim -751,63,1085 is blocked from here - the crosshair lands on grass_block')), encoding='utf-8')


class ParseTests(unittest.TestCase):
    """The roster is the body's own report. Absent keys mean 'not reported'."""

    def test_a_dead_line_reports_the_death_and_the_cause(self):
        raw = ('count=1\n'
               'Kirito|uuid=d4ac9523-4962-43ed-98c5-19b49e104048|owner=e5005711-be9f-44b7-aaad-6993c0ba5df4'
               '|dim=minecraft:overworld|pos=-748,60,1085|dead=1|respawnMs=30000|cause=shot by Pillager')
        deaths = parse_roster_deaths(raw)
        self.assertEqual(len(deaths), 1)
        self.assertEqual(deaths[0]['name'], 'Kirito')
        self.assertEqual(deaths[0]['cause'], 'shot by Pillager')
        self.assertEqual(deaths[0]['respawnMs'], 30000)

    def test_a_live_line_is_not_a_death(self):
        raw = ('count=1\n'
               'Kirito|uuid=d4ac9523-4962-43ed-98c5-19b49e104048|owner=e500711-be9f-44b7-aaad-6993c0ba5df4'
               '|dim=minecraft:overworld|pos=-541,63,870|respawnMs=-1')
        self.assertEqual(parse_roster_deaths(raw), [])

    def test_a_line_without_the_fields_reports_nothing(self):
        """Today's roster carries no death keys; that is not evidence of a death."""
        raw = ('count=1\n'
               'Kirito|uuid=d4ac9523-4962-43ed-98c5-19b49e104048|owner=e5005711-be9f-44b7-aaad-6993c0ba5df4'
               '|dim=minecraft:overworld|pos=-541,63,870')
        self.assertEqual(parse_roster_deaths(raw), [])

    def test_another_companion_is_not_our_death(self):
        raw = ('count=2\n'
               'Yui|uuid=e6ef6001-47c6-4f13-823c-1b724520d164|dead=1|respawnMs=0\n'
               'Kirito|uuid=d4ac9523-4962-43ed-98c5-19b49e104048|respawnMs=-1\n')
        self.assertEqual(parse_roster_deaths(raw, body_name='Kirito'), [])

    def test_garbage_reports_nothing(self):
        for raw in (None, '', 'count=0', 'noise', 42):
            self.assertEqual(parse_roster_deaths(raw), [])


class CollectTests(Harness):
    def test_the_record_carries_the_facts_of_the_life_that_ended(self):
        facts = collect(self.root, 'roster death (respawn in 30000ms)', now=1789644195.0)
        self.assertEqual(facts['bodyName'], 'Kirito')
        self.assertEqual(facts['sessionId'], 'life-' + 'a' * 32)
        self.assertEqual(facts['lastPosition'], {'x': -751.0, 'y': 63, 'z': 1085.0})
        self.assertEqual(facts['healthLowest'], 0.0)
        self.assertEqual([a['tool'] for a in facts['lastActions']], ['goto', 'farm', 'farm', 'farm'])

    def test_the_record_reuses_the_environment_signals(self):
        facts = collect(self.root, 'death', now=1789644195.0)
        kinds = [s['kind'] for s in facts['environment']]
        self.assertIn('repeated_rejection', kinds)
        self.assertIn('damage', kinds)

    def test_the_note_names_the_cause_the_place_and_what_the_world_said(self):
        text = note(collect(self.root, 'shot by Pillager', now=1789644195.0))
        self.assertIn('shot by Pillager', text)
        self.assertIn('-751.0', text)
        self.assertIn('farm', text)
        self.assertIn('挡了 3 次', text)


DEAD_LINE = ('count=1\nKirito|uuid=d4ac9523-4962-43ed-98c5-19b49e104048'
             '|owner=e5005711-be9f-44b7-aaad-6993c0ba5df4|dim=minecraft:overworld'
             '|pos=-748,60,1085|dead=1|respawnMs=30000|cause=shot by Pillager')
LIVE_LINE = ('count=1\nKirito|uuid=d4ac9523-4962-43ed-98c5-19b49e104048'
             '|owner=e5005711-be9f-44b7-aaad-6993c0ba5df4|dim=minecraft:overworld'
             '|pos=-541,63,870|respawnMs=-1')


class DetectionTests(Harness):
    def test_a_live_body_is_never_a_death(self):
        self.assertIsNone(check(self.root, lambda: LIVE_LINE, body_name='Kirito'))
        self.assertFalse((self.root / 'deaths').exists())

    def test_a_dead_roster_line_is_archived_once(self):
        facts = check(self.root, lambda: DEAD_LINE, body_name='Kirito')
        self.assertIsNotNone(facts)
        self.assertIn('shot by Pillager', facts['reason'])
        self.assertTrue(list((self.root / 'deaths').glob('*.json')))
        log = (self.root / 'life-log.jsonl').read_text(encoding='utf-8').strip().splitlines()
        self.assertEqual(len(log), 1)
        # reading the same dead state again is not a second death
        self.assertIsNone(check(self.root, lambda: DEAD_LINE, body_name='Kirito'))
        self.assertEqual(len((self.root / 'life-log.jsonl').read_text(encoding='utf-8').strip().splitlines()), 1)

    def test_an_unreadable_roster_is_not_a_death(self):
        check(self.root, lambda: DEAD_LINE, body_name='Kirito')
        self.assertIsNone(check(self.root, lambda: 'No entity was found', body_name='Kirito'))
        self.assertEqual(len(list((self.root / 'deaths').glob('*.json'))), 1)



class RotationTests(Harness):
    def death(self):
        return check(self.root, lambda: DEAD_LINE, body_name='Kirito')

    def test_a_new_life_gets_a_new_session_without_losing_the_binding(self):
        self.death()
        session = take_rotation(self.root, SETTINGS)
        self.assertIsNotNone(session)
        self.assertTrue(session['primarySessionId'].startswith('life-'))
        self.assertNotEqual(session['primarySessionId'], 'life-' + 'a' * 32)
        self.assertIsNone(session['chatId'], 'a new life must re-bind its native chat')
        self.assertEqual(session['previousSessionId'], 'life-' + 'a' * 32)
        self.assertEqual(session['bodyUuid'], SETTINGS['bodyUuid'])

    def test_rotation_happens_once_per_death(self):
        self.death()
        self.assertIsNotNone(take_rotation(self.root, SETTINGS))
        self.assertIsNone(take_rotation(self.root, SETTINGS))
        self.assertIsNone(take_rotation(self.root, SETTINGS))

    def test_no_rotation_without_a_death(self):
        self.assertIsNone(take_rotation(self.root, SETTINGS))

    def test_the_new_life_carries_the_note_exactly_once(self):
        self.death()
        session = take_rotation(self.root, SETTINGS)
        text = pending_note(session, self.root)
        self.assertIsNotNone(text)
        self.assertIn('上一世', text)
        self.assertTrue(consume(session))
        self.assertIsNone(pending_note(session, self.root))
        self.assertFalse(consume(session))

    def test_a_stale_note_is_not_served_for_a_different_death(self):
        self.death()
        session = take_rotation(self.root, SETTINGS)
        session['freshFromDeath'] = 'not-a-real-death'
        self.assertIsNone(pending_note(session, self.root))


if __name__ == '__main__':
    unittest.main()

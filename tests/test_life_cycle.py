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
from life_cycle import (check, collect, consume, latest_death, note, parse_death_count,
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
    def test_the_real_reply_parses(self):
        self.assertEqual(parse_death_count('Kirito has 19 [mcdeaths]'), 19)

    def test_an_unreadable_reply_is_unknown_not_zero(self):
        for raw in (None, '', 'No player was found', 'Kirito has [mcdeaths]',
                    'Unknown scoreboard objective'):
            self.assertIsNone(parse_death_count(raw))


class CollectTests(Harness):
    def test_the_record_carries_the_facts_of_the_life_that_ended(self):
        facts = collect(self.root, 'mcdeaths 18 -> 19', now=1789644195.0)
        self.assertEqual(facts['reason'], 'mcdeaths 18 -> 19')
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


class DetectionTests(Harness):
    def test_first_reading_never_invents_a_death(self):
        self.assertIsNone(check(self.root, lambda: 'Kirito has 19 [mcdeaths]'))
        self.assertFalse((self.root / 'deaths').exists())

    def test_an_increase_is_a_death_and_is_archived(self):
        check(self.root, lambda: 'Kirito has 19 [mcdeaths]')
        facts = check(self.root, lambda: 'Kirito has 21 [mcdeaths]')
        self.assertIsNotNone(facts)
        self.assertEqual(facts['reason'], 'mcdeaths 19 -> 21')
        self.assertTrue(list((self.root / 'deaths').glob('*.json')))
        log = (self.root / 'life-log.jsonl').read_text(encoding='utf-8').strip().splitlines()
        self.assertEqual(len(log), 1)
        self.assertEqual(json.loads(log[0])['reason'], 'mcdeaths 19 -> 21')
        # the death is armed for the next session, not rotated while the body is gone
        state = json.loads((self.root / 'life-cycle.json').read_text(encoding='utf-8'))
        self.assertEqual(state['pendingDeathId'], facts['id'])

    def test_an_unchanged_counter_is_not_a_death(self):
        check(self.root, lambda: 'Kirito has 19 [mcdeaths]')
        self.assertIsNone(check(self.root, lambda: 'Kirito has 19 [mcdeaths]'))

    def test_a_failed_read_does_not_move_the_counter(self):
        check(self.root, lambda: 'Kirito has 19 [mcdeaths]')
        self.assertIsNone(check(self.root, lambda: 'No player was found'))
        self.assertEqual(json.loads((self.root / 'life-cycle.json').read_text(encoding='utf-8'))['lastDeathCount'], 19)
        # and a later real reading still detects the increase
        self.assertIsNotNone(check(self.root, lambda: 'Kirito has 20 [mcdeaths]'))


class RotationTests(Harness):
    def death(self):
        check(self.root, lambda: 'Kirito has 19 [mcdeaths]')
        return check(self.root, lambda: 'Kirito has 20 [mcdeaths]')

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

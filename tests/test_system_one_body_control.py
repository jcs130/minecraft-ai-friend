"""Native reflex facts must survive the fast policy input boundary."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'world/survival'))
from system_one import compact_state


class BodyControlProjectionTests(unittest.TestCase):
    def test_native_reflex_and_sample_identity_reach_fast_policy(self):
        body = {'bodyUuid': 'actor', 'observedAt': 1000, 'bodyControl': {
            'available': True, 'kind': 'reflex', 'name': 'mob_defense',
            'nativeAvoidanceActive': True, 'actorUuid': 'actor',
            'dimension': 'minecraft:overworld', 'observedAt': 999,
            'gameTime': 250, 'bodyTickCount': 70,
            'notice': 'unbounded private text' * 1000}}
        projected = compact_state(body, 'gather wood', None)['body']
        control = projected['bodyControl']
        self.assertEqual(control, {k: v for k, v in body['bodyControl'].items() if k != 'notice'})
        idle = body | {'bodyControl': body['bodyControl'] | {
            'kind': 'idle', 'name': 'none', 'nativeAvoidanceActive': False}}
        self.assertNotEqual(projected, compact_state(idle, 'gather wood', None)['body'])

    def test_unavailable_control_is_unknown_and_values_stay_bounded(self):
        self.assertIsNone(compact_state({}, '', None)['body']['bodyControl'])
        control = compact_state({'bodyControl': {
            'available': False, 'kind': {'raw': 'private'}, 'gameTime': float('nan'),
            'name': 'x' * 10000}}, '', None)['body']['bodyControl']
        self.assertIs(control['available'], False)
        self.assertIsNone(control['kind'])
        self.assertIsNone(control['gameTime'])
        self.assertEqual(len(control['name']), 100)


if __name__ == '__main__':
    unittest.main()

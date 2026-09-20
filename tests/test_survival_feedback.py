"""Action feedback retains useful facts without replaying actions or widening access."""
import copy
import json
from pathlib import Path
import tempfile
import unittest

from test_survival_gateway import MockRcon, BODY_UUID, NOW, TURN
from numen_gateway import NumenGateway, read_json, write_json, receipt_evidence


class ActionFeedbackTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.rcon = MockRcon()
        self.gateway = NumenGateway(self.root, self.rcon, clock=lambda: NOW)
        self.settings = {'schema': 1, 'bodyName': 'Kirito', 'bodyUuid': BODY_UUID,
            'workArea': {'minX': 64, 'maxX': 160, 'minZ': 64, 'maxZ': 160},
            'anchor': {'x': 100, 'z': 100}, 'protectedRadius': 8}
        write_json(self.root / 'settings.json', self.settings)
        write_json(self.root / 'control.json', {'schema': 1, 'enabled': True})
        self.gateway.open_lease(TURN, NOW * 1000 + 120000)

    def test_protected_click_reports_real_boundary_without_dispatch_or_lease_write(self):
        lease = (self.root / 'lease.json').read_bytes()
        result = self.gateway.action(TURN, 'interact_at', {
            'button': 'right', 'x': 100, 'y': 64, 'z': 100, 'hold_ticks': 0})
        self.assertEqual(result['code'], 'protected_area')
        self.assertFalse(result['dispatched'])
        self.assertFalse(result['writePerformed'])
        self.assertFalse(result['retryAutomatically'])
        area = result['areaPreflight']
        self.assertEqual(area['checkedPosition'], self.rcon.position)
        self.assertEqual(area['protectedArea'], {'anchor': {'x': 100, 'z': 100},
            'radius': 8, 'margin': 5, 'horizontalDistance': 0})
        self.assertIn('授权边界', area['instruction'])
        self.assertEqual((self.root / 'lease.json').read_bytes(), lease)
        self.assertFalse(self.rcon.mutations())
        self.assertFalse((self.root / 'unknown.json').exists())
        self.assertFalse((self.root / 'action-receipts').exists())
        self.assertNotIn('PRIVATE', json.dumps(result))

    def test_navigation_target_outside_area_reports_the_rejected_target(self):
        result = self.gateway.action(TURN, 'goto', {'x': 170, 'z': 100})
        self.assertEqual(result['code'], 'outside_work_area')
        self.assertEqual(result['areaPreflight']['checkedPosition'], {'x': 170, 'z': 100})
        self.assertEqual(result['areaPreflight']['workArea'], self.settings['workArea'])
        self.assertFalse(self.rcon.mutations())
        self.assertEqual(read_json(self.root / 'lease.json')['actionsUsed'], 0)

    def test_invalid_lease_never_receives_area_observation(self):
        result = self.gateway.action(TURN + '_wrong', 'interact_at', {
            'button': 'right', 'x': 100, 'y': 64, 'z': 100, 'hold_ticks': 0})
        self.assertEqual(result['code'], 'lease_invalid')
        self.assertNotIn('areaPreflight', result)
        self.assertFalse(self.rcon.calls)

    def test_guild_feedback_preserves_current_target_and_zero_false_values(self):
        contract = {'code': 'claim_refused', 'ok': False, 'questId': '2026-09-20:1',
            'claimContext': {'observedAt': 1789880000000,
                'receptionist': {'key': 'guild_lan', 'position': [-570.7, 71, 886.3],
                    'positionFresh': True, 'dimension': 'minecraft:overworld',
                    'lastKnownPosition': [-529, 67, 903], 'private': 'PRIVATE'},
                'proximity': {'actorPosition': [-529, 67, 903], 'actorDimension': 'minecraft:overworld',
                    'sameDimension': True, 'distance': 45.08, 'maxDistance': 8, 'near': False}}}
        row = {'tool': 'guild_claim', 'args': {'quest_id': '2026-09-20:1'},
            'result': {'code': 'action_rejected', 'result': {'message': 'too far', 'data': {'receipt': contract}}},
            'before': {'counts': {'private:item': 42}}}
        original = copy.deepcopy(row)
        result = receipt_evidence(row)
        self.assertEqual(result['requested'], {'quest_id': '2026-09-20:1'})
        self.assertFalse(result['guild']['ok'])
        self.assertEqual(result['guild']['claimContext']['receptionist']['position'], [-570.7, 71, 886.3])
        self.assertFalse(result['guild']['claimContext']['proximity']['near'])
        self.assertNotIn('lastKnownPosition', json.dumps(result))
        self.assertNotIn('PRIVATE', json.dumps(result))
        self.assertNotIn('private:item', json.dumps(result))
        self.assertEqual(row, original)
        contract['claimContext']['proximity']['distance'] = 0
        self.assertEqual(receipt_evidence(row)['guild']['claimContext']['proximity']['distance'], 0)
        contract['claimContext']['receptionist']['position'] = None
        contract['claimContext']['receptionist']['positionFresh'] = False
        self.assertIsNone(receipt_evidence(row)['guild']['claimContext']['receptionist']['position'])
        contract['questId'] = '2026-09-20:2'
        self.assertNotIn('guild', receipt_evidence(row))


if __name__ == '__main__':
    unittest.main()

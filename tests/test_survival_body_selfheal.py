"""Body-loss pauses keep the restore channel open and auto-resume on success."""
import json, os, sys, tempfile, time, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'world/survival'))
from unittest.mock import MagicMock

import body_reconnect

SETTINGS = {'bodyName': 'Kirito', 'bodyUuid': 'd4ac9523-4962-43ed-98c5-19b49e104048',
            'ownerUuid': 'e5005711-be9f-44b7-aaad-6993c0ba5df4'}
ROSTER_ONLINE = 'count=1\nKirito|uuid=d4ac9523-4962-43ed-98c5-19b49e104048|owner=e5005711-be9f-44b7-aaad-6993c0ba5df4|dim=minecraft:overworld|pos=-542,63,869'
ROSTER_OFFLINE = 'count=0'


class Harness:
    def __init__(self, control, roster):
        self.root = Path(tempfile.mkdtemp())
        (self.root / 'control.json').write_text(json.dumps(control), encoding='utf-8')
        (self.root / 'controller.json').write_text('{}', encoding='utf-8')
        self.roster = roster
        self.gateway = MagicMock()
        self.gateway.state = self.root
        self.gateway.rcon.cmd = self._cmd
        self.reconnect = body_reconnect.BodyReconnect(self.gateway, clock=lambda: 1000.0)

    def _cmd(self, command):
        if command == 'numen_act list':
            return self.roster
        raise AssertionError('unexpected command ' + command)


class BodyLossSelfHealTests(unittest.TestCase):
    def test_body_lost_pause_keeps_restore_channel_open(self):
        harness = Harness({'enabled': False, 'pauseReason': 'body_lost_during_decision'}, ROSTER_ONLINE)
        state = harness.reconnect.tick(SETTINGS)
        self.assertEqual(state['status'], 'online')
        control = json.loads((harness.root / 'control.json').read_text(encoding='utf-8'))
        self.assertTrue(control['enabled'])
        self.assertIsNone(control['pauseReason'])
        self.assertEqual(control['autoResumeReason'], 'body_restored')

    def test_body_dead_pause_also_self_heals(self):
        harness = Harness({'enabled': False, 'pauseReason': 'body_dead'}, ROSTER_ONLINE)
        state = harness.reconnect.tick(SETTINGS)
        self.assertEqual(state['status'], 'online')
        control = json.loads((harness.root / 'control.json').read_text(encoding='utf-8'))
        self.assertTrue(control['enabled'])

    def test_operator_pause_still_blocks(self):
        harness = Harness({'enabled': False, 'pauseReason': 'operator_stop'}, ROSTER_ONLINE)
        state = harness.reconnect.tick(SETTINGS)
        self.assertEqual(state['status'], 'waiting')
        self.assertEqual(state['reason'], 'restore_not_authorized')
        control = json.loads((harness.root / 'control.json').read_text(encoding='utf-8'))
        self.assertFalse(control['enabled'])

    def test_unknown_marker_blocks_even_for_body_pause(self):
        harness = Harness({'enabled': False, 'pauseReason': 'body_lost_during_decision'}, ROSTER_ONLINE)
        (harness.root / 'unknown.json').write_text('{}', encoding='utf-8')
        state = harness.reconnect.tick(SETTINGS)
        self.assertEqual(state['status'], 'waiting')
        self.assertEqual(state['reason'], 'restore_not_authorized')


if __name__ == '__main__':
    unittest.main()

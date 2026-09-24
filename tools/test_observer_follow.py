"""Regression for the server's same-target /spectate success without a reset."""

import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from observer_follow import attach, sample


class StaleCameraRcon:
    def __init__(self):
        self.target = (-70.0, 60.0, 864.0)
        self.observer = (-46.0, 60.0, 864.0)
        self.camera = 'Kirito'
        self.commands = []

    def cmd(self, command):
        self.commands.append(command)
        if command.startswith('data get entity '):
            _, _, _, name, field = command.split()
            value = self.observer if name == 'ag_observer' else self.target
            if field == 'Pos':
                result = '[' + ', '.join(str(number) + 'd' for number in value) + ']'
            elif field == 'Dimension':
                result = '"minecraft:overworld"'
            elif field == 'playerGameType':
                result = '3'
            else:
                raise AssertionError(command)
            return name + ' has the following entity data: ' + result
        if command == 'execute as ag_observer run spectate stop':
            self.camera = None
            return ''
        if command == 'spectate Kirito ag_observer':
            # The observed failure: a success message need not reset a stale
            # server camera whose target is already Kirito.
            if self.camera is None:
                self.observer = self.target
            self.camera = 'Kirito'
            return 'Now spectating Kirito'
        raise AssertionError(command)


class ObserverFollowTest(unittest.TestCase):
    def test_success_message_alone_does_not_prove_following(self):
        server = StaleCameraRcon()
        self.assertEqual(server.cmd('spectate Kirito ag_observer'), 'Now spectating Kirito')
        self.assertEqual(sample(server)['distance'], 24.0)
        self.assertEqual(attach(server), 'Now spectating Kirito')
        self.assertEqual(sample(server)['distance'], 0.0)
        self.assertLess(server.commands.index('execute as ag_observer run spectate stop'),
                        len(server.commands) - 1 - server.commands[::-1].index('spectate Kirito ag_observer'))


if __name__ == '__main__':
    unittest.main()

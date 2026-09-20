"""Counter reads distinguish a known empty score from unavailable evidence."""
import ast
from pathlib import Path
import re
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

ROOT = Path(__file__).resolve().parents[1]


class HuntScoreTests(unittest.TestCase):
    def setUp(self):
        source = ROOT / 'world/sidecar/mc_guild.py'
        tree = ast.parse(source.read_text('utf-8-sig'))
        # Import only this existing boundary; importing mc_npc starts real IO.
        nodes = [n for n in tree.body if
                 isinstance(n, ast.FunctionDef) and n.name == 'hunt_score' or
                 isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'HUNT_MOBS' for t in n.targets)]
        self.command = Mock()
        namespace = {'re': re, 'N': SimpleNamespace(R=SimpleNamespace(cmd=self.command))}
        exec(compile(ast.Module(body=nodes, type_ignores=[]), str(source), 'exec'), namespace)
        self.score = namespace['hunt_score']

    def test_native_empty_and_existing_score_are_valid_baselines(self):
        for reply, expected in [("Can't get value of killed_zombie for Kirito; none is set", 0),
                                ('Kirito has 12 [killed_zombie]', 12)]:
            self.command.side_effect = ['An objective already exists by that name', reply]
            self.assertEqual(self.score('Kirito', 'zombie'), expected)

    def test_bad_criterion_missing_objective_or_transport_never_invent_zero(self):
        for reply in ["Unknown scoreboard objective 'killed_zombie'", '', TimeoutError('fixture')]:
            self.command.side_effect = ['Unknown criterion', reply]
            self.assertIsNone(self.score('Kirito', 'zombie'))


if __name__ == '__main__':
    unittest.main()

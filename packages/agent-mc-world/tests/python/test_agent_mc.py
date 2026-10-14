"""Offline contract tests: no Minecraft, host framework, network or model required."""
import importlib.util
import pathlib
import sys
import types
import unittest
from unittest.mock import patch

path = pathlib.Path(__file__).parents[2] / "skills/java-client/agent_mc.py"
spec = importlib.util.spec_from_file_location("agent_mc", path)
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


class BlockHelpers(unittest.TestCase):
    def setUp(self):
        self.calls = []
        def blocks(points):
            self.calls.append(points)
            return ["minecraft:carrots[age=7]" for _ in points]
        self.api = types.SimpleNamespace(getblocklist=blocks, player_position=lambda: [-0.1, 66.9, -461.3])
        self.patch = patch.dict(sys.modules, minescript=self.api)
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def test_batch_reduces_crossings_and_keeps_absolute_negative_positions_and_properties(self):
        result = helper.scan_nearby(names=["minecraft:carrots"], limit=2)
        self.assertEqual([256, 256, 256, 77], list(map(len, self.calls)))
        self.assertEqual([-7, 64, -468], result["minimum"])
        self.assertEqual(845, result["checked"])
        self.assertEqual(845, result["count"])
        self.assertEqual("7", result["matches"][0]["properties"]["age"])
        self.assertTrue(result["truncated"])
        self.assertFalse(result["serverConfirmed"])

    def test_invalid_or_excessive_requests_never_read_game(self):
        for run in [lambda: helper.scan_nearby(radius=16), lambda: helper.scan_blocks([0,0,0],[20,20,20]),
                    lambda: helper.sample_blocks([[0.2,0,0]]), lambda: helper.scan_blocks([0,0,0],[1,1,1],names="carrots")]:
            with self.assertRaises(ValueError): run()
        self.assertEqual([], self.calls)

    def test_incomplete_or_unloaded_results_are_not_reported_as_known_air(self):
        self.api.getblocklist = lambda points: []
        with self.assertRaisesRegex(RuntimeError, "Incomplete"): helper.sample_blocks([[0,0,0]])
        self.api.getblocklist = lambda points: ["minecraft:void_air"]
        result = helper.scan_blocks([0,0,0],[0,0,0])
        self.assertEqual(1, result["unknownCount"])
        self.assertEqual("void_or_unloaded", result["matches"][0]["observation"])

    def test_wait_is_bounded_and_uses_python_without_minecraft_rpc(self):
        with patch.object(helper.time, "sleep") as sleep:
            helper.wait(0.25)
            sleep.assert_called_once_with(0.25)
            for value in [-1, 6, float("nan"), True]:
                with self.assertRaises(ValueError): helper.wait(value)
        self.assertEqual([], self.calls)

    def test_discovery_returns_exact_signatures_and_output_shape_without_game_reads(self):
        self.assertIn("scan_blocks", helper.help()["functions"])
        page = helper.help("scan_blocks")
        self.assertIn("minimum, maximum", page["signature"])
        self.assertEqual([-414,120,-483], page["match"]["position"])
        self.assertIn("position", page["note"])
        with self.assertRaises(ValueError): helper.help("block_at")
        self.assertEqual([], self.calls)


if __name__ == "__main__": unittest.main()

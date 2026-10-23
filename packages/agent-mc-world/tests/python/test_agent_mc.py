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


class Interactions(unittest.TestCase):
    def setUp(self):
        self.keys=[]
        self.looks=[]
        self.blocks=iter(['minecraft:carrots[age=7]','minecraft:air'])
        self.hit=types.SimpleNamespace(position=[-1,65,-2],distance=3.0,side='up',type='minecraft:carrots')
        self.api=types.SimpleNamespace(screen_name=lambda:None,getblock=lambda *p:next(self.blocks),
            player_look_at=lambda *p:self.looks.append(p),flush=lambda:None,
            player_get_targeted_block=lambda distance:self.hit,
            player_press_attack=lambda pressed:self.keys.append(('attack',pressed)),
            player_press_use=lambda pressed:self.keys.append(('use',pressed)))
        self.patch=patch.dict(sys.modules,minescript=self.api);self.patch.start();self.addCleanup(self.patch.stop)
        self.sleep=patch.object(helper.time,'sleep');self.sleep.start();self.addCleanup(self.sleep.stop)

    def test_rejects_occlusion_and_out_of_bound_without_pressing_keys(self):
        self.hit.position=[0,65,-2]
        result=helper.interact_block([-1,65,-2])
        self.assertFalse(result['inputDispatched']);self.assertEqual('blocked',result['outcome'])
        self.assertEqual([0,65,-2],result['hit']['position']);self.assertEqual([],self.keys)

    def test_reports_actual_changed_block_without_claiming_server_goal_completion(self):
        result=helper.interact_block([-1,65,-2])
        self.assertEqual([('attack',True),('attack',False)],self.keys)
        self.assertEqual('observed_change',result['outcome']);self.assertFalse(result['serverConfirmed'])
        self.assertEqual('minecraft:carrots[age=7]',result['before']['raw']);self.assertEqual('minecraft:air',result['after']['raw'])
        self.assertEqual([(-0.5,65.5,-1.5)],self.looks)

    def test_uses_the_use_key_and_reports_unchanged_instead_of_success(self):
        self.blocks=iter(['minecraft:farmland[moisture=7]']*2)
        result=helper.interact_block([-1,65,-2],action='use',hold=.15,aim_offset=[.5,.9,.5])
        self.assertEqual([('use',True),('use',False)],self.keys)
        self.assertEqual('no_observed_change',result['outcome']);self.assertFalse(result['observedChanged'])

    def test_observes_selected_placement_space_without_confusing_support_with_effect(self):
        self.blocks=iter(['minecraft:farmland[moisture=7]']*2)
        observations=iter([['minecraft:air'],['minecraft:carrots[age=0]']])
        self.api.getblocklist=lambda positions:next(observations)
        result=helper.interact_block([-1,65,-2],action='use',observe_positions=[[-1,66,-2]])
        self.assertEqual(result['before']['raw'],result['after']['raw'])
        self.assertTrue(result['observedChanged']);self.assertFalse(result['serverConfirmed'])
        self.assertEqual('minecraft:carrots',result['observedAfter'][0]['name'])

    def test_releases_the_key_even_when_the_hold_fails(self):
        with patch.object(helper.time,'sleep',side_effect=[None,RuntimeError('cancelled')]):
            with self.assertRaisesRegex(RuntimeError,'cancelled'):helper.interact_block([-1,65,-2])
        self.assertEqual([('attack',True),('attack',False)],self.keys)

    def test_invalid_input_and_open_gui_never_press_keys(self):
        for kwargs in [{'hold':5},{'action':'right'},{'aim_offset':[.5,float('nan'),.5]}]:
            with self.assertRaises(ValueError):helper.interact_block([-1,65,-2],**kwargs)
        self.api.screen_name=lambda:'Inventory'
        self.assertIn('gui_open',helper.interact_block([-1,65,-2])['reason'])
        self.assertEqual([],self.keys);self.assertEqual([],self.looks)

    def test_missing_or_excessive_hit_distance_never_presses_keys(self):
        for hit in (None, types.SimpleNamespace(position=[-1,65,-2],distance=5.0,side='up',type='minecraft:carrots')):
            self.blocks=iter(['minecraft:carrots[age=7]']);self.hit=hit
            result=helper.interact_block([-1,65,-2])
            self.assertEqual('blocked',result['outcome']);self.assertFalse(result['inputDispatched'])
        self.assertEqual([],self.keys)


if __name__ == "__main__": unittest.main()

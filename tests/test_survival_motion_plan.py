"""One durable multi-waypoint job, with Jev bound to each surveyed segment."""
import copy
import asyncio
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/survival'))

from mcp_server import SkillTools, TOOL_NAMES, make_server
from motor_mailbox import open_cognition, view
from navigation_program import SOURCE, bind_motion_choice, motion_record
from numen_gateway import read_json, write_json
from skill_library import SkillLibrary, evaluate


class MotionProgramTests(unittest.TestCase):
    def setUp(self):
        self.record = motion_record()
        self.state = copy.deepcopy(self.record['fixtures'][0]['state'])
        self.memory = copy.deepcopy(self.record['fixtures'][0]['memory'])

    def test_starter_fixtures_are_tested(self):
        with tempfile.TemporaryDirectory() as folder:
            library = SkillLibrary(Path(folder) / 'skills')
            drafted = library.draft(**self.record)
            report = library.test(self.record['name'], drafted['version'])
            self.assertTrue(report['passed'], report['cases'])

    def test_survey_candidates_are_bound_and_judge_can_correct_segment(self):
        fixture = self.record['fixtures'][1]
        result = evaluate(SOURCE, fixture['state'], fixture['memory'])
        self.assertIsNone(result['action'])
        self.assertEqual(result['memory']['stage'], 'selecting')
        options = result['choose']['candidates']
        self.assertEqual([row['id'] for row in options], ['path_0', 'path_1', 'replan'])
        self.assertEqual([row['action']['args']['x'] for row in options[:2]], [116, 112])
        alternative = options[1]['action']
        selected = bind_motion_choice(result, alternative)
        self.assertEqual(selected['action'], alternative)
        self.assertEqual(selected['memory']['segment'], alternative['args'])
        self.assertEqual(selected['memory']['stage'], 'moving')
        self.assertEqual(result['memory']['stage'], 'selecting')
        for false_choice in (None, {'tool': 'goto', 'args': {'x': 119, 'y': 64, 'z': 100}},
                             {'tool': 'eat', 'args': {'item_id': 'minecraft:bread'}}):
            with self.subTest(false_choice=false_choice):
                with self.assertRaisesRegex(ValueError, 'motion_policy_choice_unbound'):
                    bind_motion_choice(result, false_choice)

    def test_near_identical_supported_stances_do_not_split_jev_vote(self):
        fixture = self.record['fixtures'][5]
        result = evaluate(SOURCE, fixture['state'], fixture['memory'])
        options = result['choose']['candidates']
        self.assertEqual([row['id'] for row in options], ['path_0', 'replan'])
        self.assertEqual(options[0]['action']['args'], {'x': 116.5, 'y': 64, 'z': 100.5})
        higher = copy.deepcopy(fixture['state'])
        higher['execution']['observation']['result']['navigationSense']['destination']['candidates'].append(
            {'x': 115.5, 'y': 65, 'z': 100.5})
        options = evaluate(SOURCE, higher, fixture['memory'])['choose']['candidates']
        self.assertEqual([row['id'] for row in options], ['path_0', 'path_1', 'replan'])

    def test_blocked_forward_probe_offers_bounded_lateral_step(self):
        state = copy.deepcopy(self.record['fixtures'][1]['state'])
        direct = {'x': 104, 'y': 64, 'z': 100}
        observation = state['execution']['observation']
        observation['args'] = direct
        destination = observation['result']['navigationSense']['destination']
        destination.update(requested=direct, requestedStanceSupported=False, candidates=[])
        memory = self.memory | {'index': 0, 'target': self.memory['waypoints'][0],
                                'stage': 'survey', 'probe': direct,
                                'probeSpan': 4, 'probeAttempt': 2}
        left = evaluate(SOURCE, state, memory)
        self.assertEqual(left['observe']['args'], {'x': 100, 'y': 64, 'z': 106})
        self.assertEqual(left['memory']['stage'], 'detour_left')
        lateral_state = copy.deepcopy(state)
        lateral_state['execution']['observation']['args'] = left['observe']['args']
        lateral_destination = lateral_state['execution']['observation']['result']['navigationSense']['destination']
        lateral_destination.update(requested=left['observe']['args'], requestedStanceSupported=True)
        offered = evaluate(SOURCE, lateral_state, left['memory'])
        self.assertEqual(offered['choose']['candidates'][0]['action']['args'], left['observe']['args'])
        selected = bind_motion_choice(offered, offered['choose']['candidates'][0]['action'])
        moved = copy.deepcopy(self.state)
        moved['position'] = left['observe']['args']
        moved['execution'] = {'lastExecution': {'status': 'succeeded', 'completionConfirmed': True,
            'tool': 'goto', 'actionId': 'detour-action', 'turnId': 'detour-turn'},
            'expectedAction': {'tool': 'goto', 'args': left['observe']['args'],
                'actionId': 'detour-action', 'turnId': 'detour-turn'}}
        continued = evaluate(SOURCE, moved, selected['memory'])
        self.assertEqual(continued['observe']['tool'], 'navigation_sense')
        self.assertEqual(continued['memory']['detours'], 1)

    def test_both_lateral_probes_without_support_replan(self):
        state = copy.deepcopy(self.record['fixtures'][1]['state'])
        left_probe = {'x': 100, 'y': 64, 'z': 106}
        observation = state['execution']['observation']
        observation['args'] = left_probe
        destination = observation['result']['navigationSense']['destination']
        destination.update(requested=left_probe, requestedStanceSupported=False, candidates=[])
        memory = self.memory | {'index': 0, 'target': self.memory['waypoints'][0],
                                'stage': 'detour_left', 'probe': left_probe}
        right = evaluate(SOURCE, state, memory)
        self.assertEqual(right['observe']['args'], {'x': 100, 'y': 64, 'z': 94})
        observation['args'] = right['observe']['args']
        destination['requested'] = right['observe']['args']
        terminal = evaluate(SOURCE, state, right['memory'])
        self.assertTrue(terminal['replan'])
        self.assertEqual(terminal['reason'], 'navigation_no_supported_progress')

    def test_detour_budget_and_fresh_survey_boundaries(self):
        fixture = self.record['fixtures'][2]
        exhausted = copy.deepcopy(fixture['memory'])
        exhausted['detours'] = 2
        result = evaluate(SOURCE, fixture['state'], exhausted)
        self.assertTrue(result['replan'])
        self.assertEqual(result['reason'], 'navigation_no_supported_progress')
        lateral = self.record['fixtures'][3]
        stale = copy.deepcopy(lateral['state'])
        stale['execution']['observation']['fresh'] = False
        result = evaluate(SOURCE, stale, lateral['memory'])
        self.assertTrue(result['replan'])
        self.assertNotIn('choose', result)

    def test_lateral_probe_stays_inside_work_area(self):
        state = copy.deepcopy(self.record['fixtures'][2]['state'])
        state['position']['z'] = 155
        state['execution']['observation']['result']['navigationSense']['position']['z'] = 155
        direct = {'x': 104, 'y': 64, 'z': 155}
        state['execution']['observation']['args'] = direct
        state['execution']['observation']['result']['navigationSense']['destination']['requested'] = direct
        memory = {'policy': True, 'waypoints': [{'x': 130, 'z': 155}, {'x': 145, 'z': 155}],
                  'stage': 'survey', 'probe': direct, 'probeSpan': 4, 'probeAttempt': 2}
        result = evaluate(SOURCE, state, memory)
        self.assertEqual(result['memory']['stage'], 'detour_right')
        self.assertEqual(result['observe']['args'], {'x': 100, 'y': 64, 'z': 149})

    def test_confirmed_first_waypoint_advances_to_second_without_model(self):
        position = {'x': 130, 'y': 64, 'z': 100}
        state = copy.deepcopy(self.state)
        state['position'] = position
        state['execution'] = {'observedAt': 1000250, 'observation': {
            'tool': 'navigation_sense', 'args': position, 'fresh': True, 'ageMs': 250,
            'result': {'ok': True, 'navigationSense': {'ok': True,
                'actorUuid': state['bodyUuid'], 'dimension': state['dimension'],
                'position': position, 'observedAt': 1000000,
                'destination': {'available': True, 'requested': position, 'pathVerified': False,
                    'requestedStanceClear': True, 'requestedStanceSupported': True,
                    'candidates': []}}}}}
        memory = self.memory | {'target': self.memory['waypoints'][0], 'index': 0,
                                'stage': 'arrival_survey', 'probe': position}
        result = evaluate(SOURCE, state, memory)
        self.assertFalse(result['done'])
        self.assertEqual(result['memory']['index'], 1)
        self.assertEqual(result['memory']['target'], self.memory['waypoints'][1])
        self.assertEqual(result['observe']['tool'], 'navigation_sense')
        self.assertEqual(result['observe']['args'], {'x': 145, 'y': 64, 'z': 105})

    def test_bad_waypoint_and_unsupported_ground_never_dispatch(self):
        bad = copy.deepcopy(self.memory)
        bad['waypoints'][1]['x'] = 200
        self.assertTrue(evaluate(SOURCE, self.state, bad)['replan'])
        fixture = self.record['fixtures'][1]
        unsafe = copy.deepcopy(fixture['state'])
        destination = unsafe['execution']['observation']['result']['navigationSense']['destination']
        destination['requestedStanceSupported'] = False
        destination['candidates'] = []
        result = evaluate(SOURCE, unsafe, fixture['memory'])
        self.assertIsNone(result['action'])
        self.assertNotIn('choose', result)


class MotionAdmissionTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.now = 1800000000
        self.clock = lambda: self.now
        self.turn = 'motion_plan_fixture_123'
        self.area = {'minX': 64, 'maxX': 160, 'minZ': 64, 'maxZ': 160}
        write_json(self.root / 'settings.json', {'asyncMotor': True, 'workArea': self.area})
        write_json(self.root / 'control.json', {'schema': 1, 'enabled': True})
        self.library = SkillLibrary(self.root / 'skills')
        drafted = self.library.draft(**motion_record())
        self.version = drafted['version']
        self.assertTrue(self.library.test('base_motion_plan', self.version)['passed'])
        self.library.promote('base_motion_plan', self.version)
        self.tools = SkillTools(self.root, self.library, self.clock)
        open_cognition(self.root, self.turn, self.now * 1000 + 60000, self.clock)
        self.points = [{'x': 100, 'z': 100}, {'x': 140, 'z': 110}]

    def test_one_queue_command_carries_all_waypoints_and_is_idempotent(self):
        result = self.tools.navigate_plan(self.turn, self.points, summary='Walk through two observed places')
        self.assertEqual(result['code'], 'motor_queued')
        self.assertEqual(result['name'], 'base_motion_plan')
        self.assertFalse(result['executionConfirmed'])
        self.assertEqual(result['turnCompletion']['summary'], 'Walk through two observed places')
        again = self.tools.navigate_plan(self.turn, self.points, summary='Walk through two observed places')
        self.assertEqual(result['requestId'], again['requestId'])
        rows = view(self.root)['requests']
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['payload']['memory'], {'policy': True, 'waypoints': self.points})
        self.assertEqual(read_json(self.root / 'cognition-lease.json')['actionsUsed'], 1)

    def test_invalid_plan_is_rejected_before_admission(self):
        for points in ([], [self.points[0]], self.points * 4,
                       [{'x': True, 'z': 100}, self.points[1]],
                       [{'x': float('nan'), 'z': 100}, self.points[1]],
                       [{'x': 100, 'z': 100, 'foo': 1}, self.points[1]],
                       [{'x': 200, 'z': 100}, self.points[1]]):
            with self.subTest(points=points):
                result = self.tools.navigate_plan(self.turn, points)
                self.assertFalse(result['ok'])
                self.assertEqual(view(self.root)['requests'], [])

    def test_mcp_exposes_one_typed_plan_call(self):
        async def check():
            server = make_server(SimpleNamespace(state=self.root, clock=self.clock), self.tools)
            schema = next(row for row in await server.list_tools() if row.name == 'navigate_plan')
            self.assertIn('navigate_plan', TOOL_NAMES)
            self.assertEqual(set(schema.inputSchema['required']), {'turn_id', 'waypoints'})
            self.assertNotIn('version', schema.inputSchema['properties'])
            await server.call_tool('navigate_plan', {'turn_id': self.turn,
                'waypoints': self.points, 'summary': 'Walk through two places'})
            self.assertEqual(view(self.root)['requests'][0]['payload']['name'], 'base_motion_plan')
        asyncio.run(check())

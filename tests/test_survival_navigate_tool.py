"""Navigate delegates to real skill admission; never dispatches world actions."""
import asyncio
import copy
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/survival'))
from mcp_server import BODY_ACTION_TOOLS, TOOL_NAMES, SkillTools, make_server
from motor_mailbox import open_cognition, view
from numen_gateway import action_lock, read_json, write_json
from skill_library import SkillLibrary

TURN = 'turn_navigation_fixture_123'
SOURCE = 'function next(s,m){return {action:null,memory:m,done:true};}'
FIXTURES = [{'state': {}, 'memory': {'case': i}, 'expectedActionTool': None,
             'done': True, 'expectedMemory': {'case': i}} for i in (1, 2)]


class NavigateToolTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.state = Path(temp.name)
        self.now = 1800000000
        self.clock = lambda: self.now
        self.area = {'minX': -500, 'maxX': 100, 'minZ': -50, 'maxZ': 500}
        self.settings = {'asyncMotor': False, 'workArea': self.area}
        self.lease = {'schema': 1, 'turnId': TURN, 'expiresAt': self.now * 1000 + 60000,
                      'status': 'open', 'actionsUsed': 0, 'actionLimit': 1}
        write_json(self.state / 'control.json', {'schema': 1, 'enabled': True})
        write_json(self.state / 'settings.json', self.settings)
        write_json(self.state / 'lease.json', self.lease)
        self.library = SkillLibrary(self.state / 'skills')
        self.version = self.library.draft('base_navigate', SOURCE, FIXTURES)['version']
        self.assertTrue(self.library.test('base_navigate', self.version)['passed'])
        self.library.promote('base_navigate', self.version)
        self.tools = SkillTools(self.state, self.library, self.clock)
        self.run = patch.object(self.library, 'run', side_effect=AssertionError('world execution forbidden'))
        self.run.start()
        self.addCleanup(self.run.stop)

    def queued(self):
        self.settings['asyncMotor'] = True
        write_json(self.state / 'settings.json', self.settings)
        open_cognition(self.state, TURN, self.now * 1000 + 60000, self.clock)

    def assert_no_admission(self):
        self.assertFalse((self.state / 'skill-job.json').exists())
        self.assertEqual(view(self.state)['requests'], [])
        self.assertEqual(read_json(self.state / 'lease.json'), self.lease)

    def test_real_direct_start_pins_catalog_version_and_does_not_invent_y(self):
        result = self.tools.navigate(TURN, x=-300.5, z=400, summary='Walk to the observed destination')
        self.assertTrue(result['ok'], result)
        self.assertEqual(result['code'], 'skill_queued')
        job = read_json(self.state / 'skill-job.json')
        self.assertEqual(job['memory'], {'target': {'x': -300.5, 'z': 400}})
        self.assertEqual((job['name'], job['version'], job['maxSteps']), ('base_navigate', self.version, 32))
        self.assertEqual(result['turnCompletion']['summary'], 'Walk to the observed destination')
        self.assertFalse(result['executionConfirmed'])
        self.assertEqual(read_json(self.state / 'lease.json')['status'], 'closed')

    def test_real_queued_start_preserves_existing_job_and_deduplicates(self):
        self.queued()
        job = {'schema': 1, 'status': 'running', 'name': 'another_program', 'opaque': 'keep'}
        write_json(self.state / 'skill-job.json', job)
        result = self.tools.navigate(TURN, x=-200, z=250, y=70, max_steps=12, summary='Continue walking')
        self.assertEqual(result['code'], 'motor_queued')
        again = self.tools.navigate(TURN, x=-200, z=250, y=70, max_steps=12, summary='Continue walking')
        self.assertEqual(again['requestId'], result['requestId'])
        self.assertEqual(read_json(self.state / 'skill-job.json'), job)
        rows = view(self.state)['requests']
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['kind'], 'skill')
        self.assertEqual(rows[0]['payload']['memory'], {'target': {'x': -200, 'z': 250, 'y': 70}})
        self.assertEqual(rows[0]['payload']['version'], self.version)
        self.assertEqual(read_json(self.state / 'cognition-lease.json')['actionsUsed'], 1)

    def test_return_mode_never_invents_coordinates(self):
        self.queued()
        result = self.tools.navigate(TURN, mode='return_to_work_area')
        self.assertTrue(result['ok'], result)
        self.assertEqual(view(self.state)['requests'][0]['payload']['memory'], {'mode': 'return_to_work_area'})

    def test_invalid_coordinates_modes_and_outside_area_never_queue(self):
        cases = [({}, 'invalid_navigation_target'), ({'x': 1}, 'invalid_navigation_target'),
                 ({'x': True, 'z': 2}, 'invalid_navigation_target'),
                 ({'x': float('nan'), 'z': 2}, 'invalid_navigation_target'),
                 ({'x': 1, 'z': float('inf')}, 'invalid_navigation_target'),
                 ({'x': 1, 'z': 2, 'y': False}, 'invalid_navigation_target'),
                 ({'x': 1, 'z': 2, 'y': float('inf')}, 'invalid_navigation_target'),
                 ({'x': 101, 'z': 2}, 'outside_work_area'),
                 ({'x': 1, 'z': -51}, 'outside_work_area'),
                 ({'mode': 'teleport'}, 'invalid_navigation_mode'),
                 ({'mode': 'return_to_work_area', 'x': 0}, 'invalid_navigation_target'),
                 ({'mode': 'return_to_work_area', 'y': 0}, 'invalid_navigation_target')]
        for args, code in cases:
            with self.subTest(args=args):
                result = self.tools.navigate(TURN, **args)
                self.assertEqual(result['code'], code)
                self.assert_no_admission()

    def test_missing_or_malformed_area_never_widens_authority(self):
        for area in (None, {}, {'minX': 0, 'maxX': 1}, self.area | {'maxZ': float('inf')},
                     self.area | {'minX': 200}, self.area | {'minZ': True},
                     self.area | {'maxX': -500}, self.area | {'maxX': -498},
                     self.area | {'maxZ': -47}):
            with self.subTest(area=area):
                # Simulate a corrupt/legacy file that the normal writer refuses.
                (self.state / 'settings.json').write_text(json.dumps({'workArea': area}), encoding='utf8')
                for args in ({'x': 1, 'z': 1}, {'mode': 'return_to_work_area'}):
                    result = self.tools.navigate(TURN, **args)
                    self.assertEqual(result['code'], 'navigation_work_area_unavailable')
                    self.assert_no_admission()

    def test_catalog_missing_unpromoted_unknown_stale_or_bad_version_is_rejected(self):
        current = self.library.catalog()
        for alter in ('missing', 'draft', 'unknown', 'stale', 'version', 'duplicate'):
            catalog = copy.deepcopy(current)
            row = catalog['skills'][0]
            if alter == 'missing': catalog['skills'] = []
            elif alter == 'draft': row['activeVersion'] = None
            elif alter == 'version': row['activeVersion'] = 'not-a-version'
            elif alter == 'duplicate': catalog['skills'].append(copy.deepcopy(row))
            else: row['testEligibility'] = {'status': alter}
            with self.subTest(alter=alter), patch.object(self.library, 'catalog', return_value=catalog):
                result = self.tools.navigate(TURN, x=1, z=2)
                self.assertFalse(result['ok'])
                self.assert_no_admission()

    def test_current_index_does_not_bypass_exact_test_report(self):
        report = self.state / 'skills/base_navigate/reports' / (self.version + '.json')
        value = read_json(report)
        write_json(report, value | {'kernelVersion': 'stale_kernel'})
        self.assertEqual(self.library.catalog()['skills'][0]['testEligibility']['status'], 'current')
        result = self.tools.navigate(TURN, x=1, z=2)
        self.assertEqual(result['code'], 'matching_passed_tests_required')
        self.assert_no_admission()

    def test_current_index_does_not_bypass_exact_promotion(self):
        actual = self.library.read
        with patch.object(self.library, 'read', side_effect=lambda *a: actual(*a) | {'promoted': False}):
            self.assertEqual(self.tools.navigate(TURN, x=1, z=2)['code'], 'skill_not_promoted')
        self.assert_no_admission()

    def test_expired_foreign_closed_and_unknown_lease_fail_before_catalog(self):
        for change, code in (({'expiresAt': self.now * 1000}, 'lease_invalid'),
                             ({'status': 'closed'}, 'lease_invalid'),
                             ({'turnId': 'turn_other_12345'}, 'lease_invalid')):
            write_json(self.state / 'lease.json', self.lease | change)
            with patch.object(self.library, 'catalog', side_effect=AssertionError('unauthorized discovery')):
                self.assertEqual(self.tools.navigate(TURN, x=1, z=2)['code'], code)
        write_json(self.state / 'lease.json', self.lease)
        write_json(self.state / 'unknown.json', {'actionId': 'unknown-original'})
        with patch.object(self.library, 'catalog', side_effect=AssertionError('unknown discovery')):
            self.assertEqual(self.tools.navigate(TURN, x=1, z=2)['code'], 'outcome_unknown')
        self.assert_no_admission()

    def test_lock_is_released_before_start_and_authority_is_rechecked(self):
        start = self.tools.start
        def expire(*args, **kwargs):
            with action_lock(self.state):
                self.now += 61
            return start(*args, **kwargs)
        with patch.object(self.tools, 'start', side_effect=expire):
            self.assertEqual(self.tools.navigate(TURN, x=1, z=2)['code'], 'lease_invalid')
        self.assert_no_admission()

    def test_existing_direct_job_budget_and_summary_guards_remain(self):
        for kwargs, code in (({'max_steps': 33}, 'invalid_step_limit'),
                             ({'summary': ' '}, 'invalid_skill_start_summary')):
            self.assertEqual(self.tools.navigate(TURN, x=1, z=2, **kwargs)['code'], code)
            self.assert_no_admission()
        job = {'schema': 1, 'status': 'running', 'name': 'existing'}
        write_json(self.state / 'skill-job.json', job)
        self.assertEqual(self.tools.navigate(TURN, x=1, z=2)['code'], 'skill_job_already_active')
        self.assertEqual(read_json(self.state / 'skill-job.json'), job)
        self.assertEqual(read_json(self.state / 'lease.json'), self.lease)

    def test_queued_quota_is_not_bypassed_and_requires_end_turn(self):
        self.queued()
        path = self.state / 'cognition-lease.json'
        lease = read_json(path)
        write_json(path, lease | {'actionsUsed': 6})
        result = self.tools.navigate(TURN, x=1, z=2)
        self.assertEqual(result['code'], 'cognition_command_limit')
        self.assertTrue(result['endTurnRequired'])
        self.assertFalse(result['queued'])
        self.assertFalse(result['writePerformed'])
        self.assertEqual(view(self.state)['requests'], [])
        self.assertEqual(read_json(path)['actionsUsed'], 6)

    def test_real_mcp_exposes_navigation_without_version_or_action_replay_parameter(self):
        self.queued()
        async def check():
            gateway = SimpleNamespace(state=self.state, clock=self.clock)
            server = make_server(gateway, self.tools)
            schemas = await server.list_tools()
            tool = next(t for t in schemas if t.name == 'navigate')
            self.assertIn('navigate', TOOL_NAMES)
            self.assertNotIn('navigate', BODY_ACTION_TOOLS)
            self.assertEqual(tool.inputSchema['required'], ['turn_id'])
            self.assertFalse({'version', 'memory', 'previous_request_id'} & tool.inputSchema['properties'].keys())
            await server.call_tool('navigate', {'turn_id': TURN, 'x': -250, 'z': 350, 'summary': 'Walk there'})
            self.assertEqual(view(self.state)['requests'][0]['payload']['version'], self.version)
        asyncio.run(check())

    def test_mcp_does_not_coerce_boolean_coordinates_or_fractional_step_limit(self):
        from mcp.server.fastmcp.exceptions import ToolError
        async def check():
            server = make_server(SimpleNamespace(state=self.state, clock=self.clock), self.tools)
            for change in ({'x': True}, {'z': '25'}, {'y': False}, {'max_steps': True}, {'max_steps': 2.0}):
                with self.subTest(change=change), self.assertRaises(ToolError):
                    await server.call_tool('navigate', {'turn_id': TURN, 'x': -200, 'z': 250, **change})
                self.assert_no_admission()
        asyncio.run(check())


if __name__ == '__main__':
    unittest.main()

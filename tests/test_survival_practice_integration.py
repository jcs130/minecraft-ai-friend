"""Exercise the real program/lease/controller with fake game and model endpoints."""
import asyncio
import copy
import json
from pathlib import Path
import re
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/survival'))
from controller import Controller
from mcp_server import BearerMcpApp, SkillTools, practice_health
from numen_gateway import read_json, write_json
from practice import PracticeStore
from skill_library import SkillLibrary, evaluate, _fixtures, _kernel_version
from test_survival_controller import FakeClock, FakeBackend, FakeGateway, BODY_UUID

TURN = 'turn_practice_fixture_0123456'
SOURCE = '''function next(state, memory) {
 if (memory.sent) return {action:null,memory:memory,done:true};
 return {action:{tool:"craft",args:{item_id:"minecraft:stick",count:4}},memory:{sent:true}};
}'''
FIXTURES = [
    {'state': {'counts': {}}, 'memory': {}, 'expectedActionTool': 'craft', 'done': False},
    {'state': {'counts': {}}, 'memory': {'sent': True}, 'expectedActionTool': None, 'done': True},
]
OBJECTIVE = {'description': 'Practice one stick recipe', 'checks': [
    {'kind': 'inventory_gain', 'item': 'minecraft:stick', 'count': 4},
    {'kind': 'action_completed', 'tool': 'craft', 'count': 1},
]}


class ReceiptGateway(FakeGateway):
    def __init__(self, state, clock):
        super().__init__(state, clock)
        self.receipts = {}
        self.receipt_status = 'completed'

    def action(self, turn_id, tool, args):
        before = self.snapshot()
        super().action(turn_id, tool, args)
        if self.receipt_status == 'completed':
            self.body['counts']['minecraft:stick'] = self.body['counts'].get('minecraft:stick', 0) + 4
        result = {'ok': True, 'code': 'executed', 'completionConfirmed': self.receipt_status == 'completed',
                  'result': {'success': True, 'message': 'isolated fixture'}}
        self.receipts[turn_id] = [{
            'schema': 2, 'actionId': format(len(self.actions), '032x'), 'turnId': turn_id,
            'tool': tool, 'args': copy.deepcopy(args), 'status': self.receipt_status,
            'completionConfirmed': self.receipt_status == 'completed',
            'acceptedAt': int(self.clock() * 1000), 'before': before, 'after': self.snapshot(),
            'result': result,
        }]
        return result

    def turn_receipts(self, turn_id):
        return copy.deepcopy(self.receipts.get(turn_id, []))


class PracticeIntegrationTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.state = Path(temporary.name) / 'survival'
        self.public = Path(temporary.name) / 'public/survivor.json'
        self.state.mkdir()
        self.clock, self.backend = FakeClock(), FakeBackend()
        self.gateway = ReceiptGateway(self.state, self.clock)
        write_json(self.state / 'settings.json', {
            'schema': 1, 'bodyName': 'Kirito', 'bodyUuid': BODY_UUID,
            'mission': 'Build a sustainable camp', 'decisionsPerDay': 2,
            'decisionCooldownSeconds': 0, 'taskTimeoutSeconds': 60,
            'maxSkillSteps': 8, 'maxSkillSeconds': 600, 'observationSeconds': 10,
            'workArea': {'minX': 64, 'maxX': 160, 'minZ': 64, 'maxZ': 160},
        })
        write_json(self.state / 'control.json', {'schema': 1, 'enabled': True})
        self.library = SkillLibrary(self.state / 'skills')
        self.controller = self.create_controller()
        self.tools = SkillTools(self.state, self.library, self.clock)
        self.gateway.open_lease(TURN, (self.clock() + 60) * 1000)

    def create_controller(self):
        return Controller(self.state, self.public, self.gateway, self.backend, self.clock, self.library)

    def prepare(self, source=SOURCE):
        drafted = self.tools.draft(TURN, 'craft_once', source, FIXTURES, 'Bounded isolated practice')
        self.assertNotIn('code', drafted, drafted)
        version = drafted['version']
        self.assertTrue(self.tools.test(TURN, 'craft_once', version)['passed'])
        self.tools.promote(TURN, 'craft_once', version)
        return version

    def start(self, objective=OBJECTIVE):
        version = self.prepare()
        result = self.tools.start(TURN, 'craft_once', version, objective=objective)
        self.assertTrue(result['ok'], result)
        return version

    def complete(self):
        self.controller.tick()
        self.clock.now += 15
        self.controller.tick()
        return self.tools.catalog()['practice']['runs'][0]

    def test_real_program_runs_in_original_loop_and_next_model_sees_evidence(self):
        version = self.start()
        session = copy.deepcopy(self.controller.session)
        result = self.complete()
        self.assertEqual(len(self.gateway.actions), 1)
        self.assertEqual(result['version'], version)
        self.assertTrue(result['evidenceComplete'])
        self.assertTrue(result['objectiveObserved'])
        self.assertFalse(result['masteryVerified'])
        self.assertEqual(len(self.backend.submitted), 1)
        request = self.backend.submitted[0]
        self.assertEqual(request['session']['primarySessionId'], session['primarySessionId'])
        context = json.loads(request['prompt'].split('\n', 1)[1])
        self.assertEqual(context['learningPractice']['runs'][0]['runId'], result['runId'])
        self.assertTrue(context['learningPractice']['runs'][0]['objectiveObserved'])
        self.assertTrue(read_json(self.state / 'skill-job.json')['practiceFinalized'])

    def test_restart_during_program_retains_run_and_does_not_replay_step(self):
        self.start()
        self.controller.tick()
        original = read_json(self.state / 'skill-job.json')
        self.controller = self.create_controller()
        self.clock.now += 15
        self.controller.tick()
        current = read_json(self.state / 'skill-job.json')
        self.assertEqual(original['practiceRunId'], current['practiceRunId'])
        self.assertEqual(len(self.gateway.actions), 1)
        self.assertEqual(self.controller.practice.health()['runCount'], 1)
        self.assertTrue(self.tools.catalog()['practice']['runs'][0]['objectiveObserved'])

    def test_objective_copied_at_start_and_invalid_value_cannot_consume_lease(self):
        version = self.prepare()
        lease = (self.state / 'lease.json').read_bytes()
        denied = self.tools.start(TURN, 'craft_once', version, objective={'code': 'return true'})
        self.assertFalse(denied['ok'])
        self.assertEqual((self.state / 'lease.json').read_bytes(), lease)
        objective = copy.deepcopy(OBJECTIVE)
        self.assertTrue(self.tools.start(TURN, 'craft_once', version, objective=objective)['ok'])
        objective['checks'][0]['count'] = 1
        self.complete()
        self.assertEqual(self.tools.read('craft_once', version)['practice']['runs'][0]['binding']['objective'], OBJECTIVE)

    def test_unknown_action_does_not_become_success_and_never_replays(self):
        self.gateway.receipt_status = 'unknown'
        self.start()
        self.controller.tick()
        self.controller = self.create_controller()
        self.clock.now += 15
        self.controller.tick()
        result = self.tools.catalog()['practice']['runs'][0]
        self.assertTrue(result['programReportedDone'])
        self.assertFalse(result['evidenceComplete'])
        self.assertFalse(result['objectiveObserved'])
        self.assertEqual(result['ownConfirmedActions'], 0)
        self.assertEqual(len(self.gateway.actions), 1)

    def test_refinement_preserves_parent_version_and_requires_fresh_test(self):
        version = self.start()
        old = self.complete()
        current = read_json(self.state / 'lease.json')['turnId']
        refinement = {'run_ids': [old['runId']], 'hypothesis': 'Use one receipt before another attempt.',
                      'expected_outcome': 'Avoid duplicate crafting.'}
        draft = self.tools.draft(current, 'craft_once', SOURCE + '\n// revised from one practice', FIXTURES,
                                 refinement=refinement)
        self.assertNotEqual(draft['version'], version)
        denied = self.tools.start(current, 'craft_once', draft['version'], objective=OBJECTIVE)
        self.assertEqual(denied['code'], 'skill_not_promoted')
        record = self.tools.read('craft_once', draft['version'])['practice']
        self.assertEqual(record['runs'], [])
        self.assertFalse(record['refinements'][0]['expectedOutcomeObserved'])
        self.assertEqual(record['refinements'][0]['parentRuns'][0]['version'], version)
        self.assertEqual(self.tools.read('craft_once', version)['practice']['runs'][0]['runId'], old['runId'])

    def test_invalid_refinement_is_rejected_before_saving_source(self):
        with patch.object(self.library, 'draft', side_effect=AssertionError('must validate first')):
            result = self.tools.draft(TURN, 'craft_once', SOURCE, FIXTURES, refinement={
                'run_ids': ['f' * 64], 'hypothesis': 'unknown parent', 'expected_outcome': 'unverified'})
        self.assertFalse(result['ok'])
        self.assertEqual(self.controller.practice.health()['refinementCount'], 0)

    def test_terminal_recollects_earlier_failed_capture_after_last_action_advances(self):
        source = '''function next(state,memory) {
          if (memory.round >= 2) return {action:null,memory:memory,done:true};
          return {action:{tool:"craft",args:{item_id:"minecraft:stick",count:4}},
                  memory:{round:(memory.round || 0)+1}};
        }'''
        fixtures = copy.deepcopy(FIXTURES)
        fixtures[1]['memory'] = {'round': 2}
        version = self.tools.draft(TURN, 'craft_twice', source, fixtures)['version']
        self.assertTrue(self.tools.test(TURN, 'craft_twice', version)['passed'])
        self.tools.promote(TURN, 'craft_twice', version)
        self.assertTrue(self.tools.start(TURN, 'craft_twice', version, objective=OBJECTIVE)['ok'])
        with patch.object(self.controller.practice, 'capture_turn', side_effect=OSError('temporary fixture read')):
            self.controller.tick()
        self.assertIn('practiceWarning', self.controller.data)
        self.clock.now += 15
        self.controller.tick()
        self.assertEqual(self.controller.practice.health()['receiptCount'], 1)
        self.clock.now += 15
        self.controller.tick()
        summary = self.tools.catalog()['practice']['runs'][0]
        self.assertEqual(summary['ownConfirmedActions'], 2)
        self.assertTrue(summary['evidenceComplete'])
        self.assertNotIn('practiceWarning', self.controller.data)
        self.assertEqual(len(self.gateway.actions), 2)

    def test_failed_terminal_capture_freezes_observation_and_defers_next_model(self):
        version = self.start()
        self.controller.tick()
        self.clock.now += 15
        with patch.object(self.gateway, 'turn_receipts', side_effect=OSError('temporary fixture read')):
            self.controller.tick()
        self.assertEqual(len(self.backend.submitted), 0)
        self.assertEqual(self.controller.data['status'], 'practice_confirmation_wait')
        frozen = self.tools.read('craft_once', version)['practice']['runs'][0]['finalObservation']
        self.gateway.body['counts']['minecraft:stick'] += 100
        self.controller.tick()
        self.assertEqual(len(self.backend.submitted), 1)
        self.assertEqual(self.tools.read('craft_once', version)['practice']['runs'][0]['finalObservation'], frozen)

    def test_health_route_is_read_only_and_keeps_mcp_authenticated(self):
        before = {p: p.read_bytes() for p in self.state.rglob('*') if p.is_file()}
        async def request(path):
            messages = []
            async def forbidden(*args):
                raise AssertionError('readiness cannot delegate to MCP')
            async def send(value):
                messages.append(value)
            await BearerMcpApp(forbidden, 'a' * 48, self.state)(
                {'type': 'http', 'path': path, 'method': 'GET', 'headers': []}, forbidden, send)
            return messages
        response = asyncio.run(request('/healthz'))
        health = json.loads(response[1]['body'])
        self.assertEqual(response[0]['status'], 200)
        self.assertTrue(health['ok'])
        self.assertEqual(health['practice'], {'available': True, 'schema': 1,
            'runCount': 0, 'stepCount': 0, 'receiptCount': 0, 'refinementCount': 0})
        self.assertEqual(asyncio.run(request('/mcp'))[0]['status'], 401)
        self.assertEqual(before, {p: p.read_bytes() for p in self.state.rglob('*') if p.is_file()})
        self.assertEqual(self.backend.submitted, [])
        self.assertEqual(self.gateway.actions, [])

    def test_guide_example_passes_its_real_fixtures_without_kernel_change(self):
        guide = (ROOT / 'world/ops/skills/qd-survivor-practice/references/program-practice.md').read_text('utf8')
        source = re.findall(r'```javascript\s*\n(.*?)```', guide, re.S)[0]
        fixtures = json.loads(re.findall(r'```json\s*\n(.*?)```', guide, re.S)[0])
        old = _kernel_version()
        for fixture in _fixtures(fixtures):
            result = evaluate(source, fixture['state'], fixture['memory'])
            action = result.get('action')
            self.assertEqual(action.get('tool') if action else None, fixture['expectedActionTool'])
            self.assertEqual(result.get('done', False), fixture['done'])
        self.assertEqual(len(fixtures), 5)
        self.assertEqual(_kernel_version(), old)
        self.assertEqual(self.gateway.actions, [])


if __name__ == '__main__':
    unittest.main()

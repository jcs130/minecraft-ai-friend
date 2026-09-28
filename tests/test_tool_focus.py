"""Jev tool advice is bounded context, never a tool permission or world action."""
import copy
import json
import unittest
from unittest.mock import Mock

from behavior_context import _action_navigation, _decision_brief, _model_queue
from system_one import validate_choice
from tool_focus import proposal, summarize

import test_survival_fast_execution as fixture


BODY = {'ok': True, 'bodyUuid': 'actor', 'dimension': 'minecraft:overworld',
        'observedAt': 1800000000000, 'position': {'x': 10, 'y': 64, 'z': 20},
        'hp': 16, 'hunger': 6, 'task': {'busy': False}}
CONTEXT = {'wakeReason': 'autonomous_review', 'intent': {'goalState': 'ongoing'},
           'observations': {'scene': {'fresh': True}}, 'scene': {'hostiles': []},
           'motor': {'queue': {'recent': []}}}


class ToolFocusTests(unittest.TestCase):
    def test_jev_proposal_is_read_only_and_bounded(self):
        card = proposal(CONTEXT, BODY)
        validate_choice(card)
        self.assertTrue(all(row['action'] is None for row in card['candidates']))
        self.assertLess(len(json.dumps(card['context']).encode()), 2048)

    def test_jev_selection_advises_without_hiding_other_tools(self):
        focus = summarize({'choice': 'motion', 'confidence': .81}, CONTEXT, BODY)
        self.assertEqual(focus['source'], 'jev')
        self.assertEqual(focus['recommendedTools'][0], 'navigate_plan')
        self.assertTrue(focus['advisoryOnly'])
        self.assertIn('continue_while_thinking', focus['instruction'])
        self.assertEqual(focus['keyFacts']['position'], BODY['position'])
        moderate = summarize({'choice': 'survival', 'confidence': .51, 'latencyMs': 1272.88}, CONTEXT, BODY)
        self.assertEqual(moderate['category'], 'survival')
        self.assertEqual(moderate['latencyMs'], 1272.88)
        stale = summarize({'code': 'policy_observation_stale', 'choice': 'survival',
                           'confidence': .9}, CONTEXT, BODY)
        self.assertEqual(stale['source'], 'local_fallback')
        self.assertEqual(summarize({'choice': 'motion', 'confidence': .3}, CONTEXT, BODY)['source'],
                         'local_fallback')

    def test_uncertain_motor_receipt_prevents_motion_recommendation(self):
        context = copy.deepcopy(CONTEXT)
        context['motor']['queue']['recent'] = [
            {'requestId': 'r1', 'kind': 'action', 'status': 'unknown',
             'receipt': {'status': 'unknown', 'effectConfirmed': False}}]
        focus = summarize({'choice': 'motion', 'confidence': .9}, context, BODY)
        self.assertEqual(focus['source'], 'local_fallback')
        self.assertEqual(focus['category'], 'inspect')
        self.assertEqual(focus['recommendedTools'][0], 'status')
        self.assertEqual(focus['keyFacts']['uncertainMotor'], 1)

    def test_model_queue_keeps_unknown_and_latest_failure_with_short_history(self):
        recent = []
        for i in range(6):
            failed = i == 1
            recent.append({'requestId': 'r' + str(i), 'kind': 'skill',
                           'status': 'failed' if failed else 'completed',
                           'receipt': {'status': 'failed' if failed else 'completed',
                                       'completionConfirmed': not failed, 'code': 'blocked' if failed else None}})
        recent.append({'requestId': 'unknown', 'kind': 'action', 'status': 'unknown',
                       'receipt': {'status': 'unknown', 'effectConfirmed': False}})
        original = {'version': 1, 'recent': recent, 'active': []}
        compact = _model_queue(original)
        self.assertEqual([row['requestId'] for row in compact['recent']],
                         ['r1', 'r4', 'r5', 'unknown'])
        self.assertEqual(compact['olderTerminalOmitted'], 3)
        self.assertEqual(compact['recent'][-1]['receipt']['status'], 'unknown')
        self.assertEqual(len(original['recent']), 7)

    def test_model_queue_trims_confirmed_skill_receipt_but_keeps_failure_proof(self):
        original = {'recent': [{'requestId': 'route', 'kind': 'skill', 'status': 'failed',
            'receipt': {'status': 'replan', 'reason': 'navigation_failed_segment_no_safe_progress',
                'practiceRunId': 'practice', 'lastExecution': {'turnId': 'step',
                    'actionId': 'action', 'tool': 'goto', 'status': 'failed',
                    'completionConfirmed': True, 'nativeTaskId': 'native',
                    'positionBefore': {'x': 0, 'y': 64, 'z': 0},
                    'positionAfter': {'x': 4, 'y': 64, 'z': 0},
                    'navigationOutcome': {'success': False, 'horizontalDistance': 2.3,
                        'reason': 'target_not_reached', 'unneeded': 'x' * 1000}}}}]}
        compact = _model_queue(original)
        receipt = compact['recent'][0]['receipt']
        self.assertEqual(receipt['reason'], 'navigation_failed_segment_no_safe_progress')
        self.assertEqual(receipt['lastExecution']['actionId'], 'action')
        self.assertEqual(receipt['lastExecution']['positionAfter']['x'], 4)
        self.assertNotIn('nativeTaskId', receipt['lastExecution'])
        self.assertNotIn('unneeded', receipt['lastExecution']['navigationOutcome'])
        self.assertIn('nativeTaskId', original['recent'][0]['receipt']['lastExecution'])

    def test_each_turn_brief_keeps_agent_plan_and_verified_queue_result(self):
        context = copy.deepcopy(CONTEXT)
        context['self'] = {'position': BODY['position'], 'hp': 16, 'hunger': 6,
                           'task': {'busy': False}}
        context['toolFocus'] = summarize({'choice': 'motion', 'confidence': .8}, context, BODY)
        context['motor']['queue']['recent'] = [
            {'requestId': 'route-1', 'kind': 'skill', 'status': 'failed',
             'receipt': {'status': 'replan', 'reason': 'route_blocked'}}]
        brief = _decision_brief(context, {'nextFocus': 'Find a path around the ridge',
                                           'lesson': 'The last slope was blocked in the receipt.',
                                           'goalState': 'ongoing'}, context)
        self.assertEqual(brief['agentPlanClaim'], 'Find a path around the ridge')
        self.assertEqual(brief['planEvidenceClaim'], 'The last slope was blocked in the receipt.')
        self.assertEqual(brief['motor']['latestResult']['reason'], 'route_blocked')
        self.assertEqual(brief['jevPriority']['category'], 'motion')
        self.assertTrue(brief['sceneFresh'])

    def test_action_navigation_keeps_typed_calls_without_repeating_manual(self):
        template = {'tool': 'navigate_plan', 'arguments': {'waypoints': [{'x': 1, 'z': 2}]}}
        card = {'primaryMode': 'motion_plan', 'testEligibility': 'current_index_proof',
                'motionPlan': {'sourceProof': {'name': 'base_motion_plan', 'activeVersion': 'a' * 64},
                               'callTemplate': template, 'instruction': 'long rule' * 500},
                'singleGoal': {'sourceProof': {'name': 'base_navigate', 'activeVersion': 'b' * 64},
                               'callTemplate': {'tool': 'navigate', 'arguments': {'x': 1, 'z': 2}},
                               'instruction': 'long rule' * 500}}
        compact = _action_navigation(card)
        self.assertEqual(compact['motionPlan']['callTemplate'], template)
        self.assertEqual(compact['singleGoal']['callTemplate']['tool'], 'navigate')
        self.assertNotIn('instruction', compact['motionPlan'])
        self.assertLess(len(json.dumps(compact)), len(json.dumps(card)) // 2)

    def test_controller_waits_one_tick_for_jev_and_falls_back_on_changed_body(self):
        f = fixture.FastExecutionTests()
        f.setUp()
        self.addCleanup(f.doCleanups)
        c = f.controller
        worker = Mock()
        worker.submit.return_value = 4
        worker.poll.return_value = {'choice': 'motion', 'confidence': .9}
        c.tool_focus_worker = worker
        context = copy.deepcopy(CONTEXT)
        body = copy.deepcopy(f.gateway.body)
        self.assertIsNone(c.select_tool_focus(body, context))
        self.assertEqual(c.data['status'], 'tool_triage')
        self.assertEqual(c.select_tool_focus(body, context)['source'], 'jev')
        self.assertEqual(worker.submit.call_count, 1)
        self.assertFalse(f.gateway.actions or f.backend.submitted)
        self.assertIsNone(c.select_tool_focus(body, context))
        changed = copy.deepcopy(body)
        changed['position']['x'] += 3
        self.assertEqual(c.select_tool_focus(changed, context)['source'], 'local_fallback')

    def test_livestream_cadence_can_be_an_action_turn_when_jev_prioritizes_motion(self):
        f = fixture.FastExecutionTests()
        f.setUp()
        self.addCleanup(f.doCleanups)
        c = f.controller
        c.settings.update(jevToolFocusEnabled=True, livestreamMode=True,
                          livestreamReviewSeconds=15, livestreamBlockedMaxSeconds=60,
                          decisionCooldownSeconds=0)
        control = {'enabled': True, 'autonomous': True}
        c.data['lastDecisionSignature'] = c.decision_signature(f.gateway.body, control)
        c.data['lastReviewAt'] = f.clock() - 1000
        c.select_tool_focus = Mock(return_value=summarize(
            {'choice': 'motion', 'confidence': .9}, CONTEXT, BODY))
        c.submit_model(f.gateway.body, control)
        self.assertEqual(len(f.backend.submitted), 1)
        prompt = f.backend.submitted[0]['prompt']
        self.assertIn('"toolFocus"', prompt)
        self.assertIn('livestream_activity', prompt)
        self.assertNotIn('"reviewGuidance"', prompt)

    def test_due_slow_turn_refreshes_stale_body_before_jev(self):
        f = fixture.FastExecutionTests()
        f.setUp()
        self.addCleanup(f.doCleanups)
        c = f.controller
        c.settings.update(jevToolFocusEnabled=True, decisionCooldownSeconds=0)
        f.gateway.body['observedAt'] = int(f.clock() * 1000)
        stale = copy.deepcopy(f.gateway.body)
        stale['observedAt'] -= 7000
        c.select_tool_focus = Mock(return_value=summarize(
            {'choice': 'motion', 'confidence': .9}, CONTEXT, BODY))
        c.submit_model(stale, {'enabled': True, 'autonomous': True})
        self.assertEqual(f.gateway.snapshots, 1)
        self.assertEqual(len(f.backend.submitted), 1)
        self.assertTrue(c.select_tool_focus.call_args.args[0]['observedAt'] > stale['observedAt'])

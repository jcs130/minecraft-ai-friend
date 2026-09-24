"""Bounded continuous navigation uses the existing program and motor executor."""
import copy
import unittest
from unittest.mock import Mock, patch

import test_motor_boundary as boundary_fixture
from motor_loop import tick
from motor_mailbox import view
from numen_gateway import read_json, write_json, action_lock
from skill_library import _observation, evaluate, SkillLibrary, SkillError
from starter_skills import bundle
from navigation_program import SOURCE, record
import test_survival_fast_execution as fast_fixture
from motor_mailbox import enqueue_locked


class ContinuousNavigationAdmissionTests(unittest.TestCase):
    setUp = boundary_fixture.MotorBoundaryTests.setUp
    enqueue = boundary_fixture.MotorBoundaryTests.enqueue
    settle_practice = boundary_fixture.MotorBoundaryTests.settle_practice

    def recovery(self):
        payload = {'name': 'base_navigate', 'version': 'a' * 64,
                   'memory': {'mode': 'return_to_work_area'}, 'maxSteps': 32}
        self.controller.skills = Mock()
        self.controller.skills.read.return_value = {'promoted': True, 'version': 'a' * 64}
        self.controller.tick_skill = Mock(return_value=True)
        self.controller.switch_goal_at_boundary = Mock()
        self.controller.finish_action_observation = Mock()
        self.controller.data['active'] = {'taskId': 'slow-still-running', 'bodyAccess': 'queued'}
        return self.enqueue('skill', payload)

    def test_explicit_tested_recovery_skill_can_be_claimed_outside(self):
        request = self.recovery()
        tick(self.controller, self.body, {'enabled': True})
        row = next(r for r in view(self.root)['requests'] if r['requestId'] == request['requestId'])
        self.assertEqual(row['status'], 'claimed')
        self.assertEqual(read_json(self.root/'skill-job.json')['status'], 'pending')
        self.assertFalse(self.calls)

    def test_pending_recovery_skill_runs_while_slow_task_active(self):
        self.recovery()
        tick(self.controller, self.body, {'enabled': True})
        tick(self.controller, self.body, {'enabled': True})
        self.controller.tick_skill.assert_called_once_with(self.body, recovery_only=True)
        self.assertEqual(self.controller.data['active']['taskId'], 'slow-still-running')

    def test_unpromoted_or_ordinary_skill_does_not_get_recovery_authority(self):
        self.recovery()
        self.controller.skills.read.return_value['promoted'] = False
        tick(self.controller, self.body, {'enabled': True})
        self.assertEqual(view(self.root)['requests'][0]['status'], 'failed')
        self.controller.tick_skill.assert_not_called()
        self.assertFalse(self.calls)

    def test_recovery_validation_lock_failure_is_known_not_dispatched_not_unknown(self):
        self.recovery()
        self.controller.skills._tested.side_effect = SkillError('skill_library_busy')
        tick(self.controller, self.body, {'enabled': True})
        row = view(self.root)['requests'][0]
        self.assertEqual(row['status'], 'failed')
        self.assertEqual(row['receipt']['code'], 'skill_library_busy')
        self.assertIs(row['receipt']['dispatched'], False)
        self.assertFalse((self.root/'skill-job.json').exists())
        self.assertFalse(self.calls)


class ContinuousNavigationContractTests(unittest.TestCase):
    def test_initial_catalog_contains_explicit_parameterized_navigation(self):
        self.assertIn('base_navigate', [r['name'] for r in bundle()])

    def test_navigation_observation_accepts_bounded_decimal_destination(self):
        request = {'tool': 'navigation_sense', 'args': {'x': -88.5, 'y': 72, 'z': 1654.5}}
        self.assertEqual(_observation(copy.deepcopy(request)), request)

    def test_invalid_navigation_observation_never_enters_executor(self):
        for args in ({'x': 1, 'z': True}, {'x': float('nan'), 'z': 1}, {'x': 1, 'z': 2, 'y': 320},
                     {'x': 1, 'z': 2, 'command': 'anything'}, {'x': 1}):
            with self.subTest(args=args), self.assertRaises(SkillError):
                _observation({'tool': 'navigation_sense', 'args': args})


def survey(state, probe):
    return {'ok': True, 'navigationSense': {'ok': True, 'actorUuid': state['bodyUuid'],
        'dimension': state['dimension'], 'position': copy.deepcopy(state['position']),
        'observedAt': state.get('observedAt', 1000000),
        'destination': {'available': True, 'requested': copy.deepcopy(probe), 'pathVerified': False,
            'requestedStanceClear': True, 'requestedStanceSupported': True, 'candidates': []}}}


class ContinuousNavigationProgramTests(unittest.TestCase):
    def production_shape(self):
        # Sanitized active.before schema read on 2026-09-24; no fabricated epoch.
        state, memory = self.initial()
        state.update(bodyUuid=fast_fixture.BODY_UUID, navigationEpoch=None, observedAt=1790247505175,
            bodyControl={'available': True, 'actorUuid': fast_fixture.BODY_UUID,
                'dimension': 'minecraft:overworld', 'observedAt': 1790247505217,
                'gameTime': 35364424, 'bodyTickCount': 33487})
        return state, memory

    def test_production_null_epoch_can_request_a_readonly_segment_survey(self):
        state, memory = self.production_shape()
        first = evaluate(SOURCE, state, memory)
        self.assertIn('observe', first)
        self.assertIsNone(first['memory']['identity']['epoch'])

    def test_production_counter_regression_stops_before_next_action(self):
        state, memory = self.production_shape()
        first = evaluate(SOURCE, state, memory)
        self.assertIn('observe', first)
        for key in ('gameTime', 'bodyTickCount', 'observedAt'):
            changed = copy.deepcopy(state)
            changed['bodyControl'][key] -= 1
            result = evaluate(SOURCE, changed, first['memory'])
            self.assertEqual(result['reason'], 'navigation_body_continuity_lost')

    def test_null_epoch_missing_stale_or_wrong_identity_body_control_is_not_continuity(self):
        state, memory = self.production_shape()
        for patch in ({'bodyTickCount': None}, {'gameTime': True}, {'available': False},
                      {'observedAt': 1790247480000}, {'actorUuid': 'other'}, {'dimension': 'other'}):
            changed = state | {'bodyControl': state['bodyControl'] | patch}
            self.assertEqual(evaluate(SOURCE, changed, memory)['reason'], 'navigation_body_continuity_unavailable')

    def test_present_epoch_change_or_disappearance_remains_a_body_change(self):
        state, memory = self.production_shape()
        state['navigationEpoch'] = 'actual-epoch-if-provided'
        first = evaluate(SOURCE, state, memory)
        self.assertIn('observe', first)
        for epoch in (None, 'another-epoch'):
            self.assertEqual(evaluate(SOURCE, state | {'navigationEpoch': epoch}, first['memory'])['reason'],
                             'navigation_body_changed')

    def initial(self):
        state = copy.deepcopy(record()['fixtures'][0]['state'])
        memory = {'mode': 'return_to_work_area'}
        return state, memory

    def ready_step(self):
        state, memory = self.initial()
        first = evaluate(SOURCE, state, memory)
        probe = first['observe']['args']
        state['execution'] = {'observedAt': 1000250, 'observation': {'tool': 'navigation_sense', 'args': probe,
            'fresh': True, 'ageMs': 250, 'result': survey(state, probe)}}
        return state, first['memory']

    def confirmed(self, state, step):
        state['execution']['lastExecution'] = {'status': 'succeeded', 'completionConfirmed': True,
                                              'tool': 'goto', 'actionId': 'action-1', 'turnId': 'turn-1'}
        state['execution']['expectedAction'] = {'tool': 'goto', 'actionId': 'action-1',
                                              'turnId': 'turn-1', 'args': step['action']['args']}

    def test_two_segments_require_only_fresh_survey_and_exact_success(self):
        state, memory = self.ready_step()
        step = evaluate(SOURCE, state, memory)
        self.assertEqual(step['action'], {'tool': 'goto', 'args': {'x': 184, 'y': 64, 'z': 100}})
        state['position'] = copy.deepcopy(step['action']['args'])
        self.confirmed(state, step)
        next_read = evaluate(SOURCE, state, step['memory'])
        self.assertEqual(next_read['observe']['args'], {'x': 168, 'y': 64, 'z': 100})
        self.assertEqual(next_read['memory']['segments'], 1)

    def test_confirmed_native_completion_without_actual_progress_replans(self):
        state, memory = self.ready_step()
        step = evaluate(SOURCE, state, memory)
        self.confirmed(state, step)
        self.assertEqual(evaluate(SOURCE, state, step['memory'])['reason'], 'navigation_progress_not_observed')

    def test_missing_unknown_failed_or_reused_receipt_cannot_continue(self):
        state, memory = self.ready_step()
        step = evaluate(SOURCE, state, memory)
        state['position'] = copy.deepcopy(step['action']['args'])
        for receipt in ({}, {'status': 'failed', 'completionConfirmed': True},
                        {'status': 'unknown'}, {'status': 'succeeded', 'completionConfirmed': False},
                        {'status': 'succeeded', 'completionConfirmed': True, 'tool': 'goto',
                         'actionId': 'action-old', 'turnId': 'turn-old'}):
            state['execution']['lastExecution'] = receipt
            self.assertTrue(evaluate(SOURCE, state, step['memory'] | {'lastActionId': 'action-old'})['replan'])

    def test_body_epoch_dimension_or_identity_change_cannot_resume_old_program(self):
        state, memory = self.ready_step()
        for key in ('bodyUuid', 'dimension', 'navigationEpoch'):
            self.assertTrue(evaluate(SOURCE, state | {key: 'changed'}, memory)['replan'])

    def test_observation_stale_wrong_identity_or_wrong_probe_does_not_dispatch(self):
        state, memory = self.ready_step()
        for change in ('stale', 'moved', 'actor', 'destination', 'native_stale', 'vertical_move'):
            changed = copy.deepcopy(state)
            obs = changed['execution']['observation']
            if change == 'stale': obs['ageMs'] = 5001
            if change == 'moved': changed['position']['x'] += 3
            if change == 'actor': obs['result']['navigationSense']['actorUuid'] = 'other'
            if change == 'destination': obs['result']['navigationSense']['destination']['requested']['x'] += 1
            if change == 'native_stale': obs['result']['navigationSense']['observedAt'] -= 5001
            if change == 'vertical_move': changed['position']['y'] += 2
            self.assertEqual(evaluate(SOURCE, changed, memory)['reason'], 'navigation_survey_unusable')

    def test_only_supported_inward_candidate_is_selected(self):
        state, memory = self.ready_step()
        dest = state['execution']['observation']['result']['navigationSense']['destination']
        dest.update(requestedStanceClear=False, requestedStanceSupported=False,
                    candidates=[{'x': 184.5, 'y': 65, 'z': 100.5}, {'x': 203, 'y': 64, 'z': 100}])
        self.assertEqual(evaluate(SOURCE, state, memory)['action']['args'], {'x': 184.5, 'y': 65, 'z': 100.5})
        dest['candidates'] = []
        self.assertEqual(evaluate(SOURCE, state, memory)['observe']['args'], {'x': 192, 'y': 64, 'z': 100})

    def test_actual_unsupported_16_block_survey_requests_shorter_probe_without_action(self):
        # Sanitized exact 20:08:14.352 production geometry; original bytes retained
        # in runtime/navigation-interface-20260924/failed-navigation-{job,sense}.json.
        state, _ = self.initial()
        state.update(position={'x': -147.49999921582702, 'y': 63, 'z': 1502.5605361267787},
            workArea={'minX': -1100, 'maxX': 0, 'minZ': 300, 'maxZ': 1400},
            observedAt=1790251695023)
        state['bodyControl'].update(observedAt=1790251695023, gameTime=35448225, bodyTickCount=62052)
        probe = {'x': -147.55567497946572, 'y': 63, 'z': 1486.56063299553}
        memory = {'mode': 'return_to_work_area', 'stage': 'survey', 'probe': probe,
                  'target': {'x': -147.86384439961188, 'y': 64, 'z': 1398}}
        response = survey(state, probe)
        nav = response['navigationSense']
        nav['observedAt'] = 1790251694352
        nav['destination'].update(requestedStanceClear=True, requestedStanceSupported=False,
            code='requested_height_unsupported', candidates=[], examinedCells=125, unloadedCells=0)
        state['execution'] = {'observedAt': 1790251695023, 'observation': {'tool': 'navigation_sense',
            'args': probe, 'fresh': True, 'ageMs': 1238, 'result': response}}
        result = evaluate(SOURCE, state, memory)
        self.assertIn('observe', result)
        self.assertIsNone(result.get('action'))
        point = result['observe']['args']
        self.assertAlmostEqual(((point['x']-state['position']['x'])**2+
                                (point['z']-state['position']['z'])**2)**.5, 8)
        self.assertEqual(point['y'], 63)
        self.assertGreater(point['z'], probe['z'])
        self.assertLess(point['z'], state['position']['z'])

    def test_valid_empty_surveys_are_bounded_to_distinct_16_8_4_probes(self):
        state, memory = self.ready_step()
        probes = [memory['probe']]
        for expected_x in (192, 196):
            state['execution']['observation']['result']['navigationSense']['destination'].update(
                requestedStanceSupported=False, candidates=[])
            result = evaluate(SOURCE, state, memory)
            self.assertEqual(result['observe']['args'], {'x': expected_x, 'y': 64, 'z': 100})
            self.assertFalse(result.get('action'))
            memory = result['memory']
            probe = result['observe']['args']
            probes.append(probe)
            state['execution']['observation'] = {'tool': 'navigation_sense', 'args': probe,
                'fresh': True, 'ageMs': 250, 'result': survey(state, probe)}
        state['execution']['observation']['result']['navigationSense']['destination'].update(
            requestedStanceSupported=False, candidates=[])
        result = evaluate(SOURCE, state, memory)
        self.assertEqual(result['reason'], 'navigation_no_supported_progress')
        self.assertFalse(result.get('observe') or result.get('action'))
        self.assertEqual(len({p['x'] for p in probes}), 3)

    def test_shorter_survey_success_resets_next_segment_and_stale_survey_does_not_retry(self):
        state, memory = self.ready_step()
        state['execution']['observation']['result']['navigationSense']['destination'].update(
            requestedStanceSupported=False, candidates=[])
        shorter = evaluate(SOURCE, state, memory)
        self.assertIn('observe', shorter)
        probe = shorter['observe']['args']
        state['execution']['observation'] = {'tool': 'navigation_sense', 'args': probe,
            'fresh': True, 'ageMs': 250, 'result': survey(state, probe)}
        stale = copy.deepcopy(state)
        stale['execution']['observation']['fresh'] = False
        self.assertEqual(evaluate(SOURCE, stale, shorter['memory'])['reason'], 'navigation_survey_unusable')
        step = evaluate(SOURCE, state, shorter['memory'])
        self.assertEqual(step['action']['args']['x'], 192)
        state['position'] = copy.deepcopy(step['action']['args'])
        self.confirmed(state, step)
        next_read = evaluate(SOURCE, state, step['memory'])
        self.assertEqual(next_read['observe']['args']['x'], 176)

    def test_far_explicit_target_is_segmented_but_outside_target_is_not_authorized(self):
        state, _ = self.initial()
        target = {'x': 80, 'y': 64, 'z': 100}
        self.assertEqual(evaluate(SOURCE, state, {'target': target})['observe']['args']['x'], 184)
        self.assertEqual(evaluate(SOURCE, state, {'target': target | {'x': 20}})['reason'], 'known_in_area_target_required')

    def test_ground_target_without_y_continues_with_each_observed_segment_height(self):
        state, _ = self.initial()
        first = evaluate(SOURCE, state, {'target': {'x': 80, 'z': 100}})
        self.assertIn('observe', first)
        self.assertNotIn('y', first['memory']['target'])
        probe = first['observe']['args']
        observed = survey(state, probe)
        observed['navigationSense']['destination'].update(requestedStanceClear=False,
            requestedStanceSupported=False, candidates=[{'x': 184, 'y': 66, 'z': 100}])
        state['execution'] = {'observedAt': 1000250, 'observation': {'tool': 'navigation_sense',
            'args': probe, 'fresh': True, 'ageMs': 250, 'result': observed}}
        step = evaluate(SOURCE, state, first['memory'])
        self.assertEqual(step['action']['args'], {'x': 184, 'y': 66, 'z': 100})
        state['position'] = copy.deepcopy(step['action']['args'])
        self.confirmed(state, step)
        next_read = evaluate(SOURCE, state, step['memory'])
        self.assertEqual(next_read['observe']['args'], {'x': 168, 'y': 66, 'z': 100})
        self.assertNotIn('y', next_read['memory']['target'])

    def ground_arrival(self):
        state, _ = self.initial()
        state['position'] = {'x': 100, 'y': 70, 'z': 100}
        first = evaluate(SOURCE, state, {'target': {'x': 101, 'z': 100}})
        self.assertEqual(first.get('observe'), {'tool': 'navigation_sense', 'args': state['position']})
        self.assertFalse(first.get('done'))
        probe = first['observe']['args']
        state['execution'] = {'observedAt': 1000250, 'observation': {'tool': 'navigation_sense',
            'args': probe, 'fresh': True, 'ageMs': 250, 'result': survey(state, probe)}}
        return state, first['memory']

    def test_ground_arrival_requires_fresh_actual_foot_support_and_clearance(self):
        state, memory = self.ground_arrival()
        result = evaluate(SOURCE, state, memory)
        self.assertTrue(result['done'])
        self.assertEqual(result['reason'], 'observed_horizontal_supported_target')
        self.assertNotIn('y', result['memory']['target'])
        self.assertIsNone(result['action'])

    def test_ground_arrival_refuses_unsupported_wet_stale_or_wrong_position(self):
        state, memory = self.ground_arrival()
        for change in ('unsupported', 'collision', 'unloaded', 'water', 'lava', 'stale', 'actor',
                       'dimension', 'request', 'position', 'height', 'target_distance'):
            with self.subTest(change=change):
                changed = copy.deepcopy(state)
                obs = changed['execution']['observation']
                nav = obs['result']['navigationSense']
                if change == 'unsupported': nav['destination']['requestedStanceSupported'] = False
                if change == 'collision': nav['destination']['requestedStanceClear'] = False
                if change == 'unloaded': nav['destination']['available'] = False
                if change == 'water': changed['inWater'] = True
                if change == 'lava': changed['inLava'] = True
                if change == 'stale': obs['ageMs'] = 5001
                if change == 'actor': nav['actorUuid'] = 'other'
                if change == 'dimension': nav['dimension'] = 'other'
                if change == 'request': nav['destination']['requested']['x'] += 1
                if change == 'position': changed['position']['x'] += .2
                if change == 'height': changed['position']['y'] += .1
                if change == 'target_distance': changed['position']['x'] = 99
                result = evaluate(SOURCE, changed, memory)
                self.assertTrue(result.get('replan'))
                self.assertFalse(result.get('done'))
                self.assertFalse(result.get('action'))

    def test_ground_final_segment_still_requires_exact_confirmed_receipt_before_survey(self):
        state, _ = self.initial()
        state['position']['x'] = 100
        first = evaluate(SOURCE, state, {'target': {'x': 101.8, 'z': 100}})
        self.assertIn('observe', first)
        probe = first['observe']['args']
        state['execution'] = {'observedAt': 1000250, 'observation': {'tool': 'navigation_sense',
            'args': probe, 'fresh': True, 'ageMs': 250, 'result': survey(state, probe)}}
        step = evaluate(SOURCE, state, first['memory'])
        state['position']['x'] = 100.4
        self.confirmed(state, step)
        arrival = evaluate(SOURCE, state, step['memory'])
        self.assertEqual(arrival['observe']['args'], state['position'])
        self.assertFalse(arrival.get('done'))
        state['execution']['lastExecution']['completionConfirmed'] = False
        self.assertEqual(evaluate(SOURCE, state, step['memory'])['reason'], 'navigation_completion_not_confirmed')

    def test_ground_target_does_not_accept_invalid_y_or_outside_coordinates(self):
        state, _ = self.initial()
        for target in ({'x': 80, 'z': 100, 'y': None}, {'x': 80, 'z': 100, 'y': True},
                       {'x': 80, 'z': 100, 'y': 'unknown'}, {'x': 20, 'z': 100}):
            self.assertEqual(evaluate(SOURCE, state, {'target': target})['reason'], 'known_in_area_target_required')
        state['position'] = {'x': 100, 'y': 70, 'z': 100}
        self.assertEqual(evaluate(SOURCE, state, {'target': {'x': 100, 'y': 64, 'z': 100}})['reason'],
                         'navigation_vertical_route_required')

    def test_any_other_action_identity_turn_or_arguments_cannot_confirm_this_segment(self):
        state, memory = self.ready_step()
        step = evaluate(SOURCE, state, memory)
        state['position'] = copy.deepcopy(step['action']['args'])
        self.confirmed(state, step)
        for change in ({'actionId': 'different'}, {'turnId': 'different'},
                       {'args': {'x': 183, 'y': 64, 'z': 100}}, {'tool': 'eat'}):
            changed = copy.deepcopy(state)
            changed['execution']['expectedAction'].update(change)
            self.assertEqual(evaluate(SOURCE, changed, step['memory'])['reason'], 'navigation_completion_not_confirmed')

    def test_final_short_segment_can_finish_only_on_confirmed_arrival(self):
        state, memory = self.ready_step()
        state['position']['x'] = 100
        memory = {'target': {'x': 101.8, 'y': 64, 'z': 100}}
        first = evaluate(SOURCE, state, memory)
        self.assertIn('observe', first)
        probe = first['observe']['args']
        state['execution']['observation'] = {'tool': 'navigation_sense', 'args': probe,
            'fresh': True, 'ageMs': 250, 'result': survey(state, probe)}
        step = evaluate(SOURCE, state, first['memory'])
        self.assertIn('action', step)
        state['position']['x'] = 100.4
        self.confirmed(state, step)
        self.assertTrue(evaluate(SOURCE, state, step['memory'])['done'])
        state['execution']['lastExecution']['completionConfirmed'] = False
        self.assertTrue(evaluate(SOURCE, state, step['memory'])['replan'])

    def test_return_finishes_at_observed_inside_boundary_not_full_original_target(self):
        state, memory = self.ready_step()
        memory['target'] = {'x': 158, 'y': 64, 'z': 100}
        state['position']['x'] = 159.8
        self.assertTrue(evaluate(SOURCE, state, memory)['done'])


class ContinuousNavigationExecutionTests(unittest.TestCase):
    create = fast_fixture.FastExecutionTests.create

    def setUp(self):
        fast_fixture.FastExecutionTests.setUp(self)
        self.c = self.controller
        self.c.settings['asyncMotor'] = True
        write_json(self.state/'settings.json', self.c.settings)
        self.library = SkillLibrary(self.state/'skills')
        drafted = self.library.draft(**record())
        self.version = drafted['version']
        self.assertTrue(self.library.test('base_navigate', self.version)['passed'])
        self.library.promote('base_navigate', self.version)
        self.c.skills = self.library
        self.gateway.body['position']['x'] = 220
        self.gateway.body['navigationEpoch'] = None
        self.gateway.body['bodyControl'] = {'available': True, 'actorUuid': self.gateway.body['bodyUuid'],
            'dimension': self.gateway.body['dimension'], 'observedAt': int(self.clock()*1000),
            'gameTime': 35364424, 'bodyTickCount': 33487}
        self.gateway.navigation_observation = lambda body, args: survey(
            self.gateway.body | {'observedAt': self.clock() * 1000}, args)
        self.receipts = {}
        self.gateway.turn_receipts = lambda turn: copy.deepcopy(self.receipts.get(turn, []))
        self.gateway.action_status = self.action_status
        self.current_receipt = None
        self.gateway.on_action = self.admit
        self.c.submit_model(self.gateway.body, read_json(self.state/'control.json'))
        self.active = copy.deepcopy(self.c.data['active'])
        self.assertEqual(len(self.backend.submitted), 1)
        with action_lock(self.state):
            enqueue_locked(self.state, self.active['turnId'], 'skill',
                {'name': 'base_navigate', 'version': self.version,
                 'memory': {'mode': 'return_to_work_area'}, 'maxSteps': 32}, self.clock)
        # Classifier invocation is an error: this explicitly selected program needs none.
        self.c.policy_worker.submit = Mock(side_effect=AssertionError('unexpected classifier'))

    def action_status(self, body):
        r = self.current_receipt
        return {'ok': True, 'inFlight': bool(r and r['status'] == 'in_flight'), 'receipt': copy.deepcopy(r)}

    def admit(self, turn, tool, args):
        number = len(self.gateway.actions)
        self.current_receipt = {'turnId': turn, 'actionId': f'{number:032x}', 'tool': tool,
            'args': copy.deepcopy(args), 'status': 'in_flight', 'completionConfirmed': False,
            'before': copy.deepcopy(self.gateway.body)}
        self.receipts[turn] = [self.current_receipt]
        self.gateway.result = {'ok': True, 'code': 'accepted', 'completionConfirmed': False,
                               'actionId': self.current_receipt['actionId']}
        self.gateway.body['task'] = {'busy': True, 'task_id': 'native-' + str(number)}

    def advance(self):
        self.clock.now += .3
        self.gateway.body['observedAt'] = int(self.clock()*1000)
        self.gateway.body['bodyControl'].update(observedAt=int(self.clock()*1000),
            gameTime=self.gateway.body['bodyControl']['gameTime']+6,
            bodyTickCount=self.gateway.body['bodyControl']['bodyTickCount']+6)
        self.c.tick()

    def start(self):
        self.advance()  # claim
        self.advance()  # survey
        self.advance()  # first native goto
        self.assertEqual(len(self.gateway.actions), 1)

    def complete(self):
        self.gateway.body['position'] = copy.deepcopy(self.gateway.actions[-1]['args'])
        self.gateway.body['task'] = {'busy': False}
        self.current_receipt.update(status='completed', completionConfirmed=True,
                                    after=copy.deepcopy(self.gateway.body))

    def test_actual_controller_two_segments_poll_same_slow_task_without_new_model_or_classifier(self):
        self.start()
        self.complete()
        self.advance()  # fresh survey for next segment
        self.advance()  # second goto
        self.assertEqual(len(self.gateway.actions), 2)
        self.assertEqual([a['args']['x'] for a in self.gateway.actions], [204, 188])
        self.assertEqual(self.c.data['active']['taskId'], self.active['taskId'])
        self.assertEqual(len(self.backend.submitted), 1)
        self.assertEqual(set(self.backend.polled), {self.active['taskId']})
        self.c.policy_worker.submit.assert_not_called()

    def test_unknown_and_restart_never_replay_or_advance(self):
        self.start()
        write_json(self.state/'unknown.json', {'actionId': self.current_receipt['actionId']})
        self.gateway.body['task'] = {'busy': False}
        self.current_receipt.update(status='unknown')
        self.c.save()
        self.c = self.create()
        self.c.skills = self.library
        self.advance()
        self.assertEqual(len(self.gateway.actions), 1)
        self.assertEqual(read_json(self.state/'skill-job.json')['status'], 'running')

    def test_goal_replace_waits_for_exact_terminal_then_cancels_before_next_segment(self):
        self.start()
        self.c.goals.request('Use a different known route', mode='replace')
        self.advance()
        self.assertEqual(len(self.gateway.actions), 1)
        self.complete()
        self.advance()
        self.assertEqual(read_json(self.state/'skill-job.json')['status'], 'cancelled')
        self.assertEqual(len(self.gateway.actions), 1)

    def test_restart_after_confirmed_segment_resumes_with_fresh_survey_not_old_dispatch(self):
        self.start()
        self.complete()
        self.c.save()
        self.c = self.create()
        self.c.skills = self.library
        self.c.policy_worker.submit = Mock(side_effect=AssertionError('unexpected classifier'))
        self.advance()
        self.assertEqual(len(self.gateway.actions), 1)
        self.advance()
        self.assertEqual(len(self.gateway.actions), 2)
        self.assertNotEqual(self.gateway.actions[0]['turnId'], self.gateway.actions[1]['turnId'])
        self.assertEqual(self.gateway.actions[1]['args']['x'], 188)

    def test_exact_receipt_mismatch_does_not_continue_even_if_body_idle(self):
        self.start()
        self.complete()
        self.current_receipt['turnId'] = 'different-turn'
        self.advance()
        self.advance()
        self.assertEqual(len(self.gateway.actions), 1)

    def test_null_epoch_body_tick_reset_after_confirmed_arrival_stops_next_segment(self):
        self.start()
        self.complete()
        self.gateway.body['bodyControl']['bodyTickCount'] = 0
        self.advance()
        self.assertEqual(read_json(self.state/'skill-job.json')['reason'], 'navigation_body_continuity_lost')
        self.assertEqual(len(self.gateway.actions), 1)

    def test_recovery_lane_mechanically_rejects_non_goto_program_output(self):
        self.advance()
        with patch.object(self.library, 'run', return_value={
                'memory': {'mode': 'return_to_work_area'},
                'action': {'tool': 'eat', 'args': {'item_id': 'minecraft:bread'}}}):
            self.advance()
        self.assertEqual(read_json(self.state/'skill-job.json')['reason'], 'recovery_goto_only')
        self.assertFalse(self.gateway.actions)

    def test_skill_start_summary_completion_does_not_kill_running_motor_job(self):
        from mcp_server import SkillTools
        result = SkillTools(self.state, self.library, self.clock).start(
            self.active['turnId'], 'base_navigate', self.version,
            memory={'mode': 'return_to_work_area'}, summary='Return intent queued; no arrival claimed.')
        self.assertEqual(result['code'], 'motor_queued')
        self.assertTrue(result['turnCompletion']['requested'])
        self.start()
        # This is the controller operation used after the native completion marker.
        self.c.close_model_authority(self.active)
        self.assertEqual(read_json(self.state/'cognition-lease.json')['status'], 'closed')
        self.assertEqual(read_json(self.state/'skill-job.json')['status'], 'running')
        self.complete()
        self.advance()
        self.advance()
        self.assertEqual(len(self.gateway.actions), 2)


if __name__ == '__main__':
    unittest.main()

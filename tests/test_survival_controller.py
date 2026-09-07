"""Crash/restart and observation tests: no model, RCON, or live world access."""
import copy
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/survival'))
from controller import Controller
from numen_gateway import read_json, write_json, GatewayError

BODY_UUID = 'd4ac9523-4962-43ed-98c5-19b49e104048'
VERSION = 'a' * 64


class FakeClock:
    def __init__(self):
        self.now = 1800000000.0

    def __call__(self):
        return self.now


class FakeBackend:
    def __init__(self):
        self.submitted, self.polled, self.cancelled = [], [], []
        self.on_submit = None
        self.reply = {'status': 'running'}
        self.cancel_error = None
        self.cancel_reply = {'stopped': True}

    def submit(self, turn_id, prompt, timeout):
        self.submitted.append({'turnId': turn_id, 'prompt': prompt, 'timeout': timeout})
        if self.on_submit:
            self.on_submit(turn_id, prompt, timeout)
        return 'native-task-' + str(len(self.submitted))

    def poll(self, task_id):
        self.polled.append(task_id)
        if isinstance(self.reply, Exception):
            raise self.reply
        return copy.deepcopy(self.reply)

    def cancel(self, turn_id):
        self.cancelled.append(turn_id)
        if self.cancel_error:
            raise self.cancel_error
        return copy.deepcopy(self.cancel_reply)


class FakeGateway:
    def __init__(self, state, clock):
        self.state, self.clock = state, clock
        self.opened, self.closed, self.actions, self.invoked = [], [], [], []
        self.snapshots = 0
        self.on_action = None
        self.on_snapshot = None
        self.result = {'ok': True, 'code': 'accepted', 'completionConfirmed': False}
        self.body = {'ok': True, 'online': True, 'bodyName': 'Kirito', 'bodyUuid': BODY_UUID,
                     'hp': 20, 'maxHp': 20, 'hunger': 18, 'gameMode': 'survival',
                     'position': {'x': 100, 'y': 64, 'z': 100}, 'dimension': 'minecraft:overworld',
                     'counts': {'minecraft:oak_log': 2, 'minecraft:bread': 1},
                     'task': {'busy': False, 'completionConfirmed': False}}

    def snapshot(self):
        self.snapshots += 1
        if self.on_snapshot:
            self.on_snapshot(self.snapshots)
        return copy.deepcopy(self.body)

    def observe(self, radius):
        return {'ok': True, 'terrain': 'fixture natural trees', 'hostiles': []}

    def _area(self, position, protect=False):
        if not 64 <= position['x'] <= 160 or not 64 <= position['z'] <= 160:
            raise GatewayError('outside_work_area')

    def open_lease(self, turn_id, expires_at):
        if read_json(self.state / 'control.json').get('enabled') is not True:
            raise GatewayError('autonomy_disabled')
        if (self.state / 'unknown.json').exists():
            raise GatewayError('outcome_unknown')
        self.opened.append(turn_id)
        write_json(self.state / 'lease.json', {'schema': 1, 'turnId': turn_id, 'status': 'open',
                   'expiresAt': expires_at, 'actionLimit': 1, 'actionsUsed': 0})

    def close_lease(self, blocking=False):
        self.closed.append(blocking)
        path = self.state / 'lease.json'
        if path.exists():
            lease = read_json(path); lease['status'] = 'closed'; write_json(path, lease)
        return {'ok': True}

    def action(self, turn_id, tool, args):
        self.actions.append({'turnId': turn_id, 'tool': tool, 'args': copy.deepcopy(args)})
        if self.on_action:
            self.on_action(turn_id, tool, args)
        return copy.deepcopy(self.result)

    def _invoke(self, tool):
        self.invoked.append(tool)
        if tool == 'task_stop':
            self.body['task']['busy'] = False
        return {'success': True}


class FakeSkills:
    def __init__(self):
        self.calls = []
        self.reply = {'action': None, 'memory': {}, 'done': True, 'reason': 'Observed goal'}

    def catalog(self):
        return {'skills': [{'name': 'gather_wood', 'activeVersion': VERSION}]}

    def run(self, name, state, memory, version):
        self.calls.append({'name': name, 'state': copy.deepcopy(state),
                           'memory': copy.deepcopy(memory), 'version': version})
        if isinstance(self.reply, Exception):
            raise self.reply
        return copy.deepcopy(self.reply)


class ControllerTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.state = Path(temporary.name) / 'survival'
        self.public = Path(temporary.name) / 'public/survivor.json'
        self.state.mkdir()
        self.clock, self.backend, self.skills = FakeClock(), FakeBackend(), FakeSkills()
        self.gateway = FakeGateway(self.state, self.clock)
        self.settings = {'schema': 1, 'bodyName': 'Kirito', 'bodyUuid': BODY_UUID,
                         'mission': 'Choose useful survival work based on observed inventory',
                         'decisionsPerDay': 2, 'decisionCooldownSeconds': 120,
                         'taskTimeoutSeconds': 60, 'maxSkillSteps': 8, 'maxSkillSeconds': 600,
                         'observationSeconds': 10,
                         'workArea': {'minX': 64, 'maxX': 160, 'minZ': 64, 'maxZ': 160}}
        self.write('settings.json', self.settings)
        self.write('control.json', {'schema': 1, 'enabled': True})
        self.controller = self.create()

    def create(self):
        return Controller(self.state, self.public, self.gateway, self.backend, self.clock, self.skills)

    def write(self, name, value):
        write_json(self.state / name, value)

    def job(self, **updates):
        value = {'schema': 1, 'status': 'pending', 'name': 'gather_wood', 'version': VERSION,
                 'memory': {'attempts': 0}, 'maxSteps': 8, **updates}
        self.write('skill-job.json', value)
        return value

    def test_submission_persists_budget_and_reservation_before_http(self):
        def before_http(turn_id, prompt, timeout):
            persisted = read_json(self.state / 'controller.json')
            self.assertEqual(persisted['active']['turnId'], turn_id)
            self.assertIsNone(persisted['active']['taskId'])
            self.assertEqual(persisted['active']['phase'], 'reserved')
            self.assertEqual(persisted['decisions'], [{'turnId': turn_id, 'startedAt': self.clock()}])
            self.assertEqual(persisted['nextDecisionAt'], self.clock() + 120)
            self.assertEqual(timeout, 60)  # Native API takes seconds, not milliseconds.
            self.assertEqual(read_json(self.state / 'lease.json')['turnId'], turn_id)
        self.backend.on_submit = before_http
        self.controller.tick()
        self.assertEqual(self.controller.data['active']['phase'], 'submitted')
        self.assertEqual(len(self.backend.submitted), 1)

    def test_uncertain_submission_is_not_retried_and_remains_charged(self):
        self.backend.on_submit = lambda *args: (_ for _ in ()).throw(TimeoutError('response lost'))
        self.controller.tick()
        self.assertFalse(read_json(self.state / 'control.json')['enabled'])
        self.assertEqual(self.controller.data['pauseReason'], 'model_submission_uncertain')
        self.assertEqual(len(self.controller.data['decisions']), 1)
        self.controller.tick()
        self.assertEqual(len(self.backend.submitted), 1)
        self.assertEqual(len(self.backend.cancelled), 1)

    def test_native_404_pauses_cancels_and_never_resubmits(self):
        self.controller.tick()
        self.backend.reply = LookupError('native task disappeared: 404')
        self.controller.tick(); self.controller.tick()
        self.assertEqual(self.controller.data['pauseReason'], 'model_result_unknown')
        self.assertEqual(len(self.backend.submitted), 1)
        self.assertEqual(len(self.backend.cancelled), 1)
        self.assertIsNone(self.controller.data['active'])

    def test_timeout_cancels_without_another_poll_or_model_request(self):
        self.controller.tick()
        self.clock.now += 91
        self.controller.tick()
        self.assertEqual(self.controller.data['pauseReason'], 'model_timeout')
        self.assertEqual(len(self.backend.cancelled), 1)
        self.assertFalse(self.backend.polled)
        self.assertEqual(len(self.backend.submitted), 1)

    def test_restart_with_active_task_never_submits_again(self):
        self.controller.tick()
        restarted = self.create()
        self.assertEqual(restarted.data['pauseReason'], 'interrupted_model_task')
        restarted.tick()
        self.assertEqual(len(self.backend.submitted), 1)
        self.assertEqual(len(self.backend.cancelled), 1)
        self.assertEqual(len(restarted.data['decisions']), 1)

    def test_dispatch_crash_preserves_advanced_memory_and_never_replays(self):
        self.job()
        self.skills.reply = {'action': {'tool': 'mine', 'args': {'block_ids': ['minecraft:oak_log'], 'count': 4}},
                             'memory': {'attempts': 1}, 'done': False}
        def lose_process(turn_id, tool, args):
            persisted = read_json(self.state / 'skill-job.json')
            self.assertEqual(persisted['status'], 'dispatching')
            self.assertEqual(persisted['memory'], {'attempts': 1})
            self.assertEqual(persisted['lastTurnId'], turn_id)
            raise SystemExit('simulated process loss after external request')
        self.gateway.on_action = lose_process
        with self.assertRaises(SystemExit):
            self.controller.tick()
        self.gateway.on_action = None
        restarted = self.create()
        self.assertEqual(restarted.data['pauseReason'], 'interrupted_skill_action')
        restarted.tick(); restarted.tick()
        self.assertEqual(len(self.gateway.actions), 1)
        self.assertFalse(self.backend.submitted)
        self.assertEqual(read_json(self.state / 'skill-job.json')['status'], 'dispatching')

    def test_dispatch_exception_pauses_instead_of_launching_model(self):
        self.job()
        self.skills.reply = {'action': {'tool': 'mine', 'args': {'block_ids': ['minecraft:oak_log'], 'count': 4}},
                             'memory': {'attempts': 1}}
        self.gateway.on_action = lambda *args: (_ for _ in ()).throw(RuntimeError('uncertain write'))
        self.controller.tick()
        self.assertFalse(self.backend.submitted)
        self.assertEqual(self.controller.data['pauseReason'], 'skill_dispatch_uncertain')
        self.assertFalse(read_json(self.state / 'control.json')['enabled'])

    def test_body_offline_during_model_task_cancels_and_revokes_actions(self):
        self.controller.tick()
        self.gateway.body = {'ok': False, 'online': False, 'code': 'body_snapshot_unavailable'}
        self.controller.tick(); self.controller.tick()
        self.assertEqual(self.controller.data['pauseReason'], 'body_lost_during_decision')
        self.assertEqual(len(self.backend.cancelled), 1)
        self.assertEqual(read_json(self.state / 'lease.json')['status'], 'closed')
        self.assertEqual(len(self.backend.submitted), 1)

    def test_stop_refreshes_body_instead_of_trusting_previous_idle_snapshot(self):
        self.controller.last_body = copy.deepcopy(self.gateway.body)
        self.gateway.body['task']['busy'] = True
        self.assertTrue(self.controller.stop_actions())
        self.assertEqual(self.gateway.invoked, ['task_stop'])
        self.assertGreater(self.gateway.snapshots, 0)
        self.assertEqual(self.gateway.closed, [True])

    def test_operator_pause_stops_busy_action_and_pending_skill(self):
        self.job(status='running')
        self.gateway.body['task']['busy'] = True
        self.write('control.json', {'schema': 1, 'enabled': False})
        self.controller.tick()
        self.assertEqual(self.gateway.invoked, ['task_stop'])
        self.assertEqual(read_json(self.state / 'skill-job.json')['status'], 'paused')
        self.assertFalse(self.skills.calls)
        self.assertFalse(self.backend.submitted)

    def test_cancellation_uncertain_still_revokes_lease_and_stops_body(self):
        self.controller.tick()
        self.gateway.body['task']['busy'] = True
        self.backend.cancel_error = TimeoutError('cannot confirm backend cancellation')
        self.write('control.json', {'schema': 1, 'enabled': False})
        self.controller.tick()
        self.assertEqual(self.controller.data['pauseReason'], 'cancellation_uncertain')
        self.assertEqual(read_json(self.state / 'lease.json')['status'], 'closed')
        self.assertEqual(self.gateway.invoked, ['task_stop'])
        self.assertEqual(len(self.backend.submitted), 1)

    def test_internal_pause_also_stops_existing_busy_action(self):
        self.gateway.body['task']['busy'] = True
        self.controller.pause('interrupted_skill_action')
        self.controller.tick()
        self.assertEqual(self.gateway.invoked, ['task_stop'])
        self.assertFalse(self.backend.submitted)

    def test_busy_body_never_evaluates_skill_or_calls_model(self):
        self.job()
        self.gateway.body['task']['busy'] = True
        for _ in range(5):
            self.clock.now += 100
            self.controller.tick()
        self.assertEqual(self.controller.data['status'], 'acting')
        self.assertFalse(self.skills.calls)
        self.assertFalse(self.backend.submitted)
        self.assertFalse(self.gateway.actions)

    def test_skill_observes_delta_and_memory_then_returns_to_model(self):
        self.job()
        self.skills.reply = {'action': {'tool': 'mine', 'args': {'block_ids': ['minecraft:oak_log'], 'count': 4}},
                             'memory': {'attempts': 1}, 'done': False}
        self.controller.tick()
        self.assertFalse(self.backend.submitted)
        self.assertEqual(read_json(self.state / 'skill-job.json')['memory'], {'attempts': 1})
        self.gateway.body['task']['busy'] = True
        self.controller.tick()
        self.assertEqual(len(self.skills.calls), 1)
        self.assertFalse([r for r in self.controller.data['episodes'] if r['kind'] == 'action_observed'])
        self.gateway.body['task']['busy'] = False
        self.gateway.body['counts'] = {'minecraft:oak_log': 6, 'minecraft:stick': 2}
        self.gateway.body['position'] = {'x': 102, 'y': 64, 'z': 101}
        self.skills.reply = {'action': None, 'memory': {'attempts': 1}, 'done': True}
        self.controller.tick()
        latest = self.skills.calls[-1]
        self.assertEqual(latest['memory'], {'attempts': 1})
        self.assertEqual(latest['state']['execution']['lastResult']['code'], 'accepted')
        evidence = next(r for r in latest['state']['execution']['evidence'] if r['kind'] == 'action_observed')
        self.assertEqual(evidence['inventoryDelta'], {'minecraft:oak_log': 4, 'minecraft:stick': 2, 'minecraft:bread': -1})
        self.assertEqual(evidence['positionBefore'], {'x': 100, 'y': 64, 'z': 100})
        self.assertEqual(evidence['positionAfter'], self.gateway.body['position'])
        self.assertNotIn('success', evidence)
        self.assertEqual(read_json(self.state / 'skill-job.json')['status'], 'done')
        self.assertEqual(len(self.backend.submitted), 1)

    def test_idle_without_changes_does_not_claim_action_succeeded(self):
        self.controller.data['observeAction'] = {'action': 'mine', 'before': copy.deepcopy(self.gateway.body)}
        self.controller.finish_action_observation(self.gateway.snapshot())
        record = self.controller.data['episodes'][-1]
        self.assertEqual(record['inventoryDelta'], {})
        self.assertNotIn('success', record)
        self.assertIn('not a blanket task-success', record['notice'])

    def test_skill_step_budget_returns_to_planning_without_another_action(self):
        self.job(status='running', steps=8)
        self.controller.tick()
        self.assertFalse(self.skills.calls)
        self.assertFalse(self.gateway.actions)
        self.assertEqual(read_json(self.state / 'skill-job.json')['status'], 'replan')
        self.assertEqual(len(self.backend.submitted), 1)

    def test_daily_budget_and_cooldown_do_not_submit(self):
        self.controller.data['decisions'] = [{'startedAt': self.clock() - 1}, {'startedAt': self.clock() - 2}]
        self.controller.tick()
        self.assertEqual(self.controller.data['status'], 'budget_wait')
        self.assertFalse(self.backend.submitted)
        self.controller.data['decisions'] = []
        self.controller.data['nextDecisionAt'] = self.clock() + 120
        self.controller.tick()
        self.assertEqual(self.controller.data['status'], 'cooldown')
        self.assertFalse(self.backend.submitted)
        self.clock.now += 121
        self.controller.tick()
        self.assertEqual(len(self.backend.submitted), 1)

    def test_old_decisions_roll_out_of_daily_budget(self):
        self.controller.data['decisions'] = [{'startedAt': self.clock() - 86401}] * 2
        self.controller.tick()
        self.assertEqual(len(self.backend.submitted), 1)
        self.assertEqual(len(self.controller.data['decisions']), 1)

    def test_native_finished_with_failure_is_not_success(self):
        self.controller.tick()
        self.backend.reply = {'status': 'finished', 'result': {'status': 'failed'}}
        self.controller.tick()
        self.assertFalse(self.controller.data['lastDecision']['completed'])
        self.assertEqual(self.controller.data['failures'], 1)
        self.assertEqual(len(self.backend.submitted), 1)
        self.controller.tick()
        self.assertEqual(self.controller.data['status'], 'cooldown')

    def test_public_status_uses_bounded_skill_rows_and_real_evidence(self):
        self.controller.tick()
        public = read_json(self.public)
        self.assertIsInstance(public['skills'], list)
        self.assertEqual(public['bodyUuid'], BODY_UUID)
        self.assertEqual(public['budgets']['decisionsUsed'], 1)
        self.assertIsNone(public['budgets']['modelRequests'])
        self.assertEqual(public['body']['counts'], self.gateway.body['counts'])

    def finish_no_action_decision(self):
        self.controller.tick()
        self.assertIsNotNone(self.controller.data['active'])
        self.backend.reply = {'status': 'finished', 'result': {'status': 'completed'}}
        self.controller.tick()
        self.assertIsNone(self.controller.data['active'])
        self.assertFalse(self.controller.data['lastDecision']['actions'])

    def test_unchanged_observations_sleep_after_completed_no_action_decision(self):
        self.finish_no_action_decision()
        for _ in range(4):
            self.clock.now += 121
            self.controller.tick()
            self.assertEqual(self.controller.data['status'], 'idle')
        self.assertEqual(len(self.backend.submitted), 1)
        self.assertEqual(len(self.controller.data['decisions']), 1)
        self.assertFalse(self.gateway.actions)

    def test_observation_timestamp_changes_do_not_wake_model(self):
        self.gateway.body['observedAt'] = int(self.clock() * 1000)
        self.finish_no_action_decision()
        for delta in (121, 240, 600):
            self.clock.now += delta
            self.gateway.body['observedAt'] = int(self.clock() * 1000)
            self.gateway.body['task']['observedAt'] = int(self.clock() * 1000)
            self.controller.tick()
            self.assertEqual(self.controller.data['status'], 'idle')
        self.assertEqual(len(self.backend.submitted), 1)

    def test_new_inventory_evidence_wakes_only_after_cooldown(self):
        self.finish_no_action_decision()
        self.gateway.body['counts']['minecraft:oak_log'] += 4
        self.controller.tick()
        self.assertEqual(self.controller.data['status'], 'cooldown')
        self.assertEqual(len(self.backend.submitted), 1)
        self.clock.now += 121
        self.controller.tick()
        self.assertEqual(len(self.backend.submitted), 2)

    def test_hp_change_is_a_new_decision_event(self):
        self.finish_no_action_decision()
        self.clock.now += 121
        self.gateway.body['hp'] = 16
        self.controller.tick()
        self.assertEqual(len(self.backend.submitted), 2)

    def test_hunger_change_is_a_new_decision_event(self):
        self.finish_no_action_decision()
        self.clock.now += 121
        self.gateway.body['hunger'] = 12
        self.controller.tick()
        self.assertEqual(len(self.backend.submitted), 2)

    def test_new_mission_wakes_even_when_body_has_not_changed(self):
        self.finish_no_action_decision()
        self.write('control.json', {'schema': 1, 'enabled': True,
                                   'mission': 'Investigate observed safe cave entrance'})
        self.controller.tick()
        self.assertEqual(len(self.backend.submitted), 1)
        self.assertEqual(self.controller.data['status'], 'cooldown')
        self.clock.now += 121
        self.controller.tick()
        self.assertEqual(len(self.backend.submitted), 2)
        self.assertIn('Investigate observed safe cave entrance', self.backend.submitted[-1]['prompt'])

    def test_mission_changed_while_active_is_not_swallowed_by_old_completion(self):
        self.write('control.json', {'schema': 1, 'enabled': True, 'mission': 'Original mission'})
        self.controller.tick()
        self.assertEqual(len(self.backend.submitted), 1)
        self.write('control.json', {'schema': 1, 'enabled': True, 'mission': 'New mission during thinking'})
        self.backend.reply = {'status': 'finished', 'result': {'status': 'completed'}}
        self.controller.tick()
        self.assertEqual(len(self.backend.submitted), 1)
        self.clock.now += 121
        self.controller.tick()
        self.assertEqual(len(self.backend.submitted), 2)
        self.assertIn('New mission during thinking', self.backend.submitted[-1]['prompt'])

    def test_skill_completion_evidence_wakes_without_inventory_change(self):
        self.finish_no_action_decision()
        self.job()
        self.skills.reply = {'action': None, 'memory': {}, 'done': True,
                             'reason': 'Verified a safe location from new local evidence'}
        self.controller.tick()
        self.assertEqual(read_json(self.state / 'skill-job.json')['status'], 'done')
        self.assertEqual(len(self.backend.submitted), 1)
        self.assertEqual(self.controller.data['status'], 'cooldown')
        self.clock.now += 121
        self.controller.tick()
        self.assertEqual(len(self.backend.submitted), 2)
        self.assertIn('skill_finished', self.backend.submitted[-1]['prompt'])

    def test_pause_and_restart_keep_spent_budget_and_cooldown(self):
        self.finish_no_action_decision()
        used = copy.deepcopy(self.controller.data['decisions'])
        cooldown = self.controller.data['nextDecisionAt']
        self.controller.pause('operator_pause')
        restarted = self.create()
        self.assertEqual(restarted.data['decisions'], used)
        self.assertEqual(restarted.data['nextDecisionAt'], cooldown)
        self.write('control.json', {'schema': 1, 'enabled': True, 'mission': 'Different goal after resume'})
        restarted.tick()
        self.assertEqual(restarted.data['status'], 'cooldown')
        self.assertEqual(len(self.backend.submitted), 1)
        self.clock.now += 121
        restarted.tick()
        self.assertEqual(len(self.backend.submitted), 2)
        self.backend.reply = {'status': 'finished', 'result': {'status': 'completed'}}
        restarted.tick()
        restarted.pause('operator_pause_again')
        again = self.create()
        self.write('control.json', {'schema': 1, 'enabled': True, 'mission': 'Third requested goal'})
        self.clock.now += 121
        again.tick()
        self.assertEqual(again.data['status'], 'budget_wait')
        self.assertEqual(len(again.data['decisions']), 2)
        self.assertEqual(len(self.backend.submitted), 2)

    def test_idle_signature_survives_restart_without_new_inference(self):
        self.finish_no_action_decision()
        signature = self.controller.data['lastDecisionSignature']
        restarted = self.create()
        self.assertEqual(restarted.data['lastDecisionSignature'], signature)
        self.clock.now += 121
        restarted.tick()
        self.assertEqual(restarted.data['status'], 'idle')
        self.assertEqual(len(self.backend.submitted), 1)

    def test_small_entity_pushes_across_integer_coordinates_do_not_wake(self):
        self.gateway.body['position'] = {'x': 100.4, 'y': 64, 'z': 100.4}
        self.finish_no_action_decision()
        self.clock.now += 121
        for x, z in ((100.6, 100.4), (101.1, 100.9), (102.0, 100.4)):
            self.gateway.body['position'] = {'x': x, 'y': 64, 'z': z}
            self.clock.now += 30
            self.controller.tick()
            self.assertEqual(self.controller.data['status'], 'idle')
        self.assertEqual(len(self.backend.submitted), 1)

    def test_small_push_across_chunk_boundary_does_not_wake(self):
        self.gateway.body['position'] = {'x': 111.8, 'y': 64, 'z': 111.8}
        self.finish_no_action_decision()
        self.clock.now += 121
        for position in ({'x': 112.2, 'y': 64, 'z': 112.2},
                         {'x': 111.7, 'y': 64, 'z': 112.3},
                         {'x': 112.9, 'y': 64, 'z': 112.5}):
            self.gateway.body['position'] = position
            self.controller.tick()
            self.assertEqual(self.controller.data['status'], 'idle')
        self.assertEqual(len(self.backend.submitted), 1)
        self.assertEqual(len(self.controller.data['decisions']), 1)

    def test_horizontal_displacement_replans_at_eight_blocks_not_before(self):
        self.finish_no_action_decision()
        self.clock.now += 121
        self.gateway.body['position']['x'] = 107.99
        self.controller.tick()
        self.assertEqual(self.controller.data['status'], 'idle')
        self.assertEqual(len(self.backend.submitted), 1)
        self.gateway.body['position']['x'] = 108
        self.controller.tick()
        self.assertEqual(len(self.backend.submitted), 2)

    def test_diagonal_displacement_uses_combined_horizontal_distance(self):
        self.finish_no_action_decision()
        self.clock.now += 121
        self.gateway.body['position'] = {'x': 105, 'y': 64, 'z': 105}
        self.controller.tick()
        self.assertEqual(self.controller.data['status'], 'idle')
        self.gateway.body['position'] = {'x': 106, 'y': 64, 'z': 106}
        self.controller.tick()
        self.assertEqual(len(self.backend.submitted), 2)

    def test_vertical_drop_wakes_at_four_blocks_even_without_hp_change(self):
        self.finish_no_action_decision()
        self.clock.now += 121
        self.gateway.body['position']['y'] = 60.01
        self.controller.tick()
        self.assertEqual(self.controller.data['status'], 'idle')
        self.assertEqual(len(self.backend.submitted), 1)
        self.gateway.body['position']['y'] = 60
        self.controller.tick()
        self.assertEqual(len(self.backend.submitted), 2)
        self.assertEqual(self.gateway.body['hp'], 20)

    def test_short_deliberate_move_receipt_wakes_after_task_becomes_idle(self):
        self.finish_no_action_decision()
        self.clock.now += 121
        self.controller.data['observeAction'] = {'action': 'goto', 'before': copy.deepcopy(self.gateway.body)}
        self.gateway.body['position']['x'] = 102
        self.gateway.body['task']['busy'] = True
        self.controller.tick()
        self.assertEqual(self.controller.data['status'], 'acting')
        self.assertEqual(len(self.backend.submitted), 1)
        self.assertIsNotNone(self.controller.data['observeAction'])
        self.gateway.body['task']['busy'] = False
        self.controller.tick()
        self.assertEqual(len(self.backend.submitted), 2)
        evidence = next(row for row in reversed(self.controller.data['episodes'])
                        if row['kind'] == 'action_observed')
        self.assertEqual(evidence['action'], 'goto')
        self.assertEqual(evidence['positionBefore']['x'], 100)
        self.assertEqual(evidence['positionAfter']['x'], 102)
        self.assertEqual(evidence['inventoryDelta'], {})

    def test_displacement_baseline_survives_restart_without_resetting_budget(self):
        self.finish_no_action_decision()
        self.clock.now += 121
        self.gateway.body['position']['x'] = 102
        self.controller.tick()
        restarted = self.create()
        self.assertEqual(restarted.data['lastDecisionPosition']['x'], 100)
        self.assertEqual(len(restarted.data['decisions']), 1)
        restarted.tick()
        self.assertEqual(len(self.backend.submitted), 1)
        self.gateway.body['position']['x'] = 108
        restarted.tick()
        self.assertEqual(len(self.backend.submitted), 2)
        self.assertEqual(len(restarted.data['decisions']), 2)


if __name__ == '__main__':
    unittest.main()

"""Practice provenance and persistence without game, model, or QuickJS execution."""
import copy
from contextlib import closing
import hashlib
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/survival'))
from practice import PracticeError, PracticeStore, run_id, validate_objective


VERSION = 'a' * 64
BODY_ID = 'd4ac9523-4962-43ed-98c5-19b49e104048'
TURN = 'turn_fixture_0123456789'
STEP_TURN = 'skill-' + '1' * 32
ACTION = '2' * 32
BODY = {'ok': True, 'bodyUuid': BODY_ID, 'dimension': 'minecraft:overworld',
        'counts': {'minecraft:stick': 2}, 'hp': 20, 'hunger': 15,
        'position': {'x': 0, 'y': 64, 'z': 0}, 'observedAt': 1000000}
OBJECTIVE = {'description': 'Make four more sticks', 'checks': [
    {'kind': 'inventory_gain', 'item': 'minecraft:stick', 'count': 4},
    {'kind': 'action_completed', 'tool': 'craft', 'count': 1}]}


class PracticeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.state = Path(self.temp.name) / 'state'
        self.now = 1000
        self.store = PracticeStore(self.state, clock=lambda: self.now)
        self.job = self.make_job()

    @staticmethod
    def make_job(name='craft_sticks', version=VERSION, turn=TURN, objective=OBJECTIVE):
        return {'name': name, 'version': version, 'turnId': turn, 'objective': copy.deepcopy(objective),
                'practiceRunId': run_id(name, version, turn), 'status': 'running'}

    def begin(self, job=None):
        self.store.initialize()
        return self.store.begin(job or self.job, copy.deepcopy(BODY))

    def step(self, job=None, turn=STEP_TURN, tool='craft', args=None):
        job = job or self.job
        args = args or {'item_id': 'minecraft:stick', 'count': 4}
        return self.store.step(job['practiceRunId'], turn, turn, tool, args)

    def receipt(self, status='completed', success=True, turn=STEP_TURN, action=ACTION, tool='craft', args=None):
        after = copy.deepcopy(BODY)
        after['counts']['minecraft:stick'] = 6
        return {'schema': 2, 'actionId': action, 'turnId': turn, 'tool': tool,
                'args': args or {'item_id': 'minecraft:stick', 'count': 4},
                'before': copy.deepcopy(BODY), 'after': after, 'acceptedAt': 999999,
                'status': status, 'completionConfirmed': status in ('completed', 'failed'),
                'result': {'ok': success, 'code': 'executed' if success else 'action_rejected',
                           'result': {'success': success, 'message': 'fixture result'}}}

    def finish(self, body=None, job=None):
        selected = dict(job or self.job, status='done')
        return self.store.finish(selected['practiceRunId'], selected, body or self.receipt()['after'])

    def bytes(self):
        return {p.name: p.read_bytes() for p in self.state.iterdir()} if self.state.exists() else {}

    def test_missing_reads_do_not_create_directory_or_database(self):
        self.assertFalse(self.store.summarize()['available'])
        self.assertFalse(self.store.read('craft_sticks', VERSION)['available'])
        self.assertEqual(self.store.capture_turn(STEP_TURN, []), {'matched': False})
        with self.assertRaisesRegex(PracticeError, 'uninitialized'):
            self.store.turns(self.job['practiceRunId'])
        self.assertFalse(self.store.health()['available'])
        self.assertIsNone(self.store.validate_refinement('craft_sticks', None))
        self.assertFalse(self.store.save_refinement('craft_sticks', VERSION, None)['saved'])
        self.assertFalse(self.state.exists())
        with self.assertRaisesRegex(PracticeError, 'uninitialized'):
            self.store.begin(self.job, BODY)
        self.assertFalse(self.state.exists())

    def test_objectives_are_strict_bounded_data(self):
        self.assertIsNone(validate_objective(None))
        self.assertEqual(validate_objective(OBJECTIVE), OBJECTIVE)
        bad = [[], {}, {'description': '', 'checks': []}, dict(OBJECTIVE, passed=True),
               dict(OBJECTIVE, description='x' * 601), dict(OBJECTIVE, checks=[]),
               dict(OBJECTIVE, checks=OBJECTIVE['checks'] * 3),
               {'description': 'x', 'checks': [{'kind': 'python', 'code': '1'}]}]
        for kind, field, maximum in (('inventory_gain', 'item', 4096), ('action_completed', 'tool', 32)):
            base = {'kind': kind, field: 'minecraft:stick' if field == 'item' else 'craft', 'count': 1}
            for count in (True, False, 0, -1, maximum + 1, 1.5, '1', None):
                bad.append({'description': 'x', 'checks': [dict(base, count=count)]})
            bad.append({'description': 'x', 'checks': [dict(base, extra=1)]})
            bad.append({'description': 'x', 'checks': [dict(base, **{field: 'shell'})]})
        for value in bad:
            with self.subTest(value=value), self.assertRaises(PracticeError):
                validate_objective(value)

    def test_deterministic_identity_and_existing_begin_preserve_initial_observation(self):
        result = self.begin()
        self.assertEqual(result['runId'], run_id('craft_sticks', VERSION, TURN))
        self.assertTrue(result['created'])
        before = self.bytes()
        later = self.receipt()['after']
        self.assertFalse(self.store.begin(self.job, later)['created'])
        self.assertEqual(self.bytes(), before)
        other = dict(self.job, objective=None)
        with self.assertRaisesRegex(PracticeError, 'binding_mismatch'):
            self.store.begin(other, BODY)
        with self.assertRaisesRegex(PracticeError, 'binding_mismatch'):
            self.store.begin(dict(self.job, practiceRunId='b' * 64), BODY)

    def test_success_has_independent_objective_and_never_mastery(self):
        self.begin()
        self.step()
        self.store.capture(self.job['practiceRunId'], STEP_TURN, [self.receipt()])
        result = self.finish()
        self.assertTrue(result['programReportedDone'])
        self.assertTrue(result['evidenceComplete'])
        self.assertTrue(result['objectiveObserved'])
        self.assertEqual(result['ownConfirmedActions'], 1)
        self.assertFalse(result['masteryVerified'])
        self.assertTrue(all(not check['causalAttributionVerified'] for check in result['checks']))
        self.assertFalse(self.finish()['changed'])

    def test_done_and_existing_inventory_without_actions_are_not_success(self):
        self.begin()
        result = self.finish()
        self.assertTrue(result['programReportedDone'])
        self.assertFalse(result['evidenceComplete'])
        self.assertFalse(result['objectiveObserved'])
        self.assertEqual(result['ownConfirmedActions'], 0)
        self.assertFalse(result['masteryVerified'])

    def test_successful_actions_do_not_make_unmet_inventory_goal_true(self):
        self.begin()
        self.step()
        self.store.capture_turn(STEP_TURN, [self.receipt()])
        result = self.finish(BODY)
        self.assertTrue(result['evidenceComplete'])
        self.assertFalse(result['objectiveObserved'])
        self.assertEqual(result['ownConfirmedActions'], 1)

    def test_none_objective_remains_unknown_even_with_success(self):
        self.job['objective'] = None
        self.begin()
        self.step()
        self.store.capture_turn(STEP_TURN, [self.receipt()])
        self.assertIsNone(self.finish()['objectiveObserved'])

    def test_pending_unknown_missing_and_observed_end_cannot_claim_success(self):
        for status in ('unknown', 'in_flight', 'observed_ended', 'effect_unconfirmed'):
            with self.subTest(status=status):
                job = self.make_job(turn='turn_' + status + '_0123456789')
                self.begin(job)
                turn = 'skill_' + status + '_0123456789'
                self.step(job, turn)
                receipt = self.receipt(status=status, turn=turn, action=hashlib.md5(status.encode()).hexdigest())
                receipt['result']['code'] = 'accepted'
                self.store.capture_turn(turn, [receipt])
                result = self.finish(job=job)
                self.assertFalse(result['evidenceComplete'])
                self.assertFalse(result['objectiveObserved'])
                self.assertEqual(result['ownConfirmedActions'], 0)
        job = self.make_job(turn='turn_missing_0123456789')
        self.begin(job)
        self.step(job, 'skill_missing_0123456789')
        self.store.capture_turn('skill_missing_0123456789', [])
        self.assertFalse(self.finish(job=job)['evidenceComplete'])

    def test_known_failure_is_complete_and_check_is_false(self):
        self.begin()
        self.step()
        self.store.capture_turn(STEP_TURN, [self.receipt(status='failed', success=False)])
        result = self.finish()
        self.assertTrue(result['evidenceComplete'])
        self.assertFalse(result['objectiveObserved'])
        self.assertEqual(result['ownConfirmedActions'], 0)

    def test_known_reply_with_unavailable_after_snapshot_uses_only_independent_final_inventory(self):
        self.begin()
        self.step()
        receipt = self.receipt()
        receipt['after'] = {'ok': False, 'observedAt': 1000010}
        for field, foreign in (('bodyUuid', '11111111-1111-1111-1111-111111111111'),
                               ('dimension', 'minecraft:the_nether')):
            tampered = copy.deepcopy(receipt)
            tampered['after'][field] = foreign
            with self.subTest(field=field), self.assertRaisesRegex(PracticeError, 'body_mismatch'):
                self.store.capture_turn(STEP_TURN, [tampered])
        captured = self.store.capture_turn(STEP_TURN, [receipt])
        self.assertEqual(captured['ownConfirmedActions'], 1)
        self.assertTrue(captured['evidenceComplete'])
        final = self.finish(BODY)
        self.assertFalse(final['objectiveObserved'])
        self.assertEqual(final['checks'][0]['observed'], 0)
        step = self.store.read('craft_sticks', VERSION)['runs'][0]['steps'][0]
        self.assertNotIn('after', step)
        self.assertEqual(step['receiptSha256'], hashlib.sha256(json.dumps(
            receipt, sort_keys=True, ensure_ascii=True, allow_nan=False,
            separators=(',', ':')).encode()).hexdigest())

    def test_identical_receipt_is_idempotent_and_terminal_changes_are_rejected(self):
        self.begin()
        self.step()
        receipt = self.receipt()
        self.assertTrue(self.store.capture_turn(STEP_TURN, [receipt])['changed'])
        before = self.bytes()
        self.assertFalse(self.store.capture_turn(STEP_TURN, [receipt])['changed'])
        self.assertEqual(self.bytes(), before)
        receipt['result']['result']['message'] = 'a new conclusion'
        with self.assertRaisesRegex(PracticeError, 'terminal_receipt_changed'):
            self.store.capture_turn(STEP_TURN, [receipt])

    def test_restart_late_receipt_settles_original_finished_run_and_frozen_observation(self):
        self.begin()
        self.step()
        pending = self.receipt(status='in_flight')
        self.store.capture_turn(STEP_TURN, [pending])
        self.assertFalse(self.finish()['objectiveObserved'])
        self.store = PracticeStore(self.state, clock=lambda: 2000)
        other = self.make_job(version='b' * 64, turn='turn_new_version_0123456')
        self.begin(other)
        final = self.store.capture_turn(STEP_TURN, [self.receipt()])
        self.assertEqual(final['runId'], self.job['practiceRunId'])
        self.assertTrue(final['objectiveObserved'])
        self.assertEqual(self.store.read('craft_sticks', 'b' * 64)['runs'][0]['ownConfirmedActions'], 0)
        self.finish(BODY)
        original = self.store.read('craft_sticks', VERSION)['runs'][0]
        self.assertEqual(original['finalObservation']['counts']['minecraft:stick'], 6)

    def test_wrong_version_body_turn_args_and_action_identity_are_rejected(self):
        self.begin()
        self.step()
        for mutation in (
            lambda r: r.update(turnId='skill_wrong_turn_0123456'),
            lambda r: r.update(tool='mine'),
            lambda r: r['args'].update(count=8),
            lambda r: r['before'].update(bodyUuid='11111111-1111-1111-1111-111111111111'),
            lambda r: r['after'].update(dimension='minecraft:the_nether'),
        ):
            receipt = self.receipt()
            mutation(receipt)
            with self.subTest(receipt=receipt), self.assertRaises(PracticeError):
                self.store.capture_turn(STEP_TURN, [receipt])
        self.store.capture_turn(STEP_TURN, [self.receipt()])
        with self.assertRaisesRegex(PracticeError, 'action_changed'):
            self.store.capture_turn(STEP_TURN, [self.receipt(action='3' * 32)])
        other = self.make_job(version='b' * 64, turn='turn_new_version_0123456')
        self.begin(other)
        with self.assertRaisesRegex(PracticeError, 'turn_already_bound'):
            self.step(other)
        with self.assertRaisesRegex(PracticeError, 'run_binding_mismatch'):
            self.store.finish(self.job['practiceRunId'], dict(other, status='done'), BODY)

    def test_navigation_requires_original_task_and_epoch_terminal(self):
        args = {'x': 4, 'y': 64, 'z': 0}
        self.begin()
        self.step(tool='goto', args=args)
        receipt = self.receipt(status='in_flight', tool='goto', args=args)
        receipt['nativeTaskId'] = 't123'
        receipt['before']['navigationEpoch'] = 'epoch-1'
        self.store.capture_turn(STEP_TURN, [receipt])
        receipt.update(status='completed', completionConfirmed=True,
                       navigationOutcome={'task_id': 't123', 'navigation_epoch': 'epoch-2', 'success': True})
        with self.assertRaisesRegex(PracticeError, 'native_identity_mismatch'):
            self.store.capture_turn(STEP_TURN, [receipt])
        receipt['navigationOutcome']['navigation_epoch'] = 'epoch-1'
        self.assertEqual(self.store.capture_turn(STEP_TURN, [receipt])['ownConfirmedActions'], 1)

    def observed_navigation_receipt(self, arrived=True, args=None):
        args = args or {'x': 4, 'y': 64, 'z': 0}
        receipt = self.receipt(status='completed' if arrived else 'failed', tool='goto', args=args)
        receipt.update(nativeTaskId='t286', acceptedAt=1000001, observedAt=1000020)
        receipt['before']['navigationEpoch'] = None
        receipt['after'].update(position={'x': 4 if arrived else 1, 'y': 64, 'z': 0},
                                navigationEpoch=None, observedAt=1000010,
                                task={'busy': False, 'completionConfirmed': False})
        receipt['result'].update(ok=True, code='accepted', actionId=ACTION, tool='goto')
        receipt['result']['result'] = {'success': True, 'data': {'async': True, 'task_id': 't286', 'task': 'goto'}}
        receipt['navigationOutcome'] = {'task_id': 't286', 'state': 'ended', 'success': arrived,
            'navigation_mode': 'observed_from_body', 'final_x': receipt['after']['position']['x'],
            'final_y': 64, 'final_z': 0, 'requested': dict(args), 'horizontalDistance': 0 if arrived else 3}
        return receipt

    def test_observed_navigation_null_epoch_settles_exact_receipt_not_program_goal(self):
        self.job['objective'] = None
        self.begin()
        receipt = self.observed_navigation_receipt()
        self.step(tool='goto', args=receipt['args'])
        result = self.store.capture_turn(STEP_TURN, [receipt])
        self.assertTrue(result['evidenceComplete'])
        self.assertEqual(result['ownConfirmedActions'], 1)
        job = dict(self.job, status='replan')
        result = self.store.finish(job['practiceRunId'], job, receipt['after'])
        self.assertFalse(result['programReportedDone'])
        self.assertIsNone(result['objectiveObserved'])
        self.assertFalse(self.store.capture_turn(STEP_TURN, [receipt])['changed'])

    def test_observed_navigation_known_nonarrival_is_failure_not_success(self):
        self.begin()
        receipt = self.observed_navigation_receipt(arrived=False)
        self.step(tool='goto', args=receipt['args'])
        result = self.store.capture_turn(STEP_TURN, [receipt])
        self.assertTrue(result['evidenceComplete'])
        self.assertEqual(result['ownConfirmedActions'], 0)

    def test_observed_navigation_requires_exact_admission_idle_body_and_actual_arrival(self):
        self.begin()
        valid = self.observed_navigation_receipt()
        self.step(tool='goto', args=valid['args'])
        mutations = [
            lambda r: r.update(status='unknown'),
            lambda r: r.update(status='effect_unconfirmed'),
            lambda r: r.update(completionConfirmed=False),
            lambda r: r['before'].update(navigationEpoch='lost-epoch'),
            lambda r: r['after'].update(navigationEpoch='new-epoch'),
            lambda r: r['after']['task'].update(busy=True),
            lambda r: r['after']['task'].update(task_id='another-task'),
            lambda r: r['after'].update(observedAt=999999),
            lambda r: r.update(observedAt=999999),
            lambda r: r['result'].update(actionId='f' * 32),
            lambda r: r['result'].update(code='outcome_unknown'),
            lambda r: r['result']['result']['data'].update(task_id='other-task'),
            lambda r: r['result']['result']['data'].update(**{'async': False}),
            lambda r: r['navigationOutcome'].update(task_id='other-task'),
            lambda r: r['navigationOutcome'].update(navigation_epoch='fake-epoch'),
            lambda r: r['navigationOutcome'].update(final_x=5),
            lambda r: r['navigationOutcome'].update(horizontalDistance=1),
            lambda r: r['navigationOutcome']['requested'].update(x=6),
            lambda r: r['navigationOutcome'].update(success=False),
            lambda r: (r['after']['position'].update(x=1), r['navigationOutcome'].update(final_x=1, horizontalDistance=3)),
            lambda r: (r['after']['position'].update(y=65), r['navigationOutcome'].update(final_y=65)),
        ]
        for i, mutate in enumerate(mutations):
            receipt = copy.deepcopy(valid)
            mutate(receipt)
            with self.subTest(mutation=i), self.assertRaises(PracticeError):
                self.store.capture_turn(STEP_TURN, [receipt])
        self.assertFalse(self.finish()['evidenceComplete'])

    def test_replan_observed_navigation_auto_finalizes_and_releases_mailbox_claim(self):
        from types import SimpleNamespace
        from controller import Controller
        from motor_loop import reconcile
        from numen_gateway import read_json, write_json
        self.job = self.make_job(name='base_navigate', objective=None)
        self.begin()
        receipt = self.observed_navigation_receipt()
        self.step(tool='goto', args=receipt['args'])
        job = dict(self.job, status='replan', reason='navigation_no_supported_progress',
                   practiceStarted=True, motorRequestId='request-navigation', lastTurnId=STEP_TURN,
                   lastExecution={'turnId': STEP_TURN, 'actionId': ACTION,
                                  'status': 'succeeded', 'completionConfirmed': True})
        write_json(self.state / 'skill-job.json', job)
        write_json(self.state / 'motor-inbox.json', {'schema': 1, 'requests': [
            {'requestId': job['motorRequestId'], 'kind': 'skill', 'status': 'claimed'},
            {'requestId': 'next-move', 'kind': 'action', 'status': 'queued'}]})
        events = []
        context = SimpleNamespace(root=self.state, practice=self.store, data={'practiceWarning': 'PracticeError'},
            gateway=SimpleNamespace(snapshot=lambda: copy.deepcopy(receipt['after']),
                turn_receipts=lambda turn: [copy.deepcopy(receipt)] if turn == STEP_TURN else []),
            record=lambda kind, **values: events.append(kind),
            pause=lambda reason: self.fail('No unknown or world action expected: ' + reason))
        Controller.settle_practice(context)
        Controller.settle_practice(context)
        self.assertTrue(read_json(self.state / 'skill-job.json')['practiceFinalized'])
        self.assertNotIn('practiceWarning', context.data)
        self.assertEqual(events, ['practice_recorded'])
        reconcile(context)
        rows = read_json(self.state / 'motor-inbox.json')['requests']
        self.assertEqual(rows[0]['status'], 'failed')
        self.assertEqual(rows[0]['receipt']['status'], 'replan')
        self.assertEqual(rows[1]['status'], 'queued')

    def test_false_completed_and_unknown_success_flags_are_not_evidence(self):
        self.begin()
        self.step()
        receipt = self.receipt()
        receipt['result']['code'] = 'outcome_unknown'
        result = self.store.capture_turn(STEP_TURN, [receipt])
        self.assertFalse(result['evidenceComplete'])
        self.assertEqual(result['ownConfirmedActions'], 0)

    def test_refinement_links_real_parent_versions_but_never_observes_expectation(self):
        self.begin()
        value = {'run_ids': [self.job['practiceRunId']], 'hypothesis': 'Check the recipe before crafting.',
                 'expected_outcome': 'Four sticks will be made.'}
        before = self.bytes()
        self.assertEqual(self.store.validate_refinement('craft_sticks', value), value)
        self.assertEqual(self.bytes(), before)
        saved = self.store.save_refinement('craft_sticks', 'b' * 64, value)
        self.assertTrue(saved['saved'])
        self.assertFalse(saved['expectedOutcomeObserved'])
        self.assertFalse(self.store.save_refinement('craft_sticks', 'b' * 64, value)['changed'])
        unpracticed = self.store.read('craft_sticks', 'b' * 64)
        self.assertEqual(unpracticed['runs'], [])
        self.assertEqual(len(unpracticed['refinements']), 1)
        other = self.make_job(version='b' * 64, turn='turn_new_version_0123456')
        self.begin(other)
        evidence = self.store.read('craft_sticks', 'b' * 64)['runs'][0]['refinements'][0]
        self.assertEqual(evidence['parentRuns'], [{'runId': self.job['practiceRunId'], 'version': VERSION}])
        self.assertEqual(evidence['evidenceType'], 'agent_reported')
        self.assertFalse(evidence['independentlyVerified'])
        self.assertFalse(evidence['expectedOutcomeObserved'])

    def test_refinement_rejects_missing_foreign_duplicate_and_invented_evidence(self):
        self.begin()
        value = {'run_ids': [self.job['practiceRunId']], 'hypothesis': 'h', 'expected_outcome': 'e'}
        bad = [dict(value, run_ids=[]), dict(value, run_ids=['f' * 64]),
               dict(value, run_ids=value['run_ids'] * 2), dict(value, hypothesis='x' * 801),
               dict(value, expected_outcome='x' * 601), dict(value, passed=True)]
        for item in bad:
            with self.subTest(item=item), self.assertRaises(PracticeError):
                self.store.validate_refinement('craft_sticks', item)
        with self.assertRaisesRegex(PracticeError, 'skill_mismatch'):
            self.store.validate_refinement('different_skill', value)

    def test_reads_are_bounded_do_not_write_and_health_has_no_text_or_identity(self):
        self.begin()
        for i in range(10):
            turn = 'skill_' + str(i).zfill(32)
            self.step(turn=turn)
        before = self.bytes()
        row = self.store.read('craft_sticks', VERSION)['runs'][0]
        self.assertEqual(len(row['steps']), 8)
        self.assertTrue(row['stepsTruncated'])
        health = self.store.health()
        self.assertEqual(set(health), {'available', 'schema', 'runCount', 'stepCount', 'receiptCount', 'refinementCount'})
        self.assertEqual(health['stepCount'], 10)
        self.assertEqual(self.bytes(), before)
        for limit in (0, 4, True, 1.2):
            with self.assertRaises(PracticeError):
                self.store.summarize(limit=limit)

    def test_schema_mismatch_and_malformed_json_fail_explicitly(self):
        self.begin()
        with self.assertRaises(PracticeError):
            self.store.step(self.job['practiceRunId'], 's', STEP_TURN, 'craft', {'count': float('nan')})
        with closing(sqlite3.connect(self.store.path)) as db:
            db.execute('PRAGMA user_version=99')
        with self.assertRaisesRegex(PracticeError, 'schema_mismatch'):
            self.store.health()
        with self.assertRaisesRegex(PracticeError, 'schema_mismatch'):
            self.store.initialize()

    def test_food_terminal_must_match_original_native_receipt(self):
        args = {'item_id': 'minecraft:bread'}
        self.begin()
        self.step(tool='eat', args=args)
        receipt = self.receipt(status='in_flight', tool='eat', args=args)
        native = {'epoch': 'food-epoch', 'actorUuid': BODY_ID, 'requestId': ACTION,
                  'tool': 'eat', 'args': args, 'nativeTaskId': 't44', 'status': 'accepted'}
        receipt['result']['result']['nativeFoodReceipt'] = native
        receipt['nativeTaskId'] = 't44'
        self.store.capture_turn(STEP_TURN, [receipt])
        receipt.update(status='completed', completionConfirmed=True)
        receipt['nativeFoodOutcome'] = dict(native, status='terminal', nativeState='SUCCESS',
                                          result={'success': True})
        tampered = copy.deepcopy(receipt)
        tampered['nativeFoodOutcome']['epoch'] = 'new-epoch'
        with self.assertRaisesRegex(PracticeError, 'native_identity_mismatch'):
            self.store.capture_turn(STEP_TURN, [tampered])
        self.assertEqual(self.store.capture_turn(STEP_TURN, [receipt])['ownConfirmedActions'], 1)

    def test_old_action_id_cannot_be_rebound_to_new_version_new_turn(self):
        self.begin()
        self.step()
        self.store.capture_turn(STEP_TURN, [self.receipt()])
        other = self.make_job(version='b' * 64, turn='turn_new_version_0123456')
        self.begin(other)
        new_turn = 'skill_' + '4' * 32
        self.step(other, new_turn)
        with self.assertRaisesRegex(PracticeError, 'receipt_identity_changed'):
            self.store.capture_turn(new_turn, [self.receipt(turn=new_turn)])
        fresh = self.store.read('craft_sticks', 'b' * 64)['runs'][0]
        self.assertEqual(fresh['ownConfirmedActions'], 0)
        self.assertEqual(self.store.health()['receiptCount'], 1)

    def test_initialized_reads_and_noop_initialization_keep_bytes(self):
        self.begin()
        before = self.bytes()
        self.store.initialize()
        self.assertEqual(self.bytes(), before)
        for method in (lambda: self.store.summarize(), lambda: self.store.health(),
                       lambda: self.store.read('craft_sticks', VERSION)):
            method()
        self.assertEqual(self.bytes(), before)

    def test_turns_preserve_exact_order_across_restart_and_isolate_runs_without_writes(self):
        self.begin()
        turns = ['skill_' + str(i).zfill(32) for i in (9, 2, 7)]
        self.step(turn=turns[0])
        other = self.make_job(version='b' * 64, turn='turn_new_version_0123456')
        self.begin(other)
        foreign_turn = 'skill_' + '8' * 32
        self.step(other, foreign_turn)
        for turn in turns[1:]:
            self.step(turn=turn)
        self.finish()
        before = self.bytes()
        restarted = PracticeStore(self.state)
        self.assertEqual(restarted.turns(self.job['practiceRunId']), turns)
        self.assertEqual(restarted.turns(other['practiceRunId']), [foreign_turn])
        with self.assertRaisesRegex(PracticeError, 'run_missing'):
            restarted.turns('c' * 64)
        with self.assertRaisesRegex(PracticeError, 'invalid_run_id'):
            restarted.turns('../not-a-run')
        self.assertEqual(self.bytes(), before)

    def test_turn_recovery_includes_all_128_attempts_beyond_detail_window(self):
        self.begin()
        turns = ['skill_' + str(i).zfill(32) for i in range(128)]
        for turn in turns:
            self.step(turn=turn)
        with self.assertRaisesRegex(PracticeError, 'step_limit'):
            self.step(turn='skill_' + '9' * 32)
        before = self.bytes()
        self.assertEqual(self.store.turns(self.job['practiceRunId']), turns)
        self.assertEqual(len(self.store.read('craft_sticks', VERSION)['runs'][0]['steps']), 8)
        self.assertEqual(self.bytes(), before)


if __name__ == '__main__':
    unittest.main()

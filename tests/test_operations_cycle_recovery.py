from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'world/ops'))
from reconcile_operations_cycles import (verify_abandoned, verify_native_cancelled,
    restore_schedules, pause_schedule, reconciliation_evidence)


class OperationsCycleRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.idle = {'status': 'idle', 'running_task_count': 0}
        self.row = {'status': 'cron_reserved', 'taskId': None, 'startedAt': 10,
                    'source': 'native-qwen-world-cron'}

    def test_old_cron_reservation_can_be_classified_without_claiming_success(self):
        original = dict(self.row)
        verify_abandoned(self.row, 20, self.idle)
        self.assertEqual(self.row, original)

    def test_native_background_task_never_released_by_age_or_missing_result(self):
        for fields in ({'taskId': 'task-old'}, {'status': 'submission_uncertain'}, {'source': 'other'}):
            with self.subTest(fields=fields), self.assertRaises(ValueError):
                verify_abandoned(self.row | fields, 20, self.idle)

    def test_new_or_active_work_is_not_released(self):
        for start in (10, 5):
            with self.assertRaises(ValueError):
                verify_abandoned(self.row, start, self.idle)
        for status in ({'status': 'running', 'running_task_count': 1}, {'status': 'idle'},
                       {'status': 'disabled', 'running_task_count': 0}):
            with self.assertRaises(ValueError):
                verify_abandoned(self.row, 20, status)

    def test_only_old_unresolved_cycles_are_reconciled(self):
        for status in ('running', 'unknown'):
            verify_abandoned({'status': status, 'at': 10}, 20, self.idle, cycle=True)
        for row in ({'status': 'completed', 'at': 10}, {'status': 'running', 'at': 25},
                    {'status': 'unknown'}):
            with self.assertRaises(ValueError):
                verify_abandoned(row, 20, self.idle, cycle=True)

    def test_native_cancellation_requires_exact_job_session_and_execution_interval(self):
        from world_team_schedule import team_job
        job = team_job('operations:mc-god')
        trace = {'status': 'cancelled', 'error': 'execution cancelled', 'created_at': 11, 'completed_at': 12,
            'meta': {'job_id': job['id'], 'task_type': 'agent',
                'target_session_id': job['dispatch']['target']['session_id'],
                'target_user_id': job['dispatch']['target']['user_id']}}
        row = self.row | {'jobId': job['id']}
        verify_native_cancelled(trace, row, job)
        verify_native_cancelled(trace, {'status': 'unknown', 'at': 13}, job, cycle=True)
        for other in (trace | {'status': 'success'}, trace | {'completed_at': None},
                      trace | {'meta': trace['meta'] | {'target_session_id': 'other'}}):
            with self.assertRaises(ValueError):
                verify_native_cancelled(other, row, job)
        with self.assertRaises(ValueError):
            verify_native_cancelled(trace, row | {'startedAt': 0}, job)

    def test_lost_pause_response_keeps_persisted_restore_intent(self):
        intents, saved = [], []
        def lost(*args):
            self.assertEqual(saved, [['actor']])
            raise TimeoutError('unknown pause acknowledgement')
        with self.assertRaises(TimeoutError):
            pause_schedule('actor', {'actor': 'job'}, {'actor': {'agentId': 'native'}}, intents,
                           lambda: saved.append(list(intents)), call=lost)
        self.assertEqual(intents, ['actor'])

    def test_one_failed_restore_does_not_skip_others_or_retry_uncertain_put(self):
        actors = ['first', 'second']
        jobs = {a: a + '-job' for a in actors}
        roles = {a: {'runtime': 'game', 'agentId': a} for a in actors}
        specs = {a: {'spec': {'id': jobs[a], 'enabled': True}} for a in actors}
        put_calls = []
        def call(method, route, role, payload=None):
            if method == 'PUT':
                put_calls.append(role)
                if role == 'first': raise TimeoutError('unknown PUT acknowledgement')
            return {'spec': specs[role]['spec'], 'state': {'next_run_at': 'future'}}
        restored, errors = restore_schedules(actors, jobs, roles, specs, call=call)
        self.assertEqual(put_calls, actors)
        self.assertEqual([r['host']['agentId'] for r in restored], ['second'])
        self.assertEqual([r['host']['agentId'] for r in errors], ['first'])

    def test_mixed_recovery_keeps_each_records_actual_terminal_evidence(self):
        from world_team_schedule import team_job
        engineer, goddess = team_job('operations:mc-god'), team_job('game:mc-god')
        trace = {'run_id': 'exact-trace', 'status': 'cancelled', 'error': 'execution cancelled',
            'created_at': 11, 'completed_at': 12, 'meta': {'job_id': engineer['id'], 'task_type': 'agent',
                'target_session_id': engineer['dispatch']['target']['session_id'],
                'target_user_id': engineer['dispatch']['target']['user_id']}}
        old = reconciliation_evidence({'status': 'running', 'at': 1}, goddess, 5, self.idle, trace, cycle=True)
        cancelled = reconciliation_evidence({'status': 'unknown', 'at': 13}, engineer, 5, self.idle, trace, cycle=True)
        self.assertEqual(old, {'terminalEvidence': 'previous_native_process_ended_and_current_idle'})
        self.assertEqual(cancelled['nativeTraceId'], 'exact-trace')


if __name__ == '__main__':
    unittest.main()

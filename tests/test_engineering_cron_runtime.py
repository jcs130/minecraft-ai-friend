"""No live models/services: use the pinned native executor and synthetic streams."""
import asyncio
from contextlib import ExitStack
from copy import deepcopy
import importlib.util
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/ops'))
import engineering_cron_runtime as policy
import world_team_schedule as schedule
from world_team import TeamStore


class EngineeringDeadlineTests(unittest.IsolatedAsyncioTestCase):
    def native(self):
        try:
            from qwenpaw.app.crons.models import CronJobSpec
            from qwenpaw.app.crons.executor import CronExecutor
            import qwenpaw.app.crons.executor as native
        except ImportError:
            self.skipTest('Requires pinned QwenPaw image')
        return CronJobSpec, CronExecutor, native

    def test_policy_scoped_and_no_persisted_model_mutation(self):
        Job, _, _ = self.native()
        for actor in schedule.SCHEDULES:
            job = Job.model_validate(schedule.team_job(actor))
            before = job.model_dump(mode='json')
            effective = policy.execution_job(job, actor)
            self.assertEqual(job.model_dump(mode='json'), before)
            expected = None if actor == policy.ACTOR else before['runtime']['timeout_seconds']
            self.assertEqual(effective.runtime.timeout_seconds, expected)
            effective_doc = effective.model_dump(mode='json')
            effective_doc['runtime']['timeout_seconds'] = before['runtime']['timeout_seconds']
            self.assertEqual(effective_doc, before)
        spec = schedule.team_job(policy.ACTOR)
        spec['meta'].pop('engineeringExecution')
        with self.assertRaisesRegex(ValueError, 'engineering_execution_policy_missing'):
            policy.execution_policy(spec, policy.ACTOR)

    def test_native_schema_requires_compatibility_value_and_pinned_contract(self):
        Job, Executor, _ = self.native()
        for invalid in (None, 0):
            spec = schedule.team_job(policy.ACTOR)
            spec['runtime']['timeout_seconds'] = invalid
            with self.assertRaises(ValueError):
                Job.model_validate(spec)
        policy.check_native_contract(Executor.execute)
        with patch.object(policy.inspect, 'getsource', return_value='changed contract'):
            with self.assertRaisesRegex(ValueError, 'review_engineering_native_timeout_contract'):
                policy.check_native_contract(Executor.execute)

    async def test_real_native_executor_has_no_deadline_and_cancel_still_finalizes(self):
        Job, Executor, native = self.native()
        seen_requests, timeouts = [], []
        entered = asyncio.Event()
        never = asyncio.Event()
        async def stream(req):
            seen_requests.append(req)
            entered.set()
            await never.wait()
            if False:
                yield None
        workspace = SimpleNamespace(agent_id='qd-engineer', stream_query=stream)
        executor = Executor(workspace=workspace, channel_manager=SimpleNamespace())
        original_wait = asyncio.wait_for
        async def wait(awaitable, timeout):
            timeouts.append(timeout)
            return await original_wait(awaitable, timeout)
        finalize = AsyncMock()
        with ExitStack() as stack:
            for name in ('read_session_messages', 'create_trace', 'append_trace_from_session_delta'):
                stack.enter_context(patch.object(native, name, AsyncMock(return_value=[])))
            stack.enter_context(patch.object(native, 'finalize_trace', finalize))
            stack.enter_context(patch.object(native.asyncio, 'wait_for', wait))
            job = Job.model_validate(schedule.team_job(policy.ACTOR))
            task = asyncio.create_task(executor.execute(policy.execution_job(job, policy.ACTOR)))
            await entered.wait()
            # Native wait_for is still used, with no timer. Its normal external
            # cancellation path finalizes the same trace; no fake huge timeout.
            self.assertEqual(timeouts, [None])
            self.assertFalse(task.done())
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
        self.assertEqual(finalize.await_args.kwargs['status'], 'cancelled')
        self.assertEqual(len(seen_requests), 1)
        self.assertEqual(seen_requests[0]['session_id'], 'world-team-operations-mc-god:cron:qd-team-engineer')
        self.assertEqual(job.runtime.max_concurrency, 1)
        self.assertEqual(job.runtime.timeout_seconds, 360)

    async def test_running_engineer_does_not_overlap_or_replay_unknown(self):
        try:
            import fcntl
        except ImportError:
            self.skipTest('Production Linux flock contract')
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            goddess = TeamStore('game:mc-god', root)
            issue = goddess.report('report-one', 'case-one', 'Fixture defect', 'bug',
                                   'Observed', 'Expected', ['fixture:1'])
            goddess.update('route-one', issue['caseId'], 1, 'working', 'Assigned',
                           ['fixture:1'], policy.ACTOR)
            spec = schedule.team_job(policy.ACTOR)
            job = SimpleNamespace(id=spec['id'], model_dump=lambda **kw: spec)
            executor = SimpleNamespace(_workspace=SimpleNamespace(agent_id='mc-god'))
            entered, release = asyncio.Event(), asyncio.Event()
            calls = []
            async def native_turn(executor, effective):
                calls.append(effective.runtime.timeout_seconds)
                entered.set()
                await release.wait()
                raise RuntimeError('unknown transport state')
            native = SimpleNamespace(reserve_operation=lambda *a: {'ok': True, 'runId': 'only-lease'},
                                     finish_run=lambda *a, **kw: self.fail('unknown lease cleared'))
            with patch.dict(sys.modules, {'operations_native_tasks': native}), \
                    patch.object(schedule, 'TeamStore', lambda actor: TeamStore(actor, root)), \
                    patch.object(schedule, 'logical_actor', return_value=policy.ACTOR), \
                    patch.object(schedule, 'require_host'):
                running = asyncio.create_task(schedule.execute(executor, job, native_turn, 'operations'))
                await entered.wait()
                # Equivalent to a later Cron signal while the first run is
                # still waiting: original flock and durable cycle remain held.
                second = await schedule.execute(executor, job, native_turn, 'operations')
                self.assertEqual(second['final_text'], 'team_cycle_already_running')
                self.assertEqual(calls, [None])
                release.set()
                with self.assertRaises(RuntimeError):
                    await running
                third = await schedule.execute(executor, job, native_turn, 'operations')
                self.assertEqual(third['final_text'], 'previous_team_cycle_requires_reconciliation')
                self.assertEqual(calls, [None])

    async def test_native_scheduler_keeps_one_instance_and_one_permit(self):
        Job, _, _ = self.native()
        from qwenpaw.app.crons.manager import CronManager
        manager = CronManager(repo=SimpleNamespace(), workspace=SimpleNamespace(),
                              channel_manager=SimpleNamespace(), agent_id='qd-engineer')
        manager._scheduler.start(paused=True)
        try:
            await manager._register_or_update(Job.model_validate(schedule.team_job(policy.ACTOR)))
            self.assertEqual(manager._scheduler.get_job(policy.JOB_ID).max_instances, 1)
            self.assertEqual(manager._rt[policy.JOB_ID].sem._value, 1)
        finally:
            manager._scheduler.shutdown(wait=False)
            await asyncio.sleep(0)

    def test_sync_preserves_enabled_session_and_other_jobs(self):
        module_spec = importlib.util.spec_from_file_location('configure_engineer_fixture', ROOT / 'tools/configure_world_team.py')
        module = importlib.util.module_from_spec(module_spec)
        module_spec.loader.exec_module(module)
        old = schedule.team_job(policy.ACTOR)
        old['enabled'] = False
        old['meta'].pop('engineeringExecution')
        old['text'] = 'old managed prompt'
        old['request']['input'][0]['content'][0]['text'] = old['text']
        before = deepcopy(old)
        updated = module.upgraded_engineering_job(old, policy.ACTOR)
        self.assertEqual(old, before)
        self.assertFalse(updated['enabled'])
        self.assertEqual(updated['dispatch'], before['dispatch'])
        self.assertEqual(updated['schedule'], before['schedule'])
        self.assertEqual(updated['runtime'], before['runtime'])
        self.assertEqual(updated['meta']['engineeringExecution'], policy.POLICY)
        other = schedule.team_job('game:mc-god')
        self.assertIs(module.upgraded_engineering_job(other, 'game:mc-god'), other)


class EngineeringOwnershipTests(unittest.TestCase):
    def setUp(self):
        self.now = 1800000000
        self.cycle = {'actor': policy.ACTOR, 'status': 'running', 'at': self.now - 86400,
                      'result': {'jobId': policy.JOB_ID}}
        self.reservation = {'runId': 'world-' + 'a' * 32, 'requestId': 'world-' + 'a' * 32,
            'role': 'mc-god', 'jobId': policy.JOB_ID, 'status': 'cron_reserved',
            'startedAt': self.cycle['at'] - 0.02, 'source': 'native-qwen-world-cron', 'taskId': None,
            'nativeHost': {'runtime': 'game', 'agentId': 'qd-engineer'}}

    def observe(self, **kwargs):
        return policy.running_ownership(self.cycle, [self.reservation],
            native_running=kwargs.get('native_running', True), lock_owned=kwargs.get('lock_owned', True), now=self.now)

    def test_long_running_is_valid_only_with_exact_live_ownership(self):
        value = self.observe()
        self.assertTrue(value['verified'])
        self.assertEqual(value['reservationRunId'], self.reservation['runId'])
        for flag in ('native_running', 'lock_owned'):
            self.assertFalse(self.observe(**{flag: False})['verified'])

    def test_native_overlap_skip_requires_its_precise_marker_and_original_owned_lock(self):
        state = {'last_status': 'skipped',
                 'last_error': 'skipped scheduled run at 2026-09-14T12:05:00+08:00: maximum running instances reached (1)'}
        self.assertEqual(policy.native_running_marker(state), 'max_instances_while_cycle_owned')
        self.assertFalse(self.observe(native_running=True, lock_owned=False)['verified'])
        for changed in ({'last_status': 'unknown'}, {'last_error': 'previous cycle requires reconciliation'},
                        {'last_error': 'maximum running instances reached (2)'}, {'last_status': 'success'}):
            self.assertIsNone(policy.native_running_marker(state | changed))

    def test_unknown_cycle_old_or_foreign_reservation_are_not_running_proof(self):
        for target, changes in (
                (self.cycle, {'status': 'unknown'}), (self.cycle, {'result': {'jobId': 'other-cron'}}),
                (self.reservation, {'status': 'unknown'}),
                (self.reservation, {'nativeHost': {'runtime': 'operations', 'agentId': 'mc-god'}}),
                (self.reservation, {'startedAt': self.cycle['at'] - 600}),
                (self.reservation, {'requestId': 'different-request'})):
            before = deepcopy(target)
            target.update(changes)
            self.assertFalse(self.observe()['verified'], changes)
            target.clear(); target.update(before)
        duplicate = policy.running_ownership(self.cycle, [self.reservation, deepcopy(self.reservation)],
                                            native_running=True, lock_owned=True, now=self.now)
        self.assertFalse(duplicate['verified'])

    def test_verified_daily_sibling_keeps_engineering_ownership_but_other_pending_does_not(self):
        from world_operations import JOB_ID as daily_job
        daily = {'role':'default','jobId':daily_job,'status':'cron_reserved','taskId':None,
            'nativeHost':{'runtime':'game','agentId':'qd-steward'},'source':'native-qwen-world-cron',
            'runId':'world-daily','requestId':'world-daily','startedAt':self.now-10,
            'parallelWithVerifiedRun':{'runId':self.reservation['runId'],'verifiedAt':self.now-11}}
        def observe(rows):
            return policy.running_ownership(self.cycle,rows,native_running=True,lock_owned=True,now=self.now)
        self.assertTrue(observe([self.reservation,daily])['verified'])
        for change in ({'status':'unknown'},{'role':'mc-god'},{'taskId':'task-other'},
                       {'parallelWithVerifiedRun':{'runId':'other','verifiedAt':self.now-11}},
                       {'startedAt':self.now-50},{'jobId':'qd-learning-default'},
                       {'nativeHost':{'runtime':'operations','agentId':'default'}}):
            self.assertFalse(observe([self.reservation,dict(daily,**change)])['verified'],change)
        self.assertFalse(observe([self.reservation,daily,deepcopy(daily)])['verified'])

    def test_kernel_lock_requires_exact_file_and_pid(self):
        try:
            import fcntl
        except ImportError:
            self.skipTest('Production Linux kernel lock ownership')
        import os
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'cycle.lock'
            with path.open('a+b') as lock:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                self.assertTrue(policy.guard_owns_cycle_lock(path, {'pid': os.getpid()}, Path('/proc')))
                self.assertFalse(policy.guard_owns_cycle_lock(path, {'pid': os.getpid() + 10000}, Path('/proc')))
                other = Path(tmp) / 'other.lock'; other.touch()
                self.assertFalse(policy.guard_owns_cycle_lock(other, {'pid': os.getpid()}, Path('/proc')))
                fcntl.flock(lock, fcntl.LOCK_UN)
                self.assertFalse(policy.guard_owns_cycle_lock(path, {'pid': os.getpid()}, Path('/proc')))

    def test_posix_lock_requires_exact_guard_descriptor_and_whole_file(self):
        try:
            import fcntl
        except ImportError:
            self.skipTest('Production Linux POSIX kernel lock ownership')
        import os
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'cycle.lock'
            other = Path(tmp) / 'other.lock'; other.touch()
            with path.open('a+b') as lock:
                marker = {'pid': os.getpid()}
                fcntl.lockf(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                self.assertTrue(policy.guard_owns_cycle_lock(path, marker, Path('/proc')))
                self.assertFalse(policy.guard_owns_cycle_lock(path, {'pid': os.getpid() + 10000}, Path('/proc')))
                self.assertFalse(policy.guard_owns_cycle_lock(other, marker, Path('/proc')))
                original = Path.read_text
                def without_fdinfo_locks(target, *args, **kwargs):
                    value = original(target, *args, **kwargs)
                    return '\n'.join(line for line in value.splitlines() if not line.startswith('lock:')) if target.parent.name == 'fdinfo' else value
                with patch.object(Path, 'read_text', without_fdinfo_locks):
                    self.assertFalse(policy.guard_owns_cycle_lock(path, marker, Path('/proc')))
                def without_global_locks(target, *args, **kwargs):
                    return '' if target == Path('/proc/locks') else original(target, *args, **kwargs)
                with patch.object(Path, 'read_text', without_global_locks):
                    self.assertFalse(policy.guard_owns_cycle_lock(path, marker, Path('/proc')))
                fcntl.lockf(lock, fcntl.LOCK_UN)
                self.assertFalse(policy.guard_owns_cycle_lock(path, marker, Path('/proc')))
                fcntl.lockf(lock, fcntl.LOCK_EX | fcntl.LOCK_NB, 1, 0)
                self.assertFalse(policy.guard_owns_cycle_lock(path, marker, Path('/proc')))
                fcntl.lockf(lock, fcntl.LOCK_UN)
                fcntl.lockf(lock, fcntl.LOCK_SH | fcntl.LOCK_NB)
                self.assertFalse(policy.guard_owns_cycle_lock(path, marker, Path('/proc')))

    def test_read_only_health_combines_guard_native_spec_and_original_ledgers(self):
        import json
        import sqlite3
        from contextlib import closing
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); state = root / 'work'; team = root / 'team'; team.mkdir()
            workspace = state / 'workspaces/qd-engineer'; workspace.mkdir(parents=True)
            job = schedule.team_job(policy.ACTOR)
            (state / 'learning-runtime.json').write_text(json.dumps({'engineeringCronRuntimeVersion': 1,
                'engineeringTaskRuntimeVersion': 1, 'pid': 1}))
            (workspace / 'jobs.json').write_text(json.dumps({'jobs': [job]}))
            ledger = root / 'delegations.json'; ledger.write_text(json.dumps([self.reservation]))
            with closing(sqlite3.connect(team / 'team.sqlite3')) as db, db:
                db.execute('CREATE TABLE cycles(actor,status,at,result)')
                db.execute('INSERT INTO cycles VALUES(?,?,?,?)', (self.cycle['actor'], self.cycle['status'],
                                                                self.cycle['at'], json.dumps(self.cycle['result'])))
            native = {'spec': deepcopy(job), 'state': {'last_status': 'running'}}
            before = {str(p): p.read_bytes() for p in root.rglob('*') if p.is_file()}
            with patch('role_learning_profiles.validate_guard', return_value=True), \
                    patch.object(policy, 'guard_owns_cycle_lock', return_value=True):
                result = policy.health(state, include_running=True, team=team, ledger=ledger,
                                       native=lambda: native, clock=lambda: self.now)
                self.assertTrue(result['runningEvidence']['verified'])
                native['state']['last_status'] = 'success'
                self.assertFalse(policy.health(state, include_running=True, team=team, ledger=ledger,
                                 native=lambda: native, clock=lambda: self.now)['runningEvidence']['verified'])
                native['spec']['enabled'] = not job['enabled']
                with self.assertRaisesRegex(ValueError, 'engineering_native_job_not_current'):
                    policy.health(state, include_running=True, team=team, ledger=ledger, native=lambda: native)
            self.assertEqual(before, {str(p): p.read_bytes() for p in root.rglob('*') if p.is_file()})


if __name__ == '__main__':
    unittest.main()

import asyncio
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

sys.path[:0] = [str(Path(__file__).resolve().parents[1] / 'world/ops')]
import world_team_schedule as schedule
from world_team import TeamStore
from world_team_profiles import persona_files


class TeamScheduleTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.calls = 0
        self.fcntl = types.SimpleNamespace(LOCK_EX=1, LOCK_NB=2, flock=lambda *a: None)
        self.native = types.SimpleNamespace(reserve_operation=lambda *a: {'ok': True, 'runId': 'run-1'},
                                            finish_run=lambda *a, **kw: None)

    async def asyncTearDown(self): self.tmp.cleanup()

    async def run_role(self, actor, callback=None):
        runtime, role = actor.split(':')
        spec = schedule.team_job(actor)
        job = types.SimpleNamespace(id=spec['id'], model_dump=lambda **kw: spec)
        executor = types.SimpleNamespace(_workspace=types.SimpleNamespace(agent_id=role))
        async def original(*args):
            self.calls += 1
            if callback: return await callback()
            return {'delivery_status': 'delivered', 'final_text': 'fixture'}
        with patch.dict(sys.modules, {'fcntl': self.fcntl, 'operations_native_tasks': self.native}), \
             patch.object(schedule, 'TeamStore', lambda a: TeamStore(a, self.root)):
            return await schedule.execute(executor, job, original, runtime)

    async def test_idle_engineer_does_not_call_model(self):
        result = await self.run_role('operations:mc-god')
        self.assertEqual(result['modelCalls'], 0)
        self.assertEqual(self.calls, 0)

    async def test_designer_daily_session_does_not_empty_repeat(self):
        await self.run_role('game:qd-guild-planner')
        self.assertEqual((await self.run_role('game:qd-guild-planner'))['modelCalls'], 0)
        self.assertEqual(self.calls, 1)

    async def test_native_timeout_is_terminal_but_unknown_is_not_replayed(self):
        async def timeout(): raise asyncio.TimeoutError()
        with self.assertRaises(asyncio.TimeoutError): await self.run_role('game:mc-god', timeout)
        self.assertEqual(TeamStore('game:mc-god', self.root).cycle_state()['status'], 'failed')
        async def unknown(): raise RuntimeError('connection lost')
        with self.assertRaises(RuntimeError): await self.run_role('game:mc-god', unknown)
        result = await self.run_role('game:mc-god')
        self.assertEqual(result['final_text'], 'previous_team_cycle_requires_reconciliation')
        self.assertEqual(self.calls, 2)

    async def test_shared_operations_reservation_can_block_engineer(self):
        goddess = TeamStore('game:mc-god', self.root)
        report = goddess.report('test-report', 'test-case', 'A reproducible bug', 'bug', 'Observed', 'Expected', ['fixture:1'])
        goddess.update('test-route', report['caseId'], 1, 'open', 'Route', ['fixture:1'], 'operations:mc-god')
        self.native.reserve_operation = lambda *args: {'ok': False, 'code': 'operations_task_pending'}
        result = await self.run_role('operations:mc-god')
        self.assertEqual(result['modelCalls'], 0)
        self.assertEqual(self.calls, 0)

    async def test_working_engineer_can_continue_without_fabricated_new_evidence(self):
        goddess = TeamStore('game:mc-god', self.root)
        report = goddess.report('test-report', 'test-case', 'A reproducible bug', 'bug', 'Observed', 'Expected', ['fixture:1'])
        goddess.update('test-route', report['caseId'], 1, 'working', 'Route', ['fixture:1'], 'operations:mc-god')
        await self.run_role('operations:mc-god')
        await self.run_role('operations:mc-god')
        self.assertEqual(self.calls, 2)

    async def test_inflight_evidence_does_not_get_acknowledged_before_engineer_reads_it(self):
        goddess = TeamStore('game:mc-god', self.root)
        report = goddess.report('test-report', 'test-case', 'A reproducible bug', 'bug', 'Observed', 'Expected', ['fixture:1'])
        goddess.update('test-route', report['caseId'], 1, 'blocked', 'Waiting for test', ['test:pending'], 'operations:mc-god')

        async def native_turn():
            # The current model chose its input before this independent result arrived.
            goddess.update('test-late-evidence', report['caseId'], 2, 'blocked',
                            'Native test has now finished; engineer has not read it', ['test:passed'])
            return {'delivery_status': 'suppressed', 'run_id': 'fixture-first'}

        await self.run_role('operations:mc-god', native_turn)
        await self.run_role('operations:mc-god')
        self.assertEqual(self.calls, 2)
        self.assertEqual((await self.run_role('operations:mc-god'))['final_text'], 'no_new_team_work')
        self.assertEqual(self.calls, 2)

    async def test_designer_assignment_arriving_during_native_turn_is_processed_next_cycle(self):
        goddess = TeamStore('game:mc-god', self.root)

        async def native_turn():
            report = goddess.report('test-late-report', 'test-late-case', 'A new content need', 'content',
                                    'Observed after the cycle selected input', 'Design a candidate', ['fixture:late'])
            goddess.update('test-late-route', report['caseId'], 1, 'open', 'Fresh assignment',
                            ['fixture:late'], 'game:qd-guild-planner')
            return {'delivery_status': 'suppressed', 'run_id': 'fixture-first'}

        await self.run_role('game:qd-guild-planner', native_turn)
        await self.run_role('game:qd-guild-planner')
        self.assertEqual(self.calls, 2)
        self.assertEqual((await self.run_role('game:qd-guild-planner'))['final_text'], 'no_new_team_work')
        self.assertEqual(self.calls, 2)

    def test_native_job_contract_rejects_cross_role_or_second_session(self):
        job = schedule.team_job('game:mc-god')
        schedule.validate_team_job(job, 'game:mc-god')
        with self.assertRaises(AssertionError): schedule.validate_team_job(job, 'operations:mc-god')
        job['runtime']['share_session'] = True
        with self.assertRaises(AssertionError): schedule.validate_team_job(job, 'game:mc-god')

    def test_persona_keeps_soul_and_user_text(self):
        existing = {'SOUL.md': 'User personality', 'AGENTS.md': 'User instructions', 'PROFILE.md': 'User profile'}
        changes = persona_files('game:qd-survivor', existing)
        self.assertNotIn('SOUL.md', changes)
        self.assertTrue(changes['AGENTS.md'].startswith('User instructions'))
        self.assertEqual(persona_files('game:qd-survivor', existing | changes), {})


if __name__ == '__main__': unittest.main()

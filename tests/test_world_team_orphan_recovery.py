"""Candidate tests: self-service orphan cycle reconciliation (case-704a09d2).

Not part of the fixed engineering checks baseline: pinned check files must stay
byte-identical to the administered plan, so this candidate coverage lives in a
separate file and is proposed for later baseline inclusion once accepted. The
harness intentionally mirrors tests/test_world_team_schedule.py so the file is
self-contained under the isolated runner.
"""
import asyncio
import json
from pathlib import Path
import sys
import tempfile
import time
import types
import unittest
from unittest.mock import patch

sys.path[:0] = [str(Path(__file__).resolve().parents[1] / 'world/ops')]
import world_team_schedule as schedule
from world_team import TeamStore, digest


class OrphanCycleRecoveryTests(unittest.IsolatedAsyncioTestCase):
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

    async def test_unknown_cycle_persists_self_retry_horizon(self):
        async def unknown(): raise RuntimeError('connection lost')
        with self.assertRaises(RuntimeError): await self.run_role('game:mc-god', unknown)
        row = TeamStore('game:mc-god', self.root).cycle_state()
        self.assertEqual(row['status'], 'unknown')
        self.assertEqual(json.loads(row['result'])['selfRetryAfterSeconds'], schedule.ORPHAN_CYCLE_AFTER)

    async def test_uncertain_cycle_inside_horizon_is_still_suppressed(self):
        async def unknown(): raise RuntimeError('container recycled mid-shift')
        with self.assertRaises(RuntimeError): await self.run_role('game:mc-god', unknown)
        row = TeamStore('game:mc-god', self.root).cycle_state()
        TeamStore('game:mc-god', self.root,
                  clock=lambda: time.time() - schedule.ORPHAN_CYCLE_AFTER + 30
                  ).save_cycle(row['fingerprint'], 'unknown', json.loads(row['result']))
        result = await self.run_role('game:mc-god')
        self.assertEqual(result['final_text'], 'previous_team_cycle_requires_reconciliation')
        self.assertEqual(self.calls, 1)

    async def test_recycled_running_shift_self_reconciles_and_retries_on_next_shift(self):
        # case-704a09d2: a process recycled mid-shift leaves a running cycle behind;
        # once past the orphan horizon the next shift retries with no maintainer.
        killed = TeamStore('game:mc-god', self.root,
                           clock=lambda: time.time() - schedule.ORPHAN_CYCLE_AFTER - 60)
        killed.save_cycle(digest('killed-shift'), 'running', {'jobId': 'qd-team-goddess'})
        result = await self.run_role('game:mc-god')
        self.assertEqual(self.calls, 1)
        self.assertEqual(result['delivery_status'], 'delivered')
        receipt = result['reconciledOrphan']
        self.assertEqual(receipt['orphanStatus'], 'running')
        self.assertEqual(receipt['jobId'], 'qd-team-goddess')
        self.assertGreaterEqual(receipt['orphanAgeSeconds'], schedule.ORPHAN_CYCLE_AFTER + 60)
        row = TeamStore('game:mc-god', self.root).cycle_state()
        self.assertEqual(row['status'], 'completed')
        self.assertEqual(json.loads(row['result'])['reconciledOrphan'], receipt)

    async def test_reconciled_unknown_orphan_receipt_is_persisted_when_queue_blocks_retry(self):
        goddess = TeamStore('game:mc-god', self.root)
        report = goddess.report('test-orphan-report', 'test-orphan-case', 'A reproducible bug', 'bug',
                                'Observed', 'Expected', ['fixture:1'])
        goddess.update('test-orphan-route', report['caseId'], 1, 'open', 'Route',
                       ['fixture:1'], 'operations:mc-god')
        killed = TeamStore('operations:mc-god', self.root,
                           clock=lambda: time.time() - schedule.ORPHAN_CYCLE_AFTER - 60)
        killed.save_cycle(digest('killed-shift'), 'unknown',
                          {'jobId': 'qd-team-engineer', 'selfRetryAfterSeconds': schedule.ORPHAN_CYCLE_AFTER})
        self.native.reserve_operation = lambda *args: {'ok': False, 'code': 'operations_task_pending'}
        result = await self.run_role('operations:mc-god')
        self.assertEqual(result['final_text'], 'operations_task_pending')
        self.assertEqual(self.calls, 0)
        row = TeamStore('operations:mc-god', self.root).cycle_state()
        self.assertEqual(row['status'], 'failed')
        saved = json.loads(row['result'])
        self.assertTrue(saved['orphanReconciled'])
        self.assertEqual(saved['orphanStatus'], 'unknown')
        self.assertEqual(saved['jobId'], 'qd-team-engineer')
        self.assertEqual(saved['selfRetryAfterSeconds'], schedule.ORPHAN_CYCLE_AFTER)
        self.assertGreaterEqual(saved['orphanAgeSeconds'], schedule.ORPHAN_CYCLE_AFTER + 60)


if __name__ == '__main__': unittest.main()

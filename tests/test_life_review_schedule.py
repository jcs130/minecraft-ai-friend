import asyncio
from copy import deepcopy
import json
import importlib.util
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'world/ops'))
from life_review_schedule import JOB_ID, managed_job, validate_job, execute
from role_learning_profiles import validate_jobs
from agent_learning import managed_job as weekly_job

HAS_QWEN = importlib.util.find_spec('qwenpaw') is not None


class Job:
    def __init__(self, value): self.value = value
    def model_dump(self, **kwargs): return deepcopy(self.value)


class ReviewScheduleTests(unittest.TestCase):
    def test_signal_not_agent_or_shared_session(self):
        value = managed_job()
        validate_job(value, 'qd-survivor')
        self.assertEqual(value['task_type'], 'text')
        self.assertFalse(value['runtime']['share_session'])
        self.assertNotIn('request', value)

    def test_foreign_role_or_second_model_job_rejected(self):
        with self.assertRaises(AssertionError): validate_job(managed_job(), 'mc-god')
        for key, changed in [('task_type', 'agent'), ('text', 'different task'),
                             ('meta', {'purpose': 'other'})]:
            value = managed_job(); value[key] = changed
            with self.assertRaises(AssertionError): validate_job(value, 'qd-survivor')

    def test_weekly_and_review_coexist_without_duplicates(self):
        jobs = [weekly_job('qd-survivor', 'game'), managed_job()]
        validate_jobs({'jobs': jobs}, 'qd-survivor', 'game')
        with self.assertRaises(AssertionError):
            validate_jobs({'jobs': jobs + [managed_job()]}, 'qd-survivor', 'game')

    def test_pause_and_five_minute_native_edit_preserved(self):
        value = managed_job(); value['enabled'] = False
        value['schedule']['cron'] = '*/5 * * * *'
        validate_job(value, 'qd-survivor')
        value['schedule']['cron'] = '* * * * *'
        with self.assertRaises(AssertionError): validate_job(value, 'qd-survivor')

    def run_job(self, value, send, folder, now=1201):
        executor = SimpleNamespace(_workspace=SimpleNamespace(
            agent_id='qd-survivor', workspace_dir=str(folder)))
        return asyncio.run(execute(executor, Job(value), send=send, clock=lambda: now))

    def test_signal_is_deduplicatable_and_does_not_claim_learning(self):
        calls = []
        async def send(identity):
            calls.append(identity)
            return {'ok': True, 'reviewId': 'r1', 'coalesced': False}
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            value = managed_job()
            result = self.run_job(value, send, folder)
            self.run_job(value, send, folder, now=1250)
            self.assertEqual(calls, [JOB_ID + ':600:2'] * 2)
            self.assertEqual(result['delivery_status'], 'suppressed')
            record = json.loads((folder / 'life-review/last-cron.json').read_text())
            self.assertEqual(record['status'], 'signal_accepted')
            self.assertEqual(record['modelCalls'], 0)
            self.assertEqual(record['worldActions'], 0)

    def test_unknown_submission_is_not_retried(self):
        calls = []
        async def send(identity):
            calls.append(identity); raise TimeoutError('unknown transport')
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            with self.assertRaises(TimeoutError): self.run_job(managed_job(), send, folder)
            self.assertEqual(len(calls), 1)
            record = json.loads((folder / 'life-review/last-cron.json').read_text())
            self.assertFalse(record['retryAutomatically'])
            self.assertEqual(record['status'], 'signal_unknown_or_failed')


@unittest.skipUnless(HAS_QWEN, 'requires the installed Qwen 2.2 schema; zero model calls')
class NativeReviewScheduleTests(unittest.TestCase):
    def test_native_text_schema_and_adapter_suppression(self):
        from qwenpaw.app.crons.models import CronJobSpec
        value = managed_job(); value['enabled'] = False
        parsed = CronJobSpec.model_validate(value)
        validate_job(parsed.model_dump(mode='json', exclude_none=True), 'qd-survivor')
        self.assertEqual(parsed.id, JOB_ID)
        self.assertFalse(parsed.enabled)
        self.assertFalse(parsed.dispatch.silent)
        self.assertIsNone(parsed.request)
        rejected = deepcopy(value); rejected['dispatch']['silent'] = True
        with self.assertRaises(ValueError): CronJobSpec.model_validate(rejected)

    def test_native_put_keeps_one_fixed_id_and_other_jobs(self):
        from qwenpaw.app.crons.api import replace_job, create_job
        from qwenpaw.app.crons.models import CronJobSpec
        class MemoryManager:
            def __init__(self): self.jobs = {'existing-other-role-job': object()}
            async def create_or_replace_job(self, job): self.jobs[job.id] = job
        async def scenario():
            manager = MemoryManager()
            value = managed_job(); value['enabled'] = False
            for _ in range(2):
                actual = await replace_job(JOB_ID, CronJobSpec.model_validate(value), manager)
                self.assertEqual(actual.id, JOB_ID)
                self.assertFalse(actual.enabled)
            self.assertEqual(set(manager.jobs), {JOB_ID, 'existing-other-role-job'})
            # Confirm why the configurator must not use POST with a fixed id.
            post = await create_job(CronJobSpec.model_validate(value), MemoryManager())
            self.assertNotEqual(post.id, JOB_ID)
        asyncio.run(scenario())


if __name__ == '__main__': unittest.main()

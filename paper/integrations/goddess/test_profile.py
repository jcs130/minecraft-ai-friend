import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('goddess_profile', Path(__file__).with_name('profile.py'))
p = importlib.util.module_from_spec(spec); spec.loader.exec_module(p)


class ProfileTests(unittest.TestCase):
    def setUp(self):
        self.defs = json.loads(Path(__file__).with_name('evolution-jobs.json').read_text(encoding='utf-8'))
        self.jobs = [dict(id=str(i), name=name, enabled=i % 2 == 0,
                          schedule={'type': 'cron', 'cron': '0 14 * * sun', 'timezone': 'Asia/Shanghai'},
                          request={'user_id': 'owner', 'session_id': 'original', 'input': []},
                          runtime={'max_concurrency': 1, 'tool_safety': False, 'share_session': True, 'timeout_seconds': 600},
                          dispatch={'channel': 'existing', 'silent': True}, meta={'migration': 'preserve'})
                     for i, name in enumerate(self.defs)]

    def test_preserves_identity_targets_and_permissions(self):
        out = p.plan_jobs(self.jobs)
        for before, after in zip(self.jobs, out):
            for k in ('id', 'enabled', 'dispatch', 'meta'): self.assertEqual(before[k], after[k])
            for k in ('user_id', 'session_id'): self.assertEqual(before['request'][k], after['request'][k])
            for k in ('max_concurrency', 'tool_safety'): self.assertEqual(before['runtime'][k], after['runtime'][k])
            self.assertFalse(after['runtime']['share_session'])

    def test_repeat_plan_does_not_duplicate_or_reset(self):
        out = p.plan_jobs(self.jobs)
        self.assertEqual(p.plan_jobs(out), out)
        self.assertEqual(len(out), 6)
        self.assertTrue(all(j['runtime']['share_session'] for j in self.jobs))

    def test_only_construction_schedule_changes(self):
        for old, new in zip(self.jobs, p.plan_jobs(self.jobs)):
            if old['name'] == 'qiandengji-world-weekly-build': self.assertEqual(new['schedule']['cron'], '0 14 * * *')
            else: self.assertEqual(old['schedule'], new['schedule'])

    def test_missing_duplicate_jobs_rejected(self):
        with self.assertRaises(ValueError): p.plan_jobs(self.jobs[:-1])
        with self.assertRaises(ValueError): p.plan_jobs(self.jobs + [self.jobs[0]])

    def test_other_job_unchanged(self):
        other = {'name': 'unrelated', 'id': 'outside', 'dispatch': {'private': 'unchanged'}}
        self.assertEqual(p.plan_jobs(self.jobs + [other])[-1], other)


if __name__ == '__main__': unittest.main()

"""Synthetic native archives only; never export/import a production role."""
from copy import deepcopy
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'tools'), str(ROOT / 'world/ops')]
import migrate_role_to_game as migration
HAS_QWEN = importlib.util.find_spec('qwenpaw') is not None


@unittest.skipUnless(HAS_QWEN, 'native Qwen schema/storage required')
class RoleMigrationTests(unittest.TestCase):
    def setUp(self):
        from qwenpaw.backup.models import BackupMeta, BackupScope
        from qwenpaw.config.config import AgentProfileConfig, Config
        from qwenpaw.drivers.contracts import DriverCard
        from qwenpaw.drivers.storage import dump_card
        from agent_learning import managed_job
        from operations_team_mcp import operation_arguments, role_tools
        from role_learning_profiles import with_learning, learning_card
        from world_team_profiles import bindings
        temp = tempfile.TemporaryDirectory(); self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.hosts = self.root / 'hosts.json'
        self.hosts.write_bytes(migration.encoded({'schema': 2, 'phases': {}}))
        context = os.environ.setdefault('TEAM_RUNTIME_HOSTS_FILE', str(self.hosts))
        self.addCleanup(lambda: os.environ.__setitem__('TEAM_RUNTIME_HOSTS_FILE', context))
        self.builders = dict(AgentProfileConfig=AgentProfileConfig, Config=Config, DriverCard=DriverCard,
                             dump_card=dump_card, managed_job=managed_job, operation_arguments=operation_arguments,
                             role_tools=role_tools, with_learning=with_learning, learning_card=learning_card,
                             bindings=bindings, BackupMeta=BackupMeta, BackupScope=BackupScope)

    def fixture(self, role, model='fixture-model'):
        b = self.builders
        profile = b['AgentProfileConfig'](id=role, name='Fixture ' + role, language='zh',
            workspace_dir='/state/work/workspaces/' + role, running=b['Config']().agents.running,
            heartbeat={'enabled': False}, mcp={'clients': {}},
            active_model={'provider_id': 'aliyun-codingplan', 'model': model}).model_dump(mode='json')
        memory = profile['running']['reme_light_memory_config']
        memory['dream_cron_enabled'] = False; memory['auto_memory_interval'] = 0
        profile = b['with_learning'](profile, role, 'operations')
        profile['mcp']['clients'].update(b['bindings'](role, 'operations'))
        profile['mcp']['clients']['qiandeng_operations'] = {'name': 'qiandeng_operations', 'enabled': True,
            'transport': 'stdio', 'command': 'python', 'args': b['operation_arguments'](role), 'env': {},
            'tools': list(b['role_tools'](role))}
        jobs = [b['managed_job'](role, 'operations')]
        if role == 'default':
            from world_operations import world_job
            jobs.append(world_job())
        files = {'agent.json': migration.encoded(profile),
            'jobs.json': migration.encoded({'version': 2, 'jobs': jobs}),
            'SOUL.md': ('Original soul of %s stays byte-identical.\n' % role).encode(),
            'chats.json': b'{"version":1,"chats":[]}',
            'sessions/console/old-user_world-team-operations-%s.json' % role: b'{"state":{"summary":"keep logical"}}',
            'jobs_history/qd-learning-%s.json' % role: b'[{"status":"success","evidence":"keep"}]',
            'mem_session/original.bin': bytes(range(256)),
            'tool_results/prior.json': b'{"original":true}'}
        for key, client in profile['mcp']['clients'].items():
            value = b['learning_card'](role, 'operations') if key == 'qd_learning' else {
                'name': key, 'protocol': 'mcp', 'enabled': True,
                'endpoint': {k: client[k] for k in ('transport', 'command', 'args', 'env')}, 'credentials': {},
                'config': {'tools': client['tools']}, 'policy': {'default_effect': 'deny', 'rules': [
                    {'subject': '*', 'effect': 'allow', 'target': {'kind': 'tool', 'name': name}} for name in client['tools']]}}
            card_file = self.root / (role + '-' + key + '.yaml'); b['dump_card'](b['DriverCard'](**value), card_file)
            files['drivers/mcp/' + key + '.yaml'] = card_file.read_bytes()
        meta = b['BackupMeta'](id='source-fixture-' + role, name='fixture', agent_count=1, qwenpaw_version='2.2.0',
            scope=b['BackupScope'](include_agents=True, include_global_config=False, include_secrets=False,
                                   include_skill_pool=False))
        source = self.root / ('source-' + role + '.zip')
        with zipfile.ZipFile(source, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr('meta.json', meta.model_dump_json())
            for name, content in files.items():
                archive.writestr('data/workspaces/%s/%s' % (role, name), content)
        prior = {'jobs': [dict(job, enabled=True) for job in jobs]}
        prior_path = self.root / ('prior-' + role + '.json')
        prior_path.write_bytes(migration.encoded(prior))
        return source, prior_path, files

    def stage(self, role, suffix=None):
        entry = migration.entry_for(role)
        source, prior, _ = self.fixture(role)
        return migration.stage(source, self.root / (suffix or ('stage-' + role)),
            migration.sha_file(source), entry, prior_jobs=json.loads(prior.read_text(encoding='utf-8')))

    def test_same_id_role_keeps_identity_and_gains_native_host_arguments(self):
        report = self.stage('mc-priest')
        self.assertTrue(report['ok'] and report['targetRole'] == 'mc-priest')
        ready = json.loads((self.root / 'stage-mc-priest' / 'ready-agent.json').read_bytes())
        self.assertEqual(ready['id'], 'mc-priest')
        self.assertEqual(ready['name'], 'Fixture mc-priest')
        self.assertEqual(ready['active_model'], {'provider_id': 'aliyun-codingplan', 'model': 'fixture-model'})
        self.assertEqual(set(ready['mcp']['clients']), migration.BASE_DRIVERS)
        ops = ready['mcp']['clients']['qiandeng_operations']
        self.assertEqual(ops['args'], ['/ops/operations_team_mcp.py', '--role', 'mc-priest',
                                       '--native-role', 'mc-priest', '--native-runtime', 'game'])
        self.assertEqual(ops['cwd'], '')
        team = ready['mcp']['clients']['qd_world_team']
        self.assertEqual(team['args'], ['/ops/world_team_mcp.py', '--actor', 'operations:mc-priest',
                                        '--native-runtime', 'game', '--native-role', 'mc-priest'])
        with zipfile.ZipFile(self.root / 'stage-mc-priest' / 'qd-mc-priest-quarantined.zip') as archive:
            names = archive.namelist()
            self.assertIn('data/workspaces/mc-priest/SOUL.md', names)
            agent = json.loads(archive.read('data/workspaces/mc-priest/agent.json'))
            self.assertEqual(agent['id'], 'mc-priest')
            self.assertFalse(any(c['enabled'] for c in agent['mcp']['clients'].values()))
            jobs = json.loads(archive.read('data/workspaces/mc-priest/jobs.json'))
            self.assertFalse(any(j['enabled'] for j in jobs['jobs']))
        preserved = report['preservedFiles']
        self.assertIn('SOUL.md', preserved)
        self.assertIn('sessions/console/old-user_world-team-operations-mc-priest.json', preserved)

    def test_renamed_steward_rewrites_paths_and_retains_the_world_daily_job(self):
        report = self.stage('default', 'stage-steward')
        self.assertEqual(report['targetRole'], 'qd-steward')
        ready = json.loads((self.root / 'stage-steward' / 'ready-agent.json').read_bytes())
        self.assertEqual(ready['id'], 'qd-steward')
        self.assertEqual(ready['workspace_dir'], '/state/work/workspaces/qd-steward')
        self.assertEqual(ready['name'], 'Fixture default')
        ready_jobs = json.loads((self.root / 'stage-steward' / 'ready-jobs.json').read_bytes())
        ids = {j['id'] for j in ready_jobs['jobs']}
        self.assertEqual(ids, {'qd-learning-default', 'qd-world-daily-default'})
        daily = next(j for j in ready_jobs['jobs'] if j['id'] == 'qd-world-daily-default')
        self.assertEqual(daily['meta'], {'project': 'qiandengji', 'purpose': 'world-operations',
                                         'runtime': 'operations', 'role': 'default', 'version': 1})
        self.assertTrue(daily['enabled'])
        with zipfile.ZipFile(self.root / 'stage-steward' / 'qd-qd-steward-quarantined.zip') as archive:
            names = archive.namelist()
            self.assertIn('data/workspaces/qd-steward/agent.json', names)
            self.assertFalse(any(n.startswith('data/workspaces/default/') for n in names))
            jobs = json.loads(archive.read('data/workspaces/qd-steward/jobs.json'))
            self.assertFalse(any(j['enabled'] for j in jobs['jobs']))
        self.assertIn('jobs_history/qd-learning-default.json', report['preservedFiles'])

    def test_engineer_and_unknown_roles_are_rejected(self):
        with self.assertRaisesRegex(ValueError, 'unknown_or_engineer_source_role'):
            migration.entry_for('mc-god')
        with self.assertRaisesRegex(ValueError, 'unknown_or_engineer_source_role'):
            migration.entry_for('qd-survivor')

    def test_wrong_source_jobs_or_driver_inventory_fails_closed(self):
        entry = migration.entry_for('mc-guard-naruto')
        source, prior, files = self.fixture('mc-guard-naruto')
        from world_operations import world_job
        jobs = json.loads(files['jobs.json'])
        jobs['jobs'].append(world_job())
        files['jobs.json'] = migration.encoded(jobs)
        with zipfile.ZipFile(source, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
            meta = self.builders['BackupMeta'](id='tampered', name='fixture', agent_count=1, qwenpaw_version='2.2.0',
                scope=self.builders['BackupScope'](include_agents=True, include_global_config=False,
                    include_secrets=False, include_skill_pool=False))
            archive.writestr('meta.json', meta.model_dump_json())
            for name, content in files.items():
                archive.writestr('data/workspaces/mc-guard-naruto/' + name, content)
        with self.assertRaises(ValueError):
            migration.stage(source, self.root / 'stage-bad-jobs', migration.sha_file(source), entry)
        self.assertTrue((self.root / 'stage-bad-jobs' / 'failed.json').exists())

    def test_sha_mismatch_and_reused_output_are_rejected(self):
        entry = migration.entry_for('mc-guard-kirito')
        source, prior, _ = self.fixture('mc-guard-kirito')
        with self.assertRaisesRegex(ValueError, 'source_backup_sha256_mismatch'):
            migration.stage(source, self.root / 'stage-bad-sha', 'a' * 64, entry)
        out = self.root / 'stage-reuse'
        migration.stage(source, out, migration.sha_file(source), entry)
        with self.assertRaisesRegex(ValueError, 'migration_output_must_be_new'):
            migration.stage(source, out, migration.sha_file(source), entry)


if __name__ == '__main__': unittest.main()

"""Synthetic native archives only; never export/import a production role."""
from copy import deepcopy
import asyncio
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'tools'), str(ROOT / 'world/ops')]
import migrate_engineer_to_game as migration
HAS_QWEN = importlib.util.find_spec('qwenpaw') is not None


@unittest.skipUnless(HAS_QWEN, 'native Qwen schema/storage required')
class EngineerMigrationTests(unittest.TestCase):
    def setUp(self):
        from qwenpaw.backup.models import BackupMeta, BackupScope
        from qwenpaw.config.config import AgentProfileConfig, Config
        from qwenpaw.drivers.contracts import DriverCard
        from qwenpaw.drivers.storage import dump_card
        from agent_learning import managed_job
        from operations_team_mcp import operation_arguments, role_tools
        from role_learning_profiles import with_learning, learning_card
        from world_team_hosts import ENGINEER, SOURCE, TARGET, MIGRATION
        from world_team_profiles import bindings
        from world_team_schedule import team_job
        temp = tempfile.TemporaryDirectory(); self.addCleanup(temp.cleanup)
        self.root = Path(temp.name); self.hosts = self.root / 'hosts.json'
        self.hosts.write_bytes(migration.encoded({'schema': 1, 'migration': MIGRATION, 'phase': 'prepared',
            'logicalActor': ENGINEER, 'source': SOURCE, 'target': TARGET}))
        context = patch.dict(os.environ, {'TEAM_RUNTIME_HOSTS_FILE': str(self.hosts)})
        context.start(); self.addCleanup(context.stop)
        profile = AgentProfileConfig(id='mc-god', name='Original engineer', language='zh',
            workspace_dir='/state/work/workspaces/mc-god', running=Config().agents.running,
            heartbeat={'enabled': False}, mcp={'clients': {}},
            active_model={'provider_id': 'fixture-existing', 'model': 'fixture-model'}).model_dump(mode='json')
        profile['heartbeat']['enabled'] = False
        memory = profile['running']['reme_light_memory_config']
        memory['dream_cron_enabled'] = False; memory['auto_memory_interval'] = 0
        profile = with_learning(profile, 'mc-god', 'operations')
        profile['mcp']['clients'].update(bindings('mc-god', 'operations'))
        profile['mcp']['clients']['qiandeng_operations'] = {'name': 'qiandeng_operations', 'enabled': True,
            'transport': 'stdio', 'command': 'python', 'args': operation_arguments('mc-god'), 'env': {},
            'tools': list(role_tools('mc-god'))}
        self.original = deepcopy(profile)
        self.files = {'agent.json': migration.encoded(profile),
            'jobs.json': migration.encoded({'version': 2, 'jobs': [managed_job('mc-god', 'operations'), team_job(ENGINEER)]}),
            'SOUL.md': 'Original personal soul remains byte-identical.\n'.encode(),
            'chats.json': b'{"version":1,"chats":[]}',
            'sessions/console/old-user_world-team-operations-mc-god.json': b'{"state":{"summary":"keep old logical mc-god"}}',
            'jobs_history/qd-team-engineer.json': b'[{"status":"success","evidence":"keep"}]',
            'engineering/repo/.git/HEAD': b'ref: refs/heads/codex/ops-existing\n',
            'engineering/repo/world/a.py': b'ORIGINAL = 42\n',
            'mem_session/original.bin': bytes(range(256)),
            'tool_results/prior.json': b'{"original":true}'}
        for key, client in profile['mcp']['clients'].items():
            value = learning_card('mc-god', 'operations') if key == 'qd_learning' else {
                'name': key, 'protocol': 'mcp', 'enabled': True,
                'endpoint': {k: client[k] for k in ('transport', 'command', 'args', 'env')}, 'credentials': {},
                'config': {'tools': client['tools']}, 'policy': {'default_effect': 'deny', 'rules': [
                    {'subject': '*', 'effect': 'allow', 'target': {'kind': 'tool', 'name': name}} for name in client['tools']]}}
            file = self.root / (key + '.yaml'); dump_card(DriverCard(**value), file)
            self.files['drivers/mcp/' + key + '.yaml'] = file.read_bytes()
        self.meta = BackupMeta(id='source-fixture-backup', name='fixture', agent_count=1, qwenpaw_version='2.2.0',
            scope=BackupScope(include_agents=True, include_global_config=False, include_secrets=False, include_skill_pool=False))
        self.source = self.root / 'source.zip'; self.make_archive()

    def make_archive(self, extras=None):
        with zipfile.ZipFile(self.source, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr('meta.json', self.meta.model_dump_json())
            for name, content in self.files.items(): archive.writestr(migration.SOURCE_PREFIX + name, content)
            for name, content in (extras or {}).items(): archive.writestr(name, content)

    def stage(self, suffix='stage'):
        return migration.stage(self.source, self.root / suffix, migration.sha_file(self.source))

    def test_native_archive_is_quarantined_and_all_history_bytes_are_preserved(self):
        from qwenpaw.backup.models import RestoreBackupRequest
        from qwenpaw.drivers.storage import load_card
        before = self.source.read_bytes(); report = self.stage()
        self.assertTrue(report['sourceBackupUnchanged'])
        self.assertEqual(self.source.read_bytes(), before)
        self.assertEqual(len(report['changedWorkspaceFiles']), 6)
        self.assertEqual(RestoreBackupRequest.model_validate(report['nativeRestore']).agent_ids, ['qd-engineer'])
        folder = self.root / 'stage'
        ready = json.loads((folder / 'ready-agent.json').read_text(encoding='utf8'))
        self.assertEqual(ready['id'], 'qd-engineer')
        self.assertEqual(ready['active_model'], self.original['active_model'])
        self.assertEqual(ready['running'], self.original['running'])
        self.assertEqual(ready['language'], 'zh')
        self.assertIn('--native-role', ready['mcp']['clients']['qd_learning']['args'])
        self.assertIn('--native-role', ready['mcp']['clients']['qiandeng_operations']['args'])
        self.assertTrue(all(load_card(p).enabled for p in (folder / 'ready-cards').glob('*.yaml')))
        with zipfile.ZipFile(folder / 'qd-engineer-quarantined.zip') as archive:
            agent = json.loads(archive.read(migration.TARGET_PREFIX + 'agent.json'))
            jobs = json.loads(archive.read(migration.TARGET_PREFIX + 'jobs.json'))
            self.assertFalse(any(v['enabled'] for v in agent['mcp']['clients'].values()))
            self.assertFalse(any(j['enabled'] for j in jobs['jobs']))
            for name in report['preservedFiles']:
                self.assertEqual(archive.read(migration.TARGET_PREFIX + name), self.files[name])
            self.assertFalse(any(n.startswith(migration.SOURCE_PREFIX) for n in archive.namelist()))
            self.assertIsNone(json.loads(archive.read('meta.json'))['signature'])
        self.assertEqual(json.loads(self.hosts.read_text())['phase'], 'prepared')

    def test_wrong_source_hash_and_nonempty_output_are_refused(self):
        with self.assertRaisesRegex(ValueError, 'sha256_mismatch'):
            migration.stage(self.source, self.root / 'bad', '0' * 64)
        self.stage()
        with self.assertRaisesRegex(ValueError, 'must_be_new'): self.stage()

    def test_raw_running_optional_nulls_are_not_injected_during_identity_move(self):
        profile = json.loads(self.files['agent.json'])
        profile['running']['loop']['iteration'].pop('max_iterations', None)
        profile['running']['reme_light_memory_config'].pop('pending_reindex_embedding_config', None)
        for key in ('approval_level', 'adbpg_memory_config'): profile['running'].pop(key, None)
        self.files['agent.json'] = migration.encoded(profile); self.make_archive()
        self.stage()
        ready = json.loads((self.root / 'stage/ready-agent.json').read_text(encoding='utf8'))
        self.assertEqual(ready['running'], profile['running'])
        self.assertNotIn('max_iterations', ready['running']['loop']['iteration'])

    def test_only_original_operations_cwd_or_empty_is_cleared_for_new_host(self):
        from operations_team_mcp import operation_arguments
        for cwd in (None, '', '/state/work/workspaces/mc-god'):
            profile = deepcopy(self.original)
            profile['mcp']['clients']['qiandeng_operations']['cwd'] = cwd
            with self.subTest(cwd=cwd), migration.target_contract():
                ready = migration.transform_profile(profile)
                expected = deepcopy(profile['mcp']['clients']['qiandeng_operations'])
                expected['args'] = operation_arguments('mc-god', 'qd-engineer', 'game')
                expected['cwd'] = ''
                self.assertEqual(ready['mcp']['clients']['qiandeng_operations'], expected)
                self.assertEqual(profile['mcp']['clients']['qiandeng_operations']['cwd'], cwd)
                self.assertNotIn('/state/work/workspaces/mc-god', ready['mcp']['clients']['qiandeng_operations'].values())

    def test_unknown_operations_cwd_is_rejected_instead_of_silently_relocated(self):
        for cwd in ('/production', '/state/work/workspaces/mc-herald', '/state/work/workspaces/qd-engineer', '.', ' ', 0):
            profile = deepcopy(self.original)
            profile['mcp']['clients']['qiandeng_operations']['cwd'] = cwd
            with self.subTest(cwd=cwd), migration.target_contract(), self.assertRaisesRegex(ValueError, 'unexpected_source_operations_cwd'):
                migration.transform_profile(profile)

    def test_other_roles_global_state_and_traversal_cannot_enter_archive(self):
        for index, path in enumerate(('data/workspaces/mc-herald/agent.json', 'data/config.json',
                                      'data/secrets/key', 'data/workspaces/mc-god/../outside')):
            with self.subTest(path=path):
                self.make_archive({path: b'{}'})
                with self.assertRaises(ValueError): self.stage('bad-' + str(index))

    def test_unknown_jobs_or_driver_inventory_are_not_silently_discarded(self):
        jobs = json.loads(self.files['jobs.json'])
        jobs['jobs'].append({'id': 'unknown-user-job', 'enabled': True})
        self.files['jobs.json'] = migration.encoded(jobs); self.make_archive()
        with self.assertRaisesRegex(ValueError, 'unexpected_source_jobs'): self.stage()

    def inventory(self):
        folder = self.root / 'inventory-source'
        for name, content in self.files.items():
            path = folder / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(content)
        return migration.workspace_inventory(folder)

    def test_native_export_inventory_verifies_all_source_bytes_and_prior_pause_flags(self):
        prior = json.loads(self.files['jobs.json'])['jobs']
        for job in prior: job['enabled'] = True
        paused = deepcopy(prior)
        for job in paused: job['enabled'] = False
        self.files['jobs.json'] = migration.encoded({'version': 2, 'jobs': paused})
        self.make_archive(); inventory = self.inventory()
        report = migration.stage(self.source, self.root / 'verified', migration.sha_file(self.source), inventory, prior)
        self.assertTrue(report['sourceInventoryVerified'])
        self.assertTrue(report['priorJobEnableStatesRestored'])
        ready = json.loads((self.root / 'verified/ready-jobs.json').read_text(encoding='utf8'))
        self.assertTrue(all(job['enabled'] for job in ready['jobs']))
        with zipfile.ZipFile(self.root / 'verified/qd-engineer-quarantined.zip') as archive:
            paused = json.loads(archive.read(migration.TARGET_PREFIX + 'jobs.json'))
            self.assertFalse(any(job['enabled'] for job in paused['jobs']))
        self.assertEqual(len(inventory['files']), len(self.files))

    def test_completed_native_backup_cannot_hide_omitted_or_changed_files(self):
        inventory = self.inventory()
        missing = deepcopy(inventory); missing['files']['missing-native-file.md'] = {'size': 1, 'sha256': '0' * 64}
        different = deepcopy(inventory); different['files']['SOUL.md']['sha256'] = '0' * 64
        for suffix, value, error in [('missing', missing, 'missing_or_extra'), ('different', different, 'bytes_differ')]:
            with self.subTest(suffix=suffix), self.assertRaisesRegex(ValueError, error):
                migration.stage(self.source, self.root / suffix, migration.sha_file(self.source), value)

    def test_pre_pause_jobs_cannot_silently_change_session_or_task(self):
        prior = json.loads(self.files['jobs.json'])['jobs']
        prior[0]['dispatch']['target']['session_id'] = 'unrelated-new-session'
        with self.assertRaisesRegex(ValueError, 'changed_beyond_pause'):
            migration.stage(self.source, self.root / 'altered', migration.sha_file(self.source), self.inventory(), prior)

    def test_native_session_filename_does_not_include_agent_id(self):
        from qwenpaw.app.chats.session import SafeJSONSession
        from qwenpaw.runtime._state_utils import StateProxy
        sid, user, channel = 'world-team-operations-mc-god', 'qiandeng-world-team', 'console'
        old = self.root / 'old/mc-god/sessions'; new = self.root / 'new/qd-engineer/sessions'
        left = Path(SafeJSONSession(str(old))._get_save_path(sid, user_id=user, channel=channel))
        right = Path(SafeJSONSession(str(new))._get_save_path(sid, user_id=user, channel=channel))
        self.assertEqual(left.relative_to(old), right.relative_to(new))
        original = StateProxy(); original.data = {'state': {'context': [{'fixture': 'prior work'}], 'summary': 'original summary'}}
        asyncio.run(SafeJSONSession(str(old)).save_session_state(sid, user_id=user, channel=channel, agent=original))
        relative = 'sessions/' + left.relative_to(old).as_posix()
        self.files[relative] = left.read_bytes(); self.make_archive(); self.stage()
        with zipfile.ZipFile(self.root / 'stage/qd-engineer-quarantined.zip') as archive:
            right.parent.mkdir(parents=True, exist_ok=True)
            right.write_bytes(archive.read(migration.TARGET_PREFIX + relative))
            from qwenpaw.backup._ops.restore_helpers import collect_workspace_agents_from_zip
            self.assertEqual(collect_workspace_agents_from_zip(archive), {'qd-engineer'})
        restored = StateProxy()
        asyncio.run(SafeJSONSession(str(new)).load_session_state(sid, user_id=user, channel=channel, agent=restored))
        self.assertEqual(restored.data, original.data)


if __name__ == '__main__': unittest.main()

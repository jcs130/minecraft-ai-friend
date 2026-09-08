"""Offline role skill ownership, native cron and runtime attestation contracts."""
from copy import deepcopy
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/ops'))
import role_learning_profiles as contract
import native_role_capabilities as native
from agent_learning import LearningTools, managed_job, write, read
from test_agent_learning import Service


def native_fixture_lock():
    import hashlib
    return {'skills': {name: {'sha256': hashlib.sha256(('fixture-' + name).encode()).hexdigest()} for name in native.NATIVE_SKILLS}}


def learning_fixture(folder, role, runtime='game'):
    """Materialize only explicit test data; runtime must use native SkillService."""
    folder = Path(folder)
    write(folder / 'drivers/mcp/qd_learning.yaml', contract.learning_card(role, runtime))
    write(folder / 'jobs.json', {'version': 2, 'jobs': [managed_job(role, runtime)]})
    entries = {}
    for name in contract.role_skills(role, runtime):
        path = folder / 'skills' / name / 'SKILL.md'; path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / 'world/ops/skills' / name / 'SKILL.md', path)
        for page, body in contract.skill_references(name).items():
            target = path.parent / 'references' / page
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(body, encoding='utf-8')
        entries[name] = {'enabled': True, 'channels': ['all']}
    for name in native.NATIVE_SKILLS:
        path = folder / 'skills' / name / 'SKILL.md'; path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(('fixture-' + name).encode())
        entries[name] = {'enabled': True, 'channels': ['all'], 'source': 'builtin'}
    write(folder / 'skill.json', {'skills': entries})


class RoleLearningProfiles(unittest.TestCase):
    def setUp(self):
        native_patch = patch.object(native, 'native_lock', return_value=native_fixture_lock())
        native_patch.start(); self.addCleanup(native_patch.stop)
        tmp = tempfile.TemporaryDirectory(); self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name); self.role = 'mc-herald'; self.folder = self.root / 'workspaces' / self.role
        write(self.root / 'config.json', {'agents': {'profiles': {self.role: {'enabled': True}}}})
        self.agent = contract.with_learning({'id': self.role, 'mcp': {'clients': {}},
            'running': {}, 'active_model': {'model': 'user-model'}, 'user_setting': 'preserved'}, self.role, 'operations')
        write(self.folder / 'agent.json', self.agent)
        learning_fixture(self.folder, self.role, 'operations')

    def test_base_role_scopes_and_required_bindings(self):
        self.assertEqual(sum(len(contract.role_skills(r, 'game')) for r in contract.GAME_ROLES), 18)
        self.assertEqual(sum(len(contract.role_skills(r, 'operations')) for r in contract.OPS_ROLES), 18)
        self.assertEqual(contract.validate_learning_workspace(self.folder, self.role, 'operations')['required'], 6)
        changed = deepcopy(self.agent); changed['mcp']['clients']['qd_learning']['args'][2] = 'mc-god'
        with self.assertRaises(AssertionError): contract.validate_learning_profile(changed, self.role, 'operations')

    def test_survivor_retrieval_burst_does_not_change_concurrency_or_retry_policy(self):
        agent = {'id': 'qd-survivor', 'mcp': {'clients': {}}, 'active_model': {'model': 'current-choice'},
                 'running': {'llm_max_qpm': 4, 'llm_max_concurrent': 1, 'llm_retry_enabled': False,
                             'max_iters': 6, 'custom_setting': 'preserved'}}
        updated = contract.with_learning(agent, 'qd-survivor', 'game')
        self.assertEqual(updated['running'], {**agent['running'], 'llm_max_qpm': 8})
        self.assertEqual(updated['active_model'], agent['active_model'])
        contract.validate_learning_profile(updated, 'qd-survivor', 'game')

    def test_weekly_only_preserves_optout_and_rejects_unmanaged_or_delivery_changes(self):
        original = managed_job(self.role, 'operations')
        valid = deepcopy(original); valid['enabled'] = False; valid['schedule']['cron'] = '20 23 * * sun'
        valid['dispatch']['meta'] = {}
        contract.validate_jobs({'jobs': [valid]}, self.role, 'operations')
        for change in ('every-minute', 'second-job', 'cross-role', 'external-delivery', 'unbounded'):
            job = deepcopy(original); jobs = [job]
            if change == 'every-minute': job['schedule']['cron'] = '* * * * *'
            elif change == 'second-job': jobs.append(deepcopy(job))
            elif change == 'cross-role': job['meta']['role'] = 'mc-god'
            elif change == 'external-delivery': job['dispatch']['channel'] = 'email'
            else: job['runtime']['max_concurrency'] = 2
            with self.subTest(change=change), self.assertRaises(AssertionError):
                contract.validate_jobs({'jobs': jobs}, self.role, 'operations')

    def test_learned_skills_require_own_revision_and_actual_enabled_manifest(self):
        tool = LearningTools(self.role, 'operations', self.root, Service(self.folder), api=lambda *a: {'success': True})
        draft = tool.draft('qd-learned-freshness', 'Validate current evidence before claiming a result',
            'Read the current observation and its collection time. If evidence is missing or expired, state that the result remains unknown. Record the exact receipt before considering a workflow successful.',
            ['learning_status'], [{'input': 'New observation with timestamp', 'expected': 'Report only the current observation', 'kind': 'success'},
                {'input': 'No available observation timestamp', 'expected': 'Keep the result unknown until fresh evidence', 'kind': 'failure'}])
        tool.validate(draft['name'], draft['revision']); tool.activate(draft['name'], draft['revision'])
        self.assertEqual(contract.validate_role_skills(self.folder, self.role, 'operations')['learnedEnabled'], 1)
        manifest = read(self.folder / 'skill.json'); manifest['skills'][draft['name']]['enabled'] = False
        write(self.folder / 'skill.json', manifest)
        with self.assertRaises(AssertionError): contract.validate_role_skills(self.folder, self.role, 'operations')
        manifest['skills'][draft['name']]['enabled'] = True; write(self.folder / 'skill.json', manifest)
        (self.folder / 'skills' / draft['name'] / 'SKILL.md').write_text('tampered')
        with self.assertRaises(AssertionError): contract.validate_role_skills(self.folder, self.role, 'operations')

    def test_unknown_learned_manifest_is_rejected(self):
        manifest = read(self.folder / 'skill.json'); manifest['skills']['qd-learned-unowned'] = {'enabled': False}
        write(self.folder / 'skill.json', manifest)
        with self.assertRaises(AssertionError): contract.validate_role_skills(self.folder, self.role, 'operations')

    def test_dynamic_maid_only_from_ready_public_registry_not_prefix(self):
        role = '76564cab-6750-48d3-a6a6-1894d89c4b12'; path = self.root / 'roles.json'
        value = {'schema': 1, 'activeRoleIds': [role], 'registeredCount': 1, 'bindingsValid': True, 'independentSessions': True}
        write(path, value)
        with patch.dict(os.environ, {'MAID_ROLES_MANIFEST_FILE': str(path)}):
            self.assertIn(role, contract.roles('game'))
            self.assertNotIn(role, contract.roles('operations'))
            self.assertEqual(contract.role_skills(role, 'game'), contract.role_skills('qd-maid-dialogue', 'game'))
            self.assertEqual(contract.learning_client(role, 'game')['args'][2], role)
            with self.assertRaises(ValueError): contract.role_skills('maid-unregistered', 'game')
            for ids in ([role, role], ['../outside'], ['qd-survivor']):
                write(path, {**value, 'activeRoleIds': ids, 'registeredCount': len(ids)})
                with self.assertRaises(AssertionError): contract.roles('game')

    def test_guard_requires_matching_live_entrypoint_and_process_start(self):
        proc = self.root / 'proc'; (proc / '7').mkdir(parents=True)
        (proc / 'stat').write_text('btime 1000\n')
        fields = ['0'] * 20; fields[19] = '100'
        (proc / '7/stat').write_text('7 (python with spaces) ' + ' '.join(fields))
        (proc / '7/cmdline').write_bytes(b'python\0/ops/learning_service.py\0--runtime\0operations\0')
        marker = {'schema': 1, 'runtime': 'operations', 'guardVersion': 1, 'nativeToolGuardVersion': 1, 'pid': 7, 'startedAt': 1002,
            'qwenVersion': '2.2.0', 'scheduler': 'native-qwen-cron'}
        write(self.root / 'learning-runtime.json', marker)
        with patch.object(contract.os, 'sysconf', return_value=100, create=True):
            self.assertTrue(contract.validate_guard(self.root, 'operations', proc))
            for changes in ({'startedAt': 900}, {'startedAt': 1500}, {'guardVersion': 0}, {'runtime': 'game'}, {'pid': 8}):
                write(self.root / 'learning-runtime.json', {**marker, **changes})
                with self.subTest(changes=changes), self.assertRaises((AssertionError, FileNotFoundError)):
                    contract.validate_guard(self.root, 'operations', proc)
            write(self.root / 'learning-runtime.json', {**marker, 'runtime': 'game'})
            (proc / '7/cmdline').write_bytes(b'python\0-u\0/survival/game_service.py\0')
            self.assertTrue(contract.validate_guard(self.root, 'game', proc))
            (proc / '7/cmdline').write_bytes(b'python\0/ops/game_service.py\0')
            with self.assertRaises(AssertionError): contract.validate_guard(self.root, 'game', proc)
            (proc / '7/cmdline').write_bytes(b'python\0/ops/learning_service.py\0')
            write(self.root / 'learning-runtime.json', {**marker, 'startedAt': 998.5})
            self.assertTrue(contract.validate_guard(self.root, 'operations', proc))
            boot_id = proc / 'sys/kernel/random/boot_id'; boot_id.parent.mkdir(parents=True); boot_id.write_text('fixture-boot')
            exact = {**marker, 'processStartTicks': 100, 'bootId': 'fixture-boot', 'startedAt': 50}
            write(self.root / 'learning-runtime.json', exact)
            self.assertTrue(contract.validate_guard(self.root, 'operations', proc))
            for changes in ({'processStartTicks': 101}, {'bootId': 'old-boot'}):
                write(self.root / 'learning-runtime.json', {**exact, **changes})
                with self.assertRaises(AssertionError): contract.validate_guard(self.root, 'operations', proc)

    def test_sync_plan_is_read_only_and_unknown_jobs_fail_before_backup(self):
        from sync_role_learning import plan
        state = self.root / 'sync-state'
        write(state / 'config.json', {'agents': {'profiles': {role: {'enabled': True} for role in contract.GAME_ROLES}}})
        for role in contract.GAME_ROLES:
            write(state / 'workspaces' / role / 'agent.json', {'id': role, 'workspace_dir': '/state/work/workspaces/' + role})
        before = {str(p): p.read_bytes() for p in state.rglob('*') if p.is_file()}
        result = plan(state, 'game')
        self.assertEqual(len(result), 6)
        self.assertEqual(before, {str(p): p.read_bytes() for p in state.rglob('*') if p.is_file()})
        write(state / 'workspaces/mc-god/jobs.json', {'jobs': [{'id': 'unmanaged-keep-me'}]})
        with self.assertRaises(AssertionError): plan(state, 'game')
        self.assertFalse((state / 'learning-sync-backups').exists())

    def test_game_reference_pages_are_required_and_checked_without_prompt_injection(self):
        role = 'mc-god'; folder = self.root / 'workspaces' / role
        write(folder / 'agent.json', contract.with_learning({'id': role, 'mcp': {'clients': {}},
            'running': {}, 'active_model': {'model': 'unchanged'}}, role, 'game'))
        learning_fixture(folder, role)
        summary = contract.validate_role_skills(folder, role, 'game')
        self.assertGreaterEqual(summary['referencePages'], 7)
        page = folder / 'skills/qd-minecraft-guide/references/crafting.md'
        page.write_text('unreviewed recipe', encoding='utf-8')
        with self.assertRaisesRegex(AssertionError, 'references differ'):
            contract.validate_role_skills(folder, role, 'game')
        learning_fixture(folder, role)
        page.unlink()
        with self.assertRaisesRegex(AssertionError, 'references differ'):
            contract.validate_role_skills(folder, role, 'game')

    def test_reference_sources_reject_unbounded_or_executable_attachments(self):
        source = self.root / 'candidate'; directory = source / 'skills/qd-guide/references'
        directory.mkdir(parents=True)
        page = directory / 'index.md'; page.write_text('x' * 16385)
        with self.assertRaises(AssertionError): contract.skill_references('qd-guide', source)
        page.write_text('one bounded page')
        script = directory / 'run.py'; script.write_text('print(1)')
        with self.assertRaises(AssertionError): contract.skill_references('qd-guide', source)

    def test_sync_append_preserves_character_identity_and_is_idempotent(self):
        from sync_role_learning import agent_text
        folder = self.root / 'native-copy'; folder.mkdir()
        original = 'Original UUID-bound character rules.\n'
        (folder / 'AGENTS.md').write_text(original, encoding='utf-8')
        text = agent_text(folder, 'native-copy', 'game', ROOT / 'world/ops')
        self.assertTrue(text.startswith(original.strip()))
        self.assertIn('qd_learning', text)
        (folder / 'AGENTS.md').write_text(text, encoding='utf-8')
        self.assertEqual(agent_text(folder, 'native-copy', 'game', ROOT / 'world/ops'), text)

    def test_personal_file_migration_keeps_existing_maid_notes_and_is_idempotent(self):
        from sync_role_learning import agent_text, OLD_MAID_FILE_TEXT, MAID_FILE_TEXT, NATIVE_NOTE
        folder = self.root / 'bound-maid'; folder.mkdir()
        original = 'Bound UUID: original-identity.\n' + OLD_MAID_FILE_TEXT + NATIVE_NOTE + '\n用户保留的人设补充。\n'
        (folder / 'AGENTS.md').write_text(original, encoding='utf-8')
        text = agent_text(folder, 'bound-maid', 'game', ROOT / 'world/ops')
        self.assertIn('Bound UUID: original-identity.', text)
        self.assertIn('用户保留的人设补充。', text)
        self.assertIn(MAID_FILE_TEXT, text)
        self.assertNotIn(OLD_MAID_FILE_TEXT, text)
        self.assertEqual(text.count('<!-- qiandeng-personal-files-v1 -->'), 1)
        (folder / 'AGENTS.md').write_text(text, encoding='utf-8')
        self.assertEqual(agent_text(folder, 'bound-maid', 'game', ROOT / 'world/ops'), text)


if __name__ == '__main__': unittest.main()

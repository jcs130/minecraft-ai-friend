"""Native Qwen capabilities: exact role rules and original package provenance."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/ops'))
import native_role_capabilities as native


class NativeRoleCapabilities(unittest.TestCase):
    def setUp(self):
        self.role = 'mc-herald'
        self.agent = native.configure_native({'id': self.role, 'active_model': {'model': 'unchanged'}}, self.role)

    def blocked(self, tool, parameter, value):
        return any(row['id'] in self.agent['security']['tool_guard']['auto_denied_rules'] and
            tool in row['tools'] and parameter in row['params'] and any(re.search(p, value) for p in row['patterns'])
            for row in self.agent['security']['tool_guard']['custom_rules'])

    def test_native_tools_and_guards_are_both_enabled_without_model_change(self):
        native.validate_native(self.agent, self.role)
        self.assertEqual(self.agent['active_model'], {'model': 'unchanged'})
        self.assertEqual(native.configure_native(self.agent, self.role), self.agent)
        for mutate in ('tool', 'rule', 'deny', 'scanner'):
            item = copy.deepcopy(self.agent)
            if mutate == 'tool': item['tools']['builtin_tools']['write_file']['enabled'] = False
            elif mutate == 'rule': item['security']['tool_guard']['custom_rules'].pop()
            elif mutate == 'deny': item['security']['tool_guard']['denied_tools'].append('read_file')
            else: item['security']['skill_scanner']['mode'] = 'warn'
            with self.subTest(mutate=mutate), self.assertRaises(AssertionError): native.validate_native(item, self.role)

    def test_only_own_native_cron_commands_pass(self):
        for command in ('qwenpaw cron list --agent-id mc-herald', 'qwenpaw cron pause qd-learning-mc-herald --agent-id mc-herald'):
            self.assertFalse(self.blocked('execute_shell_command', 'command', command))
        for command in ('qwenpaw cron list --agent-id default', 'qwenpaw cron list --agent-id mc-herald\ntrue',
                        'qwenpaw cron list --agent-id mc-herald; true', 'python exploit.py',
                        'qwenpaw cron run qd-learning-mc-herald --agent-id mc-herald',
                        'qwenpaw cron create --agent-id mc-herald', 'qwenpaw cron list --agent-id $(whoami)'):
            self.assertTrue(self.blocked('execute_shell_command', 'command', command), command)

    def test_native_file_precheck_protects_role_and_managed_configuration(self):
        for path in ('notes/任务.md', '/state/work/workspaces/mc-herald/notes/plan.json'):
            self.assertFalse(self.blocked('write_file', 'file_path', path))
        for path in ('../default/notes.md', '/state/work/workspaces/default/notes.md', '/tmp/x',
                     'notes/../../agent.json', 'notes/./x', 'notes\\x', 'notes/x\n', 'agent.json',
                     'AGENTS.md', 'jobs.json', 'drivers/mcp/x.yaml', 'learning/reviews.json', 'skills/qd-evidence-report/SKILL.md'):
            self.assertTrue(self.blocked('write_file', 'file_path', path), path)
        self.assertFalse(self.blocked('read_file', 'file_path', 'skills/make-skill/SKILL.md'))

    def test_native_skill_names_cannot_impersonate_project_managed_skills(self):
        self.assertFalse(self.blocked('materialize_skill', 'name', 'review-farm-observation'))
        self.assertTrue(self.blocked('materialize_skill', 'name', 'qd-learned-bypass'))

    def test_official_manifest_hash_validation_does_not_need_host_qwen_install(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory); entries = {}; lock = {'skills': {}}
            for name in native.NATIVE_SKILLS:
                body = ('fixture-' + name).encode(); path = folder / 'skills' / name / 'SKILL.md'
                path.parent.mkdir(parents=True); path.write_bytes(body)
                entries[name] = {'enabled': True, 'channels': ['all'], 'source': 'builtin'}
                lock['skills'][name] = {'sha256': hashlib.sha256(body).hexdigest()}
            with patch.object(native, 'native_lock', return_value=lock):
                self.assertEqual(native.validate_native_skills(folder, entries), 3)
                path.write_text('tampered')
                with self.assertRaises(AssertionError): native.validate_native_skills(folder, entries)


@unittest.skipUnless(os.name == 'posix' and os.environ.get('QWENPAW_WORKING_DIR') == '/state/work'
    and importlib.util.find_spec('qwenpaw'), 'Run inside the disposable pinned Qwen image with QWENPAW_WORKING_DIR=/state/work')
class InstalledNativeImplementation(unittest.TestCase):
    def test_z_real_policy_and_legacy_wrappers_bind_each_role(self):
        import asyncio
        from qwenpaw.constant import WORKING_DIR
        from qwenpaw.config.config import AgentProfileConfig, Config
        from qwenpaw.config.context import set_current_workspace_dir
        from qwenpaw.agents.tools.file_io import write_file, read_file
        from qwenpaw.agents.tools.shell import execute_shell_command
        from qwenpaw.agents.tools.make_skill_tools import materialize_skill
        from qwenpaw.governance.resource_governor import ResourceGovernor
        from qwenpaw.governance.policy import load_governance_policy
        from qwenpaw.governance.tool_registry import DEFAULT_REGISTRY
        from agentscope.permission import PermissionBehavior
        import native_tool_runtime
        native_tool_runtime.install('game')
        from qwenpaw.governance.tool_adapter import PolicyGuardedTool
        from qwenpaw.runtime.tool_guard import GuardedFunctionTool
        async def qa_world_status():
            """Read-only stand-in for an already governed world capability."""
            return 'fixture'
        DEFAULT_REGISTRY.register('QaWorldStatus', 'internal', '')
        DEFAULT_REGISTRY.register_python_name('qa_world_status', 'QaWorldStatus')
        # Run only in a disposable docker run, never against production state.
        self.assertEqual(str(WORKING_DIR), '/state/work')
        self.assertFalse((WORKING_DIR / 'config.json').exists())
        WORKING_DIR.mkdir(parents=True, exist_ok=True)
        (WORKING_DIR / 'config.json').write_text(Config().model_dump_json())
        folders = {}
        for role in ('mc-herald', 'mc-god'):
            folder = WORKING_DIR / 'workspaces' / role; folder.mkdir(parents=True)
            agent = AgentProfileConfig(id=role, name=role, workspace_dir=str(folder)).model_dump(mode='json')
            (folder / 'agent.json').write_text(json.dumps(native.configure_native(agent, role)))
            folders[role] = folder
        async def exercise(role):
            folder = folders[role]
            set_current_workspace_dir(folder)
            governor = ResourceGovernor(str(folder))
            governor.start()
            request = {'agent_id': role, 'session_id': 'native-qa', 'approval_level': 'AUTO'}
            for wrapper in ('policy', 'legacy'):
                def make(func):
                    return (PolicyGuardedTool(func, governor=governor, request_context=request) if wrapper == 'policy'
                        else GuardedFunctionTool(func, agent_id=role, request_context=request))
                allowed = await make(write_file).check_permissions({'file_path': 'notes/check.txt', 'content': 'fixture'})
                self.assertEqual(allowed.behavior, PermissionBehavior.ALLOW, (wrapper, allowed))
                passthrough = await make(qa_world_status).check_permissions({})
                self.assertEqual(passthrough.behavior, PermissionBehavior.ALLOW)
                cron = await make(execute_shell_command).check_permissions({'command': 'qwenpaw cron list --agent-id ' + role})
                self.assertEqual(cron.behavior, PermissionBehavior.ALLOW, (wrapper, cron))
                other = 'mc-god' if role == 'mc-herald' else 'mc-herald'
                for func, arguments in [(read_file, {'file_path': str(folders[other] / 'notes.txt')}),
                    (write_file, {'file_path': 'agent.json', 'content': '{}'}),
                    (execute_shell_command, {'command': 'qwenpaw cron list --agent-id ' + other}),
                    (materialize_skill, {'name': 'qd-learned-bypass', 'description': 'x', 'body': 'x'})]:
                    denied = await make(func).check_permissions(arguments)
                    self.assertEqual(denied.behavior, PermissionBehavior.DENY, (wrapper, func.__name__, denied))
                link = folder / 'outside.txt'
                if not link.is_symlink(): link.symlink_to(folders[other] / 'notes.txt')
                denied = await make(read_file).check_permissions({'file_path': 'outside.txt'})
                self.assertEqual(denied.behavior, PermissionBehavior.DENY)
            set_current_workspace_dir(None)
        async def all_roles():
            await asyncio.gather(*(exercise(role) for role in folders))
        asyncio.run(all_roles())

    def test_original_skills_scan_and_native_file_materializer_work_without_model(self):
        import asyncio
        from qwenpaw.config.config import Config, AgentProfileConfig
        from qwenpaw.config.context import set_current_workspace_dir
        from qwenpaw.agents.skill_system.workspace_service import SkillService
        from qwenpaw.agents.tools.file_io import write_file, read_file
        from qwenpaw.agents.tools.make_skill_tools import materialize_skill
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory) / 'mc-herald'; folder.mkdir()
            agent = native.configure_native(AgentProfileConfig(id='mc-herald', name='Native QA').model_dump(mode='json'), 'mc-herald')
            AgentProfileConfig.model_validate(agent)
            config = Config(security=agent['security'])
            set_current_workspace_dir(folder)
            try:
                with patch('qwenpaw.config.load_config', return_value=config):
                    service = SkillService(folder)
                    for name in native.NATIVE_SKILLS:
                        self.assertEqual(service.create_skill(name, native.native_content(name), enable=True, source='builtin'), name)
                    entries = json.loads((folder / 'skill.json').read_text())['skills']
                    native.validate_native_skills(folder, entries)
                    asyncio.run(write_file(file_path='notes/check.txt', content='Native file write QA.'))
                    self.assertEqual((folder / 'notes/check.txt').read_text(encoding='utf-8-sig'), 'Native file write QA.')
                    self.assertIn('Native file write QA.', str(asyncio.run(read_file(file_path='notes/check.txt'))))
                    asyncio.run(materialize_skill(name='native-evidence-review',
                        description='Use when recording the outcome of a world observation.',
                        body='# Record an observation\nRead the current receipt, distinguish unknown outcomes, and save concise evidence.'))
                    self.assertIn('native-evidence-review', {item.name for item in service.list_available_skills()})
            finally:
                set_current_workspace_dir(None)

    def test_actual_native_guard_rejects_scope_escape_and_sensitive_symlink(self):
        from qwenpaw.config.config import Config
        from qwenpaw.config.context import set_current_workspace_dir
        from qwenpaw.security.tool_guard.engine import ToolGuardEngine
        agent = native.configure_native({'id': 'mc-herald'}, 'mc-herald')
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory); secret = folder / 'sensitive-token'; secret.write_text('fixture-only')
            link = folder / 'notes.txt'; link.symlink_to(secret)
            agent['security']['file_guard']['sensitive_files'].append(str(secret))
            config = Config(security=agent['security']); set_current_workspace_dir(folder)
            try:
                with patch('qwenpaw.config.load_config', return_value=config):
                    engine = ToolGuardEngine(enabled=True)
                    for tool, args in [('read_file', {'file_path': 'notes.txt'}),
                        ('read_file', {'file_path': '../other/notes.txt'}),
                        ('execute_shell_command', {'command': 'qwenpaw cron list --agent-id default'}),
                        ('execute_shell_command', {'command': 'qwenpaw cron list --agent-id mc-herald\ntrue'}),
                        ('materialize_skill', {'name': 'qd-learned-bypass'})]:
                        result = engine.guard(tool, args)
                        self.assertTrue(engine.should_auto_deny_result(result), (tool, args))
                    self.assertFalse(engine.should_auto_deny_result(engine.guard('execute_shell_command',
                        {'command': 'qwenpaw cron list --agent-id mc-herald'})))
            finally:
                set_current_workspace_dir(None)


if __name__ == '__main__': unittest.main()

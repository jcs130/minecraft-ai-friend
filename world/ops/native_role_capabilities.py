"""Use Qwen's packaged skills and native ToolGuard, without a second tool runtime.

These rules are pre-execution checks, not an OS sandbox. General shell execution
is intentionally absent: the shell tool can only manage this role's native cron.
"""
from copy import deepcopy
import hashlib
import importlib.util
import json
from pathlib import Path
import re

HERE = Path(__file__).resolve().parent
NATIVE_SKILLS = ('make-skill', 'file_reader', 'cron')
FILE_TOOLS = ('read_file', 'write_file', 'edit_file', 'append_file')
NATIVE_TOOLS = (*FILE_TOOLS, 'materialize_skill', 'get_current_time', 'execute_shell_command')
PREFIX = 'QD_NATIVE_'


def packaged_skills_root():
    spec = importlib.util.find_spec('qwenpaw')
    assert spec and spec.origin, 'Pinned QwenPaw package is required'
    return Path(spec.origin).parent / 'agents/skills'


def native_lock():
    return json.loads((HERE / 'native-role-skills.json').read_text(encoding='utf-8'))


def native_content(name, root=None):
    lock = native_lock()
    assert name in NATIVE_SKILLS and lock['packageVersion'] == '2.2.0'
    entry = lock['skills'][name]
    path = Path(root or packaged_skills_root()) / entry['source'] / 'SKILL.md'
    body = path.read_bytes()
    assert not path.is_symlink() and hashlib.sha256(body).hexdigest() == entry['sha256']
    return body.decode('utf-8')


def rules(role):
    assert re.fullmatch(r'[A-Za-z0-9_-]{4,64}|default', role)
    base = re.escape('/state/work/workspaces/' + role + '/')
    segment = r'(?!\.{1,2}(?:/|\Z))[A-Za-z0-9_.\-\u4e00-\u9fff ]+'
    path = rf'(?:{base})?{segment}(?:/{segment})*'
    cli = rf'qwenpaw cron (?:list --agent-id {role}|(?:get|state|pause|resume) qd-learning-{role} --agent-id {role})'
    def row(suffix, tools, params, patterns, description):
        return {'id': PREFIX + suffix, 'tools': list(tools), 'params': params, 'category': 'command_injection',
                'severity': 'HIGH', 'patterns': patterns, 'exclude_patterns': [], 'description': description,
                'remediation': 'Use this role workspace and its existing native weekly job.'}
    return [
        row('FILE_SCOPE', FILE_TOOLS, ['file_path'], [rf'\A(?!{path}\Z)'], 'Files belong to the current role workspace.'),
        row('MANAGED_WRITE', FILE_TOOLS[1:], ['file_path'],
            [rf'\A(?:{base})?(?:AGENTS\.md|SOUL\.md|PROFILE\.md|agent\.json|skill\.json|jobs\.json|drivers(?:/|\Z)|learning(?:/|\Z)|skills/(?:qd-|make-skill/|file_reader/|cron/))'],
            'Managed identity, budget, drivers and supplied skills are maintained through their native services.'),
        row('CRON_SCOPE', ['execute_shell_command'], ['command'], [rf'\A(?!{cli}\Z)'], 'Only this role existing native cron is managed by CLI.'),
        row('SKILL_NAMESPACE', ['materialize_skill'], ['name'], [r'\A(?:qd-|make-skill\Z|file_reader\Z|cron\Z)'],
            'Native learned skills use their own names; qd- names are reserved for validated game integrations.'),
    ]


def sensitive_paths(role):
    base = '/state/work/workspaces/' + role + '/'
    return ['/run/secrets/', '/proc/', '/sys/', '/dev/',
            base + 'agent.json', base + 'drivers/', base + 'sessions/', base + 'chats/',
            '/state/work/config.json', '/state/work/providers.json']


def configure_native(agent, role):
    result = deepcopy(agent)
    result['tools'] = result.get('tools') or {}
    tools = result['tools'].setdefault('builtin_tools', {})
    for name in NATIVE_TOOLS:
        tools.setdefault(name, {'name': name, 'config': {}})['enabled'] = True
    for name, value in tools.items():
        if name not in NATIVE_TOOLS:
            value['enabled'] = False
    result['security'] = result.get('security') or {}
    security = result['security']
    guard = security.setdefault('tool_guard', {})
    guard['enabled'] = True
    guard['guarded_tools'] = sorted(set(guard.get('guarded_tools') or []) | set(NATIVE_TOOLS))
    guard['denied_tools'] = sorted((set(guard.get('denied_tools', [])) | set(tools)) - set(NATIVE_TOOLS))
    guard['custom_rules'] = [row for row in guard.get('custom_rules', []) if not row['id'].startswith(PREFIX)] + rules(role)
    required = {row['id'] for row in rules(role)} | {'SENSITIVE_FILE_BLOCK', 'SAFETY_CHECKS_DESTRUCTIVE_COMMAND'}
    guard['auto_denied_rules'] = sorted(set(guard.get('auto_denied_rules', [])) | required)
    guard['disabled_rules'] = [name for name in guard.get('disabled_rules', []) if name not in required]
    files = security.setdefault('file_guard', {})
    files['enabled'] = True
    files['allow_preview_outside_workspace'] = False
    files['sensitive_files'] = sorted(set(files.get('sensitive_files', [])) | set(sensitive_paths(role)))
    security.setdefault('skill_scanner', {})['mode'] = 'block'
    result['approval_level'] = 'AUTO'
    return result


def validate_native(agent, role):
    assert {name for name, value in agent['tools']['builtin_tools'].items() if value['enabled']} == set(NATIVE_TOOLS)
    expected = configure_native(agent, role)
    assert agent['security'] == expected['security'] and agent['approval_level'] == 'AUTO'


def validate_native_skills(folder, entries, root=None):
    lock = native_lock()
    for name in NATIVE_SKILLS:
        row = entries[name]
        assert row['enabled'] is True and ('all' in row['channels'] or 'console' in row['channels'])
        assert row.get('source') == 'builtin'
        path = Path(folder) / 'skills' / name / 'SKILL.md'
        assert not path.is_symlink()
        assert hashlib.sha256(path.read_bytes()).hexdigest() == lock['skills'][name]['sha256']
    return len(NATIVE_SKILLS)

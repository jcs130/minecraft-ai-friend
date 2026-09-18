"""Use Qwen's packaged skills and native ToolGuard, without a second tool runtime.

These rules are pre-execution checks, not an OS sandbox. General shell execution
is intentionally absent: the shell tool can only manage this role's native cron.
"""
from copy import deepcopy
import hashlib
import importlib.metadata
import importlib.util
import json
from pathlib import Path
import re
from life_memory_policy import dynamic_memory_tools

HERE = Path(__file__).resolve().parent
NATIVE_SKILLS = ('make-skill', 'file_reader', 'cron')
FILE_TOOLS = ('read_file', 'write_file', 'edit_file', 'append_file')
def package_version():
    try:
        version = importlib.metadata.version('qwenpaw')
    except importlib.metadata.PackageNotFoundError:
        # Host-side configuration/tests retain the old contract until the
        # reviewed target package is actually installed in their runtime.
        version = '2.2.0'
    if version not in ('2.2.0', '2.2.1'):
        raise ValueError('review_new_qwen_skill_contract')
    return version


NATIVE_TOOLS = (*FILE_TOOLS,
    *(('materialize_skill',) if package_version() == '2.2.0' else ()),
    'get_current_time', 'execute_shell_command')


def enabled_native_tools(role, runtime='game'):
    from team_native_policy import native_tools
    # A validated caller supplies its own role. Dynamic identities are checked
    # again by the runtime against the persisted team registry.
    return set(NATIVE_TOOLS) | set(native_tools(role, runtime, registered_roles=(role,)))
PREFIX = 'QD_NATIVE_'
# Shared across every role: the world-level notes tree (docs/WORLD-NOTES.md).
WORLD_NOTES = '/state/work/world-notes/'

FILE_NOTE = '\n\n<!-- qiandeng-personal-files-v1 -->\n你已获准使用 Qwen 原生 read_file、write_file、append_file、edit_file，在自己的工作区持久保存经验、失败复盘、参考资料和代码草稿，不需要再次请求文件写入许可。建议 notes/index.md 仅记主题、短摘要和路径，notes/ 下分主题记录事实/来源/时间/适用条件/未验证事项，drafts/ 保存草稿；已有内容先读再追加或定点修改。资料不会自动全部加载；当前任务需要旧经验时先读简短索引，再读相关一页。写入成功以工具回执为准，关键资料读回核对。若本角色已启用 qd-skill-evolution，需要整理方法时按需读取其 references/notes.md；成熟流程可通过原生 materialize_skill 保存，已启用官方 make-skill 时优先参照其流程。尚未安装的技能与参考页不能当作已可用。\n个人文件可长期积累；写下计划或代码不代表游戏已经执行或技能测试通过。文件工作与当前任务共用一次推理流程，不另起后台模型循环。身份、驱动和预算等受管理配置仍由对应服务维护。\n'


if package_version() == '2.2.1':
    FILE_NOTE = FILE_NOTE.replace('成熟流程可通过原生 materialize_skill 保存，已启用官方 make-skill 时优先参照其流程。',
        '成熟流程参照已启用的官方 make-skill 2.0，通过四个本地脚本保存并校验。')


def packaged_skills_root():
    spec = importlib.util.find_spec('qwenpaw')
    assert spec and spec.origin, 'Pinned QwenPaw package is required'
    return Path(spec.origin).parent / 'agents/skills'


def native_lock(version=None):
    lock = json.loads((HERE / 'native-role-skills.json').read_text(encoding='utf-8'))
    version = version or package_version()
    if version == lock['packageVersion']:
        return lock
    entry = lock.get('versions', {}).get(version)
    assert entry and entry['packageVersion'] == version, 'Pinned native skills are required'
    return entry


def native_content(name, root=None, version=None):
    lock = native_lock(version)
    assert name in NATIVE_SKILLS
    entry = lock['skills'][name]
    path = Path(root or packaged_skills_root()) / entry['source'] / 'SKILL.md'
    body = path.read_bytes()
    assert not path.is_symlink() and hashlib.sha256(body).hexdigest() == entry['sha256']
    return body.decode('utf-8')


def directory_hashes(directory):
    directory = Path(directory)
    assert directory.is_dir() and not directory.is_symlink()
    result = {}
    for path in directory.rglob('*'):
        assert not path.is_symlink(), 'Native skill symlink is not allowed'
        if path.is_file():
            relative = path.relative_to(directory).as_posix()
            # CPython can generate these from the immutable official imports;
            # never load them as source or count them as package artifacts.
            if '__pycache__' in path.relative_to(directory).parts or path.suffix == '.pyc':
                continue
            result[relative] = hashlib.sha256(path.read_bytes()).hexdigest()
    return result


def native_package_files(name, root=None, version=None):
    lock = native_lock(version)
    assert name in NATIVE_SKILLS
    entry = lock['skills'][name]
    directory = Path(root or packaged_skills_root()) / entry['source']
    expected = entry.get('files', {'SKILL.md': entry['sha256']})
    if lock['packageVersion'] == '2.2.0':
        # The existing deployment intentionally installed only this Markdown.
        assert hashlib.sha256((directory / 'SKILL.md').read_bytes()).hexdigest() == entry['sha256']
    else:
        assert directory_hashes(directory) == expected, 'Official native skill package changed'
    return {path: {'sha256': digest, 'path': directory / path} for path, digest in expected.items()}


def configure_native_scanner(scanner, version=None):
    """Keep blocking, except the exact reviewed official syntax checker bytes.

    Qwen's own scanner flags compile(..., 'exec') in its MakeSkill validator.
    Use the native name+content hash whitelist, never a name-only exception.
    """
    result = deepcopy(scanner or {})
    result['mode'] = 'block'
    if (version or package_version()) == '2.2.1':
        expected = native_lock('2.2.1')['skills']['make-skill']['scannerContentSha256']
        whitelist = result.setdefault('whitelist', [])
        entries = [row for row in whitelist if row.get('skill_name') == 'make-skill']
        if any(row.get('content_hash') != expected for row in entries):
            raise ValueError('review_existing_make_skill_scanner_exception')
        if not entries:
            whitelist.append({'skill_name':'make-skill','content_hash':expected})
    return result


def rules(role):
    assert re.fullmatch(r'[A-Za-z0-9_-]{4,64}|default', role)
    base = re.escape('/state/work/workspaces/' + role + '/')
    segment = r'(?!\.{1,2}(?:/|\Z))[A-Za-z0-9_.\-\u4e00-\u9fff ]+'
    # 2026-09-18: the world-notes tree is shared on purpose, so it joins the workspace
    # as an allowed root. Design: docs/WORLD-NOTES.md. What this does *not* change is the
    # isolation between roles - another role's workspace is still denied, and the test
    # that pins that ("a role cannot read another role's notes") still holds. Only the
    # explicitly shared tree is opened, which is the difference between "shared" and
    # "someone else's private memory".
    shared = re.escape(WORLD_NOTES)
    path = rf'(?:{base}|{shared})?{segment}(?:/{segment})*'
    # A migrated role retains its historical weekly job ID, but the native
    # CLI must address its new workspace, never a same-named game role.
    from world_team_hosts import logical_role_of_target
    weekly_role = logical_role_of_target(role) or role
    cli = rf'qwenpaw cron (?:list --agent-id {role}|(?:get|state|pause|resume) qd-learning-{weekly_role} --agent-id {role})'
    if package_version() == '2.2.1':
        from native_make_skill_policy import command_pattern
        cli = rf'(?:{cli}|{command_pattern(role)})'
    def row(suffix, tools, params, patterns, description):
        return {'id': PREFIX + suffix, 'tools': list(tools), 'params': params, 'category': 'command_injection',
                'severity': 'HIGH', 'patterns': patterns, 'exclude_patterns': [], 'description': description,
                'remediation': 'Use this role workspace and its existing native weekly job.'}
    result = [
        row('FILE_SCOPE', FILE_TOOLS, ['file_path'], [rf'\A(?!{path}\Z)'], 'Files belong to the current role workspace.'),
        row('MANAGED_WRITE', FILE_TOOLS[1:], ['file_path'],
            [rf'\A(?:{base})?(?:AGENTS\.md|SOUL\.md|PROFILE\.md|agent\.json|skill\.json|jobs\.json|drivers(?:/|\Z)|learning(?:/|\Z)|skills/(?:qd-|make-skill/|file_reader/|cron/))'],
            'Managed identity, budget, drivers and supplied skills are maintained through their native services.'),
        row('CRON_SCOPE', ['execute_shell_command'], ['command'], [rf'\A(?!{cli}\Z)'], 'Only this role native cron and reviewed MakeSkill scripts are allowed.'),
        row('SKILL_NAMESPACE', ['materialize_skill'], ['name'], [r'\A(?:qd-|make-skill\Z|file_reader\Z|cron\Z)'],
            'Native learned skills use their own names; qd- names are reserved for validated game integrations.'),
    ]
    if package_version() == '2.2.1':
        result = [item for item in result if item['id'] != PREFIX + 'SKILL_NAMESPACE']
        result.append(row('MAKE_SKILL_PLAN', FILE_TOOLS[1:], ['file_path'],
            [rf'\A(?:{base})?\.qwenpaw/make-skill/drafts/[a-f0-9]{{24}}/plan\.json\Z'],
            'The official MakeSkill initializer owns its plan snapshot.'))
    if role in ('mc-god', 'qd-engineer'):
        # Source is ordinary editable workspace content. Git metadata and
        # engineering records are written only by the fixed MCP/control tools.
        result.append(row('ENGINEERING_METADATA', FILE_TOOLS, ['file_path'],
            [rf'(?i:\A(?:{base})?engineering/(?!repo/))',
             rf'(?i:\A(?:{base})?engineering/repo/(?:[^/]+/)*\.git[ .]*(?:/|\Z))'],
            'Engineering Git metadata and receipts are managed by the engineering tools.'))
    return result


def sensitive_paths(role):
    base = '/state/work/workspaces/' + role + '/'
    return ['/run/secrets/', '/proc/', '/sys/', '/dev/',
            base + 'agent.json', base + 'drivers/', base + 'sessions/', base + 'chats/',
            '/state/work/config.json', '/state/work/providers.json']


def configure_native(agent, role, runtime='game'):
    result = deepcopy(agent)
    result['tools'] = result.get('tools') or {}
    tools = result['tools'].setdefault('builtin_tools', {})
    enabled = enabled_native_tools(role, runtime)
    for name in enabled:
        tools.setdefault(name, {'name': name, 'config': {}})['enabled'] = True
    for name, value in tools.items():
        if name not in enabled:
            value['enabled'] = False
    result['security'] = result.get('security') or {}
    security = result['security']
    guard = security.setdefault('tool_guard', {})
    guard['enabled'] = True
    guard['guarded_tools'] = sorted(set(guard.get('guarded_tools') or []) | enabled)
    # Qwen adds ReMe tools after the workspace builtin list. Preserve only the
    # approved life-role memory aliases; do not invent builtin tool entries.
    dynamic_tools = dynamic_memory_tools(result, role, runtime)
    guard['denied_tools'] = sorted((set(guard.get('denied_tools', [])) | set(tools)) - enabled - dynamic_tools)
    guard['custom_rules'] = [row for row in guard.get('custom_rules', []) if not row['id'].startswith(PREFIX)] + rules(role)
    required = {row['id'] for row in rules(role)} | {'SENSITIVE_FILE_BLOCK', 'SAFETY_CHECKS_DESTRUCTIVE_COMMAND'}
    guard['auto_denied_rules'] = sorted(set(guard.get('auto_denied_rules', [])) | required)
    guard['disabled_rules'] = [name for name in guard.get('disabled_rules', []) if name not in required]
    files = security.setdefault('file_guard', {})
    files['enabled'] = True
    files['allow_preview_outside_workspace'] = False
    files['sensitive_files'] = sorted(set(files.get('sensitive_files', [])) | set(sensitive_paths(role)))
    security['skill_scanner'] = configure_native_scanner(security.get('skill_scanner'))
    result['approval_level'] = 'AUTO'
    return result


def validate_native(agent, role, runtime='game'):
    assert {name for name, value in agent['tools']['builtin_tools'].items() if value['enabled']} == enabled_native_tools(role, runtime)
    expected = configure_native(agent, role, runtime)
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
        if lock.get('packageVersion', '2.2.0') == '2.2.1':
            assert directory_hashes(path.parent) == lock['skills'][name]['files']
    return len(NATIVE_SKILLS)

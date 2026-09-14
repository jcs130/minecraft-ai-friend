"""Pre-execution checks for the four official MakeSkill 2.0 scripts.

Execution remains QwenPaw's execute_shell_command. This module neither runs
scripts nor creates skills, schedules, subprocesses, or model requests.
"""
from __future__ import annotations

import json
from pathlib import Path
import re

STAGES = ('create_plan', 'init_draft', 'validate_skill', 'publish_skill')
ROLE = re.compile(r'[A-Za-z0-9_-]{4,64}|default')
NAME = re.compile(r'[a-z0-9]+(?:-[a-z0-9]+)*')
RESERVED = re.compile(r'qd-|make-skill\Z|file_reader\Z|cron\Z')
INPUT = r'(?:notes|drafts)/[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)*\.json'


def command_pattern(role):
    if not isinstance(role, str) or not ROLE.fullmatch(role):
        raise ValueError('make_skill_role_invalid')
    base = re.escape('/state/work/workspaces/' + role + '/')
    return rf'python -B scripts/(?:{"|".join(STAGES)})\.py --input {base}{INPUT}'


def _file(path, workspace, maximum=131072):
    path = Path(path)
    root = Path(workspace).resolve()
    if not path.is_absolute() or not path.is_relative_to(Path(workspace)):
        raise ValueError('make_skill_input_scope')
    current = path
    while current != Path(workspace):
        if current.is_symlink():
            raise ValueError('make_skill_symlink')
        current = current.parent
    if path.is_symlink() or path.resolve() != path or not path.resolve().is_relative_to(root):
        raise ValueError('make_skill_input_scope')
    if not path.is_file() or path.stat().st_size > maximum:
        raise ValueError('make_skill_input_size')
    value = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(value, dict):
        raise ValueError('make_skill_input_object')
    return value


def _name(plan):
    if not isinstance(plan, dict):
        raise ValueError('make_skill_plan_required')
    name = plan.get('name')
    if (not isinstance(name, str) or len(name) > 64 or not NAME.fullmatch(name)
            or RESERVED.match(name)):
        raise ValueError('make_skill_reserved_or_invalid_name')


def validate_shell(role, arguments, workspace, *, package_root=None, version=None):
    """Raise on any non-MakeSkill request; return True without rewriting it.

    The caller must still run the ordinary native permission and shell chain.
    ``workspace`` is supplied by that chain, never taken from tool arguments.
    """
    from native_role_capabilities import native_package_files, package_version
    if (version or package_version()) != '2.2.1':
        raise ValueError('make_skill_version_not_supported')
    command = arguments.get('command')
    if not isinstance(command, str) or not re.fullmatch(command_pattern(role), command):
        raise ValueError('make_skill_command_not_allowed')
    workspace = Path(workspace)
    if workspace.as_posix() != '/state/work/workspaces/' + role or workspace.is_symlink():
        raise ValueError('make_skill_workspace_scope')
    directory = workspace / 'skills/make-skill'
    if arguments.get('cwd') is None or Path(str(arguments['cwd'])) != directory:
        raise ValueError('make_skill_cwd_required')
    # All imports and references must remain the reviewed official package.
    expected = native_package_files('make-skill', root=package_root, version='2.2.1')
    from native_role_capabilities import directory_hashes
    if directory_hashes(directory) != {key: row['sha256'] for key, row in expected.items()}:
        raise ValueError('make_skill_package_changed')
    parts = command.split(' ')
    stage = Path(parts[2]).stem
    payload = _file(Path(parts[4]), workspace)
    if stage == 'create_plan':
        _name(payload)
    else:
        if payload.get('workspace') != workspace.as_posix():
            raise ValueError('make_skill_payload_workspace_scope')
        if stage == 'init_draft':
            _name(payload.get('plan'))
        else:
            draft = payload.get('draft_id')
            if not isinstance(draft, str) or not re.fullmatch(r'[a-f0-9]{24}', draft):
                raise ValueError('make_skill_draft_invalid')
            plan = _file(workspace / '.qwenpaw/make-skill/drafts' / draft / 'plan.json', workspace)
            _name(plan)
    return True

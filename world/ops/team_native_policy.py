"""Argument checks for QwenPaw 2.2's existing collaboration tools.

This is a pre-execution check, not another task runtime. The caller must keep
Qwen's normal ToolGuard/FileGuard checks and validate persisted case/task access
at the integration boundary. Native calls do not implement the A2A wire protocol.

Use ``team_request_help`` for player/expert reports: that adapter persists and
deduplicates the case notification. Direct native dispatch is for team leads.
"""
from copy import deepcopy
import math
import re


TOOL_ALIASES = {
    'list_agents': 'list_agents', 'ListAgents': 'list_agents',
    'chat_with_agent': 'chat_with_agent', 'ChatWithAgent': 'chat_with_agent',
    'submit_to_agent': 'submit_to_agent', 'SubmitToAgent': 'submit_to_agent',
    'check_agent_task': 'check_agent_task', 'CheckAgentTask': 'check_agent_task',
    'spawn_subagent': 'spawn_subagent', 'SpawnSubagent': 'spawn_subagent',
}
NATIVE_TEAM_TOOLS = frozenset(TOOL_ALIASES.values())
TEAM_TOOLS = NATIVE_TEAM_TOOLS
TEAM_TOOL_NAMES = frozenset(TOOL_ALIASES)
LEADS = frozenset({'mc-god', 'qd-engineer', 'qd-guild-planner'})
BASE_ROLES = frozenset({
    *LEADS, 'mc-herald', 'qd-survivor', 'qd-villager-dialogue', 'qd-maid-dialogue',
})
BASIC_TOOLS = frozenset({'list_agents', 'check_agent_task'})
SUBAGENT_TOOLS = frozenset({
    'Skill', 'read_file', 'write_file', 'append_file', 'edit_file',
    'get_current_time',
})
CASE_PATTERN = re.compile(r'(?<![A-Za-z0-9_-])case-[0-9a-f]{20}(?![A-Za-z0-9_-])')
ROLE_PATTERN = re.compile(r'[A-Za-z0-9_-]{4,64}')


def canonical_tool(name):
    """Resolve only verified Qwen function/permission names; unknown -> None."""
    return TOOL_ALIASES.get(name) if isinstance(name, str) else None


def make_skill_tool():
    """Select the installed native creator; its role guard still runs in children."""
    # Import lazily: native_role_capabilities uses native_tools during setup.
    from native_role_capabilities import package_version
    return 'execute_shell_command' if package_version() == '2.2.1' else 'materialize_skill'


def subagent_tools():
    return SUBAGENT_TOOLS | {make_skill_tool()}


def _role(actor, runtime):
    if runtime != 'game' or not isinstance(actor, str):
        return None
    role = actor.removeprefix('game:')
    return role if ROLE_PATTERN.fullmatch(role) else None


def native_tools(role, runtime='game', registered_roles=()):
    """Tools to enable for an exact native ID in the current game instance.

    ``registered_roles`` comes from the caller's validated registry, never from
    model arguments. Unknown roles and other runtimes receive no authority.
    """
    role = _role(role, runtime)
    if not role or role not in BASE_ROLES | set(registered_roles):
        return frozenset()
    return NATIVE_TEAM_TOOLS if role in LEADS else BASIC_TOOLS


def case_session(case_id, target):
    if not isinstance(case_id, str) or not CASE_PATTERN.fullmatch(case_id) or target not in LEADS:
        raise ValueError('team_case_session_invalid')
    return 'world-case:' + case_id + ':' + target


def _keys(arguments, allowed):
    if not isinstance(arguments, dict) or set(arguments) - set(allowed):
        raise ValueError('team_arguments_not_allowed')


def _text(value, code):
    if not isinstance(value, str) or not value.strip() or '\x00' in value:
        raise ValueError(code)
    return value


def _timeout(arguments, key):
    value = arguments.get(key)
    if value is None:
        return
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        raise ValueError('team_timeout_invalid')
    try:
        number = float(value)
    except ValueError as exc:
        raise ValueError('team_timeout_invalid') from exc
    if not math.isfinite(number) or number <= 0:
        raise ValueError('team_timeout_invalid')


def validate(actor, arguments, tool, *, runtime='game', registered_roles=(),
             case_check=None, task_check=None):
    """Return an unchanged copy of permitted arguments or raise ``ValueError``.

    ``actor`` is the trusted native ID (or ``game:<id>``) from runtime context.
    Governance aliases are accepted for ``tool``, never for body tool names.
    Callback contracts, if supplied, are ``case_check(actor, target, case_id)``
    and ``task_check(actor, task_id)``; both use fully qualified game actors and
    must return True. Callers may instead perform those persistent access checks
    themselves. This pure validator neither creates tasks nor marks them done.
    """
    name = canonical_tool(tool)
    role = _role(actor, runtime)
    if not name or name not in native_tools(actor, runtime, registered_roles):
        raise ValueError('team_tool_not_allowed')
    actor = 'game:' + role
    if name == 'list_agents':
        # Even an empty override is disallowed: use this Qwen instance only.
        _keys(arguments, ())
    elif name == 'check_agent_task':
        _keys(arguments, ('task_id',))
        task_id = arguments.get('task_id')
        if not isinstance(task_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', task_id):
            raise ValueError('team_task_id_invalid')
        if task_check is not None and task_check(actor, task_id) is not True:
            raise ValueError('team_task_access_denied')
    elif name in ('submit_to_agent', 'chat_with_agent'):
        timeout_key = 'task_timeout' if name == 'submit_to_agent' else 'timeout'
        _keys(arguments, ('to_agent', 'text', 'session_id', timeout_key))
        target = arguments.get('to_agent')
        if target not in LEADS or target == role:
            raise ValueError('team_target_not_allowed')
        text = _text(arguments.get('text'), 'team_text_required')
        # Native Qwen preserves caller-supplied identity prefixes. Reject those
        # here so its own current runtime identity supplies the only prefix.
        if re.match(r'^\s*\[(?:Agent\s|来自智能体\s)', text):
            raise ValueError('team_identity_prefix_not_allowed')
        cases = set(CASE_PATTERN.findall(text))
        if len(cases) != 1:
            raise ValueError('team_single_case_required')
        case_id = next(iter(cases))
        if arguments.get('session_id') != case_session(case_id, target):
            raise ValueError('team_case_session_required')
        if case_check is not None and case_check(actor, 'game:' + target, case_id) is not True:
            raise ValueError('team_case_access_denied')
        _timeout(arguments, timeout_key)
    else:
        _keys(arguments, ('task', 'fork', 'background', 'timeout', 'allowed_tools', 'skills', 'batch'))
        _text(arguments.get('task'), 'team_subagent_task_required')
        # No coercion here: a string false must never accidentally enable fork.
        if 'fork' in arguments and arguments['fork'] is not False:
            raise ValueError('team_subagent_fork_not_allowed')
        if arguments.get('batch') is not None:
            raise ValueError('team_subagent_batch_not_allowed')
        if 'background' in arguments and not isinstance(arguments['background'], bool):
            raise ValueError('team_subagent_background_invalid')
        allowed = arguments.get('allowed_tools')
        available = subagent_tools()
        if (not isinstance(allowed, list)
                or not all(isinstance(item, str) and item in available for item in allowed)
                or len(allowed) != len(set(allowed))):
            raise ValueError('team_subagent_explicit_safe_tools_required')
        skills = arguments.get('skills')
        if skills is not None and (not isinstance(skills, list)
                or not all(isinstance(item, str) and re.fullmatch(r'[A-Za-z0-9_-]{1,100}', item) for item in skills)
                or len(skills) != len(set(skills))):
            raise ValueError('team_subagent_skills_invalid')
        _timeout(arguments, 'timeout')
    return deepcopy(arguments)

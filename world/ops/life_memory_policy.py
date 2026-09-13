"""Native ReMe policy for the two explicitly bound game-life party members.

No model/provider selection, storage rewrite, task submission, or scheduling
process. Qwen 2.2 dynamically registers memory_search outside builtin_tools;
its governance name is MemorySearch. Auto-memory's interval counts user queries,
not minutes. The separate learning heartbeat is owned by the native scheduler.
"""
from copy import deepcopy

from party_role_capabilities import party_roles

POLICY_VERSION = 1
MEMORY_TOOLS = frozenset({'memory_search', 'MemorySearch'})
MEMORY_VALUES = {
    'auto_memory_interval': 5,
    'memory_search_enabled': True,
    'dream_cron_enabled': True,
    'dream_cron': '0 * * * *',
}
AUTO_SEARCH = {'enabled': True, 'max_results': 3}


def in_scope(role, runtime='game'):
    """The validated public party binding supplies the current independent maid ID."""
    return runtime == 'game' and role in party_roles()


def dynamic_memory_tools(profile, role, runtime='game'):
    """Permission aliases only; never insert these functions into builtin_tools."""
    enabled = profile.get('running', {}).get('reme_light_memory_config', {}).get('memory_search_enabled')
    return MEMORY_TOOLS if enabled is True and in_scope(role, runtime) else frozenset()


def _memory(profile, role):
    if profile.get('id') != role or profile.get('workspace_dir') != '/state/work/workspaces/' + role:
        raise ValueError('life_memory_identity_mismatch')
    running = profile.get('running')
    if not isinstance(running, dict) or running.get('memory_manager_backend') != 'remelight':
        raise ValueError('existing_remelight_backend_required')
    memory = running.get('reme_light_memory_config')
    if not isinstance(memory, dict) or not isinstance(memory.get('auto_memory_search_config'), dict):
        raise ValueError('existing_memory_config_required')
    return memory


def apply_profile(profile, role, runtime='game'):
    """Return a new profile, preserving every unrelated field and provider choice."""
    result = deepcopy(profile)
    if not in_scope(role, runtime):
        return result
    memory = _memory(result, role)
    memory.update(MEMORY_VALUES)
    memory['auto_memory_search_config'].update(AUTO_SEARCH)
    guard = result.get('security', {}).get('tool_guard')
    if isinstance(guard, dict):
        guard['denied_tools'] = [name for name in guard.get('denied_tools', []) if name not in MEMORY_TOOLS]
    validate_profile(result, role, runtime)
    return result


def validate_profile(profile, role, runtime='game'):
    """Return False outside scope; require the exact native policy inside scope."""
    if not in_scope(role, runtime):
        return False
    memory = _memory(profile, role)
    for key, expected in MEMORY_VALUES.items():
        assert type(memory.get(key)) is type(expected) and memory[key] == expected, 'life_memory_policy_drift:' + key
    for key, expected in AUTO_SEARCH.items():
        actual = memory['auto_memory_search_config'].get(key)
        assert type(actual) is type(expected) and actual == expected, 'life_memory_search_drift:' + key
    denied = profile.get('security', {}).get('tool_guard', {}).get('denied_tools', [])
    assert not set(denied) & MEMORY_TOOLS, 'native_memory_tool_denied'
    return True

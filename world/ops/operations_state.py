"""Storage ownership follows the verified operations host, not inherited env."""
from pathlib import Path
from world_team_hosts import migration_for, require_host


def state_root(role, *, native_role=None, native_runtime=None):
    actor = 'operations:' + role
    entry = migration_for(actor)
    if entry is None:
        raise ValueError('unknown_operations_role')
    if (native_role is None) != (native_runtime is None):
        raise ValueError('incomplete_operations_native_host')
    runtime = native_runtime or 'operations'
    physical = native_role or role
    require_host(actor, runtime, physical)
    if runtime == 'game' and entry['target'] == {'runtime':runtime,'agentId':physical}:
        return Path('/operations-state')
    if runtime == 'operations' and entry['source'] == {'runtime':runtime,'agentId':physical}:
        return Path('/state')
    raise ValueError('invalid_operations_native_host')

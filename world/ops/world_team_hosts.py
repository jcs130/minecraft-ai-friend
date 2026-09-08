"""One managed native host relocation; logical authorship never changes.

Missing configuration keeps the legacy host. Prepared authorizes configuration
of the target only; execution switches exclusively when phase becomes active.
This module only reads the bounded manifest and never writes migration state.
"""
import json
from functools import wraps
import inspect
import os
from pathlib import Path
import re

ENGINEER = 'operations:mc-god'
SOURCE = {'runtime': 'operations', 'agentId': 'mc-god'}
TARGET = {'runtime': 'game', 'agentId': 'qd-engineer'}
MIGRATION = 'engineer-to-game-v1'


def host_config(path=None):
    path = Path(path or os.environ.get('TEAM_RUNTIME_HOSTS_FILE', '/team/runtime-hosts.json'))
    if any(p.is_symlink() or getattr(p, 'is_junction', lambda: False)() for p in (path, *path.parents)):
        raise ValueError('linked_team_host_manifest')
    if not path.exists():
        return {'schema': 1, 'migration': MIGRATION, 'phase': 'legacy',
                'logicalActor': ENGINEER, 'source': dict(SOURCE), 'target': dict(TARGET)}
    with path.open('rb') as stream:
        raw = stream.read(8193)
    if len(raw) > 8192:
        raise ValueError('oversized_team_host_manifest')
    def unique(pairs):
        value = {}
        for key, item in pairs:
            if key in value: raise ValueError('duplicate_team_host_field')
            value[key] = item
        return value
    value = json.loads(raw.decode('utf-8-sig'), object_pairs_hook=unique)
    if (not isinstance(value, dict)
            or set(value) != {'schema', 'migration', 'phase', 'logicalActor', 'source', 'target'}
            or type(value['schema']) is not int or value['schema'] != 1
            or value['migration'] != MIGRATION or value['logicalActor'] != ENGINEER
            or value['phase'] not in ('prepared', 'active')
            or value['source'] != SOURCE or value['target'] != TARGET):
        raise ValueError('invalid_team_host_manifest')
    return value


def native_host(actor, *, config=None):
    """Current executable host for a logical actor (not a name-based alias)."""
    value = host_config() if config is None else config
    if actor == ENGINEER:
        return dict(TARGET if value['phase'] == 'active' else SOURCE)
    if not isinstance(actor, str) or not re.fullmatch(r'(?:game|operations):[A-Za-z0-9_-]{1,80}', actor):
        raise ValueError('invalid_logical_actor')
    runtime, role = actor.split(':', 1)
    if {'runtime': runtime, 'agentId': role} == TARGET:
        raise ValueError('native_host_is_not_logical_actor')
    return {'runtime': runtime, 'agentId': role}


def logical_actor(runtime, role, *, allow_prepared=False, config=None):
    """Reverse binding. A retired source or inactive target has no authority."""
    value = host_config() if config is None else config
    location = {'runtime': runtime, 'agentId': role}
    if location == TARGET:
        return ENGINEER if value['phase'] == 'active' or (allow_prepared and value['phase'] == 'prepared') else None
    if location == SOURCE:
        return None if value['phase'] == 'active' else ENGINEER
    actor = runtime + ':' + role
    return actor if re.fullmatch(r'(?:game|operations):[A-Za-z0-9_-]{1,80}', actor) else None


def require_host(actor, runtime, role):
    if logical_actor(runtime, role) != actor:
        raise ValueError('team_native_host_inactive')


def active_hosted_engineer():
    return host_config()['phase'] == 'active'


def native_inventory(inventory):
    value = host_config()
    result = {actor: native_host(actor, config=value) for actor in inventory}
    if len({(row['runtime'], row['agentId']) for row in result.values()}) != len(result):
        raise ValueError('duplicate_team_native_host')
    return result


def host_tool_app(app, actor, native_runtime=None, native_role=None):
    """Guard each engineer MCP call, including a process opened before cutover.

    Legacy source argv defaults to the source identity. Only the target receives
    explicit native argv; changing the logical author cannot claim a new host.
    Other team members keep their original registration path and tool schemas.
    """
    if actor != ENGINEER:
        if native_runtime is not None or native_role is not None:
            raise ValueError('unexpected_team_native_host')
        return app
    if (native_runtime is None) != (native_role is None):
        raise ValueError('incomplete_team_native_host')
    runtime = SOURCE['runtime'] if native_runtime is None else native_runtime
    role = SOURCE['agentId'] if native_role is None else native_role
    require_host(actor, runtime, role)

    class HostBoundTools:
        def tool(self, *args, **kwargs):
            def register(fn):
                if inspect.iscoroutinefunction(fn):
                    @wraps(fn)
                    async def guarded(*a, **kw):
                        require_host(actor, runtime, role)
                        return await fn(*a, **kw)
                else:
                    @wraps(fn)
                    def guarded(*a, **kw):
                        require_host(actor, runtime, role)
                        return fn(*a, **kw)
                return app.tool(*args, **kwargs)(guarded)
            return register
    return HostBoundTools()

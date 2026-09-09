"""Managed native host relocations; logical authorship never changes.

Each migration moves one existing operations role onto the single game QwenPaw
instance under an exact predefined target ID. Missing configuration keeps every
legacy host. Prepared authorizes configuration of the target only; execution
switches exclusively when that migration's phase becomes active. Phases are
independent per migration. This module only reads the bounded manifest and never
writes migration state.
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

_AGENT_ID = re.compile(r'[A-Za-z0-9_-]{1,80}')


def _entry(migration, source_role, target_role):
    entry = {'migration': migration, 'logicalActor': 'operations:' + source_role,
             'source': {'runtime': 'operations', 'agentId': source_role},
             'target': {'runtime': 'game', 'agentId': target_role}}
    assert _AGENT_ID.fullmatch(source_role) and _AGENT_ID.fullmatch(target_role)
    return entry


# The single-QwenPaw consolidation registry: one game instance hosts every role.
# Target IDs never collide with existing native game IDs (mc-god/mc-herald stay
# the goddess lanes); renamed targets follow the qd-engineer precedent.
MIGRATIONS = {row['migration']: row for row in (
    _entry(MIGRATION, 'mc-god', 'qd-engineer'),
    _entry('steward-to-game-v1', 'default', 'qd-steward'),
    _entry('diagnostics-to-game-v1', 'mc-herald', 'qd-diagnostics'),
    _entry('priest-to-game-v1', 'mc-priest', 'mc-priest'),
    _entry('guard-kirito-to-game-v1', 'mc-guard-kirito', 'mc-guard-kirito'),
    _entry('guard-naruto-to-game-v1', 'mc-guard-naruto', 'mc-guard-naruto'),
)}
PHASES = ('legacy', 'prepared', 'active')
_BY_ACTOR = {row['logicalActor']: row for row in MIGRATIONS.values()}
_BY_SOURCE = {(row['source']['runtime'], row['source']['agentId']): row for row in MIGRATIONS.values()}
_BY_TARGET = {(row['target']['runtime'], row['target']['agentId']): row for row in MIGRATIONS.values()}
assert len(_BY_ACTOR) == len(MIGRATIONS)
assert len(_BY_SOURCE) == len(_BY_TARGET) == len(MIGRATIONS)
assert not (set(_BY_SOURCE) & set(_BY_TARGET)), 'a location cannot be source and target'


def _legacy_phases():
    return {name: 'legacy' for name in MIGRATIONS}


def registry_config(path=None):
    """Per-migration phases from the bounded manifest; schema 1 stays readable."""
    path = Path(path or os.environ.get('TEAM_RUNTIME_HOSTS_FILE', '/team/runtime-hosts.json'))
    if any(p.is_symlink() or getattr(p, 'is_junction', lambda: False)() for p in (path, *path.parents)):
        raise ValueError('linked_team_host_manifest')
    if not path.exists():
        return _legacy_phases()
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
    if not isinstance(value, dict) or type(value.get('schema')) is not int:
        raise ValueError('invalid_team_host_manifest')
    if value['schema'] == 1:
        if (set(value) != {'schema', 'migration', 'phase', 'logicalActor', 'source', 'target'}
                or value['migration'] != MIGRATION or value['logicalActor'] != ENGINEER
                or value['phase'] not in ('prepared', 'active')
                or value['source'] != SOURCE or value['target'] != TARGET):
            raise ValueError('invalid_team_host_manifest')
        phases = _legacy_phases()
        phases[MIGRATION] = value['phase']
        return phases
    if value['schema'] != 2 or set(value) != {'schema', 'phases'}:
        raise ValueError('invalid_team_host_manifest')
    declared = value['phases']
    if (not isinstance(declared, dict) or not set(declared) <= set(MIGRATIONS)
            or any(declared[name] not in ('prepared', 'active') for name in declared)):
        raise ValueError('invalid_team_host_manifest')
    phases = _legacy_phases()
    phases.update(declared)
    return phases


def host_config(path=None):
    """Compatibility view: the schema-1 shape of the engineer migration."""
    return {'schema': 1, 'migration': MIGRATION, 'phase': registry_config(path)[MIGRATION],
            'logicalActor': ENGINEER, 'source': dict(SOURCE), 'target': dict(TARGET)}


def _phases(config):
    """Accept the registry map, the compatibility view, or load from disk."""
    if config is None:
        return registry_config()
    if not isinstance(config, dict):
        raise ValueError('invalid_team_host_manifest')
    if 'schema' in config:
        if config.get('migration') != MIGRATION or config.get('phase') not in PHASES:
            raise ValueError('invalid_team_host_manifest')
        phases = _legacy_phases()
        phases[MIGRATION] = config['phase']
        return phases
    if not set(config) <= set(MIGRATIONS) or any(config[name] not in PHASES for name in config):
        raise ValueError('invalid_team_host_manifest')
    phases = _legacy_phases()
    phases.update(config)
    return phases


def migration_for(actor):
    """The predefined migration entry of a logical actor, or None."""
    return _BY_ACTOR.get(actor) if isinstance(actor, str) else None


def phase_of(migration, config=None):
    return _phases(config)[migration]


def native_host(actor, *, config=None):
    """Current executable host for a logical actor (not a name-based alias)."""
    phases = _phases(config)
    entry = migration_for(actor)
    if entry is not None:
        return dict(entry['target'] if phases[entry['migration']] == 'active' else entry['source'])
    if not isinstance(actor, str) or not re.fullmatch(r'(?:game|operations):[A-Za-z0-9_-]{1,80}', actor):
        raise ValueError('invalid_logical_actor')
    runtime, role = actor.split(':', 1)
    if (runtime, role) in _BY_TARGET:
        raise ValueError('native_host_is_not_logical_actor')
    return {'runtime': runtime, 'agentId': role}


def logical_actor(runtime, role, *, allow_prepared=False, config=None):
    """Reverse binding. A retired source or inactive target has no authority."""
    phases = _phases(config)
    location = (runtime, role)
    entry = _BY_TARGET.get(location)
    if entry is not None:
        phase = phases[entry['migration']]
        return entry['logicalActor'] if phase == 'active' or (allow_prepared and phase == 'prepared') else None
    entry = _BY_SOURCE.get(location)
    if entry is not None:
        return None if phases[entry['migration']] == 'active' else entry['logicalActor']
    actor = runtime + ':' + role
    return actor if re.fullmatch(r'(?:game|operations):[A-Za-z0-9_-]{1,80}', actor) else None


def require_host(actor, runtime, role):
    if logical_actor(runtime, role) != actor:
        raise ValueError('team_native_host_inactive')


def active_hosted_engineer():
    return phase_of(MIGRATION) == 'active'


def active_game_targets():
    """Native IDs hosted by the game instance through an active migration."""
    phases = registry_config()
    return tuple(row['target']['agentId'] for row in MIGRATIONS.values()
                 if phases[row['migration']] == 'active')


def active_ops_sources():
    """Operations native IDs retired by an active migration."""
    phases = registry_config()
    return frozenset(row['source']['agentId'] for row in MIGRATIONS.values()
                     if phases[row['migration']] == 'active')


def native_inventory(inventory):
    phases = registry_config()
    result = {actor: native_host(actor, config=phases) for actor in inventory}
    if len({(row['runtime'], row['agentId']) for row in result.values()}) != len(result):
        raise ValueError('duplicate_team_native_host')
    return result


def host_tool_app(app, actor, native_runtime=None, native_role=None):
    """Guard each migrated role's MCP call, including a process opened before cutover.

    Legacy source argv defaults to the source identity. Only the target receives
    explicit native argv; changing the logical author cannot claim a new host.
    Roles without a migration keep their original registration path and schemas.
    """
    entry = migration_for(actor)
    if entry is None:
        if native_runtime is not None or native_role is not None:
            raise ValueError('unexpected_team_native_host')
        return app
    if (native_runtime is None) != (native_role is None):
        raise ValueError('incomplete_team_native_host')
    runtime = entry['source']['runtime'] if native_runtime is None else native_runtime
    role = entry['source']['agentId'] if native_role is None else native_role
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

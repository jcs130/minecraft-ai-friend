"""Storage ownership follows the verified operations host, not inherited env."""
from pathlib import Path
from world_team_hosts import migration_for, native_host, require_host


def state_root(role, *, native_role=None, native_runtime=None):
    actor = 'operations:' + role
    entry = migration_for(actor)
    if entry is None:
        raise ValueError('unknown_operations_role')
    if (native_role is None) != (native_runtime is None):
        raise ValueError('incomplete_operations_native_host')
    if native_role is None:
        # 没显式给宿主时，取这个逻辑角色**当前可执行的宿主**（native_host 对 active 迁移给 target）。
        # 不能默认按 source 拼 'operations:<role>' 去 require_host：逻辑角色的 source 一旦迁移完成
        # 就退休，logical_actor 对退休 source 返回 None，于是恒定抛 team_native_host_inactive。
        # 2026-09-19 team_context 一直失败就是这条路径（case-040c7afab2754047376f）。
        host = native_host(actor)
        runtime, physical = host['runtime'], host['agentId']
    else:
        runtime, physical = native_runtime, native_role
    require_host(actor, runtime, physical)
    if runtime == 'game' and entry['target'] == {'runtime':runtime,'agentId':physical}:
        return Path('/operations-state')
    if runtime == 'operations' and entry['source'] == {'runtime':runtime,'agentId':physical}:
        return Path('/state')
    raise ValueError('invalid_operations_native_host')

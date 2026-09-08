"""Bind Qwen 2.2 native permission checks to the current project role.

Qwen's packaged governance deep scan reads global security config. This adapter
adds its own role's native ToolGuard before either official permission wrapper;
the official file/shell/materialization implementations remain unchanged.
"""
import asyncio
from contextvars import ContextVar
import hashlib
import importlib.metadata
import json
from pathlib import Path

from native_role_capabilities import FILE_TOOLS, NATIVE_TOOLS, validate_native

VERSION = 1
CURRENT_ENGINE = ContextVar('qiandeng_native_guard', default=None)
CACHE = {}
INSTALLED = False


def role_engine(role, folder):
    from qwenpaw.security.tool_guard.engine import ToolGuardEngine
    from qwenpaw.security.tool_guard.guardians.file_guardian import FilePathToolGuardian
    from qwenpaw.security.tool_guard.guardians.rule_guardian import RuleBasedToolGuardian, GuardRule
    path = Path(folder) / 'agent.json'
    assert not path.is_symlink() and path.stat().st_size < 262144
    data = path.read_bytes()
    profile = json.loads(data)
    assert profile['id'] == role and profile['workspace_dir'] == str(folder)
    validate_native(profile, role)
    key = (role, hashlib.sha256(data).hexdigest())
    if key in CACHE:
        return CACHE[key]
    engine = ToolGuardEngine(enabled=True)
    for guardian in engine._guardians:
        if isinstance(guardian, FilePathToolGuardian):
            guardian._enabled = True
            guardian.set_sensitive_files(profile['security']['file_guard']['sensitive_files'])
        if isinstance(guardian, RuleBasedToolGuardian):
            guardian._rules = [r for r in guardian.rules if not r.id.startswith('QD_NATIVE_')]
            guardian._rules.extend(GuardRule(row) for row in profile['security']['tool_guard']['custom_rules'])
    assert {'file_path_tool_guardian', 'rule_based_tool_guardian'} <= set(engine.guardian_names)
    guard = profile['security']['tool_guard']
    engine._guarded_tools = set(guard['guarded_tools'])
    engine._denied_tools = set(guard['denied_tools'])
    engine._auto_denied_rules = set(guard['auto_denied_rules'])
    if len(CACHE) >= 128:
        CACHE.clear()
    CACHE[key] = engine
    return engine


def check(engine, name, arguments):
    from qwenpaw.security.tool_guard.guardians.file_guardian import _normalize_path
    if engine.is_denied(name):
        return False
    versions = [arguments]
    if name in FILE_TOOLS and isinstance(arguments.get('file_path'), str):
        # The native normalizer resolves symlinks and relative paths. Apply the
        # exact same native rules to both spelling and final destination.
        versions.append({**arguments, 'file_path': _normalize_path(arguments['file_path'])})
    for value in versions:
        result = engine.guard(name, value)
        if result is None or result.guardians_failed or engine.should_auto_deny_result(result):
            return False
    return True


def install(runtime):
    global INSTALLED
    if INSTALLED:
        return VERSION
    assert importlib.metadata.version('qwenpaw') == '2.2.0'
    from agentscope.permission import PermissionBehavior, PermissionDecision
    from qwenpaw.config.context import get_current_workspace_dir
    from qwenpaw.constant import WORKING_DIR
    import qwenpaw.governance.tool_adapter as policy
    import qwenpaw.runtime.tool_guard as legacy
    import qwenpaw.security.tool_guard.engine as engine_module
    from role_learning_profiles import roles

    original_engine = engine_module.get_guard_engine
    engine_module.get_guard_engine = lambda: CURRENT_ENGINE.get() or original_engine()

    def wrap(original):
        async def scoped(self, input_data=None, context=None, *args, **kwargs):
            # MCP/driver capabilities already have their own fixed policies and
            # credentials. Do not intercept their world or learning operations.
            if self.name not in NATIVE_TOOLS:
                return await original(self, input_data, context, *args, **kwargs)
            request = getattr(self, '_qp_request_context', None) or {}
            role = getattr(self, '_qp_agent_id', None) or request.get('agent_id')
            if role not in roles(runtime):
                return await original(self, input_data, context, *args, **kwargs)
            try:
                folder = Path(WORKING_DIR) / 'workspaces' / role
                actual = get_current_workspace_dir()
                assert actual is not None and Path(actual).resolve() == folder.resolve()
                governor = getattr(self, '_qp_governor', None)
                if governor is not None:
                    assert Path(governor.workspace_dir).resolve() == folder.resolve()
                engine = await asyncio.to_thread(role_engine, role, folder)
                allowed = await asyncio.to_thread(check, engine, self.name, input_data or {})
                assert allowed
            except Exception:
                return PermissionDecision(behavior=PermissionBehavior.DENY,
                    message='Native role guard denied this request. Use this role workspace and existing native weekly job; do not retry scope changes.')
            token = CURRENT_ENGINE.set(engine)
            try:
                return await original(self, input_data, context, *args, **kwargs)
            finally:
                CURRENT_ENGINE.reset(token)
        scoped._qiandeng_native_guard_version = VERSION
        return scoped

    policy._policy_tool_check_permissions = wrap(policy._policy_tool_check_permissions)
    legacy._guarded_tool_check_permissions = wrap(legacy._guarded_tool_check_permissions)
    INSTALLED = True
    return VERSION

"""Recover failed game MCP handlers through QwenPaw's own DriverManager.

Only an explicit unchanged-whitelist PUT can request recovery. GET probes
remain read-only; native credentials, policy, reconnect and task tracking own
the lifecycle. No timer, model retry or replacement MCP client is introduced.
"""
import asyncio
from functools import wraps
import hashlib
import inspect
from pathlib import Path
import time

VERSION = 1
ENDPOINTS = {'numen_survival': 'http://survivor:8089/mcp',
             'maid_native': 'http://npc:8091/mcp',
             'qd_party': 'http://npc:8091/party/mcp'}


def wrap_update(original, clock=time.monotonic):
    @wraps(original)
    async def update(self, client_key, tools):
        before = await self.load_card(client_key)
        unchanged = before.config.get('tools') == tools
        error = None
        try:
            result = await original(self, client_key, tools)
        except Exception as exc:
            if getattr(exc, 'status_code', None) != 502:
                raise
            error, result = exc, []
        workspace = self._workspace
        tracker = getattr(workspace, 'task_tracker', None)
        manager = getattr(workspace, 'driver_manager', None)
        endpoint = before.endpoint
        eligible = (unchanged and client_key in ENDPOINTS and before.enabled
                    and endpoint.get('url') == ENDPOINTS[client_key]
                    and tracker is not None and manager is not None)
        if not result and eligible:
            # Workspace-owned gate survives per-request service objects.
            gates = getattr(workspace, '_qd_mcp_recovery', None)
            if gates is None:
                gates = workspace._qd_mcp_recovery = {}
            gate = gates.setdefault(client_key, {'lock': asyncio.Lock(), 'after': 0})
            async with gate['lock']:
                if clock() >= gate['after'] and not await tracker.has_active_tasks():
                    current = await self.load_card(client_key)
                    if current == before:
                        gate['after'] = clock() + 60
                        await manager.reload_driver(client_key)
                        return await self.list_tools(client_key)
        if error is not None:
            raise error
        return result
    update._qd_recovery_version = VERSION
    return update


def install():
    from qwenpaw_runtime_contract import release
    from qwenpaw.app.mcp.config_service import MCPConfigService
    if release() != '2.2.1':
        raise ValueError('review_native_mcp_recovery_release')
    source = Path(inspect.getfile(MCPConfigService)).read_bytes()
    if hashlib.sha256(source).hexdigest() != 'b0716195fd2b5a53c8f0b6a1c5edcf02fdd44d629316c33518d91ebe81070e19':
        raise ValueError('review_native_mcp_recovery_source')
    original = MCPConfigService.update_tool_whitelist
    if getattr(original, '_qd_recovery_version', None) != VERSION:
        MCPConfigService.update_tool_whitelist = wrap_update(original)
    return VERSION

"""Verify Qwen's active tools, and reconnect only the survivor's saved driver.

A healthy Qwen API and a healthy MCP endpoint do not imply an active Driver:
Qwen 2.2 retains no handler after a failed startup connection. Its whitelist
API saves the same card and schedules a native reload without changing auth.
"""
import json
import os
import time
import urllib.request

from mcp_server import TOOL_NAMES

ROLE = 'qd-survivor'
DRIVER = 'numen_survival'
CLIENT_URL = 'http://survivor:8089/mcp'
TOOLS_ROUTE = '/mcp/tools/' + DRIVER


def base_url(value=None):
    return (value or os.environ.get('QWENPAW_API_URL', 'http://qwenpaw:8088/api')).rstrip('/')


def request(base, route, payload=None):
    data = None if payload is None else json.dumps(payload).encode('utf8')
    req = urllib.request.Request(base_url(base) + route, data=data,
        headers={'X-Agent-Id': ROLE, 'Accept': 'application/json', 'Content-Type': 'application/json'},
        method='GET' if payload is None else 'PUT')
    # Internal service discovery must not be routed through a host proxy.
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req, timeout=5) as response:
        raw = response.read(256 * 1024 + 1)
    if len(raw) > 256 * 1024:
        raise ValueError('native_tools_response_too_large')
    return json.loads(raw)


def valid_tools(value):
    return (isinstance(value, list) and len(value) == len(TOOL_NAMES)
        and all(isinstance(row, dict) and isinstance(row.get('name'), str)
                and row.get('enabled') is True and isinstance(row.get('input_schema'), dict) for row in value)
        and {row['name'] for row in value} == set(TOOL_NAMES))


def require_ready(base_url=None):
    """Read-only, no model calls; false never consumes budget or changes control."""
    try:
        return valid_tools(request(base_url, TOOLS_ROUTE))
    except Exception:
        return False


class NativeToolConnection:
    def __init__(self, base=None, clock=time.monotonic, retry_seconds=30):
        self.base, self.clock = base_url(base), clock
        self.retry_seconds = max(30, retry_seconds)
        self.next_retry = 0

    def ensure_ready(self):
        if require_ready(self.base):
            return True
        now = self.clock()
        if now < self.next_retry:
            return False
        self.next_retry = now + self.retry_seconds
        try:
            saved = request(self.base, '/mcp/' + DRIVER)
            # Respect an operator disabling/changing the client or its whitelist.
            # Never reconstruct endpoint headers or read/write other profiles.
            if (not isinstance(saved, dict) or saved.get('key') != DRIVER or saved.get('enabled') is not True
                    or saved.get('transport') != 'streamable_http' or saved.get('url') != CLIENT_URL):
                return False
            names = saved.get('tools')
            if names is not None and (not isinstance(names, list) or len(names) != len(TOOL_NAMES)
                    or any(not isinstance(name, str) for name in names) or set(names) != set(TOOL_NAMES)):
                return False
            request(self.base, TOOLS_ROUTE, {'tools': list(TOOL_NAMES)})
            # PUT starts an asynchronous native reload. Its response is not proof
            # of readiness: a later GET must see the active capabilities.
            return require_ready(self.base)
        except Exception:
            return False

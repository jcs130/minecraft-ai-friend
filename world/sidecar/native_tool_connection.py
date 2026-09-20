"""Request same-card native MCP recovery before a new embodied life round."""
import time


class NativeTools:
    def __init__(self, transport, clock=time.monotonic):
        self.transport, self.clock, self.after = transport, clock, {}

    def ready(self, role, key, url, names):
        def read():
            rows = self.transport('GET', '/mcp/tools/' + key, role)
            return (isinstance(rows, list) and {r.get('name') for r in rows
                    if isinstance(r, dict) and r.get('enabled') is True} >= set(names))
        try:
            if read():
                return True
        except Exception:
            pass
        if self.clock() < self.after.get((role, key), 0):
            return False
        self.after[role, key] = self.clock() + 60
        try:
            native = self.transport('GET', '/agents/' + role + '/agent-status', role)
            if native.get('status') != 'idle' or native.get('running_task_count') != 0:
                return False
            saved = self.transport('GET', '/mcp/' + key, role)
            if (saved.get('key') != key or saved.get('enabled') is not True
                    or saved.get('url') != url or saved.get('transport') != 'streamable_http'
                    or (saved.get('tools') is not None and not set(names) <= set(saved['tools']))):
                return False
            self.transport('PUT', '/mcp/tools/' + key, role, {'tools': saved.get('tools')})
            return read()
        except Exception:
            return False

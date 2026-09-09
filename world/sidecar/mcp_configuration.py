"""Order native MCP configuration around Qwen 2.2's asynchronous reconnect.

Native client saves return before reload_driver finishes. A reconnect publishes
the card it read before connecting and can overwrite a later policy edit.
For a new client, wait for native active tools before setting policy. For an
existing client, persist policy first so the ensuing reconnect starts with it.
Only GET readiness is retried; a failed/uncertain client write is never repeated.
"""
import re
import time
import urllib.error


def _verify_policy(value, policy):
    if (not isinstance(value, dict) or value.get('unmanaged_rules_count') != 0
            or any(value.get(k) != policy[k] for k in
                   ('default_effect', 'client_overrides', 'tool_defaults', 'tool_overrides'))):
        raise ValueError('native_mcp_policy_not_applied')


def wait_active(api, role, key, tools, *, timeout=30, clock=time.monotonic, sleep=time.sleep,
                previous_tools=None, exposed_tools=None):
    deadline = clock() + timeout
    while True:
        try:
            value = api('GET', '/mcp/tools/' + key, role)
        except urllib.error.HTTPError as error:
            if error.code not in (502, 503):
                raise
        except (TimeoutError, ConnectionError, urllib.error.URLError):
            pass
        else:
            names = {r.get('name') for r in value if isinstance(r, dict) and r.get('enabled') is True} if isinstance(value, list) else set()
            if isinstance(value, list) and len(value) == len(tools) and names == set(tools):
                return
            # A skill reload may already have exposed the updated server's new
            # tools under the old deny policy. Require exactly the declared new
            # surface and exactly the old enabled subset before changing policy.
            if (exposed_tools is not None and isinstance(value, list) and len(value) == len(exposed_tools)
                    and {r.get('name') for r in value if isinstance(r, dict)} == set(exposed_tools)
                    and names == set(tools) and all(type(r.get('enabled')) is bool for r in value)):
                return
            # A known old card may remain active until the asynchronous reload
            # publishes the new handler. Only this exact transition is allowed.
            if not (previous_tools is not None and isinstance(value, list)
                    and len(value) == len(previous_tools) and names == set(previous_tools)):
                raise ValueError('native_mcp_tools_mismatch')
        if clock() >= deadline:
            raise ValueError('native_mcp_activation_pending')
        sleep(min(.25, max(0, deadline - clock())))


def configure_client(api, role, key, client, policy, *, exists, timeout=30, clock=time.monotonic, sleep=time.sleep, previous_tools=None):
    if not re.fullmatch(r'[A-Za-z0-9_-]+', key) or client.get('enabled') is not True:
        raise ValueError('invalid_managed_mcp_client')
    tools = client['tools']
    if previous_tools is not None and (not exists or not isinstance(previous_tools, list)
            or len(previous_tools) != len(set(previous_tools))
            or any(not isinstance(name, str) or not re.fullmatch(r'[A-Za-z0-9_]+', name) for name in previous_tools)):
        raise ValueError('invalid_previous_mcp_tools')
    if exists:
        # An interrupted initial creation may still be connecting. Do not issue
        # another client update over its stale initial ask policy.
        wait_active(api, role, key, tools if previous_tools is None else previous_tools,
                    timeout=timeout, clock=clock, sleep=sleep,
                    exposed_tools=tools if previous_tools is not None else None)
        _verify_policy(api('PUT', '/mcp/policy/' + key, role, policy), policy)
        _verify_policy(api('GET', '/mcp/policy/' + key, role), policy)
        api('PUT', '/mcp/' + key, role, client)
        if previous_tools is not None:
            wait_active(api, role, key, tools, previous_tools=previous_tools,
                        timeout=timeout, clock=clock, sleep=sleep)
    else:
        api('POST', '/mcp', role, {'client_key': key, 'client': client})
        wait_active(api, role, key, tools, timeout=timeout, clock=clock, sleep=sleep)
    _verify_policy(api('PUT', '/mcp/policy/' + key, role, policy), policy)
    _verify_policy(api('GET', '/mcp/policy/' + key, role), policy)
    return {'policyVerified': True, 'clientKey': key}

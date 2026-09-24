"""Verify Qwen's active tools, and reconnect only the survivor's saved driver.

A healthy Qwen API and a healthy MCP endpoint do not imply an active Driver:
Qwen 2.2 retains no handler after a failed startup connection. Its whitelist
API preserves the card; the scoped 2.2.1 compatibility hook calls the native
DriverManager reload only if its normal refresh still has no usable handler.
"""
import json
import os
import time
import urllib.request

from mcp_server import BODY_ACTION_TOOLS, TOOL_NAMES

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
    basic = (isinstance(value, list) and len(value) == len(TOOL_NAMES)
        and all(isinstance(row, dict) and isinstance(row.get('name'), str)
                and row.get('enabled') is True and isinstance(row.get('input_schema'), dict) for row in value)
        and {row['name'] for row in value} == set(TOOL_NAMES))
    if not basic:
        return False
    for row in value:
        if row['name'] not in BODY_ACTION_TOOLS:
            continue
        schema = row['input_schema']
        properties = schema.get('properties', {})
        previous = properties.get('previous_request_id', {}) if isinstance(properties, dict) else {}
        variants = previous.get('anyOf', []) if isinstance(previous, dict) else []
        if (not isinstance(previous, dict) or previous.get('default', 'missing') is not None
                or not isinstance(variants, list) or len(variants) != 2
                or not all(isinstance(part, dict) and part.get('type') in ('string', 'null') for part in variants)
                or {part['type'] for part in variants} != {'string', 'null'}
                or 'previous_request_id' in schema.get('required', [])):
            return False
    say = next(row for row in value if row['name'] == 'say')['input_schema']
    speech = say.get('properties', {})
    receipt = next(row for row in value if row['name'] == 'say_status')['input_schema']
    if (not isinstance(speech, dict) or speech.get('turn_id', {}).get('type') != 'string'
            or speech.get('text', {}).get('type') != 'string'
            or speech.get('voice', {}).get('type') != 'boolean'
            or speech.get('voice', {}).get('default') is not True
            or set(say.get('required', [])) != {'turn_id', 'text'}
            or receipt.get('properties', {}).get('message_id', {}).get('type') != 'string'
            or receipt.get('required') != ['message_id']):
        return False
    status_schema = next(row for row in value if row['name'] == 'status')['input_schema']
    status_properties = status_schema.get('properties', {})
    detail = status_properties.get('detail', {}) if isinstance(status_properties, dict) else {}
    choices = detail.get('enum') if isinstance(detail, dict) else None
    required = status_schema.get('required', [])
    if (not isinstance(detail, dict) or detail.get('type') != 'string'
            or detail.get('default') != 'brief' or not isinstance(choices, list)
            or len(choices) != 2 or not all(isinstance(choice, str) for choice in choices)
            or set(choices) != {'full', 'brief'}
            or not isinstance(required, list) or 'detail' in required):
        return False
    memory_schema = next(row for row in value if row['name'] == 'remember')['input_schema']
    properties = memory_schema.get('properties', {})
    goal = properties.get('goal', {}) if isinstance(properties, dict) else {}
    variants = goal.get('anyOf', []) if isinstance(goal, dict) else []
    if (not isinstance(goal, dict) or goal.get('default', 'missing') is not None
            or not isinstance(variants, list) or len(variants) != 2
            or not all(isinstance(part, dict) and part.get('type') in ('string', 'null') for part in variants)
            or {part['type'] for part in variants} != {'string', 'null'}
            or 'goal' in memory_schema.get('required', [])):
        return False
    memory_ready = (isinstance(properties, dict) and properties.get('finish_turn', {}).get('type') == 'boolean'
            and properties.get('finish_turn', {}).get('default') is False
            and properties.get('summary', {}).get('type') == 'string')
    start_schema = next(row for row in value if row['name'] == 'skill_start')['input_schema']
    summary = start_schema.get('properties', {}).get('summary', {})
    if (not isinstance(summary, dict) or summary.get('type') != 'string'
            or summary.get('default') != '' or 'summary' in start_schema.get('required', [])):
        return False
    for name, field in (('skill_start', 'objective'), ('skill_draft', 'refinement')):
        schema = next(row for row in value if row['name'] == name)['input_schema']
        parameter = schema.get('properties', {}).get(field, {})
        if (parameter.get('default', 'missing') is not None or field in schema.get('required', [])
                or not any(part.get('type') == 'object' for part in parameter.get('anyOf', []))):
            return False
    return memory_ready


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
            request(self.base, TOOLS_ROUTE, {'tools': names})
            # PUT starts an asynchronous native reload. Its response is not proof
            # of readiness: a later GET must see the active capabilities.
            return require_ready(self.base)
        except Exception:
            return False

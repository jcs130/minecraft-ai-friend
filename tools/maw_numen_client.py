"""Standalone, standard-library MCP client for invited My Agent World Agents.

Copy this one file and a privately delivered credentials JSON to the Agent host.
It never retries a request or creates a body automatically. Model inference and
the action_id ledger remain in the caller's own framework.
"""
from __future__ import annotations
import argparse
import ipaddress
import json
from pathlib import Path
import re
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
import uuid


class ClientError(RuntimeError):
    def __init__(self, code, *, status=None, unconfirmed=False):
        super().__init__(code)
        self.code, self.status, self.unconfirmed = code, status, unconfirmed


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ClientError('redirect_refused_credentials_not_forwarded', status=code, unconfirmed=True)


def validate_endpoint(endpoint):
    try: parsed = urlsplit(endpoint); port = parsed.port
    except (ValueError, TypeError): raise ClientError('invalid_endpoint') from None
    if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username is not None or parsed.password is not None or parsed.query or parsed.fragment or not parsed.path.endswith('/mcp'):
        raise ClientError('invalid_endpoint')
    if port is not None and not 1 <= port <= 65535: raise ClientError('invalid_endpoint')
    if parsed.scheme == 'http' and parsed.hostname != 'localhost':
        try: address = ipaddress.ip_address(parsed.hostname)
        except ValueError: raise ClientError('public_endpoint_requires_https') from None
        private = any(address in ipaddress.ip_network(network) for network in ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', 'fc00::/7') if address.version == ipaddress.ip_network(network).version)
        if not (address.is_loopback or private) or address.is_unspecified or address.is_multicast:
            raise ClientError('public_endpoint_requires_https')
    return endpoint


class Client:
    def __init__(self, endpoint, token, *, owner_uuid=None, timeout=15, opener=None):
        self.endpoint = validate_endpoint(endpoint)
        if not isinstance(token, str) or not re.fullmatch('[a-f0-9]{64}', token): raise ClientError('invalid_private_token')
        self._token = token
        try: self.owner_uuid = str(uuid.UUID(owner_uuid)) if owner_uuid else None
        except ValueError: raise ClientError('invalid_owner_uuid') from None
        if not 1 <= timeout <= 120: raise ClientError('invalid_timeout')
        self.timeout = timeout
        self._opener = opener or build_opener(NoRedirect())

    @classmethod
    def from_credentials(cls, path, **options):
        # File/config exceptions are deliberately generic: never include file
        # contents, request headers or a token in a diagnostic.
        try:
            config = json.loads(Path(path).read_text(encoding='utf-8'))
            return cls(config['endpoint'], config['token'], owner_uuid=config.get('ownerUuid'), **options)
        except ClientError: raise
        except (OSError, ValueError, KeyError, TypeError): raise ClientError('private_credentials_unreadable') from None

    def rpc(self, method, params=None):
        request_id = uuid.uuid4().hex
        raw = json.dumps({'jsonrpc': '2.0', 'id': request_id, 'method': method, 'params': params or {}}, ensure_ascii=False).encode('utf-8')
        if len(raw) > 65536: raise ClientError('request_too_large')
        request = Request(self.endpoint, raw, headers={'Authorization': 'Bearer '+self._token,
            'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-06-18'})
        try:
            with self._opener.open(request, timeout=self.timeout) as response:
                data = response.read(1048577)
        except HTTPError as error:
            # A timeout/upstream failure may already have executed an action.
            raise ClientError('http_'+str(error.code), status=error.code, unconfirmed=error.code >= 500) from None
        except ClientError: raise
        except (URLError, OSError, TimeoutError): raise ClientError('request_unconfirmed_query_original_action_id', unconfirmed=True) from None
        if len(data) > 1048576: raise ClientError('response_over_budget_query_original_action_id', unconfirmed=True)
        try: value = json.loads(data)
        except (ValueError, UnicodeError): raise ClientError('invalid_response_query_original_action_id', unconfirmed=True) from None
        if not isinstance(value, dict) or value.get('jsonrpc') != '2.0' or value.get('id') != request_id:
            raise ClientError('response_id_mismatch_query_original_action_id', unconfirmed=True)
        if 'error' in value: raise ClientError('mcp_error_'+str(value['error'].get('code', 'unknown')))
        if not isinstance(value.get('result'), dict): raise ClientError('invalid_mcp_result', unconfirmed=True)
        return value['result']

    def call(self, tool, arguments=None):
        if not isinstance(tool, str) or not re.fullmatch('[a-z_]{1,80}', tool) or not isinstance(arguments or {}, dict): raise ClientError('invalid_tool_call')
        result = self.rpc('tools/call', {'name': tool, 'arguments': arguments or {}})
        if not isinstance(result.get('structuredContent'), dict): raise ClientError('structured_receipt_missing', unconfirmed=True)
        return result['structuredContent']

    def wait(self, body_id, action_id, *, timeout=60, interval=1):
        if not 1 <= timeout <= 3600 or not .5 <= interval <= 10: raise ClientError('invalid_wait_budget')
        deadline = time.monotonic() + timeout
        while True:
            state = self.call('action_status', {'companion': body_id, 'action_id': action_id})
            if state.get('phase') in ('terminal', 'unknown') or not state.get('ok', True): return state
            if time.monotonic() >= deadline:
                raise ClientError('wait_expired_action_not_cancelled_query_original_action_id', unconfirmed=True)
            time.sleep(min(interval, max(0, deadline-time.monotonic())))

    def smoke(self):
        """Authentication + discovery + own-body reads; zero world mutations."""
        init = self.rpc('initialize', {'protocolVersion': '2025-06-18', 'clientInfo': {'name': 'maw-invite-client', 'version': '1'}})
        tools = self.rpc('tools/list')['tools']
        mods = self.call('mod_operations'); lua = self.call('operations'); owned = self.call('list_companions')
        if any(not result.get('ok', True) for result in (mods, lua, owned)): raise ClientError('discovery_failed')
        states = [self.call('get_state', {'companion': row['bodyId']}) for row in owned['companions']]
        for row, state in zip(owned['companions'], states):
            if state.get('bodyId') != row['bodyId'] or not state.get('ok') and not (state.get('online') is False and state.get('status') in ('offline', 'dead') and state.get('code') == 'body_offline_or_dead'):
                raise ClientError('own_body_read_failed')
            if self.owner_uuid and state.get('ownerUuid') != self.owner_uuid: raise ClientError('owner_identity_mismatch')
        return {'ok': True, 'protocolVersion': init['protocolVersion'], 'tools': len(tools), 'nativeModOperations': mods['operationCount'],
                'luaFunctions': lua['totalFunctions'], 'ownBodies': len(states), 'onlineBodies': sum(state.get('online') is True for state in states),
                'bodyStates': [{key: state[key] for key in ('bodyId', 'status', 'online', 'blocked') if key in state} for state in states], 'worldMutations': 0, 'modelRequests': 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--credentials', type=Path, required=True)
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('smoke'); sub.add_parser('tools')
    call = sub.add_parser('call'); call.add_argument('tool'); call.add_argument('--arguments', type=Path)
    wait = sub.add_parser('wait'); wait.add_argument('--body', required=True); wait.add_argument('--action-id', required=True); wait.add_argument('--timeout', type=float, default=60)
    args = parser.parse_args()
    try:
        client = Client.from_credentials(args.credentials)
        if args.command == 'smoke': result = client.smoke()
        elif args.command == 'tools': result = client.rpc('tools/list')
        elif args.command == 'wait': result = client.wait(args.body, args.action_id, timeout=args.timeout)
        else:
            try: arguments = json.loads(args.arguments.read_text(encoding='utf-8')) if args.arguments else {}
            except (OSError, ValueError, UnicodeError): raise ClientError('arguments_file_unreadable') from None
            result = client.call(args.tool, arguments)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0 if result.get('ok', True) and result.get('phase') != 'unknown' else 1
    except ClientError as error:
        print(json.dumps({'ok': False, 'code': error.code, 'status': error.status, 'resultUnconfirmed': error.unconfirmed, 'retryAutomatically': False}))
        return 2


if __name__ == '__main__': raise SystemExit(main())

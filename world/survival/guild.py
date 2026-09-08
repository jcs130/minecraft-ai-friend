"""Leased access to the existing NPC guild; no quests or rewards are invented here."""
from datetime import date
from pathlib import Path
import os
import re
import time
import uuid

from numen_gateway import GatewayError, read_json, write_json

GUILD_ACTIONS = ('guild_claim', 'guild_release', 'guild_deliver')
QUEST_ID = re.compile(r'(\d{4}-\d{2}-\d{2}):([1-9]\d?)\Z')
REQUEST_ID = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\Z')
DEFINITE_CODES = {'claimed', 'released', 'completed', 'already_completed', 'invalid_request', 'expired',
    'actor_mismatch', 'quest_expired', 'quest_not_found', 'unsupported_contract', 'claim_refused',
    'quest_not_owned', 'automatic_acceptance', 'invalid_delivery', 'npc_not_near', 'quest_changed',
    'claimed_by_other', 'missing_goods', 'inventory_unavailable', 'inventory_full'}
SUCCESS_CODES = {'guild_claim': 'claimed', 'guild_release': 'released', 'guild_deliver': 'completed'}


def validate_guild_action(tool, args):
    if tool not in GUILD_ACTIONS or not isinstance(args, dict) or set(args) != {'quest_id'}:
        raise GatewayError('invalid_guild_action')
    match = QUEST_ID.fullmatch(args.get('quest_id', '')) if isinstance(args.get('quest_id'), str) else None
    if not match:
        raise GatewayError('invalid_guild_quest_id')
    try:
        date.fromisoformat(match[1])
    except ValueError:
        raise GatewayError('invalid_guild_quest_id')


def prepare_guild_action(gateway, before, tool, args):
    validate_guild_action(tool, args)
    # The NPC service owns day/rank/claim/proximity/inventory checks under its
    # shared state lock. The normal gateway still owns body/lease authorization.
    if before.get('ok') is not True:
        raise GatewayError('body_unavailable')


class Guild:
    def __init__(self, gateway, queue_root=None, timeout=20, sleep=time.sleep):
        self.gateway = gateway
        self.root = Path(queue_root or os.environ.get('SURVIVOR_GUILD_QUEUE', '/survival-guild-queue'))
        self.state = Path(gateway.state)
        self.timeout, self.sleep = max(0, min(timeout, 25)), sleep

    def _request_path(self, request_id):
        if not isinstance(request_id, str) or not REQUEST_ID.fullmatch(request_id):
            raise GatewayError('invalid_guild_request_id')
        return self.state / 'guild-requests' / (request_id + '.json')

    def receipt(self, request_id):
        try:
            owned = read_json(self._request_path(request_id))
            if owned.get('requestId') != request_id or owned.get('actor') != self.gateway._settings()['bodyName']:
                raise GatewayError('guild_request_not_owned')
            path = self.root / 'results' / (request_id + '.json')
            if not path.exists():
                return {'ok': False, 'code': 'pending', 'requestId': request_id, 'retryAutomatically': False}
            result = read_json(path)
            actor, actor_uuid = self.gateway._check_binding()
            if (result.get('requestId') != request_id or type(result.get('ok')) is not bool
                    or result.get('actor') != owned['actor'] or actor != owned['actor']
                    or actor_uuid != owned.get('actorUuid') or result.get('actorUuid') != actor_uuid
                    or owned.get('request', {}).get('actorUuid') != actor_uuid
                    or owned.get('request', {}).get('id') != request_id
                    or owned.get('request', {}).get('actor') != actor):
                raise GatewayError('guild_receipt_mismatch')
            return result | {'retryAutomatically': False}
        except (OSError, ValueError, TypeError, KeyError):
            return {'ok': False, 'code': 'guild_receipt_unavailable', 'retryAutomatically': False}

    def _request(self, action, quest_id=None):
        actor, actor_uuid = self.gateway._check_binding()
        if self.root.is_symlink() or not self.root.is_dir():
            raise GatewayError('guild_queue_unavailable')
        if any((self.root / name).is_symlink() for name in ('requests', 'results')):
            raise GatewayError('guild_queue_unavailable')
        request_id = str(uuid.uuid4())
        now = self.gateway._now()
        request = {'id': request_id, 'actor': actor, 'actorUuid': actor_uuid, 'action': action,
                   'questId': quest_id, 'submittedAt': now, 'expiresAt': now + 30000}
        write_json(self._request_path(request_id), {'requestId': request_id, 'actor': actor, 'actorUuid': actor_uuid, 'request': request})
        if action != 'query':
            marker = read_json(self.state / 'unknown.json')
            if marker.get('tool') != 'guild_' + action or marker.get('result') != 'unknown':
                raise GatewayError('guild_requires_action_lease')
            write_json(self.state / 'unknown.json', marker | {'requestId': request_id})
        slot = self.root / 'requests' / request_id
        slot.mkdir(parents=True, exist_ok=False)
        write_json(slot / 'request.json', request)
        deadline = time.monotonic() + self.timeout
        while True:
            result = self.receipt(request_id)
            if result.get('code') != 'pending' or time.monotonic() >= deadline:
                return result
            self.sleep(.1)

    def query(self):
        try:
            result = self._request('query')
            if result.get('ok') is True:
                write_json(self.state / 'guild.json', result | {'historicalQuery': True})
            return result
        except (OSError, ValueError, TypeError, KeyError):
            return {'ok': False, 'code': 'guild_query_unavailable'}

    def dispatch(self, tool, args):
        validate_guild_action(tool, args)
        result = self._request(tool.removeprefix('guild_'), args['quest_id'])
        code = result.get('code')
        if (code not in DEFINITE_CODES or type(result.get('ok')) is not bool
                or (code in SUCCESS_CODES.values()) != result['ok']
                or (result['ok'] and code != SUCCESS_CODES[tool])):
            raise GatewayError('outcome_unknown')
        return {'success': result.get('ok') is True, 'message': result.get('summary', ''),
                'data': {'receipt': result, 'async': False}}

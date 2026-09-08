"""Collect actual party replies and native identities, without submitting tasks.

Run after smoke_survivor_life.py collect. Reports stay in ignored local reports;
no chat text, private workspace material or MCP credentials are exported.
"""
import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import json
import math
from pathlib import Path
import sqlite3
import sys
import time
import urllib.parse
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]
USAGE_FIELDS = ('call_count', 'prompt_tokens', 'completion_tokens')
BEHAVIOR_SOURCES = ('world/sidecar/party_messages.py', 'world/sidecar/party_bridge.py',
    'world/sidecar/mcp_configuration.py', 'world/sidecar/maid_registry.py',
    'world/sidecar/party_world.py', 'world/sidecar/party_config.py', 'world/sidecar/qwen_tasks.py',
    'world/sidecar/maid_agent_api.py', 'world/survival/party.py', 'world/survival/controller.py',
    'world/survival/life_session.py', 'world/maid-bridge-src/src/dev/qiandeng/maid/PartySpeech.java',
    'world/maid-bridge-src/src/dev/qiandeng/maid/PartySpeechJournal.java')
sys.path.insert(0, str(ROOT / 'world/sidecar'))
from party_config import PartyConfig, PARTY_TOOLS
from qwen_tasks import NoRedirect, final_text, read_json, write_json


def get(path, role):
    request = urllib.request.Request('http://127.0.0.1:18089/api' + path,
        headers={'X-Agent-Id': role})
    with urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect()).open(request, timeout=10) as response:
        raw = response.read(262145)
    if len(raw) > 262144:
        raise ValueError('native_response_too_large')
    return json.loads(raw)


def text_hash(value):
    return hashlib.sha256(value.encode('utf8')).hexdigest()


def behavior_source_hashes(root=ROOT):
    return {name: hashlib.sha256((Path(root) / name).read_bytes()).hexdigest() for name in BEHAVIOR_SOURCES}


def verify_game_dialogue(row, game):
    """Read both actual Minecraft speech receipts; private drafts are not dialogue."""
    from party_world import speech_event, validate_receipt
    observed = []
    try:
        payload, reply = json.loads(row['payload']), json.loads(row['reply'])
        original_id = str(uuid.UUID(row['message_id']))
        reply_id = str(uuid.uuid5(uuid.UUID(original_id), 'reply'))
        if (original_id != row['message_id'] or payload.get('messageId') != original_id
                or reply.get('messageId') != reply_id or reply.get('replyTo') != original_id
                or reply.get('channel', 'nearby') != payload.get('channel', 'nearby')
                or reply.get('sender') != payload.get('recipient') or reply.get('recipient') != payload.get('sender')
                or reply.get('requiresReply') is not False):
            return {'verified': False, 'code': 'world_event_chain_mismatch'}
        dispatch = row['dispatch_started']
        if type(dispatch) not in (int, float) or not math.isfinite(dispatch) or dispatch <= 0:
            return {'verified': False, 'code': 'world_dispatch_time_missing'}
        for kind, message in (('request', payload), ('reply', reply)):
            delivery = message.get('worldDelivery') or {}
            if delivery.get('state') != 'heard':
                return {'verified': False, 'code': 'world_hearing_unconfirmed', 'events': observed}
            if delivery.get('eventId') != message['messageId']:
                return {'verified': False, 'code': 'world_event_chain_mismatch', 'events': observed}
            event = speech_event(delivery['eventId'], message['sender']['bodyUuid'], message['recipient']['bodyUuid'],
                                 message['text'], message.get('channel', 'nearby'))
            saved = validate_receipt(delivery.get('receipt'), event)
            live = validate_receipt(game.status(event['eventId']), event)
            immutable = ('eventId', 'speakerUuid', 'listenerUuid', 'textSha256', 'channel', 'phase', 'ok', 'heard',
                         'emittedAt', 'dimension', 'speakerPosition', 'listenerPosition', 'distance', 'radius')
            heard = (live['phase'] == saved['phase'] == 'heard' and live['heard'] is True
                     and all(live[k] == saved[k] for k in immutable))
            before_model = kind != 'request' or live['emittedAt'] <= dispatch * 1000 + 1000
            observed.append({'kind': kind, 'eventId': event['eventId'], 'channel': event['channel'],
                'phase': live['phase'], 'heard': live['heard'], 'emittedAt': live['emittedAt'],
                'distance': live['distance'], 'radius': live['radius'],
                'verified': heard and before_model})
    except Exception as error:
        return {'verified': False, 'code': 'world_receipt_unverified', 'errorType': type(error).__name__, 'events': observed}
    return {'verified': len(observed) == 2 and all(r['verified'] for r in observed),
            'events': observed, 'clockSkewToleranceMs': 1000}


def same_life_identity(life, session):
    fields = ('primarySessionId', 'agentId', 'bodyUuid', 'userId', 'channel', 'chatId')
    return (life.get('ok') is True and all(session.get(k) is not None
            and life.get('session', {}).get(k) == session[k] for k in fields))


def live_owned_body(body, maid, survivor):
    identity = body.get('identity', {})
    return (body.get('ok') is True and identity.get('loaded') is True
        and identity.get('maidUuid') == maid['bodyUuid']
        and identity.get('ownerUuid') == survivor['bodyUuid']
        and body.get('state', {}).get('ownerOnline') is True)


def usage_snapshot(party, *, api=get, clock=time.time):
    """Cumulative native counters, separated by actual role, never estimated."""
    end = (datetime.now(timezone.utc) + timedelta(days=1)).date().isoformat()
    roles = {}
    for role in sorted(m['agentId'] for m in party['members']):
        try:
            rows = api('/token-usage/details?start_date=1970-01-01&end_date=' + end, role)
            if not isinstance(rows, list):
                raise ValueError('native_usage_shape_invalid')
            counters = dict.fromkeys(USAGE_FIELDS, 0)
            for row in rows:
                if not isinstance(row, dict) or row.get('agent_id') != role:
                    continue
                if any(type(row.get(k)) is not int or row[k] < 0 for k in USAGE_FIELDS):
                    raise ValueError('native_usage_counter_unknown')
                for field in USAGE_FIELDS:
                    counters[field] += row[field]
            roles[role] = {'available': True, **counters}
        except Exception as error:
            roles[role] = {'available': False, 'errorType': type(error).__name__}
    return {'schema': 1, 'kind': 'party-usage-baseline', 'observedAt': int(clock() * 1000),
            'partyId': party['partyId'], 'bindingRevision': party['revision'], 'roles': roles,
            'source': 'Qwen native GET /token-usage/details; rows filtered by agent_id',
            'modelTasksSubmittedByProbe': 0, 'worldActionsByProbe': 0}


def usage_changes(before, after):
    valid = (isinstance(before, dict) and type(before.get('schema')) is int and before['schema'] == 1
        and before.get('kind') == 'party-usage-baseline'
        and before.get('partyId') == after['partyId'] and before.get('bindingRevision') == after['bindingRevision']
        and isinstance(before.get('observedAt'), int) and 0 < before['observedAt'] <= after['observedAt']
        and isinstance(before.get('roles'), dict) and set(before['roles']) == set(after['roles']))
    result = {}
    for role, current in after['roles'].items():
        previous = before['roles'][role] if valid else {}
        if (isinstance(previous, dict) and previous.get('available') is True and current.get('available') is True
                and all(type(previous.get(k)) is int and 0 <= previous[k] <= current[k] for k in USAGE_FIELDS)):
            result[role] = {k: current[k] - previous[k] for k in USAGE_FIELDS}
        else:
            result[role] = None
    return result


def verify_reply(row, members, party, native, chats):
    """A recorded answer is verified against the exact native recipient task."""
    payload, reply = json.loads(row['payload']), json.loads(row['reply'])
    recipient = members.get(row['recipient'])
    sender = members.get(row['sender'])
    expected = ('agentId', 'bodyUuid', 'ownerUuid', 'sessionId', 'userId', 'channel')
    identities = bool(sender and recipient and payload.get('sender') == {k: sender[k] for k in expected}
        and payload.get('recipient') == {k: recipient[k] for k in expected})
    result = native.get('result') if isinstance(native.get('result'), dict) else {}
    matches = [chat for chat in chats if isinstance(chat, dict) and recipient
        and (chat.get('session_id'), chat.get('user_id'), chat.get('channel')) ==
            (recipient['sessionId'], recipient['userId'], recipient['channel'])]
    answer = final_text(native)
    valid = bool(identities and payload.get('partyId') == party['partyId']
        and payload.get('bindingRevision') == row['binding_revision'] == party['revision']
        and row['status'] == row['reservation_state'] == 'answered'
        and row['task_id'] == row['reservation_task_id']
        and reply.get('sender') == payload['recipient'] and reply.get('recipient') == payload['sender']
        and reply.get('replyTo') == row['message_id'] and reply.get('requiresReply') is False
        and result.get('session_id') == recipient['sessionId'] and len(matches) == 1
        and answer is not None and answer == reply.get('text'))
    return {'messageId': row['message_id'], 'senderAgentId': row['sender'], 'recipientAgentId': row['recipient'],
            'taskId': row['task_id'], 'nativeStatus': native.get('status'), 'verified': valid,
            'requestSha256': text_hash(payload.get('text', '')), 'replySha256': text_hash(reply.get('text', '')),
            'replyRequiresResponse': reply.get('requiresReply'),
            'chatId': matches[0].get('id') if len(matches) == 1 else None}


def collect(before, *, api=get, root=ROOT, usage_before=None):
    root = Path(root)
    party = PartyConfig(root / 'server/mcdata/village/party').private()
    members = {m['agentId']: m for m in party['members']}
    maid = next(m for m in members.values() if m['kind'] == 'maid')
    session = read_json(root / 'server/survival-agent-state/survival/life-session.json')
    life = read_json(root / 'reports/survivor-life-smoke.json')
    since = before['observedAt'] / 1000
    now = time.time()
    if not 0 < since <= now or life.get('window', {}).get('startedAt') != before['observedAt']:
        raise ValueError('experiment_window_invalid')
    evidence, errors, enabled = [], [], {}
    database = root / 'server/mcdata/village/party/party-messages.sqlite3'
    with sqlite3.connect(database.resolve().as_uri() + '?mode=ro', uri=True) as db:
        db.row_factory = sqlite3.Row
        rows = db.execute('''SELECT m.*,r.task_id AS reservation_task_id,r.state AS reservation_state,r.created AS dispatch_started
            FROM messages m JOIN reservations r ON m.reservation_id=r.reservation_id
            WHERE m.status='answered' AND m.created>=? AND m.created<=? ORDER BY m.created LIMIT 32''',
            (since, now)).fetchall()
    from party_world import GameSpeech
    from maid_native_tools import NativeRcon
    game = GameSpeech(run=NativeRcon('127.0.0.1', 25577, root / 'server/world-data/rcon-secret.txt'))
    for row in rows:
        try:
            role = row['recipient']
            member = members[role]
            chats = api('/chats?' + urllib.parse.urlencode({'user_id': member['userId'], 'channel': member['channel']}), role)
            value = verify_reply(row, members, party, api('/console/chat/task/' + row['task_id'], role), chats)
            value['gameDialogue'] = verify_game_dialogue(row, game)
            evidence.append(value)
        except Exception as error:
            errors.append({'operation': 'native_reply', 'errorType': type(error).__name__})
    for member in members.values():
        role = member['agentId']
        try:
            tools = api('/mcp/tools/qd_party', role)
            enabled[role + ':party'] = (isinstance(tools, list) and len(tools) == 3
                and {t.get('name') for t in tools if t.get('enabled') is True} == set(PARTY_TOOLS))
            driver = 'maid_native' if member['kind'] == 'maid' else 'numen_survival'
            tools = api('/mcp/tools/' + driver, role)
            if member['kind'] == 'maid':
                from maid_native_tools import TOOL_NAMES
            else:
                sys.path.insert(0, str(root / 'world/survival'))
                from mcp_server import TOOL_NAMES
            enabled[role + ':body'] = (isinstance(tools, list) and len(tools) == len(TOOL_NAMES)
                and {t.get('name') for t in tools if t.get('enabled') is True} == set(TOOL_NAMES))
        except Exception as error:
            enabled[role + ':body'] = False
            errors.append({'operation': 'native_tools', 'errorType': type(error).__name__})
    from maid_registry import MaidRegistry
    from maid_native_tools import MaidNativeTools, NativeRcon
    registry = MaidRegistry(root / 'server/mcdata/village/maid-agents')
    native = MaidNativeTools(registry, run=NativeRcon('127.0.0.1', 25577, root / 'server/world-data/rcon-secret.txt'))
    body = native.invoke(registry.resolve(maid['bodyUuid'], maid['ownerUuid']), 'identity', {})
    identity = body.get('identity', {})
    checks = {'same_life_session': same_life_identity(life, session),
        'maid_owned_by_kirito': live_owned_body(body, maid, members['qd-survivor']),
        'party_request_answer': any(r['verified'] for r in evidence),
        'game_world_communication': any(r['verified'] and r['gameDialogue']['verified'] for r in evidence),
        'native_tools_active': len(enabled) == 4 and all(enabled.values())}
    usage_after = usage_snapshot(party, api=api)
    return {'schema': 1, 'ok': all(checks.values()), 'kind': 'survivor-party-smoke', 'observedAt': int(now * 1000),
        'partyId': party['partyId'], 'bindingRevision': party['revision'], 'transport': 'game_channel_v1',
        'members': [{k: m[k] for k in ('agentId', 'bodyUuid')} for m in members.values()],
        'lifeSession': {k: session[k] for k in ('primarySessionId', 'userId', 'channel')},
        'checks': checks, 'nativeReplies': evidence, 'nativeTools': enabled, 'errors': errors,
        'bodyObservation': {k: identity.get(k) for k in ('maidUuid', 'ownerUuid', 'dimension', 'position', 'observedAt')} |
                           {'ownerOnline': body.get('state', {}).get('ownerOnline')},
        'lifeEvidenceSha256': hashlib.sha256((root / 'reports/survivor-life-smoke.json').read_bytes()).hexdigest(),
        'behaviorSourceHashes': behavior_source_hashes(root),
        'usage': {'before': usage_before, 'after': usage_after, 'deltaByAgent': usage_changes(usage_before, usage_after),
                  'attribution': 'All native requests for each role between snapshots, including other tasks in that window.'},
        'modelTasksSubmittedByProbe': 0, 'worldActionsByProbe': 0,
        'limitations': ['Reply is not proof of a completed collaboration task.',
                        'No nearby human audio playback or long-term survival claim is made.']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--before', type=Path)
    mode.add_argument('--capture-usage', action='store_true')
    parser.add_argument('--usage-before', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    if args.capture_usage and args.usage_before:
        parser.error('--usage-before is only used when collecting a result')
    output = (args.output or ROOT / ('runtime/party-usage-before.json' if args.capture_usage else 'reports/survivor-party-smoke.json')).resolve()
    if not output.is_relative_to((ROOT / 'reports').resolve()) and not output.is_relative_to((ROOT / 'runtime').resolve()):
        raise ValueError('report_outside_local_reports')
    if args.capture_usage:
        result = usage_snapshot(PartyConfig(ROOT / 'server/mcdata/village/party').private())
        result['ok'] = all(r['available'] for r in result['roles'].values())
    else:
        result = collect(read_json(args.before), usage_before=read_json(args.usage_before) if args.usage_before else None)
    write_json(output, result)
    print(json.dumps({'ok': result['ok'], 'checks': result.get('checks'), 'report': str(output),
                      'modelTasksSubmittedByProbe': 0, 'worldActionsByProbe': 0}))
    raise SystemExit(0 if result['ok'] else 1)

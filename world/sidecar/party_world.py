"""One bounded in-world utterance; uncertain writes are only reconciled by reads."""
import base64
import hashlib
import json
import math
import os
import re
import unicodedata
import uuid


def speech_text(text):
    if (not isinstance(text, str) or not text.strip() or len(text) > 160
            or any(unicodedata.category(c) in ('Cc', 'Cs', 'Cf', 'Zl', 'Zp') for c in text)):
        raise ValueError('invalid_party_speech_text')
    return text


def speech_event(event_id, speaker, listener, text, channel='nearby'):
    if channel not in ('nearby', 'msg'):
        raise ValueError('invalid_party_speech_channel')
    for value in (event_id, speaker, listener):
        if not isinstance(value, str) or str(uuid.UUID(value)) != value:
            raise ValueError('invalid_party_speech_identity')
    speech_text(text)
    return {'schema': 1, 'eventId': event_id, 'speakerUuid': speaker, 'listenerUuid': listener, 'channel': channel,
            'text': text, 'textSha256': hashlib.sha256(text.encode('utf8')).hexdigest()}


def validate_receipt(receipt, event=None):
    fields = {'schema', 'eventId', 'speakerUuid', 'listenerUuid', 'textSha256', 'channel', 'ok', 'heard',
              'phase', 'code', 'dimension', 'speakerPosition', 'listenerPosition', 'distance',
              'radius', 'emittedAt', 'observedAt'}
    if (not isinstance(receipt, dict) or not fields <= set(receipt) or receipt['schema'] != 1
            or type(receipt['ok']) is not bool or type(receipt['heard']) is not bool
            or receipt['phase'] not in ('heard', 'rejected', 'unknown', 'not_found')
            or not isinstance(receipt['code'], str) or len(receipt['code']) > 100
            or receipt['channel'] not in ('nearby', 'msg', None) or type(receipt['observedAt']) is not int):
        raise ValueError('invalid_party_world_receipt')
    if str(uuid.UUID(receipt['eventId'])) != receipt['eventId']:
        raise ValueError('invalid_party_world_receipt')
    if event:
        if receipt['eventId'] != event['eventId']:
            raise ValueError('party_world_receipt_collision')
        if receipt['phase'] != 'not_found' and any(receipt[k] != event[k]
                for k in ('speakerUuid', 'listenerUuid', 'textSha256', 'channel')):
            raise ValueError('party_world_receipt_collision')
    if receipt['phase'] == 'heard':
        if (receipt['ok'] is not True or receipt['heard'] is not True
                or receipt['channel'] not in ('nearby', 'msg')
                or type(receipt['emittedAt']) is not int or receipt['emittedAt'] < 0
                or receipt['observedAt'] < receipt['emittedAt']):
            raise ValueError('invalid_party_world_hearing')
    if receipt['phase'] == 'heard' and receipt['channel'] == 'nearby':
        if (receipt['radius'] != 24 or type(receipt['distance']) not in (int, float)
                or not math.isfinite(receipt['distance']) or not 0 <= receipt['distance'] <= 24
                or not isinstance(receipt['dimension'], str)
                or not re.fullmatch(r'[a-z0-9_.-]+:[a-z0-9_./-]+', receipt['dimension'])):
            raise ValueError('invalid_party_world_hearing')
        for key in ('speakerPosition', 'listenerPosition'):
            if (not isinstance(receipt[key], list) or len(receipt[key]) != 3
                    or any(type(v) not in (int, float) or not math.isfinite(v) for v in receipt[key])):
                raise ValueError('invalid_party_world_hearing')
        distance = math.dist(receipt['speakerPosition'], receipt['listenerPosition'])
        if abs(distance - receipt['distance']) > 0.01:
            raise ValueError('invalid_party_world_distance')
    elif receipt['phase'] != 'heard' and (receipt['heard'] is not False or receipt['ok'] is not False):
        raise ValueError('invalid_party_world_receipt')
    return {k: receipt[k] for k in fields}


class GameSpeech:
    def __init__(self, run=None):
        self.run = run

    def _call(self, command):
        if self.run is None:
            from maid_native_tools import NativeRcon
            self.run = NativeRcon(password_file=os.environ.get('MC_RCON_PASSWORD_FILE')
                                  or os.environ.get('MC_RCON_SECRET'))
        raw = self.run(command)
        if not isinstance(raw, str) or len(raw.encode('utf8')) > 4096 or not raw.startswith('QD_MAID_JSON '):
            raise ValueError('party_world_reply_missing')
        return validate_receipt(json.loads(raw[len('QD_MAID_JSON '):]))

    def emit(self, event):
        value = speech_event(event['eventId'], event['speakerUuid'], event['listenerUuid'], event['text'], event['channel'])
        if value['textSha256'] != event['textSha256']:
            raise ValueError('party_world_text_changed')
        data = base64.urlsafe_b64encode(json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf8')).decode('ascii').rstrip('=')
        return validate_receipt(self._call('qdmaid party_say ' + data), value)

    def status(self, event_id):
        if not isinstance(event_id, str) or str(uuid.UUID(event_id)) != event_id:
            raise ValueError('invalid_party_speech_identity')
        receipt = self._call('qdmaid party_speech_status ' + event_id)
        if receipt['eventId'] != event_id:
            raise ValueError('party_world_receipt_collision')
        return receipt


def reconcile_world(queue, game, event_id, *, allow_dispatch=True):
    """Only the transaction's first claimant may write; never retry an uncertain say."""
    event = queue.claim_world(event_id) if allow_dispatch else queue.world_event(event_id)
    if event['state'] in ('heard', 'rejected', 'expired') or event['state'] == 'pending':
        return event
    try:
        receipt = game.emit(event) if event.get('claimed') else game.status(event_id)
        queue.record_world_receipt(event_id, receipt)
    except Exception:
        # Includes unavailable RCON, invalid/colliding replies and lost HTTP results.
        # UNKNOWN was committed first; none proves that the world did not speak.
        pass
    return queue.world_event(event_id)


def delivery_result(event):
    state = event['state']
    return {'settled': state in ('heard', 'rejected', 'expired'), 'heard': state == 'heard',
            'status': state, 'eventId': event['eventId']}

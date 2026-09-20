"""Local typed choice inside the existing tested-program/body-lease loop."""
import hashlib
import json
import math
import os
import time
from urllib.parse import urlsplit


def validate_choice(value):
    if (not isinstance(value, dict) or set(value) != {'question', 'candidates'}
            or not isinstance(value['question'], str) or not 1 <= len(value['question']) <= 500
            or not isinstance(value['candidates'], list) or not 2 <= len(value['candidates']) <= 8):
        raise ValueError('invalid_policy_choice')
    from numen_gateway import TOOLS
    ids = set()
    for row in value['candidates']:
        if (not isinstance(row, dict) or set(row) != {'id', 'description', 'action'}
                or not isinstance(row['id'], str) or not row['id'].isascii()
                or not row['id'].replace('_', '').isalnum() or len(row['id']) > 32
                or row['id'] in ids or not isinstance(row['description'], str)
                or not 1 <= len(row['description']) <= 300):
            raise ValueError('invalid_policy_candidate')
        ids.add(row['id'])
        action = row['action']
        if action is not None:
            if (not isinstance(action, dict) or set(action) != {'tool', 'args'}
                    or action['tool'] not in TOOLS or not isinstance(action['args'], dict)
                    or len(json.dumps(action, allow_nan=False).encode()) > 4096):
                raise ValueError('invalid_policy_action')
    return value


def compact_state(body, goal, execution):
    return {'body': {k: body.get(k) for k in ('bodyUuid', 'dimension', 'observedAt', 'position',
                'hp', 'hunger', 'inWater', 'inLava', 'onGround', 'task')},
            'goal': str(goal)[:600], 'lastExecution': execution}


class SystemOne:
    def __init__(self, endpoint=None, transport=None, clock=time.time):
        self.endpoint = endpoint or os.environ.get('SURVIVOR_SYSTEM_ONE_URL', 'http://host.docker.internal:8000/v1/systemone')
        parsed = urlsplit(self.endpoint)
        if (parsed.scheme != 'http' or parsed.hostname not in ('127.0.0.1', 'localhost', 'host.docker.internal')
                or parsed.path != '/v1/systemone' or parsed.username or parsed.password or parsed.query or parsed.fragment):
            raise ValueError('system_one_endpoint_invalid')
        self.transport = transport or self._post
        self.clock = clock

    def _post(self, payload):
        import httpx
        with httpx.Client(timeout=2.0, trust_env=False, follow_redirects=False) as client:
            reply = client.post(self.endpoint, json=payload)
            reply.raise_for_status()
            if len(reply.content) > 32768:
                raise ValueError('system_one_reply_too_large')
            return reply.json()

    def choose(self, proposal, body, goal='', execution=None):
        validate_choice(proposal)
        stamp = body.get('observedAt')
        def fresh():
            return (body.get('ok') is True and type(stamp) in (float, int) and math.isfinite(stamp)
                    and 0 <= self.clock() * 1000 - stamp <= 5000)
        if not fresh():
            return {'ok': False, 'code': 'policy_observation_stale'}
        state = compact_state(body, goal, execution)
        packed = json.dumps(state, ensure_ascii=False, allow_nan=False)
        if len(packed.encode('utf8')) > 8192:
            return {'ok': False, 'code': 'policy_state_too_large'}
        payload = {'state': state, 'questions': {'action': {'type': 'choice',
            'instructions': proposal['question'],
            'criteria': {r['id']: r['description'] for r in proposal['candidates']}}}}
        started = time.monotonic()
        try:
            reply = self.transport(payload)
            answer = reply['answers']['action']
            choice, confidence = answer['choice'], answer['confidence']
            probabilities = answer['probabilities']
            choices = {r['id']: r for r in proposal['candidates']}
            if (answer.get('type') != 'choice' or choice not in choices
                    or type(confidence) not in (int, float) or not math.isfinite(confidence) or not 0 <= confidence <= 1
                    or not isinstance(probabilities, dict) or set(probabilities) != set(choices)
                    or any(type(p) not in (int, float) or not math.isfinite(p) or not 0 <= p <= 1 for p in probabilities.values())
                    or abs(sum(probabilities.values()) - 1) > .02
                    or abs(probabilities[choice] - confidence) > .02
                    or confidence < max(probabilities.values()) - .001
                    or not isinstance(reply.get('model'), str) or len(reply['model']) > 100):
                raise ValueError('invalid_policy_reply')
            metadata = {'model': reply['model'], 'choice': choice, 'confidence': confidence,
                        'probabilities': probabilities, 'latencyMs': round((time.monotonic()-started)*1000, 2),
                        'stateSha256': hashlib.sha256(packed.encode('utf8')).hexdigest(),
                        'observedAt': stamp, 'state': state, 'candidates': proposal['candidates']}
            if not fresh():
                return {'ok': False, 'code': 'policy_observation_stale', **metadata}
            if confidence < .75 or choices[choice]['action'] is None:
                return {'ok': False, 'code': 'policy_escalated', **metadata}
            return {'ok': True, 'action': choices[choice]['action'], **metadata}
        except Exception as error:
            return {'ok': False, 'code': 'policy_unavailable', 'errorType': type(error).__name__}

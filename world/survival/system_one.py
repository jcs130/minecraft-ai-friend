"""Typed policy choice inside the existing tested-program/body-lease loop."""
import hashlib
import json
import math
import os
import re
import time
from pathlib import Path
from urllib.parse import urlsplit

OFFICIAL_ENDPOINT = 'https://api.typesafe.ai/v1/systemone'


def validate_choice(value):
    if (not isinstance(value, dict) or not {'question', 'candidates'} <= set(value)
            or set(value) - {'question', 'candidates', 'context'}
            or not isinstance(value['question'], str) or not 1 <= len(value['question']) <= 500
            or not isinstance(value['candidates'], list) or not 2 <= len(value['candidates']) <= 8):
        raise ValueError('invalid_policy_choice')
    if 'context' in value:
        context = value['context']
        if not isinstance(context, dict) or len(json.dumps(context, allow_nan=False).encode()) > 2048:
            raise ValueError('invalid_policy_context')
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


def _scalar(value, limit=100):
    if isinstance(value, str):
        return value[:limit]
    if value is None or type(value) is bool:
        return value
    if type(value) in (int, float) and math.isfinite(value):
        return value
    return None


def _fields(value, keys):
    return {k: _scalar(value.get(k)) for k in keys} if isinstance(value, dict) else None


def compact_state(body, goal, execution, proposal=None):
    """Current physical facts only; missing/truncated inventory is never an empty bag."""
    view = {k: _scalar(body.get(k)) for k in ('bodyUuid', 'dimension', 'observedAt',
        'hp', 'maxHp', 'hunger', 'saturation', 'air', 'inWater', 'inLava', 'onGround', 'biome')}
    view['position'] = _fields(body.get('position'), ('x', 'y', 'z'))
    view['task'] = _fields(body.get('task'), ('task_id', 'task', 'state', 'busy', 'completionConfirmed'))
    # A native reflex owns the body independently of the model's task slot.
    # Preserve its own sample identity/time so idle and active defense differ;
    # do not infer an attacker or damage cause from a health change.
    view['bodyControl'] = _fields(body.get('bodyControl'), ('available', 'kind', 'name',
        'nativeAvoidanceActive', 'actorUuid', 'dimension', 'observedAt', 'gameTime', 'bodyTickCount'))
    equipment = body.get('equipment')
    view['equipment'] = ({slot: _fields(equipment.get(slot), ('item', 'count', 'damage', 'maxDamage'))
        for slot in ('mainhand', 'offhand', 'head', 'chest', 'legs', 'feet')} if isinstance(equipment, dict) else None)
    counts = body.get('counts')
    view['counts'] = None
    view['countsTruncated'] = None
    if isinstance(counts, dict):
        valid = {k: v for k, v in counts.items() if isinstance(k, str) and len(k) <= 100
            and re.fullmatch(r'[a-z0-9_.-]+:[a-z0-9_./-]+', k) and type(v) is int and 0 <= v <= 1000000}
        # Keep candidate items first; overflow remains explicit, never implied zero.
        preferred = [r['action']['args'].get('item_id', r['action']['args'].get('item'))
            for r in (proposal or {}).get('candidates', []) if isinstance(r.get('action'), dict)]
        keys = sorted(valid, key=lambda k: (k not in preferred, k))[:32]
        view['counts'] = {k: valid[k] for k in keys}
        view['countsTruncated'] = len(keys) != len(counts)
    state = {'body': view, 'goal': str(goal)[:600],
             'lastExecution': _fields(execution, ('actionId', 'tool', 'status', 'code', 'completionConfirmed'))}
    if proposal:
        # Exact bounded effects, not just prose labels. Programs select task-local
        # facts from their observations; chat transcripts/reasoning are never added.
        state['actions'] = {r['id']: r['action'] for r in proposal['candidates']}
        if 'context' in proposal:
            state['context'] = proposal['context']
    return state


class SystemOne:
    def __init__(self, endpoint=None, transport=None, clock=time.time, api_key_file=None, model=None):
        self.endpoint = endpoint or os.environ.get('SURVIVOR_SYSTEM_ONE_URL', OFFICIAL_ENDPOINT)
        parsed = urlsplit(self.endpoint)
        self.official = self.endpoint == OFFICIAL_ENDPOINT
        local = (parsed.scheme == 'http' and parsed.hostname in ('127.0.0.1', 'localhost', 'host.docker.internal')
                 and parsed.path == '/v1/systemone' and not any((parsed.username, parsed.password, parsed.query, parsed.fragment)))
        if not self.official and not local:
            raise ValueError('system_one_endpoint_invalid')
        self.model = model or os.environ.get('SURVIVOR_SYSTEM_ONE_MODEL', 'jev-latest')
        if not re.fullmatch(r'jev-[A-Za-z0-9_.-]{1,60}', self.model):
            raise ValueError('system_one_model_invalid')
        self.api_key_file = Path(api_key_file or os.environ.get('SURVIVOR_SYSTEM_ONE_KEY_FILE', '/state/secret/jev-api-key'))
        self.transport = transport or self._post
        self.clock = clock
        self._client = None
        self.timing = None

    def close(self):
        if self._client is not None:
            self._client.close()
            self._client = None

    def _headers(self):
        # Never attach the official credential to local or arbitrary endpoints.
        if not self.official:
            return {}
        with self.api_key_file.open('r', encoding='ascii') as stream:
            key = stream.read(1025).strip()
        if not re.fullmatch(r'[A-Za-z0-9_-]{20,512}', key):
            raise ValueError('system_one_key_invalid')
        return {'Authorization': 'Bearer ' + key}

    def _request(self, method, endpoint, payload=None):
        import httpx
        headers = self._headers()
        started = time.monotonic()
        events = {}
        def trace(event, info):
            # Only event names/times: never trace headers, bodies or credentials.
            events[event] = (time.monotonic() - started) * 1000
        if self._client is None:
            # 2026-09-22 保活 60→1200s：调用间隔是分钟级（复盘节律 ~20 分钟一轮），
            # 60s 保活每次都冷启动（TLS ~708ms 占单次 1.1s 六成 ✗ 实测）；服务端允许
            # 复用（9-21 影子实测：冷 816ms → 复用 278ms ✓）。httpx 池会在空闲期
            # 探测到服务端关闭并弃用坏连接，竞态失败走原有 policy_unavailable 回退。
            self._client = httpx.Client(timeout=2.0, trust_env=False, follow_redirects=False,
                limits=httpx.Limits(max_connections=1, max_keepalive_connections=1, keepalive_expiry=1200))
        initialized = (time.monotonic() - started) * 1000
        try:
            # One serial worker owns this connection. No automatic retries.
            with self._client.stream(method, endpoint, json=payload, headers=headers,
                                     extensions={'trace': trace}) as reply:
                reply.raise_for_status()
                raw = bytearray()
                for chunk in reply.iter_bytes():
                    if time.monotonic() - started > 5:
                        raise TimeoutError('system_one_total_deadline')
                    raw.extend(chunk)
                    if len(raw) > 32768:
                        raise ValueError('system_one_reply_too_large')
                return json.loads(raw)
        finally:
            def duration(prefix):
                a, b = events.get(prefix + '.started'), events.get(prefix + '.complete')
                return round(b - a, 2) if a is not None and b is not None else None
            self.timing = {'clientInitMs': round(initialized, 2),
                'newConnection': 'connection.connect_tcp.started' in events,
                'connectMs': duration('connection.connect_tcp'),
                'tlsMs': duration('connection.start_tls'),
                'responseHeadersMs': next((round(v, 2) for k, v in events.items()
                    if k.endswith('receive_response_headers.complete')), None),
                'httpTotalMs': round((time.monotonic() - started) * 1000, 2)}

    def _post(self, payload):
        return self._request('POST', self.endpoint, payload)

    def health(self):
        """Authentication/model availability only; never a billable evaluation."""
        result = {'ok': False, 'provider': 'typesafe' if self.official else 'local-decider',
                  'endpoint': self.endpoint, 'model': self.model if self.official else None,
                  'modelCalls': 0, 'worldActions': 0,
                  'scope': 'Provider readiness only; not policy quality or successful game actions.',
                  'fallback': 'Existing QwenPaw planner; no automatic local provider fallback.'}
        try:
            if self.official:
                value = self._request('GET', 'https://api.typesafe.ai/v1/models')
                models = value.get('models')
                names = [r.get('name') for r in models if isinstance(r, dict)] if isinstance(models, list) else []
                names = [n for n in names if isinstance(n, str) and len(n) <= 100][:32]
                result.update(ok=self.model in names, authenticationVerified=True, availableModels=names)
            else:
                value = self._request('GET', self.endpoint.rsplit('/v1/', 1)[0] + '/health')
                result.update(ok=value.get('ok') is True and value.get('configLoaded') is True,
                    configuration=_fields(value, ('modelName', 'revision', 'configSha256', 'temperature')))
        except Exception as error:
            result['errorType'] = type(error).__name__
        return result

    def choose(self, proposal, body, goal='', execution=None):
        validate_choice(proposal)
        stamp = body.get('observedAt')
        def fresh():
            return (body.get('ok') is True and type(stamp) in (float, int) and math.isfinite(stamp)
                    and 0 <= self.clock() * 1000 - stamp <= 5000)
        if not fresh():
            return {'ok': False, 'code': 'policy_observation_stale'}
        state = compact_state(body, goal, execution, proposal)
        packed = json.dumps(state, ensure_ascii=False, allow_nan=False)
        if len(packed.encode('utf8')) > 8192:
            return {'ok': False, 'code': 'policy_state_too_large'}
        payload = {'state': state, 'questions': {'action': {'type': 'choice',
            'instructions': proposal['question'],
            'criteria': {r['id']: r['description'] for r in proposal['candidates']}}}}
        if self.official:
            payload['model'] = self.model
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
                    or probabilities[choice] < max(probabilities.values()) - .001
                    or (not self.official and abs(probabilities[choice] - confidence) > .02)
                    or not isinstance(reply.get('model'), str) or len(reply['model']) > 100):
                raise ValueError('invalid_policy_reply')
            metadata = {'model': reply['model'], 'choice': choice, 'confidence': confidence,
                        'provider': 'typesafe' if self.official else 'local-decider',
                        'selectedProbability': probabilities[choice],
                        'probabilities': probabilities, 'latencyMs': round((time.monotonic()-started)*1000, 2),
                        'transportTiming': self.timing,
                        'stateBytes': len(packed.encode('utf8')),
                        'stateSha256': hashlib.sha256(packed.encode('utf8')).hexdigest(),
                        'observedAt': stamp, 'state': state, 'candidates': proposal['candidates']}
            metadata['modelInfo'] = _fields(reply.get('model_info'),
                ('revision', 'configSha256', 'modelName', 'temperature', 'temperatureOverridden'))
            usage = reply.get('usage')
            metadata['usage'] = ({k: usage[k] for k in ('input_tokens', 'output_tokens')
                if type(usage.get(k)) is int and 0 <= usage[k] <= 1000000} if isinstance(usage, dict) else None)
            if not fresh():
                return {'ok': False, 'code': 'policy_observation_stale', **metadata}
            if confidence < .75 or choices[choice]['action'] is None:
                return {'ok': False, 'code': 'policy_escalated', **metadata}
            return {'ok': True, 'action': choices[choice]['action'], **metadata}
        except Exception as error:
            return {'ok': False, 'code': 'policy_unavailable', 'errorType': type(error).__name__}


if __name__ == '__main__':
    import sys
    if sys.argv[1:] != ['--health']:
        raise SystemExit('Only --health is supported')
    try:
        policy = SystemOne()
        try:
            result = policy.health()
        finally:
            policy.close()
    except Exception as error:
        result = {'ok': False, 'errorType': type(error).__name__, 'modelCalls': 0, 'worldActions': 0}
    print(json.dumps(result))
    raise SystemExit(0 if result['ok'] else 1)

"""Stable native maid identity and body-bound HMAC; display text is never authority."""
import hashlib
import hmac
import json
import math
from pathlib import Path
import re
import time
import uuid

UUID = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')


def canonical_uuid(value):
    if not isinstance(value, str) or not UUID.fullmatch(value) or str(uuid.UUID(value)) != value:
        raise ValueError('invalid_maid_uuid')
    return value


def identity(value, *, require_loaded=True):
    if not isinstance(value, dict) or type(value.get('schema')) is not int or value['schema'] != 1:
        raise ValueError('invalid_maid_identity')
    result = {'schema': 1, 'maidUuid': canonical_uuid(value.get('maidUuid')),
              'ownerUuid': canonical_uuid(value.get('ownerUuid'))}
    for name, limit in (('displayName', 80), ('modelId', 160), ('dimension', 160)):
        item = value.get(name)
        if not isinstance(item, str) or len(item) > limit or '\0' in item:
            raise ValueError('invalid_maid_identity')
        result[name] = item
    if not re.fullmatch(r'[a-z0-9_.-]+:[a-z0-9_./-]+', result['dimension']):
        raise ValueError('invalid_maid_dimension')
    for name in ('hasCustomName', 'loaded'):
        if type(value.get(name)) is not bool:
            raise ValueError('invalid_maid_identity')
        result[name] = value[name]
    if require_loaded and not result['loaded']:
        raise ValueError('maid_not_loaded')
    for name in ('entityId', 'observedAt'):
        if type(value.get(name)) is not int or not 0 <= value[name] <= 10**15:
            raise ValueError('invalid_maid_identity')
        result[name] = value[name]
    pos = value.get('position')
    if (not isinstance(pos, list) or len(pos) != 3
            or any(type(n) not in (int, float) or abs(n) > 30000000 or not math.isfinite(n) for n in pos)):
        raise ValueError('invalid_maid_position')
    result['position'] = list(pos)
    return result


class IdentityVerifier:
    def __init__(self, key_file, clock=time.time):
        self.path, self.clock = Path(key_file), clock

    def _key(self):
        if self.path.is_symlink() or self.path.stat().st_size > 300:
            raise ValueError('invalid_maid_key')
        key = self.path.read_text(encoding='ascii').strip().encode('ascii')
        if not 32 <= len(key) <= 256:
            raise ValueError('invalid_maid_key')
        return key

    def configured(self):
        try:
            self._key()
            return True
        except (ValueError, OSError, UnicodeError):
            return False

    def verify(self, raw, headers):
        if not isinstance(raw, bytes) or not 1 <= len(raw) <= 65536:
            raise ValueError('invalid_signed_body')
        request_id = headers.get('X-QD-Request-Id', '')
        canonical_uuid(request_id)
        issued = headers.get('X-QD-Issued-At', '')
        signature = headers.get('X-QD-Signature', '')
        if not re.fullmatch('[0-9]{10,16}', issued) or abs(int(self.clock() * 1000) - int(issued)) > 300000:
            raise ValueError('expired_maid_signature')
        if not re.fullmatch('[a-f0-9]{64}', signature):
            raise ValueError('invalid_maid_signature')
        key = self._key()
        digest = hashlib.sha256(raw).hexdigest()
        base = (request_id + '\n' + issued + '\n' + digest).encode()
        if not hmac.compare_digest(signature, hmac.new(key, base, hashlib.sha256).hexdigest()):
            raise ValueError('invalid_maid_signature')
        body = json.loads(raw)
        actor = identity(body.get('qd_identity'))
        if abs(actor['observedAt'] - int(issued)) > 300000:
            raise ValueError('stale_maid_identity')
        return {'requestId': request_id, 'bodySha256': digest, 'identity': actor, 'body': body}
